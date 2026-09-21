/* =========================================================
   useDiscardGuard — Android hardware back has to go through
   the same guard as the Cancel button, or the draft dies to a
   reflex.

   Every composer in this app already guards its Cancel affordance:
   if the draft is dirty it opens a ConfirmSheet rather than
   leaving. Hardware back bypassed all of that and popped the
   screen directly, taking typed text, attached photos, a poll
   and a chosen sound with it. `predictiveBackGestureEnabled` is
   false in app.json, so the back GESTURE routes through
   `hardwareBackPress` too — this covers both.

   Returning true from the listener consumes the event; returning
   false lets the navigator pop as usual, which is exactly what a
   clean draft should do.

   The callback goes through `useEvent` so the subscription only
   re-arms when `dirty` actually flips. A composer re-renders on
   every keystroke, and re-subscribing a native listener per
   character is the kind of thing that looks free until a slow
   device is holding a 2000-character draft.

   No-op on iOS: BackHandler has no hardware button to listen to
   there, and the swipe-back gesture is disabled on these screens
   by the navigator, not by us.
   ========================================================= */
import React from 'react'
import { BackHandler } from 'react-native'
import { useEvent } from '@/hooks/useAsync'

/**
 * @param dirty     whether the draft has unsaved work worth protecting
 * @param onBlocked what Cancel already does — usually `discard.open`
 */
export function useDiscardGuard(dirty: boolean, onBlocked: () => void) {
  const blocked = useEvent(onBlocked)

  React.useEffect(() => {
    if (!dirty) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      blocked()
      return true
    })
    return () => sub.remove()
  }, [dirty, blocked])
}
