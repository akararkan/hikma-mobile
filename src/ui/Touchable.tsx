/* =========================================================
   Touchable — the press primitive everything else is built on.

   RN's Pressable gives you a callback and nothing else. This
   adds the three things every tappable surface in the app
   needs and would otherwise re-implement:

     · a press response (letterpress seat, dim, or a ripple)
     · haptics, gated on the user's accessibility setting
     · an automatic hit-slop when the visual target is under
       the 44pt minimum

   Oxford press (DESIGN.md §7): a pressed plate scales to
   0.98 at motion.instant while the OWNING component swaps its
   fill to the pressed role (accent → accentPressed; the dark
   scheme brightens). The fill swap lives with whoever knows
   the resting role.

   TWO BODIES, ONE DOOR. There are ~700 Touchables in the app
   and about half of them ask for 'tint' (a native ripple) or
   'none' (the owner animates its own plate — Button, Chip,
   IconButton all do). Those render no animation here, so they
   must not pay for one: `Touchable` picks a body by feedback
   and PlainPressable allocates no shared value, registers no
   UI-thread mapper and mounts no Animated wrapper. Ten feed
   rows used to carry ~70 mappers that existed only to be torn
   down on recycle.

   Hooks stay unconditional because the branch is a component
   boundary, not an `if` inside one — and the branch is decided
   ONCE per instance and frozen (see THE LATCH below), because
   a body swap changes the element type at that position and
   React would tear the whole row subtree down and rebuild it.
   ========================================================= */
import React from 'react'
import {
  Pressable, type PressableProps, type StyleProp, type ViewStyle, type LayoutChangeEvent,
} from 'react-native'
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { prefersHaptics } from '@/theme/prefs'
import { layout, motion } from '@/theme/tokens'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/* Masonry — fast arrival, dead stop. The seat drops and returns crisply;
   nothing about a letterpress floats. */
const masonry = Easing.bezier(...motion.out)

/* Drive the press value. Module scope on purpose: the shared value is a
   stable box, and writing to it from out here keeps the memoized handlers
   below free of a mutation the hook lint has to reason about. Exported for
   Button/IconButton, which own their own plate value and drive it the same
   way — not part of the '@/ui' surface.

   ASYMMETRIC ON PURPOSE (§7): the way IN is a crisp timing at
   motion.instant — feedback must land the frame the finger does — but the
   way OUT rides motion.spring, so letting go reads as the plate easing
   back rather than snapping off. Callers pass a t.ms()'d duration; 0 means
   reduced motion, and BOTH directions collapse to a clean cut — a spring
   is never left running for a user who asked for stillness. */
export function seat(sv: SharedValue<number>, to: 0 | 1, duration: number) {
  if (duration === 0) { sv.value = to; return }
  sv.value = to === 1
    ? withTiming(1, { duration, easing: masonry })
    : withSpring(0, motion.spring)
}

/* Value names are frozen API — dozens of call sites use them.
     'scale' = the plate response, and it no longer scales: it renders the
               letterpress seat (plates are NEVER scaled — DESIGN.md §8.2;
               icons that shrink 0.92 do so in their own components).
     'dim'   = opacity fade for inline text/icon actions, not plates.
     'tint'  = ripple; rows keep it (settings lists, inboxes).            */
export type PressFeedback = 'scale' | 'dim' | 'tint' | 'none'
export type HapticKind = 'light' | 'medium' | 'heavy' | 'select' | 'success' | 'warning' | 'error' | false

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  feedback?: PressFeedback
  haptic?: HapticKind
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  /** Skip the automatic hit-slop measurement (grid cells, full-bleed rows). */
  noAutoHitSlop?: boolean
  /** Block the press without the `alpha.disabled` wash. For owners that
   *  distinguish BUSY from DEAD — Button's in-flight state is not disabled
   *  even though it must refuse taps, and fading it (spinner included) to
   *  38% made a submitting button look broken. */
  noDisabledDim?: boolean
}

/** Fire a haptic, honouring accessibility.hapticFeedback. Exported because
 *  gestures (swipe-to-reply, long-press menus) need it outside a press. */
export function fireHaptic(kind: HapticKind = 'light') {
  if (!kind || !prefersHaptics()) return
  try {
    if (kind === 'select') void Haptics.selectionAsync()
    else if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    else if (kind === 'warning') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    else if (kind === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    else {
      void Haptics.impactAsync(
        kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy
          : kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light,
      )
    }
  } catch { /* a missing haptic engine must never break a tap */ }
}

/* The door. `scale`/`dim` animate; `tint`/`none` do not and take the body
   that owns no reanimated state at all.

   THE LATCH — FROZEN AT MOUNT, NOT RATCHETED. A dozen call sites compute
   feedback from state (`onPress ? 'dim' : 'none'`,
   `row.deepLink || selectionMode ? 'tint' : 'scale'`), and swapping the
   element TYPE at this position unmounts and remounts the whole subtree —
   every Avatar, expo-image and Icon under it — which is the exact cost the
   two bodies exist to avoid. A one-way ratchet still pays it once per
   instance, and inside a recycled FlashList cell it pays it on the first
   recycle from a deep-link row onto a plain one, and again for every row on
   screen when selection mode ends.

   So the choice is made ONCE, from the first feedback this instance ever
   saw, and never revisited. Both bodies answer correctly for all four
   values afterwards: PressablePlate's worklet is inert for 'tint'/'none'
   and still fires the ripple, and PlainPressable renders the seat/dim
   through Pressable's own style callback (RN only tracks pressed state when
   `style` is a function, so the ~350 non-animating call sites pay nothing
   for the fallback). Neither body ever re-mounts. */
export function Touchable(props: TouchableProps) {
  const feedback = props.feedback ?? 'scale'
  const [plate] = React.useState(() => feedback === 'scale' || feedback === 'dim')
  return plate ? <PressablePlate {...props} /> : <PlainPressable {...props} />
}

/* ---------------------------------------------------------
   Shared by both bodies: the auto hit-slop measurement and
   the haptic-then-onPress hop. Living in a hook keeps each
   body's hook order fixed and the two behaviours identical.
   --------------------------------------------------------- */
function usePressBasics(
  onLayout: TouchableProps['onLayout'],
  noAutoHitSlop: boolean | undefined,
  hitSlop: TouchableProps['hitSlop'],
  onPress: TouchableProps['onPress'],
  haptic: HapticKind,
) {
  const [slop, setSlop] = React.useState<number | undefined>(undefined)
  /* Only call sites that can grow need to hear about layout at all; the ~375
     `noAutoHitSlop` uses get no listener attached unless they asked for one. */
  const measure = !noAutoHitSlop && hitSlop === undefined

  const handleLayout = React.useCallback((e: LayoutChangeEvent) => {
    onLayout?.(e)
    if (!measure) return
    const { width, height } = e.nativeEvent.layout
    const short = Math.min(width, height)
    /* Grow the touch area up to the platform minimum, never shrink it. */
    if (short > 0 && short < layout.tapTarget) {
      setSlop(Math.ceil((layout.tapTarget - short) / 2))
    }
  }, [onLayout, measure])

  const handlePress = React.useCallback((e: any) => {
    if (haptic) fireHaptic(haptic)
    onPress?.(e)
  }, [haptic, onPress])

  return {
    slop: hitSlop ?? slop,
    layoutHandler: measure || onLayout ? handleLayout : undefined,
    handlePress,
  }
}

/* ---------------------------------------------------------
   PlainPressable — 'tint' (native ripple) and 'none' (the
   owner animates its own plate). No shared value, no mapper,
   no Animated wrapper: a Pressable and nothing else.

   It also answers for a LATER 'scale'/'dim', because the door
   above freezes its choice at mount and a call site may flip
   its feedback afterwards. That case renders the same
   letterpress seat / fade through Pressable's style callback.
   RN only allocates pressed state when `style` is a function
   (Pressable.js: `shouldUpdatePressed`), so the common path
   below keeps the plain memoized array and costs nothing.
   --------------------------------------------------------- */
function PlainPressable({
  feedback, haptic = false, style, children,
  onPressIn, onPressOut, onPress, onLayout,
  noAutoHitSlop, hitSlop, disabled, noDisabledDim, ...rest
}: TouchableProps) {
  const t = useTheme()
  const { slop, layoutHandler, handlePress } = usePressBasics(onLayout, noAutoHitSlop, hitSlop, onPress, haptic)

  const animates = feedback === 'scale' || feedback === 'dim'
  const dim = disabled && !noDisabledDim

  const flat = React.useMemo(
    () => [style, dim ? { opacity: t.alpha.disabled } : null],
    [style, dim, t.alpha.disabled],
  )
  const responsive = React.useCallback(
    ({ pressed }: { pressed: boolean }) => [
      style,
      /* Same values as PressablePlate's worklet: 0.98 scale, 0.58 fade. */
      pressed ? (feedback === 'dim' ? { opacity: 0.58 } : { transform: [{ scale: 0.98 }] }) : null,
      dim ? { opacity: t.alpha.disabled } : null,
    ],
    [style, feedback, dim, t.alpha.disabled],
  )
  const composed = animates ? responsive : flat

  const ripple = React.useMemo(
    () => (feedback === 'tint' ? { color: t.colors.ripple, foreground: true } : undefined),
    [feedback, t.colors.ripple],
  )

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={slop}
      onLayout={layoutHandler}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={handlePress}
      android_ripple={ripple}
      style={composed}
      {...rest}
    >
      {children}
    </Pressable>
  )
}

/* ---------------------------------------------------------
   PressablePlate — the animated body. 'scale' seats the plate
   1pt (it does NOT scale — the value name is frozen API);
   'dim' fades inline text/icon actions.

   It also answers for 'tint'/'none', because the latch above
   can hand a latched instance a feedback it no longer
   animates. In that case the worklet is inert and the ripple
   comes back, so the two bodies stay behaviourally identical
   for every value.
   --------------------------------------------------------- */
function PressablePlate({
  feedback = 'scale', haptic = false, style, children,
  onPressIn, onPressOut, onPress, onLayout,
  noAutoHitSlop, hitSlop, disabled, noDisabledDim, ...rest
}: TouchableProps) {
  const t = useTheme()
  const pressed = useSharedValue(0)
  const { slop, layoutHandler, handlePress } = usePressBasics(onLayout, noAutoHitSlop, hitSlop, onPress, haptic)

  const anim = useAnimatedStyle(() => {
    const p = pressed.value
    /* Oxford press: a quiet scale to 0.98 — the pressed-role fill swap
       that completes the effect belongs to the owning component. */
    if (feedback === 'scale') return { transform: [{ scale: 1 - p * 0.02 }] }
    if (feedback === 'dim') return { opacity: 1 - p * 0.42 }
    return {}
  }, [feedback])

  const ripple = React.useMemo(
    () => (feedback === 'tint' ? { color: t.colors.ripple, foreground: true } : undefined),
    [feedback, t.colors.ripple],
  )

  /* In at instant, out on the house spring — seat() owns the asymmetry.
     t.ms() cuts to 0 under reduced motion, so both directions degrade to
     a snap, never a float. */
  const duration = t.ms(motion.instant)

  /* Memoized so the Pressable's props stop churning on every parent render —
     `pressed` is a stable shared value and stays out of the dep lists. */
  const handlePressIn = React.useCallback((e: any) => {
    seat(pressed, 1, duration)
    onPressIn?.(e)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  }, [duration, onPressIn])
  const handlePressOut = React.useCallback((e: any) => {
    seat(pressed, 0, duration)
    onPressOut?.(e)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  }, [duration, onPressOut])

  const dim = disabled && !noDisabledDim
  const composed = React.useMemo(
    () => [style, anim, dim ? { opacity: t.alpha.disabled } : null],
    [style, anim, dim, t.alpha.disabled],
  )

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={slop}
      onLayout={layoutHandler}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      android_ripple={ripple}
      style={composed}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  )
}

/** A full-width row that ripples instead of seating — settings lists, inboxes,
 *  anything where a letterpress drop would look like the row detached from
 *  the list. Rows are not plates; they keep the ripple. */
export function TouchableRow(props: TouchableProps) {
  return <Touchable feedback="tint" noAutoHitSlop {...props} />
}
