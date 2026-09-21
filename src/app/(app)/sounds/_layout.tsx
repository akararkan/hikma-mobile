import React from 'react'
import { Stack } from 'expo-router'
import { STAGE } from '@/components/reels/skin'
import { useTheme } from '@/theme/ThemeProvider'

export default function SoundsLayout() {
  const t = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: STAGE.plate },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        animationDuration: 240,
      }}
    />
  )
}
