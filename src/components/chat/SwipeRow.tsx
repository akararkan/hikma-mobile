/* =========================================================
   SwipeRow — the inbox's two-sided swipe.

   Chat needs both directions with two actions each, which the
   activity list's single-sided helper does not cover. The
   mechanics that matter:

     · the panes are laid out in the drag's own direction, so a
       right-to-left drag reveals Archive nearest the finger
     · one haptic when the full-swipe threshold is crossed, and
       the release fires the OUTERMOST action rather than
       parking the row open — a swipe that stops half-open is a
       gesture the user has to finish twice
     · `overshootFriction` stays loose enough that the row can
       actually be pulled past its panes; clamp it and the
       threshold is unreachable and the full swipe silently
       never fires
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import ReanimatedSwipeable, {
  SwipeDirection, type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { layout, space } from '@/theme/tokens'
import { Icon, Text, Touchable, fireHaptic, type IconName } from '@/ui'

export interface SwipeAction {
  key: string
  label: string
  icon: IconName
  /** A resolved palette colour — the caller owns the role → colour choice. */
  tint: string
  onTrigger: () => void
}

export interface SwipeRowProps {
  children: React.ReactNode
  /** Revealed by a left-to-right drag (pin / read). */
  leading?: SwipeAction[]
  /** Revealed by a right-to-left drag (archive / delete). */
  trailing?: SwipeAction[]
  enabled?: boolean
  /** The row's item identity. A recycled cell keeps this component instance
   *  but swaps the item under it — without snapping the swipe state shut, a
   *  half-open row A resurfaces wearing row B's content. */
  resetKey?: string
}

/* One action pane. Wider than `tapTarget` on purpose: this is a thumb
   travelling sideways at speed, not a considered tap, and 72 matches the
   row's own height so a two-action rail reads as a square pair. */
const PANE = layout.rowHeight
/** The pane's icon. Sized against `micro` beneath it, not against the tap
 *  target — the whole pane is the target. */
const ACTION_ICON = 19

function Pane({
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
  /* The PREPARE clause returns the crossing BOOLEAN, not the raw translation:
     reanimated only invokes the reaction when the prepared value changes, so
     the JS thread is crossed exactly twice per swipe (arm, disarm) instead of
     once per frame — the per-frame runOnJS flood was the swipe lag. */
  useAnimatedReaction(
    () => (direction === 'trailing' ? -translation.value : translation.value) > threshold,
    (past, prev) => {
      if (past !== prev) runOnJS(onArm)(past)
    },
    [threshold, direction],
  )

  return (
    <View style={styles.pane}>
      {actions.map(a => (
        <Touchable
          key={a.key}
          onPress={() => onPress(a)}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel={a.label}
          style={[styles.action, { backgroundColor: a.tint }]}
        >
          <Icon name={a.icon} size={ACTION_ICON} color={t.colors.textOnAccent} />
          <Text variant="micro" color={t.colors.textOnAccent} align="center" numberOfLines={1}>{a.label}</Text>
        </Touchable>
      ))}
    </View>
  )
}

export function SwipeRow({ children, leading = [], trailing = [], enabled = true, resetKey }: SwipeRowProps) {
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
     the row that just moved in. */
  React.useEffect(() => {
    armedTrailing.current = false
    armedLeading.current = false
    firing.current = false
    if (fireTimer.current) { clearTimeout(fireTimer.current); fireTimer.current = null }
    ref.current?.reset()
  }, [resetKey])

  React.useEffect(() => () => { if (fireTimer.current) clearTimeout(fireTimer.current) }, [])

  const arm = (slot: React.RefObject<boolean>, weight: 'warning' | 'light') => (on: boolean) => {
    if (slot.current === on) return
    slot.current = on
    if (on) fireHaptic(weight)
  }

  const fire = React.useCallback((action: SwipeAction) => {
    /* Once per gesture: a full swipe's release fires through
       onSwipeableWillOpen, and a stray tap on the pane during the close
       animation must not run the action a second time. */
    if (firing.current) return
    firing.current = true
    ref.current?.close()
    /* Let the row settle before the list mutates under it, or the closing
       animation runs against a cell that has already been recycled. */
    fireTimer.current = setTimeout(() => {
      fireTimer.current = null
      firing.current = false
      action.onTrigger()
    }, 120)
  }, [])

  if (!enabled || (!leading.length && !trailing.length)) return <>{children}</>

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      overshootFriction={4}
      rightThreshold={PANE * 0.6}
      leftThreshold={PANE * 0.6}
      renderRightActions={trailing.length ? (_p, translation) => (
        <Pane
          actions={trailing}
          translation={translation}
          threshold={width * 0.5}
          direction="trailing"
          onArm={arm(armedTrailing, 'warning')}
          onPress={fire}
        />
      ) : undefined}
      renderLeftActions={leading.length ? (_p, translation) => (
        <Pane
          actions={leading}
          translation={translation}
          threshold={width * 0.42}
          direction="leading"
          onArm={arm(armedLeading, 'light')}
          onPress={fire}
        />
      ) : undefined}
      onSwipeableWillOpen={direction => {
        /* RNGH reports the DIRECTION OF TRAVEL, not the pane: a right-to-left
           drag (the trailing actions) arrives as LEFT. */
        if (direction === SwipeDirection.LEFT && armedTrailing.current) {
          armedTrailing.current = false
          fire(trailing[trailing.length - 1])
        } else if (direction === SwipeDirection.RIGHT && armedLeading.current) {
          armedLeading.current = false
          fire(leading[leading.length - 1])
        }
      }}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

const styles = StyleSheet.create({
  pane: { flexDirection: 'row' },
  action: {
    width: PANE,
    minHeight: layout.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
})
