/* =========================================================
   callEngine — the media plane for 1:1 and group calls.

   The backend is a BLIND RELAY. It forwards an opaque `payload`
   between participants and never inspects it, so the entire
   WebRTC negotiation is the client's: this module is that half,
   lifted out of the web app's CallContext and made framework-
   free so the call screen can own the React state and this can
   own the sockets.

   TOPOLOGY IS A MESH — one RTCPeerConnection per remote peer.
   That is right up to a handful of participants and wrong past
   it; an SFU would sit in front of these same signalling frames
   without changing them.

   THE THREE RULES THAT MAKE IT WORK

   1. GLARE. If both sides offer at once, both answer their own
      offer and neither connects. Comparing user ids as strings
      settles it with no coordination — but NOT by deciding who
      is allowed to offer, which is the version that breaks.

      Anyone with no connection to a peer offers. The id order
      only decides who YIELDS when two offers cross: the higher
      id is "polite" and drops its own attempt to take the
      other's; the lower id ignores the incoming offer and lets
      its own complete.

      The stricter rule — only the lower id may ever offer —
      looks equivalent and deadlocks on re-entry. Leave the call
      screen and come back: your side rebuilt nothing, and for
      every peer whose id sorts below yours you sit waiting for
      an offer they will never send, because their connection
      still exists and they think you are already up. Silent,
      one-directional, and indistinguishable from a network
      fault.

   2. ICE BEFORE SDP. A candidate can legitimately arrive before
      the description it belongs to. Dropping it stalls the
      connection on a slow relay, so early candidates are queued
      per peer and drained the moment a remote description
      lands.

   3. `failed` IS RECOVERABLE. Restart ICE rather than tearing
      down — but from the LOWER id only. Rule 1 leaves both
      sides able to offer, so without a single restarter a
      transport blip makes both restart, and the recovery
      becomes the collision it is meant to repair.
   ========================================================= */
import {
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc'
import { api } from '@/api'
import { iceServers, hasWebRTC } from './liveWebrtc'

export type PeerState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

export interface RemotePeer {
  userId: string
  /** Render with `<RTCView streamURL={stream.toURL()} />`. */
  stream: any
}

export interface CallEngineHandlers {
  /** The remote roster changed — replace your list wholesale. */
  onRemotes?: (remotes: RemotePeer[]) => void
  /** One peer's transport state moved. `disconnected` is usually transient. */
  onPeerState?: (userId: string, state: PeerState) => void
  /** The local capture is ready. Fires once, before any negotiation. */
  onLocalStream?: (stream: any) => void
  /** Something the user needs told — a denied permission, a dead device. */
  onError?: (message: string) => void
}

export interface CallEngineOptions {
  callId: string
  /** My own user id. Also decides who offers — see rule 1. */
  myId: string
  video: boolean
  handlers?: CallEngineHandlers
}

export interface CallEngine {
  /** Capture the mic (and camera) and hand the stream back. */
  start: () => Promise<any>
  /** Offer to every JOINED peer this side is responsible for. */
  negotiate: (participants: { userId: string | number; state?: string }[]) => Promise<void>
  /** Feed one `call.signal` frame in. */
  onSignal: (signal: any) => Promise<void>
  /** Drop a peer that left. */
  removePeer: (userId: string) => void
  setMicEnabled: (on: boolean) => void
  setCameraEnabled: (on: boolean) => void
  /** Front ⇄ back. Resolves to the new facing mode, or null if it failed. */
  flipCamera: () => Promise<'user' | 'environment' | null>
  localStream: () => any
  stop: () => void
}

/* The web build asked for echoCancellation / noiseSuppression / autoGainControl
   here. Those are browser constraints and react-native-webrtc does not accept
   them, because on a phone they are not the app's to request: both platforms
   route WebRTC audio through the OS voice-processing unit, which does all
   three, and asking again would be a constraint the native layer rejects. */
const AUDIO_CONSTRAINTS = true

export function createCallEngine({ callId, myId, video, handlers = {} }: CallEngineOptions): CallEngine {
  const pcs = new Map<string, any>()
  const iceQueue = new Map<string, any[]>()
  const remotes = new Map<string, any>()
  /* Set while our own offer for a peer is in flight. Without it an incoming
     offer cannot be told apart from a collision, and the tie-break has nothing
     to break. */
  const offering = new Set<string>()
  let local: any = null
  let facing: 'user' | 'environment' = 'user'
  let dead = false

  const emitRemotes = () => {
    handlers.onRemotes?.([...remotes.entries()].map(([userId, stream]) => ({ userId, stream })))
  }

  /* Fire and forget. A dropped ICE frame is normal — the next candidate or an
     ICE restart recovers — and surfacing every failure would spam the user
     during a perfectly healthy call. */
  const sendSignal = (toUserId: string, kind: string, payload: unknown) => {
    if (dead || !callId || !toUserId) return
    api.chat.calls.signal(callId, { toUserId, kind, payload: JSON.stringify(payload) }).catch(() => {})
  }

  const peerFor = (peerId: string): any => {
    const existing = pcs.get(peerId)
    if (existing) return existing

    const pc: any = new RTCPeerConnection({ iceServers: iceServers() })
    pcs.set(peerId, pc)

    for (const track of (local?.getTracks?.() || [])) {
      try { pc.addTrack(track, local) } catch { /* already added */ }
    }

    pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) sendSignal(peerId, 'ICE', e.candidate.toJSON())
    })

    pc.addEventListener('track', (e: any) => {
      const stream = e.streams?.[0]
      if (!stream) return
      /* Keyed by userId, not appended: renegotiation fires this again and a
         push would render the same peer twice. */
      remotes.set(peerId, stream)
      emitRemotes()
    })

    pc.addEventListener('connectionstatechange', () => {
      handlers.onPeerState?.(peerId, pc.connectionState)
      if (pc.connectionState === 'failed') {
        /* Recoverable — but restart from the offering side only, or both peers
           produce a fresh offer and glare all over again. */
        if (myId < peerId) { try { pc.restartIce?.() } catch { /* not supported */ } }
      }
      if (pc.connectionState === 'closed') {
        remotes.delete(peerId)
        emitRemotes()
      }
    })

    return pc
  }

  /* Throw a peer's connection away so the next one starts clean. Used when we
     yield to a crossing offer and when a peer re-offers after re-entering —
     `setRemoteDescription` on a connection that is mid-negotiation throws, and
     react-native-webrtc's rollback support is not dependable enough to lean
     on. Rebuilding costs one ICE round trip and always works.

     The remote's stream is kept: `ontrack` on the new connection replaces it,
     and dropping it first would blank their tile for that round trip. */
  const resetPeer = (peerId: string) => {
    const pc = pcs.get(peerId)
    if (pc) { try { pc.close() } catch { /* already closed */ } }
    pcs.delete(peerId)
    iceQueue.delete(peerId)
    offering.delete(peerId)
  }

  const drainIce = async (peerId: string, pc: any) => {
    const queued = iceQueue.get(peerId)
    if (!queued?.length) return
    iceQueue.delete(peerId)
    for (const cand of queued) {
      try { await pc.addIceCandidate(cand) } catch { /* stale candidate */ }
    }
  }

  const start = async () => {
    if (!hasWebRTC) throw new Error('The media engine is not available in this build.')
    if (local) return local
    try {
      local = await mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: video
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: facing }
          : false,
      })
    } catch (e: any) {
      /* The two failures worth distinguishing: the user said no, and the
         device is not there. Everything else reads as the second. */
      const denied = /permission|denied|notallowed/i.test(String(e?.message || e?.name || ''))
      throw new Error(denied
        ? 'Hikmah Web needs the microphone to make a call. Allow it in your phone’s settings.'
        : 'Your microphone or camera could not be opened.')
    }
    /* A peer connection can already exist: an OFFER that arrives before
       capture finishes builds one through `peerFor`, and at that moment there
       were no local tracks to add. Without this the call connects one-way —
       you hear them, they hear nothing — which looks like their microphone
       failing, so it is diagnosed on the wrong device. */
    for (const pc of pcs.values()) {
      const already = new Set(pc.getSenders?.().map((s: any) => s.track?.id).filter(Boolean))
      for (const track of local.getTracks()) {
        if (already.has(track.id)) continue
        try { pc.addTrack(track, local) } catch { /* already added */ }
      }
    }

    handlers.onLocalStream?.(local)
    return local
  }

  const negotiate = async (participants: { userId: string | number; state?: string }[]) => {
    if (dead) return
    const peers = (participants || [])
      .filter(p => (p.state ? p.state === 'JOINED' : true) && String(p.userId) !== myId)
      .map(p => String(p.userId))

    for (const peerId of peers) {
      /* Already negotiating or connected. Anyone with NO connection offers —
         see rule 1 for why gating this on the id order deadlocks re-entry. */
      if (pcs.has(peerId)) continue
      const pc = peerFor(peerId)
      offering.add(peerId)
      try {
        const offer = await pc.createOffer({})
        await pc.setLocalDescription(offer)
        sendSignal(peerId, 'OFFER', pc.localDescription)
      } catch {
        offering.delete(peerId)
        handlers.onError?.('Could not start the call media.')
      }
    }
  }

  const onSignal = async (signal: any) => {
    if (dead) return
    const from = String(signal?.fromUserId || '')
    if (!from) return

    let payload = signal.payload
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) } catch { /* leave it raw */ }
    }
    if (!payload) return

    if (signal.kind === 'OFFER') {
      const collision = offering.has(from)
      /* The tie-break. The higher id yields; the lower id keeps its own offer
         and drops this one, whose sender will accept our offer by the same
         rule. Both sides compute it from the same two strings. */
      if (collision && myId < from) return

      /* Any offer we accept starts a fresh connection: either we are yielding
         a collision, or the peer re-entered and is re-offering over a
         connection we still think is live. Both cases break
         `setRemoteDescription` on the existing one. */
      if (pcs.has(from)) resetPeer(from)

      const pc = peerFor(from)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload))
        await drainIce(from, pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal(from, 'ANSWER', pc.localDescription)
      } catch { /* the offerer retries on ICE failure */ }
      return
    }

    if (signal.kind === 'ANSWER') {
      const pc = pcs.get(from)
      if (!pc) return
      offering.delete(from)
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload))
        await drainIce(from, pc)
      } catch { /* out-of-order answer */ }
      return
    }

    /* ICE — rule 2. Queue rather than drop when the description has not
       landed yet. */
    const pc = pcs.get(from)
    const cand = new RTCIceCandidate(payload)
    if (!pc || !pc.remoteDescription) {
      const q = iceQueue.get(from) || []
      q.push(cand)
      iceQueue.set(from, q)
      return
    }
    try { await pc.addIceCandidate(cand) } catch { /* stale candidate */ }
  }

  const removePeer = (userId: string) => {
    const id = String(userId)
    resetPeer(id)
    if (remotes.delete(id)) emitRemotes()
  }

  const setTrackEnabled = (kind: 'audio' | 'video', on: boolean) => {
    for (const track of (local?.getTracks?.() || [])) {
      if (track.kind === kind) track.enabled = on
    }
  }

  const flipCamera = async () => {
    const track: any = local?.getVideoTracks?.()[0]
    if (!track) return null
    const next: 'user' | 'environment' = facing === 'user' ? 'environment' : 'user'
    try {
      /* Both of these keep the SAME track, so nothing renegotiates and the
         remote side never sees a gap. `applyConstraints` is the current API;
         `_switchCamera` is its deprecated predecessor and is kept as the
         fallback for a native side older than the JS. */
      if (typeof track.applyConstraints === 'function') {
        await track.applyConstraints({ facingMode: next })
        facing = next
        return facing
      }
      if (typeof track._switchCamera === 'function') {
        track._switchCamera()
        facing = next
        return facing
      }
      /* Last resort: re-acquire and replace on every peer. This DOES change
         the track, so it is the only path that touches the senders. */
      const fresh: any = await mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: next },
        audio: false,
      })
      const newTrack = fresh.getVideoTracks()[0]
      if (!newTrack) return null
      for (const pc of pcs.values()) {
        const sender = pc.getSenders?.().find((s: any) => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(newTrack)
      }
      newTrack.enabled = track.enabled
      try { track.stop() } catch { /* already gone */ }
      local.removeTrack(track)
      local.addTrack(newTrack)
      facing = next
      handlers.onLocalStream?.(local)
      return facing
    } catch {
      return null
    }
  }

  const stop = () => {
    if (dead) return
    dead = true
    for (const pc of pcs.values()) { try { pc.close() } catch { /* already closed */ } }
    pcs.clear()
    iceQueue.clear()
    offering.clear()
    remotes.clear()
    for (const track of (local?.getTracks?.() || [])) { try { track.stop() } catch { /* gone */ } }
    local = null
  }

  return {
    start,
    negotiate,
    onSignal,
    removePeer,
    setMicEnabled: (on: boolean) => setTrackEnabled('audio', on),
    setCameraEnabled: (on: boolean) => setTrackEnabled('video', on),
    flipCamera,
    localStream: () => local,
    stop,
  }
}
