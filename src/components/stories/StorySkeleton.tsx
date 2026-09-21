/* =========================================================
   Loading shapes that match what lands in their place.

   The design system's <Skeleton> owns the shimmer; only its
   fill is overridden, because these screens are dark in both
   schemes and the palette's skeleton grey is mixed for the
   active one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Skeleton } from '@/ui'
import { ink } from './night'
import { space } from '@/theme/tokens'

const fill = { backgroundColor: ink.fill }

/** A 2:3 poster cell, the shape of every story grid in the domain. */
export function StoryCellSkeleton({ width }: { width: number }) {
  return <Skeleton width={width} height={width * 1.5} radius={14} style={fill} />
}

export function StoryGridSkeleton({ count = 6, columns = 3, gutter = 8, pad = 16, screenWidth }: {
  count?: number; columns?: number; gutter?: number; pad?: number; screenWidth: number
}) {
  const cell = (screenWidth - pad * 2 - gutter * (columns - 1)) / columns
  return (
    <View style={[styles.grid, { paddingHorizontal: pad, gap: gutter }]}>
      {Array.from({ length: count }, (_, i) => <StoryCellSkeleton key={i} width={cell} />)}
    </View>
  )
}

/** The hub's "Your story" card and the manager's stat strip. */
export function StoryCardSkeleton({ height = 96 }: { height?: number }) {
  return <Skeleton height={height} radius={18} style={[fill, { marginHorizontal: space.lg }]} />
}

export function StoryStatStripSkeleton() {
  return (
    <View style={styles.strip}>
      {[0, 1, 2].map(i => <Skeleton key={i} height={64} radius={14} style={[fill, styles.flex]} />)}
    </View>
  )
}

/** The rail on the home feed: story-card plates, one per tile. */
export function StoryRailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.rail}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} width={106} height={188} radius={12} />
      ))}
    </View>
  )
}

/** Viewer / voter rows: avatar, two bars. */
export function StoryRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton circle width={40} height={40} style={fill} />
          <View style={styles.rowLines}>
            <Skeleton width="46%" height={11} style={fill} />
            <Skeleton width="28%" height={10} style={fill} />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  strip: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  flex: { flex: 1 },
  rail: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 64, paddingHorizontal: space.lg },
  rowLines: { flex: 1, gap: space.sm },
})
