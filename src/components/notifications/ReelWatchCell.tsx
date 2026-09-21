/* =========================================================
   One 9:16 cell of the watched-reels grid.

   The progress bar renders only when `durationSeconds` is a
   positive number: the field is nullable, and a missing
   duration painting a full bar would claim the user finished
   something they may have skipped after two seconds.

   Memoized, and the broken-thumb flag is keyed BY ID rather
   than held as a boolean: FlashList hands this same mounted
   cell to the next reel, and a bare `broken` boolean would
   follow it there and blank a poster that loads fine.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { clockTime } from './constants'
import type { ReelWatch } from './types'

export const ReelWatchCell = React.memo(function ReelWatchCell({
  item, width, poster, onPress, onLongPress,
}: {
  item: ReelWatch
  width: number
  /** The clip's poster, hydrated by the screen — the watch ledger itself
   *  carries only the reel's id (activity/reels.tsx explains why). */
  poster?: string | null
  onPress: (item: ReelWatch) => void
  onLongPress: (item: ReelWatch) => void
}) {
  const t = useTheme()
  const c = t.colors
  const [brokenId, setBrokenId] = React.useState<string | null>(null)
  const broken = brokenId === item.id

  const thumb = item.thumb || poster || null

  const progress = item.durationSeconds && item.durationSeconds > 0
    ? Math.min(1, Math.max(0, item.watchedSeconds / item.durationSeconds))
    : null

  return (
    <Touchable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={400}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`${item.title || 'Reel'}. Watched ${clockTime(item.watchedSeconds)}`}
      style={[styles.cell, { width, height: width * (16 / 9), backgroundColor: c.surfaceSunken }]}
    >
      {thumb && !broken ? (
        <Image
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          /* No cross-fade on a grid tile: at this size the reader never sees
             one complete, and it keeps a second bitmap alive per recycle. */
          recyclingKey={item.id}
          cachePolicy="memory-disk"
          onError={() => setBrokenId(item.id)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Icon name="videoOff" size={22} color={c.textFaint} />
        </View>
      )}

      <LinearGradient
        colors={['transparent', c.overlayBg] as const}
        style={styles.scrim}
        pointerEvents="none"
      />

      {/* Chrome on media is a solid plate, never a shadowed glyph. */}
      <View style={[styles.chip, { backgroundColor: c.overlayChip }]} pointerEvents="none">
        <Icon name="play" size={11} color={c.overlayText} filled />
        <Text variant="caption" color={c.overlayText} align="ui">
          {clockTime(item.watchedSeconds)}
        </Text>
      </View>

      {progress !== null ? (
        <View style={[styles.track, { backgroundColor: withAlpha(c.overlayText, 0.25) }]} pointerEvents="none">
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: c.overlayText }]} />
        </View>
      ) : null}
    </Touchable>
  )
})

const styles = StyleSheet.create({
  cell: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
  chip: {
    position: 'absolute',
    start: 6,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  fill: { height: 2 },
})
