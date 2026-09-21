/* =========================================================
   VoiceTransport — the ONE voice player face.

   A voice post and a chat voice message are the same object to
   a listener: a play coin, a waveform they can scrub, and a
   clock. They had drifted into two different-looking controls,
   so this is the single implementation both now render, and
   the reason it lives outside either domain folder.

   THE PLATE is the voice post's: navy gradient, ghost-sky
   hairline, cerulean coin with navy ink. It carries its own
   ground rather than borrowing the surface under it, which is
   what lets one control sit in a feed card, a channel post or a
   research comment without asking what is underneath.

   CHAT takes the same control BARE (`bare`, and the `tint` that
   goes with it). A message already has a container — the bubble
   — and a plate inside it is a second one nobody asked for, so
   there the coin, the trace and the clock sit straight on the
   bubble and take its ink: cerulean on the navy own-bubble,
   Oxford Blue on the light incoming one. Only the ground moves;
   every measurement, gesture and animation below is shared.

   SMOOTHNESS is the whole point of the animation below, so it
   is worth being precise about. Status ticks arrive a few times
   a second. Parking the trace on each tick plays as a ratchet;
   easing toward each tick's value plays as a stutter, because
   every tick restarts an ease that never finishes. Instead the
   trace is aimed at the END of the clip and given the time that
   is actually left (remaining ÷ rate). Each tick only re-aims
   it, so a correction arrives as an imperceptible change of
   speed and the bar never stops moving. The only jumps are the
   ones that should jump: a scrub, a replay, a track change —
   detected as a reported position far from the animated one.

   Re-aiming has ONE trap, and it is the reason a minute-long
   note used to fill its bar around the halfway mark and jump
   straight to full the moment the speed chip was tapped.
   `withTiming` keeps a timeline alive across replacement: when
   a new timing targets the same value as the animation it
   replaces, Reanimated deliberately inherits that animation's
   startTime and startValue (timing.ts, onStart). Aiming at 1
   every tick IS that case, so each tick measured the time
   already elapsed against a shorter and shorter clock —
   elapsed÷remaining instead of elapsed÷total — and the trace ran
   away from the sound. Changing speed shortens that clock the
   most, which is why it finished the bar there and then. So
   every re-aim CANCELS first, on the UI thread, and the fresh
   ramp starts from exactly where the trace is now.
   ========================================================= */
import { useEvent } from '@/hooks/useAsync'
import { withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, NumericText, Spinner, Touchable, fireHaptic } from '@/ui'
import { LinearGradient } from 'expo-linear-gradient'
import React from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    Easing, cancelAnimation, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withTiming,
    type SharedValue,
} from 'react-native-reanimated'

const WAVE_BARS = 32
const WAVE_BARS_COMPACT = 20
const WAVE_HEIGHT = 36
const WAVE_HEIGHT_COMPACT = 24
/* Native clocks can report one stale status immediately after a seek or a
  decoder stall. Keep this small: it acknowledges a real landing without
  letting a normal 250ms tick visibly pull the line backward. */
const SEEK_ACK_FRACTION = 0.035

/** Deterministic waveform envelope seeded by a stable string — the web
 *  player's exact recipe, so each note looks distinct but identical across
 *  re-renders AND across clients. No DSP: plain Views, list-safe. */
export function waveformOf(seed: string, count: number = WAVE_BARS): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const env = Math.sin((i / count) * Math.PI * 3) * 0.5 + 0.5
    const r = Math.abs((Math.sin((i + 1) * (12.9898 + (h % 9))) * 43758.5453) % 1)
    out.push(Math.min(1, 0.24 + env * 0.55 + r * 0.22))
  }
  return out
}

/** A real waveform the sender uploaded, normalised to `count` bars. Returns
 *  null when there is nothing usable, so the caller falls back to the
 *  synthetic shape rather than drawing a flat line. */
export function parseWaveform(raw: unknown, count: number = WAVE_BARS): number[] | null {
  if (!raw) return null
  const s = String(raw)
  const parts = s.includes(',') ? s.split(',').map(Number) : s.split('').map(ch => parseInt(ch, 36))
  const clean = parts.filter(n => Number.isFinite(n))
  if (clean.length < 4) return null
  const max = Math.max(...clean, 1)
  const step = clean.length / count
  return Array.from({ length: count }, (_, i) => {
    const v = clean[Math.min(clean.length - 1, Math.floor(i * step))] / max
    return 0.15 + Math.max(0, Math.min(1, v)) * 0.85
  })
}

/** One re-aim of the trace, ON THE UI THREAD: a linear ramp from wherever the
 *  trace is right now to the end of the bar, over `ms` of wall clock.
 *
 *  The cancel is not housekeeping, it is the whole point — `withTiming`
 *  inherits the timeline of the animation it replaces when both target the
 *  same value (timing.ts, onStart), and re-aiming at the end is exactly that
 *  case. Cancelling first drops the old animation, so the ramp starts here and
 *  now instead of replaying elapsed time against a shorter clock.
 *
 *  Module scope, so the worklet is serialised once rather than four times a
 *  second, and so `now` is read on the thread that owns it: from JS the value
 *  is already a frame or two stale and every re-aim would start with a small
 *  backward nudge. */
function reaimToEnd(sv: SharedValue<number>, ms: number) {
  'worklet'
  cancelAnimation(sv)
  sv.value = withTiming(1, { duration: ms, easing: Easing.linear })
}

const A11Y_SEEK_ACTIONS = [{ name: 'increment' as const }, { name: 'decrement' as const }]

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Bare-mode ink. Everything the control draws, in the colours of whatever it
 *  is sitting on — a chat bubble takes its own side's. */
export interface VoiceTint {
  /** The play coin's fill, and the ink of the glyph on it. */
  coin: string
  coinInk: string
  /** Unplayed bars. Decorative, so it may sit below text contrast. */
  wave: string
  /** Played bars and the playhead. */
  played: string
  /** The clock, and the mic that stands in for it before a duration. */
  ink: string
  inkMuted: string
}

export interface VoiceTransportProps {
  /** Seeds the synthetic waveform when `bars` is absent. */
  seed: string
  /** A real waveform, when the sender uploaded one. */
  bars?: number[] | null
  playing: boolean
  /** Seconds elapsed, as the player last reported them. */
  position: number
  /** Seconds total. 0 means "not known yet" — the clock stands down. */
  duration: number
  /** Playback speed, so the glide knows how fast the clip is actually moving. */
  rate?: number
  /** A lazy resolve is in flight: the coin shows a wait, not a play. */
  busy?: boolean
  compact?: boolean
  /** Drop the plate: no gradient, no hairline, no padding of its own. For a
   *  surface that is already a container — a chat bubble. */
  bare?: boolean
  /** Bare-mode colours. Defaults to the page's own ink, which is right for a
   *  bare transport on a white row. */
  tint?: VoiceTint
  onToggle: () => void
  onSeek?: (seconds: number) => void
  /** The speed chip in chat; nothing on a post. */
  trailing?: React.ReactNode
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

export function VoiceTransport({
  seed, bars: given, playing, position, duration, rate = 1, busy, compact, bare, tint,
  onToggle, onSeek, trailing, accessibilityLabel, style,
}: VoiceTransportProps) {
  const t = useTheme()
  const c = t.colors
  const dark = t.scheme === 'dark'
  /* One ink table for both grounds, so the JSX below never branches on which
     one it is drawing. The plate's is fixed (it IS the dark ground); bare
     borrows the caller's, or the page's when the caller has no opinion. */
  const skin: VoiceTint = React.useMemo(() => (
    bare
      ? tint ?? {
        /* Cerulean is legal only on a dark ground, and by night the page IS
           one — so the coin is Oxford Blue with white ink by day and the
           cerulean/navy pairing by night (DESIGN.md §2). */
        coin: dark ? c.cta : c.accent,
        coinInk: dark ? c.textOnCta : c.textOnAccent,
        wave: withAlpha(c.text, 0.20), played: c.accent,
        ink: c.text, inkMuted: c.textMuted,
      }
      : {
        coin: c.cta, coinInk: c.textOnCta,
        wave: c.voiceWaveRest, played: c.sky,
        ink: c.overlayText, inkMuted: c.overlayTextMuted,
      }
  ), [bare, tint, dark, c])
  const count = compact ? WAVE_BARS_COMPACT : WAVE_BARS
  const bars = React.useMemo(
    () => (given && given.length ? given : waveformOf(seed, count)),
    [given, seed, count],
  )
  const seekable = !!onSeek && duration > 0
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0

  const [trackW, setTrackW] = React.useState(0)
  const widthSV = useSharedValue(0)
  const progressSV = useSharedValue(progress)
  const totalSV = useSharedValue(duration)
  const scrubbing = useSharedValue(0)
  const scrubFrac = useSharedValue(0)
  const lastSec = useSharedValue(-1)
  const pendingSeek = React.useRef<number | null>(null)
  /* Seconds under the finger, or null when nobody is scrubbing — the clock's
     override. Written at most once per visible second, never per frame. */
  const [scrubSec, setScrubSec] = React.useState<number | null>(null)

  /* A recycled transport can receive a new message before React remounts it.
     Its explicit-seek latch belongs to the old source, never the new one. */
  React.useEffect(() => { pendingSeek.current = null }, [seed])

  const glideToEnd = React.useCallback(
    (ms: number) => runOnUI(reaimToEnd)(progressSV, ms),
    [progressSV],
  )

  /* THE GLIDE — always move continuously. Every native status tick supplies
     the audio's real remaining seconds, and the trace is re-aimed at the end
     with them rather than parked on the tick's value. The visible position is
     never reset during normal playback, so the waveform neither steps nor
     stalls: a tick can only change how fast it is travelling. */
  React.useEffect(() => {
    const requested = pendingSeek.current
    if (requested != null) {
      if (Math.abs(progress - requested) <= SEEK_ACK_FRACTION) {
        pendingSeek.current = null
      } else {
        cancelAnimation(progressSV)
        progressSV.value = requested
        return
      }
    }

    if (t.prefs.reducedMotion || !playing || duration <= 0) {
      cancelAnimation(progressSV)
      progressSV.value = progress
      return
    }
    /* Position comes from the native audio clock and duration is the decoded
       clip length, so THESE are the seconds the clip really has left — the
       whole point of "the speed of the line is the number of seconds". The
       ramp starts from the current animated value and ends with the sound, so
       a trace that has drifted ahead simply travels a little slower until the
       audio catches it up, and one that has drifted behind a little faster.
       No snap, no stall: the correction is a change of speed. */
    const remainingMs = ((1 - progress) * duration * 1000) / Math.max(rate, 0.5)
    glideToEnd(Math.max(80, remainingMs))
  }, [playing, progress, duration, rate, progressSV, glideToEnd, t.prefs.reducedMotion])

  React.useEffect(() => { totalSV.value = duration }, [duration, totalSV])

  const onTrackLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    setTrackW(w)
    widthSV.value = w
  }, [widthSV])

  const showScrubSec = useEvent((sec: number) => setScrubSec(sec))
  const clearScrub = useEvent(() => setScrubSec(null))
  const commitSeek = useEvent((frac: number) => {
    const target = Math.min(1, Math.max(0, frac))
    setScrubSec(null)
    if (duration > 0 && onSeek) {
      pendingSeek.current = target
      progressSV.value = target
      fireHaptic('light')
      onSeek(target * duration)
    }
  })

  const seekGesture = React.useMemo(() => {
    const rtl = t.isRTL
    const fracAt = (x: number) => {
      'worklet'
      const f = Math.min(1, Math.max(0, x / Math.max(1, widthSV.value)))
      return rtl ? 1 - f : f
    }
    /* No bottom bleed: the details row (clock, speed chip) sits 5pt below the
       wave, and a bottom hitSlop reaching past that gap turned a tap on the
       speed chip — parked at the row's far end — into a seek tap landing at
       fracAt≈1, i.e. a jump to the end the instant the rate was changed. */
    const slop = { top: 10, bottom: 0 }

    /* UI-thread end to end: activation waits for deliberate horizontal travel
       and fails on vertical movement, so a feed keeps its fling and a chat
       row keeps its taps and long-press. */
    const pan = Gesture.Pan()
      .enabled(seekable)
      .hitSlop(slop)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart(e => {
        scrubFrac.value = fracAt(e.x)
        scrubbing.value = 1
        lastSec.value = -1
      })
      .onUpdate(e => {
        const f = fracAt(e.x)
        scrubFrac.value = f
        const sec = Math.floor(f * totalSV.value)
        if (sec !== lastSec.value) { lastSec.value = sec; runOnJS(showScrubSec)(sec) }
      })
      .onEnd((e, success) => {
        if (success) {
          /* Park the trace on the landing point BEFORE the commit round-trips
             through JS — a frame of the stale position reads as a snap-back. */
          const f = fracAt(e.x)
          progressSV.value = f
          runOnJS(commitSeek)(f)
        } else runOnJS(clearScrub)()
      })
      .onFinalize(() => { scrubbing.value = 0 })

    const tap = Gesture.Tap()
      .enabled(seekable)
      .hitSlop(slop)
      .maxDuration(250)
      .onEnd((e, success) => {
        if (success) {
          const f = fracAt(e.x)
          progressSV.value = f
          runOnJS(commitSeek)(f)
        }
      })

    /* Race, not Exclusive: the pan activates only on horizontal travel and the
       tap only on a clean quick release, so first-to-activate IS the whole
       arbitration. A held finger fails both and falls through to whatever owns
       the long-press underneath. */
    return Gesture.Race(pan, tap)
  }, [seekable, t.isRTL, widthSV, scrubbing, scrubFrac, lastSec, totalSV, progressSV, showScrubSec, clearScrub, commitSeek])

  const clipStyle = useAnimatedStyle(() => {
    const f = scrubbing.value ? scrubFrac.value : progressSV.value
    return { width: Math.min(1, Math.max(0, f)) * widthSV.value }
  })

  const playheadStyle = useAnimatedStyle(() => {
    const f = scrubbing.value ? scrubFrac.value : progressSV.value
    const distance = Math.min(1, Math.max(0, f)) * widthSV.value
    return { transform: [{ translateX: t.isRTL ? -distance : distance }] }
  })

  const onA11yAction = useEvent((e: { nativeEvent: { actionName: string } }) => {
    if (!onSeek || duration <= 0) return
    const name = e.nativeEvent.actionName
    const seconds = name === 'increment'
      ? Math.min(duration, position + 5)
      : name === 'decrement' ? Math.max(0, position - 5) : null
    if (seconds == null) return
    const target = seconds / duration
    pendingSeek.current = target
    progressSV.value = target
    onSeek(seconds)
  })

  /* One clock, the messenger convention: the length at rest, elapsed once the
     note has a position, the scrub target while a finger owns the bar. Before
     the first tap the length can be genuinely unknown, and then the clock
     stands down rather than asserting "0:00". */
  const started = playing || position > 0
  const label = scrubSec != null
    ? clock(scrubSec)
    : started ? clock(position) : duration > 0 ? clock(duration) : null

  const coin = compact ? 34 : 42
  const waveH = compact ? WAVE_HEIGHT_COMPACT : WAVE_HEIGHT

  const body = (
    <>
      <Touchable
        onPress={onToggle}
        feedback="scale"
        haptic="light"
        noAutoHitSlop
        accessibilityLabel={accessibilityLabel ?? (playing ? 'Pause voice message' : 'Play voice message')}
        /* The action is the BRIGHT thing wherever it lands: cerulean with
           navy ink on a dark ground (Button variant="onDark"'s pairing),
           Oxford Blue with white ink on a light one. */
        style={[styles.coin, { width: coin, height: coin, borderRadius: coin / 2, backgroundColor: skin.coin }]}
      >
        {busy
          ? <Spinner color={skin.coinInk} />
          : <Icon name={playing ? 'pause' : 'play'} size={compact ? 15 : 19} color={skin.coinInk} filled />}
      </Touchable>

      <View style={[styles.transport, compact ? styles.transportCompact : null]}>
        <GestureDetector gesture={seekGesture}>
          <View
            onLayout={onTrackLayout}
            style={[styles.wave, { height: waveH }]}
            accessible={seekable}
            accessibilityRole={seekable ? 'adjustable' : undefined}
            accessibilityLabel={seekable ? 'Voice position' : undefined}
            accessibilityValue={seekable
              ? { min: 0, max: Math.round(duration), now: Math.round(position), text: clock(position) }
              : undefined}
            accessibilityActions={seekable ? A11Y_SEEK_ACTIONS : undefined}
            onAccessibilityAction={seekable ? onA11yAction : undefined}
          >
            {bars.map((h, i) => (
              <View key={i} style={[styles.bar, { height: `${Math.round(h * 100)}%`, backgroundColor: skin.wave }]} />
            ))}
            <Animated.View style={[styles.playedClip, clipStyle]} pointerEvents="none">
              <View style={[styles.playedInner, { width: trackW }]}>
                {bars.map((h, i) => (
                  <View key={i} style={[styles.bar, { height: `${Math.round(h * 100)}%`, backgroundColor: skin.played }]} />
                ))}
              </View>
            </Animated.View>
            {duration > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.playhead, { backgroundColor: skin.played }, playheadStyle]}
              />
            ) : null}
          </View>
        </GestureDetector>

        <View style={[styles.details, compact ? styles.detailsCompact : null]}>
          {label ? (
            <NumericText variant="footnote" weight="600" color={skin.ink} style={[styles.clock, compact ? styles.clockCompact : null]}>
              {label}
            </NumericText>
          ) : (
            <Icon name="mic" size={15} color={skin.inkMuted} />
          )}
          <View style={styles.detailsSpacer} />
          {trailing}
        </View>
      </View>
    </>
  )

  const gap = compact ? 8 : 10
  return (
    <View style={style}>
      {bare ? (
        <View style={[styles.bare, { gap }]}>{body}</View>
      ) : (
        <LinearGradient
          colors={[c.voicePlate, c.voicePlateEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.plate, { borderColor: c.voicePlateBorder, gap, padding: gap }]}
        >
          {body}
        </LinearGradient>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  /* The .vnp plate: navy gradient, ghost-sky hairline, card radius. The
     gradient IS the surface, so the plate ignores the paper's radius prop. */
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  /* Bare: the row IS the control. Whatever it sits in owns the ground, the
     padding and the corners. */
  bare: { flexDirection: 'row', alignItems: 'center' },
  coin: { alignItems: 'center', justifyContent: 'center' },
  transport: { flex: 1, minWidth: 0 },
  transportCompact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wave: { flex: 1, minWidth: 0, position: 'relative', flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  bar: { flex: 1, borderRadius: 2 },
  /* The clip window for the played trace — its animated width IS the
     playhead. */
  playedClip: { position: 'absolute', start: 0, top: 0, bottom: 0, overflow: 'hidden' },
  /* The full-width pre-coloured copy inside it, pinned to the start edge so
     its bars land exactly over the resting layer's. */
  playedInner: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
  },
  playhead: { position: 'absolute', start: 0, top: 1, bottom: 1, width: 2, borderRadius: 1 },
  details: { minHeight: 17, flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs2 },
  detailsCompact: { flex: 0, minHeight: 0, marginTop: 0 },
  detailsSpacer: { flex: 1 },
  clock: { fontVariant: ['tabular-nums'], minWidth: 40 },
  clockCompact: { minWidth: 34 },
})
