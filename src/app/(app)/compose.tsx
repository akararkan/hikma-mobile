/* =========================================================
   Composer.

   PUBLISH PATH — multipart, always. `api.posts.createMultipart`
   is the documented in-app composer path: it is ATOMIC (any R2
   or DB failure rolls every uploaded key back) and it needs no
   knowledge of storage. The alternative — `api.media.upload`
   then `api.posts.create({ mediaUrls })` — is deliberately NOT
   wired: the docs do not spell which key of the final
   MediaStatusResponse carries the public URL, and guessing
   wrong fails SILENTLY (a post published with empty media).
   That verification is a live-server task, and until it is
   done multipart is the only safe path. The cost is that the
   tray shows activity rather than a byte-accurate progress bar,
   because `http.upload` reports no progress.

   FAILURE COPY — the multipart endpoint has two ad-hoc bodies
   that escape the unified envelope (502 `{"error":"upload_
   failed"}`, 500 `{"error":"post_create_failed"}`), so the key
   is `error`, not `errorCode`. Both mean every uploaded key was
   rolled back and nothing was published, which is why a plain
   retry is offered there and nowhere else.

   Moderation refusals keep the draft and offer NO retry: the
   identical text can only fail identically, and naming what
   tripped would be a working oracle for probing the classifier.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { CropSheet, type CropResult } from '@/components/post/CropSheet'
import { getInfoAsync } from 'expo-file-system/legacy'
import { api, codeOf, errorText, fieldErrorMap, isRateLimited } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useCooldown } from '@/hooks/useCooldown'
import { useDebounced } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Callout, ConfirmSheet, Header, Icon, Screen, Sheet,
  Spinner, Text, Touchable, fireHaptic, toast, type IconName,
} from '@/ui'
import { AuthorRow } from '@/components/post/AuthorRow'
import { VoicePreviewTile, VoiceRecordingSurface, useVoicePostRecorder, type VoiceTake } from '@/components/post/VoiceCapture'
import { putCreatedPost } from '@/components/feed/feedInbox'
import { isBlocked, isNsfwBlocked, isScreeningDown, isUnderReview, moderationText } from '@/lib/moderation'
import { prepareUploads, type PickedAsset } from '@/lib/mediaTier'
import { checkAssets, extOf } from '@/lib/fileMeta'
import { toUploadFile } from '@/platform/files'
import { storage } from '@/platform/storage'
import type { FeedAuthor, PostView } from '@/components/feed/types'

const MAX_MEDIA = 10
const COUNTER_AT = 4500
const DRAFT_KEY = 'ika:compose-draft'
const TILE = 96
const TILE_GAP = 8

type Visibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'ONLY_ME'

const VISIBILITY: { value: Visibility; label: string; note: string; icon: IconName }[] = [
  { value: 'PUBLIC', label: 'Public', note: 'Anyone on Hikmah Web can see this post.', icon: 'globe' },
  { value: 'FOLLOWERS_ONLY', label: 'Followers', note: 'Only people who follow you.', icon: 'people' },
  { value: 'ONLY_ME', label: 'Only me', note: 'Visible to you alone — a private note.', icon: 'lock' },
]

interface Tile {
  key: string
  asset: PickedAsset
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'
  /** The pristine picker uri, kept from the first crop on so a SECOND edit
   *  crops the original again instead of the crop. */
  sourceUri?: string
  failed?: string | null
}

export default function ComposeScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { sharedPostId, pick: pickOnOpen } = useLocalSearchParams<{ sharedPostId?: string; pick?: string }>()

  const [text, setText] = React.useState('')
  const [visibility, setVisibility] = React.useState<Visibility>('PUBLIC')
  const [tiles, setTiles] = React.useState<Tile[]>([])
  const [locationName, setLocationName] = React.useState('')
  const [showLocation, setShowLocation] = React.useState(false)
  /* Filled only by "use current location" — the docs expose locationLat/Lng
     alongside the name, and typing a name by hand rightly leaves them null. */
  const [locationCoords, setLocationCoords] = React.useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = React.useState(false)
  const [cropTile, setCropTile] = React.useState<Tile | null>(null)

  const applyCrop = React.useCallback((res: CropResult) => {
    const key = cropTile?.key
    setCropTile(null)
    if (!key) return
    setTiles(prev => prev.map(tl => (tl.key === key ? {
      ...tl,
      sourceUri: tl.sourceUri ?? tl.asset.uri,
      asset: {
        ...tl.asset,
        uri: res.uri,
        width: res.width,
        height: res.height,
        mimeType: 'image/jpeg',
        fileName: `${String(tl.asset.fileName || (tl.asset as any).name || 'photo').replace(/\.[^.]+$/, '')}.jpg`,
        fileSize: undefined,
      },
    } : tl)))
  }, [cropTile])
  const [sound, setSound] = React.useState<{ id: string; title: string } | null>(null)

  const [publishing, setPublishing] = React.useState(false)
  /* Real multipart byte progress (0..1) while publishing; null when idle or
     for text-only posts. Discard during publishing aborts via this. */
  const [pubProgress, setPubProgress] = React.useState<number | null>(null)
  const pubAbort = React.useRef<AbortController | null>(null)
  const [error, setError] = React.useState<any>(null)
  const [blockedCopy, setBlockedCopy] = React.useState<string | null>(null)
  const [retryable, setRetryable] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  const [visOpen, setVisOpen] = React.useState(false)
  const [soundOpen, setSoundOpen] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)

  const [selection, setSelection] = React.useState({ start: 0, end: 0 })
  const inputRef = React.useRef<TextInput>(null)

  const repost = useLoadedRepost(sharedPostId)
  const isRepost = !!sharedPostId
  const isVoice = tiles.some(x => x.kind === 'AUDIO')

  /* The AUDIO tile stays the publish contract; `take` is presentation
     riding beside it — the metering shape and duration the preview plate
     draws, which the upload never sees. */
  const rec = useVoicePostRecorder()
  const [take, setTake] = React.useState<VoiceTake | null>(null)

  /* ---------- draft persistence ---------- */

  React.useEffect(() => {
    if (isRepost) return
    try {
      const raw = storage.getItem(DRAFT_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved?.text) setText(saved.text)
      if (saved?.visibility) setVisibility(saved.visibility)
      if (saved?.locationName) { setLocationName(saved.locationName); setShowLocation(true) }
    } catch { /* a corrupt draft is not worth a crash */ }
  }, [isRepost])

  React.useEffect(() => {
    if (isRepost) return
    /* Media lives at a picker URI that may not survive a restart, so only the
       text side of the draft is persisted. */
    try {
      if (text || locationName) storage.setItem(DRAFT_KEY, JSON.stringify({ text, visibility, locationName }))
      else storage.removeItem(DRAFT_KEY)
    } catch { /* private mode — keep it in memory */ }
  }, [text, visibility, locationName, isRepost])

  const dirty = !!text.trim() || tiles.length > 0 || !!locationName.trim()

  /* One tap pins the place: coordinates from the OS, the reverse-geocoded
     name as an editable suggestion. Editing the name by hand DROPS the pin —
     a name that no longer matches the coordinates is worse than no pin. */
  const useCurrentLocation = React.useCallback(async () => {
    if (locating) return
    setLocating(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!perm.granted) { toast.warn('Allow location access in Settings to pin a place.'); return }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = pos.coords
      setLocationCoords({ lat: latitude, lng: longitude })
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude })
        const place: any = places?.[0]
        const name = [
          place?.name && place.name !== place?.street ? place.name : null,
          place?.city || place?.subregion,
          place?.country,
        ].filter(Boolean).join(', ')
        if (name) setLocationName(name)
      } catch { /* the pin stands without a pretty name */ }
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setLocating(false)
    }
  }, [locating])
  /* No publishing mid-recording: the take is not a tile until Finish. */
  const canPost = (dirty || isRepost) && !publishing && cooldown === 0 && !rec.active

  /* ---------- autocomplete ---------- */

  const token = React.useMemo(() => activeToken(text, selection.start), [text, selection.start])
  const query = useDebounced(token?.query ?? '', 220)
  const [mentionRows, setMentionRows] = React.useState<FeedAuthor[]>([])
  const [tagRows, setTagRows] = React.useState<{ tag: string; count?: number }[]>([])

  React.useEffect(() => {
    if (!token || !query) { setMentionRows([]); setTagRows([]); return }
    let alive = true
    if (token.sigil === '@') {
      api.mentions.suggest(query, 6)
        .then((rows: any) => { if (alive) setMentionRows(rows || []) })
        .catch(() => { if (alive) setMentionRows([]) })
    } else {
      /* `api.tags.search` is JS and TypeScript reads its parameter shape off
         the `= {}` default, which only surfaces the keys that carry one. */
      api.tags.search({ prefix: query, scope: 'POST', limit: 8 } as any)
        .then((rows: any) => { if (alive) setTagRows(rows || []) })
        .catch(() => { if (alive) setTagRows([]) })
    }
    return () => { alive = false }
  }, [token?.sigil, query])   // eslint-disable-line react-hooks/exhaustive-deps

  const applySuggestion = (value: string, targetUserId?: string) => {
    if (!token) return
    const next = `${text.slice(0, token.start)}${token.sigil}${value} ${text.slice(token.end)}`
    setText(next)
    setMentionRows([])
    setTagRows([])
    if (targetUserId) api.mentions.click(query, targetUserId).catch(() => {})
  }

  /* ---------- media ---------- */

  const pick = async (from: 'library' | 'camera') => {
    const remaining = MAX_MEDIA - tiles.length
    if (remaining <= 0) return
    try {
      const res = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: remaining,
          quality: 1,
        })
      if (res.canceled || !res.assets?.length) return

      /* Fail fast on doomed picks (size caps / blocked types) — the server
         re-checks everything authoritatively. */
      const { ok: accepted, rejected } = checkAssets(res.assets, 'post')
      rejected.forEach(v => toast.warn(`${v.asset.fileName || 'File'}: ${v.reason}`))
      if (!accepted.length) return

      /* prepareUploads honours the user's media tier — downscaling before the
         bytes leave, not after the server has paid for them. */
      const ready = await prepareUploads(accepted as unknown as PickedAsset[])
      setTiles(prev => [
        ...prev,
        ...ready.slice(0, remaining).map((asset, i) => ({
          key: `${Date.now()}:${i}`,
          asset,
          kind: (String(asset.type || '').startsWith('video') || String((asset as any).mimeType || '').startsWith('video')
            ? 'VIDEO'
            : 'IMAGE') as Tile['kind'],
        })),
      ])
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* Document/File attach — WhatsApp/Telegram-style second picker, no type
     filter: the backend accepts any non-executable file on posts and returns
     it typed OTHER. */
  const pickDocument = async () => {
    const remaining = MAX_MEDIA - tiles.length
    if (remaining <= 0) return
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
      if (res.canceled || !res.assets?.length) return
      const { ok: docs, rejected } = checkAssets(res.assets, 'post')
      rejected.forEach(v => toast.warn(`${v.asset.name || 'File'}: ${v.reason}`))
      if (!docs.length) return
      setTiles(prev => [
        ...prev,
        ...docs.slice(0, remaining).map((a: any, i: number) => ({
          key: `${Date.now()}:doc:${i}`,
          asset: { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size } as unknown as PickedAsset,
          kind: 'FILE' as Tile['kind'],
        })),
      ])
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* The feed's "Photo" door opens the gallery for you (`/compose?pick=library`).
     Deliberately once per mount and on a short delay: the screen's entrance
     has to finish before the OS sheet covers it, or the transition is thrown
     away half-drawn — and a re-run on any later render would re-open the
     picker under the user's hand. */
  const autoPicked = React.useRef(false)
  React.useEffect(() => {
    if (autoPicked.current) return
    if (pickOnOpen !== 'library' && pickOnOpen !== 'camera') return
    autoPicked.current = true
    const id = setTimeout(() => { void pick(pickOnOpen) }, 280)
    return () => clearTimeout(id)
  }, [pickOnOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Starting over an existing take is re-record: the old preview stays put
     until the new take actually lands, so a cancelled retry costs nothing. */
  const startVoice = () => { void rec.start() }

  const finishVoice = async () => {
    const result = await rec.finish()
    if (!result) return
    /* Verify the file actually landed on disk BEFORE it becomes a tile. A
       part that fetch cannot read fails as a bare "Network request failed",
       which the error layer can only render as the offline copy — a lie
       with the server perfectly reachable. Catch it here, with the truth. */
    const info = await getInfoAsync(result.uri).catch(() => null)
    if (!info?.exists || !info.size) {
      toast.error('The recording could not be read from disk — try recording again.')
      return
    }
    setTake(result)
    setTiles([{
      key: `voice:${Date.now()}`,
      asset: { uri: result.uri, name: result.name, type: result.type } as PickedAsset,
      kind: 'AUDIO',
    }])
  }

  const removeVoice = () => {
    setTake(null)
    setTiles(prev => prev.filter(x => x.kind !== 'AUDIO'))
  }

  /* The recorder must not outlive the screen: backing out mid-recording
     would leave the iOS session in record mode. Same guard as chat's
     composer. */
  const recRef = React.useRef(rec)
  recRef.current = rec
  React.useEffect(() => () => {
    if (recRef.current.active) void recRef.current.cancel().catch(() => {})
  }, [])

  const move = React.useCallback((from: number, to: number) => {
    setTiles(prev => {
      if (to < 0 || to >= prev.length || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  /* ---------- publish ---------- */

  const publish = async () => {
    if (!canPost) return
    setPublishing(true)
    setError(null)
    setBlockedCopy(null)
    setRetryable(false)
    setFieldErrors({})

    try {
      /* A tile whose file has vanished (OS-pruned cache, cleaned tmp dir)
         makes fetch fail with a bare network error — indistinguishable from
         being offline. Verify every local file is still readable so the
         failure names the actual culprit. */
      for (const tile of tiles) {
        const uri = tile.asset?.uri || ''
        if (!uri.startsWith('file:')) continue
        const info = await getInfoAsync(uri).catch(() => null)
        if (!info?.exists || !info.size) {
          throw new Error('An attached file is no longer available on this device — remove it and add it again.')
        }
      }

      const postType = isRepost ? 'REPOST'
        : isVoice ? 'VOICE_POST'
          : tiles.length ? 'EMBEDDED' : 'TEXT'

      const fd = new FormData()
      fd.append('postType', postType)
      fd.append('visibility', visibility)
      fd.append('textContent', text)
      if (locationName.trim()) fd.append('locationName', locationName.trim())
      if (locationName.trim() && locationCoords) {
        fd.append('locationLat', String(locationCoords.lat))
        fd.append('locationLng', String(locationCoords.lng))
      }
      if (sharedPostId) fd.append('sharedPostId', String(sharedPostId))
      if (sound?.id) fd.append('soundId', String(sound.id))
      for (const tile of tiles) {
        fd.append('files[]', toUploadFile(tile.asset) as unknown as Blob)
      }

      const controller = new AbortController()
      pubAbort.current = controller
      if (tiles.length) setPubProgress(0)
      const created: PostView = await api.posts.createMultipart(fd, {
        onProgress: tiles.length ? setPubProgress : undefined,
        signal: controller.signal,
      })

      /* A 200 whose status is PENDING_REVIEW is NOT an error: the post is
         inserted and the feed's Checking… badge + recheck schedule take over. */
      putCreatedPost(created)
      try { storage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ }
      fireHaptic('success')
      router.back()
    } catch (e: any) {
      if (e?.name === 'AbortError') { return }   // deliberate cancel — draft intact, no banner
      fireHaptic('error')
      const adHoc = e?.payload?.error
      if (adHoc === 'upload_failed' || adHoc === 'post_create_failed') {
        /* Every uploaded key was rolled back server-side and nothing was
           published, so a straight retry is safe here — and only here. */
        setRetryable(true)
        setError(e)
      } else if (isBlocked(e) || isUnderReview(e)) {
        setBlockedCopy(moderationText(e))
      } else if (isNsfwBlocked(e)) {
        /* The image gate refused a file (or a video's poster frame) — the whole
           batch rolled back server-side, nothing was published. Terminal: the
           same bytes score the same, so no retry button; the tiles stay staged
           so the user can remove the offending one and post again. The envelope
           does not say WHICH file tripped, so the banner speaks to the batch. */
        setBlockedCopy(moderationText(e))
      } else if (isScreeningDown(e)) {
        /* Strict-mode screening outage — transient by contract. Same one-tap
           retry as a rolled-back upload, re-using the staged tiles. */
        setRetryable(true)
        setError(e)
      } else if (isRateLimited(e)) {
        startCooldown(e)
        setError(e)
      } else if (codeOf(e) === 'VALIDATION_FAILED') {
        setFieldErrors(fieldErrorMap(e, { textContent: 'text' }) as Record<string, string>)
      } else {
        setError(e)
      }
    } finally {
      setPublishing(false)
      setPubProgress(null)
      pubAbort.current = null
    }
  }

  const cancel = () => {
    /* While publishing, the header button reads Discard — its honest job then
       is to stop the upload, not to navigate. The draft stays staged. */
    if (publishing) { pubAbort.current?.abort(); return }
    if (dirty && !isRepost) { setConfirmDiscard(true); return }
    router.back()
  }

  /* Hardware back runs the same handler as Cancel. Armed while publishing too,
     so a reflex back mid-upload is inert rather than popping the screen out
     from under an in-flight post. */
  useDiscardGuard(publishing || (dirty && !isRepost), cancel)

  /* ---------- render ---------- */

  const showSuggestions = !!token && (mentionRows.length > 0 || tagRows.length > 0)

  return (
    <Screen background="elevated">
      <Header
        titleNode={
          <View style={styles.headerRow}>
            <Touchable onPress={cancel} feedback="dim" noAutoHitSlop style={styles.headerBtn}>
              <Text variant="callout" tone={publishing ? 'muted' : 'accent'}>
                {publishing ? 'Discard' : 'Cancel'}
              </Text>
            </Touchable>
            <View style={styles.headerTitle}>
              <Text variant="headline" align="center">{isRepost ? 'Repost' : 'New post'}</Text>
              {publishing ? (
                <Text variant="caption" tone="muted" align="center">
                  {tiles.length
                    ? `Uploading ${tiles.length} item${tiles.length === 1 ? '' : 's'}…${pubProgress != null ? ` ${Math.round(pubProgress * 100)}%` : ''}`
                    : 'Publishing…'}
                </Text>
              ) : null}
            </View>
            <Touchable
              onPress={() => { void publish() }}
              disabled={!canPost}
              feedback="scale"
              haptic="light"
              accessibilityLabel="Publish"
              style={[
                styles.postPlate,
                { backgroundColor: canPost ? c.accent : c.surfaceSunken },
              ]}
            >
              {publishing ? (
                <Spinner color={c.textOnAccent} />
              ) : (
                <Text variant="subhead" weight="700" color={canPost ? c.textOnAccent : c.textFaint}>
                  {cooldown > 0 ? `Wait ${cooldown}s` : 'Post'}
                </Text>
              )}
            </Touchable>
          </View>
        }
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {blockedCopy ? (
          /* Verbatim from the server, no retry, no category named. */
          <Callout tone="danger" style={styles.banner}>{blockedCopy}</Callout>
        ) : null}
        {error ? (
          <Callout
            tone="danger"
            style={styles.banner}
            actionLabel={retryable ? 'Try again' : undefined}
            onAction={retryable ? () => { void publish() } : undefined}
          >
            {retryable && !isScreeningDown(error) ? 'Upload failed — nothing was published, please try again.' : errorText(error)}
          </Callout>
        ) : null}

        <View style={styles.authorStrip}>
          <Avatar uri={user?.profileImage} name={user?.displayName ?? user?.full} seed={user?.id} size={36} />
          <Text variant="subhead" weight="600" numberOfLines={1} style={styles.flex}>
            {user?.displayName || user?.full || 'You'}
          </Text>
          <Touchable
            onPress={() => setVisOpen(true)}
            feedback="scale"
            style={[styles.visChip, { backgroundColor: c.surfaceSunken, ...setback(t.shape.chip), borderCurve: 'continuous' as const }]}
          >
            <Icon name={VISIBILITY.find(v => v.value === visibility)!.icon} size={13} color={c.textSecondary} />
            <Text variant="footnote" tone="secondary">{VISIBILITY.find(v => v.value === visibility)!.label}</Text>
            <Icon name="down" size={12} color={c.textFaint} />
          </Touchable>
        </View>

        {visibility === 'ONLY_ME' ? (
          <Text variant="footnote" tone="muted" align="ui" style={styles.caution}>Only you will see this post.</Text>
        ) : null}

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={v => { setText(v); if (blockedCopy) setBlockedCopy(null) }}
          onSelectionChange={e => setSelection(e.nativeEvent.selection)}
          placeholder={isRepost ? 'Add a comment…' : 'Share something…'}
          placeholderTextColor={c.textFaint}
          multiline
          autoFocus
          allowFontScaling={false}
          editable={!publishing}
          style={[
            styles.editor,
            { color: c.text, writingDirection: t.isRTL ? 'rtl' : 'ltr' },
            fieldErrors.text ? { borderColor: c.danger, borderWidth: 1, borderRadius: t.radius.sm, padding: space.sm2 } : null,
          ]}
        />
        {fieldErrors.text ? (
          <Text variant="footnote" tone="danger" align="ui" style={styles.gutter}>{fieldErrors.text}</Text>
        ) : null}

        {text.length > COUNTER_AT ? (
          <Text variant="footnote" tone="muted" style={styles.counter}>{text.length}</Text>
        ) : null}

        {/* Changing the text re-extracts hashtags server-side, which is the
            kind of side effect worth one line rather than a support ticket. */}
        {/[#][\p{L}\p{N}_]/u.test(text) ? (
          <Text variant="caption" tone="faint" align="ui" style={styles.gutter}>
            Hashtags move this post between tag feeds.
          </Text>
        ) : null}

        {isRepost ? (
          <View style={[styles.repostCard, { borderColor: c.border, borderRadius: t.radius.sm }]}>
            {repost ? (
              <>
                <AuthorRow author={repost._author} time={repost.time} size={24} />
                <Text variant="footnote" numberOfLines={3} style={{ marginTop: space.sm }}>{repost.body}</Text>
              </>
            ) : (
              <Text variant="footnote" tone="muted">Loading the original post…</Text>
            )}
          </View>
        ) : rec.active ? (
          /* The preview unmounts while the mic is live: its player would
             otherwise fight the recorder for the iOS audio session — and a
             take you can play over your own re-record is nonsense anyway. */
          null
        ) : take && isVoice ? (
          <VoicePreviewTile
            uri={take.uri}
            durationMs={take.durationMs}
            samples={take.samples}
            disabled={publishing}
            onReRecord={startVoice}
            onRemove={removeVoice}
            style={styles.voiceTray}
          />
        ) : tiles.length ? (
          <MediaTray tiles={tiles} publishing={publishing} onRemove={k => setTiles(prev => prev.filter(x => x.key !== k))} onMove={move} onEdit={k => { const tl = tiles.find(x => x.key === k); if (tl?.kind === 'IMAGE') setCropTile(tl) }} />
        ) : null}

        {showLocation ? (
          <View style={[styles.locationRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}>
            <Icon name="location" size={16} color={c.textMuted} />
            <TextInput
              value={locationName}
              onChangeText={v => { setLocationName(v); setLocationCoords(null) }}
              placeholder="Add a location"
              placeholderTextColor={c.textFaint}
              allowFontScaling={false}
              style={[styles.locationInput, { color: c.text, fontSize: t.type.callout.fontSize }]}
            />
            <Touchable
              onPress={() => { void useCurrentLocation() }}
              disabled={locating}
              feedback="dim"
              hitSlop={8}
              accessibilityLabel={locationCoords ? 'Location pinned — pin again' : 'Use current location'}
            >
              {locating
                ? <Spinner color={c.textMuted} />
                : <Icon name="explore" size={15} color={locationCoords ? c.accent : c.textMuted} filled={!!locationCoords} />}
            </Touchable>
            <Touchable onPress={() => { setShowLocation(false); setLocationName(''); setLocationCoords(null) }} feedback="dim" hitSlop={8} accessibilityLabel="Remove location">
              <Icon name="close" size={15} color={c.textMuted} />
            </Touchable>
          </View>
        ) : null}

        {sound ? (
          <View style={[styles.locationRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}>
            <Icon name="music" size={16} color={c.textMuted} />
            <Text variant="footnote" tone="secondary" numberOfLines={1} style={styles.flex}>{sound.title}</Text>
            <Touchable onPress={() => setSound(null)} feedback="dim" hitSlop={8} accessibilityLabel="Remove sound">
              <Icon name="close" size={15} color={c.textMuted} />
            </Touchable>
          </View>
        ) : null}

      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        {showSuggestions ? (
          <View style={[styles.suggestions, { backgroundColor: c.surface, borderTopColor: c.separator }]}>
            <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 232 }}>
              {token?.sigil === '@'
                ? mentionRows.map(row => (
                  <Touchable
                    key={row.id}
                    onPress={() => applySuggestion(row.handle, row.id)}
                    feedback="tint"
                    noAutoHitSlop
                    style={styles.suggestionRow}
                  >
                    <Avatar uri={row.profileImage} name={row.full} seed={row.id} size={32} />
                    <Text variant="subhead" weight="600" numberOfLines={1}>{row.full}</Text>
                    <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>@{row.handle}</Text>
                  </Touchable>
                ))
                : tagRows.map(row => (
                  <Touchable
                    key={row.tag}
                    onPress={() => applySuggestion(row.tag)}
                    feedback="tint"
                    noAutoHitSlop
                    style={styles.suggestionRow}
                  >
                    <Icon name="hash" size={16} color={c.textMuted} />
                    <Text variant="subhead" weight="600" numberOfLines={1} style={styles.flex}>{row.tag}</Text>
                    {row.count ? <Text variant="caption" tone="faint">{row.count}</Text> : null}
                  </Touchable>
                ))}
            </ScrollView>
          </View>
        ) : null}

        {/* The tool row is a fixed 48; the inset rides BELOW it as its own
            spacer (`Math.max` pattern, DESIGN.md §8) — `paddingBottom` inside
            a height-constrained row squeezes the icons instead of clearing
            the gesture-nav pill. */}
        <View style={[styles.toolbar, { borderTopColor: c.separator, backgroundColor: c.bgElevated }]}>
          {rec.active ? (
            /* Recording replaces the tool row wholesale — the chat overlay
               grammar: red dot, ledger clock, live meter, trash, finish. */
            <VoiceRecordingSurface
              seconds={rec.seconds}
              meter={rec.meter}
              onCancel={() => { void rec.cancel() }}
              onFinish={() => { void finishVoice() }}
            />
          ) : (
            <>
              {!isRepost ? (
                <>
                  <Tool icon="gallery" label="Photos or video" onPress={() => { void pick('library') }} disabled={publishing || isVoice || tiles.length >= MAX_MEDIA} />
                  <Tool icon="camera" label="Camera" onPress={() => { void pick('camera') }} disabled={publishing || isVoice || tiles.length >= MAX_MEDIA} />
                  <Tool icon="attachment" label="Document or file" onPress={() => { void pickDocument() }} disabled={publishing || isVoice || tiles.length >= MAX_MEDIA} />
                  <Tool icon="mic" label="Voice post" onPress={startVoice} disabled={publishing || tiles.some(x => x.kind !== 'AUDIO')} />
                  <Tool icon="location" label="Add a location" onPress={() => setShowLocation(true)} disabled={publishing} />
                  <Tool icon="music" label="Add a sound" onPress={() => setSoundOpen(true)} disabled={publishing} />
                </>
              ) : null}
              <View style={styles.flex} />
              {!isRepost ? (
                <Text variant="footnote" tone="muted">{tiles.length}/{MAX_MEDIA}</Text>
              ) : null}
            </>
          )}
        </View>
        <View style={{ height: insets.bottom, backgroundColor: c.bgElevated }} />
      </KeyboardStickyView>

      {/* The caged 10Hz status poll — mounted only while recording. */}
      {rec.engine}

      <CropSheet
        visible={!!cropTile}
        uri={cropTile ? (cropTile.sourceUri ?? cropTile.asset.uri) : null}
        onClose={() => setCropTile(null)}
        onDone={applyCrop}
      />

      <VisibilitySheet
        visible={visOpen}
        onClose={() => setVisOpen(false)}
        value={visibility}
        onChange={v => { setVisibility(v); setVisOpen(false) }}
      />

      <SoundSheet visible={soundOpen} onClose={() => setSoundOpen(false)} onPick={s => { setSound(s); setSoundOpen(false) }} />

      <ConfirmSheet
        visible={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this post?"
        message="Your draft is saved on this device until you post or discard it."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false)
          try { storage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ }
          router.back()
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Media tray with long-press reorder.
   --------------------------------------------------------- */

function MediaTray({
  tiles, publishing, onRemove, onMove, onEdit,
}: {
  tiles: Tile[]
  publishing: boolean
  onRemove: (key: string) => void
  onMove: (from: number, to: number) => void
  onEdit?: (key: string) => void
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray}>
      {tiles.map((tile, i) => (
        <TrayTile
          key={tile.key}
          tile={tile}
          index={i}
          count={tiles.length}
          publishing={publishing}
          onRemove={() => onRemove(tile.key)}
          onEdit={onEdit && tile.kind === 'IMAGE' ? () => onEdit(tile.key) : undefined}
          onMove={onMove}
        />
      ))}
    </ScrollView>
  )
}

function TrayTile({
  tile, index, count, publishing, onRemove, onEdit, onMove,
}: {
  tile: Tile
  index: number
  count: number
  publishing: boolean
  onRemove: () => void
  onEdit?: () => void
  onMove: (from: number, to: number) => void
}) {
  const t = useTheme()
  const c = t.colors
  const tx = useSharedValue(0)
  const lifted = useSharedValue(0)
  const step = TILE + TILE_GAP

  /* Commit ONCE, on release. Reordering live would mean the UI thread calling
     back into JS every frame while the array it is measuring against is being
     rewritten — one fast drag then jumps several slots. */
  const drop = React.useCallback((dx: number) => {
    const to = Math.max(0, Math.min(count - 1, index + Math.round(dx / step)))
    if (to !== index) onMove(index, to)
  }, [count, index, onMove, step])

  /* Memoized on exactly what the worklets close over. GestureDetector diffs
     the gesture by handler identity, so rebuilding it every render
     re-registers the handler config with the native gesture-handler module —
     for every tile in the tray, on every keystroke in the composer. */
  const spring = t.motion.spring
  const drag = React.useMemo(() => Gesture.Pan()
    .activateAfterLongPress(220)
    .enabled(!publishing && count > 1)
    .onStart(() => { lifted.value = withSpring(1, spring); runOnJS(fireHaptic)('medium') })
    .onUpdate(e => { tx.value = e.translationX })
    .onEnd(e => {
      runOnJS(drop)(e.translationX)
      tx.value = withSpring(0, spring)
      lifted.value = withSpring(0, spring)
    /* The two shared values are deliberately NOT deps: useSharedValue handles
       are stable for the life of the tile, and listing them would make the
       compiler read them as hook arguments the worklets must not write to. */
    }), [publishing, count, drop, spring])   // eslint-disable-line react-hooks/exhaustive-deps

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { scale: 1 + lifted.value * 0.06 }],
    zIndex: lifted.value > 0 ? 2 : 1,
  }))

  return (
    <GestureDetector gesture={drag}>
      <Animated.View style={anim}>
        <View style={[styles.tile, { borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}>
          {tile.kind === 'AUDIO' || tile.kind === 'FILE' ? (
            <View style={styles.tileCenter}>
              <Icon name={tile.kind === 'FILE' ? 'attachment' : 'mic'} size={24} color={c.textMuted} />
              {tile.kind === 'FILE' ? (
                <Text variant="micro" color={c.textMuted} numberOfLines={1}>
                  {(extOf((tile.asset as any).name) || 'file').toUpperCase()}
                </Text>
              ) : null}
            </View>
          ) : (
            <Image source={{ uri: tile.asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
          )}

          {tile.kind === 'VIDEO' ? (
            <View style={[styles.tileChip, { backgroundColor: c.overlayChip }]}>
              <Icon name="video" size={10} color={c.overlayText} />
              <Text variant="micro" color={c.overlayText}>VIDEO</Text>
            </View>
          ) : null}

          {publishing ? (
            <View style={[StyleSheet.absoluteFill, styles.tileCenter, { backgroundColor: c.overlayChip }]}>
              <Spinner color={c.overlayText} />
            </View>
          ) : (
            <>
              <Touchable onPress={onRemove} feedback="scale" accessibilityLabel="Remove" hitSlop={6} style={[styles.tileClose, { backgroundColor: c.overlayChip }]}>
                <Icon name="close" size={12} color={c.overlayText} />
              </Touchable>
              {onEdit ? (
                <Touchable onPress={onEdit} feedback="scale" accessibilityLabel="Crop photo" hitSlop={6} style={[styles.tileEdit, { backgroundColor: c.overlayChip }]}>
                  <Icon name="crop" size={12} color={c.overlayText} />
                </Touchable>
              ) : null}
            </>
          )}

          {tile.failed ? (
            <View style={[StyleSheet.absoluteFill, styles.tileCenter, { backgroundColor: c.dangerSoft }]}>
              <Icon name="error" size={18} color={c.danger} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </GestureDetector>
  )
}

/* ---------------------------------------------------------
   Sheets.
   --------------------------------------------------------- */

function VisibilitySheet({
  visible, onClose, value, onChange,
}: { visible: boolean; onClose: () => void; value: Visibility; onChange: (v: Visibility) => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Sheet visible={visible} onClose={onClose} title="Who can see this?">
      <View style={{ paddingBottom: space.sm }}>
        {VISIBILITY.map(opt => (
          <Touchable key={opt.value} onPress={() => onChange(opt.value)} feedback="tint" noAutoHitSlop style={styles.visRow}>
            <Icon name={opt.icon} size={20} color={value === opt.value ? c.accent : c.textSecondary} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">{opt.label}</Text>
              <Text variant="footnote" tone="muted" style={{ marginTop: space.xxs }}>{opt.note}</Text>
            </View>
            {value === opt.value ? <Icon name="checkCircle" size={20} color={c.accent} filled /> : null}
          </Touchable>
        ))}
      </View>
    </Sheet>
  )
}

const SOUND_CATEGORIES = ['TRENDING', 'NASHEED', 'RECITATION', 'AMBIENT', 'SPEECH']

function SoundSheet({
  visible, onClose, onPick,
}: { visible: boolean; onClose: () => void; onPick: (s: { id: string; title: string }) => void }) {
  const t = useTheme()
  const c = t.colors
  const [q, setQ] = React.useState('')
  const term = useDebounced(q, 260)
  const [rows, setRows] = React.useState<any[]>([])
  const [category, setCategory] = React.useState(SOUND_CATEGORIES[0])

  React.useEffect(() => {
    if (!visible) return
    let alive = true
    /* A blank query answers [] by contract — the category browser is the
       listing surface, not a client-side fallback we invented. */
    const p = term.trim()
      ? api.sounds.search(term, { limit: 20 })
      : api.sounds.byCategory(category, { pageSize: 20 })
    p.then((r: any) => { if (alive) setRows(r || []) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [visible, term, category])

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a sound">
      <View style={styles.soundSearch}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search sounds"
          placeholderTextColor={c.textFaint}
          allowFontScaling={false}
          style={[styles.locationInput, { color: c.text, backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm, paddingHorizontal: space.md, height: 40 }]}
        />
      </View>
      {!term.trim() ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.soundCats}>
          {SOUND_CATEGORIES.map(cat => (
            <Touchable
              key={cat}
              onPress={() => setCategory(cat)}
              feedback="scale"
              style={[
                styles.catChip,
                { backgroundColor: cat === category ? c.accent : c.surfaceSunken, ...setback(t.shape.chip), borderCurve: 'continuous' as const },
              ]}
            >
              <Text variant="footnote" weight="600" color={cat === category ? c.textOnAccent : c.textSecondary}>
                {cat.charAt(0) + cat.slice(1).toLowerCase()}
              </Text>
            </Touchable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ paddingBottom: space.md }}>
        {rows.map(row => (
          <Touchable
            key={row.id}
            onPress={() => onPick({ id: String(row.id), title: row.title || 'Sound' })}
            feedback="tint"
            noAutoHitSlop
            style={styles.suggestionRow}
          >
            <Icon name="music" size={18} color={c.textMuted} />
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" numberOfLines={1}>{row.title || 'Sound'}</Text>
              {row.artistName ? <Text variant="caption" tone="muted" numberOfLines={1}>{row.artistName}</Text> : null}
            </View>
          </Touchable>
        ))}
        {!rows.length ? (
          <Text variant="footnote" tone="muted" align="center" style={{ paddingVertical: 22 }}>
            Nothing here yet.
          </Text>
        ) : null}
      </View>
    </Sheet>
  )
}

function Tool({
  icon, label, onPress, disabled, active,
}: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  const t = useTheme()
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="scale"
      haptic="light"
      accessibilityLabel={label}
      style={styles.tool}
    >
      <Icon name={icon} size={21} color={active ? t.colors.danger : t.colors.textSecondary} filled={active} />
    </Touchable>
  )
}

/* ---------------------------------------------------------
   Helpers.
   --------------------------------------------------------- */

function useLoadedRepost(sharedPostId?: string) {
  const [post, setPost] = React.useState<PostView | null>(null)
  React.useEffect(() => {
    if (!sharedPostId) return
    let alive = true
    api.posts.get(sharedPostId)
      .then((p: any) => { if (alive) setPost(p) })
      .catch(() => {})
    return () => { alive = false }
  }, [sharedPostId])
  return post
}

/** The '@'/'#' token under the caret, or null. */
function activeToken(text: string, caret: number): { sigil: '@' | '#'; query: string; start: number; end: number } | null {
  let i = caret - 1
  while (i >= 0 && /[\p{L}\p{N}_]/u.test(text[i])) i--
  if (i < 0) return null
  const sigil = text[i]
  if (sigil !== '@' && sigil !== '#') return null
  /* A sigil glued to a word ("me@example") is not a token. */
  if (i > 0 && /[\p{L}\p{N}_]/u.test(text[i - 1])) return null
  return { sigil, query: text.slice(i + 1, caret), start: i, end: caret }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gutter: { paddingHorizontal: space.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerBtn: { paddingVertical: space.xs2, paddingHorizontal: space.xs },
  headerTitle: { flex: 1, alignItems: 'center' },
  /* A small BUTTON, so it wears the sm setback — the app's only pills are
     unread counters and LIVE badges. */
  postPlate: {
    height: 32,
    minWidth: 68,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...setback(shape.buttonSm),
    borderCurve: 'continuous',
  },
  body: { paddingBottom: 28 },
  banner: { margin: space.lg, marginBottom: space.xs },
  authorStrip: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingTop: space.md2 },
  visChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 28, paddingHorizontal: space.sm2 },
  caution: { paddingHorizontal: space.lg, paddingTop: space.sm },
  editor: { minHeight: 120, paddingHorizontal: space.lg, paddingTop: space.md2, fontSize: 17, lineHeight: 24 },
  counter: { alignSelf: 'flex-end', paddingHorizontal: space.lg, paddingTop: space.xs },
  repostCard: { margin: space.lg, padding: space.md, borderWidth: StyleSheet.hairlineWidth },
  tray: { paddingHorizontal: space.lg, paddingTop: space.md2, gap: TILE_GAP },
  tile: { width: TILE, height: TILE, overflow: 'hidden' },
  tileCenter: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  tileChip: {
    position: 'absolute', bottom: 5, start: 5, flexDirection: 'row', alignItems: 'center',
    gap: space.xs, height: 16, paddingHorizontal: space.xs2, borderRadius: 4,
  },
  tileClose: {
    position: 'absolute', top: 5, end: 5, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  /* The crop door, opposite corner from remove. */
  tileEdit: {
    position: 'absolute', bottom: 4, start: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginTop: space.md2, paddingHorizontal: space.md, height: 44 },
  locationInput: { flex: 1 },
  voiceTray: { marginHorizontal: space.lg, marginTop: space.md2 },
  suggestions: { borderTopWidth: StyleSheet.hairlineWidth },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  tool: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: space.md2, paddingHorizontal: space.xl, paddingVertical: space.md2 },
  soundSearch: { paddingHorizontal: space.lg, paddingTop: space.md },
  soundCats: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  catChip: { height: 30, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
})
