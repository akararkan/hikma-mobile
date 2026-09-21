/* =========================================================
   Hold-to-record.

   The recorder lives behind a hook so the composer can own the
   gesture (which has to be attached to the mic button itself)
   while the overlay stays a dumb renderer.

   The 10Hz poll is caged. useAudioRecorderState runs a native
   getStatus() per tick with NO idle gating, so it lives in
   `engine` — a null-rendering element the hook hands back and
   the consumer mounts only while a recording is active. An idle
   composer costs zero native wakeups; finish() reads the
   duration off the recorder's own sync getStatus() instead of
   the polled state.

   The waveform is sampled from the recorder's own metering at
   ~10Hz and packed into the compact string the backend's
   `waveform` part expects. Today's server DROPS that part on a
   multipart send — verified live — but sending it costs
   nothing and the moment the backend learns the part every
   receiver gets the real shape for free.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState,
} from 'expo-audio'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, fireHaptic, toast } from '@/ui'
import { durationLabel } from './format'

export interface RecordingResult {
  uri: string
  name: string
  type: string
  durationMs: number
  waveform: string
}

type Recorder = ReturnType<typeof useAudioRecorder>

/* Module-level, NOT state: chatVoicePlayer reads this to refuse playback while
   the mic is live — on iOS any audio-mode write from the player carries an
   implicit allowsRecording:false, which force-stops a recorder mid-capture.
   A plain flag keeps the dependency one-way: the player imports this file,
   never the reverse. */
let recordingLive = false
export const isRecordingLive = () => recordingLive

/** Metering is dBFS (-160…0). Fold it into 0-35 and base-36 it, which is the
 *  compact one-char-per-sample encoding the media adapter reads back. */
function packSample(db: number | undefined): string {
  const v = Math.max(0, Math.min(1, ((db ?? -60) + 60) / 60))
  return Math.round(v * 35).toString(36)
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })

  const [active, setActive] = React.useState(false)
  const [locked, setLocked] = React.useState(false)
  const [tick, setTick] = React.useState<{ seconds: number; meter?: number }>({ seconds: 0, meter: undefined })
  const samples = React.useRef<string[]>([])
  const cancelled = React.useRef(false)

  /* Fed by the engine on its poll tick, so the bars and the timer never
     disagree about how long the recording is. */
  const onSample = React.useCallback((durationMillis: number, metering?: number) => {
    samples.current.push(packSample(metering))
    if (samples.current.length > 400) samples.current.shift()
    setTick({ seconds: durationMillis / 1000, meter: metering })
  }, [])

  const start = React.useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) {
      toast.warn('Allow microphone access in Settings to record a voice message.')
      return false
    }
    /* Claimed BEFORE the mode write: from here until finish() releases it,
       the playback host must keep its hands off the audio session. */
    recordingLive = true
    try {
      /* Without this the recording is silent on iOS when the app has been
         playing audio — the session is still in playback-only mode. */
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      samples.current = []
      cancelled.current = false
      setLocked(false)
      setTick({ seconds: 0, meter: undefined })
      setActive(true)
      await recorder.prepareToRecordAsync()
      recorder.record()
    } catch {
      /* prepareToRecordAsync throws whenever iOS cannot configure the session
         — classically during a phone call. Take the overlay straight back
         down and say so; a dead 0:00 recording is worse than no recording. */
      recordingLive = false
      setActive(false)
      setLocked(false)
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
      toast.warn('Could not start recording — the microphone is busy.')
      return false
    }
    fireHaptic('medium')
    return true
  }, [recorder])

  const finish = React.useCallback(async (): Promise<RecordingResult | null> => {
    /* A sync JSI read, taken BEFORE stop() — with no idle poll there is no
       polled state to fall back on, and after stop() the value is gone. */
    let durationMs = 0
    try { durationMs = recorder.getStatus().durationMillis } catch { /* released */ }
    const waveform = samples.current.join('')
    setActive(false)
    setLocked(false)
    try { await recorder.stop() } catch { /* already stopped */ }
    /* playsInSilentMode rides along explicitly: left to the iOS Record
       defaults it resets to false, dropping the session to ambient — and the
       next voice note the mute switch silences reads as "broken". */
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
    recordingLive = false
    const uri = recorder.uri
    if (cancelled.current || !uri || durationMs < 700) return null
    return {
      uri,
      name: `voice-${Date.now()}.m4a`,
      type: 'audio/mp4',
      durationMs,
      waveform,
    }
  }, [recorder])

  const cancel = React.useCallback(async () => {
    cancelled.current = true
    fireHaptic('warning')
    await finish()
  }, [finish])

  /* Rendered by the consumer, null while idle: the poll's lifetime is exactly
     the recording's. */
  const engine = active ? <RecorderEngine recorder={recorder} onSample={onSample} /> : null

  return {
    active, locked, setLocked,
    seconds: tick.seconds,
    meter: tick.meter,
    start, finish, cancel,
    engine,
  }
}

/** The only mounted consumer of useAudioRecorderState — its setInterval hits
 *  native getStatus() every 100ms with no gating on isRecording, so this
 *  component's lifetime IS the gate. Renders nothing. */
function RecorderEngine({ recorder, onSample }: {
  recorder: Recorder
  onSample: (durationMillis: number, metering?: number) => void
}) {
  const state = useAudioRecorderState(recorder, 100)

  React.useEffect(() => {
    if (!state.isRecording) return
    onSample(state.durationMillis, state.metering)
  }, [state.isRecording, state.durationMillis, state.metering, onSample])

  return null
}

/* ---------------------------------------------------------
   The overlay that replaces the composer while recording.
   --------------------------------------------------------- */

const BARS = 28

export function RecordingOverlay({
  seconds, meter, locked, slide, onCancel, onSend,
}: {
  seconds: number
  meter?: number
  locked: boolean
  /** 0…1 shared value — how far towards the cancel threshold the finger has
   *  travelled. Read on the UI thread; tap-first consumers omit it. */
  slide?: SharedValue<number>
  onCancel: () => void
  onSend: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const [bars, setBars] = React.useState<number[]>(() => Array(BARS).fill(0.12))

  /* The entering bar's height, ridden by ONE Animated.View parked in the last
     slot (its key never changes, so the element survives every shift). Each
     tick ramps it from wherever the previous sample left it to the new one —
     120ms against the 100ms poll, so the meter reads liquid, not steppy. The
     ramp collapses to a cut under reduced motion. */
  const lastH = useSharedValue(0.12)
  const reduce = t.prefs.reducedMotion

  React.useEffect(() => {
    const v = Math.max(0.12, Math.min(1, ((meter ?? -60) + 60) / 60))
    setBars(prev => [...prev.slice(1), v])
    lastH.value = reduce ? v : withTiming(v, { duration: 120 })
  }, [meter, seconds, reduce, lastH])

  /* scaleY, not height. The bar is full-height in layout and only ever scaled,
     because an animated height on a flex child relayouts all 28 bars on every
     frame of the ramp — 60fps of row layout underneath a live microphone poll.
     The origin is deliberately the DEFAULT centre, not 'bottom': the static
     bars are centred by `alignItems: 'center'`, so a bottom-anchored last bar
     would be the one that jumps. The 1pt radius is far below the size at which
     a scale visibly warps a corner, which is why this can stay a scale instead
     of the clip-translate technique the fat rounded bars need. */
  const lastBar = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(0, Math.min(1, lastH.value)) }],
  }))

  /* Derived on the UI thread: the finger's travel never costs a JS render. */
  const hint = useAnimatedStyle(() => ({ opacity: slide ? 1 - slide.value * 0.8 : 1 }))

  return (
    <View style={[styles.overlay, { backgroundColor: c.surface, borderTopColor: c.separator }]}>
      <View style={[styles.recDot, { backgroundColor: c.liveDot, opacity: seconds % 1 < 0.5 ? 1 : 0.35 }]} />
      <Text variant="footnote" tone="danger" align="ui" style={styles.timer}>{durationLabel(seconds * 1000)}</Text>

      <View style={styles.bars}>
        {bars.map((v, i) => (
          i === bars.length - 1
            ? <Animated.View key={i} style={[{ flex: 1, height: '100%', borderRadius: 1, backgroundColor: c.textFaint }, lastBar]} />
            : <View key={i} style={{ flex: 1, height: `${Math.round(v * 100)}%`, borderRadius: 1, backgroundColor: c.textFaint }} />
        ))}
      </View>

      {locked ? (
        <>
          <Touchable onPress={onCancel} feedback="dim" noAutoHitSlop accessibilityLabel="Cancel recording" style={styles.btn}>
            <Icon name="trash" size={20} color={c.danger} />
          </Touchable>
          <Touchable
            onPress={onSend}
            feedback="scale"
            /* 36pt disc: the opt-out stays, but a missed tap here throws away
               a take the user cannot get back — 4 is ⌈(44−36)/2⌉. */
            noAutoHitSlop
            hitSlop={4}
            accessibilityLabel="Send voice message"
            style={[styles.send, { backgroundColor: c.accent }]}
          >
            <Icon name="send" size={17} color={c.textOnAccent} filled />
          </Touchable>
        </>
      ) : (
        <Animated.View style={[styles.slideHint, hint]}>
          <Icon name={t.isRTL ? 'forward' : 'back'} size={13} color={c.textMuted} />
          <Text variant="caption" tone="muted" align="ui">Slide to cancel</Text>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    height: 52, paddingHorizontal: space.md2, borderTopWidth: StyleSheet.hairlineWidth,
  },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  timer: { minWidth: 42 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 24 },
  slideHint: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  btn: { padding: space.xs2 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
