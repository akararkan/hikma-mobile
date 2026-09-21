/* =========================================================
   The view shapes the feed family renders.

   The api layer is JavaScript, so nothing it returns carries a
   type. These declarations mirror `src/api/adapters.js` field
   for field — they are documentation with teeth, not a parallel
   model. When an adapter gains a field, add it here; when the
   two disagree, the adapter is right.
   ========================================================= */

export interface FeedAuthor {
  id: string
  full: string
  handle: string
  initials: string
  /** Deterministic fallback colour from the adapter's id hash. */
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
  /** The account behind this byline has been deleted. Set by the adapter, from
   *  either shape the backend produces (adapters.js §authorFrom); renderers
   *  use it to stop offering a tap to a profile that answers 404. */
  deleted?: boolean
}

export interface FeedMedia {
  /** IMAGE | VIDEO | AUDIO | OTHER — the wire's own spelling. */
  type: string
  /** Absent on a VOICE_POST's synthetic AUDIO entry: there the playable file
   *  is `post.audioUrl`, and `media` carries only a label. */
  url?: string
  poster?: string | null
  label?: string
  /** A CSS-shaped '16/10' string. Parse it; never hand it to a RN style. */
  ratio?: string
  /** The author's alt text. Only the carousel table carries it — the inline
   *  `mediaUrls` list cannot — so it is present on album-sourced items only,
   *  and it is the accessibility label, not a caption. */
  alt?: string
  /** Clip length, same source and same caveat as `alt`. */
  durationSeconds?: number | null
  /** A CSS background shorthand, mirrored from the adapter's own output.
   *  Extract the url; never hand it to a RN style. */
  bg?: string
  /** Additive variant map from the media pipeline (`hls` = adaptive CMAF
   *  master, `preview` = short animated WebP, plus the rendition ladder) —
   *  urls, absolutised by the adapter. Null/absent on legacy media. */
  variants?: Record<string, string> | null
  /** Standard BlurHash placeholder (paint-before-bytes). Null/absent on
   *  legacy media. */
  blurhash?: string | null
}

/** FOLLOWING | SELF | CHANNEL | EXPLORE | null — chrome only, never ordering. */
export type FeedSource = 'FOLLOWING' | 'SELF' | 'CHANNEL' | 'EXPLORE' | null

export interface PostView {
  kind?: 'POST'
  id: string
  author: string
  _author: FeedAuthor
  /** TEXT | EMBEDDED | REEL | VOICE_POST | REPOST */
  type: string
  visibility: string
  status: string
  time: string
  body: string
  location: string | null
  media: FeedMedia[]
  videoUrl?: string | null
  /** Additive, REEL-only: the HLS master. `videoUrl` stays progressive MP4. */
  videoHlsUrl?: string | null
  audioUrl?: string | null
  soundUrl?: string | null
  soundName?: string
  overlayUrl?: string | null
  voiceoverUrl?: string | null
  sharedPostId?: string | null
  likes: number
  comments: number
  shares: number
  views: number
  saves: number
  liked: boolean
  saved: boolean
  createdAt: string | null
  savedAt?: string | null
  savedCollectionName?: string | null
  source?: FeedSource
  rankScore?: number | null
}

export interface ResearchFeedView {
  kind: 'RESEARCH'
  id: string
  author: string
  _author: FeedAuthor
  title: string
  /** A CSS background shorthand. Extract the url; never style with it. */
  cover: string
  hasCover: boolean
  time: string
  createdAt: string | null
  source?: FeedSource
}

export interface QuestionFeedView {
  kind: 'QUESTION'
  id: string
  author: string
  _author: FeedAuthor
  title: string
  time: string
  createdAt: string | null
  source?: FeedSource
}

export interface FeedChannel {
  id: string
  handle: string
  title: string
  avatarUrl: string | null
  verified: boolean
  subscriberCount: number
}

export interface ChannelPostView {
  kind: 'CHANNEL_POST'
  /** Synthetic uuid — a list key and nothing else. */
  id: string
  /** The real message id: a snowflake, always a STRING. */
  channelPostId: string | null
  channel: FeedChannel | null
  author: null
  _author: null
  body: string
  media: FeedMedia[]
  videoUrl?: string | null
  cover?: string | null
  views: number
  shares: number
  comments: number
  time: string
  createdAt: string | null
  source?: FeedSource
}

export type FeedItem = PostView | ResearchFeedView | QuestionFeedView | ChannelPostView

/** The synthetic rows the home list interleaves with real content. The
 *  discovery bands are the mobile shape of the web feed's right-hand rail:
 *  research, open questions and trending tags folded INTO the timeline. */
export interface RailRow { kind: 'LIVE_RAIL'; id: string }
export interface PymkRow { kind: 'PYMK'; id: string }
/* One interface per kind — a single interface with a union `kind` would
   defeat discriminated-union narrowing at the renderItem dispatch. */
export interface ResearchRailRow { kind: 'RESEARCH_RAIL'; id: string }
export interface QnaBandRow { kind: 'QNA_BAND'; id: string }
export interface TrendingRow { kind: 'TRENDING'; id: string }
/** One live broadcast re-surfaced mid-timeline. CLIENT-synthesized — the
 *  ranked feed has no LIVE item kind (post/posts.md `postType`); the row
 *  renders whatever `liveNow[0]` is when it comes up. */
export interface LiveCardRow { kind: 'LIVE_CARD'; id: string }
export type BandRow = ResearchRailRow | QnaBandRow | TrendingRow | LiveCardRow
export interface NoteRow { kind: 'EMPTY_NOTE'; id: string }
export type FeedRow = FeedItem | RailRow | PymkRow | BandRow | NoteRow

export interface LiveStreamView {
  id: string
  hostId: string | null
  hostUsername: string | null
  hostHandle: string
  hostDisplayName: string | null
  hostAvatarUrl: string | null
  title: string
  viewerCount: number
  isLive: boolean
}

export interface SuggestionView {
  id: string
  candidateId: string
  _author: FeedAuthor
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
  score: number
  reason: string
  reasons: string[]
  computedAt: string | null
  time: string
  isFollowing: boolean
}

export interface CommentView {
  id: string
  author: string
  _author: FeedAuthor
  body: string
  time: string
  likes: number
  liked: boolean
  replyCount: number
  parentCommentId: string | null
  replyToCommentId: string | null
  replyToUserId: string | null
  _replyToHandle: string | null
  /** Carried by `commentFrom`; also set locally on our own edit and on
      COMMENT_EDITED. */
  edited?: boolean
  /** ISO stamp from the wire — the comments-paging cursor. */
  createdAt?: string | null
  /** One inline image or clip (engagement.md §3.1). `mediaType` is absent on
   *  replies, and `mediaThumbnailUrl` only ever arrives on an SSE frame. */
  mediaUrl?: string | null
  mediaType?: string | null
  mediaThumbnailUrl?: string | null
  /* Client-only: never carried by the wire. */
  pending?: boolean
  failed?: boolean
  status?: string
}

/** `postFromFeedItem` hands back web-shaped '16/10' strings. */
export function ratioOf(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback
  const [w, h] = String(raw).split('/').map(Number)
  return w > 0 && h > 0 ? w / h : fallback
}

/** `researchFromFeedItem.cover` is `center/cover no-repeat url("…")`. */
export function coverUrlOf(cover: string | null | undefined): string | null {
  const m = /url\("([^"]+)"\)/.exec(String(cover || ''))
  return m ? m[1] : null
}
