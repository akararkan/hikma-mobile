/* =========================================================
   env — the React Native stand-in for `import.meta.env`
   ---------------------------------------------------------
   `import.meta.env` is a Vite compile-time substitution. Metro
   does not perform it, so every `import.meta.env.X` in the
   copied source is either a syntax error or `undefined` at
   runtime. Ten call sites depend on it (config.js, http.js,
   mock/flag.js, lib/version.js, CallContext.jsx, two settings
   panels) — they all get rewritten to read from HERE.

   Fill these from react-native-config / expo-constants /
   babel-plugin-inline-dotenv, whichever the app already uses.
   The defaults below are the ones the web app ships with.
   ========================================================= */

/* The backend origin. UNLIKE the web app there is no "empty means
   relative" mode: a native app has no origin to be relative TO, so
   this must always be an absolute URL. */
export const API_BASE_URL = 'https://irc-bakend-production.up.railway.app'

/* Mock mode — the whole app off src/mock/data.json, no backend. */
export const USE_MOCK = false
export const MOCK_LANG = 'en'          // en | ar | ku | tr
export const MOCK_DELAY_MS = 220

/* Sent with consent writes and read by the version gate. */
export const APP_VERSION = '1.0.0'
export const APP_BUILD = ''

/* WebRTC ICE servers for calls/live (CallContext.jsx).
   JSON array of RTCIceServer objects, or empty for STUN-only defaults. */
export const ICE_SERVERS = ''

/* Web Push VAPID key — WEB ONLY. On native, push is APNs/FCM via
   Notifee or expo-notifications; the notification-settings panel must
   register a device token instead of a PushSubscription. */
export const VAPID_PUBLIC_KEY = ''
