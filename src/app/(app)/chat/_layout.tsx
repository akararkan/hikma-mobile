/* =========================================================
   The chat stack.

   Every screen draws its own <Header>, so the native one stays
   off throughout. The modal group is the set of screens that
   are a TASK rather than a place: picking people, forwarding,
   and the per-message seen-by sheet all end by returning you to
   exactly where you were, which is what a modal means.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

/* The voice-note player used to mount here; it now lives one level up in the
   signed-in layout, because channel posts play voice notes too — see
   chatVoicePlayer.tsx. */
export default function ChatLayout() {
  const t = useTheme()
  /* Every modal below spells its animation out — one without it inherits the
     slide_from_right and enters like a push. But a per-screen `animation` also
     wins over the stack's reduced-motion branch, so the cut has to be carried
     here rather than inherited (DESIGN.md §7). */
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="new" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="new-group" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="forward" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="share" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]/add-members" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]/seen/[messageId]" options={{ presentation: 'modal', animation: modalIn }} />
      {/* The viewer owns the whole screen including the status bar, and its own
          horizontal pager conflicts with the stack's swipe-back. */}
      <Stack.Screen
        name="[id]/viewer"
        options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
      />
    </Stack>
  )
}
