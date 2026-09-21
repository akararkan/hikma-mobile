/* Accessibility fold gate (DESIGN.md §4 typography, theme/osA11y).

   The accessibility settings screen tells the user, in words, that IKA
   follows the phone's own settings and that the in-app toggles ADD to them.
   ThemeProvider.foldOsA11y is what makes that true: it multiplies the
   account's font scale by the phone's and ORs the two reduce-motion flags,
   then clamps the product to the range the in-app block could already reach
   on its own.

   That clamp is the load-bearing part. Every screen sizes off `t.type`, so a
   ceiling set too high ships a broken layout to anyone with Dynamic Type
   turned up, and a floor set too high silently shrinks users who were already
   at the top of the in-app range. This gate re-derives both bounds from the
   real constants and checks the invariants that make the fold safe.

   Run: node scripts/check-a11y-scale.mjs — exits 1 on regression. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/* Read CODE, not prose. These files carry long explanatory headers that name
   the very things this gate forbids — osA11y.ts documents at length why it
   does NOT use PixelRatio — so matching against raw source flags the
   explanation as the offence. Block comments go first so a `//` inside one
   cannot strand the rest of the line. */
const code = rel => readFileSync(join(root, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const prefsSrc = code('src/theme/prefs.ts')
const themeSrc = code('src/theme/ThemeProvider.tsx')
const textSrc = code('src/ui/Text.tsx')
const osSrc = code('src/theme/osA11y.ts')

const fail = []
const round4 = n => Math.round(n * 1e4) / 1e4

/* ---- re-derive the in-app bounds from prefs.ts ---- */
const steps = [...prefsSrc.matchAll(/(SMALL|MEDIUM|LARGE|XLARGE):\s*([\d.]+)/g)].map(m => +m[2])
const boost = +(prefsSrc.match(/LARGE_TEXT_BOOST\s*=\s*([\d.]+)/) || [])[1]
const ifaceMin = +(prefsSrc.match(/INTERFACE_SCALE_MIN\s*=\s*([\d.]+)/) || [])[1]
const ifaceMax = +(prefsSrc.match(/INTERFACE_SCALE_MAX\s*=\s*([\d.]+)/) || [])[1]

if (!steps.length || !boost || !ifaceMin || !ifaceMax) {
  console.error('check-a11y-scale: could not parse the font-scale constants out of src/theme/prefs.ts')
  process.exit(1)
}

const expected = {
  min: round4(Math.min(...steps) * ifaceMin),
  max: round4(Math.max(...steps) * boost * ifaceMax),
}

/* PREF_SCALE_BOUNDS must be DERIVED, not typed in — a literal here is exactly
   the drift this gate exists to catch. */
if (!/min:\s*round4\(Math\.min\(\.\.\.Object\.values\(FONT_SCALE\)\)\s*\*\s*INTERFACE_SCALE_MIN\)/.test(prefsSrc)) {
  fail.push('PREF_SCALE_BOUNDS.min is no longer derived from FONT_SCALE × INTERFACE_SCALE_MIN')
}
if (!/max:\s*round4\(Math\.max\(\.\.\.Object\.values\(FONT_SCALE\)\)\s*\*\s*LARGE_TEXT_BOOST\s*\*\s*INTERFACE_SCALE_MAX\)/.test(prefsSrc)) {
  fail.push('PREF_SCALE_BOUNDS.max is no longer derived from FONT_SCALE × LARGE_TEXT_BOOST × INTERFACE_SCALE_MAX')
}

/* ThemeProvider must clamp to those bounds and nothing else. A hardcoded
   number here is how the ceiling silently drifts away from the range the
   layouts were actually built for. */
if (!/const SCALE_MIN = PREF_SCALE_BOUNDS\.min/.test(themeSrc)) {
  fail.push('ThemeProvider SCALE_MIN is not PREF_SCALE_BOUNDS.min — the fold could now shrink users below the in-app floor')
}
if (!/const SCALE_MAX = PREF_SCALE_BOUNDS\.max/.test(themeSrc)) {
  fail.push('ThemeProvider SCALE_MAX is not PREF_SCALE_BOUNDS.max — the fold could now exceed the range the layouts support')
}

/* The fold itself: both halves of the promise. */
if (!/prefs\.fontScale \* os\.fontScale/.test(themeSrc)) {
  fail.push('foldOsA11y no longer multiplies the account scale by the phone scale — "adds to your phone\'s setting" is false again')
}
if (!/reducedMotion: prefs\.reducedMotion \|\| os\.reduceMotion/.test(themeSrc)) {
  fail.push('foldOsA11y no longer ORs the phone\'s Reduce Motion — the OS switch stops reaching t.ms() and the ~30 animation sites')
}
if (!/adoptPrefs\(prefs\)/.test(themeSrc)) {
  fail.push('adoptPrefs no longer receives the FOLDED prefs — the synchronous readers (prefersReducedMotion) would see only the account block')
}

/* Text must not let RN scale on top of a scale that already includes the
   phone's factor. */
if (!/allowFontScaling=\{false\}/.test(textSrc)) {
  fail.push('ui/Text no longer sets allowFontScaling={false} — the phone\'s font scale would be applied twice')
}

/* osA11y must report the phone's reading RAW; clamping belongs to the one
   authority above. And it must never fall back to PixelRatio.get(), whose
   value is a pixel ratio (≈3), not a font scale. */
if (/PixelRatio/.test(osSrc)) {
  fail.push('theme/osA11y reads PixelRatio — getFontScale() falls back to the DEVICE PIXEL RATIO, which would read as a ~300% font scale')
}

if (fail.length) {
  console.error('accessibility fold: REGRESSED\n')
  for (const f of fail) console.error('  · ' + f)
  process.exit(1)
}

console.log(
  `accessibility fold: OK — combined text scale clamped to ${expected.min}…${expected.max}, ` +
  'exactly the range the in-app block already produced; reduce-motion ORs the phone in.',
)
