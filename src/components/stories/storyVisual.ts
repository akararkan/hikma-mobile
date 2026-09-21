/* =========================================================
   The story row, and the handful of pure functions every
   story surface needs to draw one.

   `api.stories.byAuthor` and `api.highlights.stories` are the
   only reads in this domain that go through NO adapter, so the
   raw DTO shape is declared here once and the two chores that
   would otherwise be forgotten per screen — assetUrl() on the
   media, a gradient for a TEXT frame — live here too.
   ========================================================= */
import { API_BASE, assetUrl } from '@/api'
import { avatarGradient } from '@/theme/colors'

export type StoryType =
  | 'IMAGE' | 'VIDEO' | 'TEXT' | 'KNOWLEDGE_PILL'
  | 'LINKED_POST' | 'LINKED_REEL' | 'LINKED_QNA' | 'LINKED_RESEARCH'

export type StoryVisibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'CLOSE_FRIENDS' | 'ONLY_ME'

/** The raw row from `/stories/by-author/{id}`. Ids are UUID strings — never
 *  coerce one to a Number. */
export interface StoryRow {
  storyId: string
  authorId: string
  createdAt: string
  storyType: StoryType | string
  visibility?: StoryVisibility | string
  mediaUrl?: string | null
  thumbnailUrl?: string | null
  textContent?: string | null
  expiresAt?: string | null
  moderationStatus?: string | null
  /** Additive pipeline variant map (`hls` = adaptive CMAF master, `preview`,
   *  the rendition ladder). Raw relative urls — these rows go through no
   *  adapter, so `mediaOf` absolutises. Absent on legacy rows. */
  variants?: Record<string, string> | null
}

/** A highlight snapshot: the same frame minus everything that only makes
 *  sense while a story is still alive (no expiresAt, no visibility). */
export interface HighlightFrame {
  highlightId: string
  storyId: string
  authorId: string
  createdAt: string
  storyType: StoryType | string
  mediaUrl?: string | null
  thumbnailUrl?: string | null
  textContent?: string | null
}

export interface StoryPoll {
  storyId: string
  pollId: string
  question: string
  optionA: string
  optionB: string
  authorId?: string
  createdAt?: string
}

export interface Tally { voteA: number; voteB: number }

export const EMPTY_TALLY: Tally = { voteA: 0, voteB: 0 }

/* ---------------------------------------------------------
   Kinds
   --------------------------------------------------------- */

export function isTextFrame(s?: { storyType?: string } | null): boolean {
  const k = String(s?.storyType || '').toUpperCase()
  return k === 'TEXT' || k === 'KNOWLEDGE_PILL'
}

export function isVideoFrame(s?: { storyType?: string } | null): boolean {
  return String(s?.storyType || '').toUpperCase() === 'VIDEO'
}

export function isLinkFrame(s?: { storyType?: string } | null): boolean {
  return String(s?.storyType || '').toUpperCase().startsWith('LINKED_')
}

/** The label a linked frame's card carries. */
export function linkLabel(s?: { storyType?: string } | null): string {
  switch (String(s?.storyType || '').toUpperCase()) {
    case 'LINKED_POST': return 'Post'
    case 'LINKED_REEL': return 'Reel'
    case 'LINKED_QNA': return 'Question'
    case 'LINKED_RESEARCH': return 'Research'
    default: return 'Link'
  }
}

/* ---------------------------------------------------------
   Media
   --------------------------------------------------------- */

/** Poster for a grid cell: the thumbnail, falling back to the media itself.
 *  Absolute — the backend hands back relative paths and these rows go through
 *  no adapter. */
export function posterOf(s?: { thumbnailUrl?: string | null; mediaUrl?: string | null } | null): string | null {
  const u = s?.thumbnailUrl || s?.mediaUrl || null
  return u ? assetUrl(u) : null
}

/** HLS-first: a VIDEO frame's adaptive master when the pipeline made one —
 *  only video assets ever carry an `hls` key, so image frames fall straight
 *  through to `mediaUrl` untouched. */
export function mediaOf(s?: { mediaUrl?: string | null; variants?: Record<string, string> | null } | null): string | null {
  const hls = s?.variants?.hls
  if (hls) return assetUrl(hls)
  return s?.mediaUrl ? assetUrl(s.mediaUrl) : null
}

/** assetUrl's inverse, for the one direction that WRITES a url instead of
 *  reading one: sharing an entity to a story persists its media url on the
 *  story row, and every other viewer resolves that string through their OWN
 *  assetUrl(). Storing this device's absolute url would pin the frame to this
 *  device's host — in dev that is a LAN IP nobody else can reach. Feed media
 *  arrives already absolutised by the adapters, so strip the origin back off
 *  and let the reader re-add theirs. Foreign origins (a real CDN) pass
 *  through: they resolve identically everywhere. */
export function sharedAssetPath(u?: string | null): string | undefined {
  if (!u) return undefined
  return u.startsWith(API_BASE) ? (u.slice(API_BASE.length) || '/') : u
}

/** The deterministic two-stop gradient a TEXT frame is painted with.
 *  Hashed from the storyId, because the create contract has NO background
 *  field: an author-chosen colour cannot be persisted, so the only honest
 *  background is one every viewer derives identically. */
export function frameGradient(seed: string | null | undefined): readonly [string, string] {
  return avatarGradient(seed || '')
}

/** A media frame with words shows them as a CAPTION bar — the docs' contract
 *  (stories.md: `textContent` = "Caption / text-story body"), and how the web
 *  renders it. The TEXT frame prints the words as its body instead, and a
 *  LINKED frame's card already carries them — both are excluded at the call
 *  sites, not here. */
export function showCaption(s?: { textContent?: string | null; mediaUrl?: string | null; thumbnailUrl?: string | null } | null): boolean {
  return !!s?.textContent && !!(s?.mediaUrl || s?.thumbnailUrl)
}

/** Auto-scale the text of a TEXT frame — 34 / 26 / 20 at 90 and 180 chars. */
export function autoTextSize(text?: string | null): number {
  const n = String(text || '').length
  if (n > 180) return 20
  if (n > 90) return 26
  return 34
}

/* ---------------------------------------------------------
   Time
   --------------------------------------------------------- */

/** Epoch ms of the newest frame in a set — the stamp storySeen keys on. */
export function newestAt(rows: { createdAt?: string }[] | null | undefined): number {
  return (rows || []).reduce((max, s) => {
    const t = s?.createdAt ? new Date(s.createdAt).getTime() : 0
    return Number.isFinite(t) && t > max ? t : max
  }, 0)
}

/** ms until a row's TTL fires. Always driven off the row's `expiresAt`, never
 *  off the lifetimeHours we sent — anything but 8/16/24 is silently coerced to
 *  24 server-side with no error, so the request is not evidence. */
export function msLeft(expiresAt?: string | number | null): number {
  if (!expiresAt) return 0
  const at = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt)
  if (!Number.isFinite(at)) return 0
  return Math.max(0, at - Date.now())
}

/** "6h" / "42m" / "3m" / "now". `long` appends " left". */
export function fmtLeft(expiresAt?: string | number | null, long = false): string {
  const ms = msLeft(expiresAt)
  if (ms <= 0) return long ? 'Gone' : '0m'
  const mins = Math.floor(ms / 60000)
  const head = mins >= 60 ? `${Math.floor(mins / 60)}h` : mins >= 1 ? `${mins}m` : '<1m'
  return long ? `${head} left` : head
}

/** The soonest expiry across a set — what "next to go" means. */
export function soonestExpiry(rows: { expiresAt?: string | null }[] | null | undefined): string | null {
  let best: string | null = null
  let bestAt = Infinity
  for (const r of rows || []) {
    if (!r?.expiresAt) continue
    const at = Date.parse(r.expiresAt)
    if (Number.isFinite(at) && at < bestAt) { bestAt = at; best = r.expiresAt }
  }
  return best
}

/** How often a countdown has to re-render to stay honest: a minute normally,
 *  ten seconds once the last ten minutes are showing. */
export function tickFor(expiresAt?: string | number | null): number {
  return msLeft(expiresAt) < 10 * 60 * 1000 ? 10000 : 60000
}

/* One cached formatter, built on first use. Every `toLocaleDateString` call
   that carries an options bag constructs a fresh Intl.DateTimeFormat inside —
   on Hermes that is a full ICU pattern resolution, an order of magnitude
   dearer than formatting through an instance that already exists. This one
   runs once per highlight cell per render. */
let SHORT_DATE: Intl.DateTimeFormat | null = null

/** "2 May" — a highlight cell's date chip. */
export function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (!SHORT_DATE) SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
  return SHORT_DATE.format(d)
}

/* ---------------------------------------------------------
   Playback
   --------------------------------------------------------- */

/** A still holds for five seconds. */
export const STILL_MS = 5000
/** Until the player reports a duration, assume a middling clip. */
export const VIDEO_FALLBACK_MS = 15000
export const VIDEO_MIN_MS = 1000
export const VIDEO_MAX_MS = 30000

export function clampVideoMs(seconds?: number | null): number {
  const ms = Number(seconds) * 1000
  if (!Number.isFinite(ms) || ms <= 0) return VIDEO_FALLBACK_MS
  return Math.min(VIDEO_MAX_MS, Math.max(VIDEO_MIN_MS, ms))
}
