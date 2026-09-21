/* =========================================================
   storage — a SYNCHRONOUS key-value store for React Native
   ---------------------------------------------------------
   THIS IS THE MOST IMPORTANT SHIM IN THE KIT. Read the why.

   `session.getToken()` in api/config.js is called synchronously
   from inside `request()` on EVERY http call, and again on every
   SSE reconnect. AsyncStorage is promise-based; adopting it would
   force `getToken` to become async, which forces `request` to be
   restructured, which ripples into all 28 api modules.

   react-native-mmkv is synchronous (JSI/Nitro-backed), so it drops
   in with the SAME signature localStorage had and NOTHING
   downstream changes.

   MMKV 4.x is a Nitro module: it needs `react-native-nitro-modules`
   (installed) and native code, so it does NOT run in Expo Go. This
   project uses a development build (`expo-dev-client`) — see the
   README note added with this port.

   v4 ALSO CHANGED THE API, and it changed it invisibly: the `MMKV`
   class is gone, replaced by a `createMMKV()` factory, and
   `instance.delete()` is now `instance.remove()`. `new MMKV(...)`
   against v4 does not fail to import — the named export is simply
   `undefined`, so it throws "undefined cannot be used as a
   constructor" at module scope, which takes down every module that
   transitively imports the API client. This file is JavaScript and
   `checkJs` is off, so nothing catches it before the device does.
   ========================================================= */
import { createMMKV } from 'react-native-mmkv'

const mmkv = createMMKV({ id: 'ika' })

/** Same three methods localStorage exposed, same sync contract.
 *  Every `localStorage.X(...)` in the copied source becomes `storage.X(...)`. */
export const storage = {
  getItem(key) {
    const v = mmkv.getString(key)
    return v === undefined ? null : v     // localStorage returns null for a miss, not undefined
  },
  setItem(key, value) { mmkv.set(key, String(value)) },
  /* v4 renamed `delete` to `remove`. */
  removeItem(key) { mmkv.remove(key) },
  clear() { mmkv.clearAll() },
}

/* `sessionStorage` (http.js parks the sign-out reason for the login
   screen) has no native equivalent and does not need one — this is a
   plain in-memory slot, which is exactly what "clears when the app
   restarts" means on a phone. */
const memory = new Map()
export const sessionStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { memory.set(k, String(v)) },
  removeItem: (k) => { memory.delete(k) },
}

/* ---------------------------------------------------------
   SECURE storage — the refresh token's home (step 2 of the port).

   MMKV is fast but is NOT the keychain. The split: the ACCESS token
   stays in MMKV (short-lived, rotates hourly, and its getter is on
   the synchronous hot path of every request), while the REFRESH
   token — the long-lived credential — lives in the OS keychain via
   expo-secure-store, which has had a SYNCHRONOUS getItem/setItem
   since SDK 51, so the session surface in api/config.js stays sync.

   Every call is wrapped: a keychain refusal (locked device, missing
   entitlement) must degrade to "the session doesn't survive a
   restart", never to a crash on the auth path.
   --------------------------------------------------------- */
import * as SecureStore from 'expo-secure-store'

export const secureStorage = {
  getItem(key) {
    try { return SecureStore.getItem(key) || null } catch { return null }
  },
  setItem(key, value) {
    try { SecureStore.setItem(key, String(value)) } catch { /* degrade: session won't survive restart */ }
  },
  removeItem(key) {
    /* No sync delete in the API — blank it synchronously so a same-tick read
       agrees, then actually delete the keychain entry in the background. */
    try { SecureStore.setItem(key, '') } catch { /* nothing stored */ }
    SecureStore.deleteItemAsync(key).catch(() => {})
  },
}
