/* =========================================================
   Chat formatting — the labels every chat surface shares.

   Kept in one file because the same instant is written four
   different ways across the domain (rail label, bubble clock,
   day divider, message-info absolute) and three of those
   appearing on screen at once is normal. One file is what stops
   them drifting into four different date formats.

   NOTHING here calls `toLocale*` with an options bag. Every one
   of those constructs a fresh Intl.DateTimeFormat internally,
   and on Hermes that is ICU pattern resolution — an order of
   magnitude dearer than formatting through a cached instance.
   `clockTime` runs once per visible bubble and `rowTime` once
   per inbox row, so the formatters are built once, lazily, at
   module scope. Same reason `TODAY` caches its day index: a
   `new Date()` per call, forty times a scroll frame, for a
   number that changes at midnight.

   The CAPS also live in the Text primitive now, not here: the
   `caption`/`micro` variants uppercase LATIN ONLY, which is what
   protects Arabic and Kurdish month names. A `.toUpperCase()`
   at this layer would hit every script.
   ========================================================= */

import { shareSnippet, splitShareBody } from '@/lib/shareLinks'

const MS_DAY = 86_400_000

/* Lazily built, then reused forever. `undefined` locale means "the device's",
   which is resolved once at construction instead of on every format call. */
function fmt(options: Intl.DateTimeFormatOptions): () => Intl.DateTimeFormat {
  let cached: Intl.DateTimeFormat | null = null
  return () => (cached ??= new Intl.DateTimeFormat(undefined, options))
}

const CLOCK = fmt({ hour: '2-digit', minute: '2-digit', hour12: false })
const DAY_MONTH = fmt({ day: 'numeric', month: 'short' })
const SHORT_DATE = fmt({ day: '2-digit', month: '2-digit', year: '2-digit' })
const DAY_MONTH_LONG = fmt({ day: 'numeric', month: 'long' })
const DAY_MONTH_YEAR_LONG = fmt({ day: 'numeric', month: 'long', year: 'numeric' })
const DAY_MONTH_YEAR = fmt({ day: 'numeric', month: 'short', year: 'numeric' })
const WEEKDAY_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
const WEEKDAY_SHORT = fmt({ weekday: 'short' })

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Midnight-anchored day index, so "yesterday" means the calendar day, not
 *  "24 hours ago" — a message at 23:50 must not read as today at 00:10. */
function dayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / MS_DAY)
}

/* Today's index, recomputed at most once a minute rather than once per row.
   A thread scrolled across midnight relabels within 60s, which is the same
   latency the old `new Date()` per call had against a screen that was not
   re-rendering anyway. */
let todayIdx = 0
let todayAt = 0
let todayYear = 0
function today(): number {
  const now = Date.now()
  if (now - todayAt > 60_000) {
    const d = new Date(now)
    todayAt = now
    todayIdx = dayIndex(d)
    todayYear = d.getFullYear()
  }
  return todayIdx
}

/** `14:32` — the bubble's meta clock. */
export function clockTime(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? CLOCK().format(d) : ''
}

/** The inbox row's trailing label: clock today, `Yesterday`, then a date. */
export function rowTime(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? rowLabel(d) : ''
}

/** The same label from an epoch stamp. A rail row showing a call already
 *  holds that instant as a number (the call log is parsed once, where it is
 *  stamped onto the conversation) — routing it back through an ISO string
 *  would re-parse it on every render of every visible row. */
export function rowTimeAt(ms: number | null | undefined): string {
  return ms ? rowLabel(new Date(ms)) : ''
}

function rowLabel(d: Date): string {
  const delta = today() - dayIndex(d)
  if (delta <= 0) return CLOCK().format(d)
  if (delta === 1) return 'Yesterday'
  if (delta < 365) return DAY_MONTH().format(d)
  return SHORT_DATE().format(d)
}

/** Stable grouping key for the thread's day dividers. */
export function dayKey(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? String(dayIndex(d)) : ''
}

/** `Today` · `Yesterday` · `12 August` — the divider chip. The chip renders it
 *  in `micro`, which uppercases Latin and leaves Arabic script alone. */
export function dayLabel(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return ''
  const delta = today() - dayIndex(d)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return (d.getFullYear() === todayYear ? DAY_MONTH_LONG() : DAY_MONTH_YEAR_LONG()).format(d)
}

/** `14:32, 12 Aug 2026` — message info, where the exact instant is the point. */
export function absoluteTime(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return ''
  return `${CLOCK().format(d)}, ${DAY_MONTH_YEAR().format(d)}`
}

/** `Friday 21 August` — the scheduled list's sticky headers. */
export function longDayLabel(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return ''
  const delta = dayIndex(d) - today()
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  return WEEKDAY_LONG().format(d)
}

/** `Fri` / `09:00` — the scheduled row's left rail, uppercased by `micro`. */
export function weekdayShort(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? WEEKDAY_SHORT().format(d) : ''
}

/** `0:07` — voice and video durations. Never `00:07`; a message is short. */
export function durationLabel(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** `report-final.pdf` → `PDF`. Falls back to `FILE` so the tile is never blank. */
export function extOf(fileName: string | null | undefined): string {
  const ext = String(fileName || '').split('.').pop()
  return ext && ext.length <= 5 && ext !== fileName ? ext.toUpperCase() : 'FILE'
}

/** Deterministic tile colour per extension, so a folder of PDFs reads as one
 *  kind of thing at a glance. Returns a palette ROLE key, never a hex. */
export function extTone(fileName: string | null | undefined): 'danger' | 'accent' | 'success' | 'warning' | 'scholar' {
  const e = extOf(fileName)
  if (e === 'PDF') return 'danger'
  if (['DOC', 'DOCX', 'RTF', 'TXT', 'MD'].includes(e)) return 'accent'
  if (['XLS', 'XLSX', 'CSV', 'NUMBERS'].includes(e)) return 'success'
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(e)) return 'warning'
  return 'scholar'
}

/* ---------------------------------------------------------
   Typing activities.

   The server sends a verb, not a sentence, and an unknown verb
   is normal — a newer backend can add one at any time. Every
   unrecognised value therefore degrades to plain "typing…"
   rather than rendering the raw enum at the user.
   --------------------------------------------------------- */

const ACTIVITY: Record<string, string> = {
  TYPING: 'typing…',
  RECORDING_VOICE: 'recording a voice message…',
  SENDING_VOICE: 'sending a voice message…',
  SENDING_AUDIO: 'sending audio…',
  SENDING_PHOTO: 'sending a photo…',
  SENDING_VIDEO: 'sending a video…',
  SENDING_FILE: 'sending a file…',
  SENDING_LOCATION: 'sharing a location…',
  CHOOSING_STICKER: 'choosing a sticker…',
  RECORDING_VIDEO_NOTE: 'recording a video message…',
  SENDING_VIDEO_NOTE: 'sending a video message…',
}

export function activityVerb(activity: string | null | undefined): string {
  return ACTIVITY[String(activity || '').toUpperCase()] || ACTIVITY.TYPING
}

export interface Typer { userId: string; activity: string }

/**
 * The subtitle under a conversation title, and the inbox row's preview
 * override. In a group the name carries the information; in a DM it is
 * already in the header, so the verb stands alone.
 */
export function typingSentence(
  typers: Typer[],
  nameOf: (userId: string) => string,
  isGroup: boolean,
): string {
  if (!typers.length) return ''
  if (typers.length > 1) return `${typers.length} people are typing…`
  const [one] = typers
  const verb = activityVerb(one.activity)
  if (!isGroup) return verb
  const name = nameOf(one.userId)
  return name ? `${name} is ${verb}` : verb
}

/** `last seen 4h ago` / `online`. `null` lastSeen is a PRIVACY answer — the
 *  peer hid it — so it must read as nothing rather than as "never". */
export function presenceLine(
  presence: { status: string; lastSeenEpochMs: number | null } | null | undefined,
  visible: boolean,
): string {
  if (!visible || !presence) return ''
  if (presence.status === 'online') return 'online'
  if (presence.lastSeenEpochMs == null) return ''
  const s = Math.max(0, Math.floor((Date.now() - presence.lastSeenEpochMs) / 1000))
  if (s < 60) return 'last seen just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `last seen ${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `last seen ${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `last seen ${d}d ago`
  return `last seen ${DAY_MONTH().format(new Date(presence.lastSeenEpochMs))}`
}

/** `7 days` / `Off` — the disappearing timer, everywhere it is summarised. */
export function disappearingLabel(seconds: number | null | undefined): string {
  const s = Number(seconds) || 0
  if (!s) return 'Off'
  if (s % 86400 === 0) {
    const d = s / 86400
    return d === 1 ? '24 hours' : `${d} days`
  }
  if (s % 3600 === 0) return `${s / 3600} hours`
  return `${Math.round(s / 60)} minutes`
}

/** `Until 18:00` / `Until 12 Aug` — the mute row's trailing value. */
export function muteLabel(mutedUntil: string | null | undefined): string {
  const d = parse(mutedUntil)
  if (!d) return ''
  if (d.getTime() <= Date.now()) return ''
  const delta = dayIndex(d) - today()
  if (delta === 0) return `Until ${CLOCK().format(d)}`
  if (delta > 3650) return 'Always'
  return `Until ${DAY_MONTH().format(d)}`
}

/** A one-line summary of a message for a reply strip, a pin bar or a preview.
 *  Media beats an empty body; a tombstone beats everything. A body that is one
 *  of our share links reads as the share, not as a raw URL — and a type this
 *  build has no renderer for still says SOMETHING, because a blank preview
 *  row reads as a bug. */
export function snippetOf(m: any): string {
  if (!m) return ''
  if (m.deleted) return 'Message deleted'
  if (m.body) {
    const body = String(m.body).replace(/\s+/g, ' ').trim()
    if (!(m.media || []).length) {
      const s = splitShareBody(body)
      if (s) return s.rest ? `${shareSnippet(s.share.kind)} · ${s.rest}` : shareSnippet(s.share.kind)
    }
    return body
  }
  const kind = m.media?.[0]?.kind || m.type
  return ({
    IMAGE: 'Photo',
    VIDEO: 'Video',
    VOICE: 'Voice message',
    FILE: m.media?.[0]?.fileName || 'File',
    LOCATION: 'Location',
    CONTACT: 'Contact',
    POLL: m.poll?.question || 'Poll',
  } as Record<string, string>)[kind] || (m.type ? 'Message' : '')
}
