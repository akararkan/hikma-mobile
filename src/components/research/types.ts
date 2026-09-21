/* =========================================================
   The shapes the research adapters actually hand back.

   `src/api` is JavaScript, so every call returns `any`. These
   declarations are the domain's contract with it: they are
   transcribed from adapters.js (researchFrom /
   researchDetailFrom / researchCommentFrom / sourceFrom) and
   from the raw ContributorResponse, which has no adapter at
   all. Nothing here changes at runtime — but a typo in
   `metrics.reactions` now fails the build instead of rendering
   "undefined" in production.
   ========================================================= */

export type ResearchStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'RETRACTED'
export type BodyFormat = 'PLAIN' | 'MARKDOWN' | 'HTML'
export type Visibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'PRIVATE'
export type SourceType = 'URL' | 'ISBN' | 'MEDIA_FILE' | 'MANUAL'
export type ContributorRole =
  | 'CO_AUTHOR' | 'ADVISOR' | 'REVIEWER' | 'TRANSLATOR' | 'EDITOR' | 'CONTRIBUTOR'

export interface Author {
  id: string
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
}

export interface Metrics {
  views: number
  downloads: number
  reactions: number
  comments: number
  saves: number
  citations: number
  /** The seventh documented counter. The strip does not print it, but the
   *  share sheet reads it and SHARE_COUNT_UPDATED keeps it live. */
  shares: number
}

/** researchFrom — every list endpoint in the module returns these. */
export interface ResearchCardData {
  kind: 'RESEARCH'
  id: string
  author: string
  _author: Author
  time: string
  createdAt: string | null
  status: ResearchStatus
  irc: string
  title: string
  abstract: string
  abstractHtml: string
  bodyFormat: BodyFormat
  overview: string
  keywords: string
  visibility: Visibility
  tags: string[]
  /** A web CSS background shorthand — never a URI. Read it through ResearchCover. */
  cover: string
  hasVideo: boolean
  metrics: Metrics
  liked: boolean
  saved: boolean
  citation: string
  /** Present on the saved lists only; the adapter does not declare it. */
  savedAt?: string | null
  scheduledPublishAt?: string | null
}

export interface MediaFile {
  id: string
  type: 'DOCUMENT' | 'DATASET' | 'SPREADSHEET' | 'CODE' | 'ARCHIVE' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER'
  url: string | null
  name: string
  mimeType: string | null
  fileSize: number | null
  caption: string
  altText: string
  thumbnailUrl: string | null
  duration: number | null
  width: number | null
  height: number | null
  order: number
}

/** sourceFrom. `href` and `fileUrl` are already assetUrl-resolved. */
export interface SourceItem {
  id: string
  answerId: string | null
  type: SourceType
  title: string
  citationText: string
  sub: string
  url: string | null
  isbn: string | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  mimeType: string | null
  href: string | null
  order: number
  createdAt: string | null
}

/** researchDetailFrom. */
export interface ResearchDetail extends ResearchCardData {
  description: string
  descriptionHtml: string
  abstractSource: string
  videoPromoUrl: string | null
  videoPromoThumb: string | null
  videoPromoDuration: number | null
  coverImageUrl: string | null
  scheduledPublishAt: string | null
  commentsEnabled: boolean
  downloadsEnabled: boolean
  shareUrl: string | null
  slug: string | null
  publishedAt?: string | null
  mediaFiles: MediaFile[]
  contributors: { user: string; _user: Author; role: string; note: string }[]
  sources: SourceItem[]
  figures: { bg: string; label: string }[]
}

/** researchCommentFrom. */
export interface ResearchComment {
  id: string
  author: string
  _author: Author
  body: string
  time: string
  likes: number
  liked: boolean
  replyCount: number
  edited: boolean
  hidden: boolean
  parentId: string | null
  mediaUrl: string | null
  mediaType: string | null
  mediaThumbnailUrl: string | null
  voiceUrl: string | null
  voiceDurationSeconds: number | null
  replies: ResearchComment[]
  /** Client-only: an optimistic row that has not landed yet. */
  _pending?: boolean
  _failed?: boolean
}

/** RAW ContributorResponse — there is no adapter for this one. */
export interface ContributorRow {
  id: string
  userId: string
  fullName: string
  username: string
  profileImage: string | null
  userRole: string
  role: ContributorRole
  displayOrder: number
  contributionNote: string | null
  addedAt: string | null
}

export interface TrendingTag { tag: string; usageCount: number; rank: number }
export interface TagSuggestion { tag: string; usageCount: number }

export interface SearchHitRow {
  type: string
  id: string
  contentType: string
  contentId: string
  parentId: string | null
  score: number
  titlePreview: string
  authorUsername: string
  authorName: string
  createdAt: string | null
}

export interface ShareLinkInfo {
  shortUrl: string
  canonicalUrl: string
  token: string
  shareCount: number
}
