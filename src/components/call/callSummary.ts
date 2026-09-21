/* =========================================================
   ONE grammar for describing a finished call.

   A call is written down in three places now — the card in the
   thread timeline, the row on /calls, and (since the inbox
   learned about calls) the rail's last-line preview — and the
   server writes no message for any of it. If each surface spelt
   the same session differently, the rail would say one thing and
   the thread another about an event with no server-side record
   to arbitrate between them.

   So the description lives here and the surfaces render it. The
   rule that matters most: the same terminal state reads
   DIFFERENTLY at the two ends — the caller's cancelled call is
   the callee's missed one — so direction is part of the
   description and is never inferred from the status alone.
   ========================================================= */
import type { IconName } from '@/ui'
import type { CallLogEntry } from './callStore'

/** ms → "4:12" / "1:02:11" / "0:07" — the web's callDuration verbatim. */
export function callDuration(ms: number): string {
  const total = Math.max(0, Math.round((ms || 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export type CallTone = 'ok' | 'warn' | 'muted'

export interface CallDescription {
  icon: IconName
  tone: CallTone
  title: string
  detail: string | null
}

/** CallLogEntry → { icon, tone, title, detail } — the web describeCall
 *  grammar mapped onto the mobile log's status+direction shape. */
export function describeCallEntry(e: CallLogEntry): CallDescription {
  const video = e.type === 'VIDEO'
  const kind = video ? 'Video call' : 'Voice call'
  const lower = kind.toLowerCase()
  const out = e.direction === 'OUT'

  if (e.status === 'ENDED' && e.answeredAt) {
    const ms = e.endedAt ? Date.parse(e.endedAt) - Date.parse(e.answeredAt) : 0
    return {
      icon: video ? 'video' : 'call',
      tone: 'ok',
      title: `${out ? 'Outgoing' : 'Incoming'} ${lower}`,
      detail: Number.isFinite(ms) && ms > 0 ? callDuration(ms) : null,
    }
  }
  if (e.status === 'DECLINED') {
    return out
      ? { icon: 'callEnd', tone: 'warn', title: `${kind} declined`, detail: null }
      : { icon: 'callEnd', tone: 'muted', title: `You declined a ${lower}`, detail: null }
  }
  if (e.status === 'CANCELLED') {
    return out
      ? { icon: 'callEnd', tone: 'muted', title: `${kind} cancelled`, detail: null }
      : { icon: 'callEnd', tone: 'warn', title: `Missed ${lower}`, detail: null }
  }
  /* MISSED, and ENDED that never connected: no-answer at the caller's end,
     a missed call at the callee's. */
  return out
    ? { icon: 'call', tone: 'warn', title: `${kind} — no answer`, detail: null }
    : { icon: 'callEnd', tone: 'warn', title: `Missed ${lower}`, detail: null }
}

/** When the call happened — the instant every surface sorts and stamps by. */
export function callAtMs(e: CallLogEntry | null | undefined): number {
  if (!e) return 0
  const ms = Date.parse(e.endedAt || e.startedAt || '')
  return Number.isFinite(ms) ? ms : 0
}

/** True where the row deserves the danger tone: a call that rang at ME and
 *  was never answered. The caller's own rang-out is "no answer", not missed —
 *  same rule the CALL_MISSED bell follows server-side (calls.md). */
export function callWasMissed(e: CallLogEntry | null | undefined): boolean {
  if (!e || e.direction !== 'IN') return false
  return e.status === 'MISSED' || e.status === 'CANCELLED'
    || (e.status === 'ENDED' && !e.answeredAt)
}

/** The inbox rail's single line for a call, in the SERVER's own preview
 *  idiom — its media previews are "📷 Photo" / "🎥 Video", so a call reads
 *  "📞 Missed voice call" and sits in the rail without looking foreign. */
export function callRowPreview(e: CallLogEntry): string {
  const d = describeCallEntry(e)
  const glyph = e.type === 'VIDEO' ? '📹' : '📞'
  return `${glyph} ${d.title}${d.detail ? ` · ${d.detail}` : ''}`
}
