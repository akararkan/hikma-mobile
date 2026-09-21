/* =========================================================
   Placeholders shaped like the real thing.

   `SkeletonCard` from @/ui is the generic two-line-plus-block
   version; these match the feed's actual geometry — the same
   full-bleed plate (hairline crown and root, no shadow, no
   radius), the same 40px avatar, the same 14pt gutters, media
   bleeding to the plate edge, and a four-cell action bar under
   its rule — so nothing shifts under the reader's eye when the
   data lands. Text-shaped blocks carry
   the skeleton setback (6/2) and the woven 100/72/88 row
   rhythm (DESIGN.md §6 State); the sweep itself lives inside
   the Skeleton primitive.

   The rail block is measured against LiveRail, block for block:
   the same plate and 8pt seam, the same 12pt
   crown padding, a head line + weft dash where the real rail
   has "LIVE NOW" + its dash, and cells that carry BOTH label
   lines under the 64pt avatar. A rail that is 20pt shorter than
   the thing replacing it makes the whole feed jump the moment
   the first page lands.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Skeleton, WeftDash } from '@/ui'
import { FEED_GAP, FEED_GUTTER, feedPlate, feedRule } from './plate'

export function FeedSkeleton({ count = 4, rail = true }: { count?: number; rail?: boolean }) {
  const t = useTheme()
  return (
    <View>
      {rail ? (
        <View style={[feedPlate, styles.rail, { backgroundColor: t.colors.surface, borderColor: t.colors.separator }]}>
          <Skeleton width={72} height={12} style={[styles.line, styles.railLabel]} />
          <WeftDash style={styles.railDash} />
          <View style={styles.railRow}>
            {Array.from({ length: 5 }, (_, i) => (
              <View key={i} style={styles.railCell}>
                <Skeleton circle width={64} height={64} />
                <Skeleton width={54} height={10} style={[styles.line, styles.railName]} />
                <Skeleton width={40} height={9} style={[styles.line, styles.railHandle]} />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[feedPlate, styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.separator }]}>
          <View style={styles.head}>
            <Skeleton circle width={40} height={40} />
            <View style={styles.headText}>
              <Skeleton width="42%" height={12} style={styles.line} />
              <Skeleton width="26%" height={10} style={styles.line} />
            </View>
          </View>
          <Skeleton width="100%" height={12} style={[styles.line, styles.firstLine]} />
          <Skeleton width="72%" height={12} style={[styles.line, styles.nextLine]} />
          <Skeleton width="88%" height={12} style={[styles.line, styles.nextLine]} />
          {/* Bleeding to the plate edge at radius 0, exactly as the real
              card's media does. */}
          <Skeleton height={200} radius={0} style={styles.media} />
          {/* The ledger line, its rule, and the four-cell bar under it. */}
          <Skeleton width={92} height={11} style={[styles.line, styles.ledger]} />
          <View style={[feedRule, styles.rule, { backgroundColor: t.colors.separator }]} />
          <View style={styles.bar}>
            {Array.from({ length: 4 }, (_, k) => (
              <View key={k} style={styles.barCell}><Skeleton width={58} height={12} style={styles.line} /></View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

/** The 3-column grid on /saved and /liked. */
export function GridSkeleton({ count = 9, columns = 3 }: { count?: number; columns?: number }) {
  const { width } = useWindowDimensions()
  const tile = Math.floor(width / columns) - 2
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.gridCell}>
          <Skeleton width={tile} height={tile} radius={2} />
        </View>
      ))}
    </View>
  )
}

/** An 84-high people row — /suggestions and the share ledger. */
export function RowSkeleton({ count = 8, avatar = 56 }: { count?: number; avatar?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.personRow}>
          <Skeleton circle width={avatar} height={avatar} />
          <View style={styles.personText}>
            <Skeleton width="46%" height={13} style={styles.line} />
            <Skeleton width="30%" height={11} style={styles.line} />
            <Skeleton width="62%" height={10} style={styles.line} />
          </View>
          <Skeleton width={78} height={32} style={styles.buttonStub} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  /* LiveRail's own frame: the plate, the seam the feed puts under every row,
     12pt crown and root padding. */
  rail: { paddingTop: space.md, paddingBottom: space.md, marginBottom: FEED_GAP },
  railLabel: { marginHorizontal: FEED_GUTTER, marginBottom: space.sm2 },
  railDash: { marginBottom: space.sm2, marginHorizontal: FEED_GUTTER },
  railRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: FEED_GUTTER },
  railCell: { width: 78, alignItems: 'center' },
  /* Two lines under the avatar, like the real cell's name + @handle — one
     line here left the rail ~20pt short of what replaced it. */
  railName: { marginTop: space.md },
  railHandle: { marginTop: space.xs2 },
  /* Mirrors the live plate — the same gutters, the same seam, no shadow. */
  card: {
    paddingHorizontal: FEED_GUTTER,
    paddingTop: space.md,
    paddingBottom: space.xs,
    marginBottom: FEED_GAP,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  headText: { flex: 1, gap: space.sm },
  /* Text-shaped blocks take the skeleton setback; the per-corner radii win
     over the primitive's uniform default. */
  line: { ...setback(shape.skeleton) },
  firstLine: { marginTop: space.sm2 },
  nextLine: { marginTop: space.lg },
  media: { marginTop: space.md, marginHorizontal: -FEED_GUTTER },
  ledger: { marginTop: space.md, marginBottom: space.sm2 },
  /* The card is already padded by the gutter, so the shared rule's own
     inset is cancelled here rather than doubled. */
  rule: { marginHorizontal: 0 },
  /* Four equal cells, like the labelled bar that replaces it. */
  bar: { flexDirection: 'row', alignItems: 'center', height: 44, marginHorizontal: -space.sm2 },
  barCell: { flex: 1, alignItems: 'center' },
  /* A follow-button stub is a setback button shape, not a pill. */
  buttonStub: { ...setback(shape.buttonSm) },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { padding: space.xxs },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 84 },
  personText: { flex: 1, gap: space.sm },
})
