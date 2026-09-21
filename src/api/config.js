/* =========================================================
   API configuration & session/token storage  (React Native)
   ---------------------------------------------------------
   This is mobile-kit/platform/config.rn.js dropped in over the
   web app's api/config.js. It keeps the EXACT export surface the
   other 27 api modules import (`API_BASE`, `assetUrl`, `session`)
   and changes only what the platform forces:

     · API_BASE is resolved from env, not from location.hostname
       (a native app has no page origin, so "relative /api/…"
       and the localhost-in-a-deployed-build guard both go away).
     · session is backed by MMKV, still SYNCHRONOUS — see
       ../platform/storage.js for why that is non-negotiable.
     · a REFRESH TOKEN slot is added. This is the one genuinely
       NEW piece of state on mobile; the block below explains it.
   ========================================================= */
import { API_BASE_URL } from '../platform/env.js'
import { storage, secureStorage } from '../platform/storage.js'

/* No fallbacks, no proxy mode: a native app must always be handed an
   absolute origin. A trailing slash is stripped so `API_BASE + '/api/v1/…'`
   never produces a double slash. */
export const API_BASE = String(API_BASE_URL || '').replace(/\/$/, '')

/* The backend returns RELATIVE media URLs ("/api/v1/media/…"). On web those
   resolved against the page origin and had to be prefixed; on native there is
   no origin at all, so prefixing is not an optimisation — an unprefixed URL
   simply cannot load in <Image>/<Video>. Absolute/data/blob URLs pass through.

   NOTE: media behind Bearer auth needs the header too. expo-image and
   expo-video both accept `{ uri, headers }` — that lands with step 5. */
export function assetUrl(u) {
  if (!u || /^(https?:|data:|blob:|file:)/i.test(u)) return u
  return API_BASE + (u.startsWith('/') ? u : '/' + u)
}

/* Streaming URLs (WHIP/WHEP/HLS/RTMP ingest) are ABSOLUTE and minted
   server-side from `app.streaming.*`, whose defaults say `localhost` — which
   on a phone is the phone itself, not the machine running MediaMTX. API_BASE
   has already been corrected for this device (env.js rewrites it for the
   emulator; a physical device carries the LAN IP in .env), so a localhost
   media host is re-pointed at API_BASE's host. Scheme, port, path and query
   are the deployment's own and pass through untouched — this rewrites a HOST,
   it never invents an endpoint. */
export function mediaUrl(u) {
  if (!u) return u
  /* The host may be a bracketed IPv6 literal ('http://[::1]:8080') — matched
     whole, brackets included, because the colons inside would otherwise stop
     the capture at '[' and the brackets ARE the correct replacement text. */
  const apiHost = (/^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(API_BASE) || [])[1]
  if (!apiHost) return u
  return u.replace(/^([a-z][a-z0-9+.-]*:\/\/)(localhost|127\.0\.0\.1)(?=[:/?#]|$)/i, `$1${apiHost}`)
}

/* ---------- session ---------- */
const TOKEN_KEY = 'ika_token'
const USER_KEY = 'ika_user'
const REFRESH_KEY = 'ika_refresh'

export const session = {
  getToken() { return storage.getItem(TOKEN_KEY) || '' },
  setToken(t) { t ? storage.setItem(TOKEN_KEY, t) : storage.removeItem(TOKEN_KEY) },
  getUser() {
    try { return JSON.parse(storage.getItem(USER_KEY) || 'null') } catch { return null }
  },
  setUser(u) { u ? storage.setItem(USER_KEY, JSON.stringify(u)) : storage.removeItem(USER_KEY) },

  /* ===== THE MOBILE-ONLY PIECE — read this before changing it =====

     The web app never stored a refresh token. It did not have to: the
     backend sets an HttpOnly cookie, the browser replays it on
     /auth/refresh, and `doRefresh()` sends an empty `{}` body.

     On React Native that cookie is not dependable. RN's fetch ignores
     `credentials: 'include'` and delegates cookies to the native stack
     (NSHTTPCookieStorage / OkHttp CookieJar), which on Android is
     commonly cleared, and on both platforms is not guaranteed to
     survive an app restart. So the tokens ride the DUAL CHANNEL the
     backend documents (auth.md): every AuthResponse ALSO carries the
     pair in the body, this slot keeps the refreshToken, and it is sent
     explicitly:

         POST /auth/refresh  { "refreshToken": "<stored>" }

     Field names verified against the live server (register → refresh
     → rotation → reuse-detection all exercised). ROTATION IS
     MANDATORY server-side: every write path that receives a
     refreshToken must adopt it, because presenting the previous one
     again is treated as theft and revokes EVERY session
     (AUTH_REFRESH_TOKEN_REUSED).

     It lives in the OS keychain (expo-secure-store, sync API), not
     MMKV — it is the long-lived credential. The access token stays in
     MMKV because its getter is on every request's sync hot path. */
  getRefresh() { return secureStorage.getItem(REFRESH_KEY) || '' },
  setRefresh(t) { t ? secureStorage.setItem(REFRESH_KEY, t) : secureStorage.removeItem(REFRESH_KEY) },

  clear() {
    storage.removeItem(TOKEN_KEY)
    storage.removeItem(USER_KEY)
    secureStorage.removeItem(REFRESH_KEY)
  },
  isAuthed() { return !!storage.getItem(TOKEN_KEY) },
}
