/* =========================================================
   The signed-out stack.

   The gate lives here rather than on each screen: one
   <Redirect> covers sign-in and its 2FA leg, and it fires the
   moment `signedIn` flips — which is how redeeming a TOTP code
   lands the user in the app without any screen having to
   navigate. First-run setup is carved out of it; see below.
   ========================================================= */
import React from 'react'
import { Redirect, Stack, usePathname } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { useAuthGate } from '@/context/AuthContext'
import { WelcomeCurtain } from '@/components/brand/WelcomeCurtain'
import { takeBrandMoment } from '@/lib/brandMoment'

export default function AuthLayout() {
  const t = useTheme()
  const gate = useAuthGate()
  const pathname = usePathname()

  /* THE FAREWELL. A deliberate sign-out queues its moment (lib/brandMoment)
     and the signed-in layout is gone by the time it could be shown, so it is
     claimed HERE — over the door the user has just been returned to. Only a
     voluntary sign-out ever queues one: an expired session clears the slot
     and gets the reason copy on sign-in instead. */
  const [farewell, setFarewell] = React.useState(() => !!takeBrandMoment(['farewell']))

  /* FIRST-RUN SETUP IS THE ONE EXEMPTION. register() returns a live session, so
     `signedIn` flips while the user is still on sign-up/password and still has
     an unverified email, no avatar, no interests and nobody followed. The gate
     below would then unmount the whole group and take them to an empty Home
     feed — onboarding/* lives UNDER this layout, so the parent would kill the
     child before it could draw. sign-up is exempt alongside onboarding because
     the flip and the replace into verify-email land together: without it the
     redirect can win that hand-off by a frame. onboarding/follow.tsx is what
     finally replaces into (tabs). */
  const inSetup = pathname.startsWith('/onboarding') || pathname.startsWith('/sign-up')

  if (gate === 'allow' && !inSetup) return <Redirect href="/(app)/(tabs)" />
  /* The flip side of that exemption: a session that dies mid-setup has nowhere
     to go but back to the door, because every step writes to the account. */
  if (gate === 'deny' && pathname.startsWith('/onboarding')) return <Redirect href="/(auth)/sign-in" />

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.bg },
          animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        }}
      >
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        <Stack.Screen name="two-factor" />
        <Stack.Screen name="sign-in-help" />
      </Stack>

      {/* Over the door, not instead of it: the sign-in screen is already
          mounted underneath when the curtain lifts. */}
      {farewell ? <WelcomeCurtain kind="farewell" onDone={() => setFarewell(false)} /> : null}
    </>
  )
}
