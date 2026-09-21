/* =========================================================
   The 64px sound row, shared by the picker and the library.

   No wire row carries useCount — search rows included; only
   /sounds/{id}/usage knows the live counter — so the count
   column renders only when a real number exists rather than
   being printed as a confident zero.

   The row is memoized and every handler takes the sound, so one
   function from the caller serves the whole list — a per-row
   arrow would defeat the memo on every keystroke in the search
   field above it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { Button, Icon, Text, Touchable, formatCount } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useReduceMotion } from './ReelOverlayLayer'
import { PLATE_GRADIENT, STAGE } from './skin'
import { clock, type ViewSound } from './types'

export interface SoundRowProps {
  sound: ViewSound
  previewing: boolean
  failed?: boolean
  showUseCount?: boolean
  trailing: 'use' | 'chevron' | 'none'
  onPress: (sound: ViewSound) => void
  onLongPress?: (sound: ViewSound) => void
  onUse?: (sound: ViewSound) => void
  busy?: boolean
}

export const SoundRow = React.memo(function SoundRow({
  sound, previewing, failed, showUseCount, trailing, onPress, onLongPress, onUse, busy,
}: SoundRowProps) {
  const t = useTheme()
  const subtitle = [sound.artist, sound.duration ? clock(sound.duration) : null].filter(Boolean).join(' · ')

  const press = React.useCallback(() => onPress(sound), [onPress, sound])
  const longPress = React.useCallback(() => onLongPress?.(sound), [onLongPress, sound])
  const use = React.useCallback(() => onUse?.(sound), [onUse, sound])

  return (
    <Touchable
      onPress={press}
      onLongPress={onLongPress ? longPress : undefined}
      feedback="tint"
      noAutoHitSlop
      style={styles.row}
    >
      <View style={styles.cover}>
        {sound.cover ? (
          <Image
            source={{ uri: sound.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            /* Recycled rows otherwise keep the previous sound's art on screen
               until the new one decodes. */
            recyclingKey={sound.id}
          />
        ) : (
          <>
            <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
            <View style={styles.coverGlyph}><Icon name="music" size={18} color={STAGE.fgMuted} /></View>
          </>
        )}
        <View style={styles.coverOverlay}>
          {previewing ? <Equaliser /> : (
            <Icon name="play" size={17} color={failed ? STAGE.fgGhost : STAGE.fg} filled />
          )}
        </View>
        {previewing ? <View style={[styles.progress, { backgroundColor: t.colors.cta }]} /> : null}
      </View>

      <View style={styles.text}>
        <Text variant="subhead" weight="600" color={STAGE.fg} numberOfLines={1}>
          {sound.title || 'Untitled sound'}
        </Text>
        <Text variant="footnote" color={STAGE.fgMuted} numberOfLines={1}>
          {subtitle || 'Unknown artist'}
        </Text>
        {failed ? (
          <Text variant="caption" color={STAGE.warn} numberOfLines={1}>Can&rsquo;t play this preview</Text>
        ) : null}
      </View>

      <View style={styles.trailing}>
        {showUseCount && sound.useCount != null ? (
          <Text variant="caption" color={STAGE.fgFaint}>{formatCount(sound.useCount)} reels</Text>
        ) : null}
        {trailing === 'use' ? (
          <Button label="Use" onPress={use} variant="onDark" size="sm" loading={busy} />
        ) : trailing === 'chevron' ? (
          <Icon name={t.isRTL ? 'back' : 'forward'} size={17} color={STAGE.fgFaint} />
        ) : null}
      </View>
    </Touchable>
  )
})

/** Three bars, because a static play glyph on the row that is currently
 *  sounding gives the user nothing to look at while they decide. */
function Equaliser() {
  const still = useReduceMotion()
  const a = useSharedValue(0.35)
  const b = useSharedValue(0.9)
  const c = useSharedValue(0.6)

  React.useEffect(() => {
    if (still) { a.value = 0.5; b.value = 0.8; c.value = 0.6; return }
    const spin = (v: typeof a, ms: number) => {
      v.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.quad) }), -1, true)
    }
    spin(a, 420); spin(b, 620); spin(c, 520)
    return () => { cancelAnimation(a); cancelAnimation(b); cancelAnimation(c) }
  }, [a, b, c, still])

  /* clip-translate, NOT scaleY. These bars are 3pt wide with a 2pt radius —
     effectively two round caps — and scaling one axis squashes that radius with
     it, so at the bottom of the cycle the caps flatten into corners and the bars
     stop reading as an equaliser. Instead each bar is a full-height 16pt rect
     inside a 16pt clip, slid DOWN by the amount it should be missing. The rect
     keeps its own radius, so the visible top cap stays round at every height,
     and the clip's radius draws the bottom one.

     Either way the point is the same: an animated `height` re-runs layout for
     the row three times a frame, forever, inside a recycled list. A translate
     never touches layout. 12 = the old 16pt max minus the 4pt floor. */
  const s1 = useAnimatedStyle(() => ({ transform: [{ translateY: 12 * (1 - a.value) }] }))
  const s2 = useAnimatedStyle(() => ({ transform: [{ translateY: 12 * (1 - b.value) }] }))
  const s3 = useAnimatedStyle(() => ({ transform: [{ translateY: 12 * (1 - c.value) }] }))

  return (
    <View style={styles.eq}>
      <View style={styles.barClip}><Animated.View style={[styles.bar, s1]} /></View>
      <View style={styles.barClip}><Animated.View style={[styles.bar, s2]} /></View>
      <View style={styles.barClip}><Animated.View style={[styles.bar, s3]} /></View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 64 },
  cover: { width: 48, height: 48, borderRadius: 8, overflow: 'hidden', backgroundColor: STAGE.tile },
  coverGlyph: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  coverOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  progress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2 },
  text: { flex: 1, gap: space.xxs },
  trailing: { alignItems: 'flex-end', gap: space.xs2 },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xxs, height: 16 },
  barClip: { width: 3, height: 16, borderRadius: 2, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, borderRadius: 2, backgroundColor: STAGE.fg },
})
