/* =========================================================
   useDockInset — the safe-area slice a bottom-anchored bar
   should actually pay for.

   DESIGN.md §8: a docked bar owns its own safe-area edge —
   Android is edge-to-edge, and a fixed padding puts the bar
   UNDER the gesture pill on every gesture-nav device. But that
   is only true while the keyboard is CLOSED. Every host that
   docks a composer wraps it in a KeyboardAvoidingView with
   behavior="padding", which already pads by the FULL overlap
   with the keyboard — the home indicator is not on screen at
   that moment, so adding insets.bottom on top of it floats the
   bar ~34pt above the keys on iPhone and 24–48pt on gesture-nav
   Android. That strip of dead wallpaper was reported three
   separate times and patched three different ways; this is the
   one answer.

   Returns the inset to ADD (0 while the keyboard is up), so a
   call site keeps whatever arithmetic it already had:

     paddingBottom: dock + 6              // was insets.bottom + 6
     paddingBottom: Math.max(dock, 8)     // was Math.max(insets.bottom, 8)

   "will" events on iOS so the collapse rides the keyboard
   animation instead of snapping after it; "did" on Android,
   where the will events never fire.
   ========================================================= */
import React from 'react'
import { Keyboard, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function useDockInset(): number {
  const insets = useSafeAreaInsets()
  const [keyboardVisible, setKeyboardVisible] = React.useState(false)
  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  return keyboardVisible ? 0 : insets.bottom
}
