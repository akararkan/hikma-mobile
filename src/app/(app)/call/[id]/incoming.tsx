/* =========================================================
   Incoming call.

   Pushed by the global `call.incoming` listener, but it must
   also survive being opened COLD — from a missed-call tap or a
   deep link — so nothing here assumes a handed-over call
   object. Everything is re-read from `calls.get`.

   Three things this screen deliberately does NOT do:

   1. It does not capture anything. The media engine belongs to
      the call room, which builds it on arrival — a ring that
      opened the microphone before the user answered would be
      exactly the wrong instinct. The amber strip appears only
      in a build with no engine at all, where the user is about
      to answer into silence and deserves to know first.
   2. It does not play a ringtone file. There is no bundled
      audio asset and a foreground app that dings over the
      user's music is worse behaviour than a haptic; `chime`
      already encodes that decision for the whole app.
   3. It does not offer a back gesture. The only exits are the
      three buttons or a terminal `call.ended` — a ring you can
      swipe away without answering or declining leaves the
      caller listening to nothing.
   ========================================================= */
import React from 'react'
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, FadeIn,
} from 'react-native-reanimated'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNetworkError, isNotFound } from '@/api'
import { mockEnabled } from '@/mock/flag.js'
import { chime } from '@/lib/chime'
import { dismissCallNotification } from '@/lib/pushNotify'
import { cancelIncomingCall } from '@/lib/callNotifee'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, setback, shape, space } from '@/theme/tokens'
import { Avatar, Button, Icon, Skeleton, Text, Touchable, fireHaptic } from '@/ui'
import { MediaEngineNotice } from '@/components/call/MediaEngineNotice'
import { Halo, RingingDots } from '@/components/call/CallVisuals'
import { appendCallLog, logFromCall } from '@/components/call/callStore'
import { FILL, ROOM, RING_SCRIM } from '@/components/live/skin'
import { hasWebRTC, type Call } from '@/components/call/types'

/** The server sweeps a ring to MISSED after ≥60s (checked every 20s). */
const RING_WINDOW_MS = 60_000
const HAPTIC_EVERY_MS = 1500

type Terminal = { title: string; body?: string; final?: boolean } | null

export default function IncomingCallScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const callId = id ? String(id) : ''

  const [call, setCall] = React.useState<Call | null>(null)
  const [convo, setConvo] = React.useState<any>(null)
  const [caller, setCaller] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<any>(null)
  const [terminal, setTerminal] = React.useState<Terminal>(null)
  const [someoneAnswered, setSomeoneAnswered] = React.useState(false)
  const [busy, setBusy] = React.useState<'accept' | 'decline' | null>(null)

  const demo = React.useMemo(() => mockEnabled(), [])
  const ringing = !terminal && !error && call?.status === 'RINGING'

  /* ---------- seed ---------- */
  React.useEffect(() => {
    if (!callId || demo) { setLoading(false); return }
    let alive = true
    void (async () => {
      try {
        const c = (await api.chat.calls.get(callId)) as Call
        if (!alive) return
        setCall(c)
        setLoading(false)
        if (!c.live) {
          setTerminal({ title: endedTitle(c.status) })
          return
        }
        if (c.conversationId) {
          try {
            const cv = await api.chat.conversations.get(c.conversationId)
            if (alive) setConvo(cv)
          } catch {
            /* The conversation can 404 independently of the call (removed from
               a group mid-ring). Fall back to the caller's own profile. */
            if (c.initiatorId) {
              try { const u = await api.users.get(c.initiatorId); if (alive) setCaller(u) } catch { /* ignore */ }
            }
          }
        }
      } catch (e: any) {
        if (!alive) return
        setLoading(false)
        if (isNotFound(e)) {
          setTerminal({ title: 'This call has ended' })
          setTimeout(() => { if (alive) router.back() }, 1500)
          return
        }
        setError(e)
      }
    })()
    return () => { alive = false }
  }, [callId, demo, router])

  /* Landing here (usually from the ring notification's tap) retires the OS
     banner — this screen IS the ring surface now. */
  React.useEffect(() => { dismissCallNotification(callId); cancelIncomingCall(callId) }, [callId])

  /* ---------- ring cadence ----------
     Stops on any status change, on unmount, and when the app leaves the
     foreground — a phone that keeps buzzing in a pocket after the caller hung
     up is the failure mode this guards. */
  React.useEffect(() => {
    if (!ringing) return
    let stopped = false
    chime('call')
    const beat = setInterval(() => { if (!stopped) fireHaptic('heavy') }, HAPTIC_EVERY_MS)
    /* Bounded even if no terminal frame ever lands (a dropped stream): past
       the server's own ring window the call is MISSED, so the pulse stops. */
    const cap = setTimeout(() => { stopped = true; clearInterval(beat) }, RING_WINDOW_MS)
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') { stopped = true; clearInterval(beat) }
    })
    return () => { stopped = true; clearInterval(beat); clearTimeout(cap); sub.remove() }
  }, [ringing])

  /* ---------- realtime ---------- */
  useChatEvents(evt => {
    const type = String(evt?.type || '')
    if (!type.startsWith('call.')) return
    if (evt.callId && String(evt.callId) !== callId) return

    if (type === 'call.ended') {
      if (evt.call) appendCallLog(logFromCall(evt.call, user?.id, 'IN'))
      setTerminal({ title: endedTitle(evt.call?.status) })
      return
    }
    if (type === 'call.declined') {
      /* Group only — a 1:1 decline ends the call and arrives as `call.ended`.
         Another member declining drops THEM, not me: the call is still live
         and my ring stands (calls.md — "group → you drop out"). Only my own
         decline on another device retires this surface. */
      if (evt.userId && String(evt.userId) === String(user?.id ?? '')) {
        if (router.canGoBack()) router.back()
      }
      return
    }
    if (type === 'call.accepted') {
      const who = evt.userId ? String(evt.userId) : null
      const group = !!convo?.isGroup
      /* An accept by ME means another of my own devices picked up — my ring
         here is stale, DM or group. In a group someone ELSE answering is
         normal: the ring stands and the line below says the call is already
         under way. */
      if (!group || (who && who === String(user?.id ?? ''))) { if (router.canGoBack()) router.back() }
      else if (who) setSomeoneAnswered(true)
    }
  })

  React.useEffect(() => {
    if (!terminal || terminal.final) return
    const id2 = setTimeout(() => { if (router.canGoBack()) router.back() }, 2500)
    return () => clearTimeout(id2)
  }, [terminal, router])

  /* ---------- actions ---------- */
  const accept = async (withVideo: boolean) => {
    if (!callId || busy) return
    setBusy('accept')
    fireHaptic('heavy')
    try {
      await api.chat.calls.accept(callId)
      router.replace({ pathname: '/call/[id]', params: { id: callId, video: withVideo ? '1' : '0' } })
    } catch (e: any) {
      setBusy(null)
      /* The call died between the ring and the tap — a terminal card, never a
         toast: the user is looking straight at this surface. Accepting an
         inactive call is a 400 ("This call is no longer active."). */
      if (isNotFound(e) || e?.status === 400) setTerminal({ title: 'Call ended' })
      else setError(e)
    }
  }

  const decline = async (then?: () => void) => {
    if (!callId) return
    setBusy('decline')
    fireHaptic('heavy')
    /* Optimistic: decline is best-effort by design (the server sweeps the ring
       either way) and making the user wait on it is the wrong trade. */
    void api.chat.calls.decline(callId).catch(() => {})
    if (then) then()
    else if (router.canGoBack()) router.back()
  }

  /* ---------- identity ---------- */
  const group = !!convo?.isGroup
  const peer = convo?.peer ?? caller ?? null
  const name = group
    ? (convo?.displayTitle || 'Group call')
    : (peer?.full || caller?.full || 'Incoming call')
  const sub = group
    ? `${convo?.memberCount ?? 0} people`
    : peer?.handle ? `@${peer.handle}` : ''
  const avatar = group ? convo?.avatarUrl ?? null : peer?.profileImage ?? null
  const seed = group ? convo?.id : (peer?.id ?? call?.initiatorId)
  const offline = isNetworkError(error)

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
          headerShown: false,
        }}
      />
      <StatusBar style="light" />

      {/* Backdrop: the caller's own picture under a flat scrim, so the screen
          belongs to a person without competing with the buttons. It used to be
          blurred twice over — QELAT has no blur (DESIGN.md §8.7), so the veil
          does the work a defocus used to, and costs one flat fill instead of
          two full-screen blur passes. */}
      {avatar ? (
        <>
          <Image source={{ uri: avatar }} style={FILL} contentFit="cover" />
          <View style={[FILL, { backgroundColor: ROOM.glassStrong }]} />
        </>
      ) : (
        <View style={[FILL, { backgroundColor: ROOM.bg }]}>
          <Avatar uri={null} name={name} seed={seed} size={900} />
        </View>
      )}
      <LinearGradient colors={RING_SCRIM} locations={[0, 0.4, 1]} style={FILL} />

      {ringing ? <RingTimeoutBar top={insets.top} startedAt={call?.startedAt} /> : null}

      {demo ? (
        <Centered insetTop={insets.top}>
          <Icon name="call" size={40} color={ROOM.fgGhost} />
          <Text variant="title3" color={ROOM.fg} align="center" style={styles.gap}>
            Calls aren&apos;t part of the demo fixture
          </Text>
          <Text variant="footnote" color={ROOM.fgMuted} align="center">
            Turn the demo data off to ring a real conversation.
          </Text>
          <Button label="Close" onPress={() => router.back()} variant="secondary" size="md" style={styles.gapLg} />
        </Centered>
      ) : terminal ? (
        <Centered insetTop={insets.top}>
          <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(240))} style={styles.center}>
            <View style={[styles.terminalGlyph, { backgroundColor: ROOM.fill }]}>
              <Icon name="callEnd" size={28} color={ROOM.fgMuted} />
            </View>
            <Text variant="title3" color={ROOM.fg} align="center" style={styles.gap}>{terminal.title}</Text>
            {terminal.body ? (
              <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.terminalBody}>{terminal.body}</Text>
            ) : null}
            <View style={styles.terminalRow}>
              {terminal.final ? (
                <Button label="Close" onPress={() => router.back()} variant="secondary" size="md" />
              ) : (
                <>
                  {/* onDark: a navy primary on this black ground is invisible
                      — the exact failure the variant exists to prevent. */}
                  <Button
                    label="Call back"
                    onPress={() => {
                      if (!call?.conversationId) return
                      router.replace({
                        pathname: '/call/[id]',
                        params: { id: 'new', convId: String(call.conversationId), type: call.type },
                      })
                    }}
                    variant="onDark"
                    size="md"
                    disabled={!call?.conversationId}
                  />
                  <Button
                    label="Message"
                    onPress={() => call?.conversationId && router.replace(`/chat/${call.conversationId}`)}
                    variant="secondary"
                    size="md"
                    disabled={!call?.conversationId}
                  />
                </>
              )}
            </View>
          </Animated.View>
        </Centered>
      ) : error && !offline ? (
        <Centered insetTop={insets.top}>
          <Text variant="title3" color={ROOM.fg} align="center">Can&apos;t answer this call</Text>
          <Text variant="callout" color={ROOM.fgMuted} align="center" style={styles.gap}>{errorText(error)}</Text>
          <Button label="Close" onPress={() => router.back()} variant="secondary" size="md" style={styles.gapLg} />
        </Centered>
      ) : (
        <>
          <View style={[styles.topBlock, { paddingTop: insets.top + 48 }]}>
            {/* `micro` already uppercases Latin inside the Text primitive and
                leaves Arabic script alone — the eyebrow is written in sentence
                case so a translated string is never force-capped. Sky once the
                ring is known: the web's live-status tint. */}
            <Text variant="micro" color={loading ? ROOM.fgMuted : ROOM.accent} align="center">
              {loading ? 'Connecting' : `Incoming ${call?.video ? 'video' : 'voice'} call`}
            </Text>

            <View style={styles.avatarSlot}>
              {loading ? (
                <Skeleton circle width={128} height={128} />
              ) : group ? (
                <GroupCluster convo={convo} />
              ) : (
                <>
                  {/* Sky rings, the web's `.cl-ring` tint — chrome for "this
                      is happening", never a presence green. */}
                  <Halo size={128} active={ringing} color={ROOM.accent} />
                  <View style={[styles.avatarRing, { borderColor: ROOM.hairline }]}>
                    <Avatar uri={avatar} name={name} seed={seed} size={128} />
                  </View>
                </>
              )}
            </View>

            {loading ? (
              <Skeleton width={180} height={24} style={styles.gapLg} />
            ) : (
              <Text variant="title1" color={ROOM.fg} align="center" numberOfLines={1} style={styles.name}>
                {name}
              </Text>
            )}
            {sub ? <Text variant="callout" color={ROOM.fgMuted} align="center">{sub}</Text> : null}
            <View style={styles.gap}>
              {loading ? (
                <Text variant="footnote" color={ROOM.fgMuted} align="center">Connecting…</Text>
              ) : someoneAnswered ? (
                <Text variant="footnote" color={ROOM.fgMuted} align="center">Someone else answered</Text>
              ) : (
                <RingingDots />
              )}
            </View>
          </View>

          {!hasWebRTC ? (
            <View style={styles.stripSlot}>
              <MediaEngineNotice variant="ring" />
            </View>
          ) : null}

          {offline ? (
            /* `live`, not `danger`: dark-palette danger is a pale text tone
               and cannot hold white ink as a plate. */
            <View style={[styles.offlineStrip, { backgroundColor: ROOM.live }]}>
              <Text variant="footnote" color={ROOM.fg} align="center">You&apos;re offline — can&apos;t answer</Text>
            </View>
          ) : null}

          <View style={[styles.actions, { paddingBottom: insets.bottom + 40 }]}>
            {call?.video ? (
              <Touchable
                onPress={() => accept(false)}
                disabled={loading || !!busy || offline}
                haptic="medium"
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel="Answer without video"
                style={styles.audioOnly}
              >
                <View style={[styles.smallCircle, { backgroundColor: ROOM.fillStrong }]}>
                  <Icon name="videoOff" size={22} color={ROOM.fg} />
                </View>
                <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.actionLabel}>
                  Answer without video
                </Text>
              </Touchable>
            ) : null}

            <View style={styles.actionRow}>
              <ActionCircle
                icon="chat"
                label="Message"
                size={44}
                tint={ROOM.fillStrong}
                disabled={loading || !call?.conversationId}
                onPress={() => decline(() => router.replace(`/chat/${call?.conversationId}`))}
                accessibilityLabel="Decline and open the chat"
              />
              {/* The web's exact pair: hang-up wears the live red — the dark
                  palette's `danger` is a pale TEXT tone that cannot carry
                  white ink as a plate. Accept is the deep success step for the
                  same reason (dark-skin surfaces may read ramp steps,
                  DESIGN.md §1); pale `success` stays for dots and text. */}
              <ActionCircle
                icon="callEnd"
                label="Decline"
                size={72}
                tint={ROOM.live}
                disabled={loading || busy === 'accept'}
                onPress={() => decline()}
                accessibilityLabel="Decline the call"
              />
              <ActionCircle
                icon={call?.video ? 'videoCall' : 'call'}
                label="Accept"
                size={72}
                tint={ramp.green[500]}
                pulse={ringing && !offline}
                disabled={loading || !!busy || offline}
                onPress={() => accept(!!call?.video)}
                accessibilityLabel="Accept the call"
              />
            </View>
          </View>
        </>
      )}
    </View>
  )
}

/* ---------------------------------------------------------
   Pieces
   --------------------------------------------------------- */

function Centered({ children, insetTop }: { children: React.ReactNode; insetTop: number }) {
  return <View style={[styles.centered, { paddingTop: insetTop }]}>{children}</View>
}

/* The callee's word for each terminal status (calls.md §Lifecycle): MISSED is
   a ring that ran out on me, CANCELLED is the caller hanging up mid-ring,
   DECLINED is an answer (mine, from another device), everything else simply
   ended. */
function endedTitle(status: string | undefined): string {
  if (status === 'CANCELLED') return 'Call cancelled'
  if (status === 'MISSED') return 'Missed call'
  if (status === 'DECLINED') return 'Call declined'
  return 'Call ended'
}

/** The 60s ring window, drawn. It is the only signal that a ring is finite. */
function RingTimeoutBar({ top, startedAt }: { top: number; startedAt: string | null | undefined }) {
  const t = useTheme()
  const p = useSharedValue(0)

  React.useEffect(() => {
    const began = startedAt ? Date.parse(startedAt) : Date.now()
    const elapsed = Number.isFinite(began) ? Math.max(0, Date.now() - began) : 0
    const left = Math.max(0, RING_WINDOW_MS - elapsed)
    p.value = Math.min(1, elapsed / RING_WINDOW_MS)
    if (t.prefs.reducedMotion || left <= 0) return
    p.value = withTiming(1, { duration: left, easing: Easing.linear })
    return () => cancelAnimation(p)
  }, [p, startedAt, t.prefs.reducedMotion])

  /* scaleX, not width. An animated width relayouts the strip on every frame of
     the 60s this bar is alive — and it is alive on the one screen that is
     simultaneously negotiating ICE, so the frames it steals are the frames the
     connection needs. A transform is composited and costs layout nothing.
     scaleX is legal HERE only because the fill is a plain square-cornered rect:
     the moment it grows a radius the end cap stretches into an oval and this
     has to become the clip-translate technique (see StoryProgressBar). The
     origin is PHYSICAL — RTL has to be told which end is the beginning. */
  const origin = t.isRTL ? 'right' : 'left'
  const anim = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(1, Math.max(0, p.value)) }],
  }))

  return (
    <View style={[styles.timeoutTrack, { top: top }]} pointerEvents="none">
      <Animated.View
        style={[styles.timeoutFill, { backgroundColor: ROOM.fgFaint, transformOrigin: origin }, anim]}
      />
    </View>
  )
}

function GroupCluster({ convo }: { convo: any }) {
  const extra = Math.max(0, (convo?.memberCount ?? 0) - 3)
  return (
    <View style={styles.cluster}>
      <Halo size={112} color={ROOM.accent} />
      {[0, 1, 2].map(i => (
        <View key={i} style={[styles.clusterFace, { marginStart: i ? -16 : 0, borderColor: ROOM.bg }]}>
          <Avatar uri={i === 0 ? convo?.avatarUrl ?? null : null} name={convo?.displayTitle} seed={`${convo?.id}-${i}`} size={56} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.clusterMore, { backgroundColor: ROOM.fillStrong }]}>
          <Text variant="caption" color={ROOM.fg}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  )
}

function ActionCircle({
  icon, label, size, tint, onPress, disabled, pulse, accessibilityLabel,
}: {
  icon: 'call' | 'callEnd' | 'chat' | 'videoCall'
  label: string
  size: number
  tint: string
  onPress: () => void
  disabled?: boolean
  pulse?: boolean
  accessibilityLabel: string
}) {
  const t = useTheme()
  const s = useSharedValue(1)

  React.useEffect(() => {
    if (!pulse || t.prefs.reducedMotion) { s.value = 1; return }
    s.value = withRepeat(withTiming(1.06, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(s)
  }, [s, pulse, t.prefs.reducedMotion])

  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }))

  return (
    <View style={styles.actionSlot}>
      <Touchable
        onPress={onPress}
        disabled={disabled}
        haptic="heavy"
        feedback="scale"
        noAutoHitSlop
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !!disabled }}
      >
        <Animated.View
          style={[
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: tint,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.4 : 1,
            },
            anim,
          ]}
        >
          <Icon name={icon} size={size >= 72 ? 30 : 20} color={ROOM.fg} filled={icon !== 'callEnd'} />
        </Animated.View>
      </Touchable>
      <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.actionLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ROOM.bg },
  topBlock: { alignItems: 'center', paddingHorizontal: space.xxl },
  avatarSlot: { marginTop: 26, alignItems: 'center', justifyContent: 'center' },
  /* Rings around faces and icon-only glyph circles: sanctioned circles, the
     one thing QELAT keeps round alongside dots and spinners. */
  avatarRing: { borderWidth: 3, borderRadius: 999, padding: 0 },
  name: { marginTop: space.xxl },
  gap: { marginTop: space.sm },
  gapLg: { marginTop: space.xl },
  center: { alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxxl },
  terminalGlyph: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  terminalBody: { marginTop: space.xs, maxWidth: 300 },
  terminalRow: { flexDirection: 'row', gap: space.sm2, marginTop: 22 },
  stripSlot: { position: 'absolute', left: 0, right: 0, top: '62%' },
  offlineStrip: { position: 'absolute', left: 0, right: 0, top: '70%', height: 32, justifyContent: 'center' },
  actions: { marginTop: 'auto', paddingHorizontal: space.xl },
  actionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  actionSlot: { alignItems: 'center' },
  actionLabel: { marginTop: space.md },
  audioOnly: { alignSelf: 'center', alignItems: 'center', marginBottom: space.xxl },
  smallCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  timeoutTrack: { position: 'absolute', left: 0, right: 0, height: 2 },
  /* Laid out full-width ONCE and then scaled — the width is no longer the
     animated property, so this never re-measures. No radius, deliberately:
     see the origin comment in RingTimeoutBar. */
  timeoutFill: { height: 2, width: '100%' },
  cluster: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  clusterFace: { borderWidth: 2, borderRadius: 999 },
  /* A text-bearing overflow plate, so it wears the chip setback — the round
     things on this screen are the faces and the action circles. */
  clusterMore: {
    marginStart: -space.md,
    height: 24,
    minWidth: 34,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs2,
  },
})
