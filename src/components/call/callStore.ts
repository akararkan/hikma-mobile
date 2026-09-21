/* =========================================================
   Two module-level stores the call domain cannot live without.

   1. THE ACTIVE CALL. "Minimize" pops the route but keeps the
      call alive, so the call's identity has to outlive its
      screen. React state cannot do that — the screen is gone —
      so it lives here and `ActiveCallBar` reads it.

   2. THE LOCAL CALL LOG. There is NO server endpoint for a
      user's call history (only the admin one), so /calls is a
      merge of CALL_MISSED notifications and this device-local
      log, written on every `call.ended` and every successful
      `calls.start`. It is per-device and the screen says so.

   Plus the inbound `call.signal` buffer. The relay does not
   wait for the call screen: an OFFER can land before the
   engine has finished opening the microphone, and dropping it
   stalls the connection until something else forces a
   renegotiation. So early frames queue here, bounded, and the
   engine drains them the moment its capture is up. They are
   never logged — payloads are opaque and can be large.
   ========================================================= */
import { storage } from '@/platform/storage'
import type { Call, CallSignal, CallType } from './types'

/* ---------------------------------------------------------
   Active call
   --------------------------------------------------------- */

export interface ActiveCall {
  callId: string
  conversationId: string | null
  title: string
  type: CallType
  status: Call['status']
  answeredAt: string | null
  startedAt: string | null
}

let active: ActiveCall | null = null
const activeSubs = new Set<(c: ActiveCall | null) => void>()

/* READ SIDE, honestly labelled: today the call screen is the only writer and
   there is no reader — no ongoing-call banner exists yet. get/subscribe are
   the seam that banner will attach to, so they stay; `patchActiveCall` did
   not, because it was one line of sugar over setActiveCall that nothing ever
   reached for. Do not add a third way to write this. */
export function getActiveCall(): ActiveCall | null { return active }

export function setActiveCall(next: ActiveCall | null) {
  active = next
  for (const fn of [...activeSubs]) {
    try { fn(active) } catch { /* one broken subscriber must not starve the rest */ }
  }
}

export function clearActiveCall(callId?: string) {
  if (callId && active && active.callId !== callId) return
  setActiveCall(null)
}

export function subscribeActiveCall(fn: (c: ActiveCall | null) => void): () => void {
  activeSubs.add(fn)
  return () => { activeSubs.delete(fn) }
}

/* ---------------------------------------------------------
   Device-local call log
   --------------------------------------------------------- */

const LOG_KEY = 'ika_call_log'
const LOG_CAP = 200

export interface CallLogEntry {
  callId: string
  conversationId: string | null
  peerId: string | null
  type: CallType
  direction: 'IN' | 'OUT'
  status: Call['status']
  startedAt: string | null
  answeredAt: string | null
  endedAt: string | null
}

export function readCallLog(): CallLogEntry[] {
  try {
    const raw = storage.getItem(LOG_KEY)
    if (!raw) return []
    const rows = JSON.parse(raw)
    return Array.isArray(rows) ? rows.filter(r => r && r.callId) : []
  } catch {
    /* A corrupt blob is not worth a crash on a history screen. */
    return []
  }
}

function writeCallLog(rows: CallLogEntry[]) {
  try { storage.setItem(LOG_KEY, JSON.stringify(rows.slice(0, LOG_CAP))) } catch { /* full disk */ }
}

/** Upsert by callId, newest first. A ring row written on `start` is later
 *  completed in place by the `call.ended` row rather than duplicated. */
export function appendCallLog(entry: CallLogEntry): CallLogEntry[] {
  const rows = readCallLog()
  const prev = rows.find(r => r.callId === entry.callId)
  const merged: CallLogEntry = prev ? { ...prev, ...entry } : entry
  const next = [merged, ...rows.filter(r => r.callId !== entry.callId)]
  writeCallLog(next)
  return next
}

/** Upsert MANY at once — one read, one write. Folding a page of missed-call
 *  notifications in row by row would be a storage round trip each. */
export function mergeCallLog(entries: CallLogEntry[]): CallLogEntry[] {
  if (!entries.length) return readCallLog()
  const byId = new Map<string, CallLogEntry>()
  for (const r of readCallLog()) byId.set(r.callId, r)
  for (const e of entries) {
    if (!e?.callId) continue
    const prev = byId.get(e.callId)
    byId.set(e.callId, prev ? { ...prev, ...e } : e)
  }
  const next = [...byId.values()].sort((a, b) => atOf(b) - atOf(a))
  writeCallLog(next)
  return next
}

export function removeCallLog(callId: string): CallLogEntry[] {
  const next = readCallLog().filter(r => r.callId !== callId)
  writeCallLog(next)
  return next
}

/** Terminal outcomes only — a RINGING/ONGOING row left by a crash is not a
 *  session and must not render as one in the timeline. */
const TERMINAL_CALLS = new Set(['ENDED', 'DECLINED', 'CANCELLED', 'MISSED'])

export function isTerminalCall(status: string | null | undefined): boolean {
  return !!status && TERMINAL_CALLS.has(status)
}

function atOf(r: CallLogEntry): number {
  const ms = Date.parse(r.endedAt || r.startedAt || '')
  return Number.isFinite(ms) ? ms : 0
}

/** One conversation's finished calls, ASCENDING by time — the order the
 *  thread timeline merges them in. Sorted rather than reversed: `append`
 *  head-inserts by arrival, so a late-arriving row for an earlier call
 *  (a missed one folded in from its notification) would otherwise land in
 *  the timeline at the wrong minute. */
export function callLogForConvo(convId: string): CallLogEntry[] {
  const key = String(convId)
  return readCallLog()
    .filter(r => r.conversationId != null && String(r.conversationId) === key && TERMINAL_CALLS.has(r.status))
    .sort((a, b) => atOf(a) - atOf(b))
}

/** conversationId → its NEWEST finished call. One pass over the log, so the
 *  inbox stamps a whole page of rows for the price of a single read. */
export function latestCallByConvo(): Map<string, CallLogEntry> {
  const out = new Map<string, CallLogEntry>()
  for (const r of readCallLog()) {
    if (r.conversationId == null || !TERMINAL_CALLS.has(r.status)) continue
    const key = String(r.conversationId)
    const held = out.get(key)
    if (!held || atOf(r) > atOf(held)) out.set(key, r)
  }
  return out
}

export function latestCallForConvo(convId: string): CallLogEntry | null {
  const key = String(convId)
  let best: CallLogEntry | null = null
  for (const r of readCallLog()) {
    if (r.conversationId == null || String(r.conversationId) !== key) continue
    if (!TERMINAL_CALLS.has(r.status)) continue
    if (!best || atOf(r) > atOf(best)) best = r
  }
  return best
}

/** Fold an adapted call into a log row. `meId` decides the direction. */
export function logFromCall(
  call: Call,
  meId: string | null | undefined,
  direction?: 'IN' | 'OUT',
): CallLogEntry {
  const dir = direction ?? (meId && String(call.initiatorId) === String(meId) ? 'OUT' : 'IN')
  const peer = dir === 'OUT'
    ? call.participants.find(p => String(p.userId) !== String(meId ?? ''))?.userId ?? null
    : call.initiatorId
  return {
    callId: String(call.id),
    conversationId: call.conversationId ? String(call.conversationId) : null,
    peerId: peer ? String(peer) : null,
    type: call.type,
    direction: dir,
    status: call.status,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
  }
}

/** CALL_MISSED notification → log row.
 *
 *  The device-local log only records what this device WATCHED happen, so a
 *  call missed while the app was closed left no trace anywhere in chat — the
 *  one case where the trace matters most. The server does keep that one as a
 *  notification, so it is folded back into the log and every call surface
 *  (thread card, rail preview, /calls) picks it up from there.
 *
 *  The notification carries no call id, hence the `n:` synthetic one; /calls
 *  still collapses the pair by {conversation, minute} when both exist. */
export function logFromMissedNotification(n: any): CallLogEntry | null {
  if (!n?.id) return null
  const convId = n.resourceType === 'Conversation' && n.resourceId ? String(n.resourceId) : null
  if (!convId) return null
  const at = n.createdAt || null
  return {
    callId: `n:${n.id}`,
    conversationId: convId,
    peerId: n._actor?.id ? String(n._actor.id) : null,
    /* The body names the kind ("You missed a video call from @x"). */
    type: /video/i.test(String(n.body || '')) ? 'VIDEO' : 'VOICE',
    direction: 'IN',
    status: 'MISSED',
    startedAt: at,
    answeredAt: null,
    endedAt: at,
  }
}

/* ---------------------------------------------------------
   Inbound signalling buffer
   --------------------------------------------------------- */

const SIGNAL_CAP = 100
const signals: CallSignal[] = []

/** Buffer one relayed frame. Returns false when the queue is full — the drop
 *  is deliberate: an unbounded queue on a socket nobody drains is a leak. */
export function bufferSignal(signal: CallSignal | null | undefined): boolean {
  if (!signal?.callId) return false
  if (signals.length >= SIGNAL_CAP) return false
  signals.push(signal)
  return true
}

/** Drain everything buffered for one call, in arrival order. The call room
 *  calls this as soon as its engine has a capture to attach the frames to. */
export function takeSignals(callId: string): CallSignal[] {
  const mine = signals.filter(s => String(s.callId) === String(callId))
  for (let i = signals.length - 1; i >= 0; i--) {
    if (String(signals[i].callId) === String(callId)) signals.splice(i, 1)
  }
  return mine
}

export function bufferedSignalCount(): number { return signals.length }
