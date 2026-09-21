/* =========================================================
   Composer, step 3 — caption, cover, audience, publish.

   One multipart POST carries the clip, the cover, the
   voiceover and overlay.json together; the assembly itself
   lives in ReelDraft.buildFormData, because the part ORDER is
   a contract and it belongs in one place.

   Two things are honest rather than pretty here:

   · The upload bar is INDETERMINATE. `http.upload` has no
     progress channel, so a percentage would be a number we
     invented. A bar that lies about 62% is worse than one
     that just says it is working.
   · A moderation refusal on the multipart path arrives as a
     500 with no errorCode, so it is detected by isBlocked()
     from lib/moderation (which owns the one sanctioned message
     sniff) and rendered VERBATIM, with the draft kept and no
     retry button. Never name a rule; the vagueness is
     deliberate.
   ========================================================= */
import { api, codeOf, errorText, isNotFound, isRateLimited, traceRef } from '@/api'
import { useReelDraft, type ReelVisibility } from '@/components/reels/ReelDraft'
import { ReelOverlayLayer, type OverlayDoc } from '@/components/reels/ReelOverlayLayer'
import { putCreatedReel } from '@/components/reels/reelInbox'
import type { ViewSound } from '@/components/reels/types'
import { useDebounced } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { prepareUpload, type PickedAsset } from '@/lib/mediaTier'
import { MODERATION_COPY, isBlocked, isHeld, isNsfwBlocked, moderationText } from '@/lib/moderation'
import { MAX_BYTES, serialiseOverlay } from '@/lib/reelOverlay'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'

import {
    ActionSheet, Avatar, Button, Callout, Card, Divider, Field, GroupLabel, Icon, Sheet, Text, Touchable,
    fireHaptic, formatCount, toast, useSheetState,
} from '@/ui'
import { File, Paths } from 'expo-file-system'
import { Image } from 'expo-image'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { VideoView, useVideoPlayer, type VideoThumbnail } from 'expo-video'
import React from 'react'
import { Modal, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, {
    Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { ComposerHeader, useComposerInsets } from '@/components/reels/ComposerChrome'
import { STAGE } from '@/components/reels/skin'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const MAX_CAPTION = 2200
const COVER_FRAMES = 8
/* 9:16, and named because the overlay layer has to be handed the same box the
   clip is drawn in — its coordinates are fractions of that rect. */
const PREVIEW_W = 86
const PREVIEW_H = 153

const VISIBILITY: { value: ReelVisibility; label: string; note: string; icon: any }[] = [
  { value: 'PUBLIC', label: 'Everyone', note: 'Anyone can find this reel, including in For You.', icon: 'globe' },
  { value: 'FOLLOWERS_ONLY', label: 'Followers', note: 'Only accounts that follow you can watch it.', icon: 'people' },
  { value: 'ONLY_ME', label: 'Only me', note: 'Nobody else sees it. You can change this later.', icon: 'lock' },
]

export default function ComposePublishScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useComposerInsets()
  const { draft, patch, reset, buildFormData } = useReelDraft()

  const [caption, setCaption] = React.useState(draft.caption)
  const [selection, setSelection] = React.useState({ start: 0, end: 0 })
  const [posting, setPosting] = React.useState(false)
  /* Real multipart byte progress (0..1) — uploadX finally gives the bar an
     honest number; null keeps the indeterminate sweep (server-side settle). */
  const [upProgress, setUpProgress] = React.useState<number | null>(null)
  const [blocked, setBlocked] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<any>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [frames, setFrames] = React.useState<VideoThumbnail[]>([])
  const [framesBusy, setFramesBusy] = React.useState(false)
  const coverSheet = useSheetState()
  const leaveSheet = useSheetState()

  /* Hardware back runs the same guard as the header's back chevron. Always
     armed: by this screen the video is already recorded, so there is no
     cheap-to-retype state that would justify a silent pop. */
  useDiscardGuard(true, () => (posting ? toast.info('Uploading — cancel first?') : leaveSheet.open()))

  /* One player, two jobs: the preview tile and the cover strip's frames. Muted
     and looping — it is a thumbnail that moves, not playback, and the reel's
     own sound belongs to the reel, not to a form. */
  const player = useVideoPlayer(draft.videoUri ?? null, p => {
    p.loop = true
    p.muted = true
  })

  /* A decoder running behind the sound picker or an image picker buys nothing.
     Playing on focus also covers the return trip, where the player has been
     paused since the push. */
  useFocusEffect(React.useCallback(() => {
    try { player.play() } catch { /* released */ }
    return () => { try { player.pause() } catch { /* released */ } }
  }, [player]))

  React.useEffect(() => { patch({ caption }) }, [caption])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- mention / tag autocomplete ---------------------------------------- */

  const token = React.useMemo(() => activeToken(caption, selection.start), [caption, selection.start])
  const debouncedToken = useDebounced(token?.text ?? '', 250)
  const [people, setPeople] = React.useState<any[]>([])
  const [tags, setTags] = React.useState<{ tag: string; usageCount: number }[]>([])

  React.useEffect(() => {
    if (!token || debouncedToken.length < 1) { setPeople([]); setTags([]); return }
    let alive = true
    if (token.kind === '@') {
      api.mentions.suggest(debouncedToken, 6)
        .then((rows: any[]) => { if (alive) { setPeople(rows || []); setTags([]) } })
        .catch(() => { if (alive) setPeople([]) })
    } else {
      api.tags.search({ prefix: debouncedToken, limit: 8 } as any)
        .then((rows: any[]) => { if (alive) { setTags(rows || []); setPeople([]) } })
        .catch(() => { if (alive) setTags([]) })
    }
    return () => { alive = false }
  }, [debouncedToken, token?.kind])   // eslint-disable-line react-hooks/exhaustive-deps

  const complete = (replacement: string, clickedUserId?: string) => {
    if (!token) return
    const next = `${caption.slice(0, token.start)}${replacement} ${caption.slice(token.end)}`
    setCaption(next.slice(0, MAX_CAPTION))
    setPeople([])
    setTags([])
    /* The click-through is a ranking signal, not a requirement — a failure here
       must never interrupt someone writing a caption. */
    if (clickedUserId) api.mentions.click(debouncedToken, clickedUserId).catch(() => {})
  }

  /* ---- cover -------------------------------------------------------------- */

  const openCover = React.useCallback(async () => {
    coverSheet.open()
    if (!draft.videoUri || frames.length) return
    setFramesBusy(true)
    try {
      const duration = player.duration || (draft.durationMs / 1000) || 6
      const times = Array.from({ length: COVER_FRAMES }, (_, i) => (duration * i) / COVER_FRAMES)
      setFrames(await player.generateThumbnailsAsync(times))
    } catch {
      /* No frames is a survivable outcome: the server falls back to the clip's
         own first frame, and "Upload cover" still works. */
      setFrames([])
    } finally {
      setFramesBusy(false)
    }
  }, [coverSheet, draft.videoUri, draft.durationMs, frames.length, player])

  const pickFrame = React.useCallback(async (thumb: VideoThumbnail) => {
    try {
      /* A VideoThumbnail is a native image ref with no file behind it, so it
         cannot go into FormData directly — render it to a real jpeg first. */
      const ref = await ImageManipulator.manipulate(thumb).renderAsync()
      const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })
      patch({ coverUri: saved.uri })
      coverSheet.close()
      fireHaptic('light')
    } catch {
      toast.error("Couldn't use that frame — try another.")
    }
  }, [patch, coverSheet])

  const uploadCover = React.useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { toast.warn('Photo library access is off'); return }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset?.uri) return
    /* The cover rides the same multipart as the clip, so it obeys the same
       media tier every other upload does — a 4032px photo behind a 1080px reel
       is bytes nobody sees. Fails open, so a cover always lands. */
    const ready = await prepareUpload({ ...(asset as unknown as PickedAsset), type: 'image' })
    patch({ coverUri: ready.uri })
    coverSheet.close()
  }, [patch, coverSheet])

  /* ---- publish ------------------------------------------------------------ */

  const post = React.useCallback(async () => {
    if (posting || cooldown > 0) return
    if (!draft.videoUri && !draft.imageUri) { toast.warn('Record or import a clip first'); return }

    setPosting(true)
    setBlocked(null)
    setFailure(null)

    try {
      /* Re-verify the attached sound: it may have been pulled from the library
         while the composer was open. Losing it is not fatal — posting without
         it is better than refusing to post. */
      if (draft.sound?.id) {
        try {
          const fresh = await api.sounds.get(draft.sound.id) as ViewSound | null
          if (!fresh || fresh.status !== 'APPROVED') throw Object.assign(new Error('gone'), { status: 404 })
        } catch (e) {
          if (isNotFound(e)) {
            patch({ sound: null })
            toast.warn('That sound is no longer available.')
          }
        }
      }

      /* reelOverlay.overlayFile() builds a DOM File and must NOT run on native,
         so the document is written to the cache directory instead. */
      let overlayUri: string | null = null
      const doc = serialiseOverlay(draft.items, draft.fit)
      if (doc) {
        const json = JSON.stringify(doc)
        if (json.length > MAX_BYTES) {
          toast.warn("That's too much text to attach — remove an item.")
          setPosting(false)
          return
        }
        const file = new File(Paths.cache, 'overlay.json')
        if (file.exists) file.delete()
        file.create()
        file.write(json)
        overlayUri = file.uri
      }

      setUpProgress(0)
      const created: any = await api.posts.createMultipart(buildFormData(overlayUri), {
        /* 1.0 arrives while the server is still transcoding/settling — snap
           back to the indeterminate sweep rather than freezing a full bar. */
        onProgress: (f: number) => setUpProgress(f >= 1 ? null : f),
      })
      fireHaptic('success')
      reset()

      /* Hand it to the reels tab. Without this the tab keeps the page it had
         already fetched and the new reel is simply missing from it — and a
         plain refetch would not be enough either, because For You is ranked
         and Following excludes your own reels. */
      putCreatedReel(created)

      if (isHeld(created)) toast.info(MODERATION_COPY.checking.note)
      router.replace(`/reels/${created.id}`)
    } catch (e: any) {
      setPosting(false)
      setUpProgress(null)
      fireHaptic('error')
      /* The image gate screens the clip's poster frame — its block is as
         terminal as a text rejection: the danger strip, no Retry, and the
         MMKV draft (clip, caption, cover) stays put so the user can swap the
         cover and post again. */
      if (isBlocked(e) || isNsfwBlocked(e)) { setBlocked(moderationText(e)); return }
      if (isRateLimited(e)) { startCooldown(e); return }
      setFailure(e)
    }
  }, [posting, cooldown, draft, patch, reset, router, startCooldown, buildFormData])

  /* Persistence already happened — the provider writes MMKV on every
     mutation — so the honest job of this button is a final synchronous
     flush-by-noop plus the words saying WHERE the draft lives and how to
     get back to it (it silently rehydrates on the next compose entry). */
  const saveDraftAndLeave = React.useCallback(() => {
    toast.ok('Draft saved on this device — it reopens with the composer')
    router.replace('/(app)/(tabs)/reels')
  }, [router])

  /* Full-screen preview with the final reel's read: the clip full-bleed,
     the SAME overlay document at the real box, tap to pause. The tile's own
     loop pauses while this is up — two players on one uri is two decoders. */
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const openFullPreview = React.useCallback(() => {
    try { player.pause() } catch { /* released */ }
    setPreviewOpen(true)
  }, [player])
  const closeFullPreview = React.useCallback(() => {
    setPreviewOpen(false)
    try { player.play() } catch { /* released */ }
  }, [player])

  const discardAndLeave = React.useCallback(() => {
    reset()
    router.replace('/(app)/(tabs)/reels')
  }, [reset, router])

  const failureCopy = describeFailure(failure)
  const canPost = (!!draft.videoUri || !!draft.imageUri) && !posting && cooldown === 0
  /* The same document the reel will be published with, drawn over the preview
     — proof, at the last step, that the words are ON the clip. */
  const overlayDoc = React.useMemo(
    () => serialiseOverlay(draft.items, draft.fit) as OverlayDoc | null,
    [draft.items, draft.fit],
  )

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {/* Paper, so the phone's own bar has to switch too — a light status bar
          on a white screen is an invisible clock. */}
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />

      <ComposerHeader
        title="New reel"
        tone="paper"
        step="Step 3 of 3"
        onBack={() => (posting ? toast.info('Uploading — cancel first?') : leaveSheet.open())}
        rule
      />

      {/* Keyboard-aware, not a plain ScrollView: the location field sits at the
          bottom of the list with the absolute footer parked over it, so on
          Android edge-to-edge (no window resize) and on iOS alike a focus there
          types blind. `bottomOffset` clears the footer, not just the caret. */}
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 150 }}
        bottomOffset={90}
        scrollEnabled={!posting}
        pointerEvents={posting ? 'none' : 'auto'}
        style={posting ? styles.dimmed : undefined}
      >
        <View style={styles.captionRow}>
          {/* THE CLIP ITSELF, playing. This tile used to be an empty gradient
              with a picture glyph in it for every video reel — a cover only
              exists once somebody picks one, and until then there was nothing
              to show. A muted loop of the actual clip is both the answer to
              "what am I posting" and the tap target for the cover. */}
          <Touchable onPress={() => { void openCover() }} feedback="scale" noAutoHitSlop accessibilityLabel="Preview and choose cover">
            <View style={[styles.preview, { backgroundColor: c.bgSunken, borderColor: c.borderFaint }]}>
              {draft.videoUri ? (
                <VideoView
                  player={player}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  nativeControls={false}
                />
              ) : draft.imageUri ? (
                <Image source={{ uri: draft.imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <View style={styles.previewGlyph}><Icon name="video" size={22} color={c.placeholder} /></View>
              )}
              {/* The overlay rides the clip, here exactly as it will in the
                  feed — same layer, same document, same fractions of the same
                  media rect. The words an author places on a reel belong to
                  the VIDEO; the caption below is a different thing they may or
                  may not write. */}
              {/* Full-screen preview door — the tile press stays the cover
                  chooser it always was. */}
              <Touchable
                onPress={openFullPreview}
                feedback="dim"
                accessibilityLabel="Preview full screen"
                style={[styles.expandBtn, { backgroundColor: STAGE.glassStrong }]}
              >
                <Icon name="external" size={13} color={STAGE.fg} />
              </Touchable>
              {overlayDoc ? (
                <ReelOverlayLayer
                  doc={overlayDoc}
                  box={{ width: PREVIEW_W, height: PREVIEW_H }}
                  mediaW={9}
                  mediaH={16}
                  paused={false}
                />
              ) : null}
              {/* The cover is what the grid will show, so when one is chosen it
                  is stated here rather than replacing the preview — the author
                  wants to see both. */}
              {draft.coverUri ? (
                <View style={[styles.coverInset, { borderColor: c.bg }]}>
                  <Image source={{ uri: draft.coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                </View>
              ) : null}
            </View>
            <Text variant="micro" tone="muted" align="center" style={styles.previewLabel}>
              {draft.coverUri ? 'Cover set' : 'Edit cover'}
            </Text>
          </Touchable>

          <View style={{ flex: 1 }}>
            <TextInput
              value={caption}
              onChangeText={v => setCaption(v.slice(0, MAX_CAPTION))}
              onSelectionChange={e => setSelection(e.nativeEvent.selection)}
              placeholder="Write a caption…"
              placeholderTextColor={c.placeholder}
              selectionColor={c.accent}
              multiline
              style={[styles.captionInput, { color: c.text, fontSize: t.type.body.fontSize }]}
            />
            <Text variant="caption" tone="faint" align={t.isRTL ? 'left' : 'right'}>{caption.length}/{MAX_CAPTION}</Text>
          </View>
        </View>

        {people.length ? (
          <Card variant="outlined" padding={0} style={styles.suggestions}>
            {people.map((p, i) => (
              <React.Fragment key={p.id}>
                {i ? <Divider inset={54} /> : null}
                <Touchable onPress={() => complete(`@${p.handle}`, p.id)} feedback="tint" noAutoHitSlop style={styles.suggestRow}>
                  <Avatar uri={p.profileImage} name={p.full} seed={p.id} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text variant="footnote" weight="600" numberOfLines={1}>@{p.handle}</Text>
                    <Text variant="caption" tone="faint" numberOfLines={1}>{p.full}</Text>
                  </View>
                </Touchable>
              </React.Fragment>
            ))}
          </Card>
        ) : null}

        {tags.length ? (
          <Card variant="outlined" padding={0} style={styles.suggestions}>
            {tags.map((tag, i) => (
              <React.Fragment key={tag.tag}>
                {i ? <Divider inset={44} /> : null}
                <Touchable onPress={() => complete(`#${tag.tag}`)} feedback="tint" noAutoHitSlop style={styles.suggestRow}>
                  <Icon name="hash" size={17} color={c.textMuted} />
                  <Text variant="footnote" weight="600" style={{ flex: 1 }} numberOfLines={1}>{tag.tag}</Text>
                  <Text variant="caption" tone="faint">{formatCount(tag.usageCount)} posts</Text>
                </Touchable>
              </React.Fragment>
            ))}
          </Card>
        ) : null}

        {draft.sound ? (
          <Card variant="outlined" padding={0} style={styles.soundCard}>
            <View style={styles.soundRow}>
              <View style={[styles.soundArt, { backgroundColor: c.bgSunken }]}>
                {draft.sound.cover ? (
                  <Image source={{ uri: draft.sound.cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Icon name="music" size={13} color={c.textMuted} />
                )}
              </View>
              <Text variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
                {draft.sound.title}{draft.sound.artist ? ` · ${draft.sound.artist}` : ''}
              </Text>
              <Touchable onPress={() => router.push('/reels/compose/sound')} feedback="dim" noAutoHitSlop>
                <Text variant="caption" weight="600" color={c.accentText}>Change</Text>
              </Touchable>
              <Touchable onPress={() => patch({ sound: null })} feedback="dim" noAutoHitSlop accessibilityLabel="Detach sound">
                <Icon name="close" size={14} color={c.textMuted} />
              </Touchable>
            </View>
          </Card>
        ) : null}

        {/* GroupLabel pads by the screen token; this page's gutter is 16, so
            the 2pt step is corrected here rather than in the primitive. */}
        <GroupLabel style={styles.groupLabel}>Who can see this</GroupLabel>
        <Card variant="outlined" padding={0} style={styles.group}>
          {VISIBILITY.map((option, i) => {
            const active = draft.visibility === option.value
            return (
              <React.Fragment key={option.value}>
                {i ? <Divider inset={48} /> : null}
                <Touchable
                  onPress={() => patch({ visibility: option.value })}
                  feedback="tint"
                  noAutoHitSlop
                  accessibilityState={{ selected: active }}
                  style={styles.visRow}
                >
                  <Icon name={option.icon} size={19} color={active ? c.accent : c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text variant="subhead" weight="600">{option.label}</Text>
                    <Text variant="caption" tone="faint">{option.note}</Text>
                  </View>
                  {/* The state is carried by ONE mark, not by a colour the eye
                      has to compare across three rows (DESIGN.md §2). */}
                  <Icon
                    name={active ? 'checkCircle' : 'addCircle'}
                    size={20}
                    filled={active}
                    color={active ? c.accent : c.borderStrong}
                  />
                </Touchable>
              </React.Fragment>
            )
          })}
        </Card>

        <View style={styles.locationWrap}>
          <Field
            label="Add location"
            value={draft.locationName}
            onChangeText={(v: string) => patch({ locationName: v })}
            placeholder="Optional"
            icon="location"
          />
        </View>

        <View style={styles.advice}>
          <Text variant="caption" tone="faint" align="ui">
            Reels are public by default and can appear in For You.
          </Text>
        </View>

        {blocked ? (
          <Callout tone="danger" icon="warning" style={styles.strip}>{blocked}</Callout>
        ) : null}

        {failure ? (
          <Callout
            tone="warning"
            title={failureCopy.title}
            actionLabel={failureCopy.retryable ? 'Retry' : undefined}
            onAction={failureCopy.retryable ? () => { void post() } : undefined}
            style={styles.strip}
          >
            {failureCopy.ref ? `Reference ${failureCopy.ref}` : undefined}
          </Callout>
        ) : null}
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 2,
            backgroundColor: c.bg,
            borderTopWidth: t.rule.course,
            borderTopColor: c.separator,
          },
        ]}
      >
        {posting ? (
          <View style={{ gap: space.sm2 }}>
            <UploadBar progress={upProgress} />
            <Text variant="caption" tone="muted" align="center">Uploading your reel…</Text>
          </View>
        ) : (
          <>
            <Button
              label={cooldown > 0 ? `Wait ${cooldown}s` : 'Post'}
              onPress={() => { void post() }}
              disabled={!canPost}
              variant="primary"
              size="lg"
              block
            />
            <Button
              label="Save draft"
              onPress={saveDraftAndLeave}
              variant="ghost"
              size="sm"
              block
            />
          </>
        )}
      </View>

      {/* The house sheet, not a hand-rolled one: it brings the crown, the
          drag-to-dismiss, the backdrop and the docked bottom inset that this
          screen was re-deriving. `scrollable={false}` because the body IS a
          horizontal scroller — nesting it inside a vertical one fights the
          drag gesture for the same finger. */}
      <Sheet
        visible={coverSheet.visible}
        onClose={coverSheet.close}
        title="Choose a cover"
        subtitle={draft.videoUri ? 'A frame from your clip, or a photo of your own.' : undefined}
        scrollable={false}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frameRow}>
          <Touchable onPress={() => { void uploadCover() }} feedback="scale" noAutoHitSlop style={[styles.frameTile, { backgroundColor: c.bgSunken, borderColor: c.border }]}>
            <View style={styles.frameUpload}>
              <Icon name="upload" size={20} color={c.textMuted} />
              <Text variant="micro" tone="muted" align="center">Upload</Text>
            </View>
          </Touchable>
          {framesBusy ? (
            Array.from({ length: COVER_FRAMES }, (_, i) => (
              <View key={i} style={[styles.frameTile, { backgroundColor: c.skeleton, borderColor: c.borderFaint }]} />
            ))
          ) : frames.length ? (
            frames.map((frame, i) => (
              <Touchable key={i} onPress={() => { void pickFrame(frame) }} feedback="scale" noAutoHitSlop style={[styles.frameTile, { backgroundColor: c.bgSunken, borderColor: c.borderFaint }]}>
                <Image source={frame} style={styles.frameImg} contentFit="cover" />
              </Touchable>
            ))
          ) : (
            <View style={styles.frameNote}>
              <Text variant="caption" tone="faint" align="center">
                Frames aren&rsquo;t available for this clip. Your reel will use its first frame.
              </Text>
            </View>
          )}
        </ScrollView>
      </Sheet>

      {/* Three outcomes, so an ActionSheet rather than a confirm: "Discard" has
          to be reachable without being the cancel button, which people press by
          reflex. */}
      <ActionSheet
        visible={leaveSheet.visible}
        onClose={leaveSheet.close}
        title="Save this reel as a draft?"
        subtitle="A draft stays on this phone only."
        actions={[
          { label: 'Save draft', icon: 'download', onPress: saveDraftAndLeave },
          { label: 'Keep editing', icon: 'edit', onPress: () => router.back() },
          { label: 'Discard', icon: 'trash', destructive: true, onPress: discardAndLeave },
        ]}
      />

      <PublishPreviewModal
        visible={previewOpen}
        onClose={closeFullPreview}
        videoUri={draft.videoUri}
        imageUri={draft.imageUri}
        overlayDoc={overlayDoc}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   The last look, at the real size: the clip full-bleed with the
   SAME overlay document at the real box, tap to pause — the
   read the published reel will get, minus the rail (there are
   no counts to put on it yet, and fake zeros would be worse).
   --------------------------------------------------------- */
function PublishPreviewModal({
  visible, onClose, videoUri, imageUri, overlayDoc,
}: {
  visible: boolean
  onClose: () => void
  videoUri: string | null
  imageUri: string | null
  overlayDoc: OverlayDoc | null
}) {
  const t = useTheme()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [paused, setPaused] = React.useState(false)

  const previewPlayer = useVideoPlayer(visible && videoUri ? { uri: videoUri } : null, p => {
    p.loop = true
  })
  React.useEffect(() => {
    if (!visible || !videoUri) return
    try { paused ? previewPlayer.pause() : previewPlayer.play() } catch { /* released */ }
  }, [visible, videoUri, paused, previewPlayer])
  React.useEffect(() => { if (!visible) setPaused(false) }, [visible])

  if (!visible) return null
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: STAGE.black }}>
        <Touchable
          onPress={() => setPaused(v => !v)}
          feedback="none"
          noAutoHitSlop
          accessibilityLabel={paused ? 'Play' : 'Pause'}
          style={StyleSheet.absoluteFill}
        >
          {videoUri ? (
            <VideoView player={previewPlayer} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
          ) : imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : null}
          {overlayDoc ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <ReelOverlayLayer doc={overlayDoc} box={{ width, height }} mediaW={9} mediaH={16} paused={paused} />
            </View>
          ) : null}
          {paused ? (
            <View pointerEvents="none" style={styles.previewPausedGlyph}>
              <Icon name="play" size={38} color={STAGE.fg} filled />
            </View>
          ) : null}
        </Touchable>
        <Touchable
          onPress={onClose}
          feedback="scale"
          accessibilityLabel="Close preview"
          style={[styles.previewClose, { top: insets.top + 8, backgroundColor: STAGE.glassStrong }]}
        >
          <Icon name="close" size={22} color={STAGE.fg} />
        </Touchable>
        <View pointerEvents="none" style={[styles.previewHint, { bottom: insets.bottom + 18 }]}>
          <Text variant="caption" color={STAGE.fgMuted} align="center">
            This is how it will play {t.prefs.reducedMotion ? '' : '— tap to pause'}
          </Text>
        </View>
      </View>
    </Modal>
  )
}

/** Determinate when `progress` carries a real fraction (uploadX's byte
 *  counter); the old indeterminate sweep remains the fallback for the spans
 *  with no honest number — before the first byte and after the last, while
 *  the server settles the post. */
function UploadBar({ progress = null }: { progress?: number | null }) {
  const t = useTheme()
  const p = useSharedValue(0)
  /* A percentage cannot become a transform without a width, and this track sits
     inside the screen's padding — never the window width — so it measures. */
  const w = useSharedValue(0)
  const determinate = progress != null
  React.useEffect(() => {
    if (determinate) { cancelAnimation(p); return }
    if (t.prefs.reducedMotion) { p.value = 0.5; return }
    p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
  }, [p, t.prefs.reducedMotion, determinate])
  /* clip-translate, not scaleX: the fill is a 4pt pill with a 2pt radius, and
     scaling a radius on one axis turns the caps into ovals. The track already
     clips, so a full-size child sliding under it keeps its caps honest. And
     translateX rather than `left` because `left` re-runs layout on every one of
     the ~66 frames this is on screen — while the upload it is reporting on is
     saturating the very same thread. Travel is physical, as `left` was: RTL
     unchanged. Hidden until the first onLayout or the sweep starts mid-track.
     Determinate mode slides the same full-width fill so that only its
     rightmost `fraction` remains clipped out — same transform, honest data. */
  const frac = determinate ? Math.max(0, Math.min(1, progress!)) : 0
  const anim = useAnimatedStyle(() => ({
    opacity: w.value > 0 ? 1 : 0,
    transform: [{ translateX: determinate ? (frac - 1) * w.value : (p.value - 0.34) * w.value }],
  }))
  return (
    <View
      style={[styles.uploadTrack, { backgroundColor: t.colors.skeleton }]}
      onLayout={e => { w.value = e.nativeEvent.layout.width }}
    >
      <Animated.View style={[styles.uploadFill, determinate && styles.uploadFillFull, { backgroundColor: t.colors.accent }, anim]} />
    </View>
  )
}

/* The composer's error taxonomy, in one place so the strip cannot drift from
   what the server actually said. */
function describeFailure(e: any): { title: string; retryable: boolean; ref: string | null } {
  if (!e) return { title: '', retryable: false, ref: null }
  const code = codeOf(e)
  const ref = traceRef(e) ? String(traceRef(e)).slice(0, 8) : null

  if (code === 'upload_failed' || e?.status === 502) {
    return { title: "Your reel couldn't be uploaded. Nothing was posted — try again.", retryable: true, ref }
  }
  if (code === 'FILE_TOO_LARGE' || e?.status === 413) {
    const max = e?.details?.maxSize
    return { title: max ? `That clip is too large (limit ${max}).` : 'That clip is too large.', retryable: false, ref }
  }
  if (code === 'UNSUPPORTED_MEDIA_TYPE' || e?.status === 415) {
    return { title: "That file type isn't supported.", retryable: false, ref }
  }
  if (code === 'post_create_failed') {
    return { title: 'Something went wrong posting your reel.', retryable: true, ref }
  }
  return { title: errorText(e), retryable: true, ref }
}

/** The '@' or '#' token the cursor is currently inside, if any. */
function activeToken(text: string, cursor: number): { kind: '@' | '#'; text: string; start: number; end: number } | null {
  if (!text) return null
  const upto = text.slice(0, cursor)
  const m = /([@#])([\p{L}\p{N}._-]*)$/u.exec(upto)
  if (!m) return null
  return {
    kind: m[1] as '@' | '#',
    text: m[2],
    start: cursor - m[0].length,
    end: cursor,
  }
}

const styles = StyleSheet.create({
  /* Full-preview chrome — reel-stage glass, sanctioned circles. */
  expandBtn: {
    position: 'absolute', top: 4, end: 4,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  previewClose: {
    position: 'absolute', start: 12,
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  /* Spelled out — SDK 57 removed StyleSheet.absoluteFillObject. */
  previewPausedGlyph: {
    position: 'absolute', top: 0, bottom: 0, start: 0, end: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  previewHint: { position: 'absolute', left: 0, right: 0 },
  root: { flex: 1 },
  dimmed: { opacity: 0.45 },
  captionRow: { flexDirection: 'row', gap: space.md2, paddingHorizontal: space.lg, paddingTop: space.md },
  /* 9:16, the shape everything else in the reel world is. Big enough to read a
     face in, small enough to leave the caption its own column. */
  preview: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  previewGlyph: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  /* The chosen cover, stated over the corner of the live preview — a ring in
     the page's own ground is what separates it from the frame behind it. */
  coverInset: {
    position: 'absolute',
    end: 5,
    bottom: 5,
    width: 26,
    height: 40,
    borderRadius: 5,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  previewLabel: { marginTop: space.xs2 },
  captionInput: { minHeight: 120, lineHeight: 21, textAlignVertical: 'top', paddingTop: 0 },
  suggestions: { marginHorizontal: space.lg, marginTop: space.sm, maxHeight: 220, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md, height: 46 },
  soundCard: { marginHorizontal: space.lg, marginTop: space.lg, overflow: 'hidden' },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md, height: 48 },
  soundArt: { width: 26, height: 26, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  groupLabel: { paddingHorizontal: space.lg },
  group: { marginHorizontal: space.lg, overflow: 'hidden' },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  locationWrap: { paddingHorizontal: space.lg, paddingTop: space.xl },
  advice: { paddingHorizontal: space.lg, paddingTop: space.lg2, gap: space.xs2 },
  strip: { marginHorizontal: space.lg, marginTop: space.lg },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.xs,
  },
  uploadTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  /* left is static now — the sweep is a transform. The 34% has to stay in step
     with the -0.34 in UploadBar's translate. */
  uploadFill: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '34%', borderRadius: 2 },
  /* Determinate mode slides a FULL-width fill so `(fraction-1)·width` leaves
     exactly `fraction` visible — the 34% pill is indeterminate-only. */
  uploadFillFull: { width: '100%' },
  frameRow: { gap: space.sm2, paddingHorizontal: space.lg, paddingBottom: space.lg },
  frameTile: {
    width: 62,
    height: 110,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  frameImg: { width: 62, height: 110 },
  frameUpload: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs2 },
  frameNote: { width: 240, justifyContent: 'center', paddingHorizontal: space.md },
})
