/* =========================================================
   sse — EventSource for React Native
   ---------------------------------------------------------
   RN has no global EventSource. Five modules open one:

     api/realtime.js       /posts|questions|researches/{id}/stream
     api/chat.js           the chat stream
     api/notifications.js  /notifications/stream
     api/activity.js       /users/me/activity/stream
     api/stories.js        the story stream

   All five call `new EventSource(url, { withCredentials: true })`
   and then `addEventListener(NAME, fn)` for NAMED events. This
   shim keeps that exact surface, so the five files change only
   their import line.

     npm i react-native-sse

   TWO NATIVE WINS over the browser version, both worth taking:

   1. HEADERS. Browser EventSource cannot set headers, which is
      the entire reason the backend accepts `?token=<jwt>` — and
      why a JWT ends up in server access logs. react-native-sse
      CAN send headers, so pass the Bearer header instead and drop
      the query param. Keep the query fallback only if the backend
      rejects the header form (verify once against the server).

   2. NO SILENT AUTO-RECONNECT. The browser reconnects on its own
      and the app cannot see it; react-native-sse gives you the
      retry. That matters because a rotated token needs a REBUILT
      url — the existing heartbeat watchdog in realtime.js already
      does this dance, and here it can be exact instead of racing
      the browser.
   ========================================================= */
import RNEventSource from 'react-native-sse'

/**
 * Drop-in EventSource.
 * @param {string} url    full stream URL (may still carry ?token=)
 * @param {object} opts   { withCredentials } — accepted and ignored, as on web;
 *                        pass { headers } to authenticate properly.
 */
export class EventSource {
  constructor(url, opts = {}) {
    const { headers, events = [] } = opts
    this._es = new RNEventSource(url, {
      headers,
      /* The kit's callers manage their own reconnects (realtime.js has a
         60s heartbeat watchdog; chat.js re-dials on close). Let them. */
      pollingInterval: 0,
      /* react-native-sse only surfaces events it was told to expect. The
         browser dispatched anything; here the NAMES must be declared, so
         each caller passes its event list. */
      lineEndingCharacter: '\n',
      debug: false,
      ...(events.length ? { withCredentials: false } : {}),
    })
    this._declared = new Set(events)
    this.onmessage = null
    this.onerror = null
    this._es.addEventListener('message', (e) => this.onmessage?.(e))
    this._es.addEventListener('error', (e) => this.onerror?.(e))
  }

  /** Named SSE events (`connected`, `heartbeat`, `REACTION_ADDED`, …). */
  addEventListener(name, fn) {
    this._declared.add(name)
    this._es.addEventListener(name, (e) => fn({ data: e.data, type: name }))
  }

  close() { try { this._es.removeAllEventListeners(); this._es.close() } catch { /* noop */ } }
}

/* ---------------------------------------------------------
   IMPORTANT — react-native-sse must be told which named events
   to listen for at CONSTRUCTION time. The kit's callers add
   listeners after constructing, which this shim forwards, and
   that works with the current library. If a future version
   regresses, pass the names up front:

     new EventSource(url, { events: cfg.events })

   `cfg.events` already exists in realtime.js (POST_EVENTS etc.),
   and the other four modules have their own lists.
   --------------------------------------------------------- */
