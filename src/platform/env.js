/* =========================================================
   env — the React Native stand-in for `import.meta.env`
   ---------------------------------------------------------
   `import.meta.env` is a Vite compile-time substitution. Metro
   does not perform it, so every `import.meta.env.X` in the
   copied source is either a syntax error or `undefined` at
   runtime. Every call site is rewritten to read from HERE.

   Expo SDK 57 inlines `process.env.EXPO_PUBLIC_*` at build time
   (the Babel preset substitutes the literal), which is the exact
   equivalent of what Vite did for `VITE_*`. Put overrides in a
   `.env` at the project root; the defaults below are the ones the
   web app ships with, so the app runs with no .env at all.

   NOTE: EXPO_PUBLIC_* values are baked into the bundle and are
   readable by anyone with the app. Nothing secret goes here — the
   web app had the same property.
   ========================================================= */

import { Platform } from 'react-native'

const bool = (v, dflt) => (v == null || v === '' ? dflt : String(v).toLowerCase() === 'true')

/* The backend origin. UNLIKE the web app there is no "empty means
   relative" mode: a native app has no origin to be relative TO, so
   this must always be an absolute URL.

   The backend runs LOCALLY on :8080. `localhost` inside an Android
   emulator is the emulator itself, not the machine running the server —
   10.0.2.2 is the emulator's alias for the host, so a localhost URL is
   rewritten there. A physical device can't use either; it needs the
   machine's LAN IP in `.env`. */
const rawBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8080'
export const API_BASE_URL = Platform.OS === 'android'
  ? rawBaseUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, '$110.0.2.2')
  : rawBaseUrl

/* Mock mode — the whole app off src/mock/data.json, no backend.
   A device-local override lives in storage under `ika_mock` and wins
   over this; see src/mock/flag.js. */
export const USE_MOCK = bool(process.env.EXPO_PUBLIC_USE_MOCK, false)
export const MOCK_LANG = process.env.EXPO_PUBLIC_MOCK_LANG || 'en'   // en | ar | ku | tr
export const MOCK_DELAY_MS = Number(process.env.EXPO_PUBLIC_MOCK_DELAY_MS ?? 220) || 0

/* Sent with consent writes and read by the version gate. Left EMPTY on
   purpose: lib/version.js falls back to expo-constants (app.json `version`),
   which is the number the store actually ships and therefore the one worth
   comparing against the backend's minSupportedVersion. Set this only when a
   release pipeline stamps its own. */
export const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || ''
export const APP_BUILD = process.env.EXPO_PUBLIC_APP_BUILD || ''

/* The WEB app's public origin. A QR code has to be openable by a stranger's
   camera, which means an https link — a custom scheme only resolves on a phone
   that already has the app. lib/qrToken.js paints this; the native app's own
   `ikamobileapp://` deep link is the secondary form. */
export const WEB_ORIGIN =
  (process.env.EXPO_PUBLIC_WEB_ORIGIN || '').replace(/\/$/, '')

/* WebRTC ICE servers for calls/live (CallContext.jsx).
   JSON array of RTCIceServer objects, or empty for STUN-only defaults. */
export const ICE_SERVERS = process.env.EXPO_PUBLIC_ICE_SERVERS || ''

/* Web Push VAPID key — WEB ONLY. On native, push is APNs/FCM via
   expo-notifications; the notification-settings panel must register a
   device token instead of a PushSubscription. Kept so the copied
   settings panel still imports something. */
export const VAPID_PUBLIC_KEY = ''
