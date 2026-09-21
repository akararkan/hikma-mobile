/* =========================================================
   One channel's sub-stack.

   The composer and the two people-pickers are modals: each one
   is a task you finish and dismiss, and presenting them as
   pushes would leave a Cancel that reads as Back.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

export default function ChannelDetailLayout() {
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
      <Stack.Screen name="compose" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="add-people" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="admins/add" options={{ presentation: 'modal', animation: modalIn }} />
      {/* The viewer owns the whole screen including the status bar, and its own
          horizontal pager conflicts with the stack's swipe-back. */}
      <Stack.Screen
        name="viewer"
        options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
      />
    </Stack>
  )
}
