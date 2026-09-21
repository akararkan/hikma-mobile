/* =========================================================
   The shapes the search/tag surfaces render, plus the one
   type→appearance table they all share.

   `src/api` is JavaScript, so these interfaces are the only
   place the wire contract is written down for the type
   checker. They mirror `adapters.searchHit` /
   `adapters.tagContentRowFrom` / `adapters.soundFrom` field for
   field — including the deliberate collision between the two:
   a tag-feed row and a search hit both spell the target
   `contentType` + `contentId`, which is what lets one dispatch
   table cover both surfaces.
   ========================================================= */
import { api, isNotFound } from '@/api'
import type { Palette } from '@/theme/colors'
import type { IconName } from '@/ui'

export type SearchType = 'POST' | 'REEL' | 'QUESTION' | 'ANSWER' | 'RESEARCH' | 'USER' | 'CHANNEL' | 'SOUND'
export type TabKey = 'ALL' | SearchType
export type TagScope = 'ALL' | 'QUESTION' | 'RESEARCH' | 'POST' | 'REEL'

/** One row of `GET /api/v1/search`. Field meanings FLIP by type — see
 *  `authorUsername` (the channel handle on CHANNEL, the account's own username
 *  on USER) and `authorName` (the ARTIST on SOUND). `score` is ordering only
 *  and must never be rendered. */
export interface SearchHit {
  type: string
  id: string
  contentType: string
  contentId: string
  /** ANSWER only, and always present there: the owning question. */
  parentId: string | null
  score: number
  titlePreview: string
  authorUsername: string
  authorName: string
  createdAt: string | null
  time: string
}

export interface SearchEnvelope {
  query: string
  types: string[]
  page: number
  size: number
  /** A 200 with the index down. Banner, never an empty state, never a toast. */
  degraded: boolean
  /** '' ends the tab. Opaque — never decode or synthesise one. */
  nextCursor: string
  results: SearchHit[]
}

export interface TrendingTag { tag: string; usageCount: number; rank: number }
export interface TagSuggestion { tag: string; usageCount: number }

export interface TagContentItem {
  id: string
  type: string
  contentType: string
  contentId: string
  authorId: string
  /** Denormalised ≤280-char snippet. MAY be null on older rows. */
  titlePreview: string
  createdAt: string | null
  time: string
}

export interface TagContentPage {
  tag: string
  items: TagContentItem[]
  nextCursor: string
  pageSize: number
}

export interface Sound {
  id: string
  title: string
  artist: string
  artistName: string
  audioUrl: string | null
  /** The un-absolutised url — the only one a post may persist. */
  audioUrlRaw: string | null
  cover: string | null
  coverArtUrl: string | null
  duration: number | null
  durationSeconds: number | null
  category: string
  status: string
  /** Only /sounds/{id}/usage carries the live counter — hydrated rows are null. */
  useCount: number | null
  uploaderId: string | null
  createdAt: string | null
}

export interface PeopleRow {
  id: string
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  role: string
  verified: boolean
  academicTitle: string
  institution: string
  followers: number
  [k: string]: any
}

/* ---------------------------------------------------------
   Type → appearance. One table, because a QUESTION that is
   violet on Explore and blue on the tag page reads as two
   different entities.
   --------------------------------------------------------- */

export const TYPE_LABEL: Record<string, string> = {
  POST: 'Post', REEL: 'Reel', QUESTION: 'Question', ANSWER: 'Answer',
  RESEARCH: 'Research', USER: 'Person', CHANNEL: 'Channel', SOUND: 'Sound',
}

/** Tab labels differ from row labels: the strip reads as categories. */
export const TAB_LABEL: Record<TabKey, string> = {
  ALL: 'All', POST: 'Posts', REEL: 'Reels', QUESTION: 'Questions', ANSWER: 'Answers',
  RESEARCH: 'Research', USER: 'People', CHANNEL: 'Channels', SOUND: 'Sounds',
}

export const TYPE_ICON: Record<string, IconName> = {
  POST: 'file', REEL: 'play', QUESTION: 'qna', ANSWER: 'checkCircle',
  RESEARCH: 'book', USER: 'person', CHANNEL: 'channels', SOUND: 'music',
}

/** Foreground + backing tint for a type badge. Roles only — the palette has no
 *  violet, so QUESTION borrows the brand accent rather than inventing a hex. */
export function typeSkin(c: Palette, type: string): { fg: string; bg: string } {
  switch (type) {
    case 'REEL': return { fg: c.danger, bg: c.dangerSoft }
    case 'QUESTION': return { fg: c.accent, bg: c.accentSoft }
    case 'ANSWER': return { fg: c.success, bg: c.successSoft }
    case 'RESEARCH': return { fg: c.scholar, bg: c.scholarSoft }
    case 'SOUND': return { fg: c.warning, bg: c.warningSoft }
    case 'CHANNEL': return { fg: c.info, bg: c.infoSoft }
    default: return { fg: c.textSecondary, bg: c.surfaceSunken }
  }
}

/** Route for a tag-feed row / any `contentType` + `contentId` pair. Kept beside
 *  the table above because `tagContentRowFrom` and `searchHit` share the field
 *  names precisely so this dispatch is written once. */
export function contentHref(contentType: string, contentId: string): string | null {
  switch (contentType) {
    case 'POST': return `/posts/${contentId}`
    /* The type is known here, so the viewer is addressed directly — via the
       post screen it is a doorway frame and a second GET on the way there. */
    case 'REEL': return `/reels/${contentId}`
    case 'QUESTION': return `/qna/${contentId}`
    case 'RESEARCH': return `/research/${contentId}`
    default: return null
  }
}

/* ---------------------------------------------------------
   Thin typed wrappers over the JS client.

   `src/api` destructures its options with defaults
   (`{ scope = 'ALL', limit = 10 } = {}`), and TypeScript infers
   the parameter type from exactly those — every option WITHOUT
   a default (`prefix`, `types`, `cursor`, `signal`) is inferred
   straight back out of the signature. Rather than cast at a
   dozen call sites, the real contract is written down once here.
   --------------------------------------------------------- */

export interface ActivityRow {
  id: string
  type: string
  label: string
  subtitle: string
  time: string
  date: string
  createdAt: string | null
  deepLink: string | null
}

/** Blank prefixes are short-circuited to `[]` by the module, so a blank one
 *  never reaches the wire as a 400 MISSING_PARAMETER. */
export function searchTags(args: { prefix: string; scope?: TagScope; limit?: number }): Promise<TagSuggestion[]> {
  return (api.tags.search as (a: unknown) => Promise<TagSuggestion[]>)(args)
}

/** CURSOR paging. `stream` injects the head sentinel on the first page so the
 *  server actually enters cursor mode and answers with a usable `nextCursor` —
 *  `page()` is offset-only and re-serves page 0 for ever. */
export function searchStream(
  q: string,
  opts: { types?: string[]; cursor?: string; size?: number; expand?: boolean; signal?: AbortSignal } = {},
): Promise<SearchEnvelope> {
  return (api.search.stream as (q: string, o: unknown) => Promise<SearchEnvelope>)(q, opts)
}

/** NOTE the pagination caveat (activity.md §1): `page` is NOT applied
 *  server-side — walk back by passing the last row's `createdAt` as the
 *  inclusive `to` bound and dropping the duplicate anchor row. */
export function listActivity(
  opts: { types?: string[]; from?: string; to?: string; page?: number; size?: number } = {},
): Promise<ActivityRow[]> {
  return (api.activity.list as (o: unknown) => Promise<ActivityRow[]>)(opts)
}

/** The tag feed. Its cursor is opaque base64url of `createdAt` + `contentId`
 *  and is a DIFFERENT idiom from the search cursor — never mix them, never
 *  decode either. */
export function tagContent(
  tag: string,
  opts: { cursor?: string; pageSize?: number } = {},
): Promise<TagContentPage> {
  return (api.tags.content as (tag: string, o: unknown) => Promise<TagContentPage>)(tag, opts)
}

/** The per-user activity SSE. Returns its own unsubscribe; it is a no-op under
 *  mock mode, where EventSource cannot be intercepted. */
export function streamActivity(
  handlers: { onActivity?: (row: ActivityRow) => void; onError?: (e: any) => void },
): () => void {
  return (api.activity.stream as (h: unknown) => () => void)(handlers)
}

/** OFFSET paging with a real `total` — the only people surface that has one. */
export function searchUsers(
  q: string,
  opts: { page?: number; size?: number; eligibleContributor?: boolean; signal?: AbortSignal } = {},
): Promise<{ items: PeopleRow[]; total: number | null; hasMore: boolean }> {
  return (api.users.search as (q: string, o: unknown) => Promise<{ items: PeopleRow[]; total: number | null; hasMore: boolean }>)(q, opts)
}

/** Good enough to tell "this person is searching by email" from "this person
 *  is searching by name". Deliberately not RFC-strict: the cost of a false
 *  positive is one 404 that falls through to the normal search. */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())

/** Exact-email resolution. users/search.md is explicit that emails are NOT
 *  searchable — the index does not contain them, so an email typed into the
 *  people search matches nothing — and points at this endpoint instead. Exact
 *  match only, by design: it answers "is THIS address on IKA", never "show me
 *  addresses like this one".
 *
 *  Resolves to null on a miss so the caller can render its ordinary empty
 *  state; real failures still throw. */
export async function resolveEmail(email: string): Promise<PeopleRow | null> {
  try {
    /* Same adapter the people search runs its rows through (userFrom), so the
       resolved row renders identically to a searched one. */
    const u = await (api.users.getByEmail as (e: string) => Promise<PeopleRow | null>)(email.trim())
    return u ?? null
  } catch (e: any) {
    if (isNotFound(e)) return null
    throw e
  }
}

/* mm:ss for the sound sheet. The body lives in src/lib/format.ts — it was
   character-identical to the qna and research copies, and a duration that
   reads differently on Explore than on a paper is a bug waiting to happen.
   Re-exported here so ./index.ts:8 and its import sites do not move. */
export { formatDuration } from '@/lib/format'
