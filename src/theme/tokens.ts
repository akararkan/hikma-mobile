/* =========================================================
   Design tokens — the single source of truth for every pixel.

   OXFORD (2026-08) — the University of Oxford visual identity,
   ported from the web app (see ~/Documents/ika OXFORD_THEME.md;
   DESIGN.md is the mobile bible). The system in one breath:

     WHITE PAPER   the body is #FFFFFF; secondary surfaces are
                   off-white #F2F0F0. Backgrounds are only ever
                   these two — tinted fills mark STATE, never
                   surface.
     STONE & SLATE stone (#D9D8D6 family) draws lines; cool
                   slate (#1C2330 family) sets words. Mixing
                   them is what makes a grey UI look muddy.
     OXFORD BLUE   #002147 is the identity — primary actions,
                   headings, active nav, own bubbles, seals.
                   Sky #B9D6F2 is the secondary, on-dark accent.
     SOFT DEPTH    uniform friendly radii (8/10/14/16/18) and
                   quiet slate shadows rgba(23,31,45,…). Depth
                   is a soft lift, not a drawn rule.

   Nothing here imports React. Consumers get these through
   ThemeProvider, which picks the light or dark map and layers
   direction on top.
   ========================================================= */
import { StyleSheet } from 'react-native'

/* ---------------------------------------------------------
   Ramps. Raw steps for the call sites that need one (charts,
   live/story skins, harden()). Screens normally read a
   semantic ROLE from colors.ts, not a ramp stop.
   --------------------------------------------------------- */

export const ramp = {
  /* The Oxford blues — sky washes down to navy and the deep. */
  brand: {
    50: '#E7EFF8',
    100: '#D6E7F8',
    200: '#B9D6F2',
    300: '#8FB8E0',
    400: '#7FA8CE',
    500: '#1F4E7E',
    600: '#163E66',
    700: '#0E3050',
    800: '#07284A',
    900: '#002147',
    950: '#00172F',
  },
  /* Scholarly emphasis IS Oxford Blue now (the 2026-07-30 web
     migration: "old gold accents are blue"). The ramp keys stay so
     legacy call sites keep compiling — their values are blue. */
  scholar: {
    50: '#E7EFF8',
    100: '#DCE9F6',
    200: '#B9D6F2',
    300: '#7FA8CE',
    400: '#2E6094',
    500: '#1F4E7E',
    600: '#163E66',
    700: '#0E3050',
    800: '#07284A',
    900: '#002147',
    950: '#00172F',
  },
  /* Neutrals: white paper → stone lines → slate ink → the Oxford
     blue-black ramp for dark-by-design surfaces. */
  slate: {
    0: '#FFFFFF',
    25: '#FBFAFA',
    50: '#F7F6F5',
    100: '#F2F0F0',
    150: '#E9E8E6',
    200: '#D9D8D6',
    300: '#C2C1BF',
    400: '#98A1B0',
    500: '#616B7C',
    600: '#4D5768',
    700: '#3A4353',
    800: '#232B3A',
    850: '#1C2330',
    900: '#16222F',
    950: '#101A28',
    1000: '#080E16',
  },
  green: { 100: '#E4EDE9', 300: '#7FBFA5', 500: '#426A5A', 600: '#3A5D4F', 900: '#12291F' },
  amber: { 100: '#F5EAD7', 300: '#D9A75A', 500: '#8A5A17', 600: '#7A4F12', 900: '#2C2210' },
  red: { 100: '#F6E4E2', 300: '#D98078', 500: '#9C3A33', 600: '#872F29', 900: '#43120E' },
  violet: { 100: '#EBE4FD', 300: '#B79BF5', 500: '#6B5B8A', 600: '#59496F', 900: '#2C1560' },
  blue: { 100: '#E7EFF8', 300: '#8FB8E0', 500: '#1F4E7E', 600: '#163E66', 900: '#0D3057' },
} as const

/* ---------------------------------------------------------
   Spacing — a 2pt grid, which is what this app has always
   actually been.

   The scale used to claim 4pt and nobody obeyed it: a census of
   every padding / margin / gap literal in src found 5,077 of
   them, and 40.7% sat off the 4pt grid — clustering hard on
   10 (×590), 6 (×412), 14 (×292) and 18 (×86). `screenPadding`
   is itself 14. So the declared scale was a fiction and the
   real rhythm was the even numbers between its steps.

   Declaring the real one costs nothing visually and makes the
   grid enforceable. The five intermediate steps below are
   ADDITIVE — every previously-named step keeps its name and its
   value, so nothing that already imports `space` moves.

   The odd strays (5 ×119, 3 ×99, 7 ×82, 9, 11, 13) are the only
   genuine mistakes. They snap to the nearest even step as each
   screen is migrated: a ≤1pt correction, listed per screen in
   the migration notes rather than applied silently.
   --------------------------------------------------------- */

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  /** ×412 in the wild — icon-to-label, chip internals. */
  xs2: 6,
  sm: 8,
  /** ×590, the single most-used value in the app — card gap, list rhythm. */
  sm2: 10,
  md: 12,
  /** ×292 — the screen gutter (`layout.screenPadding` is this). */
  md2: 14,
  lg: 16,
  /** ×86 — section padding on roomier cards. */
  lg2: 18,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const

export type SpaceKey = keyof typeof space

/* ---------------------------------------------------------
   Radii — soft and friendly, the web's exact scale:
   8 / 10 / 14 / 16 / 18. `card` 14 is the workhorse.
   --------------------------------------------------------- */

export const radius = {
  none: 0,
  xs: 8,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 18,
  xxl: 24,
  card: 14,
  sheet: 18,
  field: 10,
  pill: 999,
  full: 9999,
} as const

/* ---------------------------------------------------------
   Shape — per-surface corner maps. Oxford corners are UNIFORM
   (the QELAT crowned/rooted setback is retired); the map keys
   and the `{top, bottom}` pairs survive so the ~120 existing
   `setback(t.shape.*)` call sites keep compiling — with
   top === bottom, `setback()` now yields plain rounded
   corners. Chat bubbles keep their asymmetric tail: that is a
   chat idiom, not ornament.
   --------------------------------------------------------- */

export const shape = {
  card: { top: 14, bottom: 14 },
  toast: { top: 12, bottom: 12 },
  popover: { top: 12, bottom: 12 },
  buttonSm: { top: 8, bottom: 8 },
  buttonMd: { top: 10, bottom: 10 },
  buttonLg: { top: 12, bottom: 12 },
  chip: { top: 8, bottom: 8 },
  field: { top: 10, bottom: 10 },
  sheet: { top: 18, bottom: 0 },
  skeleton: { top: 8, bottom: 8 },
  fab: { top: 16, bottom: 16 },
  bubble: { crown: 14, tail: 4, grouped: 6 },
  pill: 999,
} as const

export type ShapeKey = keyof typeof shape

/** Spread helper: `{...setback(shape.card)}` → the four corner radii.
 *  Under Oxford every shape is uniform, so this is just borderRadius —
 *  kept because ~120 call sites spread it. */
export function setback(s: { top: number; bottom: number }) {
  return {
    borderTopLeftRadius: s.top,
    borderTopRightRadius: s.top,
    borderBottomLeftRadius: s.bottom,
    borderBottomRightRadius: s.bottom,
  } as const
}

/* ---------------------------------------------------------
   Stroke widths. Stone draws the lines; slate never does.
   --------------------------------------------------------- */

export const rule = {
  /** list-row separators only */
  hairline: StyleSheet.hairlineWidth,
  /** default divider + card borders */
  course: 1,
  /** secondary-button / control outlines */
  control: 1,
  /** field resting border */
  baseline: 1,
  /** field focus border */
  focus: 2,
  /** the discipline spine on research cards, callout strips */
  selvedge: 3,
} as const

/* Legacy ornament opacities — QELAT's brick/seal textures are retired
   (the components render quiet hairlines or nothing) but the keys stay
   for the call sites that read them. */
export const ornament = {
  brickLight: 0,
  brickDark: 0,
  sealBand: 0,
  gul: 1,
} as const

/* ---------------------------------------------------------
   Shadows — the web's slate-ink shadows, translated to RN.
   Quiet by design: cards rest on sm, menus/popovers on md,
   sheets/dialogs on lg. Android gets a matching elevation.
   Consumed via `t.shadow(level)` on ThemeProvider.
   --------------------------------------------------------- */

export const shadows = {
  none: {},
  /* --shadow-sm: 0 1px 2px rgba(23,31,45,.05), 0 2px 6px rgba(23,31,45,.04) */
  sm: {
    shadowColor: '#171F2D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  /* --shadow: 0 4px 16px -6px rgba(23,31,45,.12), 0 1px 4px rgba(23,31,45,.05) */
  md: {
    shadowColor: '#171F2D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 3,
  },
  /* --shadow-lg: 0 20px 60px -16px rgba(23,31,45,.28) */
  lg: {
    shadowColor: '#171F2D',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
} as const

/* ---------------------------------------------------------
   Type scale. Line heights are absolute, not multipliers:
   Arabic and Kurdish glyphs are taller than Latin and a
   multiplier clips their ascenders.

   `family` routes through the Text primitive (DESIGN.md §4):
     display → Lora, the serif voice (Amiri for Arabic script)
     ui      → IBM Plex Sans (Vazirmatn for Arabic script —
               the system-Arabic-sans of the web's font stack)
   `caps` variants uppercase LATIN ONLY — never Arabic script.
   --------------------------------------------------------- */

export const type = {
  display: { fontSize: 34, lineHeight: 40, letterSpacing: -0.4, weight: '700', family: 'display' },
  title1: { fontSize: 27, lineHeight: 33, letterSpacing: -0.3, weight: '700', family: 'display' },
  title2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.2, weight: '700', family: 'display' },
  title3: { fontSize: 19, lineHeight: 26, letterSpacing: 0, weight: '600', family: 'ui' },
  headline: { fontSize: 16, lineHeight: 23, letterSpacing: 0, weight: '600', family: 'ui' },
  body: { fontSize: 15.5, lineHeight: 23, letterSpacing: 0, weight: '400', family: 'ui' },
  bodyStrong: { fontSize: 15.5, lineHeight: 23, letterSpacing: 0, weight: '600', family: 'ui' },
  callout: { fontSize: 14.5, lineHeight: 21, letterSpacing: 0, weight: '400', family: 'ui' },
  subhead: { fontSize: 13.5, lineHeight: 19, letterSpacing: 0, weight: '500', family: 'ui' },
  footnote: { fontSize: 12.5, lineHeight: 17, letterSpacing: 0, weight: '500', family: 'ui' },
  caption: { fontSize: 11.5, lineHeight: 15, letterSpacing: 0.6, weight: '600', family: 'ui', caps: true },
  micro: { fontSize: 10.5, lineHeight: 13, letterSpacing: 1, weight: '700', family: 'ui', caps: true },
} as const

export type TypeKey = keyof typeof type

/* Reading type: the research reader and long post bodies. Larger
   and looser than `body` because these are read, not scanned. */
export const readingType = {
  fontSize: 17,
  lineHeight: 28,
} as const

/* ---------------------------------------------------------
   Motion — quick and unfussy. `out` decelerates into place;
   springs settle without wobble. Reduced motion collapses
   every duration through `t.ms()`.
   --------------------------------------------------------- */

export const motion = {
  instant: 80,
  fast: 150,
  normal: 230,
  slow: 340,
  slower: 480,
  /** decelerate — entrances and slides */
  out: [0.2, 0.9, 0.1, 1] as const,
  /** ease-in-out — moves that both start and stop on screen */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** default spring — presses, reaction confirms */
  spring: { damping: 30, stiffness: 320, mass: 0.8 },
  /** softer spring for sheets and large surfaces */
  sheetSpring: { damping: 26, stiffness: 210, mass: 1 },
} as const

/* ---------------------------------------------------------
   Layout constants shared across screens.
   --------------------------------------------------------- */

export const layout = {
  screenPadding: space.md2,
  cardGap: space.sm2,
  listGap: space.sm,
  headerHeight: 56,
  /** The bar's own body. Its RENDERED height adds the safe-area edge below —
   *  see `tabBarMinInset` and useTabBarClearance(). */
  tabBarHeight: 64,
  /** The floor TabBar puts under `insets.bottom`, so the bar still has a
   *  finger's margin on a phone with no home indicator. Declared here because
   *  every scene that scrolls under the bar has to clear the same number, and
   *  three of them were each guessing a different one. */
  tabBarMinInset: space.sm,
  composerMinHeight: 44,
  /** The inbox / roster row. Two components draw it; both read this. */
  rowHeight: 72,
  avatar: { xs: 22, sm: 30, md: 40, lg: 56, xl: 80, xxl: 104 },
  hitSlop: { top: space.sm, bottom: space.sm, left: space.sm, right: space.sm },
  /** Minimum tappable square. Anything smaller needs hitSlop. */
  tapTarget: 44,
  /** The widest a reading column may get. A phone is never this wide, so this
   *  only ever binds on a tablet or a foldable — where a full-bleed feed card
   *  runs a line of body text past 120 characters and stops being readable. */
  maxContentWidth: 720,
} as const

/* ---------------------------------------------------------
   The reading-column clamp.

   Spread into a scroll view's `contentContainerStyle` (or a
   FlashList's) and the column stops growing past
   `maxContentWidth` and centres itself. On every phone the
   max never binds, so this is a no-op below 720pt — which is
   why it is safe to apply broadly.

   `alignSelf` rather than the container's `alignItems`: this
   sizes the CONTENT CONTAINER, so its children keep their own
   full width. Centring with `alignItems` would instead shrink
   every child to its intrinsic width and take the padding with
   it.
   --------------------------------------------------------- */

export const contentClamp = {
  maxWidth: layout.maxContentWidth,
  alignSelf: 'center' as const,
  width: '100%' as const,
}

/* ---------------------------------------------------------
   Opacity ramp for pressed/disabled/scrim states.
   --------------------------------------------------------- */

export const alpha = {
  press: 0.62,
  disabled: 0.5,
  ghost: 0.08,
  ghostStrong: 0.14,
  scrim: 0.55,
  scrimHeavy: 0.78,
  overlayText: 0.92,
} as const

export const zIndex = {
  base: 0,
  sticky: 10,
  header: 20,
  fab: 30,
  sheet: 40,
  toast: 60,
  modal: 50,
  /* Above toasts, below the call strip — a ring always outranks a preview. */
  banner: 65,
  callBanner: 70,
} as const
