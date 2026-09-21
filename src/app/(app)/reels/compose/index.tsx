/* =========================================================
   Composer, step 1 — capture or import.

   Segments only where they are HONEST: with the native muxer
   present every take appends and the clips editor can really
   remove one; without it re-record replaces and import
   replaces, because a backspace that cannot touch the file
   would be a lie told forty times a day.

   While recording, the chrome gets out of the way: the whole
   stage is the viewfinder, and the only things left on it are
   the elapsed-time chip and the stop button — the same
   discipline every capture app the user already knows keeps.

   Nothing is uploaded on this screen, so it works fully
   offline — only the sound pill needs a connection.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
/* SDK 57's root `expo-media-library` export is the new class-based API
   (Query / Asset / Album). `getAssetsAsync`, `MediaType` and `SortBy` moved to
   the compatibility entry point, exactly as `expo-file-system` did. */
import * as MediaLibrary from 'expo-media-library/legacy'
import { Image } from 'expo-image'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useComposerInsets } from '@/components/reels/ComposerChrome'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { api, errorText, isNotFound } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { prepareUpload, type PickedAsset } from '@/lib/mediaTier'
import { useReelDraft } from '@/components/reels/ReelDraft'
import { hasVideoComposer } from '../../../../../modules/video-composer'
import { STAGE, TEXT_SHADOW_STRONG } from '@/components/reels/skin'
import type { ViewSound } from '@/components/reels/types'
import { setback, shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { Button, ConfirmSheet, Icon, NumericText, Spinner, Text, Touchable, fireHaptic, toast, useSheetState } from '@/ui'

const CAPS = [15, 60, 90] as const
const TIMERS = [0, 3, 10] as const
/* The capture speeds the native composer can honour at export — the camera
   itself always records at 1×; the stamp rides the clip into clips.tsx. */
const SPEEDS = [0.5, 1, 2] as const
const RING = 76
const STROKE = 4
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/* The record blob at rest and at full record: a 52pt circle becoming a 30pt
   rounded square. It is laid out ONCE at REC_SIZE and scaled from there. */
const REC_SIZE = 52
const REC_SHRINK = 22
const REC_R = 26
const REC_R_MIN = 8

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export default function ComposeCaptureScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useComposerInsets()
  const { draft, patch, reset, isDirty } = useReelDraft()
  const params = useLocalSearchParams<{ soundId?: string }>()

  const camera = React.useRef<CameraView>(null)
  const [camPerm, requestCam] = useCameraPermissions()
  const [micPerm, requestMic] = useMicrophonePermissions()

  const [facing, setFacing] = React.useState<'back' | 'front'>('back')
  /* TORCH, not `flash`: this screen only ever records video (mode="video",
     recordAsync), and expo-camera's flash prop fires solely on still capture —
     the old Off/On/Auto chip was a no-op. Continuous light is what video can
     actually have. */
  const [torch, setTorch] = React.useState(false)
  const [cap, setCap] = React.useState<number>(60)
  const [speed, setSpeed] = React.useState<number>(1)
  const [timer, setTimer] = React.useState<number>(0)
  const [countdown, setCountdown] = React.useState(0)
  const [recording, setRecording] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [zoom, setZoom] = React.useState(0)
  const [galleryThumb, setGalleryThumb] = React.useState<string | null>(null)
  const [attaching, setAttaching] = React.useState(false)

  const discard = useSheetState()

  /* The provider rehydrates the device draft SILENTLY, so tapping "create"
     used to land inside last week's half-made reel with no explanation. One
     sheet on entry names it; "Resume" is the no-op because resuming already
     happened, "Start fresh" is the reset. Once per mount, and only when the
     entry was blind — a ?soundId hand-off is an intent of its own. */
  const resumeSheet = useSheetState()
  const resumeAsked = React.useRef(false)
  React.useEffect(() => {
    if (resumeAsked.current) return
    resumeAsked.current = true
    if (isDirty && !params.soundId) resumeSheet.open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Hardware back runs the same guard as the header's back chevron — a
     recorded clip is not something the user can retake by retyping. */
  useDiscardGuard(isDirty, discard.open)

  const progress = useSharedValue(0)
  const recordTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /* Both gestures are supported, and Pressable fires onPress on EVERY release —
     so a hold has to mark the release as already handled or the tap handler
     would immediately re-arm what the hold just stopped. */
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const holding = React.useRef(false)
  const releaseHandled = React.useRef(false)

  /* ---- arriving with a sound already chosen -------------------------------- */
  React.useEffect(() => {
    const soundId = params.soundId
    if (!soundId || draft.sound?.id === soundId) return
    let alive = true
    setAttaching(true)
    api.sounds.get(soundId)
      .then((s: ViewSound | null) => {
        if (!alive) return
        if (s?.status && s.status !== 'APPROVED') throw Object.assign(new Error('gone'), { status: 404 })
        patch({ sound: s })
      })
      .catch(e => {
        if (!alive) return
        patch({ sound: null })
        toast.warn(isNotFound(e) ? 'That sound is no longer available.' : errorText(e))
      })
      .finally(() => { if (alive) setAttaching(false) })
    return () => { alive = false }
  }, [params.soundId])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- gallery thumbnail --------------------------------------------------- */
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      /* Asked for lazily: the library permission prompt on a camera screen the
         user has not tried to import from yet is pure noise. */
      const perm = await MediaLibrary.getPermissionsAsync().catch(() => null)
      if (!perm?.granted || !alive) return
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: [MediaLibrary.MediaType.video],
        first: 1,
        sortBy: [MediaLibrary.SortBy.creationTime],
      }).catch(() => null)
      if (alive && page?.assets?.[0]) setGalleryThumb(page.assets[0].uri)
    })()
    return () => { alive = false }
  }, [])

  React.useEffect(() => () => {
    if (recordTimer.current) clearTimeout(recordTimer.current)
    if (holdTimer.current) clearTimeout(holdTimer.current)
  }, [])

  /* ---- capture ------------------------------------------------------------- */

  /* The cap is an OUTPUT promise. Slow motion stretches its source — a 0.5×
     take exports twice as long as it recorded — so the recording window
     shrinks with the speed; fast speeds shorten output and keep the window. */
  const sourceCap = speed < 1 ? Math.max(1, Math.round(cap * speed)) : cap

  const beginRecording = React.useCallback(async () => {
    if (!camera.current || recording) return
    setRecording(true)
    fireHaptic('medium')
    progress.value = 0
    progress.value = withTiming(1, { duration: sourceCap * 1000 })
    const startedAt = Date.now()
    try {
      const result = await camera.current.recordAsync({ maxDuration: sourceCap })
      if (result?.uri) {
        /* The recorder reports no duration, so the take is stamped with its
           own WALL-CLOCK length (capped) — a real number, where the old
           cap-sized stamp made three short takes read as 3×cap and trip the
           clip editor's 90s gate. The editor still corrects endMs from the
           player when it can. With the native composer present, a SECOND take
           APPENDS instead of replacing; videoUri goes null until the editor
           exports. A non-1× speed forces the export path even for a first
           take — the raw recording is not the reel when a retime is stamped
           on it. */
        const tookMs = Math.max(1000, Math.min(sourceCap * 1000, Date.now() - startedAt))
        const clip = { uri: result.uri, durationMs: tookMs, startMs: 0, endMs: tookMs, speed: hasVideoComposer ? speed : 1 }
        if (hasVideoComposer && (draft.clips.length || speed !== 1)) {
          patch({ clips: [...draft.clips, clip], videoUri: null, imageUri: null })
        } else {
          /* REPLACE discards what was made ON the old clip — cover, voiceover,
             overlay — exactly as the discard chip does; posting last take's
             cover on this take would be worse than no cover. */
          patch({ clips: [clip], videoUri: result.uri, imageUri: null, durationMs: tookMs, coverUri: null, voiceUri: null, items: [] })
        }
        fireHaptic('success')
      }
    } catch {
      toast.error("Couldn't record that clip — try again.")
    } finally {
      setRecording(false)
      progress.value = withTiming(0, { duration: t.ms(200) })
    }
  }, [recording, sourceCap, speed, patch, progress, t, draft.clips])

  const stopRecording = React.useCallback(() => {
    if (!recording) return
    camera.current?.stopRecording()
    fireHaptic('light')
  }, [recording])

  /* useEvent, not a closure: the countdown chain outlives the render that
     armed it, and a cap or speed changed mid-countdown must fire the CURRENT
     beginRecording — the stale one records to the old window and stamps the
     old speed while the chrome shows the new. */
  const fireRecording = useEvent(() => { void beginRecording() })

  const armRecording = React.useCallback(() => {
    if (recording) { stopRecording(); return }
    /* A LIVE countdown is cancelled by the next press, never doubled — two
       timer chains used to race each other into a phantom recording. */
    if (countdown > 0) {
      if (recordTimer.current) { clearTimeout(recordTimer.current); recordTimer.current = null }
      setCountdown(0)
      fireHaptic('light')
      return
    }
    if (!timer) { fireRecording(); return }
    setCountdown(timer)
    const step = (n: number) => {
      if (n <= 0) { setCountdown(0); fireRecording(); return }
      setCountdown(n)
      fireHaptic('select')
      recordTimer.current = setTimeout(() => step(n - 1), 1000)
    }
    step(timer)
  }, [recording, countdown, timer, fireRecording, stopRecording])

  const importMedia = React.useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { toast.warn('Photo library access is off'); return }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      videoMaxDuration: 90,
      allowsEditing: false,
      quality: 1,
    })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    const isVideo = asset.type === 'video'
    /* A photo cannot join a clip reel, and silently REPLACING recorded takes
       with it is how work disappears — refuse, and name the way out. */
    if (!isVideo && draft.clips.length) {
      toast.warn('You have recorded clips — discard them first to make a photo reel.')
      return
    }
    /* An imported STILL becomes the reel's own pixels, so it goes through the
       media tier like every other upload in the app — downscaled to the user's
       chosen long edge before it is ever the draft, which keeps the editor's
       preview and the posted frame the same picture. Video is handed back
       untouched: there is no transcoder here, and the server owns that cap. */
    const source = isVideo
      ? asset.uri
      : (await prepareUpload({ ...(asset as unknown as PickedAsset), type: 'image' })).uri
    if (isVideo && hasVideoComposer && draft.clips.length) {
      const dur = Math.max(1000, Math.round(asset.duration ?? 0))
      patch({
        clips: [...draft.clips, { uri: source, durationMs: dur, startMs: 0, endMs: dur, speed: 1 }],
        videoUri: null,
        imageUri: null,
      })
    } else {
      const dur = isVideo ? Math.max(1000, Math.round(asset.duration ?? 0)) : 6000
      patch({
        videoUri: isVideo ? source : null,
        imageUri: isVideo ? null : source,
        clips: isVideo ? [{ uri: source, durationMs: dur, startMs: 0, endMs: dur, speed: 1 }] : [],
        /* A still reel gets the same 6s synthetic length the viewer's clock uses,
           so the progress bar and the added sound agree with the editor. */
        durationMs: dur,
        /* Replacing the media discards what was made ON the old media — same
           law as re-record and the discard chip. */
        coverUri: null,
        voiceUri: null,
        items: [],
      })
    }
    fireHaptic('success')
  }, [patch, draft.clips])

  /* ---- gestures ------------------------------------------------------------ */

  /* Stable, so `facing` drops out of the gesture's deps entirely — otherwise a
     flip rebuilds the composed gesture and re-registers it natively. */
  const toggleFacing = useEvent(() => setFacing(f => (f === 'back' ? 'front' : 'back')))

  /* The last value handed to React. Lives on the UI thread because the compare
     happens inside the worklet, before the hop. */
  const pushedZoom = useSharedValue(0)

  /* ONE gesture object for the life of the screen. GestureDetector re-registers
     the whole config natively when the identity changes, and a config swap
     mid-pinch — while the camera is already saturating the device — is how the
     gesture gets dropped. */
  const preview = React.useMemo(() => {
    const pinch = Gesture.Pinch().onUpdate(e => {
      'worklet'
      /* Quantised to 1/50ths before it crosses to React: `zoom` is state read by
         <CameraView>, so an unrounded float re-renders the live camera, the
         record ring and the rail on every frame of the pinch. 50 steps is finer
         than the eye reads on a 1.0-range zoom. */
      const z = Math.round(Math.min(1, Math.max(0, (e.scale - 1) * 0.35)) * 50) / 50
      if (z === pushedZoom.value) return
      pushedZoom.value = z
      runOnJS(setZoom)(z)
    })
    const flip = Gesture.Tap().numberOfTaps(2).onEnd((_e, ok) => {
      if (ok) runOnJS(toggleFacing)()
    })
    return Gesture.Simultaneous(pinch, flip)
  }, [pushedZoom, toggleFacing])

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }))

  /* The circle-to-square morph is the ONLY real confirmation that recording
     started — the ring is a hairline and the countdown is already gone. Snapped,
     it reads as a glitch, so it rides the house spring; reduced motion keeps the
     cut it had. */
  const rec = useSharedValue(0)
  React.useEffect(() => {
    rec.value = t.prefs.reducedMotion
      ? (recording ? 1 : 0)
      : withSpring(recording ? 1 : 0, t.motion.spring)
  }, [recording, rec, t])
  /* SCALE, not width+height. The blob is a square, so one uniform scale is the
     exact equivalent of shrinking both sides — and it keeps the morph off the
     layout path on the one screen where the GPU is already carrying a live
     preview. The radius is PRE-DIVIDED by that scale because the transform
     multiplies it back: REC_R→REC_R_MIN drawn at 1→0.577 is pixel-for-pixel
     what the width/height version drew. Delete the division and the stop
     square's corners quietly go round again. */
  const innerStyle = useAnimatedStyle(() => {
    const s = (REC_SIZE - rec.value * REC_SHRINK) / REC_SIZE
    return {
      borderRadius: (REC_R - rec.value * (REC_R - REC_R_MIN)) / s,
      transform: [{ scale: s }],
    }
  })

  const hasClip = !!(draft.videoUri || draft.imageUri || draft.clips.length)
  const soundLabelText = draft.sound
    ? [draft.sound.title, draft.sound.artist].filter(Boolean).join(' · ')
    : 'Add sound'

  /* ---- permissions --------------------------------------------------------- */

  if (!camPerm || !micPerm) {
    return <View style={styles.root}><Spinner size="large" /></View>
  }

  if (!camPerm.granted || !micPerm.granted) {
    const askable = camPerm.canAskAgain && micPerm.canAskAgain
    return (
      <View style={[styles.root, styles.permission]}>
        <StatusBar style="light" />
        <Icon name="camera" size={40} color={STAGE.fgFaint} />
        <Text variant="title3" color={STAGE.fg} align="center" style={{ marginTop: space.md2 }}>Camera access is off</Text>
        <Text variant="callout" color={STAGE.fgMuted} align="center" style={{ marginTop: space.xs2, maxWidth: 300 }}>
          Allow camera and microphone to record a reel.
        </Text>
        <Button
          label={askable ? 'Allow access' : 'Open settings'}
          onPress={() => {
            if (askable) { void requestCam(); void requestMic() }
            else void Linking.openSettings()
          }}
          variant="onDark"
          size="lg"
          style={{ marginTop: 22 }}
        />
        <Button label="Import instead" onPress={() => { void importMedia() }} variant="ghost" size="md" style={{ marginTop: space.xs }} />
        <Button label="Cancel" onPress={() => router.back()} variant="ghost" size="sm" style={{ marginTop: space.sm }} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <GestureDetector gesture={preview}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <CameraView
            ref={camera}
            facing={facing}
            mode="video"
            enableTorch={torch}
            zoom={zoom}
            onCameraReady={() => setReady(true)}
            style={StyleSheet.absoluteFill}
          />
          {!ready ? <View style={[StyleSheet.absoluteFill, styles.warmup]}><Spinner size="large" /></View> : null}
        </View>
      </GestureDetector>

      {/* While recording the chrome stands down: the stage is the viewfinder
          and the only things on it are the clock and the stop button. */}
      {!recording ? (
        <View style={[styles.topBar, { top: insets.top + 10 }]} pointerEvents="box-none">
          <Touchable
            onPress={() => (isDirty ? discard.open() : router.back())}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="Close composer"
            style={styles.glassButton}
          >
            <Icon name="close" size={22} color={STAGE.fg} />
          </Touchable>

          <Touchable
            onPress={() => router.push('/reels/compose/sound')}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel={draft.sound ? 'Change sound' : 'Add sound'}
            style={styles.soundPill}
          >
            <Icon name="music" size={13} color={STAGE.fg} />
            <Text variant="caption" weight="600" color={STAGE.fg} numberOfLines={1} style={{ maxWidth: 150 }}>
              {attaching ? 'Loading sound…' : soundLabelText}
            </Text>
            {draft.sound ? (
              <Touchable onPress={() => patch({ sound: null })} feedback="dim" accessibilityLabel="Remove sound">
                <Icon name="close" size={12} color={STAGE.fgMuted} />
              </Touchable>
            ) : null}
          </Touchable>

          <Touchable
            onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="Flip camera"
            style={styles.glassButton}
          >
            <Icon name="refresh" size={20} color={STAGE.fg} />
          </Touchable>
        </View>
      ) : (
        <View style={[styles.recBar, { top: insets.top + 10 }]} pointerEvents="none">
          <ElapsedChip cap={sourceCap} />
        </View>
      )}

      {!recording ? (
        <View style={[styles.rail, { top: insets.top + 68 }]} pointerEvents="box-none">
          <RailChip
            icon="bolt"
            label={torch ? 'On' : 'Light'}
            active={torch}
            onPress={() => setTorch(v => !v)}
          />
          <RailChip
            icon="clock"
            label={timer ? `${timer}s` : 'Timer'}
            active={timer > 0}
            onPress={() => setTimer(v => TIMERS[(TIMERS.indexOf(v as any) + 1) % TIMERS.length])}
          />
          {hasVideoComposer ? (
            <RailChip
              icon="trending"
              label={speed === 1 ? 'Speed' : `${speed}×`}
              active={speed !== 1}
              onPress={() => setSpeed(v => SPEEDS[(SPEEDS.indexOf(v as any) + 1) % SPEEDS.length])}
            />
          ) : null}
        </View>
      ) : null}

      {countdown > 0 ? (
        <View style={styles.countdown} pointerEvents="none">
          <Text variant="display" color={STAGE.fg} align="center" style={styles.countdownNumeral}>{countdown}</Text>
        </View>
      ) : null}

      {hasClip && !recording ? (
        <View style={[styles.clipChip, { bottom: insets.bottom + 150 }]} pointerEvents="box-none">
          <Icon name="checkCircle" size={13} color={STAGE.fg} filled />
          <Text variant="caption" weight="600" color={STAGE.fg}>
            {draft.imageUri
              ? 'Photo ready'
              : hasVideoComposer && draft.clips.length > 1
                ? `${draft.clips.length} clips · record to add more`
                : hasVideoComposer && draft.clips.length === 1
                  ? 'Clip ready · record to add more'
                  : 'Clip ready'}
          </Text>
          {hasVideoComposer && !draft.imageUri && draft.clips.length > 0 ? (
            <Touchable onPress={() => router.push('/reels/compose/clips')} feedback="dim" accessibilityLabel="Edit clips">
              <Icon name="edit" size={12} color={STAGE.fg} />
            </Touchable>
          ) : null}
          {/* Discarding the media discards what was MADE ON it — the cover cut
              from its frames, the voiceover spoken over it, the overlay laid
              on it. The sound survives: it was chosen, not derived. */}
          <Touchable onPress={() => patch({ videoUri: null, imageUri: null, durationMs: 0, clips: [], coverUri: null, voiceUri: null, items: [] })} feedback="dim" accessibilityLabel="Discard clip">
            <Icon name="close" size={12} color={STAGE.fgMuted} />
          </Touchable>
        </View>
      ) : null}

      {/* Duration, chosen where the thumb already is — a row over the record
          button, not a cycling chip half a screen away. */}
      {!recording ? (
        <View style={[styles.capRow, { bottom: insets.bottom + 108 }]} pointerEvents="box-none">
          {CAPS.map(v => (
            <Touchable
              key={v}
              onPress={() => setCap(v)}
              feedback="dim"
              accessibilityLabel={`Record up to ${v} seconds`}
              accessibilityState={{ selected: cap === v }}
              style={[styles.capBtn, cap === v ? styles.capBtnOn : null]}
            >
              <Text variant="caption" weight={cap === v ? '700' : '600'} color={cap === v ? STAGE.fg : STAGE.fgMuted} style={styles.railLabel}>
                {v}s
              </Text>
            </Touchable>
          ))}
        </View>
      ) : null}

      <View style={[styles.bottom, { bottom: insets.bottom + 22 }]} pointerEvents="box-none">
        <View style={styles.bottomSlot} pointerEvents="box-none">
          {!recording ? (
            <Touchable
              onPress={() => { void importMedia() }}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel="Import from library"
              style={styles.galleryWrap}
            >
              <View style={styles.galleryBtn}>
                {galleryThumb ? (
                  <Image source={{ uri: galleryThumb }} style={styles.galleryImg} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Icon name="gallery" size={20} color={STAGE.fg} />
                )}
              </View>
              <Text variant="micro" color={STAGE.fg} style={styles.railLabel}>Gallery</Text>
            </Touchable>
          ) : null}
        </View>

        <Touchable
          onPressIn={() => {
            holdTimer.current = setTimeout(() => { holding.current = true; armRecording() }, 350)
          }}
          onPressOut={() => {
            if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
            if (!holding.current) return
            holding.current = false
            releaseHandled.current = true
            stopRecording()
          }}
          onPress={() => {
            if (releaseHandled.current) { releaseHandled.current = false; return }
            armRecording()
          }}
          feedback="none"
          noAutoHitSlop
          accessibilityLabel={recording ? 'Stop recording' : 'Record'}
          style={styles.recordWrap}
        >
          <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              stroke={STAGE.fgGhost}
              strokeWidth={STROKE}
              fill="none"
            />
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              stroke={STAGE.fg}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              animatedProps={arc}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <Animated.View style={[styles.recordInner, innerStyle]} />
        </Touchable>

        <View style={[styles.bottomSlot, { alignItems: 'flex-end' }]} pointerEvents="box-none">
          {!recording && hasClip ? (
            /* The forward action appears WHEN there is something to move
               forward — a white plate carrying Oxford ink, the brightest
               thing on the stage (Button variant="paper"). */
            <Button
              label="Next"
              onPress={() => router.push(hasVideoComposer && draft.clips.length > 0 && !draft.videoUri && !draft.imageUri ? '/reels/compose/clips' : '/reels/compose/edit')}
              variant="paper"
              size="md"
            />
          ) : null}
        </View>
      </View>

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard this reel?"
        message="Your clip, overlay and caption are all thrown away."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { reset(); discard.close(); router.back() }}
      />

      {/* Cancel = Resume, deliberately: the reflex press keeps the draft, and
          only the marked action destroys it. */}
      <ConfirmSheet
        visible={resumeSheet.visible}
        onClose={resumeSheet.close}
        title="Resume your draft?"
        message="A reel you started earlier is still on this phone. Resuming keeps its clip, overlay and caption."
        confirmLabel="Start fresh"
        cancelLabel="Resume draft"
        destructive
        onConfirm={() => { reset(); resumeSheet.close() }}
      />
    </View>
  )
}

/* Its own component so the once-a-second tick re-renders one chip, not the
   live camera under it. */
function ElapsedChip({ cap }: { cap: number }) {
  const [secs, setSecs] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setSecs(s => Math.min(cap, s + 1)), 1000)
    return () => clearInterval(id)
  }, [cap])
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
  return (
    <View style={styles.recChip}>
      <View style={styles.recDot} />
      <NumericText variant="caption" weight="700" color={STAGE.fg}>
        {fmt(secs)} / {fmt(cap)}
      </NumericText>
    </View>
  )
}

function RailChip({
  icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <Touchable onPress={onPress} feedback="scale" noAutoHitSlop accessibilityLabel={label} style={styles.railChip}>
      {/* A PLATE, not bare glyphs. This rail floats on the live camera, which
          is white as often as it is dark — an unplated white icon over a bright
          sky is 1:1, i.e. gone. The disc is the same one the edit stage's tools
          wear, so the two screens read as one composer. */}
      <View style={[styles.railDisc, active ? styles.railDiscOn : null]}>
        <Icon name={icon} size={19} color={STAGE.fg} filled={active} />
      </View>
      <Text variant="micro" color={STAGE.fg} style={styles.railLabel}>{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.black, alignItems: 'center', justifyContent: 'center' },
  permission: { paddingHorizontal: space.xxxl },
  warmup: { alignItems: 'center', justifyContent: 'center', backgroundColor: STAGE.black },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  /* Over the live camera, so the same rule as the edit rail: a stronger plate
     rather than dimmer ink. */
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Chips, not pills — the only pills in the app are unread counters and the
     LIVE badge (DESIGN.md §8.9). The record button and the round glass buttons
     keep their circles: icon-only controls are sanctioned. */
  soundPill: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.md,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
  },
  rail: { position: 'absolute', end: 12, gap: 22, alignItems: 'center' },
  railChip: { alignItems: 'center', gap: space.xs, width: 48 },
  railDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDiscOn: { borderWidth: StyleSheet.hairlineWidth, borderColor: STAGE.hairline },
  railLabel: { letterSpacing: 0.2, ...TEXT_SHADOW_STRONG },
  countdown: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  countdownNumeral: { fontSize: 96, lineHeight: 108 },
  clipChip: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 30,
    paddingHorizontal: space.md,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
  },
  /* Equal side slots keep the record button truly centred whatever the
     gallery column and the Next plate happen to measure. */
  bottomSlot: { width: 96, alignItems: 'flex-start', justifyContent: 'center' },
  galleryWrap: { alignItems: 'center', gap: space.xs },
  /* The paper edge is what says "these are the library's pixels, not the
     viewfinder's" — the thumbnail underneath is arbitrary imagery. */
  galleryBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: STAGE.fg,
    overflow: 'hidden',
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryImg: { width: 44, height: 44 },
  recordWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  recordInner: { width: REC_SIZE, height: REC_SIZE, backgroundColor: STAGE.record },
  capRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
  },
  /* Chips, not pills (DESIGN.md §8.9) — the active length wears the same
     glass the rest of the chrome does. */
  capBtn: {
    height: 28,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  capBtnOn: { backgroundColor: STAGE.glassStrong },
  recBar: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  recChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 30,
    paddingHorizontal: space.md,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: STAGE.record },
})
