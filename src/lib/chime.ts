/* =========================================================
   chime — the RN port of lib/chime.js.

   The web version synthesised a two-note tone with WebAudio so
   the app never shipped an audio asset. expo-audio has no
   oscillator, and bundling a sound file for a notification
   would be a new asset with its own licensing story, so the
   native equivalent is the platform's own vocabulary:
   a haptic, plus the OS notification sound when the app is
   backgrounded (which expo-notifications owns).

   In-app, therefore, "chime" means a short haptic pattern. It
   is honest on a phone: a foreground app that plays its own
   ding over the user's music is worse behaviour than the web
   version's tiny blip ever was, and the platform convention is
   haptic-only for in-app events.

   The rate limit and the mute gate are preserved exactly —
   they were the load-bearing part.
   ========================================================= */
import * as Haptics from 'expo-haptics'
import { storage } from '@/platform/storage'
import { prefersHaptics } from '@/theme/prefs'

const MUTE_KEY = 'ika_chime_muted'

/* At most one chime per this window. A burst of notifications (a thread
   catching up after a reconnect) must not become a burst of buzzes. */
const MIN_GAP_MS = 2500
let lastAt = 0

export function isChimeMuted(): boolean {
  try { return storage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function setChimeMuted(muted: boolean) {
  try {
    if (muted) storage.setItem(MUTE_KEY, '1')
    else storage.removeItem(MUTE_KEY)
  } catch { /* ignore */ }
}

export type ChimeKind = 'message' | 'notification' | 'call' | 'error'

/** Fire the in-app alert for an incoming event. No-op when muted, when the
 *  user turned haptics off, or when one already fired this window. */
export function chime(kind: ChimeKind = 'notification'): boolean {
  if (isChimeMuted() || !prefersHaptics()) return false
  const now = Date.now()
  /* A call is the one thing allowed to interrupt the rate limit — it is a
     ringing phone, not a badge bump. */
  if (kind !== 'call' && now - lastAt < MIN_GAP_MS) return false
  lastAt = now

  try {
    switch (kind) {
      case 'call':
        /* Three beats, roughly a ring cadence. The ringing screen repeats it. */
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 260)
        setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 520)
        break
      case 'error':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        break
      case 'message':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        break
      default:
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
    return true
  } catch {
    return false
  }
}
