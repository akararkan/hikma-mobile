/* =========================================================
   CallBanner — the incoming-call surface.

   `call.incoming` arrives on the always-on chat stream, which
   means it can land while the user is anywhere in the app.
   The banner is therefore mounted above the navigator rather
   than on any screen, and it is the thing that routes to the
   ringing screen.

   The banner, not a full-screen takeover, is the right default:
   a phone that hijacks the whole UI for a call the user may not
   want is worse than one that offers a tappable strip. Tapping
   Accept opens the call screen; the strip also gives Decline
   directly, which is the action people actually want most.

   Media is WebRTC through src/lib/callEngine.ts (react-native-
   webrtc is installed; mesh, glare and ICE ordering live in the
   engine). This banner owns only the ring: incoming-call strip,
   accept → route to the call room, decline → REST.

   The wire CallResponse carries NO caller identity — only
   initiatorId (calls.md; backend record is id/conversationId/
   initiatorId/type/status/participants/timestamps). The name and
   avatar are resolved asynchronously: conversation first (its
   displayTitle covers groups, the 1:1 peer brings the avatar),
   then the initiator's public profile. The ring itself never
   waits on a lookup.
   ========================================================= */
import React from 'react'
import { AppState, Platform, StyleSheet, View, type AppStateStatus } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePathname, useRouter } from 'expo-router'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import notifee from '@notifee/react-native'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { Avatar, Text, Icon, Touchable, toast } from '@/ui'
import { chime, isChimeMuted } from '@/lib/chime'
import { dismissCallNotification, notifyIncomingCall } from '@/lib/pushNotify'
import {
  presentIncomingCall, cancelIncomingCall, resolveCallIdentity,
  callRouteFromForegroundEvent, callRouteFromInitialNotification,
  type CallIdentity,
} from '@/lib/callNotifee'
import { appendCallLog, logFromCall } from '@/components/call/callStore'

interface Ringing {
  callId: string
  conversationId: string | null
  type: 'VOICE' | 'VIDEO'
  callerName: string
  callerAvatar: string | null
  callerId: string | null
}

/* The strip's own deadline. The server sweeps an unanswered ring to MISSED
   after ≥60s on a 20s cadence, and the resulting `call.ended` frame is what
   normally clears this surface — but that frame can simply never arrive (the
   backend caps a user at five emitters with LRU eviction, and this stream can
   be the one evicted). 80s is the sweep's worst case; past it the call is
   over whether or not the wire said so. */
const RING_CAP_MS = 80_000

/* expo-audio's remove() only unregisters the player from the native module —
   playback runs on until the JS object is garbage-collected, and a looping
   player never goes quietly. pause() is the actual stop; remove() then frees
   the registration. */
function releasePlayer(p: AudioPlayer) {
  try { p.pause() } catch { /* already released */ }
  try { p.remove() } catch { /* already released */ }
}

export function CallBanner() {
  const t = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const [ringing, setRinging] = React.useState<Ringing | null>(null)
  /* Mirrors for the deferred take-over checks below — a timer callback needs
     the CURRENT ring and route, not the ones its closure was born with. */
  const ringingRef = React.useRef<Ringing | null>(null)
  React.useEffect(() => { ringingRef.current = ringing }, [ringing])
  const pathnameRef = React.useRef(pathname)
  React.useEffect(() => { pathnameRef.current = pathname }, [pathname])
  const ringTimer = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const ringPlayer = React.useRef<AudioPlayer | null>(null)
  /* Bumped by every stop. startRingtone crosses an await before it owns a
     player, so a stop landing inside that window has nothing to release —
     the stamp lets the player that materialises afterwards see it was
     already stopped and die unstored instead of looping to a dismissed
     strip forever. */
  const ringGen = React.useRef(0)

  const stopRinging = React.useCallback(() => {
    ringGen.current += 1
    if (ringTimer.current) { clearInterval(ringTimer.current); ringTimer.current = null }
    if (ringPlayer.current) {
      releasePlayer(ringPlayer.current)
      ringPlayer.current = null
    }
  }, [])

  React.useEffect(() => stopRinging, [stopRinging])

  /* THE one route into a call surface from a ring. Clears every ring the
     banner owns first — strip, audio, both notifications — so whichever
     surface takes over (the ringing screen or the room) starts alone:
     waiting on the `call.accepted` frame to clear them loses whenever the
     stream is mid-reconnect, and the ringtone would keep looping under the
     live call. */
  const openCallRoute = React.useCallback((route: { callId: string; href: string } | null) => {
    if (!route) return
    setRinging(null)
    stopRinging()
    dismissCallNotification(route.callId)
    cancelIncomingCall(route.callId)
    router.push(route.href as any)
  }, [router, stopRinging])

  /* Routes a notifee call notification (full-screen wake, body tap, or the
     Answer action) into the right screen. `getInitialNotification` covers a
     COLD start — the app process did not exist until the tap launched it, so
     there is no event listener yet to catch it; `onForegroundEvent` covers
     every case where the app was already alive (backgrounded or foregrounded)
     when the tap landed. Decline never reaches here — it is handled headlessly
     by index.js's onBackgroundEvent without opening the app at all. */
  React.useEffect(() => {
    if (Platform.OS !== 'android') return
    notifee.getInitialNotification().then(initial => openCallRoute(callRouteFromInitialNotification(initial))).catch(() => {})
    return notifee.onForegroundEvent(e => openCallRoute(callRouteFromForegroundEvent(e)))
  }, [openCallRoute])

  /* The event notifee never sends. A full-screen intent that launches an app
     which was already alive in the BACKGROUND emits nothing — no press event
     (nothing was pressed), and `getInitialNotification` is cold-start only —
     the activity just comes forward wherever it was, with the ring still in
     the shade. The background→active flip is the only signal there is. On
     each one, after a beat that lets a REAL tap's event land first (its
     openCallRoute cancels the notification, making this a no-op), ask the
     shade: a still-displayed call ring means the phone is ringing while the
     user is now looking at the app — so land them on the full-screen ringing
     screen, the WhatsApp grammar. This also catches the user re-opening the
     app themselves mid-ring, from the launcher, for free. */
  React.useEffect(() => {
    if (Platform.OS !== 'android') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') {
        if (timer) { clearTimeout(timer); timer = null }
        return
      }
      if (timer) clearTimeout(timer)
      /* 500ms — deliberately AFTER the ringing-state take-over's 350ms: when
         the banner also knows about this ring (SSE was alive), that path owns
         it and this one must find the state cleared, the route changed, or
         the notification already cancelled. */
      timer = setTimeout(async () => {
        timer = null
        /* The banner knows about a live ring — the state-owned take-over in
           the handoff effect below is handling it. */
        if (ringingRef.current) return
        /* Already on a call surface (the room, or the ringing screen a tap
           just opened) — never stack a second one. */
        if (pathnameRef.current?.startsWith('/call')) return
        try {
          const displayed = await notifee.getDisplayedNotifications()
          const ring = displayed.find(d => typeof d.notification?.data?.callId === 'string')
          const callId = ring ? String(ring.notification!.data!.callId) : null
          if (!callId) return
          if (pathnameRef.current?.startsWith('/call')) return
          openCallRoute({ callId, href: `/call/${callId}/incoming` })
        } catch { /* shade unreadable — the notification tap still routes */ }
      }, 500)
    })
    return () => { if (timer) clearTimeout(timer); sub.remove() }
  }, [openCallRoute])

  /* The audible ring. A call is a summons, so it plays through the mute
     switch (playsInSilentMode) — the chime MUTE preference is the one opt-out
     honoured, degrading the ring to the existing haptic pulse. The 24s asset
     loops for as long as the strip is up. */
  const startRingtone = React.useCallback(async () => {
    if (isChimeMuted() || ringPlayer.current) return
    const gen = ringGen.current
    try {
      await setAudioModeAsync({ playsInSilentMode: true })
      const p = createAudioPlayer(require('../../../assets/sounds/ringtone.wav'))
      /* Stopped (answered, declined, ended) while audio mode was still
         setting up? stopRinging already ran and could not see this player. */
      if (gen !== ringGen.current) { releasePlayer(p); return }
      p.loop = true
      p.play()
      ringPlayer.current = p
    } catch { /* a failed player must never take the ring strip down */ }
  }, [])

  /* The whole audible in-app ring: haptic cadence + looping ringtone.
     Foreground only — backgrounded, the OS call notification IS the ring,
     and a second phase-shifted ringtone underneath it (from a strip nobody
     can see) is the double-ring bug, not urgency. */
  const startAudibleRing = React.useCallback(() => {
    if (ringTimer.current || AppState.currentState !== 'active') return
    chime('call')
    ringTimer.current = setInterval(() => chime('call'), 3200)
    void startRingtone()
  }, [startRingtone])

  /* Caller identity is not on the wire (see header) — resolve it after the
     strip is already ringing, through the same shared lookup the killed-app
     task uses (callNotifee.resolveCallIdentity: conversation first, then the
     initiator's profile; bounded, fail-open). Functional updates keyed on
     callId make a late answer for a superseded ring a no-op. Returns the
     identity so the background notification can carry the name AND the face. */
  const resolveIdentity = React.useCallback(async (callId: string, conversationId: string | null, initiatorId: string | null): Promise<CallIdentity | null> => {
    const ident = await resolveCallIdentity({ conversationId, initiatorId, timeoutMs: 5000 })
    if (ident) {
      setRinging(prev => (prev && prev.callId === callId
        ? {
          ...prev,
          callerName: ident.name || prev.callerName,
          callerAvatar: ident.avatar ?? prev.callerAvatar,
        }
        : prev))
    }
    return ident
  }, [])

  useChatEvents(evt => {
    if (evt.type === 'call.incoming') {
      const call = evt.call
      if (!call?.id) return
      /* Your own outgoing call echoes here on your other devices — never ring
         yourself for a call you just placed. */
      if (user?.id && String(call.initiatorId ?? '') === String(user.id)) return
      const callId = String(call.id)
      const conversationId = call.conversationId ? String(call.conversationId) : null
      const initiatorId = call.initiatorId ? String(call.initiatorId) : null
      setRinging({
        callId,
        conversationId,
        type: call.type === 'VIDEO' ? 'VIDEO' : 'VOICE',
        callerName: 'Incoming call',
        callerAvatar: null,
        callerId: initiatorId,
      })
      const identity = resolveIdentity(callId, conversationId, initiatorId)
      stopRinging()
      startAudibleRing()
      /* Backgrounded: the strip is invisible, so the OS notification IS the
         ring (the calls channel carries the ringtone). Give the name lookup a
         beat to land — the banner never waits, but a banner-less phone can
         afford 900ms for "Dr. Sara" over "Incoming call". */
      if (AppState.currentState !== 'active') {
        const body = call.type === 'VIDEO' ? 'Incoming video call' : 'Incoming voice call'
        /* Android: notifee's full-screen intent wakes the phone over the lock
           screen, like WhatsApp. iOS has no equivalent without CallKit + a
           VoIP push the backend doesn't send yet, so it keeps the ordinary
           heads-up banner. */
        const present = Platform.OS === 'android' ? presentIncomingCall : notifyIncomingCall
        void Promise.race([identity, new Promise<null>(r => setTimeout(() => r(null), 900))])
          .then(ident => present({
            callId,
            title: ident?.name || 'Incoming call',
            body,
            avatarUrl: ident?.avatar ?? null,
          }))
      }
      return
    }

    if (evt.type === 'call.ended' || evt.type === 'call.declined' || evt.type === 'call.accepted') {
      const id = evt.callId ? String(evt.callId) : null
      /* Group semantics (calls.md): another member's decline or answer leaves
         the call live and me still invited — only MY action on another device,
         or the call actually ending, clears the ring. A frame without a userId
         keeps the old clear-on-anything behavior (the 1:1 wire). */
      const mine = evt.userId != null && user?.id != null && String(evt.userId) === String(user.id)
      if (evt.type !== 'call.ended' && evt.userId != null && !mine) return
      /* THE call-log writer of record. Every call in my conversations ends
         with a `call.ended` frame on this always-mounted banner, whatever
         screen is up — so EVERY session lands in the log: outgoing calls
         backgrounded before they ended, incoming rings never opened,
         answered calls whose room was already closed. Direction is inferred
         from the initiator (logFromCall), and appendCallLog upserts by
         callId, so a call surface that also logged wins nothing and loses
         nothing. */
      if (evt.type === 'call.ended' && evt.call) {
        appendCallLog(logFromCall(evt.call, user?.id))
      }
      setRinging(prev => (prev && (!id || prev.callId === id) ? null : prev))
      stopRinging()
      /* The ring notification must not outlive the call. */
      if (id) { dismissCallNotification(id); cancelIncomingCall(id) }
    }
  })

  /* Mid-ring surface handoff. The ring lives on exactly one surface at a
     time: frontmost, the strip and its ringtone; otherwise, the OS call
     notification (full-screen on Android). Backgrounding hands over — without
     this a pocketed phone keeps looping the in-app ringtone with no strip to
     answer from. Coming BACK is a take-over, not a revival: a user returning
     to a phone that is still ringing lands on the full-screen ringing screen
     (the WhatsApp grammar), not a strip floating over whatever screen they
     left behind. Deferred a beat so a notification tap's own route
     (onForegroundEvent → openCallRoute, which clears the ring state) wins the
     race and turns the take-over into a no-op; the shade ring keeps sounding
     through the beat, and openCallRoute retires it. */
  React.useEffect(() => {
    if (!ringing) return
    const { callId, type, callerName, callerAvatar } = ringing
    let takeover: ReturnType<typeof setTimeout> | null = null
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        takeover = setTimeout(() => {
          takeover = null
          if (ringingRef.current?.callId !== callId) return
          if (pathnameRef.current?.startsWith('/call')) return
          openCallRoute({ callId, href: `/call/${callId}/incoming` })
        }, 350)
      } else {
        if (takeover) { clearTimeout(takeover); takeover = null }
        stopRinging()
        const body = type === 'VIDEO' ? 'Incoming video call' : 'Incoming voice call'
        const present = Platform.OS === 'android' ? presentIncomingCall : notifyIncomingCall
        void present({ callId, title: callerName, body, avatarUrl: callerAvatar })
      }
    })
    return () => { if (takeover) clearTimeout(takeover); sub.remove() }
  }, [ringing, stopRinging, openCallRoute])

  /* The cap that guarantees "closed call, silent phone" even when the
     `call.ended` frame never arrives — see RING_CAP_MS. Keyed on the callId,
     not the ringing object, so a late name resolve does not restart the
     clock. */
  const cappedCallId = ringing?.callId ?? null
  React.useEffect(() => {
    if (!cappedCallId) return
    const cap = setTimeout(() => {
      setRinging(prev => (prev && prev.callId === cappedCallId ? null : prev))
      stopRinging()
      dismissCallNotification(cappedCallId)
      cancelIncomingCall(cappedCallId)
    }, RING_CAP_MS)
    return () => clearTimeout(cap)
  }, [cappedCallId, stopRinging])

  const accept = () => {
    if (!ringing) return
    const { callId } = ringing
    setRinging(null)
    stopRinging()
    dismissCallNotification(callId)
    cancelIncomingCall(callId)
    router.push(`/call/${callId}?answer=1`)
  }

  const decline = async () => {
    if (!ringing) return
    const { callId } = ringing
    setRinging(null)
    stopRinging()
    dismissCallNotification(callId)
    cancelIncomingCall(callId)
    try { await api.chat.calls.decline(callId) }
    catch { toast.warn('Could not decline the call.') }
  }

  if (!ringing) return null
  const c = t.colors

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeInUp.duration(240)}
      exiting={t.prefs.reducedMotion ? undefined : FadeOutUp.duration(180)}
      style={[
        styles.wrap,
        { top: insets.top + 6, zIndex: t.zIndex.callBanner },
      ]}
    >
      <Touchable
        onPress={accept}
        feedback="scale"
        noAutoHitSlop
        accessibilityLabel={`Incoming ${ringing.type === 'VIDEO' ? 'video' : 'voice'} call from ${ringing.callerName}. Tap to answer.`}
        /* Depth is the drawn rule, never a shadow: the strip floats over
           arbitrary screens, so it is a raised surface fenced by a 1px
           borderStrong course (DESIGN.md §6 "Surface raised"). */
        style={[
          styles.card,
          { backgroundColor: c.surfaceRaised, borderColor: c.borderStrong },
        ]}
      >
        <Avatar uri={ringing.callerAvatar} name={ringing.callerName} seed={ringing.callerId} size={44} />

        <View style={styles.flex}>
          <Text variant="bodyStrong" align="ui" numberOfLines={1}>{ringing.callerName}</Text>
          <View style={styles.subRow}>
            <Icon name={ringing.type === 'VIDEO' ? 'videoCall' : 'call'} size={12} color={c.textMuted} />
            <Text variant="footnote" tone="muted" align="ui">
              Incoming {ringing.type === 'VIDEO' ? 'video' : 'voice'} call
            </Text>
          </View>
        </View>

        <Touchable
          onPress={decline}
          haptic="warning"
          feedback="scale"
          accessibilityLabel="Decline call"
          style={[styles.circle, { backgroundColor: c.danger }]}
        >
          {/* Status-plate ink: off-white in light; dark ink on the light dark-scheme plates. */}
          <Icon name="callEnd" size={19} color={c.textOnDanger} />
        </Touchable>

        <Touchable
          onPress={accept}
          haptic="success"
          feedback="scale"
          accessibilityLabel="Answer call"
          style={[styles.circle, { backgroundColor: c.success }]}
        >
          <Icon name={ringing.type === 'VIDEO' ? 'videoCall' : 'call'} size={19} color={c.textOnDanger} filled />
        </Touchable>
      </Touchable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderWidth: 1,
    ...setback(shape.card),
    borderCurve: 'continuous',
  },
  flex: { flex: 1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xxs },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
