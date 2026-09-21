/* =========================================================
   The boot gate.

   THE ONE JOB: be the native splash, exactly, on the frame the
   native splash is taken away — and only then start moving.

   The OS draws the mark from `assets/images/splash-icon.png`
   at 88.8pt, dead centre, on Oxford navy, before the JS bundle
   has been read (src/lib/splash.ts derives that number rather
   than guessing it). This screen paints the same navy and puts
   the same glyph — the same master path, as a vector — at the
   same size in the same place. Nothing here animates until
   `onNativeSplashGone` says the OS layer is gone, so the swap
   itself is invisible and the motion that follows belongs to
   one continuous surface.

   Then the seam becomes the move: the mark travels out of the
   splash's geometry and settles into its seat inside the word,
   the word is written out of it, the instrument draws behind
   it, and the gate redirects once the auth state is known.

   `<Redirect>` rather than router.replace(): a navigation
   during render is the one form expo-router supports without a
   transition, and a transition here would animate the seam
   this screen exists to hide.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Redirect } from 'expo-router'
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { session } from '@/api'
import { warmTray } from '@/components/stories/trayStore'
import { warmHomeFeed } from '@/components/feed/feedWarm'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { UpdateWall, useUpdateVerdict } from '@/components/system/UpdateGate'
import { Text, Button, Spinner, Wordmark, type WordmarkOrigin } from '@/ui'
import { BrandRosette } from '@/components/brand/WelcomeCurtain'
import { APP_ENDONYMS } from '@/lib/brand'
import { NATIVE_MARK_HEIGHT, bootSurfaceReady, isNativeSplashGone, onNativeSplashGone } from '@/lib/splash'
import { hasPlayedBootBrand, markBootBrandPlayed } from '@/lib/bootBrand'

import { motion, ramp, space } from '@/theme/tokens'

/* Must stay pixel-identical to the native splash (app.json) behind it. */
const BRAND = ramp.brand[900]
/* A fast boot should never flash a spinner. */
const SPINNER_AFTER_MS = 600
/* THE BEAT AFTER THE WORD LANDS. The lockup's own settle finishes ~700ms
   after the handoff and the old code redirected on that exact frame, which is
   why the brand read as a flicker rather than a screen: the eye had the word
   for no time at all. Held here so the name is READ, not glimpsed — and under
   reduce-motion, where the lockup crosses over in 320ms, this hold is most of
   why the splash is seen at all. Shorter than it once was because the mark is
   now on screen from the FIRST frame of the launch, not from this screen's:
   the brand moment starts with the OS splash and this is only its tail. */
const BRAND_HOLD_MS = 400
/* The instrument draws behind the settling lockup — a shorter draw than the
   welcome curtain's, because it has ~1.1s of screen rather than ~4s. */
const ROSETTE_MS = 1000
/* The endonyms come up as the word lands, not after it. */
const ENDONYM_AT = 420
const ENDONYM_MS = 280
/* Long enough that only a genuinely stuck boot sees the escape hatch. */
const ESCAPE_AFTER_MS = 8000
/* LAST RESORT. Everything upstream of the handoff is already bounded — the
   font wait in _layout, the surface wait in hideNativeSplash — but a screen
   whose only exit is a callback needs its own floor, or one unexpected throw
   in the native module strands the user on a navy rectangle forever. */
const HANDOFF_FAILSAFE_MS = 5000

export default function BootGate() {
  const t = useTheme()
  const gate = useAuthGate()
  const { ready } = useAuth()
  /* The version gate lives HERE, not in (auth), because "before login" is only
     half the requirement: a build with a security defect has to be stopped for
     someone already signed in too, and this is the one node both branches pass
     through. It fails open — see UpdateGate. */
  const update = useUpdateVerdict()
  /* Latched by the lockup's own callback — see the redirect block below. */
  const [brandPlayed, setBrandPlayed] = React.useState(false)
  /* A launch FROM a notification tap has already named its destination —
     holding the brand in front of someone chasing a message reads as delay,
     not identity. Ordinary launches keep the full beat. Read once: the OS
     parks the response until JS is up, so it is present on the first frame
     of a tap-launched boot and null otherwise. */
  const [openedWithIntent] = React.useState(() => {
    try { return !!Notifications.getLastNotificationResponse() } catch { return false }
  })
  /* The reveal is owed once — on install, and again after a session dies on
     its own (lib/bootBrand). Every other cold start is a routine reopen and
     takes the same fast path a notification-tap launch already takes. */
  const [brandDue] = React.useState(() => !hasPlayedBootBrand())
  const [showSpinner, setShowSpinner] = React.useState(false)
  const [showEscape, setShowEscape] = React.useState(false)
  const [escaped, setEscaped] = React.useState(false)
  /* The hold timer, cleared on unmount so a fast boot cannot set state into a
     screen that has already been replaced. */
  const holdRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current) }, [])

  /* ---- the handoff ---------------------------------------------------- */

  /* WHERE THE OS PUT THE MARK.

     Two readings, and the order matters. The window's own dimensions are
     available SYNCHRONOUSLY, on the first render — which is the only reason
     the lockup can be in its boot form from the first frame instead of
     starting the ordinary choreography and being overtaken by a measurement
     one frame later. The measured root then refines it, because the native
     splash centres in the WINDOW and with Android edge-to-edge "the window"
     and "what Dimensions calls the screen" are not reliably the same
     rectangle. The refinement always lands long before the handoff, so the
     correction is never a thing anyone sees. */
  const { width: winW, height: winH } = useWindowDimensions()
  const rootRef = React.useRef<React.ComponentRef<typeof View>>(null)
  const [centre, setCentre] = React.useState<{ cx: number; cy: number } | null>(null)
  const onRootLayout = React.useCallback(() => {
    rootRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setCentre({ cx: x + w / 2, cy: y + h / 2 })
    })
  }, [])
  const origin: WordmarkOrigin = React.useMemo(() => ({
    cx: centre?.cx ?? winW / 2,
    cy: centre?.cy ?? winH / 2,
    h: NATIVE_MARK_HEIGHT,
  }), [centre, winW, winH])

  /* Nothing moves while the OS layer is still on screen, half-faded or not. */
  const [gone, setGone] = React.useState(isNativeSplashGone)
  React.useEffect(() => {
    if (gone) return
    const off = onNativeSplashGone(() => setGone(true))
    const failsafe = setTimeout(() => setGone(true), HANDOFF_FAILSAFE_MS)
    return () => { off(); clearTimeout(failsafe) }
  }, [gone])

  /* A tap-launched boot returns <Redirect> on its first render and never lays
     itself out, so the lockup's own `onParked` will never fire. Release the
     native splash by hand rather than making _layout wait out its timeout for
     a surface that was never going to arrive. */
  React.useEffect(() => { if (openedWithIntent || !brandDue) bootSurfaceReady() }, [openedWithIntent, brandDue])

  React.useEffect(() => {
    if (ready) return
    const a = setTimeout(() => setShowSpinner(true), SPINNER_AFTER_MS)
    const b = setTimeout(() => setShowEscape(true), ESCAPE_AFTER_MS)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [ready])

  /* The endonyms ride the handoff clock, not the mount clock — on a cold start
     those are seconds apart, and a line that faded in behind the OS splash was
     simply already there when it lifted. */
  const endonym = useSharedValue(0)
  React.useEffect(() => {
    if (!gone) return
    if (t.prefs.reducedMotion) { endonym.value = 1; return }
    endonym.value = withDelay(ENDONYM_AT, withTiming(1, {
      duration: ENDONYM_MS,
      easing: Easing.bezier(...motion.out),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone, t.prefs.reducedMotion])
  const endonymStyle = useAnimatedStyle(() => ({
    opacity: endonym.value,
    transform: [{ translateY: (1 - endonym.value) * 6 }],
  }))

  /* The brand hold is otherwise idle radio time — warm the story tray during
     it so the rings are already there when the feed paints. Module-level
     fetch with its own in-flight guard; the id comes off MMKV synchronously,
     so a warm boot fires this on frame one. This runs WITH the animation, not
     after it: the motion is masking work that is already under way. */
  React.useEffect(() => {
    if (gate !== 'allow') return
    warmTray(session.getUser()?.id)
    warmHomeFeed()
  }, [gate])

  /* Ahead of both redirects: a wall the user can route around is not a wall. */
  if (update.blocking) return <UpdateWall latest={update.latest} storeUrl={update.storeUrl} />

  /* THE SPLASH HAS TO BE SEEN.

     A warm launch reads its session straight out of MMKV, so `gate` is already
     'allow' on the FIRST render — and these redirects used to fire from it,
     before this screen had drawn a single frame. The brand existed and nobody
     ever saw it; the app went native-splash → feed.

     So the redirects wait for the lockup to finish AND for the beat after it
     (BRAND_HOLD_MS). It costs little on the occasion that matters: on a slow
     boot the animation has already played while the session was still
     resolving, so the hold only fills time the app was going to spend
     anyway. */
  if (brandPlayed || openedWithIntent || !brandDue) {
    if (gate === 'allow') return <Redirect href="/(app)/(tabs)" />
    if (gate === 'deny') return <Redirect href="/(auth)/sign-in" />

    /* AuthContext deliberately keeps the cached user when /users/me fails, so a
       boot stuck on a dead network can proceed with what is already on disk. */
    if (escaped && session.isAuthed()) return <Redirect href="/(app)/(tabs)" />
  }

  return (
    /* @boost-ignore — measured, so it keeps the JS wrapper */
    <View ref={rootRef} onLayout={onRootLayout} style={styles.root}>
      <StatusBar style="light" />
      {/* The same instrument the welcome curtain builds, so the launch and
          the door after it are visibly one surface. Mounted on the handoff and
          not before: the OS splash has no instrument, so a rosette part-drawn
          underneath it would be the pop, arriving in the one frame that has to
          be still. */}
      {gone ? <BrandRosette still={t.prefs.reducedMotion} ms={ROSETTE_MS} /> : null}
      <View style={styles.mark}>
        {/* THE LOCKUP CONTINUES THE OS SPLASH. `origin` is where the OS left
            the glyph; the mark parks there, reports in through `onParked` so
            _layout knows it is safe to lift the native layer, and then — on
            `play`, which is that lift — travels into its seat as the word is
            written out of it (ui/Wordmark). What the eye sees is one mark
            finishing its own word, which is what the seam always wanted to
            be. */}
        <Wordmark
          size={32}
          tone="onDark"
          animate
          ground={BRAND}
          origin={origin}
          play={gone}
          onParked={bootSurfaceReady}
          onDone={() => { holdRef.current = setTimeout(() => { markBootBrandPlayed(); setBrandPlayed(true) }, BRAND_HOLD_MS) }}
        />
        {/* The endonyms sit under the wordmark rather than replacing it: this
            screen is shown before anyone has chosen a language, so the brand
            states itself in all three and lets the reader find their own. */}
        <Animated.View style={endonymStyle}>
          <Text variant="footnote" color="rgba(255,255,255,0.72)" align="center" style={styles.endonyms}>
            {APP_ENDONYMS.join('  ·  ')}
          </Text>
        </Animated.View>
      </View>

      {/* Nothing in this slot before the brand has landed. A spinner appearing
          beside a lockup that is still settling reads as two things loading,
          and one of them is the logo. */}
      <View style={styles.slot}>
        {brandPlayed && showEscape ? (
          <Animated.View entering={FadeIn.duration(260)} style={styles.escape}>
            <Text variant="callout" color="rgba(255,255,255,0.9)" align="center">Still connecting…</Text>
            <Button
              label="Continue offline"
              onPress={() => setEscaped(true)}
              variant="ghost"
              size="sm"
              style={styles.escapeBtn}
            />
          </Animated.View>
        ) : brandPlayed && showSpinner ? (
          <Animated.View entering={FadeIn.duration(260)}>
            <Spinner color="#FFFFFF" />
          </Animated.View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  /* SELF-SIZING, AND THAT IS THE POINT. This was a fixed 76 x 76 box left over
     from the days when the splash showed the mark alone — the lockup that
     replaced it is nearly twice as wide, so the word was being measured
     against 76pt and ellipsised, and the endonyms under it wrapped into a
     column of fragments. A brand surface never constrains its own name. */
  mark: { alignItems: 'center', overflow: 'visible' },
  /* Loose, because two right-to-left scripts sharing a line need the air more
     than the wordmark above them does. */
  endonyms: { marginTop: space.sm, letterSpacing: 0.4 },
  slot: { height: 56, marginTop: space.xl, alignItems: 'center', justifyContent: 'center' },
  escape: { alignItems: 'center', gap: space.xxs },
  escapeBtn: { alignSelf: 'center' },
})
