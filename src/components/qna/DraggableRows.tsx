/* =========================================================
   Long-press drag reordering for short, fixed-height lists.

   Deliberately NOT virtualized: sources and attachments are
   counted in tens, and a drag gesture inside a recycling list
   has to fight the recycler for the row it is holding. A plain
   mapped list with absolute-free transforms is both simpler
   and correct here.

   The gesture activates after a long press so a normal scroll
   still scrolls — the same rule the rest of the app's
   long-press menus use.
   ========================================================= */
import React from 'react'
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { fireHaptic } from '@/ui'

export interface DraggableRowsProps<T> {
  items: T[]
  keyOf: (item: T) => string
  rowHeight: number
  onReorder: (from: number, to: number) => void
  renderItem: (item: T, index: number) => React.ReactNode
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function DraggableRows<T>({
  items, keyOf, rowHeight, onReorder, renderItem, disabled, style,
}: DraggableRowsProps<T>) {
  const active = useSharedValue(-1)
  const target = useSharedValue(-1)
  const dragY = useSharedValue(0)
  const count = items.length

  return (
    <View style={style}>
      {items.map((item, index) => (
        <DragRow
          key={keyOf(item)}
          index={index}
          count={count}
          rowHeight={rowHeight}
          active={active}
          target={target}
          dragY={dragY}
          onReorder={onReorder}
          disabled={disabled}
        >
          {renderItem(item, index)}
        </DragRow>
      ))}
    </View>
  )
}

function DragRow({
  index, count, rowHeight, active, target, dragY, onReorder, disabled, children,
}: {
  index: number
  count: number
  rowHeight: number
  active: { value: number }
  target: { value: number }
  dragY: { value: number }
  onReorder: (from: number, to: number) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const gesture = React.useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(220)
    .onStart(() => {
      active.value = index
      target.value = index
      dragY.value = 0
      runOnJS(fireHaptic)('medium')
    })
    .onUpdate(e => {
      dragY.value = e.translationY
      const shift = Math.round(e.translationY / rowHeight)
      target.value = Math.max(0, Math.min(count - 1, index + shift))
    })
    .onEnd(() => {
      const from = active.value
      const to = target.value
      active.value = -1
      target.value = -1
      dragY.value = 0
      if (from >= 0 && to >= 0 && from !== to) runOnJS(onReorder)(from, to)
    }), [index, count, rowHeight, disabled, onReorder, active, target, dragY])

  const anim = useAnimatedStyle(() => {
    if (active.value === index) {
      return { transform: [{ translateY: dragY.value }, { scale: 1.02 }], zIndex: 10, opacity: 0.97 }
    }
    if (active.value < 0) return { transform: [{ translateY: withTiming(0, { duration: 140 }) }], zIndex: 0, opacity: 1 }
    const from = active.value
    const to = target.value
    let shift = 0
    if (from < to && index > from && index <= to) shift = -rowHeight
    else if (from > to && index < from && index >= to) shift = rowHeight
    return { transform: [{ translateY: withTiming(shift, { duration: 140 }) }], zIndex: 0, opacity: 1 }
  })

  /* No lift shadow. QELAT has none (DESIGN.md §8.2) — `t.shadow()` already
     flattens to {} for the legacy call sites, so the second useAnimatedStyle
     was a UI-thread mapper per row that computed nothing. The held row reads
     as held through the 1.02 scale and the 0.97 opacity above. */
  /* A long-press drag is unreachable with VoiceOver/TalkBack — the screen
     reader owns the touch, so the pan never activates and reordering would
     simply not exist for a reader. The custom actions are the whole
     alternative path (there is no up/down button on any of the four screens
     that mount this), so they must move the row themselves. */
  const onAccessibilityAction = React.useCallback((e: AccessibilityActionEvent) => {
    if (disabled) return
    const to = e.nativeEvent.actionName === 'moveUp' ? index - 1 : index + 1
    if (to >= 0 && to < count) onReorder(index, to)
  }, [disabled, index, count, onReorder])

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={anim}
        accessibilityActions={ROW_ACTIONS}
        onAccessibilityAction={onAccessibilityAction}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
}

/** Module scope so the prop stays reference-stable across drag frames. */
const ROW_ACTIONS = [
  { name: 'moveUp', label: 'Move up' },
  { name: 'moveDown', label: 'Move down' },
]

/** Pure array move — the optimistic half of a reorder. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice()
  const [row] = out.splice(from, 1)
  out.splice(to, 0, row)
  return out
}
