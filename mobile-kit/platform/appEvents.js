/* =========================================================
   appEvents — the RN stand-in for window.dispatchEvent
   ---------------------------------------------------------
   The web app used the DOM as a global event bus in a handful of
   places. There is no `window` on native, so those become this
   tiny emitter. Same names, same payloads, so the subscribers
   read almost identically.

   WHO USES IT
     'ika:auth-expired'  http.js endSession()  → AuthContext drops the user
     'ika:prefs'         lib/prefs.js          → chatPrefs / mediaTier invalidate
     'ika:compose'       lib/openCompose.js    → the compose modal opens

   The auth one is load-bearing: it is how a dead session at the
   HTTP layer reaches the navigator without api/ importing UI.
   ========================================================= */

const listeners = new Map()   // name → Set<fn>

/** @returns {() => void} unsubscribe — call it in the effect cleanup. */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name).add(fn)
  return () => off(name, fn)
}

export function off(name, fn) { listeners.get(name)?.delete(fn) }

export function emit(name, detail) {
  /* Fan over a SNAPSHOT: a subscriber is allowed to unsubscribe from
     inside its own handler (AuthContext does exactly that), and one
     broken subscriber must not starve the rest. */
  for (const fn of [...(listeners.get(name) || [])]) {
    try { fn({ type: name, detail }) } catch { /* a broken subscriber is its own problem */ }
  }
}

export const AUTH_EXPIRED = 'ika:auth-expired'
export const PREFS_EVENT = 'ika:prefs'
export const COMPOSE_EVENT = 'ika:compose'
