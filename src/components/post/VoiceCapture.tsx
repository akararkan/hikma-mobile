/* =========================================================
   Voice capture for the post composer.

   The recorder lives behind a hook so the composer owns the
   flow (tap to record, tap to finish) while the surfaces stay
   dumb renderers — the same split the chat recorder uses, in
   the same visual language: red dot, ledger clock, live meter,
   trash on one side and the affirmative control on the other.
   Here the affirmative is FINISH, not send — a voice post is
   reviewed before it is published, so stopping lands the take
   in a preview tile rather than on the wire.

   The 10Hz poll is caged the way chat cages it:
   useAudioRecorderState runs a native getStatus() per tick
   with NO idle gating, so it lives in `engine` — a
   null-rendering element the hook hands back and the consumer
   mounts only while a recording is active. An idle composer
   costs zero native wakeups; finish() reads the duration off
   the recorder's own sync getStatus() instead of the polled
   state.

   Metering samples stay plain 0…1 numbers rather than the
   chat wire packing: the post multipart contract has no
   waveform part, so the samples exist purely to draw the
   preview's REAL shape — the one thing a synthetic hash can
   never give the person deciding whether to keep the take.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable, fireHaptic, toast } from '@/ui'

export interface VoiceTake {
  uri: string
  name: string
  type: string
  durationMs: number
  /** Live metering folded to 0…1, one sample per poll tick. */
  samples: number[]
}

type Recorder = ReturnType<typeof useAudioRecorder>

/** Metering is dBFS (-160…0). Fold it into 0…1 the same way the chat meter
 *  does, so the two surfaces breathe identically for the same voice. */
function meterLevel(db: number | undefined): number {
  return Math.max(0, Math.min(1, ((db ?? -60) + 60) / 60))
}

/** m:ss — the recorder thinks in seconds, the label in the ledger voice. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function useVoicePostRecorder() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })

  const [active, setActive] = React.useState(false)
  const [tick, setTick] = React.useState<{ seconds: number; meter?: number }>({ seconds: 0, meter: undefined })
  const samples = React.useRef<number[]>([])
  const cancelled = React.useRef(false)
  const running = React.useRef(false)

  /* Fed by the engine on its poll tick, so the bars and the timer never
     disagree about how long the recording is. */
  const onSample = React.useCallback((durationMillis: number, metering?: number) => {
    samples.current.push(meterLevel(metering))
    if (samples.current.length > 600) samples.current.shift()
    setTick({ seconds: durationMillis / 1000, meter: metering })
  }, [])

  const start = React.useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) {
      toast.warn('Allow microphone access in Settings to record')
      return false
    }
    try {
      /* Without this the recording is silent on iOS when the app has been
         playing audio — the session is still in playback-only mode. */
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      samples.current = []
      cancelled.current = false
      setTick({ seconds: 0, meter: undefined })
      setActive(true)
      running.current = true
      await recorder.prepareToRecordAsync()
      recorder.record()
    } catch {
      /* prepareToRecordAsync throws whenever iOS cannot configure the session
         — classically during a phone call. Take the surface straight back
         down and say so; a dead 0:00 recording is worse than no recording. */
      running.current = false
      setActive(false)
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
      toast.warn('Could not start recording — the microphone is busy.')
      return false
    }
    fireHaptic('light')
    return true
  }, [recorder])

  const finish = React.useCallback(async (): Promise<VoiceTake | null> => {
    /* A double-tap on the finish coin must not run the teardown twice. */
    if (!running.current) return null
    running.current = false
    /* A sync JSI read, taken BEFORE stop() — with no idle poll there is no
       polled state to fall back on, and after stop() the value is gone. */
    let durationMs = 0
    try { durationMs = recorder.getStatus().durationMillis } catch { /* released */ }
    const shape = samples.current.slice()
    setActive(false)
    try { await recorder.stop() } catch { /* already stopped */ }
    /* playsInSilentMode rides along explicitly: left to the iOS Record
       defaults it resets to false, dropping the session to ambient — and the
       preview the mute switch silences reads as "broken". */
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {})
    if (cancelled.current) return null
    fireHaptic('light')
    const uri = recorder.uri
    if (!uri) {
      toast.error('Recording failed — nothing was captured.')
      return null
    }
    if (durationMs < 1000) {
      toast.warn('That take was too short to keep — try again.')
      return null
    }
    return { uri, name: `voice-${Date.now()}.m4a`, type: 'audio/mp4', durationMs, samples: shape }
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
    active,
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
   The surface that replaces the tool row while recording.
   Layout-neutral on purpose — the host bar owns its chrome,
   its height and its safe-area bottom, so the same row can
   sit in any docked composer.
   --------------------------------------------------------- */

const LIVE_BARS = 28

export function VoiceRecordingSurface({
  seconds, meter, onCancel, onFinish,
}: {
  seconds: number
  meter?: number
  onCancel: () => void
  onFinish: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const [bars, setBars] = React.useState<number[]>(() => Array(LIVE_BARS).fill(0.12))

  React.useEffect(() => {
    const v = Math.max(0.12, meterLevel(meter))
    setBars(prev => [...prev.slice(1), v])
  }, [meter, seconds])

  /* The blink rides the recorder's own tick — no animation driver to gate —
     and reduced motion holds the dot steady instead. */
  const dotOn = t.prefs.reducedMotion || seconds % 1 < 0.5

  return (
    <View style={styles.liveRow}>
      <View style={[styles.recDot, { backgroundColor: c.liveDot, opacity: dotOn ? 1 : 0.35 }]} />
      <NumericText variant="footnote" tone="danger" style={styles.timer}>{clock(seconds)}</NumericText>

      <View style={styles.liveBars}>
        {bars.map((v, i) => (
          <View key={i} style={{ flex: 1, height: `${Math.round(v * 100)}%`, borderRadius: 1, backgroundColor: c.textFaint }} />
        ))}
      </View>

      <Touchable onPress={onCancel} feedback="dim" noAutoHitSlop accessibilityLabel="Discard recording" style={styles.liveBtn}>
        <Icon name="trash" size={20} color={c.danger} />
      </Touchable>
      <Touchable
        onPress={onFinish}
        feedback="scale"
        /* 36pt disc: the opt-out stays, but a missed tap here throws away a
           take the user cannot get back — 4 is ⌈(44−36)/2⌉. */
        noAutoHitSlop
        hitSlop={4}
        accessibilityLabel="Finish recording"
        style={[styles.finish, { backgroundColor: c.accent }]}
      >
        <Icon name="check" size={18} color={c.textOnAccent} />
      </Touchable>
    </View>
  )
}

/* ---------------------------------------------------------
   The preview tile: hear the take before it becomes a post.
   Presentation only — the AUDIO tile the publish path uploads
   is untouched state in the composer; this plate just plays
   the same file back and offers the two exits.
   --------------------------------------------------------- */

const PREVIEW_BARS = 40

/* Real metering resampled to the plate's width and normalised to its own
   loudest moment — a quiet reciter still reads as a voice, not a flatline.
   A take too short to have sampled anything falls back to the same
   hashed-but-stable shape the QnA player draws: never 40 identical bars. */
function previewBars(samples: number[], seed: string): number[] {
  if (samples.length >= 8) {
    const max = Math.max(...samples, 0.2)
    const out: number[] = []
    const step = samples.length / PREVIEW_BARS
    for (let i = 0; i < PREVIEW_BARS; i++) {
      const from = Math.floor(i * step)
      const to = Math.max(from + 1, Math.floor((i + 1) * step))
      let sum = 0
      for (let j = from; j < to; j++) sum += samples[j]
      out.push(0.15 + Math.min(1, sum / (to - from) / max) * 0.85)
    }
    return out
  }
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < PREVIEW_BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    out.push(0.28 + ((h >>> 8) % 72) / 100)
  }
  return out
}

export function VoicePreviewTile({
  uri, durationMs, samples, disabled, onReRecord, onRemove, style,
}: {
  uri: string
  durationMs: number
  samples: number[]
  /** Publishing: the take is committed, so the two exits go away — but the
   *  transport stays live; listening while the upload runs harms nothing. */
  disabled?: boolean
  onReRecord: () => void
  onRemove: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors
  const player = useAudioPlayer(uri)
  const status = useAudioPlayerStatus(player)
  const bars = React.useMemo(() => previewBars(samples, uri), [samples, uri])

  const playing = !!status?.playing
  const total = status?.duration && status.duration > 0 ? status.duration : durationMs / 1000
  const elapsed = status?.currentTime ?? 0
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0
  const played = Math.round(bars.length * progress)

  const toggle = () => {
    if (playing) { player.pause(); return }
    /* A finished clip keeps its playhead at the end; without the rewind the
       second tap looks like a dead button. */
    if (total > 0 && elapsed >= total - 0.25) { void player.seekTo(0) }
    player.play()
  }

  const waveWidth = React.useRef(0)
  const seek = (e: any) => {
    if (!(total > 0) || waveWidth.current <= 0) return
    /* Measured-x maths, so RTL flips the fraction (DESIGN.md §8). */
    const f = Math.max(0, Math.min(1, (e?.nativeEvent?.locationX ?? 0) / waveWidth.current))
    void player.seekTo((t.isRTL ? 1 - f : f) * total)
  }

  return (
    <View style={[styles.preview, { backgroundColor: c.surfaceSunken, borderColor: c.borderFaint, borderRadius: t.radius.md }, style]}>
      <View style={styles.previewRow}>
        <Touchable
          onPress={toggle}
          feedback="scale"
          noAutoHitSlop
          accessibilityLabel={playing ? 'Pause your recording' : 'Play your recording'}
          style={[styles.coin, { backgroundColor: c.accent }]}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} color={c.textOnAccent} filled />
        </Touchable>

        <Touchable
          onPress={seek}
          feedback="none"
          noAutoHitSlop
          disabled={!(total > 0)}
          noDisabledDim
          accessibilityLabel="Jump to a point in your recording"
          onLayout={e => { waveWidth.current = e.nativeEvent.layout.width }}
          style={styles.wave}
        >
          {/* pointerEvents none: the tap must land on the seek surface, not a
              bar — locationX is relative to whichever view catches it. */}
          <View pointerEvents="none" style={styles.waveInner}>
            {bars.map((v, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: Math.round(26 * v),
                  borderRadius: 1.5,
                  backgroundColor: i < played ? c.accent : c.borderStrong,
                }}
              />
            ))}
          </View>
        </Touchable>

        <NumericText variant="caption" tone="muted">
          {clock(playing || elapsed > 0 ? Math.max(0, total - elapsed) : total)}
        </NumericText>
      </View>

      {!disabled ? (
        <View style={[styles.previewActions, { borderTopColor: c.borderFaint }]}>
          <Touchable onPress={onReRecord} feedback="dim" accessibilityLabel="Record again" style={styles.previewAction}>
            <Icon name="refresh" size={15} color={c.link} />
            <Text variant="footnote" tone="accent" weight="600">Record again</Text>
          </Touchable>
          <Touchable onPress={onRemove} feedback="dim" accessibilityLabel="Remove voice recording" style={styles.previewAction}>
            <Icon name="trash" size={15} color={c.danger} />
            <Text variant="footnote" tone="danger" weight="600">Remove</Text>
          </Touchable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  liveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  timer: { minWidth: 42 },
  liveBars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 24 },
  liveBtn: { padding: space.xs2 },
  /* The finish coin is icon-only — a sanctioned circle, same as chat's send. */
  finish: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  preview: { borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingStart: space.sm, paddingEnd: space.md2, height: 56 },
  coin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, height: '100%', justifyContent: 'center' },
  waveInner: { flexDirection: 'row', alignItems: 'center', gap: 1.5 },
  previewActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  previewAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs2, paddingVertical: space.sm2,
  },
})
