/* =========================================================
   StoryProgressBar — the segmented clock at the top.

   Purely presentational: the owner drives `progress` with
   withTiming/cancelAnimation and this reads it inside a
   worklet, so the bar never crosses the bridge. A progress bar
   animated from JS is the first thing to stutter when a video
   decodes, which is exactly when it is being watched.

   TWO THINGS make it read well over a photograph, and both are
   easy to get wrong:

   · ONLY THE ACTIVE SEGMENT ANIMATES. A done segment is full
     and a future one is empty — neither depends on `progress`,
     so neither subscribes to it. Giving every segment an
     animated style put N worklets on the UI thread recomputing
     an unchanging width on every frame; with a ten-frame story
     that is nine wasted recomputations per frame, on the same
     thread that has to keep the fill gliding.

   · THE TRACK IS DARK, NOT WHITE-ON-WHITE. White at low alpha
     over a bright photo disappears, which leaves the fill with
     nothing to travel along and the viewer with no idea how
     many frames are left. A dark trough reads on any picture,
     and the white fill sits on it at full strength.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { BLACK, ink, withAlpha } from './night'

export interface StoryProgressBarProps {
  count: number
  index: number
  progress: SharedValue<number>
  style?: StyleProp<ViewStyle>
}

/** The trough: black rather than dim white, so a segment stays visible on a
 *  snow-white frame. Paired with a hair of white to keep it from reading as a
 *  hole punched in the picture. */
const TRACK = withAlpha(BLACK, 0.32)
const TRACK_EDGE = withAlpha(ink.full, 0.22)

export function StoryProgressBar({ count, index, progress, style }: StoryProgressBarProps) {
  const n = Math.max(1, count)
  return (
    <View style={[styles.row, style]} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => (
        i === index
          ? <ActiveSegment key={i} progress={progress} />
          : <StaticSegment key={i} done={i < index} />
      ))}
    </View>
  )
}

/** Done or upcoming — a plain view, deliberately not animated. */
function StaticSegment({ done }: { done: boolean }) {
  return (
    <View style={[styles.track, { backgroundColor: TRACK, borderColor: TRACK_EDGE }]}>
      {done ? <View style={[styles.fill, styles.full, { backgroundColor: ink.full }]} /> : null}
    </View>
  )
}

/** The one segment whose fill is live.
 *
 *  CLIP-TRANSLATE, not scaleX. Both are composited — either one keeps the
 *  animated property off layout, which is the whole reason this is not a
 *  `width` — but the fill is a capsule, and scaleX squashes a capsule's cap
 *  into an oval that narrows as the story starts. So the fill is laid out at
 *  full width with its radius intact and simply SLID sideways; the track's
 *  `overflow: 'hidden'` eats the overhang and its own radius draws the start
 *  cap. The next person will want to "simplify" this back into a one-line
 *  scaleX — that is the regression, not the simplification. */
function ActiveSegment({ progress }: { progress: SharedValue<number> }) {
  /* Travel is PHYSICAL, so it has to be told which side "the beginning" is on
     — the row itself mirrors in RTL, but a transform does not. */
  const rtl = useTheme().isRTL
  /* A translate is POINTS, never a percentage, so the segment has to measure
     itself. One onLayout per story frame is one layout pass total, against the
     per-frame relayout an animated width would have cost. */
  const w = useSharedValue(0)
  const fill = useAnimatedStyle(() => {
    const travel = (1 - Math.min(1, Math.max(0, progress.value))) * w.value
    return {
      /* Before the first onLayout there is no distance to slide, and an
         un-slid fill is a FULL bar — so stay invisible until the width lands.
         It costs nothing: a segment only becomes active at progress 0, where
         the fill is empty anyway. */
      opacity: w.value > 0 ? 1 : 0,
      transform: [{ translateX: rtl ? travel : -travel }],
    }
  })
  return (
    <View
      style={[styles.track, { backgroundColor: TRACK, borderColor: TRACK_EDGE }]}
      onLayout={e => { w.value = e.nativeEvent.layout.width }}
    >
      <Animated.View style={[styles.fill, styles.full, { backgroundColor: ink.full }, fill]} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  /* A meter, so capsule ends are sanctioned — no text rides on it. 3pt reads
     at arm's length without becoming a stripe across the photograph. */
  track: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  /* The radius SURVIVES here — keeping the leading cap round under motion is
     the entire reason the active segment slides instead of scaling. */
  fill: { height: '100%', borderRadius: 999 },
  /* Full width, then slid out of frame; the direction is decided per-instance
     because it depends on the reading direction. */
  full: { width: '100%' },
})
