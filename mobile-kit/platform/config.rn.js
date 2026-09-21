/* =========================================================
   config.rn.js — DROP-IN REPLACEMENT for src/api/config.js
   ---------------------------------------------------------
   Copy this over api/config.js in the RN project. It keeps the
   exact export surface the other 28 api modules import
   (`API_BASE`, `assetUrl`, `session`) and changes only what the
   platform forces:

     · API_BASE is resolved from env, not from location.hostname
       (a native app has no page origin, so "relative /api/…"
       and the localhost-in-a-deployed-build guard both go away).
     · session is backed by MMKV, still SYNCHRONOUS — see
       platform/storage.js for why that is non-negotiable.
     · a REFRESH TOKEN slot is added. This is the one genuinely
       NEW piece of state on mobile; the block below explains it.
   ========================================================= */
import { API_BASE_URL } from '../platform/env.js'
import { storage } from '../platform/storage.js'

/* No fallbacks, no proxy mode: a native app must always be handed an
   absolute origin. A trailing slash is stripped so `API_BASE + '/api/v1/…'`
   never produces a double slash. */
export const API_BASE = String(API_BASE_URL || '').replace(/\/$/, '')

/* The backend returns RELATIVE media URLs ("/api/v1/media/…"). On web those
   resolved against the page origin and had to be prefixed; on native there is
   no origin at all, so prefixing is not an optimisation — an unprefixed URL
   simply cannot load in <Image>/<Video>. Absolute/data/blob URLs pass through.

   NOTE: media behind Bearer auth needs the header too. react-native-video and
   expo-image both accept `{ uri, headers }` — see the media section of
   PORTING.md. */
export function assetUrl(u) {
  if (!u || /^(https?:|data:|blob:|file:)/i.test(u)) return u
  return API_BASE + (u.startsWith('/') ? u : '/' + u)
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
     survive an app restart. A refresh that quietly stops working
     signs the user out every hour — the single most likely bug in
     this whole port.

     The fix is already available: auth.js documents the tokens as
     DUAL-CHANNEL — "the backend sets HttpOnly cookies AND returns
     accessToken/refreshToken in the body". So store the body's
     refreshToken here and send it explicitly:

         POST /auth/refresh  { "refreshToken": "<stored>" }

     which is the branch `doRefresh()` already alludes to ("refresh
     token comes from the HttpOnly cookie (or this body if present)").
     Verify that field name against the live server ONCE before
     building on it.

     Put this one in the keychain if the app has a threat model that
     asks for it (react-native-keychain / expo-secure-store); it is
     the long-lived credential. The access token can stay in MMKV —
     it is short-lived and the getter must stay synchronous. */
  getRefresh() { return storage.getItem(REFRESH_KEY) || '' },
  setRefresh(t) { t ? storage.setItem(REFRESH_KEY, t) : storage.removeItem(REFRESH_KEY) },

  clear() {
    storage.removeItem(TOKEN_KEY)
    storage.removeItem(USER_KEY)
    storage.removeItem(REFRESH_KEY)
  },
  isAuthed() { return !!storage.getItem(TOKEN_KEY) },
}
