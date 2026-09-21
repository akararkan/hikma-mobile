/* =========================================================
   NewPostsPill — the FEED_NEW_POST hint made visible.

   A ranked feed can never blind-prepend: insertion position is
   a server decision, and splicing a row in at the top would put
   it somewhere the next page's cursor does not agree with. So
   the hint only ever produces this pill, and the pill only ever
   scrolls to top and refetches page 1.
   ========================================================= */
import React from 'react'
import { StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'

export interface NewPostsPillProps {
  visible: boolean
  /** Hints seen since the last refresh; > 1 pluralises. */
  count?: number
  onPress: () => void
  /** Distance from the top of the screen — the header's own height. */
  top: number
}

export function NewPostsPill({ visible, count = 0, onPress, top }: NewPostsPillProps) {
  const t = useTheme()
  const c = t.colors
  const y = useSharedValue(-24)
  const opacity = useSharedValue(0)

  React.useEffect(() => {
    if (t.prefs.reducedMotion) {
      y.value = 0
      opacity.value = visible ? 1 : 0
      return
    }
    y.value = visible ? withSpring(0, t.motion.spring) : withTiming(-24, { duration: t.ms(t.motion.fast) })
    opacity.value = withTiming(visible ? 1 : 0, { duration: t.ms(t.motion.fast) })
  }, [visible, y, opacity, t])

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }))

  if (!visible) return null

  return (
    <Animated.View
      style={[styles.host, { top: top + 8, zIndex: t.zIndex.sticky }, anim]}
      pointerEvents="box-none"
    >
      <Touchable
        onPress={onPress}
        feedback="scale"
        haptic="light"
        accessibilityLabel="Show new posts"
        /* A button setback, not a pill — pills are reserved for unread
           counters and LIVE (DON'T #9). No shadow: depth is drawn (law 2). */
        style={[styles.pill, { backgroundColor: c.accent, ...setback(t.shape.buttonSm), borderCurve: 'continuous' }]}
      >
        <Icon name="up" size={14} color={c.textOnAccent} />
        <Text variant="footnote" weight="600" color={c.textOnAccent}>
          {count > 1 ? `${count > 99 ? '99+' : count} new posts` : 'New posts'}
        </Text>
      </Touchable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 34, paddingHorizontal: space.md2 },
})
