/* =========================================================
   Mute is global, sticky and cross-screen.

   Every reel surface reads the same flag: the tab pager, a
   deep-linked viewer, a long-press preview. It lives in MMKV
   rather than a context because it must survive a restart —
   a viewer who muted reels once should never be shouted at
   again — and because the value is read from inside player
   setup callbacks that run outside React.
   ========================================================= */
import React from 'react'
import { setAudioModeAsync } from 'expo-audio'
import { storage } from '@/platform/storage'

const KEY = 'ika:reels:muted'

let muted = (() => {
  try { return storage.getItem(KEY) === '1' } catch { return false }
})()

const subs = new Set<(v: boolean) => void>()

export function isReelsMuted(): boolean { return muted }

export function setReelsMuted(next: boolean) {
  if (next === muted) return
  muted = next
  try { storage.setItem(KEY, next ? '1' : '0') } catch { /* a full disk must not break playback */ }
  for (const fn of [...subs]) fn(next)
}

/** `[muted, toggle]` — the mute chip's whole contract. */
export function useReelsMute(): [boolean, () => void] {
  const [value, setValue] = React.useState(muted)
  React.useEffect(() => {
    subs.add(setValue)
    setValue(muted)
    return () => { subs.delete(setValue) }
  }, [])
  const toggle = React.useCallback(() => setReelsMuted(!muted), [])
  return [value, toggle]
}

/* ---------------------------------------------------------
   The audio session.

   Without this, iOS's ring/silent switch silences every reel —
   which reads as "the app's sound is broken", because nothing
   else on the phone behaves that way for video. `doNotMix`
   because a reel with someone's voice in it playing under a
   podcast helps nobody.

   Deliberately NOT latched. `setAudioModeAsync` is a full
   replace rather than a merge — the native record defaults
   `interruptionMode` to `mixWithOthers`, so every surface that
   sets the mode without naming it (a call teardown, the
   ringtone, either recorder) silently hands the session back
   to whatever else is playing. A once-per-process flag meant
   one call or one voice note left reels mixing under the
   user's music for the rest of the process. The call is cheap
   and idempotent; re-assert it every time instead.
   --------------------------------------------------------- */
export function armReelAudioSession() {
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' })
    .catch(() => { /* the session is the OS's to refuse; playback still tries */ })
}
