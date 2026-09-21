/* =========================================================
   Root layout — the app shell.

   Provider order is load-bearing and not arbitrary:

     GestureHandlerRootView   must be the outermost native view
     KeyboardProvider         needs to wrap anything that scrolls
     SafeAreaProvider         everything below reads insets
     ThemeProvider            colours before anything paints
     AuthProvider             owns the session state machine
     RealtimeProvider         needs `signedIn` from AuthProvider
     StepUpHost + ToastHost   register the two api-layer callbacks
                              (setStepUpPrompt / setToastHandler)

   The last one is why these hosts exist at all: `api/http.js`
   deliberately does not import UI, so the 403 step-up replay
   and the 429 toast reach the user through a registered
   callback instead of an import cycle. Nothing is registered
   until the shell mounts, which is exactly right — a 429 with
   no screen to show it has already missed its moment.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { startNetworkWatch } from '@/platform/network'
import { motion } from '@/theme/tokens'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { useFonts } from 'expo-font'
import { Lora_400Regular, Lora_400Regular_Italic, Lora_600SemiBold, Lora_600SemiBold_Italic, Lora_700Bold } from '@expo-google-fonts/lora'
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans'
import { Vazirmatn_400Regular, Vazirmatn_500Medium, Vazirmatn_600SemiBold, Vazirmatn_700Bold } from '@expo-google-fonts/vazirmatn'
import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri'
import { IBMPlexMono_400Regular, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono'

import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'
import { AuthProvider } from '@/context/AuthContext'
import { RealtimeProvider } from '@/context/RealtimeContext'
import { ToastHost, setFontsReady } from '@/ui'
import { hideNativeSplash } from '@/lib/splash'
import { StepUpHost } from '@/components/system/StepUpHost'
import { CallBanner } from '@/components/system/CallBanner'
import { InAppBannerHost } from '@/components/system/InAppBanner'
import { OfflineBanner } from '@/components/system/OfflineBanner'

/* Hold the splash only until the fonts settle AND BootGate has painted its
   replica of it. The AUTH wait belongs to BootGate (src/app/index.tsx), which
   owns the slow-boot spinner and the "Continue offline" hatch — holding the
   whole tree here instead kept that hatch unreachable whenever the network was
   the thing that was stuck. The handoff itself is src/lib/splash.ts; nothing
   else in the app calls hideAsync. */
void SplashScreen.preventAutoHideAsync().catch(() => {})

/* THE FONT WAIT IS CAPPED. Seventeen faces have to resolve before the lockup
   can be set in Lora, and waiting for them is right — but `useFonts` has no
   timeout of its own, and a splash whose only exit is a promise is a splash
   that can hang forever. Past this the app comes up on the platform stack and
   the faces swap in behind it, which is a worse first second than the correct
   one and a far better one than none. */
const FONT_WAIT_MS = 2500

export default function RootLayout() {
  /* OXFORD typography (DESIGN.md §4): Lora serif · IBM Plex Sans UI ·
     Amiri Arabic/Kurdish serif · Vazirmatn Arabic UI sans · Plex Mono
     ledger. On load failure the Text primitive silently rides each
     platform's system stack instead. */
  const [fontsLoaded, fontsError] = useFonts({
    Lora_400Regular, Lora_400Regular_Italic, Lora_600SemiBold, Lora_600SemiBold_Italic, Lora_700Bold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
    Vazirmatn_400Regular, Vazirmatn_500Medium, Vazirmatn_600SemiBold, Vazirmatn_700Bold,
    Amiri_400Regular, Amiri_700Bold,
    IBMPlexMono_400Regular, IBMPlexMono_600SemiBold,
  })
  React.useEffect(() => { setFontsReady(fontsLoaded && !fontsError) }, [fontsLoaded, fontsError])

  const [fontWaitOver, setFontWaitOver] = React.useState(false)
  React.useEffect(() => {
    const id = setTimeout(() => setFontWaitOver(true), FONT_WAIT_MS)
    return () => clearTimeout(id)
  }, [])

  /* Start watching the connection once, at the root. Everything downstream
     reads the answer synchronously (src/platform/network.js), so the watch has
     to be running before the first upload or feed row asks. */
  React.useEffect(() => startNetworkWatch(), [])

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <RealtimeProvider>
                <Shell fontsSettled={fontsLoaded || !!fontsError || fontWaitOver} />
              </RealtimeProvider>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}

function Shell({ fontsSettled }: { fontsSettled: boolean }) {
  const t = useTheme()

  /* Keep the OS window background in step with the theme, or a fast scroll
     past the end of a list shows the platform's default white. */
  React.useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.colors.bg).catch(() => {})
  }, [t.colors.bg])

  React.useEffect(() => {
    if (!fontsSettled) return
    /* Not a bare hideAsync: the OS layer only comes off once BootGate has
       parked its mark on the same geometry, and the choreography under it only
       starts once the dissolve has finished. Both halves of that live in
       src/lib/splash.ts, which also carries the timeout for the routes that
       are not BootGate at all (a notification tap, a deep link). */
    void hideNativeSplash()
  }, [fontsSettled])

  /* No wrong-screen flash despite mounting before `ready`: BootGate redirects
     only once the gate answers, and (app)/_layout re-checks the gate for deep
     links — so the unknown-session frames show BootGate's brand surface, not
     the sign-in screen. */
  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />

      <Stack
        screenOptions={{
          headerShown: false,               // every screen draws its own <Header>
          contentStyle: { backgroundColor: t.colors.bg },
          animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
          /* Drawn from the motion scale — reduced motion already collapses
             the sibling `animation` to 'none'. */
          animationDuration: motion.normal,
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ animation: t.prefs.reducedMotion ? 'none' : 'fade' }} />
        <Stack.Screen name="(app)" options={{ animation: t.prefs.reducedMotion ? 'none' : 'fade' }} />
        <Stack.Screen name="+not-found" options={{ presentation: 'modal' }} />
      </Stack>

      {/* Chrome that outranks the navigator: an incoming call must be
          reachable from any screen, and a toast must sit over a modal. */}
      <CallBanner />
      <InAppBannerHost />
      <OfflineBanner />
      <StepUpHost />
      <ToastHost />
    </View>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
