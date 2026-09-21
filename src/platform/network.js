/* =========================================================
   Is this connection metered?

   The one place in the app that touches expo-network, following
   the convention every other shim in this directory keeps: the
   native module is an implementation detail of the platform
   layer, and everything above it asks a question in English.

   The answer is cached and read SYNCHRONOUSLY, because the
   callers are render paths and upload paths that cannot await —
   `prepareUpload` has to decide a compression tier before the
   picker's promise resolves, and a feed row has to decide
   whether to autoplay while it is being laid out.

   FAILS OPEN, on purpose and in the safe direction: an unknown
   network reads as "not metered". A wrong "metered" would
   silently degrade uploads and stop videos for someone on
   wi-fi, with nothing on screen explaining why. A wrong "not
   metered" costs one clip's worth of data. The same rule
   mediaTier.ts states for itself — a bandwidth helper must
   never be the reason something cannot happen.

   WHY THE MODULE IS ASKED FOR THIS WAY. expo-network is a NATIVE
   module: it exists only in a dev client or release build made
   after it was added to package.json. Its entry point is
   `requireNativeModule('ExpoNetwork')`, which THROWS on an older
   binary — so a plain `import` takes this whole module down at
   first touch, and even a try/caught `require` still surfaces the
   throw to LogBox as a red error on every launch.

   `requireOptionalNativeModule` is the same lookup with the throw
   removed: it answers `null` when the module is not in the
   binary. Asking it FIRST means the failing path is never
   entered, so there is nothing to catch and nothing to report —
   the app simply cannot tell wi-fi from mobile data until it is
   rebuilt (`npx expo run:android` / `run:ios`), and says so on
   the media settings screen rather than pretending.

   Copy this shape for any future native-optional dependency.
   ========================================================= */
import { requireOptionalNativeModule } from 'expo-modules-core'

/* Starts optimistic so the very first read, before the probe returns, does
   not throttle anything. */
let metered = false
let started = false
/* null = not looked for yet, false = looked and it is not in this binary. */
let mod = null

function nativeModule() {
  if (mod !== null) return mod || null
  mod = false
  /* The non-throwing lookup, BEFORE the wrapper that would throw. `null` here
     is the ordinary answer on a binary built before expo-network was added. */
  if (!requireOptionalNativeModule('ExpoNetwork')) return null
  try {
    /* Safe now: the native side is present, so the wrapper's own
       requireNativeModule cannot throw. Required rather than imported so the
       check above is what decides, not module evaluation order.
       eslint-disable-next-line @typescript-eslint/no-require-imports */
    mod = require('expo-network')
  } catch {
    /* Bundled oddly, or a version mismatch — stay optimistic. */
    mod = false
  }
  return mod || null
}

function apply(state, Network) {
  /* CELLULAR is the only type the platforms agree is metered. WIFI can be a
     phone hotspot and is billed to someone, but neither OS says so, and
     guessing would break the fail-open rule above. */
  metered = !!state && state.type === Network.NetworkStateType.CELLULAR
}

/** Begin watching. Idempotent; safe to call from app start. Returns an
 *  unsubscribe, and a no-op one when there is nothing to watch. */
export function startNetworkWatch() {
  if (started) return () => {}
  started = true

  const Network = nativeModule()
  if (!Network) return () => {}

  try {
    Network.getNetworkStateAsync().then(s => apply(s, Network)).catch(() => {})
  } catch {
    /* Bundled but unusable — stay optimistic. */
    return () => {}
  }

  let sub = null
  try {
    sub = Network.addNetworkStateListener(s => apply(s, Network))
  } catch {
    /* No listener on this platform — the one-shot read above still gave us a
       usable answer for the session. */
  }
  return () => { try { sub?.remove() } catch { /* already gone */ } }
}

/** The cached answer. Never throws, never blocks. */
export function isMeteredSync() {
  if (!started) startNetworkWatch()
  return metered
}

/** True when this build can actually tell wi-fi from mobile data. The media
 *  settings screen uses it to avoid promising a distinction it cannot make. */
export function canDetectMetered() {
  return !!nativeModule()
}
