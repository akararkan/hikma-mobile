# IKA Mobile — the OXFORD design system

The mobile port of the web app's Oxford identity (see
`~/Documents/ika/OXFORD_THEME.md`; the web app is the visual source of truth).
A scholarly archive printed on white paper: Oxford Blue for authority, stone
for lines, slate for words, one bright accent reserved for dark plates.
This file is the bible; `src/theme/` is its executable form. When they
disagree, fix one of them — never a call site.

The four laws, in one breath:

1. **WHITE PAPER** — the body is `#FFFFFF`; secondary surfaces are off-white
   `#F2F0F0` (rails may use the `#F7F6F5` half-step). Backgrounds are only
   ever these. Tinted fills mark *state*, never surface.
2. **STONE & SLATE** — stone (`#D9D8D6` / `#E9E8E6` / `#C2C1BF`) draws lines;
   cool slate (`#1C2330` / `#4D5768` / `#616B7C`) sets words. Stone never
   sets a word; slate never draws a line. Mixing them is what makes a grey
   UI look muddy.
3. **OXFORD BLUE** — `#002147` is the identity: primary actions, headings,
   active nav, own bubbles, seals. Link blue `#1F4E7E` carries links and
   interactive icons. Sky `#B9D6F2` is the secondary and every on-dark
   accent. **Cerulean `#49B6FF` is the one bright accent and exists ONLY on
   dark plates**, carrying Oxford Blue ink — on white it is a 1.9:1 disaster.
4. **SOFT DEPTH** — uniform friendly radii (8/10/14/16/18) and quiet slate
   shadows `rgba(23,31,45,…)`. Cards rest on a stone hairline; menus and
   sheets lift on the soft shadow. No drawn-ornament depth, no letterpress.

## §1 · Where things live

- `src/theme/tokens.ts` — ramps, spacing, radii/`shape`, `shadows`, type
  scale, motion, layout. `setback()` survives from the QELAT era but now
  yields uniform corners; new code may use `radius`/`shape` directly.
- `src/theme/colors.ts` — the two `Palette` maps. Screens consume **roles**
  (`c.textMuted`, `c.surfaceSunken`), never ramp steps, never literals.
- `src/theme/ThemeProvider.tsx` — scheme resolution, prefs, direction,
  `t.shadow(level)`, `t.ms()`.
- `src/ui/` — the primitives. Everything visual imports from `@/ui`.

**Never introduce a raw hex in a component.** If no role fits, the palette is
missing a role — add it to `colors.ts` (both schemes) first. The two
sanctioned exceptions: dark-by-design skins (reels/story) may import ramp
steps, and pure `#FFFFFF` ink on the `liveDot`/overlay plates.

## §2 · Colour

### Light (default)

| Role | Value | Notes |
|---|---|---|
| `bg` / `surface` / `surfaceRaised` | `#FFFFFF` | the body IS white |
| `bgSunken` | `#F2F0F0` | wells, section gaps, rails |
| `surfaceSunken` | `#F7F6F5` | quiet in-card wells |
| `text` | `#1C2330` | 15.8:1 on white |
| `textSecondary` | `#4D5768` | |
| `textMuted` / `textFaint` | `#616B7C` | 5.2:1 white · 4.5:1 off-white — the AA floor |
| `placeholder` | `#98A1B0` | decorative only |
| `border` / `separator` | `#D9D8D6` / `#E9E8E6` | stone; strong `#C2C1BF` |
| `accent` | `#002147` | pressed `#00172F` |
| `accentText` / `link` | `#1F4E7E` | 7.2:1 on white |
| `accentSoft` | `#E7EFF8` | quiet wash — hover/selected fills |
| `sky` | `#B9D6F2` | fixed in both schemes |
| `cta` / `textOnCta` | `#49B6FF` / `#002147` | dark plates ONLY; pressed `#2AA1F2` |
| `scholar` / `scholarSoft` / `scholarText` | `#002147` / `#DCE9F6` / `#163E66` | seniority = darker blue; gold is retired |
| `success` / soft | `#426A5A` / `#E4EDE9` | success ONLY, never decoration |
| `warning` / soft | `#8A5A17` / `#F5EAD7` | |
| `danger` / soft | `#9C3A33` / `#F6E4E2` | pressed `#872F29` |
| `like` | `#B3453E` | the filled heart, both schemes |
| `online` | `#3D9A5F` | the sanctioned non-success green (dots only) |
| `liveDot` | `#9C3A33` | LIVE pill; pure `#FFFFFF` ink allowed |
| `storyRing` / `storyRingSeen` | `#7FA8CE` / `#C2C1BF` | steel unseen · stone seen |
| `bubbleOut` / ink | `#002147` / `#F2F0F0` | own chat bubbles |
| `bubbleIn` / ink | `#F2F0F0` / `#1C2330` | others' |

### Dark (opt-in, Oxford night)

Blue-black surfaces, Sky carries the identity: `bg #0A121C`, sunken
`#080E16`, card `#101C2C`, inset `#162436`, border `#22344A`, hairline
`#1A2A3D`, text `#E8EDF3` / `#A9B8C8` / `#7F92A6`, accent `#1F4E7E`
(pressed **brightens** to `#2E6094` — on dark, pressure glows), link
`#8FB8E0`, scholar = Sky, success `#7FBFA5`, warning `#D9A75A`, danger
`#D98078`. Cerulean and Sky are unchanged. Never pure black, never warm
blacks, never neutral grey-blacks.

### Dark-by-design surfaces (both schemes)

Reels, story viewer/editor, the auth dark pane and media lightboxes are
always dark: the Oxford blue-black ramp
`#080E16 → #0B131D → #0D1520 → #101A28 → #16222F → #2B3B4E`, off-white
text, Sky accents, cerulean CTAs (`Button variant="onDark"`).

### Verified contrast

`scripts/check-contrast.mjs` recomputes every load-bearing pair on each run
(`npm run check` does not include it — run it explicitly). Floors: body text
≥ 4.5:1, status dots ≥ 3:1, `textOnCta`/`cta` ≥ 4.5:1. Stone borders are
decorative **by spec** — state is never carried by a resting border; focus
and error states switch the border to `link`/`danger`, which hold text AA.
Regressions from the script's table are bugs, not tuning.

### The recolor contract

A user accent override replaces exactly `accent`, `accentPressed`,
`accentSoft`, `accentSofter`, `accentText`, `link` (+ computed on-accent
ink). The white grounds, status hues, sky, cerulean, `like` and the bubbles
never follow it.

## §3 · Shape & depth

- Radii: **8** chips/small buttons · **10** md buttons/fields · **12** lg
  buttons/popovers · **14** cards (the workhorse) · **16** FABs · **18**
  sheets (top corners only). Avatars are full circles — faces are the one
  round thing. Channel/group tiles are rounded squares.
- **Pills (`borderRadius 999`) are sanctioned for exactly two things:** the
  unread counter Badge and the LIVE tag. Chips are 8pt rounded rectangles,
  not pills.
- Depth: `t.shadow(1)` resting cards (rarely needed — the hairline usually
  suffices), `t.shadow(2)` menus/popovers/raised cards, `t.shadow(3)`
  sheets/dialogs. Never a shadow on list rows. Android gets the matching
  elevation automatically.
- `setback(t.shape.*)` is legacy-compatible and yields uniform corners now;
  don't add new call sites — spread `borderRadius` from `radius`/`shape`.

## §4 · Typography

Resolved inside the `Text` primitive and only there — **never set
`fontFamily` at a call site.**

| Voice | Latin | Arabic/Kurdish |
|---|---|---|
| Serif (display, title1/2, `serif` prop — headings, datelines, post bodies, quotes) | **Lora** 400/600/700 (+ italics) | **Amiri** 400/700 |
| UI (everything else) | **IBM Plex Sans** 400/500/600/700 | **Vazirmatn** 400–700 |
| Ayah/Quranic blocks (`ayah`) | — | **Amiri 400**, never bolded, never for ordinary Arabic text |
| Ledger (`mono` — handles, timestamps, OTP, counters) | IBM Plex Mono 400/600 | same |

Hard rules the primitive enforces: Arabic-script runs get `letterSpacing 0`
and are never uppercased; the caps variants (caption/micro) transform Latin
only; line heights are absolute (multipliers clip Arabic ascenders); script
detection follows the first strong character, like the web's `dir="auto"`.

## §5 · Ornament policy

QELAT's drawn ornament is retired. What survives in `src/ui/ornaments.tsx`
(same names, quiet Oxford behaviour): `Selvedge` — **the 3px discipline
spine** on research cards and callout tone strips; `WarpRule` / `WeftDash` /
`DoubleRule` / `SealBand` — plain stone hairlines; `SealRing` — the story
ring as a plain bordered View (no SVG, list-safe); `Crenellation` — the
active-tab bar; `ZigguratCrown` — the sheet grabber; `GulMedallion` —
concentric circles for empty states; `BrickCourse` — renders nothing.
`SelectionDiamond` is a fading selection dot.

Discipline spines: hadith `#8A4A5B` · tafsir `#002147` · aqidah `#6B5B8A` ·
fiqh `#4E6580` · science `#2F6B72` · history `#5B7A67` · manuscript
`#6B5B8A`. These are content categoricals, not chrome — the same set feeds
avatar fallbacks and charts.

**No SVG inside list items.** Icons are font glyphs; rings and rules are
Views. If a row seems to need SVG, it doesn't.

## §6 · Components (the deltas that bite)

- **Buttons** — primary: Oxford Blue plate, white ink, pressed deepens.
  secondary: white, stone outline, ink label; outline turns link blue under
  pressure. ghost: link-blue label, wash on press. danger: `#9C3A33`.
  scholar: navy (roles do it). **onDark: cerulean plate + NAVY ink — the
  ox.ac.uk pattern; use it for any primary action sitting on a dark plate
  (reels, story, live, auth dark pane, navy cards). A navy button on a navy
  card is invisible; that's the failure this variant exists to prevent.
  Never place onDark on a light ground.**
- **Fields** — white box, 1px stone border, 10pt radius; focus turns the
  border link blue, error turns it danger; placeholder `#98A1B0`. Search
  wells are off-white with no border.
- **Cards** — white, stone hairline, radius 14. Raised (menus/popovers)
  lift on `shadow(2)`.
- **The feed plate** — the TIMELINE is the one exception to the card above,
  and `src/components/feed/plate.ts` owns it: a full-bleed white plate, no
  side margin, no radius, a stone hairline at crown and root, `FEED_GAP` 8 of
  sunken ground as the seam to the next row, `FEED_GUTTER` 14 for text.
  Media inside it bleeds to the plate edge at **radius 0** — a photograph
  inset in a rounded frame is a photograph shown smaller than it was taken.
  Every timeline row wears it (post, channel post, question, research, the
  discovery bands, the live rail, PYMK, the story tray, the composer row) so
  the feed reads as one column rather than a stack of framed objects. The
  stele stands everywhere else — settings groups, research shelves, sheets,
  profile cards.
- **Post actions** — on the feed plate the bar carries WORDS: four equal
  cells, glyph + "Like / Comment / Share / Save", with the counts printed
  once in the ledger above it (reaction bubble + total on the start edge, the
  readable tally on the end edge, tappable through to comments). The words
  stand down above a 1.2 font scale; the accessibility labels never do. The
  content-packed chip bar (counts inside the chips) is still what the detail
  screens use.
- **Press feedback** — fill swaps to the pressed role + a quiet 0.98 scale
  (`Touchable feedback="scale"`). Rows ripple (`tint`). Disabled = 50%
  opacity, never a colour swap.
- **Status pills** — answered `link` on `#E7EFF8` · resolved/accepted
  `#163E66` on `#DCE9F6` · published `success` on its wash · under review
  `warning` on its wash · rejected/error/sign-out `danger` on its wash ·
  open `muted` on `#F2F0F0`. All through Chip tones — never bespoke.
- **Engagement semantics** — filled heart `c.like`; unliked outline
  `c.textMuted`; saved bookmark fills `c.accent`; comment/answer counts
  `c.link`; presence dots `c.online`; LIVE pill `c.liveDot` + cerulean Join.
- **Seals** — standard verify `c.link`; scholar seal `c.scholar` (darker =
  more senior). One seal per name, never both.
- **Skeletons** — `#F2F0F0` base, `#E9E8E6` shimmer, 8pt radius. Striped
  placeholder plates (45° `#E9E8E6`/`#E6EAF1`) instead of fake photos.
- **Headers** — near-solid white (`headerBg` 96%), stone hairline under;
  large titles in Lora over a hairline. Media letterboxes on `#000`, never
  on the paper.

## §7 · Motion

Quick and unfussy: `instant 80` press · `fast 150` fades · `normal 230`
slides/thumbs · sheets on `sheetSpring`. Everything durations through
`t.ms()` so reduced-motion collapses to cuts. No parallax, no float, no
blur-in.

### The accessibility fold

**The phone is a user too.** `theme/osA11y.ts` reads the device's own
accessibility state and `ThemeProvider` folds it into `t.prefs` before any
screen sees it, so `t.prefs.reducedMotion` and `t.prefs.fontScale` each mean
*"the account setting AND the phone's"*:

| Phone setting | Folded as | Reaches |
|---|---|---|
| Reduce Motion | OR with the account flag | `t.ms()`, ~30 `t.prefs.reducedMotion` sites, stack animations |
| Dynamic Type / font size | × the account scale, clamped to `PREF_SCALE_BOUNDS` | `t.type`, `t.reading`, every `Text` |
| Bold Text (iOS) | weight floor of 600 | the `Text` primitive, `ayah` exempt |
| VoiceOver / TalkBack | `t.a11y.screenReader` — **not** folded | opt-in; freezes story auto-advance |

Rules: **never call `AccessibilityInfo` from a component** — read `t.prefs` or
`t.a11y`, or the value ends up honoured in one screen and nowhere else, which
is exactly the state this replaced. `Text` keeps `allowFontScaling={false}`
because the scale is applied once in the theme; turning it on double-applies
the phone's factor. The clamp range is *derived* from what the in-app block
could already produce, so honouring the phone can only move a user within a
range the layouts already render — widening it means making the fixed heights
in `layout` functions of the scale first. `scripts/check-a11y-scale.mjs`
holds all of this.

## §8 · Layout & safe areas

- 4pt grid; screen padding 14; tap targets ≥ 44pt (Touchable auto-slops).
- **Android is edge-to-edge (SDK 57): every bottom-anchored bar owns
  `useSafeAreaInsets().bottom`** — `Screen` deliberately does not pad the
  bottom because lists scroll under the tab bar. A fixed
  `paddingBottom: N` on an absolute bottom bar is a bug on every
  gesture-nav device (`Math.max(insets.bottom, N)` is the pattern).
  Top offsets come from `insets.top`, never a hardcoded 44.
- RTL: logical properties (`start`/`end`) everywhere; `t.isRTL` only for
  chevrons, swipes and measured-x maths.

## §9 · Performance (the scroll contract)

- Lists are FlashList v2 with module-scope `keyExtractor`/`getItemType`,
  memoized rows fed **scalars**.
- **`drawDistance` is a function of cell height, not a constant.** FlashList's
  default is 250px, which is *under one cell* when cards run 200–400pt tall, so
  a fast fling outruns the render stack and shows blanks. Buffer roughly two
  screens of cells, then trade back down for decode cost: media-dense lists pay
  for every image in the window up front. The shipped values and their reasons —
  350 home feed (media-heavy cards), 500 research shelves / question lists
  (full plates, ~300pt), 600 chat thread / channel feed / QnA answer thread /
  saved feed mode (tall cards, one screenful is not enough), platform default
  for the dense square grids (prefetch is already cheap there). Every call site states its own
  reason; lowering one to hit a round number reintroduces the blanks it was
  raised to fix.
- Per-frame data (presence, typing, active-video) rides keyed external
  stores + `useSyncExternalStore` per row — never a context value that
  rebuilds identity per event. `useRealtimeShell()` is legacy and has no
  callers left; use `useRealtimeUnread()` / `useRealtimeConnection()` /
  `useRealtimeApi()` / `usePresence(key)` / `useTyping(key)`.
- Media: expo-image with `recyclingKey` + `cachePolicy`; native players
  (video/audio) mount on activation, not on row mount.
- No SVG, no shadows, no `Animated` JS-driver work inside rows.

## §10 · DON'Ts

1. No raw hex outside `src/theme/` (exceptions in §1).
2. No cerulean, Sky-as-fill, or white text on light grounds.
3. No gold/gilt anywhere — scholarly emphasis is darker blue.
4. Green only ever means success (presence dots excepted).
5. No pills beyond the two sanctioned ones.
6. No shadows in list rows; no blur anywhere.
7. No `fontFamily` at call sites; no uppercasing Arabic.
8. No fixed bottom padding on bars — insets own the bottom edge.
9. Backgrounds are white or off-white, full stop.
10. One accent per element — if it needs Oxford Blue *and* Sky *and* green,
    it is over-designed.
