/* =========================================================
   The call room.

   One screen for outgoing-ringing, connecting and ongoing, 1:1
   and group. It owns the control dock, the participant grid,
   the duration timer, hang-up — and the media plane, which is
   `createCallEngine` from src/lib/callEngine.

   THE SIGNALLING. `calls.signal()` is a blind relay: the
   payload is an opaque string the server never parses, so both
   ends of the negotiation are ours. Frames go straight to the
   engine — except a frame can arrive before the engine exists
   (the relay does not wait for our capture), so the bounded
   buffer stays and is drained the moment `start()` resolves.

   THE CAPTURE IS SCREEN-SCOPED, DELIBERATELY. Every path out
   of this screen stops the engine: hang-up, a terminal event,
   unmount, minimise. A camera light that stays on after a
   hang-up is the worst bug this surface can have, and it is
   worth the cost — minimise keeps the CALL alive on the server
   but not the media, and re-entering re-negotiates.

   `hasWebRTC` is still the gate. It is true in this build, but
   a build that strips the native module has nothing to mute
   and nothing to send, and it must say so rather than show a
   call that looks connected and is silent.
   ========================================================= */
import React from 'react'
import {
  AppState, FlatList, Linking, StyleSheet, View, useWindowDimensions,
  type AppStateStatus,
} from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  FadeIn, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { mockEnabled } from '@/mock/flag.js'
import { createCallEngine, type CallEngine, type PeerState } from '@/lib/callEngine'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents, useRealtimeConnection } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { useEvent } from '@/hooks/useAsync'
import {
  Avatar, Button, Icon, Sheet, Skeleton, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import { CallControlDock, type DockKey } from '@/components/call/CallControlDock'
import { CallParticipantTile, type TileUser } from '@/components/call/CallParticipantTile'
import { DeadLevelMeter, Halo, RingingDots } from '@/components/call/CallVisuals'
import { MediaEngineNotice } from '@/components/call/MediaEngineNotice'
import { releaseCallAudio, setCallAudioRoute } from '@/components/call/audioRoute'
import {
  appendCallLog, bufferSignal, clearActiveCall, logFromCall, setActiveCall, takeSignals,
} from '@/components/call/callStore'
import { hasWebRTC, sameId, secondsSince, type Call, type CallParticipant } from '@/components/call/types'
import { ROOM } from '@/components/live/skin'
import { clock } from '@/components/live/types'

/** Gap between two tiles in the participant grid — 6pt seams, the web stage's. */
const GUTTER = 3

/* Module scope so the identity holds still across every render of the room.
   The old fallback was `Math.random()`, which handed a participant with no
   userId a brand-new key on every pass and remounted its RTCView with it. */
const tileKey = (p: CallParticipant, index: number) => String(p.userId ?? `slot-${index}`)

export default function CallScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { user } = useAuth()
  const { epoch } = useRealtimeConnection()

  const params = useLocalSearchParams<{
    id: string; convId?: string; type?: string; video?: string; answer?: string
  }>()
  const routeId = params.id ? String(params.id) : ''
  const isNew = routeId === 'new'
  const demo = React.useMemo(() => mockEnabled(), [])

  const [call, setCall] = React.useState<Call | null>(null)
  const [convo, setConvo] = React.useState<any>(null)
  const [people, setPeople] = React.useState<Record<string, TileUser>>({})
  const [loading, setLoading] = React.useState(!demo)
  const [error, setError] = React.useState<any>(null)
  const [ended, setEnded] = React.useState<{ label: string } | null>(null)
  const [tick, setTick] = React.useState(0)
  const [roster, setRoster] = React.useState(false)

  /* ---------- media plane ---------- */
  const [localStream, setLocalStream] = React.useState<any>(null)
  const [remoteStreams, setRemoteStreams] = React.useState<Record<string, any>>({})
  const [peerStates, setPeerStates] = React.useState<Record<string, PeerState>>({})
  const [mediaUp, setMediaUp] = React.useState(false)
  const [mediaError, setMediaError] = React.useState<string | null>(null)
  const [mediaAttempt, setMediaAttempt] = React.useState(0)
  const [micOn, setMicOn] = React.useState(true)
  const [cameraOn, setCameraOn] = React.useState(true)
  const [speakerOn, setSpeakerOn] = React.useState(false)
  const [facing, setFacing] = React.useState<'user' | 'environment'>('user')

  const callId = call?.id ? String(call.id) : (isNew ? '' : routeId)
  const meId = user?.id ? String(user.id) : null
  const startedRef = React.useRef(false)
  const answeredRef = React.useRef(false)
  /* "Minimize" pops the route without ending the call; the unmount cleanup has
     to know which of the two happened. */
  const keepAlive = React.useRef(false)

  const engineRef = React.useRef<CallEngine | null>(null)
  /* Not `mediaUp` — a relayed frame arrives outside React and cannot wait a
     render for the flag to commit. */
  const captureReady = React.useRef(false)
  const participantsRef = React.useRef<CallParticipant[]>([])
  participantsRef.current = call?.participants ?? []

  /* The callee can answer a video call with the camera off (the ring screen's
     "Answer without video"), and that decision has to reach the capture — not
     just the UI — or the camera opens anyway. */
  const wantVideo = !!call?.video && params.video !== '0'

  /* ---------- joining ----------
     `accept` is the ONLY join (calls.md §Endpoints): POST /conversations/{id}/
     calls merely RETURNS an in-progress call, it does not put you in it. So
     walking into a group call that is already running — from the chat header,
     a deep link, or after having left — used to leave the roster saying you
     are not here, which is exactly what the other peers negotiate against.
     Anyone whose own row is not JOINED on a live call is joined here. The
     initiator's row is already JOINED at create time, so a fresh outgoing call
     never reaches the POST. */
  const ensureJoined = React.useCallback(async (c: Call): Promise<Call> => {
    if (demo || !c?.live) return c
    const mine = (c.participants ?? []).find(p => sameId(p.userId, meId))
    if (!mine || mine.state === 'JOINED') return c
    if (answeredRef.current) return c
    answeredRef.current = true
    try {
      return (await api.chat.calls.accept(String(c.id))) as Call
    } catch (e: any) {
      /* Gone between the read and the join. Anything else is the server's own
         sentence (removed from the conversation mid-call, say) — surfaced, not
         reworded. */
      if (isNotFound(e)) setEnded({ label: 'This call has ended' })
      else setError(e)
      return c
    }
  }, [demo, meId])

  /* ---------- outgoing: start once ---------- */
  React.useEffect(() => {
    if (!isNew || startedRef.current || demo) return
    const convId = params.convId ? String(params.convId) : ''
    if (!convId) { setLoading(false); setError(new Error('Missing conversation')); return }
    startedRef.current = true
    void (async () => {
      try {
        const started = (await api.chat.calls.start(convId, params.type === 'VIDEO' ? 'VIDEO' : 'VOICE')) as Call
        /* Starting a call that is ALREADY running hands back that call
           untouched — in a group that is the ordinary "join the call in
           progress" path, and it needs the accept the start did not perform. */
        const c = await ensureJoined(started)
        setCall(c)
        setLoading(false)
        appendCallLog(logFromCall(c, meId, 'OUT'))
        router.setParams({ id: String(c.id) })
      } catch (e: any) {
        setLoading(false)
        setError(e)
      }
    })()
  }, [isNew, demo, params.convId, params.type, meId, router, ensureJoined])

  /* ---------- incoming / deep link: read ---------- */
  const load = React.useCallback(async () => {
    if (!routeId || isNew || demo) return
    try {
      const c = (await api.chat.calls.get(routeId)) as Call
      setCall(await ensureJoined(c))
      setLoading(false)
      if (!c.live) setEnded({ label: terminalLabel(c.status) })
    } catch (e: any) {
      setLoading(false)
      if (isNotFound(e)) setEnded({ label: 'This call has ended' })
      else setError(e)
    }
  }, [routeId, isNew, demo, ensureJoined])

  React.useEffect(() => { void load() }, [load])

  /* A reconnect can have hidden a status change; re-read rather than trust a
     socket that was down. */
  const firstEpoch = React.useRef(true)
  React.useEffect(() => {
    if (firstEpoch.current) { firstEpoch.current = false; return }
    if (!ended) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

  /* ---------- answer=1 (the banner's Accept) ---------- */
  React.useEffect(() => {
    if (params.answer !== '1' || answeredRef.current || !routeId || isNew || demo) return
    answeredRef.current = true
    void (async () => {
      try { setCall((await api.chat.calls.accept(routeId)) as Call) }
      catch (e: any) { if (isNotFound(e)) setEnded({ label: 'This call has ended' }) }
    })()
  }, [params.answer, routeId, isNew, demo])

  /* ---------- conversation + names ---------- */
  React.useEffect(() => {
    const convId = call?.conversationId ?? (params.convId ? String(params.convId) : null)
    if (!convId || demo) return
    let alive = true
    void (async () => {
      try {
        const cv = await api.chat.conversations.get(convId)
        if (!alive) return
        setConvo(cv)
        if (!cv?.isGroup) {
          const peer = cv?.peer
          if (peer?.id) {
            setPeople(p => ({
              ...p,
              [String(peer.id)]: { full: peer.full, handle: peer.handle, avatar: peer.profileImage },
            }))
          }
          return
        }
        const page = await api.chat.members.list(convId, { page: 0, size: 256 })
        if (!alive) return
        const map: Record<string, TileUser> = {}
        for (const m of page?.items || []) {
          if (!m?.userId) continue
          map[String(m.userId)] = {
            full: m._author?.full || m.fullName || m.username,
            handle: m.handle,
            avatar: m._author?.profileImage ?? null,
          }
        }
        setPeople(p => ({ ...map, ...p }))
      } catch { /* names are decoration; the tiles fall back to initials */ }
    })()
    return () => { alive = false }
  }, [call?.conversationId, params.convId, demo])

  /* A participant who is in the call but not in the member page (removed from
     the group mid-call) still needs a name. */
  React.useEffect(() => {
    const missing = (call?.participants || [])
      .map(p => (p.userId ? String(p.userId) : ''))
      .filter(uid => uid && !people[uid])
    if (!missing.length || demo) return
    let alive = true
    void (async () => {
      for (const uid of missing.slice(0, 8)) {
        try {
          const u: any = await api.users.get(uid)
          if (!alive) return
          if (!u) continue
          setPeople(p => (p[uid] ? p : { ...p, [uid]: { full: u.full, handle: u.handle, avatar: u.profileImage } }))
        } catch { /* ignore */ }
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.participants, demo])

  /* ---------- the media plane ----------
     Built the moment the call is answerable — a live call, a known id and a
     known me — and torn down by the same effect the instant any of those stop
     being true, which is what makes `ended` and unmount both release the
     capture. */
  const engineWanted = hasWebRTC && !demo && !ended && !!call?.live && !!callId && !!meId

  React.useEffect(() => {
    if (!engineWanted || !callId || !meId) return
    let alive = true

    const engine = createCallEngine({
      callId,
      myId: meId,
      video: wantVideo,
      handlers: {
        onRemotes: rs => {
          if (!alive) return
          const next: Record<string, any> = {}
          for (const r of rs) next[String(r.userId)] = r.stream
          setRemoteStreams(next)
        },
        onPeerState: (uid, state) => {
          if (alive) setPeerStates(prev => (prev[uid] === state ? prev : { ...prev, [uid]: state }))
        },
        onLocalStream: s => { if (alive) setLocalStream(s) },
        onError: msg => { if (alive) setMediaError(msg) },
      },
    })
    engineRef.current = engine

    void (async () => {
      try {
        await engine.start()
      } catch (e: any) {
        if (alive) setMediaError(e?.message || 'Your microphone could not be opened.')
        return
      }
      /* The screen can go while the OS is still asking for permission. The
         devices are open by now, so they have to be closed here — the cleanup
         below already ran. */
      if (!alive) { engine.stop(); return }

      captureReady.current = true
      setMediaError(null)
      setMediaUp(true)
      /* A fresh capture hands back enabled tracks, so the dock has to agree
         with it — this is the only place the two can drift. */
      setMicOn(true)
      setCameraOn(true)
      setFacing('user')
      /* Video calls belong on the loudspeaker (nobody holds a phone to their
         ear to watch it); voice calls belong on the earpiece. */
      setSpeakerOn(wantVideo)
      setCallAudioRoute(wantVideo).catch(() => { /* another app holds the session */ })

      /* Anything the relay delivered before the engine existed, in arrival
         order, before a live frame is routed. */
      for (const s of takeSignals(callId)) {
        if (!alive) return
        await engine.onSignal(s)
      }
    })()

    return () => {
      alive = false
      captureReady.current = false
      engineRef.current = null
      setMediaUp(false)
      setLocalStream(null)
      setRemoteStreams({})
      setPeerStates({})
      engine.stop()
      releaseCallAudio().catch(() => { /* nothing to hand back */ })
    }
  }, [engineWanted, callId, meId, wantVideo, mediaAttempt])

  /* The one thing worth retrying on foreground: a capture that failed because
     the permission was denied, after a trip to Settings to grant it. Nothing
     else reacts to backgrounding — see below. */
  React.useEffect(() => {
    if (!mediaError || !engineWanted) return
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') setMediaAttempt(n => n + 1)
    })
    return () => sub.remove()
  }, [mediaError, engineWanted])

  /* One relayed frame in. Before the capture is up it is buffered rather than
     dropped: a peer connection built with no local tracks answers an offer
     with one-way media, which looks connected and carries nothing. */
  const routeSignal = React.useCallback((signal: any) => {
    const engine = engineRef.current
    if (!engine || !captureReady.current) { bufferSignal(signal); return }
    void engine.onSignal(signal)
  }, [])

  /* ---------- realtime ---------- */
  useChatEvents(evt => {
    const type = String(evt?.type || '')
    if (!type.startsWith('call.')) return
    if (callId && evt.callId && String(evt.callId) !== callId) return

    switch (type) {
      case 'call.accepted':
        setCall(prev => (evt.call ? evt.call : patchParticipant(prev, evt.userId, 'JOINED')))
        break
      case 'call.participant':
        /* The event carries the fresh CallResponse (calls.md §Realtime) — take
           it wholesale. The adapter has no per-event `state` field; the server
           only emits this frame when a group member leaves and the call
           survives, so the fallback marks the subject LEFT. */
        setCall(prev => (evt.call ? evt.call : patchParticipant(prev, evt.userId, 'LEFT')))
        break
      case 'call.declined':
        setCall(prev => patchParticipant(prev, evt.userId, 'DECLINED'))
        /* A DM has exactly one other party, so their decline IS the end. In a
           group the call survives with one tile marked. */
        if (!convo?.isGroup) setTimeout(() => setEnded({ label: 'Declined' }), 1200)
        break
      case 'call.ended': {
        const c: Call | undefined = evt.call
        if (c) { setCall(c); appendCallLog(logFromCall(c, meId)) }
        setEnded({ label: terminalLabel(c?.status ?? 'ENDED', c?.answeredAt, c?.endedAt) })
        break
      }
      case 'call.signal':
        routeSignal(evt.signal)
        break
      default:
        break
    }
  })

  /* ---------- negotiation ----------
     Keyed on WHO is joined, not on the participant array: `call.accepted`
     replaces the whole object and every counter tick would otherwise re-offer.
     The engine ignores peers it already owns a connection to, so re-running
     this on every roster change is exactly right. */
  const joinedKey = React.useMemo(
    () => (call?.participants ?? [])
      .filter(p => p.state === 'JOINED' && p.userId)
      .map(p => String(p.userId)).sort().join(','),
    [call?.participants],
  )
  const goneKey = React.useMemo(
    () => (call?.participants ?? [])
      .filter(p => (p.state === 'LEFT' || p.state === 'DECLINED') && p.userId)
      .map(p => String(p.userId)).sort().join(','),
    [call?.participants],
  )

  React.useEffect(() => {
    if (!mediaUp || !joinedKey) return
    void engineRef.current?.negotiate(
      participantsRef.current
        .filter(p => !!p.userId)
        .map(p => ({ userId: String(p.userId), state: p.state })),
    )
  }, [mediaUp, joinedKey])

  React.useEffect(() => {
    if (!mediaUp || !goneKey) return
    for (const id of goneKey.split(',')) engineRef.current?.removePeer(id)
  }, [mediaUp, goneKey])

  /* ---------- timer ---------- */
  const ongoing = call?.status === 'ONGOING'
  React.useEffect(() => {
    if (!ongoing || ended) return
    const id = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [ongoing, ended])

  const elapsed = ongoing && call?.answeredAt ? secondsSince(call.answeredAt) : 0
  const statusLine = ended ? 'Call ended'
    : loading ? 'Connecting…'
      : call?.status === 'RINGING' ? 'Ringing…'
        : ongoing ? clock(elapsed)
          : 'Connecting…'
  /* The status slot changes VOICE with the phase, the way the web's does:
     Sky while ringing, the ledger's tabular digits once it is a clock —
     a proportional colon-time breathes sideways every second. */
  const ringingLine = !ended && !loading && call?.status === 'RINGING'
  const clockLine = !ended && !loading && ongoing

  /* ---------- active-call store ---------- */
  React.useEffect(() => {
    if (!call?.live || !callId) return
    setActiveCall({
      callId,
      conversationId: call.conversationId,
      title: convo?.displayTitle || 'Call',
      type: call.type,
      status: call.status,
      answeredAt: call.answeredAt,
      startedAt: call.startedAt,
    })
  }, [call, callId, convo?.displayTitle])

  /* ---------- terminal + cleanup ---------- */
  React.useEffect(() => {
    if (!ended) return
    clearActiveCall(callId || undefined)
    const id = setTimeout(() => { if (router.canGoBack()) router.back() }, 2000)
    return () => clearTimeout(id)
  }, [ended, callId, router])

  const endCall = React.useCallback(async (label = 'Call ended') => {
    fireHaptic('heavy')
    const id = callId
    /* Release the devices on the tap, not on the next commit. The effect
       cleanup below stops the engine too and `stop()` is idempotent — this is
       the one place where being a render early is worth the duplication. */
    engineRef.current?.stop()
    setEnded({ label })
    if (!id || demo) return
    try { await api.chat.calls.end(id) }
    catch (e: any) {
      /* Idempotent enough: a 404/400 means it was already over, which is the
         state we just moved to anyway. */
      if (!isNotFound(e) && e?.status !== 400) toast.warn('Could not hang up cleanly.')
    }
  }, [callId, demo])

  const endRef = React.useRef(endCall)
  endRef.current = endCall
  const liveRef = React.useRef(false)
  liveRef.current = !!call?.live && !ended

  React.useEffect(() => () => {
    if (liveRef.current && !keepAlive.current && callId && !demo) {
      void api.chat.calls.end(callId).catch(() => {})
      clearActiveCall(callId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Backgrounding deliberately does NOTHING here. The user may be reading a
     code out of another app, and an app that hangs up when it loses focus is
     the single most infuriating call bug there is. The timer runs off
     `answeredAt`, so it survives the trip on its own. */

  const minimize = () => {
    /* The CALL survives this; the media does not. The engine is unmounted with
       the screen so nothing can leave a camera running behind the app's back,
       and coming back re-captures and re-negotiates. */
    keepAlive.current = true
    if (router.canGoBack()) router.back()
  }

  const onDock = (key: DockKey) => {
    const engine = engineRef.current
    if (!engine) return

    if (key === 'mic') {
      const next = !micOn
      setMicOn(next)
      engine.setMicEnabled(next)
      return
    }
    if (key === 'camera') {
      const next = !cameraOn
      setCameraOn(next)
      engine.setCameraEnabled(next)
      return
    }
    if (key === 'flip') {
      void (async () => {
        const next = await engine.flipCamera()
        if (next) setFacing(next)
        else toast.warn('Could not switch camera.')
      })()
      return
    }
    if (key === 'speaker') {
      const next = !speakerOn
      setSpeakerOn(next)
      setCallAudioRoute(next).catch(() => {
        /* The route did not move — put the button back rather than claim it
           did. Another app holding the session is the usual reason. */
        setSpeakerOn(!next)
        toast.warn('Could not change the audio route.')
      })
    }
  }

  /* ---------- layout ---------- */
  const participants = call?.participants ?? []
  const group = !!convo?.isGroup
  const useGrid = group || !!call?.video
  const joined = participants.filter(p => p.state === 'JOINED').length
  const dmPeer = !group ? (convo?.peer ?? null) : null

  const mediaKey = React.useMemo(
    () => `${Object.keys(remoteStreams).sort().join(',')}|`
      + Object.entries(peerStates).map(([k, v]) => `${k}:${v}`).sort().join(','),
    [remoteStreams, peerStates],
  )

  /* The one link a DM has. Its transport state is the only honest answer to
     "why can't I hear anything" on a call that says ONGOING. */
  const dmLink = !group && ongoing
    ? peerStates[participants.find(p => p.state === 'JOINED' && !sameId(p.userId, meId))?.userId ?? '']
    : undefined

  const bodyTop = insets.top + 56
  const bodyBottom = insets.bottom + 24 + 88 + 40 + 12
  const bodyH = Math.max(160, height - bodyTop - bodyBottom)
  const cols = participants.length <= 1 ? 1 : participants.length <= 2 ? 1 : participants.length <= 4 ? 2 : 3
  const tileW = (width - 16 - GUTTER * 2 * cols) / cols
  const rows = Math.max(1, Math.ceil(participants.length / cols))
  const tileH = Math.min(tileW * 4 / 3, (bodyH - GUTTER * 2 * rows) / rows)

  /* ---------- the grid's stable props ----------
     A cell keeps its React key across re-renders only if the key and the
     renderItem identity hold still, so both live outside the render body: the
     key extractor at module scope, the row renderer behind a useCallback whose
     deps are the handful of scalars a tile actually reads. `openProfile` is a
     useEvent, so the per-id handlers below are minted once per participant and
     still see today's `people` map. */
  const openProfile = useEvent((userId: string) => {
    const u = people[String(userId)]
    if (u?.handle) router.push(`/u/${u.handle}`)
  })
  const longPressCache = React.useRef(new Map<string, () => void>())
  const longPressFor = React.useCallback((userId: string) => {
    const cache = longPressCache.current
    let handler = cache.get(userId)
    if (!handler) {
      handler = () => openProfile(userId)
      cache.set(userId, handler)
    }
    return handler
  }, [openProfile])

  const gridContent = React.useMemo(
    () => [styles.grid, { paddingTop: bodyTop, paddingBottom: bodyBottom }],
    [bodyTop, bodyBottom],
  )

  const video = !!call?.video
  const renderTile = React.useCallback(({ item }: { item: CallParticipant }) => {
    const uid = item.userId ? String(item.userId) : ''
    const mine = sameId(item.userId, meId)
    return (
      <View style={styles.cell}>
        <CallParticipantTile
          participant={item}
          user={uid ? people[uid] : null}
          isMe={mine}
          video={video}
          degraded={!hasWebRTC}
          /* My own capture is the PiP, not a tile — one renderer per camera,
             and the tile grid stays "the people I am talking to". */
          stream={uid && !mine ? remoteStreams[uid] : undefined}
          media={uid && !mine ? peerStates[uid] : undefined}
          width={tileW}
          height={tileH}
          onLongPress={uid ? longPressFor(uid) : undefined}
        />
      </View>
    )
  }, [people, meId, video, remoteStreams, peerStates, tileW, tileH, longPressFor])

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, headerShown: false }}
      />
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Touchable
          onPress={minimize}
          feedback="scale"
          noAutoHitSlop
          accessibilityLabel="Minimise the call"
          style={styles.headerBtn}
        >
          <Icon name="down" size={24} color={ROOM.fg} />
        </Touchable>

        <View style={styles.headerTitle}>
          {/* Serif, like every dateline — the web sets the call title in the
              serif voice at this exact size. */}
          <Text variant="headline" serif color={ROOM.fg} align="center" numberOfLines={1}>
            {convo?.displayTitle || (loading ? ' ' : 'Call')}
          </Text>
          <Text
            variant="footnote"
            mono={clockLine}
            color={ringingLine ? ROOM.accent : ROOM.fgMuted}
            align="center"
            numberOfLines={1}
          >
            {statusLine}
          </Text>
        </View>

        {/* Auto-slop: the plate is 32pt tall and the tap-target floor is
            44 — the slop makes up the difference without growing the
            chrome. */}
        {group ? (
          <Touchable
            onPress={() => setRoster(true)}
            feedback="scale"
            accessibilityLabel="Show participants"
            style={[styles.countPill, { backgroundColor: ROOM.fillStrong }]}
          >
            <Text variant="caption" color={ROOM.fg}>{joined}/{participants.length}</Text>
          </Touchable>
        ) : <View style={styles.headerBtn} />}
      </View>

      {/* Body */}
      {demo ? (
        <View style={styles.centered}>
          <Icon name="call" size={40} color={ROOM.fgGhost} />
          <Text variant="title3" color={ROOM.fg} align="center" style={styles.gap}>
            Calls aren&apos;t part of the demo fixture
          </Text>
          <Text variant="footnote" color={ROOM.fgMuted} align="center">
            Turn the demo data off to place a real call.
          </Text>
        </View>
      ) : ended ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(240))}
          style={styles.centered}
        >
          <View style={[styles.endGlyph, { backgroundColor: ROOM.fill }]}>
            <Icon name="callEnd" size={28} color={ROOM.fgMuted} />
          </View>
          <Text variant="title3" color={ROOM.fg} align="center" style={styles.gap}>{ended.label}</Text>
          {elapsed > 0 ? (
            <Text variant="footnote" color={ROOM.fgMuted} align="center">{clock(elapsed)}</Text>
          ) : null}
          <View style={styles.endRow}>
            {/* onDark: a navy primary on the near-black room is the invisible
                button DESIGN.md §6 warns about. */}
            <Button
              label="Call again"
              onPress={() => call?.conversationId && router.replace({
                pathname: '/call/[id]',
                params: { id: 'new', convId: String(call.conversationId), type: call.type },
              })}
              variant="onDark"
              size="md"
              disabled={!call?.conversationId}
            />
            <Button
              label="Back to chat"
              onPress={() => call?.conversationId ? router.replace(`/chat/${call.conversationId}`) : router.back()}
              variant="secondary"
              size="md"
            />
          </View>
        </Animated.View>
      ) : error ? (
        <View style={styles.centered}>
          <Text variant="title3" color={ROOM.fg} align="center">
            {codeOf(error) === 'BLOCKED' ? 'Call not placed' : "This call isn't available"}
          </Text>
          {/* The backend is deliberately vague about a block. Show its sentence
              verbatim and never elaborate on whose block it was. */}
          <Text variant="callout" color={ROOM.fgMuted} align="center" style={styles.gap}>{errorText(error)}</Text>
          <Button label="Back" onPress={() => router.back()} variant="secondary" size="md" style={styles.gapLg} />
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <Skeleton circle width={160} height={160} />
          <Text variant="callout" color={ROOM.fgMuted} align="center" style={styles.gapLg}>Connecting…</Text>
        </View>
      ) : useGrid ? (
        <FlatList
          key={`grid-${cols}`}
          data={participants}
          numColumns={cols}
          keyExtractor={tileKey}
          /* A stream or a transport state arriving does not change `data`, and
             a virtualised cell will happily keep showing the avatar without
             this. */
          extraData={mediaKey}
          contentContainerStyle={gridContent}
          columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
          scrollEnabled={participants.length > 6}
          renderItem={renderTile}
        />
      ) : (
        <View style={[styles.dmBody, { paddingTop: bodyTop, paddingBottom: bodyBottom }]}>
          <View style={styles.dmAvatar}>
            {/* Sky, the web's ring tint — the ring is chrome saying "in
                progress", not a presence dot, so it is not green. */}
            <Halo size={160} active={call?.status === 'RINGING'} color={ROOM.accent} />
            <Avatar
              uri={dmPeer?.profileImage ?? null}
              name={dmPeer?.full ?? convo?.displayTitle}
              seed={dmPeer?.id ?? call?.conversationId}
              size={160}
            />
          </View>
          <Text variant="title2" color={ROOM.fg} align="center" numberOfLines={1} style={styles.gapLg}>
            {dmPeer?.full || convo?.displayTitle || 'Call'}
          </Text>
          <View style={styles.gap}>
            {call?.status === 'RINGING'
              ? <RingingDots />
              : <Text variant="callout" mono={clockLine} color={ROOM.fgMuted} align="center">{statusLine}</Text>}
          </View>

          <View style={styles.meterRow}>
            {hasWebRTC ? (
              dmLink || ongoing ? (
                <View style={[styles.meterChip, { backgroundColor: ROOM.fill }]}>
                  <Text variant="micro" color={dmLink === 'failed' ? ROOM.danger : ROOM.fgMuted}>
                    {LINK_COPY[dmLink ?? 'new']}
                  </Text>
                </View>
              ) : null
            ) : (
              /* A level meter that cannot move. Flat and labelled beats absent:
                 it shows where audio WILL be, and says why it is not. */
              <>
                <DeadLevelMeter />
                <View style={[styles.meterChip, { backgroundColor: ROOM.fill }]}>
                  <Text variant="micro" color={ROOM.fgFaint}>no audio engine</Text>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      {/* Self-view: the SAME capture that is being sent, not a second camera
          session — two sessions on one device fight over the device. */}
      {localStream && cameraOn && wantVideo && !ended ? (
        <PipPreview
          stream={localStream}
          mirror={facing === 'user'}
          muted={!micOn}
          width={width}
          height={height}
          insets={insets}
        />
      ) : null}

      {/* Dock */}
      {!ended && !demo && !error ? (
        <View style={[styles.dockWrap, { paddingBottom: insets.bottom + 24 }]}>
          {!hasWebRTC ? (
            <View style={styles.stripInset}>
              <MediaEngineNotice variant="call" compact />
            </View>
          ) : mediaError ? (
            <Touchable
              onPress={() => { void Linking.openSettings() }}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel="Open settings to allow the microphone and camera"
              style={[styles.errorStrip, { backgroundColor: ROOM.warningSoft }]}
            >
              <Icon name="warning" size={14} color={ROOM.warning} />
              <Text variant="footnote" color={ROOM.warning} align="ui" style={styles.flex} numberOfLines={2}>
                {mediaError}
              </Text>
              <Text variant="footnote" color={ROOM.warning} weight="700" align="ui">Settings</Text>
            </Touchable>
          ) : null}
          <View style={styles.dockInset}>
            <CallControlDock
              /* The gate is the engine actually holding a capture, not merely
                 the module being in the build: a denied microphone leaves
                 nothing to mute, and a dimmed control that explains itself
                 beats a live-looking one that does nothing. */
              hasMedia={hasWebRTC && mediaUp}
              micOn={micOn}
              speakerOn={speakerOn}
              cameraOn={cameraOn}
              video={wantVideo}
              cancelOnly={call?.status === 'RINGING' && sameId(call?.initiatorId, meId)}
              onToggle={onDock}
              onEnd={() => endRef.current(call?.status === 'RINGING' ? 'Cancelled' : 'Call ended')}
              onExplain={() => router.push('/call/media-support')}
            />
          </View>
        </View>
      ) : null}

      <Sheet visible={roster} onClose={() => setRoster(false)} title="In this call" maxHeightRatio={0.9}>
        {participants.map(p => {
          const u = p.userId ? people[String(p.userId)] : null
          return (
            <View key={String(p.userId)} style={styles.rosterRow}>
              <Avatar uri={u?.avatar ?? null} name={u?.full ?? 'Member'} seed={p.userId} size={40} />
              <View style={styles.flex}>
                <Text variant="bodyStrong" align="ui" numberOfLines={1}>{u?.full || 'Member'}</Text>
                {u?.handle ? <Text variant="footnote" tone="muted" align="ui">@{u.handle}</Text> : null}
              </View>
              <Text variant="footnote" tone="muted" align="ui">{STATE_COPY[p.state] ?? p.state}</Text>
            </View>
          )
        })}
        {/* There is no API to add someone to a live call — starting it already
            rang every active member — so this list is read-only by design. */}
        <Text variant="footnote" tone="muted" align="ui" style={styles.rosterNote}>
          Starting the call rang everyone in the conversation.
        </Text>
      </Sheet>
    </View>
  )
}

/* ---------------------------------------------------------
   Pieces
   --------------------------------------------------------- */

function PipPreview({
  stream, mirror, muted, width, height, insets,
}: {
  stream: any
  mirror: boolean
  muted: boolean
  width: number
  height: number
  insets: { top: number; bottom: number }
}) {
  const t = useTheme()
  /* 3:4, the web self-view's aspect — at 108pt wide it is the web's ~28% of a
     phone width, small enough never to cover a face in the grid. */
  const W = 108
  const H = 144
  const margin = 14
  const minY = insets.top + 64
  const maxY = height - insets.bottom - 150 - H
  const maxX = width - W - margin

  const x = useSharedValue(maxX)
  const y = useSharedValue(Math.max(minY, maxY))
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  /* Memoized on the bounds the worklets close over. GestureDetector diffs the
     composed gesture by handler identity, so a fresh object per render
     re-registers the config with the native module — and this component
     re-renders on every mute, flip and transport frame. */
  const spring = t.motion.spring
  const reduce = t.prefs.reducedMotion
  const pan = React.useMemo(() => Gesture.Pan()
    .onBegin(() => { startX.value = x.value; startY.value = y.value })
    .onUpdate(e => {
      x.value = Math.min(maxX, Math.max(margin, startX.value + e.translationX))
      y.value = Math.min(maxY, Math.max(minY, startY.value + e.translationY))
    })
    .onEnd(() => {
      /* Snap to the nearest corner: a PiP parked mid-edge covers a face.
         Under reduced motion it parks with a cut, not a bounce. */
      const tx = x.value + W / 2 > width / 2 ? maxX : margin
      const ty = y.value + H / 2 > height / 2 ? maxY : minY
      if (reduce) { x.value = tx; y.value = ty }
      else {
        x.value = withSpring(tx, spring)
        y.value = withSpring(ty, spring)
      }
    }),
  [x, y, startX, startY, maxX, maxY, minY, width, height, spring, reduce])

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }))

  /* A native handle, not a value — re-derive it whenever the stream object
     changes (a camera flip that falls back to re-acquire replaces the track). */
  const url = React.useMemo(() => {
    try { return String(stream.toURL()) } catch { return null }
  }, [stream])

  return (
    <GestureDetector gesture={pan}>
      {/* The shadow rides the outer view, the clipping the inner one — a
          clipped layer swallows its own iOS shadow. shadow(2) is the raised-
          surface level; the PiP floats over video, not in a list. */}
      <Animated.View style={[styles.pip, { width: W, height: H, borderRadius: t.radius.md }, t.shadow(2), anim]}>
        <View style={[styles.pipBody, { borderRadius: t.radius.md, borderColor: ROOM.hairline }]}>
          {url ? (
            /* `zOrder` 1 keeps the self-view above the grid's renderers on
               Android, where RTCViews are separate surfaces rather than layers. */
            <RTCView
              streamURL={url}
              objectFit="cover"
              mirror={mirror}
              zOrder={1}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[styles.pipTag, { backgroundColor: ROOM.glassStrong }]}>
            {muted ? <Icon name="micOff" size={11} color={ROOM.fg} /> : null}
            <Text variant="micro" color={ROOM.fg}>You</Text>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  )
}

/* What a peer connection's state means to someone waiting to hear a voice.
   `connected` is named rather than blank because on a call that says ONGOING,
   silence with no label reads as a broken app. */
const LINK_COPY: Record<PeerState, string> = {
  new: 'Connecting audio…',
  connecting: 'Connecting audio…',
  connected: 'Connected',
  disconnected: 'Reconnecting…',
  failed: 'No media connection',
  closed: 'Media stopped',
}

/* Wire CallParticipantState — INVITED means "still being rung". */
const STATE_COPY: Record<string, string> = {
  INVITED: 'Ringing', JOINED: 'In the call', LEFT: 'Left', DECLINED: 'Declined',
}

function terminalLabel(status: string, answeredAt?: string | null, endedAt?: string | null): string {
  if (status === 'DECLINED') return 'Declined'
  if (status === 'CANCELLED') return 'Cancelled'
  if (status === 'MISSED') return 'No answer'
  if (!answeredAt && endedAt) return 'No answer'
  return 'Call ended'
}

function patchParticipant(
  prev: Call | null,
  userId: unknown,
  state: CallParticipant['state'],
): Call | null {
  if (!prev || !userId) return prev
  const has = prev.participants.some(p => sameId(p.userId, userId))
  const participants = has
    ? prev.participants.map(p => (sameId(p.userId, userId) ? { ...p, state } : p))
    : [...prev.participants, { userId: String(userId), state, joinedAt: null, leftAt: null }]
  return { ...prev, participants }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ROOM.bg },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
  },
  /* 44pt wide — the tap-target floor; `noAutoHitSlop` means the box IS the
     target. */
  headerBtn: { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, justifyContent: 'center', height: 56 },
  /* A count PLATE, not a count badge: the two sanctioned pills are unread
     counters and LIVE badges, and "3/5 joined" is neither. */
  countPill: {
    height: 32,
    minWidth: 44,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm2,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxxl },
  gap: { marginTop: space.sm },
  gapLg: { marginTop: space.xl },
  /* Icon-only round plate — sanctioned circle, not a pill. */
  endGlyph: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  endRow: { flexDirection: 'row', gap: space.sm2, marginTop: space.xxl },
  grid: { paddingHorizontal: space.sm },
  gridRow: { justifyContent: 'center' },
  cell: { margin: GUTTER },
  dmBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  dmAvatar: { alignItems: 'center', justifyContent: 'center' },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, marginTop: 28 },
  meterChip: { paddingHorizontal: space.sm, paddingVertical: space.xs, ...setback(shape.chip), borderCurve: 'continuous' },
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dockInset: { paddingHorizontal: space.lg, paddingTop: space.md },
  pip: { position: 'absolute', top: 0, left: 0 },
  /* The web self-view's 1px light frame, drawn as a hairline. */
  pipBody: { flex: 1, overflow: 'hidden', borderWidth: 1, backgroundColor: ROOM.tile },
  pipTag: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  /* The strips above the dock share its 16pt inset — a full-bleed band over
     the picture reads as a system failure, not a call notice. */
  errorStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md2,
    paddingVertical: space.sm,
    marginHorizontal: space.lg,
    ...setback(shape.field),
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  stripInset: { marginHorizontal: space.lg, ...setback(shape.field), borderCurve: 'continuous', overflow: 'hidden' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.sm2 },
  rosterNote: { paddingHorizontal: space.xl, paddingTop: space.sm2, paddingBottom: space.xs2 },
  flex: { flex: 1 },
})
