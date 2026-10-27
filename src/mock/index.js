/* =========================================================
   Mock mode — the whole app, running off one fixture file.
   ---------------------------------------------------------
   WHY IT LIVES HERE, AT THE HTTP FUNNEL

   Every REST call in this app goes through `request()` in
   src/api/http.js. Intercepting there means one switch covers
   every screen, and — this is the part that matters — the
   response still travels the real path: the same adapters, the
   same defensive parsing, the same error envelopes. A fixture
   in the WRONG SHAPE breaks the screen exactly the way a
   backend change would. Mock mode is therefore a rehearsal,
   not a diorama.

   TURNING IT ON
     .env            VITE_USE_MOCK=true
     browser console localStorage.ika_mock = 'on'   (per-device override)
                     localStorage.ika_mock = 'off'  (force real API)
   The localStorage key wins, so one person can demo against
   fixtures while the same build talks to a live server for
   everyone else. Off is the default, and off costs nothing:
   the handlers sit behind a dynamic import inside an
   `if (__DEV__)` in src/api/http.js, which Metro constant-folds
   away before it collects dependencies — so none of this graph
   reaches a release bundle. The corollary: mock mode is a
   DEV-BUILD feature. A shipped build cannot be flipped into it.

   LANGUAGE
     .env            VITE_MOCK_LANG=en | ar | ku | tr
     console         localStorage.ika_mock_lang = 'ar'
   The fixture stores every human string as {en, ar, ku, tr};
   `localize()` collapses it to the chosen language on the way
   out, so the wire looks exactly like a real single-language
   response.

   WHAT IS NOT MOCKED
   Server-sent events (src/api/realtime.js) and presigned media
   PUTs do not pass through `request()`. The realtime layer is
   given a small scripted replay instead — see mockStream().
   ========================================================= */
import { localize } from './util.js'
import { mockEnabled, mockLang, MOCK_DELAY as DELAY } from './flag.js'
/* The REAL notification stream fans notifFrom-ADAPTED rows (unread/_actor/
   deepLink/time) — the mock must speak the same shape or consumers reading
   adapted fields see undefined. No cycle: notifications.js → http.js → flag.js
   only. */
import { notifFrom } from '../api/notifications.js'

export { mockEnabled, mockLang }

/* ---------- the registry ---------- */

/* A miss is `{hit:false}` and a hit is `{hit:true, value}` — a plain object,
   so http.js does not have to import anything just to recognise one. On a miss
   `request()` falls through to the network, and a half-built fixture therefore
   degrades to the real API rather than to a blank screen. */
const MISS = { hit: false }

let loaded = null            // { db, routes } once the handlers are imported

async function load() {
  if (loaded) return loaded
  const [{ default: raw }, handlers] = await Promise.all([
    import('./data.json'),
    import('./handlers/index.js'),
  ])
  /* Collapse the multilingual fixture ONCE per session. Re-localising on every
     request would be pure waste — the language cannot change without a reload. */
  const db = localize(raw, mockLang())
  loaded = { db, routes: handlers.routes }
  if (typeof window !== 'undefined') window.__ikaMockDb = db      // demo escape hatch
  return loaded
}

const wait = (ms) => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve())

/** Resolve one request against the fixture.
 *  `{hit:false}` when nothing matches; handlers may throw `mockError(...)` to
 *  exercise a failure path. */
export async function resolveMock(method, path, opts = {}) {
  const { db, routes } = await load()
  const clean = path.split('?')[0]
  for (const route of routes) {
    if (route.m !== method && route.m !== '*') continue
    const m = route.p.exec(clean)
    if (!m) continue
    await wait(DELAY)
    const ctx = {
      params: m.slice(1).map(v => (v == null ? v : decodeURIComponent(v))),
      query: opts.query || {},
      body: opts.body,
      method,
      path: clean,
      lang: mockLang(),
    }
    const value = route.fn(db, ctx)
    return { hit: true, value: value === undefined ? null : value }
  }
  return MISS
}

export function mockStream(handlers = {}) {
  let stopped = false
  const timers = []
  const at = (ms, fn) => timers.push(setTimeout(() => { if (!stopped) fn() }, ms))

  /* Replay through the REST handler rather than off the raw fixture rows.
     The stored rows are storage shape (they keep age as `minutesAgo`); it is
     the handler that renders them into NotificationResponse with a real
     `createdAt`. Reading the array directly would push rows the adapter can
     only render with a blank timestamp. */
  resolveMock('GET', '/api/v1/notifications', { query: { page: 0, size: 3 } })
    .then((res) => {
      if (stopped || !res?.hit) return
      handlers.onConnected?.()
      const rows = res.value?.content || res.value?.items || []
      rows.slice(0, 3).forEach((n, i) => {
        at(4000 + i * 9000, () => {
          handlers.onNotification?.(notifFrom({ ...n, isRead: false }))
          handlers.onUnreadCount?.(i + 1)
        })
      })
    })
    .catch(() => {})

  return () => { stopped = true; timers.forEach(clearTimeout) }
}
