/* =========================================================
   The Q&A stack.

   `[id]` is a DIRECTORY, never both `[id].tsx` and an `[id]/`
   folder — that pair is an ambiguous-route error. The static
   siblings (ask, search, saved, tag) rank above the dynamic
   segment in expo-router, so `/qna/ask` resolves to the
   composer rather than to a question whose id is "ask".

   Composers are modals: they are their own task, and a modal
   makes "Cancel" mean cancel instead of "go back one screen".
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'

export default function QnaLayout() {
  const t = useTheme()
  /* The composers spell their animation out — a modal without one inherits the
     slide_from_right below and enters like a push. But a per-screen `animation`
     also wins over the stack's reduced-motion branch, so the cut has to be
     carried here rather than inherited (DESIGN.md §7). */
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
      <Stack.Screen name="ask" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen name="[id]/compose" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]/edit" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="[id]/edit-answer/[answerId]" options={{ presentation: 'modal', animation: modalIn }} />
    </Stack>
  )
}
