/* =========================================================
   ViewerRow — one person, in the three places this domain
   lists people: the viewer log, a poll's voter list, and the
   close-friends screen.

   It accepts a PLACEHOLDER user ({ full: 'Member', initials:
   '?' }). A profile lookup that failed must still render its
   row: the count came from the server and dropping a row would
   quietly understate it.

   It is a recycled list row, so two things are load-bearing:
   the export is React.memo'd (the viewer log re-renders on
   every hydrate chunk and every realtime tally), and the
   composed gesture is memoized — GestureDetector diffs by
   handler identity and a fresh object re-registers the whole
   config with the native module.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { adapters } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, fireHaptic } from '@/ui'
import { StoryRing } from './StoryRing'
import { ink, night } from './night'

export interface ViewerPerson {
  id: string
  full: string
  handle?: string
  initials?: string
  avc?: string | null
  profileImage?: string | null
}

/** What a failed `api.users.get` renders as. */
export function placeholderPerson(id: string): ViewerPerson {
  return { id, full: 'Member', handle: '', initials: '?', avc: null, profileImage: null }
}

export interface ViewerRowProps {
  user: ViewerPerson
  /** ISO instant — when they viewed, or when they voted. */
  at?: string | null
  trailing?: React.ReactNode
  onPress?: () => void
  /** Reveals a swipe-left action. Omitted → the row does not swipe. */
  onMessage?: () => void
}

const ACTION_W = 76

export const ViewerRow = React.memo(function ViewerRow({
  user, at, trailing, onPress, onMessage,
}: ViewerRowProps) {
  const t = useTheme()
  const x = useSharedValue(0)

  const close = React.useCallback(() => { x.value = withTiming(0, { duration: t.ms(160) }) }, [t, x])

  const message = React.useCallback(() => {
    fireHaptic('light')
    close()
    onMessage?.()
  }, [close, onMessage])

  const swipeable = !!onMessage
  const gesture = React.useMemo(() => {
    const swipe = Gesture.Pan()
      .enabled(swipeable)
      .activeOffsetX([-14, 14])
      .failOffsetY([-10, 10])
      .onUpdate(e => { x.value = Math.min(0, Math.max(-ACTION_W - 24, e.translationX)) })
      .onEnd(e => {
        if (e.translationX < -ACTION_W * 0.55 || e.velocityX < -700) {
          x.value = withSpring(-ACTION_W, { damping: 20, stiffness: 220 })
        } else {
          x.value = withTiming(0, { duration: 160 })
        }
      })

    /* A full swipe past the action commits it, so the gesture can be one motion
       rather than swipe-then-tap. */
    const flingOpen = Gesture.Pan()
      .enabled(swipeable)
      .activeOffsetX([-14, 14])
      .failOffsetY([-10, 10])
      .onEnd(e => { if (e.translationX < -(ACTION_W + 20)) runOnJS(message)() })

    return Gesture.Simultaneous(swipe, flingOpen)
  }, [swipeable, x, message])

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const actionStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, -x.value / ACTION_W) }))

  const body = (
    <Touchable onPress={onPress} feedback="tint" noAutoHitSlop style={[styles.row, { backgroundColor: night.bg }]}>
      <StoryRing
        uri={user.profileImage || null}
        initials={user.initials || adapters.initialsOf(user.full)}
        avc={user.avc || null}
        size={40}
        state="none"
      />
      <View style={styles.names}>
        <Text variant="bodyStrong" color={ink.full} numberOfLines={1}>{user.full}</Text>
        {user.handle ? (
          <Text variant="subhead" color={ink.faint} numberOfLines={1}>@{user.handle}</Text>
        ) : null}
      </View>
      {trailing ?? (at ? <Text variant="caption" color={ink.faint}>{adapters.timeAgo(at)}</Text> : null)}
    </Touchable>
  )

  if (!onMessage) return body

  return (
    <View style={styles.clip}>
      <Animated.View style={[styles.action, { backgroundColor: t.colors.accent }, actionStyle]}>
        <Touchable onPress={message} feedback="dim" noAutoHitSlop style={styles.actionInner} accessibilityLabel="Message">
          <Icon name="chat" size={19} color={ink.full} />
          {/* `micro` caps Latin inside the primitive; the literal stays in
              sentence case so an Arabic or Kurdish string is left alone. */}
          <Text variant="micro" color={ink.full} align="center">Message</Text>
        </Touchable>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={slide}>{body}</Animated.View>
      </GestureDetector>
    </View>
  )
})

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 64, paddingHorizontal: space.lg },
  names: { flex: 1, gap: space.xxs },
  action: { position: 'absolute', top: 0, bottom: 0, end: 0, width: ACTION_W },
  actionInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
})
