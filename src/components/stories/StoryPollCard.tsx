/* =========================================================
   StoryPollCard — the in-viewer poll.

   Two states, and which one you get is not a preference:

     · a viewer who has not voted sees two buttons and no
       numbers, because showing the tally first is how you get
       a poll that measures the leader rather than the room
     · the author, and anyone who has voted, sees the bars

   Percentages are computed with total 0 → both 0%, and the
   bars animate to their new width so a pushed tally reads as
   movement rather than a jump.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { Icon, Text, Touchable } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { FILL, POLL_A, POLL_B, day, withAlpha } from './night'
import type { StoryPoll, Tally } from './storyVisual'

export interface StoryPollCardProps {
  poll: StoryPoll
  tally: Tally
  myChoice: 'A' | 'B' | null
  isAuthor: boolean
  busy?: boolean
  onVote: (choice: 'A' | 'B') => void
  style?: StyleProp<ViewStyle>
}

export function StoryPollCard({ poll, tally, myChoice, isAuthor, busy, onVote, style }: StoryPollCardProps) {
  const total = Math.max(0, tally.voteA) + Math.max(0, tally.voteB)
  const results = isAuthor || myChoice != null
  const pctA = total ? Math.round((tally.voteA / total) * 100) : 0
  const pctB = total ? 100 - pctA : 0

  return (
    <View style={[styles.card, { backgroundColor: withAlpha(day.bg, 0.94) }, style]}>
      <Text variant="title3" color={day.text} align="center" numberOfLines={3}>{poll.question}</Text>

      <View style={{ gap: space.sm2, marginTop: space.md2 }}>
        {(['A', 'B'] as const).map(choice => {
          const label = choice === 'A' ? poll.optionA : poll.optionB
          const pct = choice === 'A' ? pctA : pctB
          const mine = myChoice === choice
          const leading = results && total > 0 && (choice === 'A' ? tally.voteA >= tally.voteB : tally.voteB > tally.voteA)

          if (!results) {
            return (
              <Touchable
                key={choice}
                onPress={() => onVote(choice)}
                disabled={busy}
                haptic="light"
                feedback="scale"
                noAutoHitSlop
                style={[styles.option, { borderColor: withAlpha(day.text, 0.12) }]}
              >
                <Text variant="headline" color={day.text} align="center" numberOfLines={1}>{label}</Text>
              </Touchable>
            )
          }

          return (
            <Touchable
              key={choice}
              onPress={() => { if (!isAuthor && !mine) onVote(choice) }}
              disabled={busy || isAuthor || mine}
              feedback={isAuthor || mine ? 'none' : 'scale'}
              noAutoHitSlop
              style={[styles.result, { backgroundColor: withAlpha(day.text, 0.06) }]}
            >
              <Fill pct={pct} color={choice === 'A' ? POLL_A : POLL_B} />
              <Text
                variant="headline"
                weight={leading ? '800' : '600'}
                color={day.text}
                align="ui"
                numberOfLines={1}
                style={styles.resultLabel}
              >
                {label}
              </Text>
              {mine ? <Icon name="checkCircle" size={15} color={day.text} filled /> : null}
              <Text variant="callout" weight="700" color={day.text} style={{ marginStart: space.xs2 }}>{pct}%</Text>
            </Touchable>
          )
        })}
      </View>

      {results ? (
        <Text variant="footnote" color={day.textMuted} align="center" style={{ marginTop: space.md }}>
          {total === 1 ? '1 vote' : `${total} votes`}
        </Text>
      ) : null}
    </View>
  )
}

/** The bar. Animated so a live tally moves rather than teleports. */
function Fill({ pct, color }: { pct: number; color: string }) {
  const t = useTheme()
  /* Resolved OUTSIDE the worklet: t.ms is a plain JS function, and calling it
     inside useDerivedValue is a synchronous remote call on the UI runtime —
     the "[Worklets] Tried to synchronously call a Remote Function" crash. */
  const duration = t.ms(300)
  const target = useDerivedValue(() => withTiming(pct, { duration }), [pct, duration])
  /* Clip-translate, not an animated width: the fill carries borderRadius 12, so
     scaleX would stretch its cap into an oval as the tally moves. FILL is
     already position-absolute on all four edges, so the plate is container-width
     and a PERCENTAGE translateX resolves against its own box — which is the same
     box — giving the exact geometry the width animation drew, with no onLayout
     to thread through and no layout pass per frame. `result` above already sets
     overflow:'hidden', which is what clips the overhang.
     Anchored to physical left in both directions, exactly as `left: 0` + a
     percentage width did — this is not the place to start flipping for RTL. */
  const anim = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(100, target.value))
    return { transform: [{ translateX: `${-(100 - p)}%` as const }] }
  })
  return <Animated.View style={[FILL, { backgroundColor: withAlpha(color, 0.45), borderRadius: 12 }, anim]} />
}

const styles = StyleSheet.create({
  card: { ...setback(shape.card), borderCurve: 'continuous', padding: space.lg },
  option: {
    height: 52,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md2,
  },
  result: {
    height: 52,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md2,
    gap: space.xs2,
  },
  resultLabel: { flex: 1 },
})
