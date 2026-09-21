/* =========================================================
   The sound chip under a reel's caption.

   Two honest fallbacks it has to make, because a feed row
   carries no audio metadata at all: before the full read lands
   every reel looks like "Original audio", and a reel whose
   added track will not load says so rather than pretending the
   silence is deliberate.

   The marquee only runs when the label actually overflows —
   a scrolling title that fits is motion for its own sake.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { useReduceMotion } from './ReelOverlayLayer'
import { STAGE } from './skin'

export interface SoundTickerProps {
  name: string
  coverUrl?: string | null
  /** Draw the disclosure chevron — the pill leads somewhere. */
  linked?: boolean
  playing: boolean
  failed?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

export function SoundTicker({
  name, coverUrl, linked, playing, failed, onPress, onLongPress,
}: SoundTickerProps) {
  const t = useTheme()
  const still = useReduceMotion()
  const spin = useSharedValue(0)
  const slide = useSharedValue(0)
  const [boxW, setBoxW] = React.useState(0)
  const [textW, setTextW] = React.useState(0)

  const label = failed ? 'Sound unavailable' : (name || 'Original audio')

  React.useEffect(() => {
    if (!playing || still || failed) { cancelAnimation(spin); return }
    spin.value = 0
    spin.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(spin)
  }, [spin, playing, still, failed])

  const overflow = textW > 0 && boxW > 0 && textW > boxW
  React.useEffect(() => {
    if (!overflow || still || !playing) { cancelAnimation(slide); slide.value = 0; return }
    const distance = textW - boxW + 8
    slide.value = 0
    slide.value = withRepeat(
      withTiming(1, { duration: Math.max(2200, distance * 55), easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    return () => cancelAnimation(slide)
  }, [slide, overflow, textW, boxW, still, playing])

  const discStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }))
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -slide.value * Math.max(0, textW - boxW + 8) }],
  }))

  const body = (
    <View style={[styles.pill, failed ? styles.pillWarn : null]}>
      <Animated.View style={[styles.disc, discStyle]}>
        {/* The pager recycles the card this sits in, so the disc has to be told
            which sound it is showing — without the recyclingKey the previous
            reel's art stays on the spindle until the new one decodes. */}
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.discImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={coverUrl}
          />
        ) : (
          <Icon name="music" size={11} color="rgba(255,255,255,0.9)" />
        )}
      </Animated.View>

      <View style={styles.viewport} onLayout={e => setBoxW(e.nativeEvent.layout.width)}>
        <Animated.View style={slideStyle}>
          <Text
            variant="caption"
            weight="600"
            color={failed ? STAGE.warn : 'rgba(255,255,255,0.95)'}
            numberOfLines={1}
            style={styles.label}
            onLayout={e => setTextW(e.nativeEvent.layout.width)}
          >
            {label}
          </Text>
        </Animated.View>
      </View>

      {linked && !failed ? (
        <Icon name={t.isRTL ? 'back' : 'forward'} size={11} color="rgba(255,255,255,0.6)" />
      ) : null}
    </View>
  )

  if (!onPress && !onLongPress) return body
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={`Sound: ${label}`}
      style={styles.tap}
    >
      {body}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  tap: { alignSelf: 'flex-start', maxWidth: '100%' },
  pill: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingStart: space.xs2,
    paddingEnd: space.sm2,
    /* A chip, not a pill (DESIGN.md §8.9) — the spinning disc inside it keeps
       its circle, because that IS a record. */
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  pillWarn: { backgroundColor: 'rgba(217,167,90,0.22)' },
  disc: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  discImg: { width: 18, height: 18 },
  /* The viewport clips; the label inside it is free to be wider. */
  viewport: { flexShrink: 1, maxWidth: 190, overflow: 'hidden' },
  label: { flexShrink: 0 },
})
