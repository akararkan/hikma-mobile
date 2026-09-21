/* =========================================================
   The signed-in stack.

   The auth gate lives here, once, so no screen inside has to
   check: a revoked session fires AUTH_EXPIRED at the HTTP
   layer, AuthProvider drops the user, and this redirect takes
   the user to sign-in from wherever they were.

   Every route below draws its own <Header>, so the native
   header is off throughout — see the note in ui/Screen.tsx.
   ========================================================= */
import React from 'react'
import { Redirect, Stack, usePathname, useRouter, type Href } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useTheme } from '@/theme/ThemeProvider'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { ChatProvider } from '@/context/ChatContext'
import { ChatVoiceHost } from '@/components/chat/chatVoicePlayer'
import { WelcomeCurtain } from '@/components/brand/WelcomeCurtain'
import { takeBrandMoment, type BrandMoment } from '@/lib/brandMoment'
import { ensureNotificationChannels, hrefFromPush, refreshPushRegistration } from '@/lib/pushNotify'
import { clearPendingHref, setPendingHref, takePendingHref } from '@/lib/pendingRoute'

/* A cold deep link (push tap, URL) otherwise builds this stack with ONLY the
   target route — Android back then exits the app instead of falling home. The
   anchor puts a (tabs) screen underneath every deep-linked entry. */
export const unstable_settings = { anchor: '(tabs)' }

export default function AppLayout() {
  const gate = useAuthGate()
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  /* Channels before any notification can carry its sound; the tap router
     lives HERE because a deep link only means something once signed in.
     useLastNotificationResponse covers both a running-app tap and a cold
     start FROM a tap (the OS parks the response until JS is up). */
  React.useEffect(() => { void ensureNotificationChannels() }, [])

  /* Re-send the push token if the OS rotated it since last launch. Silent and
     opt-in-only — it never prompts and never enables push for someone who has
     not asked for it (see refreshPushRegistration). Gated on `gate` so it runs
     once there IS a session to register the token against: the row is keyed to
     the account and the JWT's sid. */
  const pushRefreshed = React.useRef(false)
  React.useEffect(() => {
    if (gate !== 'allow' || pushRefreshed.current) return
    pushRefreshed.current = true
    void refreshPushRegistration()
  }, [gate])
  const lastTap = Notifications.useLastNotificationResponse()
  const routedTap = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!lastTap) return
    const id = lastTap.notification.request.identifier
    if (routedTap.current === id) return
    routedTap.current = id
    const href = hrefFromPush(lastTap.notification.request.content.data)
    if (href) router.push(href as any)
    /* Consume the tap: useLastNotificationResponse re-reads the STORED
       response, and this layout remounts on sign-out → sign-in — without the
       clear, the next session replays the previous account's destination. */
    Notifications.clearLastNotificationResponse()
  }, [lastTap, router])

  /* A URL deep link opened WITHOUT a session would otherwise be thrown away by
     the redirect below — (auth) sends everyone to (tabs) once they are in, so
     the post/channel/paper they tapped is simply lost. Park it and replay it
     the moment there is a session.

     Only on a COLD deny: `hadSession` means this mount has already seen a live
     session, which makes the deny a sign-out or an expiry, not a stranger
     arriving on a link. Replaying there would send the NEXT account to the
     previous one's screen. */
  const hadSession = React.useRef(false)
  const parked = React.useRef(false)
  React.useEffect(() => {
    if (gate === 'allow') { hadSession.current = true; return }
    if (gate !== 'deny' || parked.current) return
    /* Latch on the FIRST deny only: the redirect below moves `pathname` on to
       /sign-in while this layout is still mounted, and parking that would send
       the user straight back to the door they just came through. */
    parked.current = true
    if (hadSession.current) { clearPendingHref(); return }
    /* '/' is the tab root — parking it would replay a push onto itself. */
    if (pathname && pathname !== '/') setPendingHref(pathname)
  }, [gate, pathname])

  /* THE HAND-OVER. A session that begins while this layout is mounted is a
     sign-in or the end of sign-up — the two moments the brand should carry.
     A session that was ALREADY there on mount is a cold launch, and that one
     belongs to the boot gate's own splash, not to a second one on top of it. */
  /* meFrom() falls back to 'Member' when a profile carries no name at all —
     greeting somebody by that is worse than not greeting them. */
  const firstName = React.useMemo(() => {
    const full = String(user?.full || '').trim()
    if (!full || full === 'Member') return null
    return full.split(/\s+/)[0] || null
  }, [user?.full])

  /* THE MOMENT IS CLAIMED, NOT INFERRED.

     This used to read `useRef(gate === 'allow')` and show the curtain only
     when the layout had been mounted while signed OUT — which never happens:
     expo-router mounts this layout for the first time AFTER the session
     flips, so the ref was true on frame one and the curtain was dead code.
     The session's own cause queues the moment now (lib/brandMoment), and it
     is claimed here exactly once per mount — in a lazy state initializer,
     which runs before the first paint, because an effect would let one frame
     of the feed through underneath first. A cold start on a live session
     claims nothing and shows nothing, which is still right: the boot gate
     already gave that launch its brand. */
  const [moment] = React.useState<BrandMoment | null>(() => takeBrandMoment(['welcome', 'arrival']))
  const [greeted, setGreeted] = React.useState(false)
  const welcoming = gate === 'allow' && !!moment && !greeted

  const replayed = React.useRef(false)
  React.useEffect(() => {
    if (gate !== 'allow' || replayed.current) return
    const href = takePendingHref()
    if (!href) return
    replayed.current = true
    /* push, not replace: Home stays underneath so back has somewhere to go. */
    router.push(href as Href)
  }, [gate, router])

  if (gate === 'deny') return <Redirect href="/(auth)/sign-in" />
  if (gate === 'loading') return null

  /* The inbox lives here rather than at the root: it seeds three requests on
     mount, and a signed-out shell has nothing to seed them with. */
  return (
    <ChatProvider>
      {/* The ONE voice-note player, mounted once for every surface that plays
          voice media — chat bubbles AND channel posts: playback survives row
          recycling and screen hops. See chatVoicePlayer.tsx. */}
      <ChatVoiceHost />
      <AppStack />
      {/* Over the stack, not instead of it: the app mounts and fetches behind
          the curtain, which is the whole point of having one. */}
      {welcoming && moment ? (
        <WelcomeCurtain kind={moment.kind} name={firstName} onDone={() => setGreeted(true)} />
      ) : null}
    </ChatProvider>
  )
}

function AppStack() {
  const t = useTheme()
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
        animationDuration: 240,
        /* Same bargain the tab bar already struck (see (tabs)/_layout): a
           covered screen stays MOUNTED but stops re-rendering. It matters more
           here than there, because three SSE streams push presence, typing and
           badge frames all day and a stack five deep was re-rendering five
           screens on every frame that arrived — four of them behind an opaque
           one. Everything that must survive being covered lives above this
           Stack (RealtimeProvider, ChatProvider, ChatVoiceHost, CallBanner) or
           is exempted by name below. */
        freezeOnBlur: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />

      {/* Immersive surfaces: they own the whole screen including the status
          bar, and the story viewer disables the swipe-back because its own
          horizontal gesture moves between authors.

          The names are the FULL route names, `/index` included. A directory
          without its own `_layout` does not collapse to the directory name,
          so `name="live/[id]"` would match nothing and the presentation would
          silently fall back to a push.

          These are also where `freezeOnBlur` is switched back OFF. A frozen
          screen stops its effects and its timers, and every surface below is
          one whose work has to outlive being covered — a sheet, a profile tap
          out of a live chat, an incoming-call banner. Freezing a call is how
          you drop a call, so the rule here is: when in doubt, exempt. */}
      <Stack.Screen
        name="story/[authorId]"
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
          /* The frame clock is a Reanimated `withTiming` on the UI thread, and
             the UI thread does not care that React is frozen: the bar would
             keep gliding while the JS that advances the deck was suspended, so
             the viewer comes back to a full bar on a frame that never turned.
             Nothing to win either — the viewer is almost always the top of the
             stack, not the thing five screens down. */
          freezeOnBlur: false,
        }}
      />
      {/* The watch screen OWNS the media and the roster: `stage` is a formSheet
          that sits on top of it (control plane only, by design), which means
          this screen is blurred and STILL VISIBLE behind it. Freezing a visible
          broadcast is the worst of both. */}
      <Stack.Screen
        name="live/[id]/index"
        options={{ presentation: 'fullScreenModal', animation: 'fade', freezeOnBlur: false }}
      />
      {/* The vertical live pager — one full room mounted at a time; the same
          never-freeze rule (its mounted room owns transports and joins). */}
      <Stack.Screen
        name="live/watch"
        options={{ presentation: 'fullScreenModal', animation: 'fade', freezeOnBlur: false }}
      />
      {/* Publishing. The console is the only screen that can stop the stream. */}
      <Stack.Screen
        name="live/[id]/host"
        options={{ presentation: 'fullScreenModal', animation: 'fade', freezeOnBlur: false }}
      />
      {/* The stage sheet builds its "Watching" tab from `stream.viewer` frames
          collected live — a freeze drops frames and the list quietly goes wrong.
          Options are otherwise set inline in the screen itself. */}
      <Stack.Screen name="live/[id]/stage" options={{ freezeOnBlur: false }} />
      <Stack.Screen
        name="call/[id]/index"
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
          /* callEngine's glare/ICE handling, the duration clock and every
             renegotiation land through this screen's effects. Freeze it and a
             call that is covered by so much as a report modal stops answering. */
          freezeOnBlur: false,
        }}
      />
      <Stack.Screen
        name="call/[id]/incoming"
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
          /* The ringer and the give-up timeout are effects. A frozen ring is a
             missed call. */
          freezeOnBlur: false,
        }}
      />
      <Stack.Screen name="post/[id]/media" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      {/* The story camera — the same constraint reels/compose documents (a
          camera in an iOS card sheet cannot reach the status bar), and until
          this entry it was the ONE composer arriving as a sideways push. */}
      <Stack.Screen name="story/compose" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />

      {/* Sheets that are real routes, so they are deep-linkable and the
          hardware back button dismisses them.

          `animation` is spelled out because a modal without one inherits the
          stack's slide_from_right on Android, and then the composer enters
          like a push — the motion has to keep saying "you are interrupting
          yourself", not "you are going somewhere". Spelling it out costs the
          inherited reduced-motion cut, so that branch is spelled out too. */}
      <Stack.Screen name="compose" options={{ presentation: 'modal', animation: modalIn }} />
      <Stack.Screen name="report" options={{ presentation: 'modal', animation: modalIn }} />
      {/* The post share sheet rides the research one's exact grammar
          (research/_layout): a detented form sheet with a grabber — a share
          sheet slides up over the post, it does not push it away. */}
      <Stack.Screen
        name="post/[id]/share"
        options={{ presentation: 'formSheet', sheetAllowedDetents: [0.62, 0.95], sheetGrabberVisible: true, animation: modalIn }}
      />
    </Stack>
  )
}
