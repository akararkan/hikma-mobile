/* =========================================================
   The three-way switch over the pager.

   @/ui's SegmentedControl is scheme-aware — it paints a light
   track and near-black labels, which is unreadable over video.
   This is the same control expressed in the stage's fixed
   white ramp, with a sliding rule instead of a filled pill so
   nothing occludes the frame behind it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Text, Touchable, fireHaptic } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { STAGE, TEXT_SHADOW } from './skin'

const RULE_WIDTH = 18

export interface ReelTopTabsProps<T extends string> {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

export function ReelTopTabs<T extends string>({ options, value, onChange }: ReelTopTabsProps<T>) {
  const t = useTheme()
  const index = Math.max(0, options.findIndex(o => o.value === value))
  const [widths, setWidths] = React.useState<number[]>(() => options.map(() => 0))
  const slide = useSharedValue(0)

  /* The rule is centred under a segment, so its offset is the sum of every
     segment before it plus half of this one — which needs real measurements,
     because "Following" is a third wider than "Latest". */
  const offset = React.useMemo(() => {
    let x = 0
    for (let i = 0; i < index; i++) x += widths[i] ?? 0
    return x + (widths[index] ?? 0) / 2 - RULE_WIDTH / 2
  }, [index, widths])

  React.useEffect(() => {
    slide.value = withTiming(offset, { duration: t.ms(180) })
  }, [offset, slide, t])

  const rule = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }))

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {options.map((o, i) => {
          const active = o.value === value
          return (
            <Touchable
              key={o.value}
              onPress={() => { if (!active) { fireHaptic('select'); onChange(o.value) } }}
              feedback="dim"
              noAutoHitSlop
              accessibilityState={{ selected: active }}
              style={styles.tab}
              onLayout={e => {
                const w = e.nativeEvent.layout.width
                setWidths(prev => (prev[i] === w ? prev : prev.map((v, j) => (j === i ? w : v))))
              }}
            >
              <Text
                variant="subhead"
                weight={active ? '700' : '500'}
                color={active ? STAGE.fg : STAGE.fgMuted}
                align="center"
                style={TEXT_SHADOW}
              >
                {o.label}
              </Text>
            </Touchable>
          )
        })}
      </View>
      <Animated.View style={[styles.rule, rule]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  tab: { paddingHorizontal: space.md, height: 32, justifyContent: 'center' },
  rule: { width: RULE_WIDTH, height: 2, borderRadius: 1, backgroundColor: STAGE.fg, marginTop: space.xxs },
})
