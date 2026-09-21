/* =========================================================
   liveWebrtc — publish and watch a live stream over WebRTC.

   The RN port of the web module. Both flows still speak
   WHIP/WHEP to MediaMTX — one HTTP POST of an SDP offer, an SDP
   answer back — and the hard-won behaviour around that
   handshake is preserved, because every piece of it exists to
   fix a bug that is invisible until you play the recording back.

   WHAT CHANGED, AND WHY

   · `firstVideoFrame` was a detached <video> plus
     `requestVideoFrameCallback`, which is a proof that a frame
     was DECODED. There is no native equivalent: react-native-
     webrtc gives no frame callback before negotiation. The race
     it guards is real either way — MediaMTX finalises a
     session's track list a beat after the peer connection is
     up, and whatever has produced data by then IS the stream,
     permanently. Lose it and the session registers as AUDIO
     ONLY: viewers get sound over a black rectangle and the
     recording is written with no video track at all. So the
     warm-up stays, as a bounded wait on the track reaching
     `live` plus a short settle. It is a heuristic where the web
     had a signal, and it is marked as one.

   · The wake lock was `navigator.wakeLock`; here it is
     expo-keep-awake, re-taken on foreground, because a sleeping
     display suspends the camera on a phone exactly as it does
     on a laptop.

   · There is no <video> element. `playWhep` returns the
     MediaStream and the caller renders it in <RTCView>.

   Both entry points return a handle with `.stop()`. Always call
   it: it is what turns the camera light off.
   ========================================================= */
import { AppState, type AppStateStatus } from 'react-native'
import {
  MediaStream,
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpSender,
  RTCSessionDescription,
  mediaDevices,
} from 'react-native-webrtc'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { ICE_SERVERS } from '@/platform/env'

/** True when the media engine is actually in this build. */
export const hasWebRTC = typeof RTCPeerConnection === 'function'

/* react-native-webrtc declares this shape but does not export it, and the
   ambient DOM one is only in scope because tsconfig still lists `lib: DOM` for
   the web target. Borrowing it would break the day that goes, so it is spelled
   out here. */
export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/* `EXPO_PUBLIC_ICE_SERVERS` is a JSON array of these. A public STUN server is
   enough on a friendly network; anything behind a symmetric NAT needs a TURN
   server, which is deployment config rather than app code. */
export function iceServers(): IceServer[] {
  const raw = String(ICE_SERVERS || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch { /* malformed config must not stop a call from connecting at all */ }
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

const KEEP_AWAKE_TAG = 'ika-live'

/** Wait for ICE gathering, then POST the complete offer (non-trickle WHIP).
 *  The cap keeps a slow network from hanging "Go live" forever. */
function iceGathered(pc: any, capMs = 1500): Promise<void> {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish() }
    pc.addEventListener('icegatheringstatechange', onChange)
    setTimeout(finish, capMs)
  })
}

/** Prefer H264 on the video sender so the server's HLS remux works too — WHEP
 *  viewers are codec-agnostic, but HLS/mpegts-fmp4 wants H264. Best-effort:
 *  never let a codec preference stop a broadcast. */
function preferH264(pc: any) {
  try {
    const tx = pc.getTransceivers?.().find((t: any) => t.sender?.track?.kind === 'video')
    if (!tx?.setCodecPreferences || !RTCRtpSender.getCapabilities) return
    const caps = RTCRtpSender.getCapabilities('video')
    if (!caps?.codecs?.length) return
    const h264 = caps.codecs.filter((c: any) => /H264/i.test(c.mimeType))
    if (h264.length) {
      tx.setCodecPreferences([...h264, ...caps.codecs.filter((c: any) => !/H264/i.test(c.mimeType))])
    }
  } catch { /* best-effort */ }
}

/**
 * Stop degradation from taking the picture to zero.
 *
 * The default under CPU or uplink pressure sheds BOTH resolution and
 * framerate, and the framerate floor is low enough to look like a freeze.
 * `maintain-framerate` sheds pixels instead, which is what a talking-head
 * broadcast wants. The bitrate cap is the other half: an uncapped sender on a
 * weak uplink drives itself into loss, and lost H264 packets are unrecoverable
 * until the next keyframe.
 */
function tuneVideoSender(pc: any) {
  const sender = pc.getSenders?.().find((s: any) => s.track?.kind === 'video')
  if (!sender?.getParameters) return
  try {
    const params: any = sender.getParameters()
    params.degradationPreference = 'maintain-framerate'
    params.encodings = params.encodings?.length ? params.encodings : [{}]
    params.encodings[0].maxBitrate = 2_500_000
    params.encodings[0].maxFramerate = 30
    sender.setParameters(params).catch(() => {})
  } catch { /* best-effort — never let tuning break publishing */ }
}

/**
 * The native stand-in for the web's decoded-frame wait.
 *
 * `getUserMedia` resolves when the device is acquired, not when it is
 * delivering. The settle is a heuristic, not a proof — see the header — and it
 * is bounded, because going live without the warm-up beats not going live.
 */
async function warmUpCamera(media: any, timeoutMs = 1200): Promise<void> {
  const track = media.getVideoTracks?.()[0]
  if (!track) return
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (track.readyState === 'live') break
    await new Promise(r => setTimeout(r, 60))
  }
  /* Even a live track needs the capture pipeline to have produced something
     before MediaMTX closes its track list. */
  await new Promise(r => setTimeout(r, 400))
}

/** Outbound encoder progress + the loss the RECEIVER reports, in one pass.
 *  `framesEncoded` only proves the local encoder is running — it climbs
 *  happily while every packet is lost in transit. `fractionLost` comes from
 *  MediaMTX's RTCP reports and is what actually arrived. */
async function videoOutbound(pc: any): Promise<{ framesEncoded?: number; fractionLost?: number } | null> {
  try {
    const stats = await pc.getStats()
    let out: any = null
    let fractionLost: number | undefined
    stats.forEach((r: any) => {
      if (r.type === 'outbound-rtp' && (r.kind || r.mediaType) === 'video') out = r
      if (r.type === 'remote-inbound-rtp' && (r.kind || r.mediaType) === 'video'
        && typeof r.fractionLost === 'number') fractionLost = r.fractionLost
    })
    if (!out) return null
    return { framesEncoded: out.framesEncoded, fractionLost }
  } catch { return null }
}

export type LiveHealth = 'ok' | 'stalled' | 'recovered' | 'lost'

/** Which step a failure happened at, stamped onto the thrown error as
 *  `e.stage`: 'capture' is the device itself refusing to open; 'signal' is
 *  everything after — SDP, ICE, the WHIP/WHEP exchange. The UI branches its
 *  HEADLINE on this; the message itself is the server's and is never
 *  re-worded. Without the tag a whipUrl pointing at an unreachable host reads
 *  as "the camera could not start", which sends the host to the wrong fix. */
export type LiveStage = 'capture' | 'signal'

function tagStage(e: any, stage: LiveStage) {
  try { if (e && e.stage == null) e.stage = stage } catch { /* frozen error */ }
  return e
}

export interface PublishOptions {
  onState?: (state: string) => void
  /** Fires as soon as the camera is captured, BEFORE the SDP exchange. */
  onLocalStream?: (media: any) => void
  onHealth?: (state: LiveHealth, detail?: string) => void
  constraints?: any
  signal?: AbortSignal
}

/**
 * Keep the PICTURE alive for the whole broadcast — the fix for "the recording
 * freezes partway through but the sound keeps playing".
 *
 * A video track can stop feeding the encoder without the peer connection ever
 * leaving `connected`: the OS suspends the camera when the screen locks,
 * another app grabs it, or a burst of loss leaves the H264 chain undecodable
 * with no keyframe coming. Audio is Opus — every packet stands alone — so
 * sound sails on regardless, and downstream MediaMTX simply has no more video
 * samples to write.
 *
 * So: poll `framesEncoded`, and when it stops advancing, re-acquire the camera
 * and `replaceTrack`. A brand-new encoder always opens with a keyframe, which
 * repairs both the live picture and everything written from that point on. The
 * transceiver is reused, so the published track SET never changes — a changed
 * track set is what makes MediaMTX restart its recorder and split the file.
 */
function watchVideo(pc: any, media: any, constraints: any, opts: PublishOptions) {
  const POLL_MS = 2000
  const STALL_POLLS = 3            // ~6s of no encoded frames before we act
  const GRACE_MS = 6000            // the encoder is allowed to be slow to start
  const LOSS_FRACTION = 0.12       // >12% of an interval lost = the chain is breaking
  const LOSS_POLLS = 3             // sustained ~6s, so a blip is ignored
  const LOSS_COOLDOWN_MS = 20000   // at most one forced keyframe per 20s

  let dead = false
  let last = -1
  let stalls = 0
  let lossy = 0
  let lastForcedKeyframeAt = 0
  let healing = false
  let startedAt: number | null = null

  const report = (state: LiveHealth, detail?: string) => {
    try { opts.onHealth?.(state, detail) } catch { /* host callback */ }
  }

  const heal = async (why: string) => {
    if (dead || healing) return
    healing = true
    report('stalled', why)
    try {
      const old = media.getVideoTracks()[0]
      /* Stop the old one FIRST: a device that was yanked or is held by another
         app refuses a second concurrent open, and we would rather re-take the
         one we had than fail. */
      try { old?.stop() } catch { /* already gone */ }

      const fresh: any = await mediaDevices.getUserMedia({ video: constraints.video, audio: false })
      const track = fresh.getVideoTracks()[0]
      if (!track) throw new Error('no video track')
      if (dead) { track.stop(); return }

      const sender = pc.getSenders().find((s: any) => s.track?.kind === 'video')
      if (!sender) throw new Error('no video sender')
      await sender.replaceTrack(track)

      if (old) media.removeTrack(old)
      media.addTrack(track)
      /* Inherit the host's Camera-off state — healing must not switch their
         camera back on behind them. */
      if (old) track.enabled = old.enabled
      tuneVideoSender(pc)
      arm(track)

      last = -1; stalls = 0; lossy = 0; startedAt = null
      opts.onLocalStream?.(media)
      report('recovered')
    } catch (e: any) {
      report('lost', e?.message || 'the camera could not be reopened')
    } finally {
      healing = false
    }
  }

  /* `ended` is the device going for good; `mute` is the platform saying frames
     stopped arriving (screen lock, another app took the camera). Both mean the
     picture is gone now — no need to wait out the poll. */
  function arm(track: any) {
    if (!track) return
    track.addEventListener?.('ended', () => void heal('the camera was disconnected'))
    track.addEventListener?.('mute', () => void heal('the camera stopped sending frames'))
  }
  arm(media.getVideoTracks()[0])

  const timer = setInterval(async () => {
    if (dead || healing) return
    const track = media.getVideoTracks()[0]
    /* Camera deliberately off: black frames are correct, do not "repair" them. */
    if (!track || track.enabled === false) { last = -1; stalls = 0; lossy = 0; return }
    if (pc.connectionState !== 'connected' && pc.connectionState !== 'new') return

    const rtp = await videoOutbound(pc)
    const frames = rtp?.framesEncoded
    if (typeof frames !== 'number') return

    if (startedAt === null) startedAt = Date.now()
    if (Date.now() - startedAt < GRACE_MS) { last = frames; return }

    if (frames > last) {
      if (stalls) report('ok')
      last = frames
      stalls = 0

      /* The encoder is alive but the PICTURE can still be frozen downstream.
         Sustained receiver-reported loss means the decode chain broke and
         nothing is repairing it, so force a keyframe by re-acquiring — rate
         limited, because on a weak uplink the extra keyframe adds to the
         congestion that caused the loss. */
      const frac = typeof rtp?.fractionLost === 'number' ? rtp.fractionLost : 0
      if (frac >= LOSS_FRACTION) {
        lossy += 1
        if (lossy >= LOSS_POLLS && Date.now() - lastForcedKeyframeAt >= LOSS_COOLDOWN_MS) {
          lastForcedKeyframeAt = Date.now()
          lossy = 0
          void heal('packet loss froze the picture')
        }
      } else if (lossy) {
        lossy = 0
      }
      return
    }
    stalls += 1
    if (stalls >= STALL_POLLS) void heal('the camera stopped producing frames')
  }, POLL_MS)

  return () => { dead = true; clearInterval(timer) }
}

/** Hold the screen awake while broadcasting, and re-take it on foreground —
 *  a sleeping display suspends the camera, which is the single most common way
 *  a live picture dies with the app still open. */
function holdWakeLock() {
  let dead = false
  const take = () => {
    if (dead) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
  }
  take()
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') take()
  })
  return () => {
    dead = true
    sub.remove()
    try { deactivateKeepAwake(KEEP_AWAKE_TAG) } catch { /* never taken */ }
  }
}

/** POST an SDP offer to a WHIP/WHEP endpoint, return the answer SDP. */
async function exchangeSdp(url: string, offerSdp: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
  }
  return res.text()
}

export interface PublishHandle {
  pc: any
  media: any
  /** Tell the handle which way the camera faces NOW. `_switchCamera` swaps
   *  the capture device without touching constraints, but heal() re-acquires
   *  WITH them — left at their publish-time value, a stall-heal after a flip
   *  silently reopens the original camera. */
  setFacing: (facingMode: 'user' | 'environment') => void
  stop: () => void
}

const DEFAULT_CONSTRAINTS = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
  audio: { echoCancellation: true, noiseSuppression: true },
}

/**
 * Capture the camera + mic and publish to `whipUrl`.
 *
 * The publish URL carries the per-stream secret as `?pass=`; MediaMTX forwards
 * it to the backend's auth hook. It is host-only and null for viewers, which
 * is why the first line refuses rather than trying.
 */
export async function publishCamera(whipUrl: string, opts: PublishOptions = {}): Promise<PublishHandle> {
  if (!hasWebRTC) throw new Error('The media engine is not available in this build.')
  if (!whipUrl) throw new Error('This stream has no publish URL (are you the host?)')

  /* A mutable copy: `setFacing` rewrites facingMode in place — heal() closes
     over this exact object — and mutating the module-level defaults (or the
     caller's object) would leak one broadcast's facing into the next. */
  const given = opts.constraints || DEFAULT_CONSTRAINTS
  const constraints: any = {
    ...given,
    video: given.video && typeof given.video === 'object' ? { ...given.video } : given.video,
  }
  let media: any
  try {
    media = await mediaDevices.getUserMedia(constraints)
  } catch (e: any) {
    /* The one failure that IS the camera (or the mic). Everything after this
       point is signaling and must not wear the camera's headline. */
    throw tagStage(e, 'capture')
  }
  const pc: any = new RTCPeerConnection({ iceServers: iceServers() })

  let stopped = false
  let unwatch: (() => void) | null = null
  let unlock: (() => void) | null = null
  const stop = () => {
    if (stopped) return
    stopped = true
    unwatch?.()
    unlock?.()
    try { pc.close() } catch { /* already closed */ }
    media.getTracks().forEach((t: any) => t.stop())
  }
  /* See PublishHandle: keeps heal()'s re-acquisition pointed at the camera the
     host actually selected, not the one they started on. */
  const setFacing = (facingMode: 'user' | 'environment') => {
    if (constraints.video && typeof constraints.video === 'object') constraints.video.facingMode = facingMode
    else constraints.video = { facingMode }
  }

  try {
    /* Hand the caller the stream the moment it exists, BEFORE the handshake:
       the host sees their own camera instead of staring at a black stage
       through the SDP round trip, and a preview that is already rendering
       keeps the capture pipeline awake going into it. */
    opts.onLocalStream?.(media)

    media.getTracks().forEach((t: any) => pc.addTrack(t, media))
    preferH264(pc)
    if (opts.onState) {
      pc.addEventListener('connectionstatechange', () => opts.onState!(pc.connectionState))
    }

    await warmUpCamera(media)

    await pc.setLocalDescription(await pc.createOffer({}))
    await iceGathered(pc)
    const answer = await exchangeSdp(whipUrl, pc.localDescription.sdp, opts.signal)
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer }))

    /* Tuning waits for the answer: encoding parameters only exist once the
       transceiver has been negotiated. */
    tuneVideoSender(pc)
    unwatch = watchVideo(pc, media, constraints, opts)
    unlock = holdWakeLock()
    return { pc, media, setFacing, stop }
  } catch (e: any) {
    stop()
    throw tagStage(e, 'signal')
  }
}

export interface WatchHandle {
  pc: any
  /** Render with `<RTCView streamURL={stream.toURL()} />`. */
  stream: any | null
  stop: () => void
}

/**
 * Watch a stream over WHEP (sub-second latency). HLS is the higher-latency,
 * universal-reach fallback and stays on the watch screen; this is the low
 * latency path.
 */
export async function playWhep(
  whepUrl: string,
  opts: { onState?: (s: string) => void; onStream?: (s: any) => void; signal?: AbortSignal } = {},
): Promise<WatchHandle> {
  if (!hasWebRTC) throw new Error('The media engine is not available in this build.')
  if (!whepUrl) throw new Error('This stream has no low-latency URL')

  const pc: any = new RTCPeerConnection({ iceServers: iceServers() })
  const handle: WatchHandle = { pc, stream: null, stop: () => {} }

  let stopped = false
  handle.stop = () => {
    if (stopped) return
    stopped = true
    try { pc.close() } catch { /* already closed */ }
    handle.stream = null
  }

  try {
    /* recvonly — we are only pulling the host's tracks down. */
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.addEventListener('track', (e: any) => {
      const stream = e.streams?.[0]
      if (!stream) return
      handle.stream = stream
      opts.onStream?.(stream)
    })
    if (opts.onState) {
      pc.addEventListener('connectionstatechange', () => opts.onState!(pc.connectionState))
    }

    await pc.setLocalDescription(await pc.createOffer({}))
    await iceGathered(pc)
    const answer = await exchangeSdp(whepUrl, pc.localDescription.sdp, opts.signal)
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer }))
    return handle
  } catch (e: any) {
    handle.stop()
    /* recvonly — there is no capture step to blame on this path. */
    throw tagStage(e, 'signal')
  }
}

export { MediaStream, MediaStreamTrack }
