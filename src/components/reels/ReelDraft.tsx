/* =========================================================
   The composer's draft.

   expo-router params cannot carry a video uri, an overlay tree
   and a sound object across four screens, so the draft is a
   context. It persists to MMKV because a phone takes calls: a
   composer that loses a two-minute edit to a backgrounded app
   is a composer nobody uses twice.

   `buildFormData` lives here rather than on the publish screen
   because the multipart assembly has four load-bearing rules
   and they are worth stating once:

     · postType REEL, and visibility takes the POST enum
       (PUBLIC | FOLLOWERS_ONLY | ONLY_ME) — NOT settings'
       VISIBILITY_LEVELS, which is the privacy-resolver enum.
     · every file part goes under ONE name with the VIDEO
       FIRST, because the server buckets by part name and the
       reel's cover/videoUrl is the first VIDEO-typed url.
     · audioTrackUrl uses the RELATIVE `audioUrlRaw`; baking
       this client's host into a shared DB column breaks every
       other client. `soundId` is what bumps use_count, and it
       is sent even when the post is held.
     · the caption is the CAPTION. Text drawn on the clip
       travels in overlay.json and nowhere else — see below.
   ========================================================= */
import React from 'react'
import { storage } from '@/platform/storage'
import { DEFAULT_MIX, soundLabel, withMix } from '@/lib/soundMix'
import { serialiseOverlay } from '@/lib/reelOverlay'
import type { OverlayItem } from './ReelOverlayLayer'
import type { ViewSound } from './types'

export type ReelVisibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'ONLY_ME'
export interface ReelMix { orig: number; music: number; voice: number }

/** One recorded/imported segment in the multi-clip editor. `videoUri` stays
 *  the EXPORTED artifact the publish path uploads; clips are the recipe, kept
 *  so the editor can re-cut without re-recording. Editing requires the
 *  video-composer native module (hasVideoComposer) — without it the composer
 *  keeps its single-clip flow and this array stays empty. */
export interface DraftClip {
  uri: string
  durationMs: number
  startMs: number
  endMs: number
  speed: number
}

export interface ReelDraftState {
  clips: DraftClip[]
  videoUri: string | null
  imageUri: string | null
  durationMs: number
  sound: ViewSound | null
  mix: ReelMix
  items: OverlayItem[]
  fit: 'cover' | 'contain'
  voiceUri: string | null
  coverUri: string | null
  caption: string
  visibility: ReelVisibility
  locationName: string
}

const EMPTY: ReelDraftState = {
  clips: [],
  videoUri: null,
  imageUri: null,
  durationMs: 0,
  sound: null,
  mix: { ...DEFAULT_MIX },
  items: [],
  /* contain: the viewer shows the frame at its own aspect (ReelCard), so the
     doc must record the same fit or authored text drifts off the video. */
  fit: 'contain',
  voiceUri: null,
  coverUri: null,
  caption: '',
  visibility: 'PUBLIC',
  locationName: '',
}

const KEY = 'ika:reels:draft'

export interface ReelDraftValue {
  draft: ReelDraftState
  set: <K extends keyof ReelDraftState>(key: K, value: ReelDraftState[K]) => void
  patch: (next: Partial<ReelDraftState>) => void
  reset: () => void
  isDirty: boolean
  hasMedia: boolean
  buildFormData: (overlayUri: string | null) => FormData
}

const Ctx = React.createContext<ReelDraftValue | null>(null)

export function useReelDraft(): ReelDraftValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useReelDraft() outside <ReelDraftProvider>')
  return v
}

function readCache(): ReelDraftState {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    /* fit is not author-set anywhere, so a cached value is only ever a stale
       default — pin it to the current one rather than publishing a doc whose
       fit disagrees with the viewer's surface. */
    return { ...EMPTY, ...parsed, fit: EMPTY.fit, mix: { ...DEFAULT_MIX, ...(parsed?.mix || {}) } }
  } catch {
    return EMPTY
  }
}

export function ReelDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = React.useState<ReelDraftState>(readCache)

  React.useEffect(() => {
    try { storage.setItem(KEY, JSON.stringify(draft)) } catch { /* a full disk must not block the composer */ }
  }, [draft])

  const set = React.useCallback(<K extends keyof ReelDraftState>(key: K, value: ReelDraftState[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
  }, [])

  const patch = React.useCallback((next: Partial<ReelDraftState>) => {
    setDraft(d => ({ ...d, ...next }))
  }, [])

  const reset = React.useCallback(() => {
    setDraft(EMPTY)
    try { storage.removeItem(KEY) } catch { /* ignore */ }
  }, [])

  const hasMedia = !!(draft.videoUri || draft.imageUri)
  const isDirty = hasMedia || draft.clips.length > 0 || !!draft.caption.trim() || draft.items.length > 0 || !!draft.sound || !!draft.voiceUri

  const buildFormData = React.useCallback((overlayUri: string | null) => {
    const doc = serialiseOverlay(draft.items, draft.fit)
    const fd = new FormData()
    fd.append('postType', 'REEL')
    fd.append('visibility', draft.visibility)
    /* THE CAPTION IS ONLY THE CAPTION. The words an author draws on the clip
       used to be appended here as well, so that the server could moderate,
       hashtag-extract and index them like any other text — and the cost of
       that was the thing every author actually saw: text placed on the video
       ALSO showed up as the reel's caption, under the reel, where nobody put
       it. The overlay already travels as its own part (overlay.json, below),
       which is where those words belong; moderating that part is the server's
       to do, not something worth paying for with a caption nobody wrote. */
    fd.append('textContent', draft.caption.trim())
    if (draft.locationName.trim()) fd.append('locationName', draft.locationName.trim())

    if (draft.sound) {
      fd.append('soundId', draft.sound.id)
      if (draft.sound.audioUrlRaw) fd.append('audioTrackUrl', withMix(draft.sound.audioUrlRaw, draft.mix))
      fd.append('audioTrackName', soundLabel(draft.sound))
    }

    /* One part name, video first — the order IS the contract. */
    const primary = draft.videoUri
      ? { uri: draft.videoUri, name: 'reel.mp4', type: 'video/mp4' }
      : draft.imageUri
        ? { uri: draft.imageUri, name: 'reel.jpg', type: 'image/jpeg' }
        : null
    if (primary) fd.append('files[]', primary as any)
    if (draft.coverUri) fd.append('files[]', { uri: draft.coverUri, name: 'cover.jpg', type: 'image/jpeg' } as any)
    if (draft.voiceUri) fd.append('files[]', { uri: draft.voiceUri, name: 'voiceover.m4a', type: 'audio/mp4' } as any)
    if (overlayUri) fd.append('files[]', { uri: overlayUri, name: 'overlay.json', type: 'application/json' } as any)

    return fd
  }, [draft])

  const value = React.useMemo<ReelDraftValue>(
    () => ({ draft, set, patch, reset, isDirty, hasMedia, buildFormData }),
    [draft, set, patch, reset, isDirty, hasMedia, buildFormData],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
