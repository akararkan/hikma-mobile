/* =========================================================
   The ONE chat voice player.

   Messenger grammar: exactly one voice note plays at a time,
   and playback belongs to the SCREEN, not the bubble — a row
   that FlashList recycles mid-fling must not take the audio
   with it, and starting a second note must silence the first.

   So the single native AudioPlayer lives in ChatVoiceHost,
   mounted ONCE in the signed-in layout, and every voice
   surface — VoiceNote bubble or channel VoiceStrip — is a dumb
   transport: it subscribes to this store by row id and sends
   commands. Scrolling away, recycling, even hopping to the
   pinned/starred screens never interrupts playback — the exact
   behaviour the per-bubble players (N native players, playback
   dying on recycle) could not give.

   The chosen speed survives track changes: picking 1.5x is a
   listening-session preference, not a per-message one.

   What survives and what does not: scrolling, recycling and a
   hop to the pinned / starred / media screens all keep the note
   playing, because those are pushed ON TOP of a conversation
   that is still there to come back to. LEAVING the conversation
   is different — the screen is popped, the bubble that owns the
   transport is gone with it, and a note still talking from a
   screen that no longer exists has nothing left to stop it. So
   the conversation calls stop() on its way out (chat/[id]).
   ========================================================= */
import { useEvent } from '@/hooks/useAsync'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import React from 'react'
import { isRecordingLive } from './VoiceRecorder'

export const VOICE_RATES = [1, 1.5, 2] as const

export interface VoiceSnapshot {
  /** The message whose audio the host currently owns — null when idle. */
  id: string | null
  playing: boolean
  /** Seconds, like the player's own clock. */
  position: number
  duration: number
  rate: number
}

const IDLE: VoiceSnapshot = { id: null, playing: false, position: 0, duration: 0, rate: 1 }

/* The recorder's upload hint is useful before metadata arrives, but encoded
   clips — especially short ones — can differ by enough to make a progress
   line visibly race. Once expo-audio knows the decoded duration, it is the
   only clock the transport should use. */
const durationOf = (hintMs: number | null | undefined, nativeDuration: number | null | undefined) => (
  Number.isFinite(nativeDuration) && (nativeDuration || 0) > 0
    ? Number(nativeDuration)
    : Math.max(0, Number(hintMs || 0) / 1000)
)

let snap: VoiceSnapshot = IDLE
const subs = new Set<() => void>()
const publish = (next: VoiceSnapshot) => { snap = next; subs.forEach(fn => fn()) }
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }

/** Live transport state for ONE row. Every clock tick publishes a fresh
 *  snapshot object, and through the plain hook that re-renders every visible
 *  voice bubble several times a second while any note plays. Rows that are
 *  not the active note all map to the same idle state, so they share a cached
 *  snapshot whose identity only changes with the session rate — the ticks
 *  re-render exactly one bubble: the one that is playing. */
export function useChatVoiceFor(id: string): VoiceSnapshot {
  const idle = React.useRef<VoiceSnapshot>(IDLE)
  const readMine = React.useCallback(() => {
    if (snap.id === id) return snap
    if (idle.current.rate !== snap.rate) idle.current = { ...IDLE, rate: snap.rate }
    return idle.current
  }, [id])
  return React.useSyncExternalStore(subscribe, readMine)
}

interface VoiceControls {
  toggle: (id: string, url: string, durationHintMs?: number | null) => void
  seek: (id: string, url: string, seconds: number, durationHintMs?: number | null) => void
  cycleRate: () => void
  stop: () => void
}
let controls: VoiceControls | null = null

export const chatVoice = {
  /** Play (or pause, if it is already the active note) one voice message. */
  toggle(id: string, url: string | null | undefined, durationHintMs?: number | null) {
    /* Never while the mic is live: the host's audio-mode write carries an
       implicit allowsRecording:false on iOS, which force-stops a recorder
       mid-capture. Recording wins; the tap is dropped. */
    if (isRecordingLive()) return
    if (url) controls?.toggle(String(id), url, durationHintMs)
  },
  /** Jump one voice message to `seconds`. The active note keeps its transport
   *  state — a paused note moves its clock without starting, a playing note
   *  plays on from the new position. A note the host does not own is adopted
   *  and plays from there: the scrub said "from here", and a silently parked
   *  track would read as a dead gesture. */
  seek(id: string, url: string | null | undefined, seconds: number, durationHintMs?: number | null) {
    /* Same rule as toggle: recording wins, the gesture is dropped. */
    if (isRecordingLive()) return
    if (url) controls?.seek(String(id), url, Math.max(0, seconds), durationHintMs)
  },
  cycleRate() { controls?.cycleRate() },
  /** End the note and let the track go — the transport returns to rest and the
   *  clock reads the clip's length again. This is a STOP, not a pause: it is
   *  what leaving the screen means, and coming back should start the note from
   *  the top rather than resume a listen the user walked away from. */
  stop() { controls?.stop() },
}

export function ChatVoiceHost() {
  const [track, setTrack] = React.useState<{ id: string; url: string; hintMs: number; startAt?: number } | null>(null)
  const [rateIx, setRateIx] = React.useState(0)
  /* 250ms ticks (default 500). The bubble's trace glides on its own UI-thread
     timing between ticks; the ticks are the drift correction and the clock
     label, and at 4Hz a correction lands before it can grow visible. Only the
     active bubble re-renders per tick (useChatVoiceFor), so the cadence is
     cheap.

     downloadFirst: a voice note is seconds of mono audio — pulling the whole
     file before play() costs one beat on tap and buys playback that can
     never rebuffer mid-listen, which is the messenger feel. Safe HERE
     because this host is the one player and it only exists once a note is
     chosen; on a per-row player this same flag would eagerly download every
     mounted row. */
  const player = useAudioPlayer(track ? { uri: track.url } : null, { updateInterval: 250, downloadFirst: true })
  const status = useAudioPlayerStatus(player)

  /* A commanded seek, held until the native clock confirms it. Status ticks do
     not flow while the player is paused, so without this the store would keep
     serving the pre-scrub position — and the next toggle's end-of-media check
     would rewind a note the user had just scrubbed back into the middle.
     Cleared the moment currentTime moves off the value it held when the
     command went out: the first fresh tick is the player's own answer. */
  const pendingSeek = React.useRef<{ at: number; from: number } | null>(null)
    /* `status.playing` stays false while a newly selected source downloads, so
      it cannot answer whether a second tap means "pause" or "play". Keep the
      user's intent separately and retry it once SDK 57 reports the source
      loaded. */
    const playIntent = React.useRef(false)

  /* A new track autoplays. playsInSilentMode matches the recorder's session —
     a voice note the phone's mute switch silences reads as "broken". */
  React.useEffect(() => {
     if (!track) { playIntent.current = false; return }
     setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => {})
    /* The native player is keyed on the SOURCE, so a forwarded note sharing
       the original's URL keeps the same instance across the track swap —
       rewind first, or play() resumes (and at end-of-media ignores the tap
       entirely) from the previous message's clock. A scrub-adoption lands at
       its scrubbed position instead of the top. */
    try {
      /* 'high' asks iOS for the spectral pitch algorithm. The default
         (timeDomain) keeps pitch too, but garbles speech noticeably at 1.5×
         and badly at 2× — which is exactly where a voice-note speed control
         lives. Android preserves pitch regardless and ignores the hint. */
      player.setPlaybackRate(VOICE_RATES[rateIx], 'high')
      void player.seekTo(track.startAt || 0)
      if (playIntent.current) player.play()
    } catch { /* released mid-swap */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rate changes apply in their own effect
  }, [player, track])

  React.useEffect(() => {
    try { player.setPlaybackRate(VOICE_RATES[rateIx], 'high') } catch { /* released */ }
  }, [player, rateIx])

  /* `play()` before a remote source is ready is allowed but not guaranteed to
     survive every native source swap. This effect is the one deterministic
     retry: it only acts on an outstanding user intent, never after a natural
     finish or an error. */
  React.useEffect(() => {
    if (!track) return
    if (status.didJustFinish) { playIntent.current = false; return }
    if (!playIntent.current || !status.isLoaded || status.playing || status.error) return
    try { player.play() } catch { /* released or still settling */ }
  }, [track, player, status.didJustFinish, status.error, status.isLoaded, status.playing])

  const toggle = useEvent((id: string, url: string, hintMs?: number | null) => {
    if (track?.id === id) {
      if (status.playing || playIntent.current) {
        playIntent.current = false
        try { player.pause() } catch { /* released */ }
        return
      }
      playIntent.current = true
      const total = durationOf(track.hintMs, status.duration)
      /* A finished player replays from the end without the rewind. The clock
         read has to honour an unconfirmed scrub: paused players tick nothing,
         so a note scrubbed off the end still REPORTS end-of-media here — and
         the blind rewind would erase the position the finger just chose. */
      const cur = pendingSeek.current ? pendingSeek.current.at : (status.currentTime || 0)
      if (total > 0 && cur >= total - 0.25) {
        /* Same publish-now rule as seek(): the replay's rewind must not leave
           the bubble parked on a full bar until the first fresh tick — the
           trace would sit at the end for a beat and then snap to the start. */
        pendingSeek.current = { at: 0, from: status.currentTime || 0 }
        void player.seekTo(0)
        publish({ ...snap, position: 0 })
      }
      try { player.play() } catch { /* released */ }
      return
    }
    pendingSeek.current = null
    playIntent.current = true
    try { player.pause() } catch { /* released */ }
    setTrack({ id, url, hintMs: hintMs || 0 })
  })

  const seek = useEvent((id: string, url: string, seconds: number, hintMs?: number | null) => {
    if (track?.id === id) {
      const total = durationOf(track.hintMs, status.duration)
      /* Clamp shy of the very end: landing ON it is indistinguishable from a
         finished note and trips the replay-rewind on the next tap. */
      const at = total > 0 ? Math.min(seconds, Math.max(0, total - 0.1)) : seconds
      pendingSeek.current = { at, from: status.currentTime || 0 }
      try { void player.seekTo(at) } catch { /* released */ }
      /* Publish the landing point NOW. A paused player emits no tick, and a
         snapshot that sits on the pre-scrub time until the next play reads as
         a dropped gesture. The next native tick simply agrees. */
      publish({ ...snap, position: at })
      return
    }
    /* Adoption: same track swap as toggle, plus where to land. */
    const wire = (hintMs || 0) / 1000
    const at = wire > 0 ? Math.min(seconds, Math.max(0, wire - 0.1)) : seconds
    pendingSeek.current = { at, from: 0 }
    playIntent.current = true
    try { player.pause() } catch { /* released */ }
    setTrack({ id, url, hintMs: hintMs || 0, startAt: at })
  })

  const cycleRate = useEvent(() => setRateIx(ix => (ix + 1) % VOICE_RATES.length))

  const stop = useEvent(() => {
    playIntent.current = false
    pendingSeek.current = null
    /* Pause FIRST: dropping the track re-publishes IDLE but does not touch the
       native player, which keeps the source it downloaded and would still be
       talking. */
    try { player.pause() } catch { /* released */ }
    setTrack(null)
    /* The rate goes home too. It used to survive as an app-session preference,
       which meant one tap of 1.5× quietly made EVERY voice note in EVERY chat
       for the rest of the session play fast — reported as "voice messages are
       very fast" with nobody connecting it to the chip they tapped days of
       screens ago. The chosen speed now lives exactly as long as the listening
       session that chose it: leaving the conversation (which is what calls
       stop) returns the transport to 1×. */
    setRateIx(0)
  })

  React.useEffect(() => {
    const mine: VoiceControls = { toggle, seek, cycleRate, stop }
    controls = mine
    return () => { if (controls === mine) { controls = null; publish(IDLE) } }
  }, [toggle, seek, cycleRate, stop])

    /* Push transport state to whichever bubbles are listening. The wire duration
      fills the gap before the decoder reports one; after that native metadata
      is authoritative, so the visual line agrees with the clip's real clock.
     An unconfirmed scrub overrides the position for the same reason it exists
     at all: until the native clock moves, currentTime is the OLD truth. */
  React.useEffect(() => {
    if (!track) { pendingSeek.current = null; publish({ ...IDLE, rate: VOICE_RATES[rateIx] }); return }
    const p = pendingSeek.current
    if (p && (status.currentTime || 0) !== p.from) pendingSeek.current = null
    publish({
      id: track.id,
      playing: !!status.playing,
      position: pendingSeek.current ? pendingSeek.current.at : (status.currentTime || 0),
      duration: durationOf(track.hintMs, status.duration),
      rate: VOICE_RATES[rateIx],
    })
  }, [track, status.playing, status.currentTime, status.duration, rateIx])

  return null
}
