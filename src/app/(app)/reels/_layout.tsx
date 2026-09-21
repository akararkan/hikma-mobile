/* =========================================================
   The reels stack.

   Everything under /reels is black-on-black, so the stack's
   own content background is set here rather than inherited
   from the app stack (which is theme-coloured and would flash
   white behind a push in light mode).

   Two of these are presented rather than pushed: comments is a
   transparent modal so the reel stays visible behind it, and
   the composer is a full-screen modal because a camera in an
   iOS card sheet cannot reach the status bar.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { STAGE } from '@/components/reels/skin'
import { useTheme } from '@/theme/ThemeProvider'

export default function ReelsLayout() {
  const t = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: STAGE.black },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        animationDuration: 240,
      }}
    >
      <Stack.Screen name="[id]" options={{ animation: 'fade' }} />
      <Stack.Screen name="author/[authorId]" />
      <Stack.Screen name="watched" />
      <Stack.Screen
        name="comments/[postId]"
        options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="compose"
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
    </Stack>
  )
}
