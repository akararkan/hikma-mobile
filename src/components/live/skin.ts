/* =========================================================
   The room skin — pinned dark, for the call room and the live
   room alike.

   A ringing phone and a broadcast are the same kind of surface
   as the story viewer and the reel stage: full-bleed, dark in
   BOTH schemes, with white chrome floating over arbitrary
   imagery. There is no light-mode version of a cinema.

   So these screens read the DARK palette directly instead of
   the active one — still the design system, just pinned, the
   way src/components/stories/night.ts pins it. Every value
   below resolves to a palette role or a ramp step; none of it
   is a new colour, and nothing outside src/components/call and
   src/components/live imports it.
   ========================================================= */
import { palettes, withAlpha } from '@/theme/colors'
import { ramp } from '@/theme/tokens'

/** The pinned dark palette. Use its roles exactly as you would `t.colors`. */
export const night = palettes.dark

const BLACK = ramp.slate[1000]

export const ROOM = {
  /** The page. Edge to edge, under the status bar. */
  bg: BLACK,
  /** A video pane or a player well before any picture arrives. */
  pane: ramp.slate[950],
  /** One participant / guest tile. */
  tile: ramp.slate[900],
  /** A card floating on the page — a form block, a terminal card. */
  card: ramp.slate[900],

  fg: night.overlayText,
  fgMuted: night.overlayTextMuted,
  fgFaint: withAlpha(night.overlayText, 0.45),
  fgGhost: withAlpha(night.overlayText, 0.26),

  hairline: withAlpha(night.overlayText, 0.1),
  fill: withAlpha(night.overlayText, 0.07),
  fillStrong: withAlpha(night.overlayText, 0.13),

  /** Chips and pills that sit on top of a picture. */
  glass: night.overlayChip,
  glassStrong: withAlpha(BLACK, 0.62),

  /** Sky — THE on-dark accent (DESIGN.md §2: "every on-dark accent"). For
   *  state-bearing chrome only — the low-latency chip, a live monitor, an
   *  active toggle — never body text, and never on a light ground. */
  accent: night.sky,
  /** The ghost fill behind an accented chip — Sky's answer to `fill`. */
  accentGhost: withAlpha(night.sky, 0.16),

  live: night.liveDot,
  like: night.like,
  success: night.success,
  danger: night.danger,
  warning: night.warning,
  warningSoft: withAlpha(night.warning, 0.14),
  transparent: 'transparent',
} as const

/** Spreadable absolute fill. `StyleSheet.absoluteFill` is missing from
 *  this RN version's types and `absoluteFill` is a registered id that cannot
 *  be spread, so a plain object is the only thing that composes. */
export const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

/** The navy broadcast plate — the web live surface's signature ground
 *  (`.lv-stage` / `.lv-card-thumb`: deep → Oxford → lifted navy on a 135°
 *  run). Composed from the brand ramp, so it is the same three blues the
 *  web resolves its gradient to — no new colour. Diagonal: pass
 *  `start={{x:0,y:0}} end={{x:1,y:1}}` to LinearGradient. */
export const BROADCAST_PLATE: readonly [string, string, string] = [
  ramp.brand[950], ramp.brand[900], ramp.brand[600],
]

/** Transparent → black, for the bottom of a card or a player. */
export const SCRIM_DOWN: readonly [string, string] = [withAlpha(BLACK, 0), withAlpha(BLACK, 0.86)]
/** Black → transparent, for the top of a full-bleed backdrop. */
export const SCRIM_UP: readonly [string, string] = [withAlpha(BLACK, 0.7), withAlpha(BLACK, 0)]
/** The three-stop wash behind a ringing avatar: clear at the top, solid at the
 *  bottom so the accept/decline circles read against any photograph. */
export const RING_SCRIM: readonly [string, string, string] = [
  withAlpha(BLACK, 0), withAlpha(BLACK, 0.55), BLACK,
]

/* There is deliberately no TEXT_SHADOW here. QELAT law 3: depth is drawn
   line-work and letterpress, never a shadow — and a per-glyph shadow forces an
   offscreen compositing pass on Android. Chrome over a picture gets legibility
   from a solid `glass` plate or from SCRIM_DOWN, which is cheaper and reads
   better. */

export { withAlpha }
