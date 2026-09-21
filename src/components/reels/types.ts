/* =========================================================
   The shapes the reels domain passes around.

   Deliberately loose where the api layer is: `src/api` is
   plain JS, so its adapters return `any`. Writing the fields
   down here is what lets a screen be type-checked at all,
   without pretending the wire is narrower than it is — hence
   the index signature on ViewPost, which is doing real work
   (feed rows and full reads carry different subsets).
   ========================================================= */
import { bestPlayableUrl, feedVideoUrl } from '@/lib/videoSource'

export interface ReelAuthor {
  id: string
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
}

export interface ReelMedia {
  type: 'VIDEO' | 'IMAGE' | 'AUDIO' | 'OTHER' | string
  /** Optional because a VOICE_POST's AUDIO entry carries a label and no url. */
  url?: string
  poster?: string | null
  ratio?: string
  /** Additive pipeline variant map (`hls`, `preview`, the rendition ladder);
   *  null/absent on legacy media. Urls, already absolutised by the adapter. */
  variants?: Record<string, string> | null
  [k: string]: any
}

export interface ViewPost {
  id: string
  author: string
  _author: ReelAuthor
  type: string
  status: string
  visibility?: string
  body: string
  media: ReelMedia[]
  videoUrl?: string | null
  /** Additive, REEL-only: the CMAF/fMP4 HLS master. `videoUrl` stays the
   *  progressive MP4 exactly as before. */
  videoHlsUrl?: string | null
  /** Carries the `#mix=` fragment — strip it before handing it to a player. */
  soundUrl?: string | null
  soundName?: string
  overlayUrl?: string | null
  voiceoverUrl?: string | null
  likes: number
  comments: number
  shares: number
  views: number
  saves: number
  liked: boolean
  saved: boolean
  /** Raw ISO instant — the cursor for every reel feed that has one. */
  createdAt: string | null
  time?: string
  source?: string | null
  [k: string]: any
}

export interface ViewSound {
  id: string
  title: string
  artist: string
  audioUrl: string | null
  /** RELATIVE — this is what a post stores, never the absolutised one. */
  audioUrlRaw: string | null
  cover: string | null
  duration: number | null
  category: string
  status: string
  /** Only /sounds/{id}/usage carries the live counter — hydrated rows are null. */
  useCount: number | null
  createdAt?: string | null
  [k: string]: any
}

export interface ViewComment {
  id: string
  author: string
  _author: ReelAuthor
  body: string
  time: string
  likes: number
  liked: boolean
  replyCount: number
  parentCommentId: string | null
  replyToCommentId: string | null
  replyToUserId: string | null
  _replyToHandle: string | null
  /** Local only: an optimistic row that has not come back from the server. */
  _pending?: boolean
  [k: string]: any
}

/** Where a pager's continuation list comes from — also the `src` query param. */
export type ReelSourceKind =
  | 'for-you' | 'following' | 'latest' | 'author' | 'sound' | 'watched' | 'none'

export const SOUND_CATEGORIES: [string, string][] = [
  ['NASHEED', 'Nasheed'],
  ['QURAN_RECITATION', 'Quran recitation'],
  ['LECTURE_CLIP', 'Lecture clip'],
  ['NATURE', 'Nature'],
  ['ORIGINAL', 'Original'],
  ['PLATFORM_MUSIC', 'Platform music'],
]

export const soundCategoryLabel = (v: string | null | undefined): string =>
  SOUND_CATEGORIES.find(c => c[0] === v)?.[1]
  || String(v || '').toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

/** m:ss — sounds and watch history both print durations this way. */
export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The playable url for a reel's clip, HLS-first: the adaptive master from
 *  the media entry's `variants` (or the feed row's `videoHlsUrl`) when the
 *  pipeline made one, else the progressive url as always. Feed rows put that
 *  on `videoUrl`; older rows only have the cover, which the adapter has
 *  already typed VIDEO. */
export function clipUrlOf(post: ViewPost | null | undefined): string | null {
  if (!post) return null
  const m = post.media?.[0]
  if (m?.type === 'VIDEO') {
    const url = bestPlayableUrl(m)
    if (url) return url
  }
  return feedVideoUrl(post)
}

/** True for a photo posted as a reel — no video to decode, 6s synthetic clock. */
export function isStillReel(post: ViewPost | null | undefined): boolean {
  return post?.media?.[0]?.type === 'IMAGE'
}

/** A '#mix=' fragment is metadata, not part of the resource — every player has
 *  to be handed the bare url or iOS treats the whole string as the path. */
export const bareUrl = (u: string | null | undefined): string | null =>
  (u ? String(u).split('#')[0] : null)
