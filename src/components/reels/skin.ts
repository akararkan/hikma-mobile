/* =========================================================
   The reel stage's palette.

   Reels are the one surface in this app that is NOT
   scheme-aware: a clip is shown against black in light mode
   and in dark mode, because the frame is the content and any
   other backdrop tints it. The theme's `overlay*` roles cover
   the chrome that sits on top of arbitrary imagery
   (overlayText / overlayTextMuted / overlayChip) and those are
   used wherever they fit — but there is no opaque-black
   surface role and adding one would mean every screen in the
   app answering for it.

   So the handful of values a black stage needs live HERE, in
   one file, rather than as forty inline hexes across the
   domain. Importers are the reel components and the reel /
   sound ROUTE screens (app/(app)/reels/**, app/(app)/sounds/**)
   — the screens that draw the same black stage. Nothing outside
   those two worlds may import it; everything else uses @/theme.
   ========================================================= */

export const STAGE = {
  /** The pager's backdrop. Full-bleed, edge to edge. */
  black: '#000000',
  /** An opaque dark surface for reel-adjacent screens (grids, history). */
  plate: '#0B131D',
  /** The two ends of the "no poster yet" gradient. */
  plateTop: '#1A2836',
  plateBottom: '#0B131D',
  /** A grid cell before its poster decodes. */
  tile: '#16212E',
  /** The comments panel — a shade above `plate` so it reads as lifted. */
  sheet: '#10171F',

  glass: 'rgba(0,0,0,0.32)',
  glassStrong: 'rgba(0,0,0,0.5)',
  /** Full-bleed dim over a hero/cover backdrop (the sounds stage). */
  wash: 'rgba(0,0,0,0.45)',
  glassSoft: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.16)',

  fg: '#FFFFFF',
  fgMuted: 'rgba(255,255,255,0.72)',
  fgFaint: 'rgba(255,255,255,0.45)',
  fgGhost: 'rgba(255,255,255,0.28)',

  /** The one saturated colour on the stage — the palette's like-rose, lifted
   *  a step because every heart here sits on media, never on paper. */
  like: '#C2483D',
  /** The record dot. */
  record: '#C2483D',
  warn: '#D9A75A',
  warnSoft: 'rgba(217,167,90,0.22)',
  danger: '#C2483D',

  scrimTop: 'rgba(0,0,0,0.55)',
  scrimBottom: 'rgba(0,0,0,0.78)',
  transparent: 'transparent',
} as const

/** Legibility over a bright frame. The caption and the handle wear it — they
 *  sit inside the bottom scrim, so they only need the extra edge. */
export const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const

/** For chrome that stands OUTSIDE the scrims — the action rail's upper half
 *  reaches well past the bottom gradient on a tall phone, and a white stroke
 *  on a white frame at 0.45/3 is still a guess. */
export const TEXT_SHADOW_STRONG = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const

/** The gradient a page shows while it has no poster and no decoded frame. */
export const PLATE_GRADIENT: readonly [string, string] = [STAGE.plateTop, STAGE.plateBottom]
