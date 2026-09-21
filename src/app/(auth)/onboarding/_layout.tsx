/* =========================================================
   First-run onboarding.

   Every step here runs with a LIVE session — register returns
   one — so these screens are authenticated even though they
   sit inside the (auth) group, which is where the flow starts
   and where the user can still be dropped back to sign-in if
   the session dies mid-setup.

   Each step owns its own header because each has a different
   Skip affordance, so this is only the stack.
   ========================================================= */
import React from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Header, Text, Touchable } from '@/ui'

/* The shared chrome, exported from the layout rather than a sibling module:
   everything in the app directory is a route, so a plain component file next
   to these screens would be picked up by the router as one. */
export function OnboardingHeader({ onSkip, label = 'Skip' }: { onSkip?: () => void; label?: string }) {
  return (
    <Header
      border={false}
      titleNode={
        onSkip ? (
          <Touchable onPress={onSkip} feedback="dim" style={{ alignSelf: 'flex-end', paddingHorizontal: space.md, paddingVertical: space.sm }}>
            <Text variant="subhead" tone="accent" align="ui">{label}</Text>
          </Touchable>
        ) : <></>
      }
    />
  )
}

export default function OnboardingLayout() {
  const t = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        animationDuration: 240,
        /* Every step is skippable forward, never backward: a swipe back into
           a step the user already completed would re-run its write. */
        gestureEnabled: false,
      }}
    />
  )
}
