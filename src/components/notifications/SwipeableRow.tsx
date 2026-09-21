/* =========================================================
   Swipe actions for the inbox and the activity list.

   ReanimatedSwipeable has no full-swipe concept of its own —
   it opens to the actions' width and stops. So the threshold
   is watched on the UI thread by the action panel itself:
   crossing it fires one haptic and arms the gesture, and the
   release (`onSwipeableWillOpen`) runs the destructive action
   instead of parking the row open.

   THE FEEL, and why each number is what it is:
   · friction 1 — the row tracks the finger 1:1. The old 1.6
     made every swipe move 60% slower than the hand that made
     it, which read as lag, not weight.
   · overshootFriction 1.2 — the row can be pulled well past
     the panel with barely any resistance, so the full-swipe
     threshold is actually reachable inside one comfortable
     thumb stroke. Clamp it harder and the threshold sits
     beyond where a finger can go, so the full swipe silently
     never fires — which is exactly what it used to feel like.
   · The panel fills the whole row and wears the full-swipe
     action's colour, so an overshoot never tears a gap of
     bare wallpaper open between the row edge and the actions
     (the iOS Mail grammar: the destructive colour follows the
     row wherever the finger takes it).
   · The action slots CASCADE in — each one slides from the
     screen edge at its own rate while the row is dragged, on
     the UI thread, off the translation shared value.
   · Crossing the threshold ARMS the row: the other slots
     dissolve and the panel is all one colour — the full-swipe
     action's — with a haptic. Backing off disarms it the same
     way. That is the "will it fire?" answer the old panel
     kept secret until release.

   Memoized, but note what that does and does not buy: `children`
   is a fresh element on every renderItem call, so the memo only
   holds while the LIST's renderItem identity holds. That is the
   real win and it lives at the call site — see the useCallback
   in (app)/notifications.tsx.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, {
  useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming,
  runOnJS, type SharedValue,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, fireHaptic, type IconName } from '@/ui'

export interface SwipeAction {
  label: string
  icon: IconName
  /** A resolved palette colour — the caller owns the role→colour choice. */
  tint: string
  onTrigger: () => void
}

export interface SwipeableRowProps {
  children: React.ReactNode
  leading?: SwipeAction | null
  trailing?: SwipeAction[]
  /** Fraction of the screen width past which the last trailing action fires. */
  fullSwipeRatio?: number
  leadingFullSwipeRatio?: number
  enabled?: boolean
  onSwipeStart?: () => void
  /** The row's item identity. A recycled cell keeps this component instance
   *  but swaps the item under it — without snapping the swipe state shut, a
   *  half-open row A resurfaces wearing row B's content. */
  resetKey?: string
}

const ACTION_WIDTH = 76

/** One action slot. Its own component because the cascade is a hook, and a
 *  hook cannot live inside a map over a variable-length array. */
function ActionSlot({
  action, index, count, direction, translation, armedSv, fadeSv, isFireAction, onPress,
}: {
  action: SwipeAction
  index: number
  count: number
  direction: 'leading' | 'trailing'
  translation: SharedValue<number>
  armedSv: SharedValue<number>
  /** 1 at rest → 0 while armed. Animated by the panel's reaction, exactly
   *  once per flip — never here. This style also tracks the per-frame
   *  translation, and an animation CREATED inside it is re-created (and so
   *  restarted) on every frame of the drag: the dissolve crawled toward its
   *  target instead of snapping, which read as "the background colour
   *  changes late". A plain read of a pre-animated value cannot lag. */
  fadeSv: SharedValue<number>
  /** The slot the full swipe fires — it never fades, and it pulses on arm. */
  isFireAction: boolean
  onPress: (a: SwipeAction) => void
}) {
  const t = useTheme()
  const panelW = count * ACTION_WIDTH
  /* How far this slot hides toward the screen edge while the row is closed.
     The edge-most slot travels furthest, so the slots peel in as a cascade
     rather than sitting parked where the row will eventually stop. */
  const stagger = direction === 'trailing' ? (index + 1) / count : (count - index) / count

  const slide = useAnimatedStyle(() => {
    const revealed = Math.min(Math.abs(translation.value), panelW)
    /* Sign from the gesture itself, not from I18n arithmetic: whichever way
       the row went, the hidden offset points back toward the edge it came
       from. translation < 0 is a trailing drag in LTR — panel on the right,
       slots hide to the right — and every other combination follows. */
    const sign = translation.value < 0 ? 1 : -1
    return {
      transform: [{ translateX: sign * (panelW - revealed) * stagger }],
      /* Armed: everything but the firing slot dissolves into the panel's own
         colour (which IS the firing action's), so the whole revealed area
         reads as one button about to go. */
      opacity: isFireAction ? 1 : fadeSv.value,
    }
  }, [panelW, stagger, isFireAction])

  const pulse = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(armedSv.value ? 1.12 : 1, { damping: 30, stiffness: 320, mass: 0.8 }) }],
  }), [])

  return (
    <Animated.View style={[styles.slot, { backgroundColor: action.tint }, slide]}>
      <Touchable
        onPress={() => onPress(action)}
        feedback="dim"
        noAutoHitSlop
        accessibilityLabel={action.label}
        style={styles.slotPress}
      >
        <Animated.View style={[styles.slotContent, isFireAction ? pulse : null]}>
          <Icon name={action.icon} size={20} color={t.colors.textOnAccent} />
          {/* A verb, not an eyebrow — "Read", never "READ". */}
          <Text variant="caption" caps={false} weight="600" color={t.colors.textOnAccent} align="center">{action.label}</Text>
        </Animated.View>
      </Touchable>
    </Animated.View>
  )
}

/** The panel is a component rather than an inline render so the threshold
 *  watcher is a hook on something that mounts and unmounts with the panel. */
function ActionPanel({
  actions, translation, threshold, direction, onArm, onPress,
}: {
  actions: SwipeAction[]
  translation: SharedValue<number>
  threshold: number
  direction: 'leading' | 'trailing'
  onArm: (on: boolean) => void
  onPress: (a: SwipeAction) => void
}) {
  const t = useTheme()
  /* The full swipe fires the LAST trailing action (or the one leading action),
     and the panel wears its colour so an overshoot is that action stretching,
     never a gap. */
  const fireIndex = direction === 'trailing' ? actions.length - 1 : 0
  const fireTint = actions[fireIndex]?.tint
  const fadeMs = t.ms(100)

  const armedSv = useSharedValue(0)
  const fadeSv = useSharedValue(1)
  /* The PREPARE clause returns the crossing BOOLEAN, not the raw translation:
     reanimated only invokes the reaction when the prepared value changes, so
     the JS thread is crossed exactly twice per swipe (arm, disarm) instead of
     once per frame — the per-frame runOnJS flood was the swipe lag.

     The dissolve is ANIMATED HERE, once per flip, and the slots only read the
     result. Born inside the slot's own animated style it was re-created every
     frame (that style tracks the drag), which restarted the timing animation
     sixty times a second — the colour change arrived late and mushy instead
     of the instant the finger crossed the line. */
  useAnimatedReaction(
    () => (direction === 'trailing' ? -translation.value : translation.value) > threshold,
    (past, prev) => {
      if (past !== prev) {
        armedSv.value = past ? 1 : 0
        fadeSv.value = withTiming(past ? 0 : 1, { duration: fadeMs })
        runOnJS(onArm)(past)
      }
    },
    [threshold, direction, fadeMs],
  )

  /* The panel stays exactly its natural width — RNGH measures the open
     position from a marker laid out right after this element, so a panel that
     grabbed the whole row would park the row fully off-screen. The BLEED
     layer is what fills an overshoot instead: anchored to the panel's outer
     edge and extended far toward the row's centre, it rides under the slots
     and the row, and only ever shows in the gap a hard pull opens up. */
  const bleed = direction === 'trailing' ? { start: -600, end: 0 } : { start: 0, end: -600 }
  return (
    <View style={styles.panel}>
      <View style={[styles.bleed, bleed, { backgroundColor: fireTint }]} />
      {actions.map((a, i) => (
        <ActionSlot
          key={a.label}
          action={a}
          index={i}
          count={actions.length}
          direction={direction}
          translation={translation}
          armedSv={armedSv}
          fadeSv={fadeSv}
          isFireAction={i === fireIndex}
          onPress={onPress}
        />
      ))}
    </View>
  )
}

export const SwipeableRow = React.memo(function SwipeableRow({
  children, leading, trailing = [], fullSwipeRatio = 0.45, leadingFullSwipeRatio = 0.35,
  enabled = true, onSwipeStart, resetKey,
}: SwipeableRowProps) {
  const { width } = useWindowDimensions()
  const ref = React.useRef<SwipeableMethods>(null)

  /* Refs, not state: arming happens mid-gesture and a re-render there drops
     frames on the very animation being watched. */
  const armedTrailing = React.useRef(false)
  const armedLeading = React.useRef(false)
  const fireTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const firing = React.useRef(false)

  /* Recycling: same instance, new item. Snap shut (no animation) and drop any
     in-flight trigger — a timer armed for the OLD item must not fire against
     the row that just moved in, which was the swipe-to-dismiss crash. */
  React.useEffect(() => {
    armedTrailing.current = false
    armedLeading.current = false
    firing.current = false
    if (fireTimer.current) { clearTimeout(fireTimer.current); fireTimer.current = null }
    ref.current?.reset()
  }, [resetKey])

  React.useEffect(() => () => { if (fireTimer.current) clearTimeout(fireTimer.current) }, [])

  const armTrailing = React.useCallback((on: boolean) => {
    if (armedTrailing.current === on) return
    armedTrailing.current = on
    if (on) fireHaptic('warning')
  }, [])

  const armLeading = React.useCallback((on: boolean) => {
    if (armedLeading.current === on) return
    armedLeading.current = on
    if (on) fireHaptic('light')
  }, [])

  const fire = React.useCallback((action: SwipeAction) => {
    /* Once per gesture: a full swipe's release fires through
       onSwipeableWillOpen, and a stray tap on the pane during the close
       animation must not run the action a second time. */
    if (firing.current) return
    firing.current = true
    ref.current?.close()
    /* One beat, not a pause: the close animation must have STARTED before the
       list mutates under it (a mutation on the same frame runs the closing
       spring against a recycled cell), but every extra millisecond here is
       lag the user reads on the row itself — a full-swiped "Read" keeps its
       unread tint until this fires. 60ms is two frames of settling. */
    fireTimer.current = setTimeout(() => {
      fireTimer.current = null
      firing.current = false
      action.onTrigger()
    }, 60)
  }, [])

  if (!enabled || (!leading && !trailing.length)) return <>{children}</>

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1}
      rightThreshold={ACTION_WIDTH * 0.5}
      leftThreshold={ACTION_WIDTH * 0.5}
      /* 1 — zero resistance past the panel too. The row tracks the finger
         exactly everywhere; the bleed layer keeps the overshoot painted, and
         the arm threshold does the "are you sure" work resistance used to
         pretend to do. */
      overshootFriction={1}
      renderRightActions={trailing.length ? (_p, translation) => (
        <ActionPanel
          actions={trailing}
          translation={translation}
          threshold={width * fullSwipeRatio}
          direction="trailing"
          onArm={armTrailing}
          onPress={fire}
        />
      ) : undefined}
      renderLeftActions={leading ? (_p, translation) => (
        <ActionPanel
          actions={[leading]}
          translation={translation}
          threshold={width * leadingFullSwipeRatio}
          direction="leading"
          onArm={armLeading}
          onPress={fire}
        />
      ) : undefined}
      onSwipeableOpenStartDrag={onSwipeStart}
      onSwipeableWillOpen={direction => {
        /* RNGH reports the DIRECTION OF TRAVEL, not the panel: a right-to-left
           drag (the trailing actions) arrives as LEFT. */
        if (direction === SwipeDirection.LEFT && armedTrailing.current) {
          armedTrailing.current = false
          fire(trailing[trailing.length - 1])
        } else if (direction === SwipeDirection.RIGHT && armedLeading.current && leading) {
          armedLeading.current = false
          fire(leading)
        }
      }}
    >
      {children}
    </ReanimatedSwipeable>
  )
})

const styles = StyleSheet.create({
  /* Natural width (slots only) — the measurement contract above. Overflow
     stays visible so the bleed can escape toward the row's centre. */
  panel: { flexDirection: 'row' },
  bleed: { position: 'absolute', top: 0, bottom: 0 },
  slot: { width: ACTION_WIDTH },
  slotPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slotContent: { alignItems: 'center', gap: space.xs },
})
