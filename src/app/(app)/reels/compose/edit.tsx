/* =========================================================
   Composer, step 2 — the creative stage.

   What the author sees here is pixel-for-pixel what a viewer
   gets, because the stage runs the SAME mediaRect() maths the
   viewer runs. That is the whole reason the overlay is data
   rather than a flattened frame.

   Cover selection is deliberately NOT on this screen: the
   frames come from the clip's own player and the only place
   they are needed is the publish step, so the picker lives
   there rather than in two places.
   ========================================================= */
import { ComposerHeader, useComposerInsets } from '@/components/reels/ComposerChrome'
import { GlyphTray, TextTray, Tool } from '@/components/media/OverlayTools'
import { OverlayEditorStage } from '@/components/reels/OverlayEditorStage'
import { useReelDraft } from '@/components/reels/ReelDraft'
import type { OverlayItem } from '@/components/reels/ReelOverlayLayer'
import { useReduceMotion } from '@/components/reels/ReelOverlayLayer'
import { ReelProgressBar } from '@/components/reels/ReelProgressBar'
import { armReelAudioSession } from '@/components/reels/mute'
import { STAGE } from '@/components/reels/skin'
import { videoTransport } from '@/components/reels/transport'
import { bareUrl } from '@/components/reels/types'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { EMOJI, MAX_BYTES, MAX_ITEMS, STICKERS, cleanItem, serialiseOverlay } from '@/lib/reelOverlay'
import { DEFAULT_MIX } from '@/lib/soundMix'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Button, ConfirmSheet, Icon, NumericText, Text, Touchable, fireHaptic, toast, useSheetState } from '@/ui'
import {
    RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { VideoView, useVideoPlayer } from 'expo-video'
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

type Tray = null | 'text' | 'emoji' | 'sticker'

/** The viewer's own tolerance (useReelAudioNative) — a preview that corrects
 *  more eagerly than the reel will play would be previewing the wrong thing. */
const DRIFT = 0.3

export default function ComposeEditScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useComposerInsets()
  const { width: W, height: H } = useWindowDimensions()
  const { draft, patch } = useReelDraft()
  const reduceMotion = useReduceMotion()

  const [tray, setTray] = React.useState<Tray>(null)
  const [selected, setSelected] = React.useState<number | null>(null)
  const [editing, setEditing] = React.useState<number | null>(null)
  const [previewMuted, setPreviewMuted] = React.useState(false)
  const [playing, setPlaying] = React.useState(true)
  const [voiceMode, setVoiceMode] = React.useState(false)
  const [scrubWidth, setScrubWidth] = React.useState(0)
  /* Measured, not guessed: the tool rail hangs off the bottom of the header,
     and the header's height depends on an inset nobody can predict. */
  const [headerH, setHeaderH] = React.useState(0)
  const discard = useSheetState()

  const items = draft.items
  const setItems = React.useCallback((next: OverlayItem[]) => patch({ items: next }), [patch])

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(items.length > 0, discard.open)

  /* The stage is 9:16 and centred; everything the overlay stores is a fraction
     of THIS rect, so its size is the one number the whole screen agrees on. */
  const stageW = Math.min(W - 24, Math.max(120, (H - 210) * 9 / 16))
  const stageH = Math.round((stageW * 16) / 9)

  /* This screen keeps LIVING under everything it pushes — the sound picker,
     the mix sheet (which builds its own three players), publish. Focus is
     therefore part of the play condition, or the stage and the mix sheet
     preview the same clip in unsynchronised stereo. */
  const [focused, setFocused] = React.useState(true)
  useFocusEffect(React.useCallback(() => {
    setFocused(true)
    return () => setFocused(false)
  }, []))

  const player = useVideoPlayer(draft.videoUri ?? null, p => {
    p.loop = true
    p.timeUpdateEventInterval = 0.25
  })
  const transport = React.useMemo(() => (draft.videoUri ? videoTransport(player) : null), [player, draft.videoUri])

  React.useEffect(() => {
    try {
      /* While a voiceover records the clip keeps ROLLING but muted — the
         author speaks against the moving picture, not a frozen frame. */
      player.muted = voiceMode || previewMuted
      if (focused && (voiceMode || playing)) player.play()
      else player.pause()
    } catch { /* released */ }
  }, [player, previewMuted, playing, voiceMode, focused])

  /* ---- the full soundtrack ------------------------------------------------
     The stage must PLAY what the viewer will hear: the clip's own audio, the
     added sound and the voiceover together, at the draft's mix levels. Before
     this the added sound stayed silent until the mix sheet — an author who
     attached a sound had no way to know it took. Alignment mirrors
     useReelAudioNative exactly: the video is the clock, music wraps modulo
     its own duration (a bed, not a track), the voiceover aligns absolutely
     and goes silent past its own end. */

  const music = useAudioPlayer(bareUrl(draft.sound?.audioUrl) ?? null, { updateInterval: 500 })
  const voice = useAudioPlayer(draft.voiceUri ?? null, { updateInterval: 500 })
  const hasMusic = !!draft.sound
  const hasVoice = !!draft.voiceUri
  const mix = React.useMemo(() => ({ ...DEFAULT_MIX, ...draft.mix }), [draft.mix])

  React.useEffect(() => {
    /* Levels land straight on the players — the author's saved balance, the
       same numbers withMix() will ride out on publish. The master mute (and
       a recording session) silences the added tracks with the clip. */
    try { player.volume = mix.orig } catch { /* released */ }
    try { music.loop = true; music.volume = mix.music; music.muted = previewMuted || voiceMode } catch { /* released */ }
    try { voice.loop = false; voice.volume = mix.voice; voice.muted = previewMuted || voiceMode } catch { /* released */ }
  }, [player, music, voice, mix, previewMuted, voiceMode])

  /* Only a stopped→playing TRANSITION re-cues the still-reel voiceover: this
     effect also re-runs on dep churn while playing (detaching the sound flips
     hasMusic), and a seekTo(0) then would audibly yank the take backwards. */
  const wasOn = React.useRef(false)
  React.useEffect(() => {
    const on = focused && playing && !voiceMode
    /* The session is a full replace and the recorder hands it back on stop —
       re-arm before playing or the added track dies on the iOS silent switch. */
    if (on && (hasMusic || hasVoice)) armReelAudioSession()
    try {
      if (on && hasMusic) { if (!music.playing) music.play() } else music.pause()
    } catch { /* released */ }
    try {
      if (on && hasVoice) {
        /* A still reel has no clock to re-cue the voiceover, so each press of
           play is its cue: start the take from the top. */
        if (!transport && !wasOn.current) voice.seekTo(0).catch(() => {})
        if (!voice.playing) voice.play()
      } else voice.pause()
    } catch { /* released */ }
    wasOn.current = on
  }, [focused, playing, voiceMode, hasMusic, hasVoice, music, voice, transport])

  /* The clip is the clock; a still reel has no clock here, so its added sound
     simply loops free — the synthetic 6s driver is a viewer concern. */
  React.useEffect(() => {
    if (!transport) return
    if (!focused || !playing || voiceMode) return
    if (!hasMusic && !hasVoice) return
    return transport.onTime(time => {
      if (hasMusic) {
        try {
          const d = music.duration
          const at = (Number.isFinite(d) && d > 0) ? time % d : time
          if (Math.abs(music.currentTime - at) > DRIFT) music.seekTo(at).catch(() => {})
          if (!music.playing) music.play()
        } catch { /* not seekable yet */ }
      }
      if (hasVoice) {
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
  }, [transport, focused, playing, voiceMode, hasMusic, hasVoice, music, voice])

  React.useEffect(() => () => {
    try { music.pause() } catch { /* released */ }
    try { voice.pause() } catch { /* released */ }
  }, [music, voice])

  /* ---- voiceover ---------------------------------------------------------- */

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 250)

  const startVoiceover = React.useCallback(async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setVoiceMode(true)
      /* The clip restarts from zero with its ORIGINAL audio muted: the author
         is speaking over it, and hearing it twice makes that impossible. */
      try { player.currentTime = 0; player.muted = true; player.play() } catch { /* released */ }
      fireHaptic('medium')
    } catch {
      toast.error("Couldn't record — check microphone access")
    }
  }, [recorder, player])

  const stopVoiceover = React.useCallback(async () => {
    try {
      await recorder.stop()
      if (recorder.uri) patch({ voiceUri: recorder.uri })
      fireHaptic('success')
    } catch {
      toast.error("Couldn't save that recording")
    } finally {
      setVoiceMode(false)
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {})
      try { player.muted = previewMuted } catch { /* released */ }
    }
  }, [recorder, patch, player, previewMuted])

  /* Losing focus mid-take ENDS the take. The recorder is not focus-gated — it
     would keep rolling under a pushed screen while the paused clip stopped
     being its timeline, and the away-gap would bake into the file. */
  React.useEffect(() => {
    if (!focused && voiceMode) { void stopVoiceover() }
  }, [focused, voiceMode, stopVoiceover])

  /* ---- items -------------------------------------------------------------- */

  /** Returns whether it actually added — the text tool opens its tray on the
   *  LAST item, so a refused add would hand the tray somebody else's words to
   *  overwrite. */
  const addItem = React.useCallback((partial: Partial<OverlayItem>): boolean => {
    if (items.length >= MAX_ITEMS) { toast.warn(`You can add up to ${MAX_ITEMS} items`); return false }
    /* Never two births on the same spot: every earlier build spawned each item
       at the same point, so tapping Text twice stacked one word exactly over
       the other — "the texts are mixed". Each new item steps down the stage
       instead, reading as separate lines from the first frame. */
    const seed = {
      k: 't' as const, text: '', x: 0.5, y: 0.3 + (items.length % 5) * 0.09,
      r: 0, s: 0.1, f: 0, c: 0, a: 1, m: 0, bg: 0,
      ...partial,
    }
    /* A TEXT item is born BLANK — the tray opens over it with the keyboard up
       and its placeholder showing, and closeTray throws the item away if
       nothing gets typed. The old seed word "Text" sat on the clip (and was
       PUBLISHED if the author missed it). cleanItem rightly refuses blank
       text on the wire, so the blank draft bypasses it; glyph picks always
       carry their glyph and keep the full wash. */
    const next = seed.text.trim()
      ? (cleanItem(seed) as OverlayItem | null)
      : (seed as OverlayItem)
    if (!next) return false
    setItems([...items, next])
    setSelected(items.length)
    fireHaptic('light')
    return true
  }, [items, setItems])

  const updateItem = React.useCallback((index: number, next: Partial<OverlayItem>) => {
    setItems(items.map((it, i) => {
      if (i !== index) return it
      const merged = { ...it, ...next }
      /* A BLANK FIELD IS A LEGAL DRAFT STATE. cleanItem refuses it — an empty
         overlay item is not a document — and falling back to the old item made
         the tray impossible to clear: delete the last character and it came
         straight back, because the rejected update kept the previous text.
         The blank lives until the tray closes, which is where it is dropped
         (closeTray), and serialiseOverlay would drop it on publish anyway. */
      if (typeof merged.text === 'string' && !merged.text.trim()) return merged as OverlayItem
      return (cleanItem(merged) as OverlayItem) ?? it
    }))
  }, [items, setItems])

  /* Leaving the text tray on a blank item throws the item away rather than
     leaving an invisible one on the stage counting against MAX_ITEMS. The
     selection goes with it: the indexes have just moved. */
  const closeTray = React.useCallback(() => {
    setTray(null)
    setEditing(null)
    const kept = items.filter(it => String(it.text ?? '').trim().length > 0)
    if (kept.length !== items.length) { setItems(kept); setSelected(null) }
  }, [items, setItems])

  const goNext = React.useCallback(() => {
    const doc = serialiseOverlay(items, draft.fit)
    if (doc && JSON.stringify(doc).length > MAX_BYTES) {
      toast.warn("That's too much text to attach — remove an item.")
      return
    }
    router.push('/reels/compose/publish')
  }, [items, draft.fit, router])

  const hasMedia = !!(draft.videoUri || draft.imageUri)
  const mixEnabled = !!draft.sound || !!draft.voiceUri

  /* How long the clip is, stated once. A live clock would mean re-rendering
     the whole stage four times a second to move two digits; the LENGTH is the
     number an author is actually deciding against, and it does not change. */
  const clipLength = React.useMemo(() => {
    const secs = Math.round((draft.durationMs || 0) / 1000)
    return secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : null
  }, [draft.durationMs])

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <ComposerHeader
        title="Edit"
        step="Step 2 of 3"
        onBack={() => (items.length ? discard.open() : router.back())}
        onHeight={setHeaderH}
        /* A WHITE plate carrying Oxford ink. This is the one action that moves
           the composer forward and it sits on a black stage — paper is the
           brightest thing that can sit there, and the navy label reads at
           15.4:1. Cerulean stays for the in-stage actions (Done/Save); the
           forward action wears paper so the two are never confused. */
        action={<Button label="Next" onPress={goNext} variant="paper" size="sm" />}
      />

      <View style={styles.stageWrap}>
        <View style={[styles.stage, { width: stageW, height: stageH }]}>
          {draft.videoUri ? (
            /* key: re-picking a clip releases the old player under this view
               — swapped as a pair, never re-propped ("already released"). */
            <VideoView
              key={draft.videoUri}
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              nativeControls={false}
            />
          ) : draft.imageUri ? (
            <Image source={{ uri: draft.imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : (
            <View style={styles.noMedia}>
              <Icon name="video" size={30} color={STAGE.fgFaint} />
              <Text variant="footnote" color={STAGE.fgMuted} align="center" style={{ marginTop: space.sm2 }}>
                No clip yet — go back and record or import one.
              </Text>
            </View>
          )}

          <Touchable
            onPress={() => setSelected(null)}
            feedback="none"
            noAutoHitSlop
            accessibilityLabel="Deselect"
            style={StyleSheet.absoluteFill}
          >
            <View />
          </Touchable>

          {hasMedia ? (
            <OverlayEditorStage
              items={items}
              setItems={setItems}
              fit={draft.fit}
              /* The stage IS 9:16, so the media rect is the stage rect — the
                 numbers written here are exactly what the viewer re-derives. */
              mediaW={9}
              mediaH={16}
              box={{ width: stageW, height: stageH }}
              selected={selected}
              onSelect={setSelected}
              onEditText={i => { setEditing(i); setTray('text') }}
            />
          ) : null}

          {items.length >= 8 ? (
            <View style={[styles.counter, items.length >= MAX_ITEMS ? styles.counterWarn : null]} pointerEvents="none">
              <Text variant="micro" weight="700" color={items.length >= MAX_ITEMS ? STAGE.warn : STAGE.fg}>
                items {items.length}/{MAX_ITEMS}
              </Text>
            </View>
          ) : null}

          {voiceMode ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn}
              exiting={reduceMotion ? undefined : FadeOut}
              style={styles.recordingPill}
              pointerEvents="none"
            >
              <View style={styles.recordingDot} />
              <Text variant="caption" weight="700" color={STAGE.fg}>
                Recording… {Math.round((recorderState.durationMillis ?? 0) / 1000)}s
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>

      {!voiceMode ? (
        <View style={[styles.tools, { top: (headerH || insets.top + 62) + 10 }]} pointerEvents="box-none">
          <Tool
            icon="edit"
            label="Text"
            onPress={() => {
              setEditing(null)
              /* Only open the tray on an item that exists BECAUSE of this tap. */
              if (addItem({ k: 't' })) setTray('text')
            }}
          />
          <Tool icon="emoji" label="Emoji" onPress={() => setTray('emoji')} />
          <Tool icon="sticker" label="Stickers" onPress={() => setTray('sticker')} />
          <Tool icon="music" label="Sound" active={!!draft.sound} onPress={() => router.push('/reels/compose/sound')} />
          <Tool icon="mic" label="Voice" active={!!draft.voiceUri} onPress={() => { void startVoiceover() }} />
          <Tool
            icon="filter"
            label="Mix"
            disabled={!mixEnabled}
            onPress={() => {
              if (!mixEnabled) { toast.info('Add a sound or record a voiceover first'); return }
              router.push('/reels/compose/mix')
            }}
          />
        </View>
      ) : null}

      {voiceMode ? (
        <View style={[styles.voiceBar, { bottom: insets.bottom + 16 }]}>
          <Button label="Stop recording" onPress={() => { void stopVoiceover() }} variant="danger" size="lg" block />
        </View>
      ) : (
        <View style={[styles.transport, { paddingBottom: insets.bottom + 8 }]}>
          {draft.sound ? (
            /* The attached sound, named and audible in the same breath — the
               row confirms what the ears are already hearing. */
            <View style={styles.voiceRow}>
              <Icon name="music" size={13} color={STAGE.fg} />
              <Text variant="caption" color={STAGE.fgMuted} numberOfLines={1} style={{ flex: 1 }}>
                {draft.sound.title}{draft.sound.artist ? ` · ${draft.sound.artist}` : ''}
              </Text>
              <Touchable onPress={() => router.push('/reels/compose/sound')} feedback="dim" noAutoHitSlop>
                <Text variant="caption" weight="600" color={t.colors.cta}>Change</Text>
              </Touchable>
              <Touchable onPress={() => patch({ sound: null })} feedback="dim" noAutoHitSlop accessibilityLabel="Detach sound">
                <Icon name="close" size={13} color={STAGE.fgMuted} />
              </Touchable>
            </View>
          ) : null}
          {draft.voiceUri ? (
            <View style={styles.voiceRow}>
              <Icon name="mic" size={13} color={STAGE.fg} />
              <Text variant="caption" color={STAGE.fgMuted} style={{ flex: 1 }}>Voiceover recorded</Text>
              <Touchable onPress={() => { void startVoiceover() }} feedback="dim" noAutoHitSlop>
                <Text variant="caption" weight="600" color={t.colors.cta}>Re-record</Text>
              </Touchable>
              <Touchable onPress={() => patch({ voiceUri: null })} feedback="dim" noAutoHitSlop accessibilityLabel="Delete voiceover">
                <Icon name="close" size={13} color={STAGE.fgMuted} />
              </Touchable>
            </View>
          ) : null}

          <View style={styles.transportRow}>
            <Touchable
              onPress={() => setPlaying(p => !p)}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}
              style={styles.transportBtn}
            >
              <Icon name={playing ? 'pause' : 'play'} size={19} color={STAGE.fg} filled />
            </Touchable>

            {/* Measured, not derived: the scrub fraction is x / width, so a
                guessed width puts the playhead in the wrong place. */}
            <View
              style={styles.scrubSlot}
              onLayout={e => setScrubWidth(e.nativeEvent.layout.width)}
            >
              {transport && scrubWidth > 0
                ? <ReelProgressBar transport={transport} width={scrubWidth} bottom={0} />
                : null}
            </View>

            {clipLength ? (
              <NumericText variant="caption" color={STAGE.fgMuted}>{clipLength}</NumericText>
            ) : null}

            <Touchable
              onPress={() => setPreviewMuted(m => !m)}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={previewMuted ? 'Unmute preview' : 'Mute preview'}
              style={styles.transportBtn}
            >
              <Icon name={previewMuted ? 'mute' : 'volume'} size={18} color={STAGE.fg} />
            </Touchable>
          </View>
        </View>
      )}

      {tray === 'text' ? (
        <TextTray
          item={editing != null ? items[editing] : items[items.length - 1]}
          onChange={next => updateItem(editing != null ? editing : items.length - 1, next)}
          onClose={closeTray}
          reduceMotion={reduceMotion}
        />
      ) : null}

      {tray === 'emoji' ? (
        <GlyphTray
          title="Emoji"
          columns={6}
          entries={EMOJI.map((g: string) => ({ glyph: g, label: g, motion: 0 }))}
          onPick={e => { addItem({ k: 'e', text: e.glyph, s: 0.16, m: e.motion }); setTray(null) }}
          onClose={() => setTray(null)}
        />
      ) : null}

      {tray === 'sticker' ? (
        <GlyphTray
          title="Stickers"
          columns={4}
          entries={STICKERS.map((s: any) => ({ glyph: s.g, label: s.label, motion: s.m }))}
          onPick={e => { addItem({ k: 's', text: e.glyph, s: 0.2, m: e.motion }); setTray(null) }}
          onClose={() => setTray(null)}
        />
      ) : null}

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard changes?"
        message="The text and stickers you added are thrown away. Your clip is kept."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { patch({ items: [] }); discard.close(); router.back() }}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   The tools and trays live in components/media/OverlayTools —
   the story composer wears the same ones. Two copies of a
   colour palette and a font list drift within a week.
   --------------------------------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.black },
  stageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { borderRadius: 12, overflow: 'hidden', backgroundColor: STAGE.plate },
  noMedia: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  tools: { position: 'absolute', end: 6, gap: space.md },
  /* Wide enough for the longest label at this tracking (STICKERS), clipped
     rather than trusted: a label that bleeds past the wrap runs off the screen
     edge instead of ellipsing. */
  /* An attached sound or a recorded voiceover is a STATE, and a filled glyph
     alone is too quiet to read against a moving clip. */
  /* Chips, not pills (DESIGN.md §8.9). */
  counter: {
    position: 'absolute',
    top: 10,
    start: 10,
    paddingHorizontal: space.sm,
    height: 20,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterWarn: { backgroundColor: STAGE.warnSoft },
  recordingPill: {
    position: 'absolute',
    alignSelf: 'center',
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 28,
    paddingHorizontal: space.md,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: STAGE.record },
  transport: { paddingHorizontal: space.lg, gap: space.sm2 },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 44 },
  scrubSlot: { flex: 1, height: 30, justifyContent: 'center' },
  transportBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  voiceBar: { position: 'absolute', left: 20, right: 20 },
  /* The tray is docked by the layout now, not by absolute coordinates — that
     is what lets the keyboard avoider move it. */
  /* The pill hugs the words on the stage, so it hugs them here too rather than
     washing the whole field. */
})
