/* =========================================================
   The release stand-in for ./index.js.

   `if (__DEV__)` around the dynamic import is NOT enough to keep
   the fixture out of a release bundle, and it is worth being
   precise about why: Metro's `collectDependencies` pass walks the
   AST and registers every `import()` it sees BEFORE any constant
   folding or dead-code elimination has run. The branch is dropped
   from the emitted code, but the dependency edge is already
   recorded, so `./index.js` — and through it `data.json` (980 KB)
   plus the handlers and their base64 MP4 data URIs — is collected
   into the graph and compiled into the shipped Hermes bytecode.
   Measured: gating alone changed the bundle by -0.2%.

   So the swap happens one level down, in metro.config.js's
   `resolveRequest`, which redirects ./index.js to this file
   whenever Metro is building with dev=false. This module has to
   present the same three-export surface the api layer awaits.

   The cost, stated plainly: a RELEASE build can no longer be
   flipped into mock mode with the `ika_mock` storage key. Mock
   mode is a development and demo affordance, and it still works
   in every dev build, which is where it is used.
   ========================================================= */

/** Always a miss, so `request()` falls straight through to the network. */
export async function resolveMock() {
  return { hit: false }
}

/** The live-chat demo reel — nothing to replay in a release build. */
export async function liveChatFrames() {
  return []
}

/** The fake notification stream — hand back a no-op unsubscribe. */
export function mockStream() {
  return () => {}
}

/* flag.js is tiny and stays in the bundle either way (http.js calls
   mockEnabled() synchronously on every request), so re-export the real
   thing rather than lying about the switch position. */
export { mockEnabled, mockLang } from './flag.js'
