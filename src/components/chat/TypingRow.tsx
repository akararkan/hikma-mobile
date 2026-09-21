/* =========================================================
   The typing bubble.

   Three dots on a shared 1200ms loop, offset by index. It sits
   as the last item in the thread list rather than floating over
   it, so the log scrolls it into view the way a real message
   would — a floating indicator hides the newest bubble on a
   short thread.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, shape, space } from '@/theme/tokens'
import { Text } from '@/ui'
import { typingSentence, type Typer } from './format'

function Dot({ index, color }: { index: number; color: string }) {
  const t = useTheme()
  const phase = useSharedValue(0)

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { phase.value = 0.5; return }
    phase.value = withRepeat(
      withTiming(1, { duration: 560, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    return () => cancelAnimation(phase)
  }, [phase, t.prefs.reducedMotion])

  /* One shared clock with a per-dot phase shift, so the three dots stay in a
     fixed relationship instead of drifting apart over minutes. */
  const anim = useAnimatedStyle(() => {
    const shifted = (phase.value + index * 0.28) % 1
    const wave = Math.sin(shifted * Math.PI)
    return { opacity: 0.35 + wave * 0.65, transform: [{ translateY: -wave * 2.5 }] }
  })

  return <Animated.View style={[styles.dot, { backgroundColor: color }, anim]} />
}

export const TypingRow = React.memo(function TypingRow({
  typers, nameOf, isGroup,
}: { typers: Typer[]; nameOf: (id: string) => string; isGroup: boolean }) {
  const t = useTheme()
  if (!typers.length) return null

  return (
    /* polite live region: TalkBack then speaks the sentence when it appears —
       the animated dots are decorative and say nothing. (iOS has no live
       regions; per-keystroke announcements there would be chatter.) */
    <View style={styles.row} accessible accessibilityLiveRegion="polite">
      {/* The incoming bubble's exact chrome — fill, stone course, tail — so
          the indicator reads as the message it is about to become (web
          .ch-typing-bubble). */}
      <View style={[styles.bubble, { backgroundColor: t.colors.bubbleIn, borderColor: t.colors.border }]}>
        {[0, 1, 2].map(i => <Dot key={i} index={i} color={t.colors.textMuted} />)}
      </View>
      {/* The caption is a LIVE signal, so it wears link blue at weight, not
          italic gold — the web's .ch-typing-label under Oxford. */}
      <Text variant="footnote" weight="600" color={t.colors.link} align="ui" numberOfLines={1} style={styles.label}>
        {typingSentence(typers, nameOf, isGroup)}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs2 },
  /* An incoming bubble's own shape: fully crowned, with only the tail-side
     bottom corner squared to the grouped 6 (logical, so RTL mirrors it). */
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.md, height: 30,
    borderWidth: rule.course,
    borderTopStartRadius: shape.bubble.crown,
    borderTopEndRadius: shape.bubble.crown,
    borderBottomStartRadius: shape.bubble.grouped,
    borderBottomEndRadius: shape.bubble.crown,
    borderCurve: 'continuous',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1 },
})
