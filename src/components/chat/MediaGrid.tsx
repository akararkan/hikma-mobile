/* =========================================================
   The attachment grid inside a bubble.

   One image keeps its own aspect ratio (a portrait photo
   letterboxed into a square is the single most common way a
   chat client looks cheap); two or more collapse into a square
   mosaic so a run of bubbles keeps one rhythm.

   `GET /api/v1/media/**` is PUBLIC and honours Range, so
   expo-image needs no auth plumbing and expo-video can seek.
   URLs arrive relative and the adapters have already run them
   through assetUrl().
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { RemoteImage } from '@/components/media/RemoteImage'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Spinner, Text, Touchable } from '@/ui'
import { durationLabel } from './format'

export interface MediaGridProps {
  media: any[]
  onPress?: (index: number) => void
  maxWidth: number
  radius?: number
  /** An optimistic send in flight: the tiles dim under one spinner. The wire
   *  reports no byte progress on the multipart path (MOBILE_GUIDE §upload),
   *  so indeterminate is the honest ceiling — before this there was NOTHING
   *  on the media itself, only the meta row's clock glyph. */
  pending?: boolean
  style?: StyleProp<ViewStyle>
}

const GUTTER = 2
const MAX_SINGLE_HEIGHT = 320

function Tile({
  item, width, height, radius, onPress, overflow, label, fade,
}: {
  item: any
  width: number
  height: number
  radius: number
  onPress?: () => void
  overflow?: number
  label?: string
  /** Cross-fade in. Off on mosaic cells: at 130pt inside a recycled row the
   *  fade is churn the reader never sees complete, and it keeps a second
   *  decoded bitmap alive for its duration. */
  fade?: boolean
}) {
  const t = useTheme()
  const uri = item?.thumbnailUrl || item?.url
  const isVideo = item?.kind === 'VIDEO'

  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={item?.altText || (isVideo ? 'Video' : 'Photo')}
      style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken }}
    >
      {/* A 404 is a placeholder, never a page error — and it can happen to a
          URL that WAS valid: a review-band image a moderator rejects is
          deleted while the message row survives. RemoteImage renders the same
          quiet glyph for a missing URL and a dead one. */}
      <RemoteImage
        source={uri}
        fallbackIcon="image"
        fallbackIconSize={20}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={fade ? 140 : 0}
        cachePolicy="memory-disk"
        recyclingKey={String(item?.storageKey || uri)}
      />

      {isVideo ? (
        <>
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <View style={[styles.play, { backgroundColor: t.colors.overlayChip }]}>
              <Icon name="play" size={20} color={t.colors.overlayText} filled />
            </View>
          </View>
          {item?.durationMs ? (
            <View style={[styles.durationChip, { backgroundColor: t.colors.overlayChip }]} pointerEvents="none">
              <Text variant="micro" color={t.colors.overlayText}>{durationLabel(item.durationMs)}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {overflow ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.colors.overlayBg }]} pointerEvents="none">
          <Text variant="title2" color={t.colors.overlayText} align="center">+{overflow}</Text>
        </View>
      ) : null}

      {label ? (
        <View style={[styles.durationChip, { backgroundColor: t.colors.overlayChip }]} pointerEvents="none">
          <Text variant="micro" color={t.colors.overlayText}>{label}</Text>
        </View>
      ) : null}
    </Touchable>
  )
}

export function MediaGrid({ media, onPress, maxWidth, radius = 14, pending, style }: MediaGridProps) {
  const t = useTheme()
  const items = (media || []).filter(m => m?.kind === 'IMAGE' || m?.kind === 'VIDEO')
  if (!items.length) return null

  /* One veil over the whole grid, not per tile — the send is one act. */
  const veil = pending ? (
    <View
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.colors.overlayChip }]}
      pointerEvents="none"
    >
      <Spinner color={t.colors.overlayText} />
    </View>
  ) : null

  if (items.length === 1) {
    const m = items[0]
    const ratio = m.width && m.height ? m.width / m.height : 4 / 3
    const height = Math.min(MAX_SINGLE_HEIGHT, Math.round(maxWidth / Math.max(0.5, Math.min(2.2, ratio))))
    return (
      <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
        {/* The single image is the one surface where the fade is perceptible. */}
        <Tile item={m} width={maxWidth} height={height} radius={radius} fade onPress={onPress ? () => onPress(0) : undefined} />
        {veil}
      </View>
    )
  }

  const cell = Math.floor((maxWidth - GUTTER) / 2)
  const shown = items.slice(0, 4)
  const overflow = items.length - shown.length

  return (
    <View style={[styles.grid, { width: maxWidth, borderRadius: radius, overflow: 'hidden' }, style]}>
      {shown.map((m, i) => (
        <Tile
          key={String(m.storageKey || m.url || i)}
          item={m}
          width={cell}
          height={cell}
          radius={0}
          onPress={onPress ? () => onPress(i) : undefined}
          overflow={i === shown.length - 1 && overflow > 0 ? overflow : undefined}
        />
      ))}
      {/* Three tiles leave a hole; a filler keeps the mosaic square. */}
      {shown.length === 3 ? <View style={{ width: cell, height: cell }} /> : null}
      {veil}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER },
  center: { alignItems: 'center', justifyContent: 'center' },
  /* Icon-only play plate — a sanctioned circle. */
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  /* Text-bearing overlay chip — chip setback, overlayChip plate, overlay ink.
     Chrome on media is a solid plate; QELAT never blurs. */
  durationChip: {
    position: 'absolute', bottom: 6, start: 6, paddingHorizontal: space.xs2, paddingVertical: space.xxs,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
})
