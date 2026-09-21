/* =========================================================
   useLiveRoom — the state machine both live rooms run on.

   /live/[id] (viewer) and /live/[id]/host (broadcaster) watch
   the same frames off the same socket and differ only in which
   controls they draw. Two hand-rolled copies of this reducer
   would disagree within a week, so there is one.

   The rules it enforces, each of which was a bug in the web
   app before liveRows.js existed:

   · PATCH, never assign. `stream.viewer` / `.updated` / `.ended`
     omit the host identity and the media URLs; assigning one
     over the card blanks `playbackUrl`, re-runs the player
     attach effect and tears the video down every time somebody
     walks in. `patchStream` skips null/undefined/'' and always
     takes 0 (a real viewer count).
   · `stream.stage` REPLACES the roster wholesale. It is the
     whole panel, not a delta.
   · `stream.stage.request` UPSERTS, and a queued request is
     cleared the moment the roster shows that user ACTIVE.
   · Chat, reactions and gifts are EPHEMERAL. A reconnect
     re-seeds only the durable things — the lost backlog is
     correct behaviour, not an error.
   · `stream.stage.grant` is the ONLY delivery of a guest's own
     publish credential. It is kept in memory (`publish`) for
     the WHIP publish and nowhere else — never rendered, never
     logged, never shared.
   · `leave` must fire from a real lifecycle hook. `keepalive`
     maps to fetch's flag, which RN's fetch ignores, so the
     server's presence sweep is the only backstop and a screen
     that forgets to leave inflates the viewer count.
   ========================================================= */
import React from 'react'
import { AppState } from 'react-native'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { patchStream } from '@/lib/liveRows'
import { useAuth } from '@/context/AuthContext'
import { useChatActions } from '@/context/ChatContext'
import { useChatEvents, useRealtimeConnection } from '@/context/RealtimeContext'
import { useGiftQueue } from './Gifts'
import type { RailRow } from './LiveChat'
import type {
  GiftSupporter, LiveStream, StageMember, StageState, StreamGift, Watcher,
} from './types'

const CHAT_CAP = 120
const ECHO_WINDOW_MS = 3000

/** "This stream is not live." — on join/chat/react the backend throws it as a
 *  plain BAD_REQUEST (LiveStreamService.requireLive passes no code); only the
 *  recording-control path carries the STREAM_NOT_LIVE code. Match both, or a
 *  room that raced the ending renders an error card instead of the ENDED one. */
function isStreamNotLive(e: any): boolean {
  return codeOf(e) === 'STREAM_NOT_LIVE'
    || (e?.status === 400 && /not live/i.test(String(e?.message || '')))
}

export type HandState = 'idle' | 'requested' | 'onstage'

/** YOUR OWN publish credential for the stage. Secret: never render it, never
 *  log it, never put it in a share sheet. */
export interface StageCredential {
  whipUrl: string
  publishKey: string | null
}

export interface LiveRoom {
  stream: LiveStream | null
  stage: StageState | null
  chat: RailRow[]
  requests: StageMember[]
  supporters: GiftSupporter[]
  watchers: Watcher[]
  gifts: StreamGift[]
  giftKey: (g: StreamGift) => string
  isHost: boolean
  myMember: StageMember | null
  hand: HandState
  /** Set the moment YOU are granted the stage — the guest publish path.
   *  Null for the host, for a viewer, and after you step down. */
  publish: StageCredential | null
  joined: boolean
  loading: boolean
  /** Set once the stream is over (or was never live) — the ENDED card. */
  ended: boolean
  /** A final refusal or a 404 the screen must render in place. */
  error: any
  chatError: string | null
  send: (text: string) => Promise<void>
  react: (type?: string) => Promise<void>
  sendGift: (giftId: string) => Promise<void>
  raiseHand: () => Promise<any>
  stepDown: () => Promise<void>
  acceptInvite: () => Promise<void>
  /** The HOST member who invited YOU up — from `stream.stage.invite`, or the
   *  stash ChatContext keeps for invites that landed outside the room. Null
   *  once answered. */
  invite: StageMember | null
  /** Turning an invite down must reach the server: a banner that is merely
   *  swiped away leaves the host's INVITED row open forever. */
  declineInvite: () => void
  setStream: React.Dispatch<React.SetStateAction<LiveStream | null>>
  setStage: React.Dispatch<React.SetStateAction<StageState | null>>
  setRequests: React.Dispatch<React.SetStateAction<StageMember[]>>
  setSupporters: React.Dispatch<React.SetStateAction<GiftSupporter[]>>
  reseed: () => Promise<void>
  /** The room subscribes once; the reaction layer registers where a remote
   *  `stream.reaction` should spawn its floater. */
  bindReactionSink: (fn: ((type: string) => void) | null) => void
}

export function useLiveRoom(streamId: string | undefined, opts: { host?: boolean } = {}): LiveRoom {
  const { user } = useAuth()
  const { epoch } = useRealtimeConnection()
  const meId = user?.id ? String(user.id) : null

  const [stream, setStream] = React.useState<LiveStream | null>(null)
  const [stage, setStage] = React.useState<StageState | null>(null)
  const [chat, setChat] = React.useState<RailRow[]>([])
  const [requests, setRequests] = React.useState<StageMember[]>([])
  const [supporters, setSupporters] = React.useState<GiftSupporter[]>([])
  const [watchers, setWatchers] = React.useState<Watcher[]>([])
  const [joined, setJoined] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [ended, setEnded] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [hand, setHand] = React.useState<HandState>('idle')
  /* Handed over exactly once, on the grant. There is no "read my credential"
     endpoint, so an SSE reconnect after being brought up cannot recover it —
     the roster's public member carries `whepUrl` only. A guest in that state
     is on stage with no way to publish and has to step down and come back up,
     which is why `reseed` does not try to reconstruct this. */
  const [publish, setPublish] = React.useState<StageCredential | null>(null)
  const [invite, setInvite] = React.useState<StageMember | null>(null)

  /* The overlay's queue, owned HERE: a gift has to be counted whether or not
     the overlay happens to be mounted. One implementation, in Gifts.tsx —
     the miniature that used to live at the bottom of this file shifted its
     queue and armed its expiry timer INSIDE a setState updater, and React is
     free to run an updater twice for one dispatch. */
  const { showing: gifts, push: pushGift, keyOf: giftKey } = useGiftQueue()

  /* `stream.stage.invite` fires ONCE and the roster never lists INVITED
     members, so an invite that landed while the user was elsewhere survives
     only in ChatContext's stash — the room takes it on mount. */
  const { takeStageInvite } = useChatActions()
  React.useEffect(() => {
    if (!streamId) return
    const stashed = takeStageInvite(streamId) as StageMember | null
    if (stashed) setInvite(stashed)
  }, [streamId, takeStageInvite])

  const idRef = React.useRef<string | undefined>(streamId)
  idRef.current = streamId
  const joinedRef = React.useRef(false)
  const onStageRef = React.useRef(false)
  const seq = React.useRef(0)

  const isHost = !!meId && !!stream?.hostId && String(stream.hostId) === meId
  const myMember = React.useMemo(
    () => stage?.members.find(m => meId && String(m.userId) === meId) ?? null,
    [stage, meId],
  )

  React.useEffect(() => {
    onStageRef.current = !!myMember && !myMember.isHost && myMember.status === 'ACTIVE'
    if (onStageRef.current) { setHand('onstage'); setInvite(null) }
    else if (hand === 'onstage') setHand('idle')
    /* A roster that HAS arrived and does not list you as ACTIVE means your
       credential is revoked. A roster that has not arrived YET means nothing —
       a reconnect must not throw away a key that still works. */
    if (stage && !onStageRef.current) setPublish(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMember, stage])

  /* ---------- seed ---------- */
  const reseed = React.useCallback(async () => {
    const id = idRef.current
    if (!id) return
    const mine = ++seq.current
    try {
      const s = (await api.chat.streams.get(id)) as LiveStream | null
      if (mine !== seq.current) return
      setStream(prev => patchStream(prev, s))
      if (!s?.isLive) { setEnded(true); setLoading(false); return }

      const hostSelf = !!meId && String(s.hostId) === meId
      /* The host is present by definition; only a viewer registers presence.
         Chat / reactions / gifts / hand-raise all 403 until this resolves. */
      if (!hostSelf) {
        try {
          const j = (await api.chat.streams.join(id)) as LiveStream
          if (mine !== seq.current) return
          setStream(prev => patchStream(prev, j))
          joinedRef.current = true
          setJoined(true)
        } catch (e: any) {
          if (isStreamNotLive(e) || isNotFound(e)) { setEnded(true); setLoading(false); return }
          throw e
        }
      } else {
        setJoined(true)
      }

      const [st, reqs, top] = await Promise.all([
        api.chat.streams.stage.get(id).catch(() => null),
        hostSelf ? api.chat.streams.stage.requests(id).catch(() => []) : Promise.resolve([]),
        api.chat.streams.gifts.top(id, 10).catch(() => []),
      ])
      if (mine !== seq.current) return
      if (st) setStage(st)
      setRequests(reqs || [])
      setSupporters(top || [])
      setLoading(false)
    } catch (e: any) {
      if (mine !== seq.current) return
      if (isNotFound(e)) { setEnded(true); setLoading(false); return }
      setError(e)
      setLoading(false)
    }
  }, [meId])

  React.useEffect(() => {
    if (!streamId) return
    setLoading(true); setEnded(false); setError(null)
    void reseed()
  }, [streamId, reseed])

  /* Every (re)connect re-reads the durable state and closes the gap. Chat,
     reactions and gifts during the drop are gone by design. */
  const firstEpoch = React.useRef(true)
  React.useEffect(() => {
    if (firstEpoch.current) { firstEpoch.current = false; return }
    if (!streamId || ended) return
    void reseed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

  /* ---------- leave ---------- */
  const leave = React.useCallback(() => {
    const id = idRef.current
    if (!id) return
    if (onStageRef.current) {
      onStageRef.current = false
      void api.chat.streams.stage.leave(id, { beacon: true }).catch(() => {})
    }
    if (joinedRef.current) {
      joinedRef.current = false
      void api.chat.streams.leave(id, { beacon: true }).catch(() => {})
    }
  }, [])

  React.useEffect(() => leave, [leave])

  /* Leaving on background is only half a lifecycle. `leave` de-registers this
     device — the viewer count drops, and chat / reactions / gifts start
     answering NOT_A_MEMBER — so coming back has to REJOIN, and until this
     nothing did: the reseed that would have is keyed to the socket `epoch`,
     and RealtimeContext only redials after RESUME_REDIAL_AFTER_MS (10s) away.
     Every app switch shorter than that left the viewer watching a stream they
     were no longer registered for, with a composer that still looked live
     because `joined` was never lowered either.

     Keyed on "did we actually leave" rather than on the previous state: iOS
     emits 'inactive' for the app switcher and for an incoming call, neither of
     which backgrounds the app, and a reseed per peek is three requests for
     nothing. */
  const leftForBackground = React.useRef(false)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') {
        if (leftForBackground.current) return
        leftForBackground.current = true
        leave()
        /* Say what just happened. The stage seat goes with the presence row,
           and the guest credential dies with the seat — there is no endpoint
           that re-issues one, so holding a dead whipUrl only invites a publish
           that cannot land. */
        setJoined(false)
        setPublish(null)
        setHand(h => (h === 'onstage' ? 'idle' : h))
        return
      }
      if (next !== 'active' || !leftForBackground.current) return
      leftForBackground.current = false
      /* `reseed` IS the rejoin: it re-reads the stream, joins unless we are the
         host, and re-pulls the roster we were dropped from. It also answers
         the other thing that can have happened while we were away — the host
         ended it — which is why this is a reseed and not a bare join. */
      if (!ended) void reseed()
    })
    return () => sub.remove()
    /* `ended` is a dependency rather than a ref because it flips at most once
       per stream — re-arming the listener then is cheaper than a mirror that
       every render has to keep honest, and `leftForBackground` is a ref, so a
       re-arm cannot forget that we owe a rejoin. */
  }, [leave, reseed, ended])

  /* ---------- realtime ---------- */

  /* A room subscribes once; the reaction layer registers where floaters go. */
  const reactionSink = React.useRef<((type: string) => void) | null>(null)
  const bindReactionSink = React.useCallback((fn: ((type: string) => void) | null) => {
    reactionSink.current = fn
  }, [])

  useChatEvents(evt => {
    const id = idRef.current
    if (!id) return
    const type = String(evt?.type || '')
    if (!type.startsWith('stream.')) return

    const forThis =
      String(evt.streamId ?? '') === id ||
      String(evt.stream?.id ?? '') === id ||
      String(evt.stage?.streamId ?? '') === id ||
      String(evt.stageMember?.streamId ?? '') === id ||
      String(evt.streamChat?.streamId ?? '') === id ||
      String(evt.streamReaction?.streamId ?? '') === id ||
      String(evt.streamGift?.streamId ?? '') === id
    if (!forThis) return

    switch (type) {
      case 'stream.viewer': {
        setStream(prev => patchStream(prev, evt.stream))
        const uid = evt.userId ? String(evt.userId) : null
        if (uid && uid !== meId) {
          const joinedNow = evt.memberChange !== 'LEFT'
          setWatchers(prev => {
            if (!joinedNow) return prev.filter(w => w.userId !== uid)
            if (prev.some(w => w.userId === uid)) return prev
            return [...prev, { userId: uid, handle: uid.slice(0, 6), displayName: '', avatarUrl: null, at: Date.now() }]
          })
        }
        break
      }
      case 'stream.updated':
        setStream(prev => patchStream(prev, evt.stream))
        break
      case 'stream.ended':
        setStream(prev => patchStream(prev, evt.stream))
        setEnded(true)
        joinedRef.current = false
        onStageRef.current = false
        setPublish(null)
        setInvite(null)
        break
      case 'stream.chat': {
        const line = evt.streamChat
        if (!line) break
        setChat(prev => foldChatEcho(prev, line, meId))
        break
      }
      case 'stream.stage': {
        /* The whole panel. Replacing is the contract; merging invents seats. */
        const next: StageState = evt.stage
        setStage(next)
        const activeIds = new Set((next?.members || []).map(m => String(m.userId)))
        setRequests(prev => prev.filter(r => !activeIds.has(String(r.userId))))
        break
      }
      case 'stream.stage.request': {
        const m: StageMember = evt.stageMember
        if (!m?.userId) break
        setRequests(prev => [...prev.filter(r => String(r.userId) !== String(m.userId)), m])
        break
      }
      case 'stream.stage.invite': {
        /* Addressed to this viewer only; the member is the HOST who invited. */
        const m: StageMember = evt.stageMember
        if (m) setInvite(m)
        break
      }
      case 'stream.stage.grant': {
        const m: StageMember = evt.stageMember
        if (!m) break
        /* This frame goes to ONE guest and carries their whipUrl + publishKey.
           It is held in memory for the publish and never rendered or logged. */
        if (m.status === 'ACTIVE') {
          onStageRef.current = true
          setHand('onstage')
          if (m.whipUrl) setPublish({ whipUrl: m.whipUrl, publishKey: m.publishKey })
        } else if (m.status === 'REMOVED') {
          onStageRef.current = false
          setHand('idle')
          setPublish(null)
        }
        break
      }
      case 'stream.reaction': {
        const r = evt.streamReaction
        if (!r) break
        /* Your own tap already spawned a floater locally. */
        if (meId && String(r.userId) === meId) break
        reactionSink.current?.(r.type)
        break
      }
      case 'stream.gift': {
        const g: StreamGift = evt.streamGift
        if (!g) break
        pushGift(g)
        setSupporters(prev => upsertSupporter(prev, g))
        break
      }
      default:
        break
    }
  })

  /* ---------- writes ---------- */

  const send = React.useCallback(async (text: string) => {
    const id = idRef.current
    if (!id || !text.trim()) return
    setChatError(null)
    const optimistic: RailRow = {
      kind: 'chat',
      key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      streamId: id,
      userId: meId,
      username: user?.handle || user?.handle || '',
      handle: user?.handle || user?.handle || 'you',
      text: text.trim(),
      sentAt: new Date().toISOString(),
      pending: true,
    }
    setChat(prev => [optimistic, ...prev].slice(0, CHAT_CAP))
    try {
      await api.chat.streams.chat(id, text.trim())
    } catch (e: any) {
      const code = codeOf(e)
      /* Recoverable exactly once: presence expired, so re-register and resend
         rather than telling the user to retype what they just typed. */
      if (code === 'NOT_A_MEMBER') {
        try {
          const j = (await api.chat.streams.join(id)) as LiveStream
          setStream(prev => patchStream(prev, j))
          joinedRef.current = true
          setJoined(true)
          await api.chat.streams.chat(id, text.trim())
          return
        } catch (e2: any) {
          setChat(prev => prev.filter(r => !(r.kind === 'chat' && r.key === optimistic.key)))
          setChatError(errorSentence(e2))
          throw e2   // same reason as below — the caller owns the 429 cooldown
        }
      }
      if (isStreamNotLive(e)) { setEnded(true); return }
      setChat(prev => prev.filter(r => !(r.kind === 'chat' && r.key === optimistic.key)))
      setChatError(errorSentence(e))
      /* Rethrow after the rollback: live chat is rate-limited 20/10s and the
         screens' catch runs `startChatCooldown(e)` — swallowing here left that
         cooldown (§2.3, cooldownSecondsFrom) permanently disarmed. */
      throw e
    }
  }, [meId, user])

  const react = React.useCallback(async (type = 'LIKE') => {
    const id = idRef.current
    if (!id) return
    try { await api.chat.streams.react(id, type) }
    catch (e: any) { if (isStreamNotLive(e)) setEnded(true) }
  }, [])

  const sendGift = React.useCallback(async (giftId: string) => {
    const id = idRef.current
    if (!id) return
    /* The response is deliberately discarded — the `stream.gift` broadcast
       echoes to the sender and IS the animation trigger. */
    await api.chat.streams.gifts.send(id, giftId)
  }, [])

  const raiseHand = React.useCallback(async () => {
    const id = idRef.current
    if (!id) return
    const m = (await api.chat.streams.stage.requestUp(id)) as StageMember | null
    /* A host with open-stage settings can approve on the spot, in which case
       this response — not the grant frame — is where the credential arrives. */
    if (m?.status === 'ACTIVE' && m.whipUrl) setPublish({ whipUrl: m.whipUrl, publishKey: m.publishKey })
    setHand(m?.status === 'ACTIVE' ? 'onstage' : 'requested')
    return m
  }, [])

  const stepDown = React.useCallback(async () => {
    const id = idRef.current
    if (!id) return
    await api.chat.streams.stage.leave(id)
    onStageRef.current = false
    setHand('idle')
    setPublish(null)
  }, [])

  const acceptInvite = React.useCallback(async () => {
    const id = idRef.current
    if (!id) return
    /* The response IS the private credential (whipUrl + publishKey) — the only
       copy of it, and the thing that lets this phone publish to the stage. */
    const m = (await api.chat.streams.stage.accept(id)) as StageMember | null
    /* ChatContext stashes the frame even in-room; drain it too, or the next
       mount of this room resurrects an invite that was already answered. */
    takeStageInvite(id)
    setInvite(null)
    if (m?.status === 'ACTIVE') {
      onStageRef.current = true
      setHand('onstage')
      if (m.whipUrl) setPublish({ whipUrl: m.whipUrl, publishKey: m.publishKey })
    }
  }, [takeStageInvite])

  const declineInvite = React.useCallback(() => {
    const id = idRef.current
    setInvite(null)
    if (!id) return
    takeStageInvite(id)
    /* 204 with no body — fire-and-forget per the multi-guest doc. Without the
       call the host's INVITED row never resolves to DECLINED. */
    void api.chat.streams.stage.decline(id).catch(() => {})
  }, [takeStageInvite])

  return {
    stream, stage, chat, requests, supporters, watchers,
    gifts, giftKey,
    isHost: opts.host ? true : isHost,
    myMember, hand, publish, joined, loading, ended, error, chatError,
    send, react, sendGift, raiseHand, stepDown, acceptInvite, invite, declineInvite,
    setStream, setStage, setRequests, setSupporters, reseed, bindReactionSink,
  }
}

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

/** Fold an incoming line, collapsing it onto our own optimistic copy when it
 *  is the echo of something we just sent (same author, same text, ≤3s). */
function foldChatEcho(prev: RailRow[], line: any, meId: string | null): RailRow[] {
  const incoming: RailRow = {
    kind: 'chat',
    key: `${line.userId}-${line.sentAt}-${String(line.text).slice(0, 16)}`,
    streamId: line.streamId,
    userId: line.userId,
    username: line.username,
    handle: line.handle,
    text: line.text,
    sentAt: line.sentAt,
  }
  if (meId && String(line.userId) === meId) {
    const at = Date.parse(line.sentAt || '') || Date.now()
    const idx = prev.findIndex(r =>
      r.kind === 'chat' && r.pending && r.text === line.text &&
      Math.abs((Date.parse(r.sentAt || '') || 0) - at) < ECHO_WINDOW_MS)
    if (idx >= 0) {
      const next = [...prev]
      next[idx] = incoming
      return next
    }
  }
  return [incoming, ...prev].slice(0, CHAT_CAP)
}

/** `senderTotalCoins` is the authoritative running total — never accumulate. */
function upsertSupporter(prev: GiftSupporter[], g: StreamGift): GiftSupporter[] {
  const existing = prev.find(s => String(s.userId) === String(g.senderId))
  const row: GiftSupporter = {
    userId: g.senderId,
    username: g.senderUsername,
    handle: g.senderHandle,
    displayName: existing?.displayName || g.senderUsername,
    avatarUrl: g.senderAvatarUrl ?? existing?.avatarUrl ?? null,
    coins: g.senderTotalCoins,
    giftCount: (existing?.giftCount ?? 0) + 1,
  }
  return [...prev.filter(s => String(s.userId) !== String(g.senderId)), row]
    .sort((a, b) => b.coins - a.coins)
}

/** The display contract (errors.js): the server's 4xx message verbatim, the
 *  offline copy for a network drop, the generic-plus-ref for a 5xx. */
function errorSentence(e: any): string {
  return errorText(e, 'Could not send that message.')
}
