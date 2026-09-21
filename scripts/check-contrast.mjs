/* OXFORD contrast gate (DESIGN.md §2 "Verified contrast").
   Parses the palette literals out of src/theme/colors.ts and re-computes
   every load-bearing pair. Body text ≥4.5:1, status dots ≥3:1. Stone
   borders are decorative by spec (state is carried by fills, text and the
   link-blue focus border — never by a resting border), so they carry no
   floor. Run: node scripts/check-contrast.mjs — exits 1 on regression. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'src/theme/colors.ts'), 'utf8')
const accentsSrc = readFileSync(join(root, 'src/theme/accents.ts'), 'utf8')
const tokensSrc = readFileSync(join(root, 'src/theme/tokens.ts'), 'utf8')

function palette(name) {
  const start = src.indexOf(`export const ${name}`)
  const end = src.indexOf('}', src.indexOf('overlayChip', start))
  const body = src.slice(start, end)
  const map = {}
  for (const m of body.matchAll(/(\w+):\s*'((?:#|rgba?\()[^']+)'/g)) map[m[1]] = m[2]
  return map
}

function parse(c) {
  if (Array.isArray(c)) return c
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3) h = [...h].map(ch => ch + ch).join('')
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
}

/* rgba over an opaque ground → opaque rgb */
function over(top, ground) {
  const [r, g, b, a] = parse(top)
  const [gr, gg, gb] = parse(ground)
  return [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a), 1]
}

function lum([r, g, b]) {
  const f = v => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(a, b) {
  const la = lum(a)
  const lb = lum(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/* [fg, bg, floor] — bg composited over the scheme bg when translucent. */
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surfaceRaised', 4.5],
  ['textSecondary', 'bg', 4.5], ['textSecondary', 'surface', 4.5],
  ['textMuted', 'bg', 4.5], ['textMuted', 'surface', 4.5],
  ['textMuted', 'surfaceSunken', 4.5], ['textMuted', 'surfaceRaised', 4.5],
  ['textFaint', 'bg', 4.5], ['textFaint', 'surfaceSunken', 4.5],
  ['textOnAccent', 'accent', 4.5], ['textOnAccent', 'accentPressed', 4.5],
  ['accentText', 'bg', 4.5], ['accentText', 'surface', 4.5],
  ['link', 'bg', 4.5], ['link', 'surface', 4.5],
  ['scholar', 'bg', 4.5],
  ['scholarText', 'scholarSoft', 4.5], ['scholarText', 'bg', 4.5],
  ['textOnScholar', 'scholar', 4.5],
  ['successText', 'successSoft', 4.5], ['warningText', 'warningSoft', 4.5],
  ['dangerText', 'dangerSoft', 4.5], ['infoText', 'infoSoft', 4.5],
  ['textOnDanger', 'danger', 4.5], ['textOnDanger', 'dangerPressed', 4.5],
  ['bubbleOutText', 'bubbleOut', 4.5], ['bubbleInText', 'bubbleIn', 4.5],
  ['text', 'chatWallpaper', 4.5],
  /* The cerulean on-dark action: Oxford Blue ink on the bright plate. */
  ['textOnCta', 'cta', 4.5], ['textOnCta', 'ctaPressed', 4.5],
  /* Focus/link ink doubles as the focus border — hold it to text AA. */
  ['link', 'surfaceSunken', 4.5],
  ['online', 'bg', 3], ['away', 'bg', 3], ['offline', 'bg', 3], ['liveDot', 'bg', 3],
  /* The voice plate (.vnp): white clock + Sky played-waveform on the navy
     gradient — both ends of it. The ghost-sky REST bars are the track and
     carry no floor, like stone borders: the state lives in the played fill. */
  ['overlayText', 'voicePlate', 4.5], ['overlayText', 'voicePlateEnd', 4.5],
  ['sky', 'voicePlate', 3], ['sky', 'voicePlateEnd', 3],
]

let failed = 0
for (const scheme of ['lightPalette', 'darkPalette']) {
  const p = palette(scheme)
  for (const [fg, bg, floor] of PAIRS) {
    const ground = over(p[bg], p.bg)
    const ink = over(p[fg], ground)
    const r = ratio(ink, ground)
    if (r < floor) {
      failed++
      console.error(`FAIL ${scheme} ${fg}/${bg}: ${r.toFixed(2)} < ${floor}`)
    }
  }
  /* the one sanctioned pure-white plate */
  const live = ratio(parse('#FFFFFF'), parse(p.liveDot))
  if (live < 4.5) { failed++; console.error(`FAIL ${scheme} #FFFFFF/liveDot: ${live.toFixed(2)}`) }
}

/* ---------------------------------------------------------------------------
   The user-accent swatches (src/theme/accents.ts).

   The two Palette maps above are only half the surface: recolor() takes a
   swatch the USER picked and derives `accent` + `textOnAccent: inkOn(accent)`
   from it, so a swatch that no ink can carry ships a sub-AA Button label in
   both schemes, permanently, and no pair in PAIRS would ever notice. That is
   exactly how a failing swatch shipped once. Walk the list here instead.

   SCOPE — the RESTING plate only. `recolor()` reuses inkOn(accent) on
   `accentPressed` rather than recomputing it, and on the dark scheme
   accentPressed is the accent lightened 14% toward white; several swatches
   (Violet, Teal, Rose) land just under 4.5 there. Holding the pressed plate to
   AA is a real design decision — it means either re-deriving the ink per plate
   in ThemeProvider or darkening half the list — and it is not one this gate
   gets to make unilaterally. A pressed plate is also transient by definition.
   Extend this loop only alongside that decision. */

/* `ramp.<family>[<step>]` resolved straight out of tokens.ts. */
const rampBody = tokensSrc.slice(tokensSrc.indexOf('export const ramp'))
function rampHex(family, step) {
  const start = rampBody.indexOf(`${family}: {`)
  const body = rampBody.slice(start, rampBody.indexOf('}', start))
  const m = body.match(new RegExp(`\\b${step}:\\s*'(#[0-9A-Fa-f]{3,8})'`))
  return m?.[1]
}

/* The swatch list holds three shapes: a `ramp.x[n]` reference, a local const
   (EMERALD/VIOLET/…), and the empty string meaning "no override" — which the
   picker paints as DEFAULT_ACCENT_SWATCH and recolor() resolves to the app's
   own accent, so it must be gated under that hex and not skipped. */
function swatchHex(token) {
  if (token === "''") return swatchHex(accentsSrc.match(/DEFAULT_ACCENT_SWATCH\s*=\s*(.+)$/m)[1].trim())
  const lit = token.match(/^'(#[0-9A-Fa-f]{3,8})'$/)
  if (lit) return lit[1]
  const ref = token.match(/^ramp\.(\w+)\[(\d+)\]$/)
  if (ref) return rampHex(ref[1], ref[2])
  const local = accentsSrc.match(new RegExp(`const ${token}\\s*=\\s*(.+)$`, 'm'))
  return local ? swatchHex(local[1].trim()) : undefined
}

const swatchBlock = accentsSrc.slice(accentsSrc.indexOf('export const ACCENT_SWATCHES'))
const swatches = [...swatchBlock.slice(0, swatchBlock.indexOf('] as const')).matchAll(
  /\[\s*('[^']*'|ramp\.\w+\[\d+\]|[A-Z][A-Z0-9_]*)\s*,\s*'([^']+)'\s*\]/g,
)]
if (swatches.length < 2) {
  failed++
  console.error('FAIL accents: could not parse ACCENT_SWATCHES out of src/theme/accents.ts')
}
for (const [, token, label] of swatches) {
  const plate = swatchHex(token)
  if (!plate) {
    failed++
    console.error(`FAIL accent ${label}: could not resolve ${token} to a hex`)
    continue
  }
  /* inkOn(): the better of the two inks, asked by contrast rather than by a
     luminance threshold — mirror it exactly or the gate tests a colour the app
     never paints. */
  const slate = ratio(parse('#1C2330'), parse(plate))
  const white = ratio(parse('#FFFFFF'), parse(plate))
  const best = Math.max(slate, white)
  if (best < 4.5) {
    failed++
    console.error(`FAIL accent ${label} ${plate}: best ink ${best.toFixed(2)} < 4.5 (slate ${slate.toFixed(2)}, white ${white.toFixed(2)})`)
  }
}

if (failed) {
  console.error(`\n${failed} contrast regressions — DESIGN.md §2 is the contract.`)
  process.exit(1)
}
console.log(`contrast: all pairs clear their floors in both schemes; ${swatches.length} accent swatches carry an AA ink`)
