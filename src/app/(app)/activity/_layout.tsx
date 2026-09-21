/* The activity section owns its own stack purely so the filter can be a real
   modal route: presentation is a navigator option, and the (app) stack does
   not (and should not) enumerate another domain's leaves. */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

export default function ActivityLayout() {
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
        animationDuration: 240,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="reels" />
      <Stack.Screen name="filter" options={{ presentation: 'modal', animation: modalIn }} />
    </Stack>
  )
}
