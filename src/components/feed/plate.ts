/* =========================================================
   The FEED PLATE — the one geometry every timeline row wears.

   The stele (an inset white card with setback corners and a
   1px course border, floating on the clay ground) is retired
   FOR THE TIMELINE ONLY. A phone feed reads best when the
   content owns the full width and the ground is reduced to
   the seam between two rows: nothing is spent on side margins,
   photographs run edge to edge at their true width, and the
   eye tracks one column instead of a stack of framed objects.

   So a feed row is a FULL-BLEED PLATE: white, no radius, no
   side border, a stone hairline at the crown and the root, and
   an 8pt sunken gap between it and the next. The hairlines are
   what keep the plate legible where the gap alone would read
   as a printing gutter.

   Everywhere ELSE the stele stands — settings groups, the
   research shelves, sheets, the profile cards. This is the
   timeline's dress, not a new law for the whole app.
   ========================================================= */
import { StyleSheet } from 'react-native'

/** The gutter a plate keeps around its text. Media ignores it and bleeds. */
export const FEED_GUTTER = 14

/** The sunken seam between two plates — the only ground the feed shows. */
export const FEED_GAP = 8

const sheet = StyleSheet.create({
  /* The caller supplies `backgroundColor` (surface) and `borderColor`
     (separator) from the theme — a plate never carries its own colour. */
  plate: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /* The in-plate divider: the hairline over the action bar, inset from both
     edges so it reads as a rule rather than a second plate edge. */
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: FEED_GUTTER,
  },
})

export const feedPlate = sheet.plate
export const feedRule = sheet.rule
