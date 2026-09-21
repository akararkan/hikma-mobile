/* =========================================================
   The two pieces of motion a call surface needs.

   `Halo` is the expanding ring behind a ringing avatar — the
   only thing on the incoming screen that says "this is
   happening right now" without a word of copy. `RingingDots`
   is the three-dot cadence under the caller's name.

   Both stop dead under reduced motion (`t.ms()` returns 0 and
   the repeat is simply not started), because a permanently
   breathing circle is exactly what that setting exists to
   remove.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text } from '@/ui'
import { ROOM, withAlpha } from '@/components/live/skin'

/** Two concentric rings expanding out from under a circular avatar. */
export function Halo({ size, active = true, color }: { size: number; active?: boolean; color?: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      <HaloRing size={size} delay={0} active={active} color={color} />
      <HaloRing size={size} delay={800} active={active} color={color} />
    </View>
  )
}

function HaloRing({ size, delay, active, color }: { size: number; delay: number; active: boolean; color?: string }) {
  const t = useTheme()
  const p = useSharedValue(0)

  React.useEffect(() => {
    if (!active || t.prefs.reducedMotion) { p.value = 0; return }
    p.value = 0
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false))
    return () => cancelAnimation(p)
  }, [p, delay, active, t.prefs.reducedMotion])

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + p.value * 0.35 }],
    opacity: (1 - p.value) * 0.22,
  }))

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? ROOM.fg,
        },
        anim,
      ]}
    />
  )
}

/** "Ringing" with three dots that fill in turn. */
export function RingingDots({ label = 'Ringing', color }: { label?: string; color?: string }) {
  const t = useTheme()
  const p = useSharedValue(0)
  const fg = color ?? ROOM.fgMuted

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { p.value = 3; return }
    p.value = 0
    p.value = withRepeat(withTiming(3, { duration: 1400, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(p)
  }, [p, t.prefs.reducedMotion])

  return (
    <View style={styles.dotsRow}>
      <Text variant="footnote" color={fg} align="ui">{label}</Text>
      {[0, 1, 2].map(i => <Dot key={i} index={i} progress={p} color={fg} />)}
    </View>
  )
}

function Dot({ index, progress, color }: { index: number; progress: SharedValue<number>; color: string }) {
  const anim = useAnimatedStyle(() => ({
    opacity: progress.value >= index + 1 || progress.value >= 3 ? 1 : 0.25,
  }))
  return <Animated.View style={[styles.dot, { backgroundColor: color }, anim]} />
}

/** The small ripple dot on a RINGING participant tile. */
export function RippleDot({ color }: { color?: string }) {
  const t = useTheme()
  const p = useSharedValue(0)
  const tint = color ?? ROOM.warning

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { p.value = 0; return }
    p.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false)
    return () => cancelAnimation(p)
  }, [p, t.prefs.reducedMotion])

  const wave = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + p.value * 2.4 }],
    opacity: (1 - p.value) * 0.5,
  }))

  return (
    <View style={styles.rippleWrap}>
      <Animated.View style={[styles.rippleCore, { backgroundColor: tint }, wave]} />
      <View style={[styles.rippleCore, { backgroundColor: tint }]} />
    </View>
  )
}

/** A flat, greyed three-bar level meter for a build with no media engine: it
 *  cannot move because there is no audio to measure, and pretending otherwise
 *  would be the one lie the call room refuses. Where the engine IS present the
 *  call room shows the peer connection's real state instead. */
export function DeadLevelMeter() {
  return (
    <View style={styles.meter}>
      {[10, 18, 12].map((h, i) => (
        <View key={i} style={[styles.bar, { height: h, backgroundColor: withAlpha(ROOM.fg, 0.18) }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 3, height: 3, borderRadius: 2, marginTop: space.xxs },
  rippleWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  rippleCore: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
  meter: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, height: 18 },
  bar: { width: 3, borderRadius: 2 },
})
