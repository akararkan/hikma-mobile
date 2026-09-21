/* =========================================================
   PostTile — one square in the Saved and Liked grids.

   A text-only post still gets a tile. Dropping it would make
   the grid silently disagree with its own count, so the body's
   first line is set over a tinted plate instead — which is also
   the only readable way to show a text post at 124pt.

   Memoized: every caller is a recycled grid row, and the tile
   carries an expo-image. The thumb crossfade is off on purpose —
   a 124pt tile recycles faster than the fade can finish, so the
   transition only ever costs a second live bitmap.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { RemoteImage } from '@/components/media/RemoteImage'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Skeleton, Text, Touchable } from '@/ui'
import { toPlainText } from '@/lib/richtext'
import type { PostView } from './types'

export interface PostTileProps {
  post: PostView | null
  size: number
  /** Taller-than-square cells (the 2-column Saved/Liked grids); square when omitted. */
  height?: number
  /** Rendered while a lazily-hydrated row is still in flight. */
  loading?: boolean
  selected?: boolean
  selectable?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

export const PostTile = React.memo(function PostTile({
  post, size, height, loading, selected, selectable, onPress, onLongPress,
}: PostTileProps) {
  const t = useTheme()
  const c = t.colors
  const h = height ?? size

  if (loading || !post) {
    return (
      <View style={[styles.cell, { width: size, height: h }]}>
        <Skeleton width={size - 2} height={h - 2} radius={2} />
      </View>
    )
  }

  const first = post.media?.[0]
  const thumb = first?.type === 'VIDEO' ? first.poster || null : first?.url || null
  const isVideo = first?.type === 'VIDEO'
  const isVoice = post.type === 'VOICE_POST'

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel="Open post"
      style={[styles.cell, { width: size, height: h }]}
    >
      <View style={[styles.inner, { backgroundColor: c.surfaceSunken }]}>
        {thumb ? (
          /* A dead thumb shows the quiet glyph — moderation can delete an
             asset after publish while the post row survives. */
          <RemoteImage
            source={thumb}
            fallbackIcon="image"
            fallbackIconSize={18}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={thumb}
          />
        ) : (
          <View style={styles.textTile}>
            {isVoice ? <Icon name="mic" size={18} color={c.textFaint} /> : null}
            {/* A body PREVIEW — running text, never the eyebrow transform. */}
            <Text variant="caption" caps={false} tone="secondary" numberOfLines={5} weight="500">
              {toPlainText(post.body).slice(0, 60) || 'Post'}
            </Text>
          </View>
        )}

        {isVideo ? (
          <View style={[styles.glyph, { backgroundColor: c.overlayChip }]}>
            <Icon name="play" size={10} color={c.overlayText} filled />
          </View>
        ) : post.media && post.media.length > 1 ? (
          <View style={[styles.glyph, { backgroundColor: c.overlayChip }]}>
            <Icon name="gallery" size={10} color={c.overlayText} />
          </View>
        ) : null}

        {selectable ? (
          <View
            style={[
              styles.check,
              {
                backgroundColor: selected ? c.accent : c.overlayChip,
                borderColor: c.overlayText,
              },
            ]}
          >
            {selected ? <Icon name="check" size={12} color={c.textOnAccent} /> : null}
          </View>
        ) : null}

        {selected ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft }]} pointerEvents="none" /> : null}
      </View>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  cell: { padding: space.xxs },
  inner: { flex: 1, overflow: 'hidden', borderRadius: 2 },
  textTile: { flex: 1, padding: space.sm, gap: space.xs, justifyContent: 'center' },
  glyph: {
    position: 'absolute',
    top: 5,
    end: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    top: 5,
    start: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
