/* =========================================================
   The audio mix.

   The platform has no field for a per-post balance, so these
   three numbers ride in the FRAGMENT of the stored track url
   (`…#mix=1.00,0.70,1.00`) and are read back by every viewer
   with readMix(). That is also the sheet's one real
   limitation, and it is stated on screen rather than hidden: a
   voiceover-only reel has no track url to carry the fragment,
   so it plays at defaults.

   Values are clamped and rounded to two decimals HERE, exactly
   as withMix() will serialise them, so the preview and the
   published reel cannot disagree.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions, type AccessibilityActionEvent } from 'react-native'
import { useRouter } from 'expo-router'
import { useComposerInsets } from '@/components/reels/ComposerChrome'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useAudioPlayer } from 'expo-audio'
import { useVideoPlayer, VideoView } from 'expo-video'
import { DEFAULT_MIX, clamp01 } from '@/lib/soundMix'
import { useReelDraft, type ReelMix } from '@/components/reels/ReelDraft'
import { armReelAudioSession } from '@/components/reels/mute'
import { STAGE } from '@/components/reels/skin'
import { videoTransport } from '@/components/reels/transport'
import { bareUrl } from '@/components/reels/types'
import { shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { Button, Icon, NumericText, Text, Touchable, fireHaptic } from '@/ui'

type Channel = 'orig' | 'music' | 'voice'

const ROWS: { key: Channel; icon: any; label: string; absent: string }[] = [
  { key: 'orig', icon: 'video', label: 'Original sound', absent: 'No clip audio' },
  { key: 'music', icon: 'music', label: 'Added sound', absent: 'No sound added' },
  { key: 'voice', icon: 'mic', label: 'Voiceover', absent: 'No voiceover recorded' },
]

/** Two decimals, matching withMix()'s own toFixed(2) — anything finer would be
 *  thrown away on publish and the preview would drift from the result. */
const quantise = (v: number) => Math.round(clamp01(v) * 100) / 100

/** The viewer's own tolerance (useReelAudioNative) — a preview that corrects
 *  more eagerly than the reel will play would be tuning the wrong thing. */
const DRIFT = 0.3

const A11Y_LEVEL_ACTIONS = [{ name: 'increment' as const }, { name: 'decrement' as const }]
/* 5% a nudge — twenty steps end to end. Finer and an adjustable takes forever to
   cross the track; coarser and a level cannot be set by ear. */
const A11Y_STEP = 0.05

export default function MixSheetScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useComposerInsets()
  const { height } = useWindowDimensions()
  const { draft, patch } = useReelDraft()

  const [mix, setMix] = React.useState<ReelMix>(() => ({ ...DEFAULT_MIX, ...draft.mix }))
  const [previewing, setPreviewing] = React.useState(false)
  const [trackFailed, setTrackFailed] = React.useState(false)

  const present: Record<Channel, boolean> = {
    orig: !!draft.videoUri,
    music: !!draft.sound,
    voice: !!draft.voiceUri,
  }

  const clip = useVideoPlayer(draft.videoUri ?? null, p => {
    p.loop = true
    /* 0 is the default and means "never emit timeUpdate" — the mirror below
       lives or dies on this line. */
    p.timeUpdateEventInterval = 0.25
  })
  const music = useAudioPlayer(bareUrl(draft.sound?.audioUrl) ?? null, { updateInterval: 500 })
  const voice = useAudioPlayer(draft.voiceUri ?? null, { updateInterval: 500 })

  /* Levels go straight onto the players so a drag is audible immediately —
     re-rendering three media objects at 60fps is not an option. */
  React.useEffect(() => {
    try { clip.volume = mix.orig } catch { /* released */ }
    try { music.volume = mix.music; music.loop = true } catch { /* released */ }
    try { voice.volume = mix.voice } catch { /* released */ }
  }, [clip, music, voice, mix])

  React.useEffect(() => {
    /* The one screen in the app whose entire purpose is hearing a balance, so
       it cannot be the screen the ring/silent switch mutes. The session is a
       full replace, not a merge (components/reels/mute.ts), and the recorder
       on the way in here has already handed it back — so arm it on the way to
       playing rather than trusting whatever the last surface left behind. */
    if (previewing) armReelAudioSession()
    try {
      if (previewing) { clip.currentTime = 0; clip.play() } else clip.pause()
    } catch { /* released */ }
    try {
      if (previewing && present.music) { void music.seekTo(0); music.play() } else music.pause()
    } catch { setTrackFailed(true) }
    try {
      if (previewing && present.voice) { void voice.seekTo(0); voice.play() } else voice.pause()
    } catch { /* released */ }
  }, [previewing, clip, music, voice, present.music, present.voice])

  /* The preview is a LOOP, and three players started together only stay
     together for one pass: the clip wraps to zero while the added track is
     mid-bar and the voiceover has long since ended. So the preview mirrors the
     clip exactly as the viewer does — music modulo its own length, voiceover
     absolute and silent past its end — or the balance being set here is not
     the balance anybody will hear. */
  React.useEffect(() => {
    if (!previewing) return
    if (!present.music && !present.voice) return
    const transport = videoTransport(clip)
    return transport.onTime(time => {
      if (present.music) {
        try {
          const d = music.duration
          const at = (Number.isFinite(d) && d > 0) ? time % d : time
          if (Math.abs(music.currentTime - at) > DRIFT) music.seekTo(at).catch(() => {})
          if (!music.playing) music.play()
        } catch { /* not seekable yet */ }
      }
      if (present.voice) {
        try {
          const d = voice.duration
          if (Number.isFinite(d) && d > 0 && time >= d) {
            if (voice.playing) voice.pause()
          } else {
            if (Math.abs(voice.currentTime - time) > DRIFT) voice.seekTo(time).catch(() => {})
            if (!voice.playing) voice.play()
          }
        } catch { /* not seekable yet */ }
      }
    })
  }, [previewing, clip, music, voice, present.music, present.voice])

  React.useEffect(() => () => {
    try { clip.pause() } catch { /* released */ }
    try { music.pause() } catch { /* released */ }
    try { voice.pause() } catch { /* released */ }
  }, [clip, music, voice])

  /* Stable identities: a fresh arrow per render would re-memo every row's
     gesture, which is the one thing a slider cannot afford mid-drag. */
  const commit = React.useCallback((key: Channel, v: number) => {
    setMix(m => ({ ...m, [key]: quantise(v) }))
  }, [])
  const resetChannel = React.useCallback((key: Channel) => {
    setMix(m => ({ ...m, [key]: DEFAULT_MIX[key] }))
  }, [])

  const save = () => {
    patch({ mix: { orig: quantise(mix.orig), music: quantise(mix.music), voice: quantise(mix.voice) } })
    fireHaptic('success')
    router.back()
  }

  const voiceOnly = present.voice && !present.music

  return (
    <View style={StyleSheet.absoluteFill}>
      <Touchable
        onPress={() => router.back()}
        feedback="none"
        noAutoHitSlop
        accessibilityLabel="Close"
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      >
        <View />
      </Touchable>

      <View style={[styles.sheet, { height: height * 0.46, paddingBottom: insets.bottom }]}>
        <View style={styles.handleZone}><View style={styles.handle} /></View>

        <View style={styles.head}>
          <View style={styles.headSpacer} />
          <Text variant="headline" color={STAGE.fg} align="center" style={{ flex: 1 }}>Mix</Text>
          <Touchable
            onPress={() => { setMix({ ...DEFAULT_MIX }); fireHaptic('light') }}
            feedback="dim"
            noAutoHitSlop
            accessibilityLabel="Reset levels"
            style={styles.headSpacer}
          >
            <Text variant="subhead" weight="600" color={t.colors.cta}>Reset</Text>
          </Touchable>
        </View>

        {ROWS.map(row => (
          <SliderRow
            key={row.key}
            channel={row.key}
            icon={row.icon}
            label={row.label}
            absentLabel={row.absent}
            present={present[row.key]}
            value={mix[row.key]}
            failed={row.key === 'music' && trackFailed}
            onChange={commit}
            onReset={resetChannel}
          />
        ))}

        <View style={styles.previewRow}>
          <Touchable
            onPress={() => setPreviewing(p => !p)}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel={previewing ? 'Stop preview' : 'Preview mix'}
            style={styles.previewBtn}
          >
            <Icon name={previewing ? 'pause' : 'play'} size={17} color={STAGE.fg} filled />
          </Touchable>
          <Text variant="caption" color={STAGE.fgFaint} style={{ flex: 1 }}>
            Levels apply to everyone who watches your reel.
          </Text>
        </View>

        {voiceOnly ? (
          <Text variant="caption" color={STAGE.warn} align="ui" style={styles.note}>
            A voiceover-only reel plays at default levels — attach a sound to save a custom balance.
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Button label="Save" onPress={save} variant="onDark" size="lg" block />
        </View>
      </View>

      {/* Off-screen, but mounted: the preview needs a real surface for the clip
          to decode into or iOS gives us audio with no timeline. */}
      {draft.videoUri ? (
        /* key: a clip swap releases the old player under this mounted view. */
        <VideoView key={draft.videoUri} player={clip} style={styles.hiddenVideo} contentFit="cover" nativeControls={false} />
      ) : null}
    </View>
  )
}

const SliderRow = React.memo(function SliderRow({
  channel, icon, label, absentLabel, present, value, failed, onChange, onReset,
}: {
  channel: Channel
  icon: any
  label: string
  absentLabel: string
  present: boolean
  value: number
  failed?: boolean
  onChange: (channel: Channel, v: number) => void
  onReset: (channel: Channel) => void
}) {
  const t = useTheme()
  const [trackWidth, setTrackWidth] = React.useState(0)
  /* The same measurement again, on the UI thread: the gesture config is rebuilt
     from React state, but the fill and the knob are now pixel transforms and a
     worklet cannot reach into React for the number. */
  const trackW = useSharedValue(0)
  const fraction = useSharedValue(value)
  const grabbed = useSharedValue(0)
  /* Set synchronously in the gesture so the effect below can tell "React has a
     new level for me" from "React is echoing back the level my own finger sent
     a frame ago" — the echo would drag the knob backwards under the finger. */
  const dragging = useSharedValue(0)
  /* The last level actually handed to React, in hundredths. */
  const pushed = useSharedValue(Math.round(value * 100))

  React.useEffect(() => {
    if (dragging.value) return
    fraction.value = value
  }, [value, fraction, dragging])

  /* ONE gesture object per handler set. Built inline, every re-render hands
     GestureDetector a new config to register natively — mid-drag that stutters
     and can drop the pan outright, on the one screen already decoding a video
     for the preview. */
  /* Captured in JS — t.ms cannot run inside a worklet. */
  const settleMs = t.ms(160)
  const gesture = React.useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(present)
      .minDistance(0)
      .onBegin(e => {
        dragging.value = 1
        grabbed.value = withSpring(1, { damping: 16, stiffness: 300 })
        const f = Math.min(1, Math.max(0, e.x / Math.max(1, trackWidth)))
        fraction.value = f
        pushed.value = Math.round(f * 100)
        runOnJS(onChange)(channel, f)
      })
      .onUpdate(e => {
        const f = Math.min(1, Math.max(0, e.x / Math.max(1, trackWidth)))
        fraction.value = f
        /* Only when the SERIALISED level moves. quantise() rounds to hundredths
           and setMix returns a fresh object every call, so a finer update is a
           whole-sheet re-render that cannot change a single pixel or decibel. */
        const step = Math.round(f * 100)
        if (step === pushed.value) return
        pushed.value = step
        runOnJS(onChange)(channel, f)
      })
      .onFinalize(() => {
        dragging.value = 0
        grabbed.value = withTiming(0, { duration: settleMs })
      })

    const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((_e, ok) => {
      if (ok) runOnJS(onReset)(channel)
    })

    return Gesture.Simultaneous(pan, doubleTap)
  }, [present, trackWidth, channel, onChange, onReset, fraction, grabbed, dragging, pushed, settleMs])

  /* A screen reader swallows the pan, so without an adjustable these levels
     cannot be moved at all — the readout is audible and the control is not. */
  const onA11yAction = React.useCallback((e: AccessibilityActionEvent) => {
    const next = e.nativeEvent.actionName === 'increment' ? value + A11Y_STEP : value - A11Y_STEP
    onChange(channel, Math.min(1, Math.max(0, next)))
  }, [value, channel, onChange])

  /* Fill and knob are ONE conversion, deliberately. An animated `width` on the
     fill and an animated `left` on the knob both cost a layout pass per frame of
     a drag — on the sheet that is decoding a video preview behind it — but worse,
     converting only one of them would leave a transform racing a layout: the
     knob would visibly lag the fill it is supposed to cap.

     clip-translate, not scaleX. The fill is a 4pt bar with a 2pt radius; scaleX
     on that turns the cap into an oval and, near zero, the whole thing into a
     lens. So `track` gains a clipping child (it cannot clip itself — the 22pt
     knob lives inside it and would be guillotined), and a full-width rounded
     child slides under it. The child keeps its radius, which is what preserves
     the rounded leading cap the old percentage width drew.

     Travel is PHYSICAL, matching the `left: 0` fill and the `e.x` the pan reads,
     so an RTL row moves exactly as it did before.

     A percentage was self-sufficient; pixels are not, so both hide for the one
     frame between mount and the first onLayout rather than paint a full bar and
     a knob pinned to the left. */
  const fill = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: -(1 - fraction.value) * trackW.value }],
  }))
  const knob = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [
      { translateX: fraction.value * trackW.value - 11 },
      { scale: 1 + grabbed.value * 0.15 },
    ],
  }))

  return (
    <View style={[styles.sliderRow, present ? null : styles.rowOff]}>
      <View style={styles.sliderLabel}>
        <Icon name={icon} size={18} color={STAGE.fgMuted} />
        <View style={{ flex: 1 }}>
          <Text variant="footnote" weight="600" color={STAGE.fg} numberOfLines={1}>{label}</Text>
          {!present ? <Text variant="caption" color={STAGE.fgFaint}>{absentLabel}</Text> : null}
          {failed ? <Text variant="caption" color={STAGE.warn}>Can&rsquo;t preview this track</Text> : null}
        </View>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.trackHit}
          onLayout={e => { trackW.value = e.nativeEvent.layout.width; setTrackWidth(e.nativeEvent.layout.width) }}
          collapsable={false}
          accessible={present}
          accessibilityRole={present ? 'adjustable' : undefined}
          accessibilityLabel={present ? label : undefined}
          accessibilityValue={present ? { min: 0, max: 100, now: Math.round(value * 100) } : undefined}
          accessibilityActions={present ? A11Y_LEVEL_ACTIONS : undefined}
          onAccessibilityAction={present ? onA11yAction : undefined}
        >
          <View style={styles.track}>
            {/* The clip the track cannot be: the knob overflows it by 18pt. */}
            <View style={styles.fillClip}>
              {/* The filled part of a level, on a dark sheet — navy here is a
                  track you cannot read against its own groove. */}
              <Animated.View style={[styles.trackFill, { backgroundColor: t.colors.cta }, fill]} />
            </View>
            <Animated.View style={[styles.knob, knob]} />
          </View>
        </View>
      </GestureDetector>

      <NumericText variant="caption" color={STAGE.fgMuted} align="right" style={styles.readout}>
        {Math.round(value * 100)}%
      </NumericText>
    </View>
  )
})

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: STAGE.sheet,
    borderTopLeftRadius: shape.sheet.top,
    borderTopRightRadius: shape.sheet.top,
    borderCurve: 'continuous',
    paddingHorizontal: space.lg,
  },
  handleZone: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: STAGE.fgGhost },
  head: { flexDirection: 'row', alignItems: 'center', height: 44 },
  headSpacer: { width: 56, height: 44, justifyContent: 'center' },
  sliderRow: { height: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  rowOff: { opacity: 0.35 },
  sliderLabel: { width: 132, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trackHit: { flex: 1, height: 44, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  fillClip: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2, overflow: 'hidden' },
  /* Full width and rounded, slid leftwards under fillClip — see the note on
     `fill`. Do NOT "simplify" this back to an animated width or a scaleX. */
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', borderRadius: 2 },
  /* left is the anchor, not the animation — the travel is a transform now. */
  knob: { position: 'absolute', left: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: STAGE.fg },
  readout: { width: 42 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 40, marginTop: space.xs },
  previewBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { paddingTop: space.xs },
  footer: { paddingTop: space.md },
  hiddenVideo: { position: 'absolute', width: 1, height: 1, opacity: 0, top: 0, left: 0 },
})
