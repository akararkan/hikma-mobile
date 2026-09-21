/* =========================================================
   announce() — the one place the app speaks to a screen
   reader directly.

   DESIGN.md §7 forbids components from calling
   `AccessibilityInfo`, and that rule stands: it is about
   READING the phone's state, which `osA11y.ts` owns so a
   setting can never be honoured on one screen and nowhere
   else. This is the other direction — a WRITE — and it exists
   because `accessibilityLiveRegion` is Android-only. On iOS a
   toast that appears while VoiceOver's focus sits elsewhere is
   simply never spoken, and toasts are the app's only
   async-result channel: publish, delete, rate limit, the api
   layer's `flashToast`. Silence there means the user cannot
   tell a finished write from a dead button.

   ANDROID IS DELIBERATELY EXCLUDED. The live region on the
   toast plate already announces it there; announcing again
   would read every message twice.

   Keep this the only caller. A second one is how you get two
   voices talking over each other.
   ========================================================= */
import { AccessibilityInfo, Platform } from 'react-native'
import { getOsA11y } from './osA11y'

export function announce(message: string): void {
  if (!message || Platform.OS !== 'ios' || !getOsA11y().screenReader) return
  try {
    /* Queued, so a burst of toasts reads in order instead of each one
       cutting the last off mid-word. */
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true })
  } catch { /* a failed announcement must never take the toast down with it */ }
}
