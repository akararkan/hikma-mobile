/* =========================================================
   usePublisher — a WHIP broadcast with a React lifetime.

   `publishCamera` already owns the hard part (warm-up, codec
   preference, the frames-encoded watchdog, the wake lock). What
   it does NOT own is a screen: when to start, what to do when
   the app is backgrounded, and how to put "your picture froze"
   in front of the person who can fix it. That is this hook, and
   the host console and an on-stage guest need exactly the same
   answers, so there is one.

   Two decisions worth stating:

   · Backgrounding STOPS the publish. iOS suspends camera
     capture the moment the app leaves the foreground and the
     app has no background-camera entitlement, so the
     alternative is not "keep broadcasting" — it is broadcasting
     a frozen frame while the host believes they are live. We
     stop, say so, and re-take the camera on return.
   · `health` is surfaced, never swallowed. 'stalled' and 'lost'
     are the difference between a host who restarts a camera and
     a host who finds out afterwards that half the recording is
     a still.
   ========================================================= */
import React from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { hasWebRTC, publishCamera, type LiveHealth, type PublishHandle } from '@/lib/liveWebrtc'

export type PublishStatus = 'idle' | 'starting' | 'live' | 'paused' | 'error'
export type Facing = 'front' | 'back'

export interface Publisher {
  status: PublishStatus
  /** The LOCAL capture stream — render with `<RTCView streamURL={…} />`. */
  stream: any | null
  health: LiveHealth | null
  healthDetail: string | null
  error: any
  facing: Facing
  micOn: boolean
  camOn: boolean
  /** True while the HOST has muted you. The mic is dead at the source and
   *  `toggleMic` cannot revive it — only the host can. */
  hostMuted: boolean
  /** True when the camera or mic was refused, so the fix is Settings. */
  denied: boolean
  start: () => void
  stop: () => void
  restart: () => void
  toggleMic: () => void
  toggleCam: () => void
  flip: () => void
}

export interface PublisherOptions {
  /** Publish as soon as a `whipUrl` exists. */
  enabled?: boolean
  facing?: Facing
  /** The host's authoritative mute for YOU, straight off the `stream.stage`
   *  roster. live-multiguest-frontend.md §5 makes honouring it a must-do:
   *  every other client silences your audio element, but until the track
   *  itself is disabled you are still publishing sound — the mute has to bite
   *  at the source, not just at the speakers. */
  hostMuted?: boolean
}

function constraintsFor(facing: Facing) {
  return {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      facingMode: facing === 'front' ? 'user' : 'environment',
    },
    audio: { echoCancellation: true, noiseSuppression: true },
  }
}

/** A denied camera/mic is the one publish failure the user can fix themselves,
 *  and it needs different copy from "the server said no". */
function isPermissionDenial(e: any): boolean {
  const name = String(e?.name || '')
  const msg = String(e?.message || '')
  return name === 'SecurityError' || name === 'NotAllowedError' || /permission/i.test(msg)
}

export function usePublisher(
  whipUrl: string | null | undefined,
  { enabled = true, facing: initialFacing = 'front', hostMuted = false }: PublisherOptions = {},
): Publisher {
  const [status, setStatus] = React.useState<PublishStatus>('idle')
  const [stream, setStream] = React.useState<any>(null)
  const [health, setHealth] = React.useState<LiveHealth | null>(null)
  const [healthDetail, setHealthDetail] = React.useState<string | null>(null)
  const [error, setError] = React.useState<any>(null)
  const [facing, setFacing] = React.useState<Facing>(initialFacing)
  const [micOn, setMicOn] = React.useState(true)
  const [camOn, setCamOn] = React.useState(true)

  const handleRef = React.useRef<PublishHandle | null>(null)
  const startingRef = React.useRef(false)
  /* Set when we stopped for the background, so returning to the foreground
     knows the difference between "resume" and "the host stopped on purpose". */
  const resumeRef = React.useRef(false)
  const wantRef = React.useRef(false)
  const facingRef = React.useRef<Facing>(initialFacing)
  const urlRef = React.useRef<string | null>(whipUrl ?? null)
  urlRef.current = whipUrl ?? null
  /* Read through refs so a mic toggle does not re-identify `begin` and, with
     it, every effect that depends on it. */
  const micRef = React.useRef(true)
  const camRef = React.useRef(true)
  /* The host's mute is kept SEPARATE from micRef: micRef is the guest's own
     intent, and it has to survive being muted so that being unmuted restores
     whatever they had chosen rather than force-opening a mic they had closed
     themselves. Audio is live only when both agree. */
  const hostMutedRef = React.useRef(hostMuted)
  hostMutedRef.current = hostMuted
  const audioLive = () => micRef.current && !hostMutedRef.current

  const teardown = React.useCallback(() => {
    handleRef.current?.stop()
    handleRef.current = null
    setStream(null)
  }, [])

  const begin = React.useCallback(async () => {
    const url = urlRef.current
    if (startingRef.current || handleRef.current) return
    if (!hasWebRTC) {
      setStatus('error')
      setError(new Error('The media engine is not available in this build.'))
      return
    }
    if (!url) return

    startingRef.current = true
    setStatus('starting')
    setError(null)
    setHealth(null)
    setHealthDetail(null)
    try {
      const handle = await publishCamera(url, {
        constraints: constraintsFor(facingRef.current),
        /* Fires before the SDP round trip — the preview is up while the
           handshake is still in flight, which is also what keeps the capture
           pipeline warm going into it. Guarded on wantRef: a stop() that lands
           while getUserMedia is still pending (the permission dialog is up, a
           grant was revoked) must not resurrect a dead stream after the caller
           already cleared it — "publishing" UI keyed off `stream` would show a
           black pane over an idle publish. */
        onLocalStream: media => { if (wantRef.current) setStream(media) },
        onState: s => {
          /* A publish peer connection does not come back on its own. Saying
             'lost' hands the host a restart instead of a frozen preview. */
          if (s === 'failed' || s === 'closed') {
            setHealth('lost')
            setHealthDetail('the connection to the server dropped')
          }
        },
        onHealth: (state, detail) => {
          setHealth(state)
          setHealthDetail(detail ?? null)
        },
      })
      /* The publish was disowned while it was in flight — stop() ran, the
         credential was revoked, or the app was backgrounded. Clear the stream
         too: onLocalStream may have set it before the disowning landed. */
      if (!wantRef.current) { handle.stop(); setStream(null); return }
      handleRef.current = handle
      /* Re-assert the preview at adoption: a background-and-back round trip
         during the handshake clears it after onLocalStream has already fired,
         and that callback will not fire again. */
      setStream(handle.media)
      /* Inherit the toggles: a restart must not switch a muted mic back on,
         nor undo a host mute that is still in force. */
      handle.media.getAudioTracks().forEach((t: any) => { t.enabled = audioLive() })
      handle.media.getVideoTracks().forEach((t: any) => { t.enabled = camRef.current })
      setStatus('live')
    } catch (e: any) {
      teardown()
      setError(e)
      setStatus('error')
    } finally {
      startingRef.current = false
    }
  }, [teardown])

  const start = React.useCallback(() => {
    wantRef.current = true
    resumeRef.current = false
    void begin()
  }, [begin])

  const stop = React.useCallback(() => {
    wantRef.current = false
    resumeRef.current = false
    teardown()
    setStatus('idle')
    setHealth(null)
    setHealthDetail(null)
  }, [teardown])

  const restart = React.useCallback(() => {
    wantRef.current = true
    resumeRef.current = false
    teardown()
    setHealth(null)
    setHealthDetail(null)
    void begin()
  }, [begin, teardown])

  /* Auto-start once a url exists. `enabled` is the caller's gate — the host
     who chose an external encoder never trips it. */
  React.useEffect(() => {
    if (!enabled || !whipUrl || !hasWebRTC) return
    wantRef.current = true
    void begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, whipUrl])

  /* A revoked credential, or a caller that switched the publish off, must
     release the camera. A guest taken off the stage stops SENDING; losing
     their seat in the roster is not the same thing. */
  React.useEffect(() => {
    if (enabled && whipUrl) return
    wantRef.current = false
    resumeRef.current = false
    handleRef.current?.stop()
    handleRef.current = null
    setStream(null)
    setStatus(s => (s === 'idle' ? s : 'idle'))
    setHealth(null)
    setHealthDetail(null)
  }, [enabled, whipUrl])

  React.useEffect(() => () => {
    /* The one call that turns the camera light off. */
    wantRef.current = false
    handleRef.current?.stop()
    handleRef.current = null
  }, [])

  React.useEffect(() => {
    let last: AppStateStatus = AppState.currentState
    const sub = AppState.addEventListener('change', next => {
      /* 'background' only. iOS reports 'inactive' for a Control Centre pull or
         a notification banner, and dropping the broadcast for that would be
         far more disruptive than the half second of frozen frame it saves. */
      const leaving = next === 'background' && last !== 'background'
      const returning = next === 'active' && last !== 'active'
      if (leaving && (handleRef.current || startingRef.current)) {
        resumeRef.current = true
        /* Disown an in-flight begin() too, not just the handle: teardown()
           cannot reach a publish that is still awaiting inside publishCamera,
           so the adoption guard has to refuse it — otherwise it completes in
           the background, 'live' overwrites 'paused', and the server gets the
           frozen frames iOS left in the suspended camera. */
        wantRef.current = false
        teardown()
        setStatus('paused')
      } else if (returning && resumeRef.current) {
        resumeRef.current = false
        /* Leaving cleared wantRef so the backgrounded publish would be
           refused; wanting it again is what resuming IS. resumeRef alone
           gates this — stop() and a revoked credential both clear it. */
        wantRef.current = true
        void begin()
      }
      last = next
    })
    return () => sub.remove()
  }, [begin, teardown])

  /* Every roster frame carries the host's verdict, so apply it to the live
     track here rather than only at adoption — a mute landing mid-broadcast has
     to take effect on the frame it arrives in, and an unmute has to give the
     guest back exactly the mic state they had chosen. Also runs when `stream`
     appears, which covers a mute that arrived before the capture did. */
  React.useEffect(() => {
    try { handleRef.current?.media.getAudioTracks().forEach((t: any) => { t.enabled = audioLive() }) }
    catch { /* stopped between the roster frame and here */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- audioLive reads refs
  }, [hostMuted, stream])

  const toggleMic = React.useCallback(() => {
    const next = !micRef.current
    micRef.current = next
    setMicOn(next)
    /* Records the intent either way, but a host-muted guest stays silent —
       the track only opens when the host lifts the mute. */
    try { handleRef.current?.media.getAudioTracks().forEach((t: any) => { t.enabled = next && !hostMutedRef.current }) }
    catch { /* stopped mid-toggle */ }
  }, [])

  const toggleCam = React.useCallback(() => {
    const next = !camRef.current
    camRef.current = next
    setCamOn(next)
    /* `enabled = false` publishes black frames, which is what the viewer should
       see. The frames-encoded watchdog knows to leave a deliberately dark
       camera alone rather than "repairing" it. */
    try { handleRef.current?.media.getVideoTracks().forEach((t: any) => { t.enabled = next }) }
    catch { /* stopped mid-toggle */ }
  }, [])

  const flip = React.useCallback(() => {
    setFacing(f => {
      const next: Facing = f === 'front' ? 'back' : 'front'
      facingRef.current = next
      /* The handle is told first: `_switchCamera` swaps the device without
         touching constraints, but a stall-heal re-acquires WITH them — left
         un-updated, it would flip the camera straight back mid-broadcast. */
      handleRef.current?.setFacing(next === 'front' ? 'user' : 'environment')
      /* `_switchCamera` swaps the capture device on the SAME track, so there is
         no renegotiation and no gap in the published stream. */
      try { handleRef.current?.media.getVideoTracks().forEach((t: any) => t._switchCamera?.()) }
      catch { /* no camera to flip */ }
      return next
    })
  }, [])

  return {
    status,
    stream,
    health,
    healthDetail,
    error,
    facing,
    micOn,
    camOn,
    hostMuted,
    denied: isPermissionDenial(error),
    start,
    stop,
    restart,
    toggleMic,
    toggleCam,
    flip,
  }
}
