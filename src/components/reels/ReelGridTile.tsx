/* =========================================================
   The 9:16 grid cell — an author's reels and a sound's
   adopters both draw this.

   The poster is the trap. On a REEL feed row the server's
   cover IS the first VIDEO url, so `media[0].poster` is a
   video file, not an image — handing it to <Image> is a
   guaranteed broken plate. A still reel's url IS an image; a
   video reel only has a real poster once the hydrated read has
   handed us one. Everything else gets the gradient, which is
   why the gradient is a designed state rather than a
   placeholder — and why it is drawn ONLY in that state: under
   a poster it is a shader layer that is painted over on the
   very next pass, thirty of them in a full viewport.

   Legibility over an arbitrary frame is a solid chip per
   overlay, not a text shadow per glyph: a shadow forces an
   offscreen compositing pass for every text node on Android,
   and this cell recycles.

   Handlers take the post, so one function from the caller
   serves every tile and React.memo below can actually hit.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, NumericText, Touchable, formatCount } from '@/ui'
import { PLATE_GRADIENT, STAGE } from './skin'
import { clipUrlOf, isStillReel, type ViewPost } from './types'

export interface ReelGridTileProps {
  post: ViewPost
  width: number
  onPress: (post: ViewPost) => void
  onLongPress?: (post: ViewPost) => void
}

export const ReelGridTile = React.memo(function ReelGridTile({
  post, width, onPress, onLongPress,
}: ReelGridTileProps) {
  const still = isStillReel(post)
  const clip = clipUrlOf(post)
  const poster = post.media?.[0]?.poster
  const image = still ? post.media?.[0]?.url : (poster && poster !== clip ? poster : null)
  const height = Math.round((width * 16) / 9)

  const press = React.useCallback(() => onPress(post), [onPress, post])
  const longPress = React.useCallback(() => onLongPress?.(post), [onLongPress, post])

  return (
    <Touchable
      onPress={press}
      onLongPress={onLongPress ? longPress : undefined}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={post.body ? `Reel: ${post.body.slice(0, 60)}` : 'Reel'}
      style={{ width, height, backgroundColor: STAGE.tile }}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          /* No transition: on a flicked grid the cross-fade never completes
             where anyone can see it, and it keeps a second bitmap alive. */
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : (
        <LinearGradient colors={PLATE_GRADIENT} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      )}

      <View style={styles.badge} pointerEvents="none">
        <Icon name={still ? 'camera' : 'play'} size={11} color={STAGE.fg} filled />
      </View>

      <View style={styles.stat} pointerEvents="none">
        <Icon name="play" size={10} color={STAGE.fg} filled />
        <NumericText variant="caption" color={STAGE.fg}>{formatCount(post.views)}</NumericText>
      </View>
    </Touchable>
  )
})

/** The shimmering cell shown while the first page loads. */
export function ReelGridSkeleton({ width }: { width: number }) {
  const height = Math.round((width * 16) / 9)
  return <View style={{ width, height, backgroundColor: 'rgba(255,255,255,0.08)' }} />
}

/* Both overlays are the same plate: a solid chip in the stage's glass, setback
   like every other chip in the app. */
const chip = {
  ...setback(shape.chip),
  borderCurve: 'continuous',
  backgroundColor: STAGE.glassStrong,
} as const

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: 6, end: 6, ...chip, paddingHorizontal: space.xs2, paddingVertical: space.xs },
  stat: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    ...chip,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
  },
})
