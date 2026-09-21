/* =========================================================
   The notification / activity domain's lookup tables.

   Two rules govern everything in this file:

   1. A glyph and a tint are the ONLY things the client is
      allowed to derive from a `type`. Title, body, label and
      subtitle are composed server-side (already carrying "and
      N others"), so there is no enum→copy map here and there
      must never be one.
   2. Every map falls through. The backend adds enum values
      without a client release, so an unknown type resolves to
      the generic bell rather than crashing a row.

   The one place copy IS keyed by type is the type-filter
   sheet, which needs a human label for a checkbox. Those come
   from NOTIFICATION_GROUPS in '@/api' wherever the settings
   matrix already names them; only the handful that export
   omits is spelled out here.
   ========================================================= */
import { NOTIFICATION_GROUPS } from '@/api'
import type { IconName } from '@/ui'
import type { Palette } from '@/theme/colors'

export type KindTone = 'accent' | 'scholar' | 'success' | 'warning' | 'danger' | 'neutral'

export interface Kind { icon: IconName; tone: KindTone }

/** Foreground + background pair for a tinted glyph tile or badge. */
export function toneColors(c: Palette, tone: KindTone): { fg: string; soft: string } {
  switch (tone) {
    case 'scholar': return { fg: c.scholar, soft: c.scholarSoft }
    case 'success': return { fg: c.success, soft: c.successSoft }
    case 'warning': return { fg: c.warning, soft: c.warningSoft }
    case 'danger': return { fg: c.danger, soft: c.dangerSoft }
    case 'neutral': return { fg: c.textMuted, soft: c.surfaceSunken }
    default: return { fg: c.accent, soft: c.accentSoft }
  }
}

const FALLBACK_KIND: Kind = { icon: 'bell', tone: 'neutral' }

export const NOTIF_ICONS: Record<string, Kind> = {
  /* Posts & reels */
  POST_NEW: { icon: 'sparkle', tone: 'accent' },
  POST_REACTED: { icon: 'heart', tone: 'danger' },
  POST_COMMENTED: { icon: 'comment', tone: 'accent' },
  POST_COMMENT_REPLIED: { icon: 'reply', tone: 'accent' },
  POST_COMMENT_REACTED: { icon: 'heart', tone: 'danger' },
  POST_SHARED: { icon: 'share', tone: 'success' },
  POST_MENTIONED: { icon: 'at', tone: 'accent' },

  /* Q&A */
  QUESTION_NEW: { icon: 'qna', tone: 'scholar' },
  QUESTION_ANSWERED: { icon: 'comment', tone: 'scholar' },
  ANSWER_REPLIED: { icon: 'reply', tone: 'scholar' },
  ANSWER_REACTED: { icon: 'heart', tone: 'danger' },
  ANSWER_ACCEPTED: { icon: 'checkCircle', tone: 'success' },

  /* Research */
  PUBLICATION_LIKED: { icon: 'heart', tone: 'danger' },
  PUBLICATION_COMMENTED: { icon: 'comment', tone: 'scholar' },
  PUBLICATION_COMMENT_REACTED: { icon: 'heart', tone: 'danger' },
  PUBLICATION_CITED: { icon: 'cite', tone: 'scholar' },
  RESEARCH_CONTRIBUTOR_ADDED: { icon: 'personAdd', tone: 'scholar' },

  /* Mentions */
  USER_MENTIONED: { icon: 'at', tone: 'accent' },
  MESSAGE_MENTION: { icon: 'at', tone: 'accent' },

  /* Social */
  NEW_FOLLOWER: { icon: 'personAdd', tone: 'accent' },
  CONNECTION_REQUEST: { icon: 'personAdd', tone: 'accent' },
  CONNECTION_ACCEPTED: { icon: 'checkCircle', tone: 'success' },
  UNFOLLOWED: { icon: 'personRemove', tone: 'neutral' },
  BLOCKED: { icon: 'block', tone: 'danger' },
  UNBLOCKED: { icon: 'checkCircle', tone: 'success' },
  RESTRICTED: { icon: 'shield', tone: 'warning' },
  STREAM_STARTED: { icon: 'live', tone: 'danger' },

  /* Chat & channels */
  NEW_MESSAGE: { icon: 'chat', tone: 'accent' },
  MESSAGE_REQUEST: { icon: 'mail', tone: 'accent' },
  ADDED_TO_GROUP: { icon: 'people', tone: 'accent' },
  CALL_MISSED: { icon: 'callEnd', tone: 'danger' },
  CHANNEL_NEW_POST: { icon: 'channels', tone: 'accent' },
  CHANNEL_JOIN_REQUEST: { icon: 'personAdd', tone: 'accent' },
  CHANNEL_JOIN_APPROVED: { icon: 'checkCircle', tone: 'success' },

  /* System */
  SYSTEM_MESSAGE: { icon: 'info', tone: 'neutral' },
  SYSTEM_ANNOUNCEMENT: { icon: 'broadcast', tone: 'accent' },
  ACCOUNT_WARNING: { icon: 'warning', tone: 'warning' },
  TRENDING_DIGEST: { icon: 'trending', tone: 'scholar' },

  /* Uncategorized (category: null on the wire) */
  STORY_PUBLISHED: { icon: 'sparkle', tone: 'accent' },
  STORY_REACTED: { icon: 'heart', tone: 'danger' },
  STORY_REPLIED: { icon: 'reply', tone: 'accent' },
  SOUND_APPROVED: { icon: 'music', tone: 'success' },
}

/** The three moderation SYSTEM_MESSAGE variants moderationKindOf() detects. */
export const MODERATION_KINDS: Record<string, Kind> = {
  removed: { icon: 'block', tone: 'danger' },
  review: { icon: 'clock', tone: 'warning' },
  live: { icon: 'shield', tone: 'success' },
}

export function kindOf(type: string | null | undefined, moderation?: string | null): Kind {
  if (moderation && MODERATION_KINDS[moderation]) return MODERATION_KINDS[moderation]
  return (type && NOTIF_ICONS[type]) || FALLBACK_KIND
}

/* ---------------------------------------------------------
   Inbox chips.

   `category` chips hit ?category=; `types` chips hit ?type=.
   The split is not cosmetic — the ?category= enum only
   enumerates six values, so Chat and Other MUST be type
   arrays, and "Mark {category} as read" is offered for the
   six alone.
   --------------------------------------------------------- */

export const CHAT_TYPES = [
  'NEW_MESSAGE', 'MESSAGE_REQUEST', 'ADDED_TO_GROUP', 'CALL_MISSED',
  'CHANNEL_NEW_POST', 'CHANNEL_JOIN_REQUEST', 'CHANNEL_JOIN_APPROVED',
]

/** The six kinds that come back with `category: null` — unreachable any other way. */
export const UNCATEGORIZED_TYPES = [
  'STORY_PUBLISHED', 'STORY_REACTED', 'STORY_REPLIED', 'SOUND_APPROVED',
  'PUBLICATION_COMMENT_REACTED', 'RESEARCH_CONTRIBUTOR_ADDED',
]

export interface InboxTab { key: string; label: string; category?: string; types?: string[] }

export const INBOX_TABS: InboxTab[] = [
  { key: 'all', label: 'All' },
  { key: 'POSTS', label: 'Posts', category: 'POSTS' },
  { key: 'MENTIONS', label: 'Mentions', category: 'MENTIONS' },
  { key: 'QNA', label: 'Q&A', category: 'QNA' },
  { key: 'RESEARCH', label: 'Research', category: 'RESEARCH' },
  { key: 'SOCIAL', label: 'Social', category: 'SOCIAL' },
  { key: 'CHAT', label: 'Chat', types: CHAT_TYPES },
  { key: 'SYSTEM', label: 'System', category: 'SYSTEM' },
  { key: 'OTHER', label: 'Other', types: UNCATEGORIZED_TYPES },
]

/** The six values `?category=` and `/category/{c}/read` actually accept. */
export const SERVER_CATEGORIES = INBOX_TABS.filter(t => t.category).map(t => t.category!)

/* ---------------------------------------------------------
   Type-filter catalogue.

   Labels come from the settings matrix export where it has
   them (38 of 43 kinds); the five it deliberately leaves out
   plus POST_MENTIONED are named here.
   --------------------------------------------------------- */

const MATRIX_LABELS: Record<string, string> = Object.fromEntries(
  NOTIFICATION_GROUPS.flatMap((g: any) => g.rows as [string, string][]),
)

const EXTRA_LABELS: Record<string, string> = {
  POST_MENTIONED: 'Mentions in posts (legacy)',
  UNBLOCKED: 'You were unblocked',
  UNFOLLOWED: 'Someone unfollowed you',
  BLOCKED: 'You were blocked',
  RESTRICTED: 'Your account was restricted',
}

export function typeLabel(type: string): string {
  return MATRIX_LABELS[type] || EXTRA_LABELS[type] || humanise(type)
}

/** Last-resort label for an enum value shipped after this build. */
function humanise(v: string): string {
  const s = String(v).toLowerCase().replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface TypeSection { key: string; title: string; types: string[]; footer?: string }

export const NOTIF_TYPE_SECTIONS: TypeSection[] = [
  {
    key: 'POSTS',
    title: 'Posts',
    types: [
      'POST_NEW', 'POST_REACTED', 'POST_COMMENTED', 'POST_COMMENT_REPLIED',
      'POST_COMMENT_REACTED', 'POST_SHARED', 'POST_MENTIONED',
    ],
  },
  { key: 'QNA', title: 'Q&A', types: ['QUESTION_NEW', 'QUESTION_ANSWERED', 'ANSWER_REPLIED', 'ANSWER_REACTED', 'ANSWER_ACCEPTED'] },
  { key: 'RESEARCH', title: 'Research', types: ['PUBLICATION_LIKED', 'PUBLICATION_COMMENTED', 'PUBLICATION_CITED'] },
  { key: 'MENTIONS', title: 'Mentions', types: ['USER_MENTIONED', 'MESSAGE_MENTION'] },
  { key: 'SOCIAL', title: 'Social', types: ['NEW_FOLLOWER', 'UNBLOCKED', 'STREAM_STARTED'] },
  { key: 'CHAT', title: 'Chat', types: CHAT_TYPES },
  { key: 'SYSTEM', title: 'System', types: ['SYSTEM_MESSAGE', 'SYSTEM_ANNOUNCEMENT', 'ACCOUNT_WARNING', 'TRENDING_DIGEST'] },
  {
    key: 'OTHER',
    title: 'Other',
    types: UNCATEGORIZED_TYPES,
    footer: 'These kinds have no inbox category — a type filter is the only way to see them on their own.',
  },
]

/* ---------------------------------------------------------
   Activity history.
   --------------------------------------------------------- */

export const ACTIVITY_ICONS: Record<string, Kind> = {
  POST_CREATED: { icon: 'edit', tone: 'accent' },
  POST_REACTION: { icon: 'heart', tone: 'danger' },
  POST_COMMENT: { icon: 'comment', tone: 'accent' },
  POST_COMMENT_REACTION: { icon: 'heart', tone: 'danger' },
  POST_SHARE: { icon: 'share', tone: 'success' },
  POST_SAVED: { icon: 'bookmark', tone: 'accent' },
  REEL_WATCH: { icon: 'reels', tone: 'accent' },
  GLOBAL_SEARCH: { icon: 'search', tone: 'neutral' },
  HASHTAG_SEARCH: { icon: 'hash', tone: 'neutral' },
  MENTION_LOOKUP: { icon: 'at', tone: 'neutral' },
  USER_MENTIONED: { icon: 'at', tone: 'accent' },
  PROFILE_VIEW: { icon: 'eye', tone: 'neutral' },
  FOLLOWED_USER: { icon: 'personAdd', tone: 'accent' },
  QNA_QUESTION_CREATED: { icon: 'qna', tone: 'scholar' },
  QNA_QUESTION_SAVED: { icon: 'bookmark', tone: 'scholar' },
  QNA_ANSWER_CREATED: { icon: 'comment', tone: 'scholar' },
  QNA_REANSWER_CREATED: { icon: 'reply', tone: 'scholar' },
  QNA_ANSWER_REACTION: { icon: 'heart', tone: 'danger' },
  QNA_ANSWER_FEEDBACK: { icon: 'star', tone: 'scholar' },
  RESEARCH_PUBLISHED: { icon: 'research', tone: 'scholar' },
  RESEARCH_SAVED: { icon: 'bookmark', tone: 'scholar' },
  RESEARCH_REACTION: { icon: 'heart', tone: 'danger' },
  RESEARCH_COMMENT: { icon: 'edit', tone: 'scholar' },
  RESEARCH_COMMENT_REACTION: { icon: 'heart', tone: 'danger' },
  STORY_VIEWED: { icon: 'eye', tone: 'neutral' },
  STORY_REACTED: { icon: 'heart', tone: 'danger' },
  STORY_REPLIED: { icon: 'reply', tone: 'accent' },
  STORY_POLL_VOTED: { icon: 'poll', tone: 'accent' },
  SOUND_USED: { icon: 'music', tone: 'success' },
}

const ACTIVITY_FALLBACK: Kind = { icon: 'history', tone: 'neutral' }

export function activityKindOf(type: string | null | undefined): Kind {
  return (type && ACTIVITY_ICONS[type]) || ACTIVITY_FALLBACK
}

export interface ActivityGroup { key: string; label: string; types: string[] }

/** The rail's group chips. Each is one `types` array — every entry is a
 *  separate Cassandra partition scan k-way merged server-side, so these stay
 *  deliberately narrow. */
export const ACTIVITY_GROUPS: ActivityGroup[] = [
  { key: 'all', label: 'All', types: [] },
  { key: 'posts', label: 'Posts', types: ['POST_CREATED', 'POST_REACTION', 'POST_COMMENT', 'POST_COMMENT_REACTION', 'POST_SHARE', 'POST_SAVED', 'REEL_WATCH'] },
  { key: 'discovery', label: 'Discovery', types: ['GLOBAL_SEARCH', 'HASHTAG_SEARCH', 'MENTION_LOOKUP', 'USER_MENTIONED', 'PROFILE_VIEW', 'FOLLOWED_USER'] },
  { key: 'qna', label: 'Q&A', types: ['QNA_QUESTION_CREATED', 'QNA_QUESTION_SAVED', 'QNA_ANSWER_CREATED', 'QNA_REANSWER_CREATED', 'QNA_ANSWER_REACTION', 'QNA_ANSWER_FEEDBACK'] },
  { key: 'research', label: 'Research', types: ['RESEARCH_PUBLISHED', 'RESEARCH_SAVED', 'RESEARCH_REACTION', 'RESEARCH_COMMENT', 'RESEARCH_COMMENT_REACTION'] },
  { key: 'stories', label: 'Stories', types: ['STORY_VIEWED', 'STORY_REACTED', 'STORY_REPLIED', 'STORY_POLL_VOTED'] },
  { key: 'sounds', label: 'Sounds', types: ['SOUND_USED'] },
]

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  POST_CREATED: 'Posts you created',
  POST_REACTION: 'Reactions you gave',
  POST_COMMENT: 'Comments you wrote',
  POST_COMMENT_REACTION: 'Comment reactions',
  POST_SHARE: 'Posts you shared',
  POST_SAVED: 'Posts you saved',
  REEL_WATCH: 'Reels you watched',
  GLOBAL_SEARCH: 'Searches',
  HASHTAG_SEARCH: 'Hashtag searches',
  MENTION_LOOKUP: 'Mention lookups',
  USER_MENTIONED: 'Mentions of you',
  PROFILE_VIEW: 'Profiles you viewed',
  FOLLOWED_USER: 'People you followed',
  QNA_QUESTION_CREATED: 'Questions you asked',
  QNA_QUESTION_SAVED: 'Questions you saved',
  QNA_ANSWER_CREATED: 'Answers you wrote',
  QNA_REANSWER_CREATED: 'Re-answers',
  QNA_ANSWER_REACTION: 'Answer reactions',
  QNA_ANSWER_FEEDBACK: 'Answer feedback',
  RESEARCH_PUBLISHED: 'Papers you published',
  RESEARCH_SAVED: 'Papers you saved',
  RESEARCH_REACTION: 'Paper reactions',
  RESEARCH_COMMENT: 'Paper comments',
  RESEARCH_COMMENT_REACTION: 'Paper comment reactions',
  STORY_VIEWED: 'Stories you viewed',
  STORY_REACTED: 'Story reactions',
  STORY_REPLIED: 'Story replies',
  STORY_POLL_VOTED: 'Story poll votes',
  SOUND_USED: 'Sounds you used',
}

export function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABELS[type] || humanise(type)
}

/* The filter modal's sections — the group rail minus 'All'. */
export const ACTIVITY_TYPE_SECTIONS = ACTIVITY_GROUPS.filter(g => g.types.length)

/* ---------------------------------------------------------
   Date bucketing for the inbox's sticky headers. The activity
   list uses the server's own `formattedDate`, so this is only
   ever fed notification rows.
   --------------------------------------------------------- */

export function dateBucket(iso: string | null | undefined): string {
  if (!iso) return 'Earlier'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000)

  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  return 'Earlier'
}

/** 'Jul 19, 2026' — only used when a streamed activity row arrives without the
 *  server's pre-rendered `formattedDate`. */
export function localDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** 137 → '2:17'. Watched-seconds and durations only. */
export function clockTime(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
