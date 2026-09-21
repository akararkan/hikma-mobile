/* =========================================================
   The composer stack.

   The draft provider wraps the whole flow rather than each
   screen, which is the only way step 3 can see what step 1
   recorded — expo-router params carry strings, not video uris
   and overlay trees.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { ReelDraftProvider } from '@/components/reels/ReelDraft'
import { STAGE } from '@/components/reels/skin'
import { useTheme } from '@/theme/ThemeProvider'

export default function ComposeLayout() {
  const t = useTheme()
  /* Spelled out because a modal with no animation inherits the slide_from_right
     below — the sound picker would slide in from the side while `mix` slides up.
     Spelling it out costs the inherited reduced-motion cut, so that branch rides
     along (DESIGN.md §7). */
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  return (
    <ReelDraftProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: STAGE.black },
          animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
          animationDuration: 220,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="clips" />
        <Stack.Screen name="edit" />
        {/* The details step is the one screen in the flow that is NOT a stage:
            a caption, an audience and a location are form work, and this app
            writes forms on paper. Its own contentStyle, or the push animation
            slides a white screen in over black and the gap between them shows
            as a flash. */}
        <Stack.Screen name="publish" options={{ contentStyle: { backgroundColor: t.colors.bg } }} />
        <Stack.Screen name="sound" options={{ presentation: 'modal', animation: modalIn }} />
        <Stack.Screen
          name="mix"
          options={{ presentation: 'transparentModal', animation: modalIn }}
        />
      </Stack>
    </ReelDraftProvider>
  )
}
