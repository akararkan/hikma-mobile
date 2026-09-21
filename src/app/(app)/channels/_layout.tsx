/* =========================================================
   The channels stack.

   Every screen draws its own <Header>, so the native one stays
   off here as it does app-wide. Creation is modal because it is
   an interruption with a Cancel, not a place you navigate to.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

export default function ChannelsLayout() {
  const t = useTheme()
  /* Spelled out because a modal without an animation inherits the
     slide_from_right below; spelling it out also costs the inherited
     reduced-motion cut, so that branch rides along (DESIGN.md §7). */
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="new" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]" />
    </Stack>
  )
}
