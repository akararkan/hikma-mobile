/* =========================================================
   The phone's own accessibility settings.

   `theme/prefs` answers "what did the user ask Hikmah Web for?" — a
   server-stored block that follows the account to a new device.
   This module answers the other half: "what has the user already
   asked their PHONE for?" Both are real requests from the same
   person, and the settings screen promises in so many words that
   we honour both:

     "Increases type size across the app, ON TOP OF your phone's
      setting."
     "We follow these too. Turning something on here adds to your
      phone's setting — it does not override it."

   Before this module that copy was false. The OS values were read
   on the accessibility screen purely to be DISPLAYED, and nothing
   downstream consumed them: `Text` sets allowFontScaling={false}
   and every duration flows through `t.ms()`, which only ever saw
   the server block. Someone who had turned Dynamic Type up on
   their phone got a pixel-identical app, and someone with Reduce
   Motion on still got every slide and fade except inside the
   reels overlay, which had reached for AccessibilityInfo on its
   own. ThemeProvider now folds this in, so the promise holds.

   SYNCHRONOUS READ, on purpose. `prefersReducedMotion()` is read
   off the render path by non-React callers, and ThemeProvider
   boots from a cache so the FIRST frame is already correct.
   `fontScale` is available synchronously and is right on frame
   one; the three AccessibilityInfo booleans are Promise-only on
   both platforms, so they land a tick later and re-render through
   the subscription below. Starting them at `false` is the safe
   direction: the app animates for one frame and then stops, which
   is the same failure mode as launching before the user's server
   prefs arrive.

   WHY NOT PixelRatio.getFontScale(). Its implementation is
   `Dimensions.get('window').fontScale || PixelRatio.get()` — when
   fontScale is absent or 0 it does not return 1, it returns the
   DEVICE PIXEL RATIO. On a 3x phone that reads as a 300% font
   scale and would explode every layout in the app. We read the
   dimension directly and validate it.
   ========================================================= */
import React from 'react'
import { AccessibilityInfo, Dimensions } from 'react-native'

export interface OsA11y {
  /** The phone's Reduce Motion switch. ORed with the in-app pref. */
  reduceMotion: boolean
  /** VoiceOver / TalkBack is actually running right now. */
  screenReader: boolean
  /** iOS Bold Text. Android does not expose it and stays false. */
  boldText: boolean
  /** The phone's text-size multiplier, RAW and unclamped. 1 = untouched.
   *  iOS Dynamic Type reaches ~3.1 at AX5; Android OEM steps reach ~2.0.
   *  Bounding it is ThemeProvider's job (SCALE_MAX), so there is exactly one
   *  clamping authority and the settings screen can show both numbers —
   *  what the phone asked for, and what IKA was able to apply. */
  fontScale: number
}

const NEUTRAL: OsA11y = { reduceMotion: false, screenReader: false, boldText: false, fontScale: 1 }

/** Validate a fontScale off the Dimensions record. Anything absent, zero,
 *  negative or NaN reads as "no scaling" — a bad reading must never be the
 *  reason the UI breaks. Valid readings pass through untouched. */
function readFontScale(): number {
  const v = Number(Dimensions.get('window')?.fontScale)
  return Number.isFinite(v) && v > 0 ? v : 1
}

/* The snapshot is a frozen box replaced only when a value actually changed.
   useSyncExternalStore compares snapshots by identity and would loop forever
   on a fresh object per read. */
let current: OsA11y = { ...NEUTRAL, fontScale: readFontScale() }
let started = false
const listeners = new Set<() => void>()

function commit(next: Partial<OsA11y>) {
  const merged = { ...current, ...next }
  if (
    merged.reduceMotion === current.reduceMotion &&
    merged.screenReader === current.screenReader &&
    merged.boldText === current.boldText &&
    merged.fontScale === current.fontScale
  ) return
  current = merged
  listeners.forEach(fn => { try { fn() } catch { /* one bad listener must not stop the rest */ } })
}

/** Begin watching. Idempotent; safe from app start and from a render path.
 *  Never throws — a platform missing one of these reads simply keeps the
 *  neutral value for it. */
export function startOsA11yWatch(): () => void {
  if (started) return () => {}
  started = true

  AccessibilityInfo.isReduceMotionEnabled().then(v => commit({ reduceMotion: !!v })).catch(() => {})
  AccessibilityInfo.isScreenReaderEnabled().then(v => commit({ screenReader: !!v })).catch(() => {})
  /* iOS only; the optional call keeps Android from throwing on a missing method. */
  const bold = AccessibilityInfo.isBoldTextEnabled?.()
  if (bold) bold.then(v => commit({ boldText: !!v })).catch(() => {})

  const subs = [
    AccessibilityInfo.addEventListener('reduceMotionChanged', v => commit({ reduceMotion: !!v })),
    AccessibilityInfo.addEventListener('screenReaderChanged', v => commit({ screenReader: !!v })),
    AccessibilityInfo.addEventListener?.('boldTextChanged', v => commit({ boldText: !!v })),
    /* Font scale rides the Dimensions change event — the same signal
       useWindowDimensions() listens to, and the only one that fires when the
       user drags the slider in the OS settings and comes back. */
    Dimensions.addEventListener('change', () => commit({ fontScale: readFontScale() })),
  ]

  return () => { subs.forEach(s => { try { s?.remove?.() } catch { /* already gone */ } }) }
}

/** The cached answer. Never throws, never blocks, safe before the watch
 *  starts (it starts itself). */
export function getOsA11y(): OsA11y {
  if (!started) startOsA11yWatch()
  return current
}

export function subscribeOsA11y(fn: () => void): () => void {
  if (!started) startOsA11yWatch()
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Re-renders the caller when the phone's accessibility state changes. */
export function useOsA11y(): OsA11y {
  return React.useSyncExternalStore(subscribeOsA11y, getOsA11y, getOsA11y)
}
