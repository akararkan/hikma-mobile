/* =========================================================
   The story surfaces are dark in BOTH schemes.

   A story is a full-bleed photograph with white chrome on top.
   There is no light-mode version of that, the same way there
   is no light-mode version of a cinema — so these screens read
   the DARK map directly instead of the active one. That is
   still the design system, just pinned, rather than twenty hex
   literals scattered across six files.

   Everything below resolves to a token or a palette role.
   ========================================================= */
import { palettes, withAlpha } from '@/theme/colors'
import { ramp } from '@/theme/tokens'

/** The pinned dark palette. Use its roles exactly as you would `t.colors`. */
export const night = palettes.dark

/** The pinned LIGHT palette, for the two surfaces that are white in both
 *  schemes because they float on top of arbitrary imagery: the poll card and
 *  the poll composer. */
export const day = palettes.light

/** True black-ish, for the viewer's backdrop and for scrims over media. */
export const BLACK = ramp.slate[1000]

/** Spreadable absolute fill. This RN version's types do not declare
 *  `StyleSheet.absoluteFillObject`, and `absoluteFill` is a registered style
 *  id, which cannot be spread into an object. */
export const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

/** White at the alphas overlay chrome uses, named by intent rather than by
 *  number so a re-balance is one edit here. */
export const ink = {
  full: night.overlayText,
  muted: night.overlayTextMuted,
  soft: withAlpha(night.overlayText, 0.6),
  faint: withAlpha(night.overlayText, 0.45),
  ghost: withAlpha(night.overlayText, 0.22),
  hairline: withAlpha(night.overlayText, 0.14),
  /** Card fills on a dark screen — the "raised" surface of these screens. */
  fill: withAlpha(night.overlayText, 0.06),
  fillStrong: withAlpha(night.overlayText, 0.12),
} as const

/** Black at the alphas the scrims and chips use. */
export const shade = {
  chip: night.overlayChip,
  veil: night.overlayBg,
  heavy: withAlpha(BLACK, 0.78),
  scrimTop: withAlpha(BLACK, 0.6),
  scrimBottom: withAlpha(BLACK, 0.65),
  clear: withAlpha(BLACK, 0),
} as const

/** The unseen story ring — the theme's `storyRing` steel (DESIGN.md §2),
 *  pinned here because this skin never re-themes. The old three-stop gradient
 *  predated the SealRing law (§5: the ring is a PLAIN border; §10.10: one
 *  accent per element) and `Avatar` had already moved to steel — this catches
 *  the hub up. */
export const RING_STEEL = '#7FA8CE'

/** Close friends is green everywhere it appears — ring, glyph, pill. */
export const CLOSE_GREEN = ramp.green[500]
export const CLOSE_GREEN_SOFT = withAlpha(ramp.green[500], 0.12)

/** The publish button and the poll's option A. */
export const ACTION_GRADIENT: readonly [string, string] = [ramp.brand[600], ramp.violet[500]]
export const POLL_A = ramp.brand[400]
export const POLL_B = ramp.scholar[300]

/** Under an hour a countdown turns urgent. */
export const URGENT = ramp.red[300]

export { withAlpha }
