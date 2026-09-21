/* =========================================================
   Composer, step 1½ — the clip editor.

   Trim, retime, reorder and delete the recorded/imported
   segments, then EXPORT: the native video-composer bakes the
   recipe into one real .mp4 and hands it to the normal flow
   (draft.videoUri), so nothing downstream — overlay, mix,
   publish, moderation — knows multi-clip ever happened. A
   preview-only editor that posted the unedited file would be
   a lie; this screen only exists when the exporter does
   (hasVideoComposer), and the camera never routes here
   without it.

   The recorder reports no duration (the camera stamps the cap
   as an upper bound), so the preview player's own duration
   corrects each clip's endMs the first time it loads.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { VideoView, useVideoPlayer } from 'expo-video'
import { useEvent as useExpoEvent } from 'expo'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Chip, Icon, NumericText, Sheet, Spinner, Text, Touchable, fireHaptic, toast } from '@/ui'
import { useReelDraft, type DraftClip } from '@/components/reels/ReelDraft'
import { ComposerHeader } from '@/components/reels/ComposerChrome'
import { STAGE } from '@/components/reels/skin'
import { composeVideo, hasVideoComposer } from '../../../../../modules/video-composer'

/* The platform's top cap; the camera's own 15/60/90 modes stay tighter. */
const MAX_TOTAL_MS = 90_000
const MIN_CLIP_MS = 500
const SPEEDS = [0.5, 1, 1.5, 2] as const

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const trimmedMs = (c: DraftClip) => Math.max(0, c.endMs - c.startMs) / (c.speed || 1)

export default function ComposeClipsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { draft, patch } = useReelDraft()

  /* Legacy draft (single clip recorded before the editor existed): give it a
     recipe row so it can be cut like any other. */
  React.useEffect(() => {
    if (!draft.clips.length && draft.videoUri) {
      const dur = Math.max(MIN_CLIP_MS, draft.durationMs || MAX_TOTAL_MS)
      patch({ clips: [{ uri: draft.videoUri, durationMs: dur, startMs: 0, endMs: dur, speed: 1 }] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clips = draft.clips
  const [selected, setSelected] = React.useState(0)
  const [trimOpen, setTrimOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  const sel = clips[Math.min(selected, Math.max(0, clips.length - 1))] ?? null

  /* ---- recipe edits (declared before the preview effects that call them) - */

  const setClips = React.useCallback((next: DraftClip[]) => {
    /* Any edit invalidates a previous export — the recipe is the truth. */
    patch({ clips: next, videoUri: null, coverUri: null })
  }, [patch])

  const updateClip = React.useCallback((at: number, fn: (c: DraftClip) => DraftClip) => {
    setClips(clips.map((c, i) => (i === at ? fn(c) : c)))
  }, [clips, setClips])

  /* ---- preview: the selected clip, its trim, its speed ------------------- */
  const player = useVideoPlayer(sel ? { uri: sel.uri } : null, p => {
    p.loop = false
    p.muted = false
    p.timeUpdateEventInterval = 0.25
  })
  React.useEffect(() => {
    if (!sel) return
    try {
      player.playbackRate = sel.speed || 1
      player.currentTime = sel.startMs / 1000
      player.play()
    } catch { /* released mid-swap */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.uri, sel?.speed, sel?.startMs, sel?.endMs])

  /* Loop the trimmed window, and CORRECT the cap-stamped duration the first
     time the real one is known. */
  const timeUpdate = useExpoEvent(player, 'timeUpdate', null as any)
  React.useEffect(() => {
    if (!sel || !timeUpdate) return
    if ((timeUpdate as any).currentTime >= sel.endMs / 1000) {
      try { player.currentTime = sel.startMs / 1000 } catch { /* released */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUpdate])
  const status = useExpoEvent(player, 'statusChange', { status: player.status } as any)
  React.useEffect(() => {
    const real = Math.round((player.duration || 0) * 1000)
    if (!sel || !real || (status as any)?.status !== 'readyToPlay') return
    if (Math.abs(real - sel.durationMs) < 250 || real <= 0) return
    updateClip(selected, c => ({
      ...c,
      durationMs: real,
      endMs: Math.min(c.endMs, real),
      startMs: Math.min(c.startMs, Math.max(0, real - MIN_CLIP_MS)),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const move = React.useCallback((from: number, dir: -1 | 1) => {
    const to = from + dir
    if (to < 0 || to >= clips.length) return
    const next = [...clips]
    const [c] = next.splice(from, 1)
    next.splice(to, 0, c)
    setClips(next)
    setSelected(to)
    fireHaptic('select')
  }, [clips, setClips])

  const remove = React.useCallback((at: number) => {
    const next = clips.filter((_, i) => i !== at)
    setClips(next)
    setSelected(s => Math.max(0, Math.min(s === at ? at - 1 : s > at ? s - 1 : s, next.length - 1)))
  }, [clips, setClips])

  const cycleSpeed = React.useCallback((at: number) => {
    updateClip(at, c => {
      const i = SPEEDS.indexOf((c.speed as any) || 1)
      return { ...c, speed: SPEEDS[(i + 1) % SPEEDS.length] }
    })
    fireHaptic('select')
  }, [updateClip])

  const totalMs = clips.reduce((sum, c) => sum + trimmedMs(c), 0)
  const overCap = totalMs > MAX_TOTAL_MS

  /* ---- export ------------------------------------------------------------ */

  const doExport = React.useCallback(async () => {
    if (!clips.length || exporting || overCap) return
    setExporting(true)
    try {
      try { player.pause() } catch { /* released */ }
      const res = await composeVideo(clips.map(c => ({
        uri: c.uri,
        startMs: Math.round(c.startMs),
        endMs: Math.round(c.endMs),
        speed: c.speed || 1,
      })))
      patch({
        videoUri: res.uri,
        imageUri: null,
        durationMs: res.durationMs || Math.round(totalMs),
        coverUri: null,
      })
      fireHaptic('success')
      router.push('/reels/compose/edit')
    } catch (e: any) {
      toast.error(e?.message || 'Could not export the clips — try again.')
    } finally {
      setExporting(false)
    }
  }, [clips, exporting, overCap, patch, player, router, totalMs])

  if (!hasVideoComposer) {
    /* Route reached without the module (stale deep link): nothing to edit
       with — hand back to the camera honestly. */
    return (
      <View style={[styles.root, { backgroundColor: STAGE.plate }]}>
        <ComposerHeader title="Edit clips" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text variant="callout" color={STAGE.fgMuted} align="center" style={{ maxWidth: 280 }}>
            Clip editing needs an updated app build.
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.root, { backgroundColor: STAGE.plate }]}>
      <StatusBar style="light" />
      <ComposerHeader title="Edit clips" step="Step 1 of 3" onBack={() => router.back()} rule />

      {/* The selected clip, playing its own cut. */}
      <View style={[styles.preview, { backgroundColor: STAGE.black }]}>
        {sel ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        ) : (
          <Text variant="callout" color={STAGE.fgMuted} align="center">No clips yet — record one first.</Text>
        )}
      </View>

      <View style={styles.list}>
        {clips.map((c, i) => (
          <Touchable
            key={`${c.uri}:${i}`}
            onPress={() => setSelected(i)}
            feedback="tint"
            noAutoHitSlop
            accessibilityLabel={`Clip ${i + 1}, ${mmss(trimmedMs(c))}${c.speed !== 1 ? `, ${c.speed}x speed` : ''}${i === selected ? ', selected' : ''}`}
            style={[
              styles.row,
              { backgroundColor: i === selected ? STAGE.glassSoft : 'transparent', borderColor: STAGE.hairline },
            ]}
          >
            <NumericText variant="footnote" color={STAGE.fgMuted}>{i + 1}</NumericText>
            <View style={styles.rowBody}>
              <Text variant="footnote" weight="600" color={STAGE.fg} numberOfLines={1}>
                {mmss(c.startMs)} – {mmss(c.endMs)}
              </Text>
              <Text variant="caption" color={STAGE.fgFaint}>
                {mmss(trimmedMs(c))} on screen
              </Text>
            </View>
            <Chip label={`${c.speed || 1}×`} size="sm" onPress={() => cycleSpeed(i)} accessibilityLabel={`Speed ${c.speed || 1}x — change`} />
            <Touchable onPress={() => { setSelected(i); setTrimOpen(true) }} feedback="dim" hitSlop={6} accessibilityLabel="Trim clip">
              <Icon name="crop" size={16} color={STAGE.fg} />
            </Touchable>
            <Touchable onPress={() => move(i, -1)} disabled={i === 0} feedback="dim" hitSlop={6} accessibilityLabel="Move earlier">
              <Icon name="up" size={16} color={i === 0 ? STAGE.fgGhost : STAGE.fg} />
            </Touchable>
            <Touchable onPress={() => move(i, 1)} disabled={i === clips.length - 1} feedback="dim" hitSlop={6} accessibilityLabel="Move later">
              <Icon name="down" size={16} color={i === clips.length - 1 ? STAGE.fgGhost : STAGE.fg} />
            </Touchable>
            <Touchable onPress={() => remove(i)} feedback="dim" hitSlop={6} accessibilityLabel="Delete clip">
              <Icon name="trash" size={16} color={STAGE.fgMuted} />
            </Touchable>
          </Touchable>
        ))}
      </View>

      <View style={styles.footer}>
        <Text variant="caption" color={overCap ? STAGE.danger : STAGE.fgMuted} align="center">
          {mmss(totalMs)} of {mmss(MAX_TOTAL_MS)}{overCap ? ' — trim below the cap to continue' : ''}
        </Text>
        <Button
          label={exporting ? 'Exporting…' : 'Export & continue'}
          variant="onDark"
          size="lg"
          block
          loading={exporting}
          disabled={!clips.length || overCap || exporting}
          onPress={() => { void doExport() }}
        />
      </View>

      {exporting ? (
        <View style={[StyleSheet.absoluteFill as any, styles.center, { backgroundColor: STAGE.wash }]}>
          <Spinner color={STAGE.fg} size="large" label="Stitching your clips…" />
        </View>
      ) : null}

      <TrimSheet
        visible={trimOpen}
        clip={sel}
        onClose={() => setTrimOpen(false)}
        onChange={(startMs, endMs) => updateClip(selected, c => ({ ...c, startMs, endMs }))}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   TrimSheet — two handles on a duration track. The values
   commit on RELEASE (runOnJS once per drag, not per frame),
   and the preview loop upstairs re-seeks off the new window.
   ========================================================= */
function TrimSheet({
  visible, clip, onClose, onChange,
}: {
  visible: boolean
  clip: DraftClip | null
  onClose: () => void
  onChange: (startMs: number, endMs: number) => void
}) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const trackW = width - 32 - 28 * 2

  const dur = Math.max(MIN_CLIP_MS, clip?.durationMs ?? MIN_CLIP_MS)
  const startX = useSharedValue(0)
  const endX = useSharedValue(trackW)
  const [labels, setLabels] = React.useState({ start: 0, end: dur })

  React.useEffect(() => {
    if (!visible || !clip) return
    startX.value = (clip.startMs / dur) * trackW
    endX.value = (clip.endMs / dur) * trackW
    setLabels({ start: clip.startMs, end: clip.endMs })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, clip?.uri])

  const commit = React.useCallback((sx: number, ex: number) => {
    const startMs = Math.round((sx / trackW) * dur)
    const endMs = Math.round((ex / trackW) * dur)
    setLabels({ start: startMs, end: endMs })
    onChange(startMs, endMs)
  }, [trackW, dur, onChange])

  const minGap = (MIN_CLIP_MS / dur) * trackW

  const dragStart = Gesture.Pan()
    .onChange(e => {
      startX.value = Math.max(0, Math.min(endX.value - minGap, startX.value + e.changeX))
    })
    .onEnd(() => { runOnJS(commit)(startX.value, endX.value) })

  const dragEnd = Gesture.Pan()
    .onChange(e => {
      endX.value = Math.max(startX.value + minGap, Math.min(trackW, endX.value + e.changeX))
    })
    .onEnd(() => { runOnJS(commit)(startX.value, endX.value) })

  const startStyle = useAnimatedStyle(() => ({ transform: [{ translateX: startX.value }] }))
  const endStyle = useAnimatedStyle(() => ({ transform: [{ translateX: endX.value }] }))
  const windowStyle = useAnimatedStyle(() => ({
    left: 28 + startX.value,
    width: Math.max(0, endX.value - startX.value),
  }))

  return (
    <Sheet visible={visible} onClose={onClose} title="Trim" scrollable={false}>
      <View style={{ padding: space.lg, gap: space.md2 }}>
        <View style={styles.trimLabels}>
          <NumericText variant="footnote" tone="secondary">{mmss(labels.start)}</NumericText>
          <NumericText variant="footnote" tone="secondary">{mmss(labels.end)}</NumericText>
        </View>
        <View style={styles.trimTrackWrap}>
          <View style={[styles.trimTrack, { backgroundColor: t.colors.surfaceSunken }]} />
          <Animated.View style={[styles.trimWindow, { backgroundColor: t.colors.accentSoft, borderColor: t.colors.accent }, windowStyle]} />
          <GestureDetector gesture={dragStart}>
            <Animated.View style={[styles.trimHandle, { backgroundColor: t.colors.accent }, startStyle]}>
              <View style={[styles.trimGrip, { backgroundColor: t.colors.textOnAccent }]} />
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={dragEnd}>
            <Animated.View style={[styles.trimHandle, { backgroundColor: t.colors.accent }, endStyle]}>
              <View style={[styles.trimGrip, { backgroundColor: t.colors.textOnAccent }]} />
            </Animated.View>
          </GestureDetector>
        </View>
        <Text variant="caption" tone="muted" align="center">
          Keeps {mmss(Math.max(0, labels.end - labels.start))} of {mmss(dur)}
        </Text>
        <Button label="Done" size="lg" block onPress={onClose} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { flex: 1, marginHorizontal: space.lg, marginTop: space.sm, borderRadius: 14, overflow: 'hidden' },
  list: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.md, paddingVertical: space.sm2,
    borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  footer: { padding: space.lg, gap: space.sm2 },
  trimLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  trimTrackWrap: { height: 44, justifyContent: 'center' },
  trimTrack: { position: 'absolute', left: 28, right: 28, height: 8, borderRadius: 4 },
  trimWindow: { position: 'absolute', height: 8, borderRadius: 4, borderWidth: 1 },
  trimHandle: {
    position: 'absolute', left: 14, width: 28, height: 34, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  trimGrip: { width: 3, height: 14, borderRadius: 1.5 },
})
