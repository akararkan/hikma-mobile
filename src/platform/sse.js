/* =========================================================
   sse — EventSource for React Native
   ---------------------------------------------------------
   RN has no global EventSource. Five modules open one:

     api/realtime.js       /posts|questions|researches/{id}/stream
     api/chat.js           the chat stream
     api/notifications.js  /notifications/stream
     api/activity.js       /users/me/activity/stream
     api/stories.js        the story stream

   All five call `new EventSource(url, { withCredentials: true })`,
   then `addEventListener(NAME, fn)` for NAMED events, and all five
   read `.readyState`, `.onmessage` and `.onerror`. This shim keeps
   that exact surface, so those files change only their import line.

   ---------------------------------------------------------
   THE readyState MAPPING — the part that is not cosmetic.

   Browser EventSource auto-reconnects on a transient error and only
   parks at readyState 2 (CLOSED) when it has given up. Every caller
   here branches on exactly that:

       if (es.readyState !== 2) return      // browser will retry, sit tight
       …otherwise rebuild the URL and re-dial ourselves

   react-native-sse does NOT model it the same way. Its `status` is
   -1 (ERROR) / 0 (CONNECTING) / 1 (OPEN) / 2 (CLOSED), where CLOSED
   means "someone called close()" and an actual connection failure is
   -1. It also does not auto-reconnect at all with pollingInterval 0,
   which is how the kit configures it (the callers run their own
   heartbeat watchdogs).

   So on native there is no such thing as "transient, it will fix
   itself" — every error IS terminal until the caller re-dials. ERROR
   therefore maps to 2, not to -1. Report -1 verbatim and
   `readyState !== 2` is true forever: notifications.js never runs its
   token-refresh heal and stories.js never reconnects. Both fail
   silently, which is the worst way for a stream to fail.

   This is also the native WIN the port is after: a rotated access
   token needs a REBUILT url, and here the caller is guaranteed to be
   the one that rebuilds it, instead of racing a browser that already
   re-dialled with the dead token.
   ---------------------------------------------------------

   STILL ON ?token= — the five callers append the JWT as a query
   param because browser EventSource cannot set headers, and it ends
   up in server access logs. react-native-sse CAN send headers, and
   this shim forwards `{ headers }` for exactly that. Switching the
   callers over is a backend contract change (does /stream accept
   `Authorization: Bearer`?) and is deliberately NOT made here —
   verify against the live server first, then it is a one-line change
   per caller.

     npm i react-native-sse
   ========================================================= */
import RNEventSource from 'react-native-sse'

/* Browser EventSource constants — what the callers compare against. */
const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

/**
 * Drop-in EventSource.
 * @param {string} url    full stream URL (may still carry ?token=)
 * @param {object} opts   { withCredentials } — accepted, as on web;
 *                        pass { headers } to authenticate properly.
 */
export class EventSource {
  constructor(url, opts = {}) {
    const { headers, withCredentials = false } = opts

    this._es = new RNEventSource(url, {
      headers,
      withCredentials,
      /* The kit's callers manage their own reconnects (realtime.js has a
         60s heartbeat watchdog; chat.js and stories.js re-dial on close).
         0 disables the library's own polling so there is exactly one
         reconnect authority. */
      pollingInterval: 0,
      /* Left unset ON PURPOSE so the library auto-detects CRLF vs LF from
         the first frame. Hardcoding '\n' corrupts a \r\n stream: every
         field value keeps a trailing \r and the '\n\n' frame boundary
         never matches. */
      debug: false,
    })

    /* The library honours a `retry:` field from the server by writing it into
       its own poll interval, which quietly re-enables the auto-reconnect that
       pollingInterval:0 turned off — and the chat/notification/post streams
       all send `retry: 3000` at handshake. Re-zeroing it from our own
       open/error listeners is NOT enough: when the server completes the
       emitter cleanly (24h/10min timeouts, LRU eviction) the library calls
       `_pollAgain(this.interval)` WITHOUT dispatching any event a listener
       could veto, then re-dials with the URL captured at construction — i.e.
       the OLD access token. Lock the property instead, so the retry frame can
       never re-arm it: the caller's watchdog stays the ONE reconnect
       authority and every re-dial rebuilds the URL with a fresh token. */
    Object.defineProperty(this._es, 'interval', { get: () => 0, set: () => {} })

    this.onmessage = null
    this.onerror = null
    this.onopen = null

    this._es.addEventListener('open', (e) => this.onopen?.(e))
    this._es.addEventListener('message', (e) => this.onmessage?.(e))
    this._es.addEventListener('error', (e) => this.onerror?.(e))
  }

  /** Browser-compatible: 0 CONNECTING · 1 OPEN · 2 CLOSED.
   *  See the header — the library's ERROR (-1) folds into CLOSED because
   *  with no auto-reconnect there is nothing left to wait for. */
  get readyState() {
    const s = this._es?.status
    if (s === OPEN) return OPEN
    if (s === CONNECTING) return CONNECTING
    return CLOSED                       // CLOSED (2) or ERROR (-1)
  }

  /** Named SSE events (`connected`, `heartbeat`, `REACTION_ADDED`, …).
   *  react-native-sse dispatches on the parsed `event:` field, so names do
   *  not have to be declared up front. */
  addEventListener(name, fn) {
    this._es.addEventListener(name, (e) => fn({ data: e.data, type: name, lastEventId: e.lastEventId ?? null }))
  }

  close() { try { this._es.removeAllEventListeners(); this._es.close() } catch { /* noop */ } }
}
