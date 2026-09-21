/* =========================================================
   toast — replaces the DOM poke in http.js
   ---------------------------------------------------------
   http.js has a `flashToast()` that reaches for
   `document.getElementById('toast')`. It exists so a 429 shows a
   friendly "slow down" app-wide without api/ importing the UI
   layer (which would be a circular import).

   Same idea here, one indirection instead of the DOM: the UI
   registers a renderer at mount, and http.js calls `flashToast`
   exactly as before. With nothing registered the call is a no-op,
   which keeps api/ importable from tests and background tasks.

   Wire any toast library to it in the root component:

     import { setToastHandler } from './platform/toast.js'
     import Toast from 'react-native-toast-message'
     setToastHandler((msg, tone) => Toast.show({
       type: tone === 'ok' ? 'success' : tone === 'error' ? 'error' : 'info',
       text1: msg,
     }))
   ========================================================= */

let handler = null

export function setToastHandler(fn) { handler = fn }

/** @param tone 'ok' | 'warn' | 'error' — matches the web `t-*` classes. */
export function flashToast(msg, tone = 'warn') {
  if (!handler || !msg) return
  try { handler(String(msg), tone) } catch { /* never let a toast break a request */ }
}
