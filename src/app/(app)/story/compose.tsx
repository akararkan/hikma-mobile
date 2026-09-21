/* =========================================================
   The story composer.

   Four ways in (camera, library, text, a shared entity) and
   one way out. Three things here are contracts rather than
   choices:

     · storyType is ALWAYS sent explicitly — the multipart
       variant defaults to the non-canonical 'PHOTO'
     · a TEXT frame must carry no media, or the words vanish
       behind the picture
     · a moderation refusal keeps the draft and offers no retry
       button: resubmitting identical text can only fail the
       identical way

   BACKGROUNDS. The create contract has no background field, so
   an author-chosen colour cannot be persisted as data — it has
   to become pixels. Picking one therefore flattens the composed
   frame with view-shot and posts it as an IMAGE story. The words
   still ride in `textContent` (search, moderation, the grid's
   placeholder) — and since the viewer now paints media captions
   (stories.md: textContent IS the caption; a photo+caption story
   must show its words), a flattened frame shows them twice: once
   baked, once in the bar. Accepted — these frames expire in ≤24h
   and a caption that never renders was the worse bug. Picking
   nothing keeps the TEXT story and the gradient every viewer
   hashes from the story id, identically.

   There is no upload-progress callback on createMultipart, so
   the bar under the top bar is indeterminate. A fabricated
   percentage is worse than an honest barber-pole.

   WORDS ON THE FRAME. The creative stage is the reel editor's,
   shared verbatim (components/media/OverlayTools + the overlay
   editor), because they are the same act and two of them would
   have drifted. What differs is where the words END UP, and
   the wire decides that, not taste:

     · a PHOTO is FLATTENED — media and overlay are captured
       together and the pixels are what gets posted, so what
       the author placed is exactly what every viewer sees;
     · a VIDEO cannot be: there is no compositor on the device
       and no overlay field on the story row (story/stories.md
       has `textContent` and nothing else). So the words placed
       on a clip travel as the CAPTION, which the viewer already
       paints over media — the composer says so in as many
       words rather than quietly dropping them.

   THE CAPTION IS A TRAY, not a floating field. It used to be a
   bare TextInput positioned at a hand-computed `bottom` over a
   full-bleed stage: on Android — edge-to-edge since SDK 57 —
   that put it under the gesture bar, and opening the keyboard
   put it under that too. Every tray here docks through a
   KeyboardAvoidingView and pays its own `insets.bottom`.
   ========================================================= */
import React from 'react'
import {
  Keyboard, Linking, ScrollView, StyleSheet, TextInput, View, useWindowDimensions,
} from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import { checkAssets } from '@/lib/fileMeta'
import * as MediaLibrary from 'expo-media-library/legacy'
import { VideoView, useVideoPlayer, type VideoThumbnail } from 'expo-video'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { captureRef } from 'react-native-view-shot'
import { api, assetUrl, codeOf, detailsOf, errorText, isNetworkError, isTransient } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { storage } from '@/platform/storage'
import { prepareUpload, type PickedAsset } from '@/lib/mediaTier'
import { isBlocked, isNsfwBlocked, isScreeningDown, moderationText } from '@/lib/moderation'
import { toUploadFile } from '@/platform/files'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, setback, shape, space } from '@/theme/tokens'
import {
  ConfirmSheet, Icon, Spinner, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import { CaptionTray, FontChip, GlyphTray, TextTray, Tool } from '@/components/media/OverlayTools'
import { OverlayEditorStage } from '@/components/reels/OverlayEditorStage'
import { useReduceMotion, type OverlayItem } from '@/components/reels/ReelOverlayLayer'
import { COLORS, EMOJI, FONTS, MAX_ITEMS, STICKERS, cleanItem } from '@/lib/reelOverlay'
import { overlayFaceStyle } from '@/components/reels/ReelOverlayLayer'
import { EMPTY_POLL, PollComposerCard, isPollValid, type PollDraft } from '@/components/stories/PollComposerCard'
import { LifetimeSheet, type Lifetime } from '@/components/stories/LifetimePicker'
import { VisibilityPill, VisibilitySheet } from '@/components/stories/VisibilityPicker'
import { ACTION_GRADIENT, BLACK, ink, night, shade } from '@/components/stories/night'
import { invalidateStories } from '@/components/stories/trayStore'
import { autoTextSize, frameGradient } from '@/components/stories/storyVisual'
import type { StoryVisibility } from '@/components/stories/storyVisual'

type Stage = 'empty' | 'media' | 'text'
type Tray = null | 'text' | 'emoji' | 'sticker' | 'caption'

interface Picked { uri: string; kind: 'image' | 'video'; fileName?: string; mimeType?: string }

/** The backgrounds an author can choose for a text frame. Every stop is a 500
 *  step or darker: the words are white and 34pt, and a lighter stop would drop
 *  the pair under 3:1 — the large-text floor — somewhere across the ramp. */
const BACKGROUNDS: readonly (readonly [string, string])[] = [
  [ramp.brand[500], ramp.violet[500]],
  [ramp.violet[600], ramp.brand[700]],
  [ramp.red[500], ramp.scholar[600]],
  [ramp.green[600], ramp.brand[600]],
  [ramp.scholar[700], ramp.red[900]],
  [ramp.slate[700], ramp.slate[1000]],
]

/* ---------------------------------------------------------
   THE DRAFT OUTLIVES THE SCREEN.

   Everything the author adds used to live in this component's
   own useState, and a composer that keeps its work only in
   local state loses ALL of it to anything that remounts the
   screen — a native modal re-presented under the image picker,
   a low-memory activity restart on Android while the camera has
   the foreground, a navigator that re-creates the route when
   its options change. The symptom is the same every time and
   reads as malice: "it removed what I uploaded".

   The reel composer never had this problem because its draft is
   a context persisted to MMKV (components/reels/ReelDraft). The
   story composer now borrows exactly that idea, in one file: it
   writes on every change and reads once on mount, so a remount
   is invisible instead of destructive.

   IT EXPIRES. A picked uri points at a cache file the OS may
   sweep, so a draft older than the window below is dropped
   rather than restored as a black frame nobody can explain.
   --------------------------------------------------------- */
/** The recents grid: three 2:3 cells, hairline-thin gutters — the pictures
 *  are the interface, and a gutter wide enough to notice is a gutter competing
 *  with them. */
const GRID_GAP = 2

const DRAFT_KEY = 'ika:story:draft'
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000

interface StoryDraft {
  at: number
  stage: Stage
  picked: Picked | null
  caption: string
  /** What the author placed ON the frame — normalised, so it survives a
   *  restore onto a different orientation. */
  items?: OverlayItem[]
  body: string
  background: number | null
  /** The TEXT stage's own ink: indexes into the overlay FONTS/COLORS tables.
   *  Absent on drafts from before 2026-08-23 — the default is the old look. */
  bodyStyle?: { f: number; c: number }
  visibility: StoryVisibility
  lifetime: Lifetime
  poll: PollDraft | null
}

function readDraft(): StoryDraft | null {
  try {
    const raw = storage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as StoryDraft
    if (!d || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_MAX_AGE_MS) return null
    return d
  } catch { return null }
}

function clearDraft() {
  try { storage.removeItem(DRAFT_KEY) } catch { /* a full disk must not block posting */ }
}

export default function StoryComposeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const params = useLocalSearchParams<{ linkType?: string; mediaUrl?: string; thumbnailUrl?: string; title?: string }>()

  /* Read ONCE, at mount. A share-sheet arrival (params.linkType) is a fresh
     intent and never inherits a draft. */
  const restored = React.useRef(params.linkType ? null : readDraft()).current

  const [stage, setStage] = React.useState<Stage>(
    params.linkType ? 'media' : restored?.stage ?? 'empty',
  )
  const [picked, setPicked] = React.useState<Picked | null>(restored?.picked ?? null)
  const [caption, setCaption] = React.useState(restored?.caption ?? '')
  /* The creative stage's state, in the reel editor's own shape. */
  const [items, setItems] = React.useState<OverlayItem[]>(restored?.items ?? [])
  const [selected, setSelected] = React.useState<number | null>(null)
  const [editing, setEditing] = React.useState<number | null>(null)
  const [tray, setTray] = React.useState<Tray>(null)
  /** The default is the VIEWER'S truth: StoryFrame paints contain-fit, so the
   *  composer previews contain-fit. Choosing Fill on an image is real — it
   *  forces the flatten path so the cropped frame is the posted pixels. A
   *  video gets no choice at all: nothing here can re-crop the file, and a
   *  fit the viewer won't honour would be a preview that lies. */
  const [mediaFit, setMediaFit] = React.useState<'cover' | 'contain'>('contain')
  const reduceMotion = useReduceMotion()
  const [body, setBody] = React.useState(restored?.body ?? '')
  /** null = the deterministic hashed gradient every viewer derives alike. */
  const [background, setBackground] = React.useState<number | null>(restored?.background ?? null)
  /** Face + ink for the TEXT stage, in the overlay tables' own indexes.
   *  Anything beyond the default forces the flatten path at publish — a plain
   *  TEXT row has nowhere to carry a style. */
  const [bodyStyle, setBodyStyle] = React.useState<{ f: number; c: number }>(restored?.bodyStyle ?? { f: 0, c: 0 })
  const [visibility, setVisibility] = React.useState<StoryVisibility>(restored?.visibility ?? 'PUBLIC')
  const [lifetime, setLifetime] = React.useState<Lifetime>(restored?.lifetime ?? 24)
  const [poll, setPoll] = React.useState<PollDraft | null>(restored?.poll ?? null)

  const [busy, setBusy] = React.useState(false)
  /* `prepareUpload` can re-encode a large still — seconds on an older phone —
     and the composer used to sit frozen on the empty stage the whole time. */
  const [adopting, setAdopting] = React.useState(false)
  /* While a sticker is mid-drag the bottom chrome stands down: it sits exactly
     over the trash band, so the can was invisible under it. */
  const [stageDragging, setStageDragging] = React.useState(false)
  const [pollConfirm, setPollConfirm] = React.useState(false)
  const [failure, setFailure] = React.useState<any>(null)
  const [blockedCopy, setBlockedCopy] = React.useState<string | null>(null)
  /* useCooldown is JS; the tuple needs naming for TS to keep the two apart. */
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [audienceOpen, setAudienceOpen] = React.useState(false)
  const [lifetimeOpen, setLifetimeOpen] = React.useState(false)
  const [discard, setDiscard] = React.useState(false)
  const [circleCount, setCircleCount] = React.useState<number | null>(null)

  /** The composed text frame, as view-shot reads it. */
  const frameRef = React.useRef<View>(null)

  /* ONE player for the picked clip, owned by the screen rather than by the
     stage: publish() has to reach it to cut a poster frame, and a second
     player inside the stage would decode the same file twice. */
  const videoPlayer = useVideoPlayer(
    picked?.kind === 'video' ? { uri: picked.uri } : null,
    p => { p.loop = true; p.muted = false; p.play() },
  )

  const linked = params.linkType ? String(params.linkType).toUpperCase() : null
  /* Route params are strings, so an absent one arrives as '' — which must
     become `undefined` on the wire rather than an empty mediaUrl. The values
     are the backend's own RELATIVE paths (see sharedAssetPath) so that every
     viewer resolves them against their own host; only the preview below
     absolutises, and only for this screen. */
  const linkedMediaUrl = params.mediaUrl || undefined
  const linkedThumbUrl = params.thumbnailUrl || undefined
  const dirty = !!picked || !!body.trim() || !!caption.trim() || !!poll || items.length > 0

  const hasContent = !!picked || !!body.trim() || !!linked
  const canShare = hasContent && !busy && cooldown === 0 && (!poll || isPollValid(poll))

  /* ---- picking ------------------------------------------------------- */

  /* The single door every pick comes through — camera, library and the roll —
     so the media tier is honoured once instead of three times or, as it was,
     never. `prepareUpload` downscales an image to the user's chosen long edge
     BEFORE it becomes the stage's frame, which also means the preview is the
     picture that will actually be posted. It returns the asset untouched for
     video (there is no transcoder here) and for anything already inside the
     cap, and it fails open, so this is safe on every path. */
  const adopt = React.useCallback(async (asset: PickedAsset, kind: 'image' | 'video') => {
    setAdopting(true)
    try {
      /* `type` is the fallback signal compressToTier reads when the picker gave
         no mime — the roll never does, and without it an mp4 would be handed to
         the image manipulator. */
      const ready = await prepareUpload({ ...asset, type: kind })
      setPicked({
        uri: ready.uri,
        kind,
        fileName: ready.fileName ?? ready.name ?? undefined,
        mimeType: ready.mimeType ?? undefined,
      })
      setStage('media')
    } finally {
      setAdopting(false)
    }
  }, [])

  const pickFromLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      videoMaxDuration: 60,
    })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    if (!passesCheck(asset)) return
    await adopt(asset as unknown as PickedAsset, asset.type === 'video' ? 'video' : 'image')
  }

  const shoot = async () => {
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      videoMaxDuration: 60,
    })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    if (!passesCheck(asset)) return
    await adopt(asset as unknown as PickedAsset, asset.type === 'video' ? 'video' : 'image')
  }

  /* Fail fast (size caps) before the editor adopts the pick — the server
     re-checks authoritatively. */
  const passesCheck = (asset: any) => {
    const { rejected } = checkAssets([asset], 'story')
    if (!rejected.length) return true
    rejected.forEach(v => toast.warn(`${v.asset.fileName || 'File'}: ${v.reason}`))
    return false
  }

  /* ---- what goes ON the frame ---------------------------------------- */

  /** Returns whether it actually added — the text tool opens its tray on the
   *  LAST item, so a refused add would hand the tray somebody else's words. */
  const addItem = React.useCallback((partial: Partial<OverlayItem>): boolean => {
    if (items.length >= MAX_ITEMS) { toast.warn(`You can add up to ${MAX_ITEMS} things`); return false }
    /* Same two rules as the reel stage (reels/compose/edit.tsx): a TEXT item
       is born BLANK — the tray's placeholder does the talking and closeTray
       drops it untyped, instead of a literal "Text" landing on the frame —
       and each birth steps down the stage so two adds never stack into one
       unreadable pile. cleanItem rightly refuses blank text on the wire, so
       the blank draft bypasses it; glyph picks always carry their glyph. */
    const seed = {
      k: 't' as const, text: '', x: 0.5, y: 0.3 + (items.length % 5) * 0.09,
      r: 0, s: 0.11, f: 0, c: 0, a: 1, m: 0, bg: 0,
      ...partial,
    }
    const next = seed.text.trim()
      ? (cleanItem(seed) as OverlayItem | null)
      : (seed as OverlayItem)
    if (!next) return false
    setItems(prev => [...prev, next])
    setSelected(items.length)
    fireHaptic('light')
    return true
  }, [items.length])

  const updateItem = React.useCallback((index: number, next: Partial<OverlayItem>) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it
      const merged = { ...it, ...next }
      /* A BLANK FIELD IS A LEGAL DRAFT STATE — cleanItem refuses it, and
         falling back to the old item makes the tray impossible to clear. The
         blank lives until the tray closes, which is where it is dropped. */
      if (typeof merged.text === 'string' && !merged.text.trim()) return merged as OverlayItem
      return (cleanItem(merged) as OverlayItem) ?? it
    }))
  }, [])

  /* Identity-stable: this lands in every sticker's gesture memo, and an
     inline arrow would re-register the whole gesture config with the native
     module on any screen re-render — including the one drag-start causes. */
  const openTextTray = React.useCallback((i: number) => { setEditing(i); setTray('text') }, [])

  /* Leaving a tray on a blank item throws it away rather than leaving an
     invisible one on the stage counting against the cap. */
  const closeTray = React.useCallback(() => {
    setTray(null)
    setEditing(null)
    setItems(prev => {
      const kept = prev.filter(it => String(it.text ?? '').trim().length > 0)
      if (kept.length !== prev.length) setSelected(null)
      return kept.length === prev.length ? prev : kept
    })
  }, [])

  /** The words an author placed on the frame, in the order they placed them.
   *  A video cannot carry them as pixels, so they become the caption. */
  const placedWords = React.useMemo(
    () => items.filter(i => i.k === 't').map(i => String(i.text || '').trim()).filter(Boolean).join('\n'),
    [items],
  )

  /* A poll with typed content is WORK, and both poll toggles used to throw it
     away on a stray tap. Empty drafts still clear silently — there is nothing
     to lose. */
  const togglePoll = React.useCallback(() => {
    setPoll(p => {
      if (!p) return { ...EMPTY_POLL }
      const dirty = p.question.trim() || p.optionA !== EMPTY_POLL.optionA || p.optionB !== EMPTY_POLL.optionB
      if (dirty) { setPollConfirm(true); return p }
      return null
    })
  }, [])

  /* ---- close friends count for the audience sheet -------------------- */
  React.useEffect(() => {
    if (!audienceOpen || circleCount != null) return
    api.closeCircle.list()
      .then((rows: any[]) => setCircleCount((rows || []).length))
      /* A count we could not read stays null; the row says "Manage your list"
         rather than inventing a zero. */
      .catch(() => setCircleCount(null))
  }, [audienceOpen, circleCount])

  /* ---- publish -------------------------------------------------------- */

  /* The keyboard is up while you type and KeyboardAvoidingView shortens the
     stage to clear it, so capturing at that moment would post a letterboxed
     frame with a caret in it. Dismiss, let the OS finish its animation, then
     read the view. */
  const flattenFrame = async (format: 'png' | 'jpg' = 'png'): Promise<string> => {
    Keyboard.dismiss()
    /* AND DESELECT. The editable stage draws a handle frame around whatever is
       selected and a trash well under it — capture with a selection live and
       both are baked into the story. */
    setSelected(null)
    setTray(null)
    await new Promise(resolve => setTimeout(resolve, 280))
    let shot: string
    try {
      shot = await captureRef(frameRef, { format, quality: format === 'jpg' ? 0.92 : 1, result: 'tmpfile', fileName: 'ika-story' })
    } catch {
      /* A capture failure is the device's answer, not the server's, so it
         carries copy the author can act on instead of a native stack trace. */
      throw new Error('That background couldn’t be turned into a frame. Try another, or share without one.')
    }
    /* Android answers with a file:// URL, iOS with a bare path. The uploader
       needs the scheme either way. */
    return shot.startsWith('file://') ? shot : `file://${shot}`
  }

  /* The multipart create takes an optional `thumbnail` part, and without it a
     video story has no still: the tray ring, the grid cell and the manager all
     fall back to handing an .mp4 to an image view, which decodes to nothing.
     Mid-clip rather than frame 0 — the first frame of a phone recording is
     very often black.

     FAILS OPEN, deliberately: the part is optional server-side, so a device
     that cannot cut a frame still posts the story. This is a local failure
     with no server message, so there is nothing to surface. */
  const posterFrame = async (): Promise<string | null> => {
    try {
      const dur = videoPlayer.duration || 0
      const at = dur ? Math.min(0.5, dur / 2) : 0
      const [thumb] = await videoPlayer.generateThumbnailsAsync([at], { maxWidth: 720 }) as VideoThumbnail[]
      if (!thumb) return null
      /* A VideoThumbnail is a native image ref with no file behind it, so it
         cannot go into FormData directly — render it to a real jpeg first. */
      const ref = await ImageManipulator.manipulate(thumb).renderAsync()
      const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })
      return saved.uri || null
    } catch {
      return null
    }
  }

  const publish = async () => {
    if (!canShare) return
    setBusy(true)
    setFailure(null)
    setBlockedCopy(null)
    try {
      let created: any
      if (picked) {
        const fd = new FormData()
        fd.append('storyType', picked.kind === 'video' ? 'VIDEO' : 'IMAGE')
        fd.append('visibility', visibility)
        fd.append('lifetimeHours', String(lifetime))
        /* A PHOTO KEEPS ITS WORDS AS PIXELS. There is no overlay field on the
           story row, so the only way to keep what the author placed is to stop
           being data and become the picture: capture the stage — media, text,
           stickers, at the exact positions on screen — and post that instead
           of the original file. JPEG, not PNG: a flattened photograph at
           screen resolution is a photograph, and PNG would triple the upload
           for nothing. */
        /* Flatten when the pixels on screen are not the pixels in the file:
           overlay items, or a Fill crop the viewer would otherwise undo. */
        const flat = picked.kind === 'image' && (items.length || mediaFit === 'cover') ? await flattenFrame('jpg') : null
        /* A CLIP CANNOT. No compositor on the device, no overlay field on the
           wire — so the words ride as the caption, which the viewer already
           paints over media. The composer warned about this when they were
           placed; dropping them here silently would be the worse answer. */
        const words = picked.kind === 'video' ? placedWords : ''
        const text = [caption.trim(), words].filter(Boolean).join('\n')
        if (text) fd.append('textContent', text)
        fd.append('media', toUploadFile(
          flat ? { uri: flat, fileName: 'story.jpg', mimeType: 'image/jpeg' } : picked,
        ) as any)
        if (picked.kind === 'video') {
          const poster = await posterFrame()
          /* The part name is the contract — `thumbnail`, exactly. */
          if (poster) fd.append('thumbnail', toUploadFile({ uri: poster, fileName: 'story-thumb.jpg', mimeType: 'image/jpeg' }) as any)
        }
        created = await api.stories.createMultipart(fd)
      } else if (linked) {
        created = await api.stories.create({
          storyType: linked,
          visibility,
          mediaUrl: linkedMediaUrl,
          thumbnailUrl: linkedThumbUrl,
          textContent: caption.trim() || params.title || undefined,
          lifetimeHours: lifetime,
        })
      } else if (background != null || bodyStyle.f !== 0 || bodyStyle.c !== 0) {
        /* An author-chosen background — or a styled face/ink, which the TEXT
           row equally cannot carry — exists nowhere in the create contract,
           so the only way to keep it is to stop being a style and start being
           an image: flatten what is on screen and post the pixels. The
           gradient captured is exactly the one on the stage (the hashed
           fallback when no background was picked). */
        const fd = new FormData()
        fd.append('storyType', 'IMAGE')
        fd.append('visibility', visibility)
        fd.append('lifetimeHours', String(lifetime))
        /* Carried for search, moderation and the grid's placeholder while the
           upload is still PROCESSING. The viewer paints media captions now, so
           this frame shows its words baked AND in the bar — see the header
           note for why that trade was taken. */
        fd.append('textContent', body.trim())
        fd.append('media', toUploadFile({ uri: await flattenFrame(), fileName: 'story.png', mimeType: 'image/png' }) as any)
        created = await api.stories.createMultipart(fd)
      } else {
        /* mediaUrl stays absent: a TEXT frame with media renders as media. */
        created = await api.stories.create({
          storyType: 'TEXT',
          visibility,
          textContent: body.trim(),
          lifetimeHours: lifetime,
        })
      }

      if (poll && isPollValid(poll)) {
        try {
          await api.stories.attachPoll(created.storyId, {
            question: poll.question.trim(),
            optionA: poll.optionA.trim(),
            optionB: poll.optionB.trim(),
          })
        } catch (e: any) {
          /* The story IS live. There is no reason to delete a good story over a
             rejected poll, so this reports and moves on. A poll is compose-time
             only — there is no post-publish editor to send the author to. */
          toast.warn(isBlocked(e) ? moderationText(e) : 'Your story was shared, but the poll couldn’t be added.')
        }
      }

      invalidateStories()
      fireHaptic('success')
      /* A hold is a 200, not an error: navigate away and let the manager carry
         the badge. */
      /* Posted: the draft is spent, and a restored copy would offer to post it
         a second time. */
      clearDraft()
      router.replace('/story/mine' as any)
      toast.ok('Shared to your story')
    } catch (e: any) {
      fireHaptic('error')
      /* The image gate's block is terminal like a text block: same verbatim
         notice, no Retry (the same bytes score the same), and the author
         stays on the edit stage with everything placed. A flattened frame
         re-flattens identically, so re-encoding cannot dodge it either. */
      if (isBlocked(e) || isNsfwBlocked(e)) setBlockedCopy(moderationText(e))
      else { setFailure(e); startCooldown(e) }
    } finally {
      setBusy(false)
    }
  }

  const close = () => { if (dirty) setDiscard(true); else router.back() }

  /* Hardware back runs the same guard as the close X. */
  useDiscardGuard(dirty, close)

  /* THE WRITE HALF of the draft (see the note above the component). Cheap:
     MMKV is synchronous and this is a handful of strings — but it is skipped
     entirely while there is nothing worth keeping, so an author who opens the
     composer and closes it leaves nothing behind. */
  React.useEffect(() => {
    /* A share-sheet session is EPHEMERAL both ways: it never restores a draft
       (see `restored`), so it never writes one — its link lives only in route
       params and a restore without them is a black dead-end stage. It must
       not clear the store either: a plain session's draft may be waiting. */
    if (linked) return
    if (!dirty) { clearDraft(); return }
    try {
      storage.setItem(DRAFT_KEY, JSON.stringify({
        at: Date.now(), stage, picked, caption, items, body, background, bodyStyle, visibility, lifetime, poll,
      } satisfies StoryDraft))
    } catch { /* a full disk must not block composing */ }
  }, [linked, dirty, stage, picked, caption, items, body, background, bodyStyle, visibility, lifetime, poll])

  /* ---- render --------------------------------------------------------- */

  const stageW = width
  const gradient = background == null ? frameGradient(body || 'story-draft') : BACKGROUNDS[background]
  /* The bar owns the bottom inset, so everything floating above it is offset
     by the bar rather than by a guess. */
  const barH = 76 + insets.bottom
  /* The background row takes the band directly above the bar on the text
     stage; everything else floating there stacks on top of it. */
  /* Two rails on the text stage now: backgrounds, and the face/ink rail above
     them — notices and the counter stack above both. */
  const band = stage === 'text' ? 108 : 0

  return (
    <View style={[styles.fill, { backgroundColor: BLACK }]}>
      <Stack.Screen options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <StatusBar style="light" />

      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {/* STAGE — each one FADES in rather than teleporting; reduced motion
            keeps the cut these swaps always had. */}
        {stage === 'empty' ? (
          /* key: all three branches are the same component type in the same
             slot, so without it React UPDATES across a stage switch and the
             entering animation never replays. */
          <Animated.View key="empty" style={styles.fill} entering={reduceMotion ? undefined : FadeIn.duration(180)}>
            <EmptyStage
              topInset={insets.top}
              bottomInset={insets.bottom}
              onCamera={shoot}
              onLibrary={pickFromLibrary}
              onText={() => setStage('text')}
              onPick={(a, kind) => { void adopt(a, kind) }}
            />
          </Animated.View>
        ) : stage === 'text' ? (
          <Animated.View key="text" style={styles.fill} entering={reduceMotion ? undefined : FadeIn.duration(180)}>
            {/* Everything inside this view is what gets flattened, so the
                counter and the chrome stay outside it. collapsable={false}
                keeps it a real native view for view-shot on Android. */}
            <View ref={frameRef} collapsable={false} style={styles.fill}>
              <LinearGradient colors={[gradient[0], gradient[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
                <View style={[styles.fill, styles.center]}>
                  <TextInput
                    value={body}
                    onChangeText={setBody}
                    placeholder="Type something"
                    placeholderTextColor={ink.soft}
                    multiline
                    autoFocus
                    maxLength={600}
                    selectionColor={ink.full}
                    textAlign="center"
                    style={[
                      styles.textStage,
                      /* The shared overlay face resolver — the same six
                         families the media stage's text tray offers, so "the
                         fonts of the story" are one table, not two. */
                      overlayFaceStyle({ f: bodyStyle.f, text: body }),
                      {
                        color: COLORS[bodyStyle.c] ?? ink.full,
                        fontSize: autoTextSize(body),
                        lineHeight: autoTextSize(body) * 1.25,
                      },
                    ]}
                  />
                </View>
              </LinearGradient>
            </View>
            {body.length > 500 ? (
              <Text variant="footnote" color={ink.faint} align="center" style={[styles.counter, { bottom: barH + band + 76 }]}>
                {600 - body.length}
              </Text>
            ) : null}
          </Animated.View>
        ) : (
          /* THE CAPTURE TARGET. Everything inside this view is what a flatten
             posts — which is why the tool rail, the trays and the poll draft
             all sit outside it and the overlay editor sits in. */
          <Animated.View key="media" style={styles.fill} entering={reduceMotion ? undefined : FadeIn.duration(180)}>
          <View ref={frameRef} collapsable={false} style={styles.fill}>
            {/* assetUrl only here: the preview needs a loadable url, the wire
                needs the portable path. */}
            <MediaStage
              picked={picked}
              player={videoPlayer}
              thumbnail={assetUrl(linkedThumbUrl || linkedMediaUrl)}
              linked={!!linked}
              title={params.title}
              fit={mediaFit}
            />

            {/* Tapping bare stage deselects — the only way out of a selection
                that does not require hitting a 28pt handle. */}
            <Touchable
              onPress={() => setSelected(null)}
              feedback="none"
              noAutoHitSlop
              accessibilityLabel="Deselect"
              style={StyleSheet.absoluteFill}
            >
              <View />
            </Touchable>

            <OverlayEditorStage
              items={items}
              setItems={setItems}
              /* THE STAGE IS THE MEDIA RECT. A story is captured whole, so
                 every position is normalised against the screen itself —
                 which is exactly the rectangle view-shot reads back. */
              fit="cover"
              mediaW={width}
              mediaH={height}
              box={{ width, height }}
              selected={selected}
              onSelect={setSelected}
              onEditText={openTextTray}
              /* The bottom chrome fades out for the drag (below), so the can
                 only needs to clear the gesture bar, not the whole bar. */
              onDraggingChange={setStageDragging}
              trashInset={insets.bottom}
            />
          </View>
          </Animated.View>
        )}

        {/* TOP BAR */}
        <View style={[styles.topBar, { top: insets.top + 4 }]} pointerEvents="box-none">
          <Touchable onPress={close} feedback="scale" accessibilityLabel="Close" style={styles.iconBtn}>
            <Icon name="close" size={22} color={ink.full} />
          </Touchable>
          <View style={{ flex: 1 }} />
          {/* The creative tools live in the rail; the bar keeps only what is
              true of the whole story — how long it lives — and the way out. */}
          {stage !== 'empty' ? (
            <Touchable onPress={() => setLifetimeOpen(true)} feedback="scale" accessibilityLabel="Lifetime" style={styles.iconBtn}>
              <Icon name="clock" size={19} color={ink.full} />
              <Text variant="micro" color={ink.full}>{lifetime}h</Text>
            </Touchable>
          ) : null}
          {stage === 'text' ? (
            <Touchable
              onPress={togglePoll}
              feedback="scale"
              accessibilityLabel="Poll"
              style={styles.iconBtn}
            >
              <Icon name="poll" size={21} color={poll ? night.accent : ink.full} />
            </Touchable>
          ) : null}
        </View>

        {busy ? <IndeterminateBar top={insets.top + 56} /> : null}

        {/* POLL DRAFT */}
        {poll && stage !== 'empty' ? (
          <DraggablePoll height={height} width={stageW}>
            {/* The card's own ✕ runs the same guard as the toggles — typed
                questions are work, not something a stray tap throws away. */}
            <PollComposerCard value={poll} onChange={setPoll} onRemove={togglePoll} />
          </DraggablePoll>
        ) : null}

        {/* THE TOOL RAIL. Labelled discs, because six unlabelled ones over
            somebody's photograph is a puzzle — the reel editor's own rail,
            the same component, so an author learns it once. */}
        {stage === 'media' && !tray && !stageDragging ? (
          <View style={[styles.tools, { top: insets.top + 54 }]} pointerEvents="box-none">
            {/* A LINKED story is created as JSON — it has no pixels of its own
                to bake anything into, so it is offered nothing it cannot
                keep. */}
            {picked ? (
              <>
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
              </>
            ) : null}
            <Tool icon="quote" label="Caption" active={!!caption.trim()} onPress={() => setTray('caption')} />
            <Tool icon="poll" label="Poll" active={!!poll} onPress={togglePoll} />
            {picked?.kind === 'image' ? (
              /* The label names what the TAP does — the stage itself already
                 shows the current fit; a state-named toggle reads backwards.
                 Images only: a Fill on an image is kept by the flatten path,
                 while a video would revert to the viewer's contain — a
                 control that changes nothing is worse than none. */
              <Tool
                icon="crop"
                label={mediaFit === 'cover' ? 'Fit' : 'Fill'}
                onPress={() => setMediaFit(f => (f === 'cover' ? 'contain' : 'cover'))}
              />
            ) : null}
          </View>
        ) : null}

        {/* WHAT A CLIP CAN KEEP. Said on the stage, while the author can still
            act on it — not swallowed at publish. */}
        {stage === 'media' && picked?.kind === 'video' && placedWords && !stageDragging ? (
          <View style={[styles.stageNote, { bottom: barH + (caption.trim() ? 62 : 12) }]} pointerEvents="none">
            <Icon name="info" size={13} color={ink.full} />
            <Text variant="caption" color={ink.full} align="ui" style={{ flex: 1 }}>
              Words on a clip are posted as its caption
            </Text>
          </View>
        ) : null}

        {/* THE CAPTION, read-only until tapped. The editor is a docked tray
            (OverlayTools) — a bare field floating at a computed `bottom` is
            what put this under the gesture bar and then under the keyboard. */}
        {stage === 'media' && caption.trim() && !tray && !stageDragging ? (
          <Touchable
            onPress={() => setTray('caption')}
            feedback="dim"
            noAutoHitSlop
            accessibilityLabel="Edit caption"
            style={[styles.captionPeek, { bottom: barH + 12, backgroundColor: shade.heavy }]}
          >
            <Text variant="footnote" color={ink.full} numberOfLines={2} align="auto">{caption.trim()}</Text>
          </Touchable>
        ) : null}

        {/* TEXT STYLE — faces first, inks after, one thumb-height rail. */}
        {stage === 'text' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.bgRow, { bottom: barH + 12 + 50 }]}
            contentContainerStyle={styles.bgRowContent}
            keyboardShouldPersistTaps="always"
          >
            {FONTS.map((_f, i) => (
              <FontChip key={`f${i}`} slot={i} selected={bodyStyle.f === i} onPress={() => setBodyStyle(s => ({ ...s, f: i }))} />
            ))}
            <View style={styles.styleDivider} />
            {COLORS.map((c, i) => (
              <Touchable
                key={c}
                onPress={() => setBodyStyle(s => ({ ...s, c: i }))}
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel={`Ink ${i + 1}`}
                accessibilityState={{ selected: bodyStyle.c === i }}
                style={[
                  styles.inkSwatch,
                  {
                    backgroundColor: c,
                    borderColor: bodyStyle.c === i ? ink.full : ink.hairline,
                    borderWidth: bodyStyle.c === i ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}
              />
            ))}
          </ScrollView>
        ) : null}

        {/* BACKGROUND */}
        {stage === 'text' ? (
          <BackgroundRow
            bottom={barH + 12}
            fallback={frameGradient(body || 'story-draft')}
            value={background}
            onChange={setBackground}
          />
        ) : null}

        {/* FAILURES — every one of these keeps the draft. */}
        {blockedCopy ? (
          <View style={[styles.notice, { bottom: barH + band + 12, backgroundColor: night.dangerSoft, borderColor: night.danger }]}>
            <Text variant="subhead" color={night.dangerText} align="ui">{blockedCopy}</Text>
          </View>
        ) : failure ? (
          <View style={[styles.notice, { bottom: barH + band + 12, backgroundColor: night.dangerSoft, borderColor: night.danger }]}>
            <Text variant="subhead" color={night.dangerText} align="ui" style={{ flex: 1 }}>
              {codeOf(failure) === 'FILE_TOO_LARGE' && detailsOf(failure)?.maxSize
                ? `${errorText(failure)} (max ${Math.round(Number(detailsOf(failure)!.maxSize) / 1048576)} MB)`
                /* Screening-down is a 503 but carries its own complete
                   sentence — the generic storage line would misname it. */
                : isTransient(failure) && !isScreeningDown(failure)
                  ? 'Couldn’t reach storage. Try again.'
                  : errorText(failure)}
            </Text>
            {!isNetworkError(failure) && cooldown === 0 ? (
              <Touchable onPress={publish} feedback="dim" style={{ paddingHorizontal: space.sm }}>
                <Text variant="subhead" color={night.accentText}>Retry</Text>
              </Touchable>
            ) : null}
          </View>
        ) : null}

        {/* BOTTOM BAR — it stands down while a sticker is mid-drag: it sits
            exactly over the trash band, and a can nobody can see is a delete
            nobody can find. */}
        {stage !== 'empty' && !stageDragging ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(140)}
            exiting={reduceMotion ? undefined : FadeOut.duration(100)}
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 14, backgroundColor: shade.heavy, borderTopColor: ink.hairline }]}>
            <VisibilityPill value={visibility} onPress={() => setAudienceOpen(true)} />
            <View style={{ flex: 1 }} />
            <Touchable
              onPress={publish}
              disabled={!canShare}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel="Share to your story"
              style={{ opacity: canShare ? 1 : 0.45 }}
            >
              <LinearGradient
                colors={ACTION_GRADIENT as unknown as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.share}
              >
                <Text variant="headline" weight="700" color={ink.full}>
                  {cooldown > 0 ? `Wait ${cooldown}s` : 'Share'}
                </Text>
                {/* On the action gradient, where `accent` is invisible — the
                    arc rides the plate's ink (State.tsx documents this). */}
                {busy
                  ? <Spinner size="small" color={ink.full} style={styles.shareSpinner} />
                  : <Icon name="up" size={18} color={ink.full} />}
              </LinearGradient>
            </Touchable>
          </Animated.View>
        ) : null}

        {/* ADOPTING — the tier re-encode between picker and stage. A scrim
            with a spinner, or a large photo reads as a hang. */}
        {adopting ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: shade.heavy }]}>
            <Spinner size="large" color={ink.full} />
            <Text variant="footnote" color={ink.muted} align="center" style={{ marginTop: space.md }}>
              Preparing your media…
            </Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* THE TRAYS. Outside the stage (nothing here is ever flattened) and
          outside the screen's KeyboardAvoidingView — each one docks itself and
          pays the bottom inset, which is the whole point of them. */}
      {tray === 'text' ? (
        <TextTray
          item={items[editing ?? items.length - 1]}
          onChange={next => updateItem(editing ?? items.length - 1, next)}
          onClose={closeTray}
          reduceMotion={reduceMotion}
          /* A story is flattened into pixels, so there is no motion to keep —
             offering a wiggle here would be a promise the composer breaks. */
          showMotion={false}
        />
      ) : tray === 'emoji' ? (
        <GlyphTray
          title="Emoji"
          columns={6}
          entries={EMOJI.map((g: string) => ({ glyph: g, label: g, motion: 0 }))}
          onPick={e => { addItem({ k: 'e', text: e.glyph, s: 0.16, m: 0 }); setTray(null) }}
          onClose={() => setTray(null)}
        />
      ) : tray === 'sticker' ? (
        <GlyphTray
          title="Stickers"
          columns={4}
          entries={STICKERS.map((x: any) => ({ glyph: x.g, label: x.label, motion: x.m }))}
          onPick={e => { addItem({ k: 's', text: e.glyph, s: 0.2, m: 0 }); setTray(null) }}
          onClose={() => setTray(null)}
        />
      ) : tray === 'caption' ? (
        <CaptionTray value={caption} onChange={setCaption} onClose={() => setTray(null)} />
      ) : null}

      <VisibilitySheet
        visible={audienceOpen}
        onClose={() => setAudienceOpen(false)}
        value={visibility}
        onChange={setVisibility}
        closeFriendCount={circleCount}
      />
      <LifetimeSheet visible={lifetimeOpen} onClose={() => setLifetimeOpen(false)} value={lifetime} onChange={setLifetime} />
      <ConfirmSheet
        visible={discard}
        onClose={() => setDiscard(false)}
        title="Discard story?"
        message="What you've put together here won't be saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { clearDraft(); setDiscard(false); router.back() }}
      />
      <ConfirmSheet
        visible={pollConfirm}
        onClose={() => setPollConfirm(false)}
        title="Remove the poll?"
        message="The question and options you typed are thrown away."
        confirmLabel="Remove"
        cancelLabel="Keep poll"
        destructive
        onConfirm={() => { setPoll(null); setPollConfirm(false) }}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   The empty stage: three ways in, plus the roll.
   --------------------------------------------------------- */

function EmptyStage({
  topInset, bottomInset, onCamera, onLibrary, onText, onPick,
}: {
  topInset: number
  bottomInset: number
  onCamera: () => void
  onLibrary: () => void
  onText: () => void
  /* The RAW asset, not a Picked: the owner runs it through the media tier, and
     compressToTier needs the dimensions to know it must not upscale. */
  onPick: (a: PickedAsset, kind: 'image' | 'video') => void
}) {
  const [libPerm, requestLib] = MediaLibrary.usePermissions()
  const [recent, setRecent] = React.useState<MediaLibrary.Asset[]>([])
  /* `recent` starts [], and "[] because still reading" must not render the
     "nothing in your library" note — that is a lie for the first second. */
  const [recentLoading, setRecentLoading] = React.useState(true)
  const { width } = useWindowDimensions()

  /* Three columns of 2:3 cells — the story's own aspect, so what the author
     taps is shaped like what they are about to make. */
  const cell = Math.floor((width - GRID_GAP * 2) / 3)
  const cellH = Math.round(cell * 1.34)
  /* The dock is 96 of controls over the bottom inset; the grid scrolls under
     it rather than stopping short of it. */
  const dockH = 96 + bottomInset

  React.useEffect(() => {
    if (!libPerm?.granted) return
    MediaLibrary.getAssetsAsync({ first: 60, sortBy: ['creationTime'], mediaType: ['photo', 'video'] } as any)
      .then(res => setRecent(res.assets))
      .catch(() => setRecent([]))
      .finally(() => setRecentLoading(false))
  }, [libPerm?.granted])

  const choose = async (asset: MediaLibrary.Asset) => {
    const kind = asset.mediaType === 'video' ? 'video' : 'image'
    const base = { fileName: asset.filename, width: asset.width, height: asset.height }
    try {
      /* iOS hands back a ph:// identifier the uploader cannot read; the asset
         info carries the real file. */
      const info = await MediaLibrary.getAssetInfoAsync(asset)
      onPick({ ...base, uri: info.localUri || asset.uri }, kind)
    } catch {
      onPick({ ...base, uri: asset.uri }, kind)
    }
  }

  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 58, paddingBottom: dockH + 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="title3" color={ink.full} align="ui" style={styles.emptyTitle}>Add to your story</Text>

        {libPerm?.granted ? (
          <>
            <Text variant="caption" color={ink.muted} align="ui" style={styles.emptyLabel}>Recents</Text>
            {recentLoading ? (
              /* NOT the ui Skeleton: it wears the app scheme, and in light
                 mode that is near-white — six glaring blocks on this pinned
                 BLACK stage. A whisper of ink is the night skin's own idiom. */
              <View style={styles.grid}>
                {Array.from({ length: 6 }, (_, i) => (
                  <View key={i} style={[styles.gridCell, { width: cell, height: cellH, backgroundColor: ink.hairline }]} />
                ))}
              </View>
            ) : null}
            <View style={styles.grid}>
              {recent.map(a => (
                <Touchable
                  key={a.id}
                  onPress={() => choose(a)}
                  feedback="scale"
                  noAutoHitSlop
                  accessibilityLabel={a.mediaType === 'video' ? 'Use this video' : 'Use this photo'}
                  style={[styles.gridCell, { width: cell, height: cellH }]}
                >
                  <Image
                    source={{ uri: a.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={a.id}
                  />
                  {a.mediaType === 'video' ? (
                    <View style={[styles.rollChip, { backgroundColor: shade.chip }]}>
                      <Icon name="play" size={9} color={ink.full} />
                      <Text variant="micro" color={ink.full}>{formatClock(a.duration)}</Text>
                    </View>
                  ) : null}
                </Touchable>
              ))}
            </View>
            {!recentLoading && !recent.length ? (
              <Text variant="footnote" color={ink.muted} align="center" style={styles.emptyNote}>
                Nothing in your library yet — use the camera below.
              </Text>
            ) : null}
          </>
        ) : (
          /* The roll is the fastest way in and it is the one thing that needs
             asking for, so the ask is a plate rather than a line of small
             print at the bottom of a list. */
          <View style={styles.permCard}>
            <Icon name="gallery" size={26} color={ink.muted} />
            <Text variant="headline" color={ink.full} align="center" style={{ marginTop: space.sm2 }}>
              See your recent photos here
            </Text>
            <Text variant="footnote" color={ink.muted} align="center" style={{ marginTop: space.xs2 }}>
              Allow photo access and your latest shots are one tap away. You can
              still use the camera or write a text story without it.
            </Text>
            <Touchable
              onPress={() => { void requestLib().then(r => { if (!r.granted && !r.canAskAgain) void Linking.openSettings() }) }}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel="Allow photo access"
              style={[styles.permBtn, { backgroundColor: shade.heavy }]}
            >
              <Text variant="subhead" weight="700" color={ink.full}>Allow access</Text>
            </Touchable>
          </View>
        )}
      </ScrollView>

      {/* THE DOCK. Three ways in, always reachable, always above the gesture
          bar — `bottomInset` is paid here and nowhere else (DESIGN.md §8). */}
      <View style={[styles.dock, { paddingBottom: bottomInset + 14, backgroundColor: shade.heavy }]}>
        <Tool icon="camera" label="Camera" onPress={onCamera} />
        <Tool icon="gallery" label="Library" onPress={onLibrary} />
        <Tool icon="edit" label="Text" onPress={onText} />
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   The picked stage — the same treatment the viewer gives a
   frame, so what you compose is what people see: contain-fit,
   letterboxed on BLACK. StoryFrame lost its blurred backdrop
   copy in the QELAT sweep (DESIGN.md §8.7) and this stage
   follows it, or the composer would promise a frame the viewer
   never paints.
   --------------------------------------------------------- */

function MediaStage({
  picked, player, thumbnail, linked, title, fit = 'contain',
}: {
  picked: Picked | null
  player: any
  thumbnail?: string | null
  linked?: boolean
  title?: string
  /** Contain by default — the viewer's own treatment (StoryFrame). Cover is
   *  the author's explicit Fill, and only an image can keep it (flatten). */
  fit?: 'cover' | 'contain'
}) {
  const uri = picked?.uri || thumbnail || null
  if (picked?.kind === 'video') return <VideoStage player={player} />
  return (
    <View style={[styles.fill, { backgroundColor: BLACK }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={fit} transition={150} />
      ) : null}
      {/* A shared text post has no picture, and an all-black stage reads as a
          failed load. Name what is being shared instead — the same promise the
          viewer's LinkCard keeps. */}
      {linked && !uri ? (
        <View style={[styles.fill, styles.center, { paddingHorizontal: space.huge }]}>
          <Icon name="link" size={30} color={ink.muted} />
          <Text variant="title3" color={ink.full} align="center" numberOfLines={6} style={{ marginTop: space.md2 }}>
            {title || 'Shared to your story'}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/* The player belongs to the screen (see `videoPlayer`), so the stage only
   renders it — cutting a poster frame at publish time needs the same
   instance. Contain, ALWAYS: the uploaded file is posted as-is and the
   viewer letterboxes it; previewing any other crop would be a lie. */
function VideoStage({ player }: { player: any }) {
  return <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls={false} />
}

/* ---------------------------------------------------------
   The background row.

   The first swatch is the default and it is not a colour the
   author owns: it previews the hashed gradient, and choosing it
   means "let every viewer derive this from the story id". The
   rest are choices, and choosing one is what turns the frame
   into an uploaded image.
   --------------------------------------------------------- */

function BackgroundRow({
  bottom, fallback, value, onChange,
}: {
  bottom: number
  fallback: readonly [string, string]
  value: number | null
  onChange: (v: number | null) => void
}) {
  const options: { key: string; index: number | null; colors: readonly [string, string]; label: string }[] = [
    { key: 'auto', index: null, colors: fallback, label: 'Default background' },
    ...BACKGROUNDS.map((colors, i) => ({ key: String(i), index: i as number | null, colors, label: `Background ${i + 1}` })),
  ]

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.bgRow, { bottom }]}
      contentContainerStyle={styles.bgRowContent}
      keyboardShouldPersistTaps="always"
    >
      {options.map(o => {
        const selected = o.index === value
        return (
          <Touchable
            key={o.key}
            onPress={() => onChange(o.index)}
            feedback="scale"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
          >
            <View
              style={[
                styles.swatch,
                {
                  borderColor: selected ? ink.full : ink.hairline,
                  borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <LinearGradient
                colors={[o.colors[0], o.colors[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </Touchable>
        )
      })}
    </ScrollView>
  )
}

/* The card's position is cosmetic: there is no field on the create contract
   that could persist it, so it is never promised anywhere in the UI. */
function DraggablePoll({ height, width, children }: { height: number; width: number; children: React.ReactNode }) {
  const min = height * 0.18
  const max = height * 0.78
  const y = useSharedValue(height * 0.42)
  const start = useSharedValue(0)

  /* Memoized on the two numbers the worklets close over: GestureDetector
     diffs by handler identity, and a fresh object every render re-registers
     the config with the native module for nothing. */
  const pan = React.useMemo(() => Gesture.Pan()
    .onBegin(() => { start.value = y.value })
    .onUpdate(e => { y.value = Math.min(max, Math.max(min, start.value + e.translationY)) })
    /* Release CARRIES the fling: the spring inherits the finger's velocity and
       settles inside the clamps, instead of the card stopping dead mid-throw
       (the old spring targeted its own current value — a no-op). */
    .onEnd(e => {
      /* overshootClamping: the seeded velocity must not carry the card past
         the clamped target and out of the working band. */
      y.value = withSpring(
        Math.min(max, Math.max(min, y.value + e.velocityY * 0.08)),
        { damping: 22, stiffness: 200, velocity: e.velocityY, overshootClamping: true },
      )
    }),
  [min, max, y, start])

  /* translateY, NOT `top`: the card is anchored at top:0 and offset by a
     transform, so a drag is a compositor move instead of a yoga pass over the
     stage on every frame of the finger. The coordinate space is identical —
     top:0 + translateY(y) lands exactly where top:y did — so the clamps, the
     spring and the (absent) drop targets all still read the same y. */
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.pollWrap, { width: width - 48 }, anim]}>{children}</Animated.View>
    </GestureDetector>
  )
}

/* The barber-pole under the top bar. It is on screen at the one moment the JS
   thread is at its busiest — encoding and uploading — so it must not be driven
   from JS: an interval poking a shared value jitters and stalls exactly when
   the bar's whole job is to prove the app is still working. One repeating
   timing on the UI thread, translated rather than laid out, and measured
   because a percentage translation is not portable across every RN pairing. */
function IndeterminateBar({ top }: { top: number }) {
  const t = useTheme()
  const x = useSharedValue(0)
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    if (!width) return undefined
    /* Reduce Motion parks it at the start: a still bar plus the disabled
       control is enough to say "working" without a thing sliding forever. */
    if (t.prefs.reducedMotion) { x.value = 0; return undefined }
    x.value = -width * 0.4
    x.value = withRepeat(withTiming(width, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
    return () => cancelAnimation(x)
  }, [width, t.prefs.reducedMotion, x])

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={[styles.progressTrack, { top, backgroundColor: ink.hairline }]}
    >
      <Animated.View style={[styles.progressBar, { backgroundColor: night.accent }, anim]} />
    </View>
  )
}

function formatClock(seconds?: number) {
  const s = Math.round(Number(seconds) || 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  iconBtn: { minWidth: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  /* No fontWeight here any more: the face (and its weight) comes from
     overlayFaceStyle at the call site — a literal 700 under a registered
     family invites Android to synthesize over it. */
  textStage: { paddingHorizontal: 28, maxHeight: '70%', width: '100%' },
  styleDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: ink.hairline },
  inkSwatch: { width: 26, height: 26, borderRadius: 13 },
  counter: { position: 'absolute', alignSelf: 'center' },
  bgRow: { position: 'absolute', left: 0, right: 0, maxHeight: 46 },
  bgRowContent: { gap: space.sm2, paddingHorizontal: space.lg, alignItems: 'center' },
  swatch: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden' },
  /* ---- the entry screen: the roll IS the interface ---- */
  emptyTitle: { paddingHorizontal: space.lg, paddingBottom: space.md2 },
  emptyLabel: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' },
  emptyNote: { paddingHorizontal: space.huge, paddingTop: space.huge },
  rollChip: {
    position: 'absolute',
    end: 5,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs2,
    height: 16,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  permCard: { paddingHorizontal: space.xxxl, paddingTop: space.huge, alignItems: 'center' },
  permBtn: {
    marginTop: space.lg2,
    paddingHorizontal: 22,
    height: 44,
    justifyContent: 'center',
    ...setback(shape.buttonMd),
    borderCurve: 'continuous',
  },
  /* Three ways in, docked. A flat plate rather than a gradient: it has to be
     legible over whatever photograph scrolls under it, and DESIGN.md §10
     rules out the blur that would have made a lighter one work. */
  dock: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingTop: space.md2,
  },

  /* ---- the creative stage ---- */
  /* The rail hangs off the top bar on the end edge — the reel editor's own
     geometry, so an author who learns one learns both. */
  tools: { position: 'absolute', end: 6, gap: space.md },
  /* The caption is SHOWN here and edited in a docked tray. A bare field at a
     hand-computed `bottom` is what put it under the gesture bar, and then
     under the keyboard. */
  captionPeek: {
    position: 'absolute',
    start: 16,
    end: 16,
    ...setback(shape.card),
    borderCurve: 'continuous',
    paddingHorizontal: space.md2,
    paddingVertical: space.sm2,
  },
  stageNote: {
    position: 'absolute',
    start: 16,
    end: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    paddingHorizontal: space.sm2,
    paddingVertical: space.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  /* top:0 is the baseline the drag's translateY measures from — without it the
     card's resting offset would come from the stage's alignment instead. */
  pollWrap: { position: 'absolute', start: 24, top: 0 },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    ...setback(shape.popover),
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space.md2,
    paddingBottom: space.md2,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  share: {
    width: 124,
    height: 48,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  /* Spinner ships 20pt of padding for the in-place case; inside a 48pt plate
     next to a word it has to be just the arc. */
  shareSpinner: { padding: 0 },
  progressTrack: { position: 'absolute', left: 0, right: 0, height: 2, overflow: 'hidden' },
  progressBar: { position: 'absolute', top: 0, bottom: 0, width: '40%' },
})
