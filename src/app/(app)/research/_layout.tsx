/* =========================================================
   The research stack.

   Two of these screens are sheets rather than pages — share
   and save — but they are still routes, so a notification or a
   pasted link can open them directly and the hardware back
   button dismisses them. The figures pager and the promo
   player take the whole screen including the status bar.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

export default function ResearchLayout() {
  const t = useTheme()
  /* Everything that enters from BELOW spells its animation out, because a modal
     with none inherits the stack's slide_from_right on Android and then arrives
     like a push. But a per-screen `animation` also overrides the stack's
     reduced-motion branch below, so the cut has to be carried here too —
     DESIGN.md §7: Reduce Motion reaches stack animations. */
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        animationDuration: 240,
      }}
    >
      <Stack.Screen
        name="[id]/share"
        options={{ presentation: 'formSheet', sheetAllowedDetents: [0.62, 0.95], sheetGrabberVisible: true, animation: modalIn }}
      />
      <Stack.Screen
        name="[id]/save"
        options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 0.9], sheetGrabberVisible: true, animation: modalIn }}
      />
      <Stack.Screen name="compose" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]/promo" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="[id]/figures" options={{ animation: modalIn }} />
    </Stack>
  )
}
