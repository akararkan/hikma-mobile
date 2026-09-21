/* =========================================================
   The splash handshake.

   THERE ARE TWO SPLASH SCREENS on every cold start whether we
   built one or not: the OS one, painted before the JS bundle
   has even been read, and BootGate's, which cannot exist until
   React has mounted. They read as ONE surface only if two
   things hold —

     1. the second is already on screen, pixel-identical to the
        first, BEFORE the first is taken away, and
     2. nothing animates until that swap has happened.

   Neither held before. `hideAsync()` fired on fonts-settled in
   the root layout while BootGate ran its lockup off its own
   mount clock, so on a cold start (seventeen faces to load) the
   whole letter animation played BEHIND the native splash and
   the user got the finished lockup popping in; on a warm one it
   started mid-fade.

   This module is the wire between the two. Nothing else in the
   app calls SplashScreen.hideAsync().
   ========================================================= */
import * as SplashScreen from 'expo-splash-screen'

/** The beat between the OS layer going and the choreography starting.
 *
 *  On iOS it is a real cross-dissolve — `setOptions({ fade })` is iOS-only in
 *  expo-splash-screen 57, which the type declaration says out loud — and it is
 *  short on purpose: the two surfaces underneath it are the same picture, so
 *  it only has to cover the hairline between a raster of the glyph and the
 *  vector of it. On Android the platform dismisses its own splash window and
 *  this is simply a held frame, which is what the move wants in front of it
 *  anyway. Either way nothing may animate inside it. */
export const SPLASH_FADE_MS = 160

/** THE NATIVE MARK'S HEIGHT, IN POINTS — DERIVED, NOT EYEBALLED.
 *
 *  scripts/brand-assets.py draws the glyph's INK BOX at 0.74 of a 1024 canvas
 *  for splash-icon.png, and app.json renders that canvas at `imageWidth: 120`:
 *
 *      1024 × 0.74 × (120 / 1024) = 88.8pt of mark, centred.
 *
 *  Both generated artefacts agree — ios/…/SplashScreenLogo.imageset/image.png
 *  and android/…/drawable-mdpi/splashscreen_logo.png each carry 89pt of glyph
 *  coverage centred to within a third of a point (the difference is the ink
 *  box's nominal bounds versus the drawn curve's). Change either number in
 *  app.json and this one has to move with it, or the handoff jumps again. */
export const NATIVE_MARK_HEIGHT = 1024 * 0.74 * (120 / 1024)

/* ---- 1. the boot surface says it is ready ------------------------------- */

let surfaceReady = false
let releaseSurface: (() => void) | null = null
const surfaceReadyP = new Promise<void>(resolve => { releaseSurface = resolve })

/** BootGate calls this the moment its mark is measured and parked on the
 *  native splash's own geometry — i.e. the frame from which hiding the OS
 *  layer changes nothing on screen. */
export function bootSurfaceReady(): void {
  if (surfaceReady) return
  surfaceReady = true
  releaseSurface?.()
}

/* ---- 2. the native layer is gone ---------------------------------------- */

let gone = false
const watchers = new Set<() => void>()

export function isNativeSplashGone(): boolean { return gone }

/** Fires once, when the OS splash has finished fading out. Returns its own
 *  unsubscribe, and calls back immediately if it has already happened. */
export function onNativeSplashGone(cb: () => void): () => void {
  if (gone) { cb(); return () => {} }
  watchers.add(cb)
  return () => { watchers.delete(cb) }
}

function announce() {
  if (gone) return
  gone = true
  for (const cb of watchers) cb()
  watchers.clear()
}

/* ---- 3. the hide itself -------------------------------------------------- */

let hiding = false

/** Take the OS splash away, but not before the React surface underneath it
 *  matches — or before `waitMs`, whichever comes first.
 *
 *  THE TIMEOUT IS NOT OPTIONAL. BootGate is the initial route, not the only
 *  one: a notification tap or a deep link mounts (app) straight away and the
 *  boot surface never reports in. Waiting on a promise nobody will resolve is
 *  how an app ships with a splash screen that never leaves. */
export async function hideNativeSplash(waitMs = 900): Promise<void> {
  if (hiding) return
  hiding = true

  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    surfaceReadyP,
    new Promise<void>(resolve => { timer = setTimeout(resolve, waitMs) }),
  ])
  if (timer) clearTimeout(timer)

  try { SplashScreen.setOptions({ fade: true, duration: SPLASH_FADE_MS }) } catch { /* web / older host */ }
  try { await SplashScreen.hideAsync() } catch { /* already hidden */ }

  /* hideAsync resolves when the hide is STARTED, not when it is over — the
     iOS dissolve is still running, and Android is still tearing its own splash
     window down. Announcing on the resolve would start the choreography under
     a half-opaque native layer, which is the double exposure this whole module
     exists to avoid. */
  setTimeout(announce, SPLASH_FADE_MS)
}
