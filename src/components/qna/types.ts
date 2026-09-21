/* =========================================================
   View shapes for the Q&A domain.

   `src/api` is JavaScript, so an adapter's return type infers
   as a structural blob that widens differently at every call
   site. These declarations pin the shape once, and the two
   `to*` helpers are the only place a raw wire DTO crosses into
   typed code — which is also a convenient reminder of WHICH
   methods hand back raw DTOs (qna.edit, save, unsave, lock,
   unlock, answerLimit, react, unreact, accept, unaccept,
   editAnswer). Everything else in qna.js is already mapped.

   There is deliberately no toSource/toAttachment: qna.js runs
   sourceFrom/attachmentFrom itself on every source and
   attachment endpoint, and answerFrom maps the nested arrays,
   so a raw one of either shape never reaches typed code.
   ========================================================= */
import { adapters } from '@/api'

export interface QnaAuthor {
  id: string
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
}

export type QuestionStatus = 'OPEN' | 'ANSWERED' | 'CLOSED' | 'ARCHIVED'

export interface QuestionView {
  kind: 'QUESTION'
  id: string
  author: string
  _author: QnaAuthor
  /** The server's own "2 hours ago" string — preferred over a client clock. */
  time: string
  formattedDate: string
  createdAt: string | null
  updatedAt: string | null
  status: QuestionStatus
  title: string
  body: string
  /** TOP-LEVEL ANSWER COUNT, not a list. `answerList` is always []. */
  answers: number
  views: number
  saves: number
  saved: boolean
  answersLocked: boolean
  maxAnswers: number | null
  /** May be null on an older DTO revision — that means "unknown", not false. */
  acceptsNewAnswers: boolean | null
  hasAcceptedAnswer: boolean
  acceptedAnswerCount: number
  /** Populated by the saved-list endpoints only. */
  savedAt: string | null
  tags: string[]
  keywords: string
  answerList: unknown[]
}

export type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'SPREADSHEET' | 'ARCHIVE' | 'OTHER'

export interface AttachmentView {
  id: string
  answerId: string | null
  url: string | null
  name: string
  mime: string
  mediaType: MediaKind
  size: number
  caption: string
  order: number
  duration: number | null
  thumbnailUrl: string | null
  createdAt: string | null
}

export type SourceKind = 'URL' | 'ISBN' | 'MEDIA_FILE' | 'MANUAL'

export interface SourceView {
  id: string
  answerId: string | null
  type: SourceKind
  title: string
  citationText: string
  /** Derived by the adapter: citationText → url → "ISBN x" → file name. */
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

export interface AnswerView {
  id: string
  questionId: string | null
  author: string
  _author: QnaAuthor
  time: string
  formattedDate: string
  createdAt: string | null
  updatedAt: string | null
  accepted: boolean
  likes: number
  myReaction: 'LIKE' | null
  _liked: boolean
  body: string
  parentAnswerId: string | null
  replyToAnswerId: string | null
  replyToUserId: string | null
  replyCount: number
  edited: boolean
  editedAt: string | null
  deleted: boolean
  deletedAt: string | null
  mediaUrl: string | null
  mediaType: 'IMAGE' | 'VIDEO' | null
  mediaThumbnailUrl: string | null
  voiceUrl: string | null
  voiceDurationSeconds: number | null
  /** A COMMA-SEPARATED STRING on the wire, not an array. */
  links: string | null
  attachments: AttachmentView[]
  sources: SourceView[]
}

export interface ShareLinkInfo {
  shortUrl: string
  canonicalUrl: string
  token: string
  shareCount: number
}

export interface TrendingTag { tag: string; usageCount: number; rank: number }
export interface TagSuggestion { tag: string; usageCount: number }

export interface SearchHitView {
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
  time: string
}

export interface TagContentRow {
  id: string
  type: string
  contentType: string
  contentId: string
  authorId: string
  titlePreview: string
  createdAt: string | null
  time: string
}

export const toQuestion = (raw: any): QuestionView => adapters.questionFrom(raw) as unknown as QuestionView
export const toAnswer = (raw: any): AnswerView => adapters.answerFrom(raw) as unknown as AnswerView

/** `answer.links` is one comma-separated string; every renderer needs it split. */
export function splitLinks(links: string | null | undefined): string[] {
  return String(links || '').split(',').map(s => s.trim()).filter(Boolean)
}

/** The host, for a link chip's label. Falls back to the raw string so a
 *  malformed URL still renders something the user typed. */
export function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url) || /^([^/?#:]+\.[^/?#:]+)/.exec(url)
  return (m?.[1] || url).replace(/^www\./, '')
}

/** A bare host typed into the link field becomes a real URL. */
export function absolutise(url: string): string {
  const v = url.trim()
  if (!v) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`
}

/* Both live in lib/format now — the same file shown in a paper and in an
   answer used to print two different sizes. Re-exported so the Q&A call
   sites keep importing them from here. */
export { formatBytes, formatDuration } from '@/lib/format'
