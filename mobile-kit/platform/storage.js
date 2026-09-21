/* =========================================================
   storage — a SYNCHRONOUS key-value store for React Native
   ---------------------------------------------------------
   THIS IS THE MOST IMPORTANT SHIM IN THE KIT. Read the why.

   `session.getToken()` in api/config.js is called synchronously
   from inside `request()` on EVERY http call, and again on every
   SSE reconnect. AsyncStorage is promise-based; adopting it would
   force `getToken` to become async, which forces `request` to be
   restructured, which ripples into all 29 api modules.

   react-native-mmkv is synchronous (JSI-backed), so it drops in
   with the SAME signature localStorage had and NOTHING downstream
   changes. Use it.

     npm i react-native-mmkv        (bare RN: cd ios && pod install)

   Expo Go cannot load MMKV (it needs native code) — use a dev
   build, or fall back to the async-hydrated shim at the bottom.
   ========================================================= */
import { MMKV } from 'react-native-mmkv'

const mmkv = new MMKV({ id: 'ika' })

/** Same three methods localStorage exposed, same sync contract.
 *  Every `localStorage.X(...)` in the copied source becomes `storage.X(...)`. */
export const storage = {
  getItem(key) {
    const v = mmkv.getString(key)
    return v === undefined ? null : v     // localStorage returns null for a miss, not undefined
  },
  setItem(key, value) { mmkv.set(key, String(value)) },
  removeItem(key) { mmkv.delete(key) },
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
   SECURE storage for the two credentials.

   MMKV is fast but is NOT the keychain. The access token and the
   refresh token belong in react-native-keychain / expo-secure-store.
   The catch: those are async, so they cannot back `getToken()`.

   The resolution used by the kit: keep the ACCESS token in MMKV
   (it is short-lived — one hour — and rotates), and keep the
   REFRESH token in the keychain, read only inside `doRefresh()`
   which is already async. See platform/session.js.
   --------------------------------------------------------- */
