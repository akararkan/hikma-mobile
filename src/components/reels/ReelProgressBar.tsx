/* =========================================================
   The scrub line.

   2px at rest so it reads as chrome rather than a control;
   6px with a knob and two time labels the moment a finger
   lands on it. Position rides a shared value written straight
   from the transport's time callback, so a 4Hz clock never
   costs a React render — which matters because this component
   sits inside a full-screen video that is already the most
   expensive thing on the page.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { NumericText, Text, fireHaptic } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { STAGE } from './skin'
import { clock } from './types'
import type { Transport } from './transport'

export interface ReelProgressBarProps {
  transport: Transport | null
  /** Fires on touch-down and release so the card can hold its chrome up. */
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** Distance from the bottom of the card — the tab bar lives below it. */
  bottom: number
  width: number
}

export function ReelProgressBar({ transport, onScrubStart, onScrubEnd, bottom, width }: ReelProgressBarProps) {
  const t = useTheme()
  const progress = useSharedValue(0)
  const active = useSharedValue(0)
  const [scrubbing, setScrubbing] = React.useState(false)
  const [labels, setLabels] = React.useState({ at: 0, total: 0 })
  /* The always-on readout ("0:07 / 0:15") next to the line. Its own state,
     not `labels`: the scrub labels are touch-scoped and two-ended, this one
     rides the chrome for the whole play. */
  const [shown, setShown] = React.useState<{ at: number; total: number } | null>(null)
  /* One render per SECOND, not per tick: keyed to the rendered string, the
     same trick the scrub path uses (lastSecond below). */
  const clockKey = React.useRef('')
  const duration = React.useRef(0)
  /* The same number the ref holds, on the UI thread — the pan needs it to decide
     whether a frame is worth waking JS for, and a worklet cannot read a ref. */
  const durationSv = useSharedValue(0)
  const scrubRef = React.useRef(false)
  /* The readout formats to whole seconds, so a render per frame would paint the
     same bytes ~59 times out of 60 — on top of a decoding full-screen video. */
  const lastSecond = React.useRef(-1)
  /* Its UI-thread twin, so the "has the rendered second changed?" test can be
     made BEFORE the hop to JS instead of after arriving. */
  const lastSecondSv = useSharedValue(-1)

  React.useEffect(() => {
    if (!transport) return
    /* Seed the clocks before the first tick: the video's timeUpdate only flows
       while it PLAYS, so a finger that lands on the bar during the load (or on
       a paused reel) used to find duration 0 — the labels froze at 0:00 and
       the release-seek was silently dropped as a dead gesture. */
    const seeded = transport.getDuration()
    if (seeded > 0) { duration.current = seeded; durationSv.value = seeded }
    /* Seed the readout too — a paused or still-loading reel would otherwise
       show nothing until its first tick. Reset the key so a recycled card
       repaints for its new clip. */
    clockKey.current = ''
    setShown(seeded > 0 ? { at: transport.getTime(), total: seeded } : null)
    let lastTickAt = 0
    return transport.onTime((time, total) => {
      duration.current = total
      durationSv.value = total
      /* The readout formats to whole seconds, so it re-renders only when the
         string it would paint changes — ~1Hz against a 4Hz (or per-frame,
         for stills) clock. */
      const key = `${Math.floor(time)}/${Math.round(total)}`
      if (key !== clockKey.current) {
        clockKey.current = key
        setShown({ at: time, total })
      }
      if (scrubRef.current) return
      const f = total > 0 ? Math.min(1, time / total) : 0
      const now = Date.now()
      const coarse = now - lastTickAt > 100
      lastTickAt = now
      /* GLIDE between the video clock's ticks, don't step: expo-video reports
         4×/s, and a line that jumps a quarter-second of width at 4Hz reads as
         stutter over a 60fps picture. A linear tween a shade longer than the
         tick interval keeps the line in continuous motion on the UI thread,
         each tick correcting the drift. The still driver already ticks every
         frame (the cadence check) — tweening those would only add lag.
         Backwards is always a CUT — a loop restart, a seek, a replaced
         source — and tweening it would sweep the line back through time that
         never played. */
      if (f < progress.value) {
        cancelAnimation(progress)
        progress.value = f
      } else if (coarse) {
        progress.value = withTiming(f, { duration: 300, easing: Easing.linear })
      } else {
        progress.value = f
      }
    })
  }, [transport, progress, durationSv])

  const beginScrub = React.useCallback(() => {
    scrubRef.current = true
    setScrubbing(true)
    /* Late metadata: a clip can become seekable AFTER this bar subscribed
       (the subscribe-time seed found 0). Ask again at the moment the finger
       lands, or the whole scrub is dead for no visible reason. */
    if (!duration.current) {
      const d = transport?.getDuration() ?? 0
      if (d > 0) { duration.current = d; durationSv.value = d }
    }
    const at = transport?.getTime() ?? 0
    /* Math.round, matching clock()'s own rounding — the ref has to track the
       rendered string, not the raw time, or the guard skips a tick. */
    lastSecond.current = Math.round(at)
    setLabels({ at, total: duration.current })
    fireHaptic('select')
    onScrubStart?.()
  }, [transport, onScrubStart, durationSv])

  const moveScrub = React.useCallback((fraction: number) => {
    const total = duration.current
    if (total <= 0) return
    const at = fraction * total
    const second = Math.round(at)
    if (second === lastSecond.current) return
    lastSecond.current = second
    setLabels({ at, total })
  }, [])

  const endScrub = React.useCallback((fraction: number) => {
    const total = duration.current
    if (total > 0) transport?.seek(fraction * total)
    scrubRef.current = false
    setScrubbing(false)
    onScrubEnd?.()
  }, [transport, onScrubEnd])

  /* One gesture object per handler set. GestureDetector re-registers the whole
     config natively when the identity changes, and this bar re-renders with
     every card it belongs to. */
  /* Captured in JS — t.ms cannot run inside a worklet. */
  const showMs = t.ms(120)
  const hideMs = t.ms(160)
  const pan = React.useMemo(() => Gesture.Pan()
    .minDistance(0)
    /* The bar is 2px tall; without a generous vertical slop it is unhittable,
       and without the horizontal bias the pager steals every drag. */
    .activeOffsetX([-4, 4])
    .failOffsetY([-24, 24])
    .onBegin(e => {
      active.value = withTiming(1, { duration: showMs })
      progress.value = Math.min(1, Math.max(0, e.x / Math.max(1, width)))
      /* -1 so the first onUpdate always reaches JS, whatever second beginScrub
         put on screen. */
      lastSecondSv.value = -1
      runOnJS(beginScrub)()
    })
    /* The line the finger follows is a shared value, so the drag itself never
       needs JS. What DID need JS every frame was the time readout — and it
       formats to whole seconds, so ~59 hops out of 60 were spent carrying a
       fraction that renders the same string. The guard that used to live inside
       moveScrub now lives here, one side of the bridge earlier; JS is woken
       roughly once a second instead of once a frame.

       Nothing about the seek moved: it was never continuous. moveScrub only ever
       painted labels, and the one and only transport.seek() is still the exact
       final fraction committed in onFinalize below — the finger lands where it
       landed. */
    .onUpdate(e => {
      const f = Math.min(1, Math.max(0, e.x / Math.max(1, width)))
      progress.value = f
      const total = durationSv.value
      if (total <= 0) return
      const second = Math.round(f * total)
      if (second === lastSecondSv.value) return
      lastSecondSv.value = second
      runOnJS(moveScrub)(f)
    })
    .onFinalize(e => {
      active.value = withTiming(0, { duration: hideMs })
      const f = Math.min(1, Math.max(0, e.x / Math.max(1, width)))
      runOnJS(endScrub)(f)
    }), [active, progress, width, durationSv, lastSecondSv, beginScrub, moveScrub, endScrub, showMs, hideMs])

  const track = useAnimatedStyle(() => ({ height: 2 + active.value * 4 }))
  /* scaleX, not width: a transform is composited where an animated width
     relayouts the bar every frame — and this bar lives on top of a full-screen
     decode. The origin is PHYSICAL, so RTL has to be told which end is the
     start; the row does not mirror a transform for us. */
  const origin = t.isRTL ? 'right' : 'left'
  const fill = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(1, Math.max(0, progress.value)) }],
  }))
  /* translateX, not left — the same argument as the fill above, and the card
     already hands us the measured `width`, so nothing has to be guessed. The -6
     that used to be its own transform is just half the knob, folded into the
     one translate; scale still comes after, so it still grows about the knob's
     own centre. Physical travel, deliberately: it matches the `e.x` the pan
     reads, which is what keeps the knob under the finger.
     (In RTL that leaves the knob crossing the bar the opposite way to the fill,
     which mirrors — but that predates this change, and moving the knob to the
     fill's end would tear it off the finger. Worth a separate look.) */
  const knob = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [
      { translateX: progress.value * width - 6 },
      { scale: 0.4 + active.value * 0.6 },
    ],
  }))

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      {scrubbing ? (
        <View style={styles.times}>
          <Text variant="caption" color="#FFFFFF">{clock(labels.at)}</Text>
          <Text variant="caption" color="rgba(255,255,255,0.7)">{clock(labels.total)}</Text>
        </View>
      ) : shown && shown.total > 0 ? (
        /* The standing clock — elapsed / total, end-aligned so it reads with
           the fill's leading edge, on a glass chip because it sits over an
           arbitrary frame (the grid-tile chip grammar). While a finger is on
           the bar the two-ended scrub labels above take its place. */
        <View style={styles.clockRow} pointerEvents="none">
          <View style={styles.clockChip}>
            <NumericText variant="caption" color={STAGE.fg}>{clock(shown.at)}</NumericText>
            <NumericText variant="caption" color={STAGE.fgMuted}> / {clock(shown.total)}</NumericText>
          </View>
        </View>
      ) : null}

      <GestureDetector gesture={pan}>
        <View style={styles.hit}>
          <Animated.View style={[styles.track, track]}>
            <Animated.View style={[styles.fill, { transformOrigin: origin }, fill]} />
            <Animated.View style={[styles.knob, knob, t.shadow(2)]} />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md2,
    paddingBottom: space.sm2,
  },
  clockRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space.md2,
    paddingBottom: space.xs2,
  },
  clockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
  },
  /* 22pt of invisible target around a 2pt line. */
  hit: { paddingVertical: space.sm2, justifyContent: 'flex-end' },
  track: { backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#FFFFFF' },
  knob: {
    position: 'absolute',
    /* left is static now — the travel is a transform. */
    left: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
})
