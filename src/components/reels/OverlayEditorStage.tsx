/* =========================================================
   The composer's editable twin of ReelOverlayLayer.

   The single rule that makes overlays portable: EVERY gesture
   writes back NORMALISED numbers against the media rect —

     x = (px - rect.left) / rect.width
     y = (py - rect.top)  / rect.height
     s = fontSize / rect.width

   — never raw pixels. The editor stage is 9:16, the viewer's
   card is the phone's aspect, and a clip is fitted `cover`
   while a photo is `contain`: four different rectangles. Store
   pixels and the sticker lands somewhere else on every other
   handset.

   Selection is by INDEX because an authored item has no id on
   the wire; deleting therefore clears the selection rather
   than trying to follow a row that just shifted.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { COLORS, MAX_ITEMS, cleanItem, mediaRect } from '@/lib/reelOverlay'
import { Icon, Text, fireHaptic } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { overlayFaceStyle, overlayPlateStyle, type OverlayItem } from './ReelOverlayLayer'
import { STAGE } from './skin'

/* The face table is the layer's own `overlayFamily` — one resolver, so the
   editor preview cannot drift from the render (the reason the old copy gave
   for existing, which the copy itself defeated). */

/** Anything released inside this band of the stage's bottom edge is deleted. */
const TRASH_BAND = 96

export interface OverlayEditorStageProps {
  items: OverlayItem[]
  setItems: (next: OverlayItem[]) => void
  fit: 'cover' | 'contain'
  mediaW: number
  mediaH: number
  box: { width: number; height: number }
  selected: number | null
  onSelect: (index: number | null) => void
  onEditText: (index: number) => void
  maxItems?: number
  /** Fires on drag start/end so an owner can clear its own chrome out of the
   *  trash band — the story composer's bottom bar sits exactly over it. */
  onDraggingChange?: (dragging: boolean) => void
  /** Height of owner chrome covering the stage's bottom edge. The trash disc
   *  floats above it and the delete band grows to match, so "drop on the can"
   *  and "the can you can see" stay the same thing. */
  trashInset?: number
}

export function OverlayEditorStage({
  items, setItems, fit, mediaW, mediaH, box, selected, onSelect, onEditText, maxItems = MAX_ITEMS,
  onDraggingChange, trashInset = 0,
}: OverlayEditorStageProps) {
  const rect = mediaRect(box as any, mediaW, mediaH, fit)
  const [overTrash, setOverTrash] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const trashBand = TRASH_BAND + trashInset

  const handleDragChange = React.useCallback((v: boolean) => {
    setDragging(v)
    onDraggingChange?.(v)
  }, [onDraggingChange])

  const commit = React.useCallback((index: number, next: Partial<OverlayItem>) => {
    setItems(items.map((it, i) => (i === index ? (cleanItem({ ...it, ...next }) as OverlayItem) ?? it : it)))
  }, [items, setItems])

  const drop = React.useCallback((index: number) => {
    setItems(items.filter((_, i) => i !== index))
    onSelect(null)
    fireHaptic('warning')
  }, [items, setItems, onSelect])

  return (
    <>
      {/* Tapping empty stage deselects — the only way out of a selection that
          does not require hitting a 28px handle. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {items.slice(0, maxItems).map((item, index) => (
          <EditableItem
            key={index}
            item={item}
            index={index}
            rect={rect}
            stageHeight={box.height}
            trashBand={trashBand}
            selected={selected === index}
            onSelect={onSelect}
            onEditText={onEditText}
            onCommit={commit}
            onDrop={drop}
            onDragChange={handleDragChange}
            onTrashChange={setOverTrash}
          />
        ))}
      </View>

      {dragging ? (
        <View style={[styles.trash, { bottom: 22 + trashInset }, overTrash ? styles.trashHot : null]} pointerEvents="none">
          <Icon name="trash" size={24} color={STAGE.fg} />
        </View>
      ) : null}
    </>
  )
}

function EditableItem({
  item, index, rect, stageHeight, trashBand, selected, onSelect, onEditText, onCommit, onDrop, onDragChange, onTrashChange,
}: {
  item: OverlayItem
  index: number
  rect: { left: number; top: number; width: number; height: number }
  stageHeight: number
  trashBand: number
  selected: boolean
  onSelect: (i: number | null) => void
  onEditText: (i: number) => void
  onCommit: (i: number, next: Partial<OverlayItem>) => void
  onDrop: (i: number) => void
  onDragChange: (v: boolean) => void
  onTrashChange: (v: boolean) => void
}) {
  const t = useTheme()
  const dx = useSharedValue(0)
  const dy = useSharedValue(0)
  const sf = useSharedValue(1)
  const dr = useSharedValue(0)
  const lift = useSharedValue(0)
  /* UI-thread mirror of the parent's `overTrash`. The drag itself is pure
     transform, but the trash band is a BOOLEAN that flips at most a couple of
     times per drag — so the bridge gets crossed on the TRANSITION, not on
     every frame the finger moves. Same trick as the swipe-to-reply arm in
     chat/MessageBubble. */
  const overTrash = useSharedValue(false)

  /* The lift is a real animation, so it obeys the reduced-motion fold — and
     `t.ms` is a JS function, unreachable from a worklet, so the numbers are
     resolved here and closed over. */
  const cut = t.ms(1) === 0
  const liftOutMs = t.ms(140)

  const px = rect.left + item.x * rect.width
  const py = rect.top + item.y * rect.height
  const size = Math.max(9, item.s * rect.width)

  const endPan = React.useCallback((tx: number, ty: number) => {
    const droppedY = py + ty
    if (droppedY > stageHeight - trashBand) {
      /* Zero the drag BEFORE the row goes. Items are keyed by index, so the
         one that shifts up into this slot reuses this mounted component and
         would inherit the offset the deleted item was dragged to — it would
         appear parked over the bin it never went near. */
      dx.value = 0
      dy.value = 0
      onDrop(index)
      return
    }
    onCommit(index, {
      x: (px + tx - rect.left) / Math.max(1, rect.width),
      y: (py + ty - rect.top) / Math.max(1, rect.height),
    })
    dx.value = 0
    dy.value = 0
  }, [px, py, rect, stageHeight, trashBand, index, onCommit, onDrop, dx, dy])

  const endPinch = React.useCallback((factor: number) => {
    onCommit(index, { s: item.s * factor })
    sf.value = 1
  }, [index, item.s, onCommit, sf])

  const endRotate = React.useCallback((degrees: number) => {
    onCommit(index, { r: item.r + degrees })
    dr.value = 0
  }, [index, item.r, onCommit, dr])

  /* Five gesture objects per sticker, built ONCE per handler set. A drag flips
     the parent's `dragging` state, which re-renders every sticker on the stage
     — rebuilding these mid-gesture re-registers the whole config with the
     native module while a finger is down. */
  const gesture = React.useMemo(() => {
    const pan = Gesture.Pan()
      .onBegin(() => {
        lift.value = cut ? 1 : withSpring(1, { damping: 14, stiffness: 260 })
        runOnJS(onSelect)(index)
      })
      /* Drag state flips on ACTIVATION, not on touch-down: onBegin fires for
         every tap that will never move, and a parent that hides chrome on
         this flag would blink it on each tap-to-edit. */
      .onStart(() => {
        runOnJS(onDragChange)(true)
      })
      .onUpdate(e => {
        dx.value = e.translationX
        dy.value = e.translationY
        const over = py + e.translationY > stageHeight - trashBand
        if (over !== overTrash.value) { overTrash.value = over; runOnJS(onTrashChange)(over) }
      })
      .onEnd(e => { runOnJS(endPan)(e.translationX, e.translationY) })
      .onFinalize(() => {
        lift.value = cut ? 0 : withTiming(0, { duration: liftOutMs })
        runOnJS(onDragChange)(false)
        /* Unconditional, unlike the per-frame check above: two fingers CAN
           drag two stickers at once, and the parent's flag is shared — one
           hop per drag end is the price of never leaving the can lit. */
        overTrash.value = false
        runOnJS(onTrashChange)(false)
      })

    const pinch = Gesture.Pinch()
      .onBegin(() => { runOnJS(onSelect)(index) })
      .onUpdate(e => { sf.value = e.scale })
      .onEnd(e => { runOnJS(endPinch)(e.scale) })

    const rotate = Gesture.Rotation()
      .onUpdate(e => { dr.value = (e.rotation * 180) / Math.PI })
      .onEnd(e => { runOnJS(endRotate)((e.rotation * 180) / Math.PI) })

    /* Words are for editing: ONE tap on a text opens the tray on it. It used
       to take a double-tap, which nobody discovers — the report reads "when I
       add texts I can not change it". A drag still wins (a pan past its slop
       fails the tap), and glyphs just select. */
    const tap = Gesture.Tap().onEnd((_e, ok) => {
      if (!ok) return
      runOnJS(onSelect)(index)
      if (item.k === 't') runOnJS(onEditText)(index)
    })

    return Gesture.Simultaneous(pan, pinch, rotate, tap)
  }, [
    dx, dy, sf, dr, lift, overTrash, cut, liftOutMs, index, py, stageHeight, trashBand, item.k,
    onSelect, onDragChange, onTrashChange, onEditText, endPan, endPinch, endRotate,
  ])

  const anim = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: sf.value * (1 + lift.value * 0.06) },
      { rotate: `${item.r + dr.value}deg` },
    ],
  }))

  const color = COLORS[item.c] ?? COLORS[0]
  const plate = overlayPlateStyle(item, size)

  return (
    /* The box is the media rect centred on (px, py) — see the note on
       `styles.anchor`. `box-none` so a rect-sized box never steals a touch:
       only the item itself, centred inside it, takes one. */
    <View
      pointerEvents="box-none"
      style={[
        styles.anchor,
        {
          left: px - rect.width / 2,
          top: py - rect.height / 2,
          width: rect.width,
          height: rect.height,
        },
      ]}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.itemBox, anim]}>
          {/* The selection ring sits on the CLIP, so it takes the on-dark
              accent — a navy dashed box on a dark frame is no ring at all. */}
          <View style={selected ? [styles.selection, { borderColor: t.colors.cta }] : undefined}>
            <Text
              variant="body"
              color={color}
              style={[
                /* The shared item style (ReelOverlayLayer) — the stage may not
                   drift a pixel from what the viewer will draw. */
                overlayFaceStyle(item),
                {
                  fontSize: size,
                  lineHeight: size * 1.2,
                  textAlign: item.a === 1 ? 'center' : item.a === 2 ? 'right' : 'left',
                },
                plate ?? styles.shadowed,
              ]}
            >
              {item.text}
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  /* Sized, never 0x0 — the identical trap the viewer's layer documents at
     length (ReelOverlayLayer, styles.anchor): Yoga measures a Text against the
     width it is given, and a zero-width box lays every glyph out to nothing.
     This box is the media rect, centred on the item's point. */
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  itemBox: { alignItems: 'center', justifyContent: 'center' },
  selection: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 6, padding: space.xs },
  shadowed: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  trash: {
    position: 'absolute',
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashHot: { backgroundColor: STAGE.danger },
})
