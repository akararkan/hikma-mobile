/* =========================================================
   Reel audio — up to three tracks, one clock.

   The React Native port of mobile-kit/src/hooks/useReelAudio.js.
   A reel can carry three separate pieces of audio and the
   backend keeps them apart:

     · the ORIGINAL, inside the video file — expo-video plays it
     · the ADDED sound, `post.soundUrl`
     · the author's VOICEOVER, `post.voiceoverUrl`

   Nothing is mixed server-side, so the viewer plays all three
   together at the levels THE AUTHOR set (they ride in on the
   `#mix=` fragment — lib/soundMix.js). Watching a reel is not
   the place to re-mix somebody's work: the only control here
   is the master mute.

   EVERYTHING FOLLOWS THE CLIP. The video is the transport; the
   two audio players are slaved to its time updates and
   re-aligned whenever they drift. MUSIC aligns modulo its own
   duration — a short track beds under a long clip and restarts
   when the clip loops. The VOICEOVER aligns ABSOLUTELY: it was
   spoken against the timeline, so it plays once per pass and
   falls silent past its end.

   FOLLOWING THE CLIP MEANS STALLING WITH IT. A clip that runs
   out of buffer stops sending time updates, and audio players
   that know nothing about that run on — so a hiccup used to end
   with the sound seconds ahead of the picture and a corrective
   seek everybody could hear. The tracks therefore watch the
   player's real playing state, not the page's intent, and stop
   and start with it: nothing drifts, so there is nothing to
   correct. It is optimistic — the tracks assume the clip is
   running until the player says otherwise — so a platform that
   never reports the change behaves exactly as it always did.

   AND A TRACK THAT MISSES ITS CUE GETS ANOTHER. `play()` issued
   against a player that is still opening the file can be
   dropped, and an added sound has exactly one cue: the beat the
   page becomes active. So every alignment tick also re-asserts
   it, which costs nothing while the track is already playing
   and is the difference between a silent reel and a correct one
   when it is not.
   ========================================================= */
import React from 'react'
import { useAudioPlayer, type AudioPlayer } from 'expo-audio'
import type { VideoPlayer } from 'expo-video'
import { DEFAULT_MIX, clamp01, readMix } from '@/lib/soundMix'
import { bareUrl } from './types'
import type { Transport } from './transport'

/* Below this the tracks are audibly out of step; above it, correcting on every
   time update (4×/s) would be audible as a stutter of its own. */
const DRIFT = 0.3
/* A track that has not loaded this long after playback started is not going to. */
const LOAD_GRACE_MS = 5000

export interface ReelAudioArgs {
  transport: Transport | null
  /** The clip itself — its own recorded audio is the mix's `orig` channel. */
  videoPlayer?: VideoPlayer | null
  /** post.soundUrl — still carrying its `#mix=` fragment. */
  soundUrl?: string | null
  voiceUrl?: string | null
  /** Changes when the page's media is replaced; re-arms the mirror. */
  srcKey: string
  muted: boolean
  /** The page is the visible one AND playing. */
  playing: boolean
}

export interface ReelAudioState {
  hasMusic: boolean
  /** The added track will not load — the clip plays on, the chip says so. */
  failed: boolean
}

export function useReelAudioNative({
  transport, videoPlayer, soundUrl, voiceUrl, srcKey, muted, playing,
}: ReelAudioArgs): ReelAudioState {
  const track = bareUrl(soundUrl)
  const voice = bareUrl(voiceUrl)

  /* useAudioPlayer keys on JSON.stringify(source), so a plain string url is a
     stable identity and a changed url recreates the player for us. */
  const music: AudioPlayer = useAudioPlayer(track, { updateInterval: 400 })
  const speech: AudioPlayer = useAudioPlayer(voice, { updateInterval: 400 })

  const [failed, setFailed] = React.useState(false)

  /* Intent (the page is the visible one and not paused) and reality (the clip
     is actually rolling) are two different questions, and both are read from
     callbacks that must not re-render the card — a stall is not news the UI
     has any use for. Refs, therefore, and one function that owns the whole
     play/pause policy so the effect, the stall listener and the mirror cannot
     disagree about it. */
  const playRef = React.useRef(playing)
  playRef.current = playing
  const liveRef = React.useRef(true)
  const applyRef = React.useRef<() => void>(() => {})

  /* The author's balance rides on the track url; a reel that carries none — and
     every reel posted before the mix existed — plays at the defaults. */
  const mix = React.useMemo(() => {
    const authored = readMix(soundUrl)
    return authored
      ? { orig: clamp01(authored.orig), music: clamp01(authored.music), voice: clamp01(authored.voice ?? 1) }
      : { ...DEFAULT_MIX }
  }, [soundUrl])

  const mixRef = React.useRef(mix)
  mixRef.current = mix

  React.useEffect(() => { setFailed(false) }, [track])

  applyRef.current = () => {
    const on = playRef.current && liveRef.current && !!transport
    try {
      if (track) { if (on) music.play(); else music.pause() }
    } catch { /* released */ }
    try {
      if (voice) {
        /* Past its end the voiceover stays silent — the align pass below is
           what put it there, and resuming from a stall must not undo that. */
        const d = speech.duration
        const spent = Number.isFinite(d) && d > 0 && (transport?.getTime() ?? 0) >= d
        if (on && !spent) speech.play()
        else speech.pause()
      }
    } catch { /* released */ }
  }

  /* Levels are written onto the players rather than rendered as props: React
     owns neither, and an author who dropped a level to zero meant a level of
     zero — master mute stays the one thing the viewer's button owns. */
  React.useEffect(() => {
    try {
      /* Master mute stays the viewer's only control: an author who dropped a
         level to zero wanted a level of zero, not a mute. */
      if (videoPlayer) videoPlayer.volume = mix.orig
    } catch { /* released */ }
    try {
      music.loop = true
      music.volume = mix.music
      music.muted = muted
    } catch { /* the player was released between renders */ }
    try {
      speech.loop = false
      speech.volume = mix.voice
      speech.muted = muted
    } catch { /* released */ }
  }, [music, speech, videoPlayer, mix, muted, srcKey])

  /* The mirror. Re-attached whenever the clip or a track changes, because the
     players underneath it are replaced. */
  React.useEffect(() => {
    if (!transport) return
    if (!track && !voice) return

    /* `seekTo` returns a promise, and a seek against a track that has not
       finished loading — the normal state for the first few time updates after
       a page turn — REJECTS. The try/catch around the property reads cannot
       catch that, so each call carries its own catch; without it every drift
       correction on a cold track is an unhandled rejection. */
    const align = (time: number) => {
      if (track) {
        try {
          const d = music.duration
          const at = (Number.isFinite(d) && d > 0) ? time % d : time
          if (Math.abs(music.currentTime - at) > DRIFT) music.seekTo(at).catch(() => {})
          /* The re-cue. A time update only exists because the clip is rolling,
             so a track that is not playing here missed its start (or an
             interruption took it) and should be rolling too. */
          if (playRef.current && liveRef.current && !music.playing) music.play()
        } catch { /* not seekable yet */ }
      }
      if (voice) {
        try {
          const d = speech.duration
          if (Number.isFinite(d) && d > 0 && time >= d) {
            if (speech.playing) speech.pause()
          } else {
            if (Math.abs(speech.currentTime - time) > DRIFT) speech.seekTo(time).catch(() => {})
            if (playRef.current && liveRef.current && !speech.playing) speech.play()
          }
        } catch { /* not seekable yet */ }
      }
    }

    /* Two subscriptions, one lifetime: the clock the tracks follow, and the
       signal that the clock has stopped for reasons of its own. */
    const offTime = transport.onTime(align)
    const offPlaying = transport.onPlayingChange(live => {
      if (liveRef.current === live) return
      liveRef.current = live
      applyRef.current()
    })
    return () => { offTime(); offPlaying() }
  }, [transport, music, speech, track, voice, srcKey, playing])

  /* Start and stop with the clip. The tracks arrive one read AFTER the clip
     starts (a feed row carries no audio), so this cannot ride on a play event
     that has already been and gone — it runs whenever either changes. */
  React.useEffect(() => {
    /* A fresh intent clears the stall latch: the clip is about to be told to
       roll, and waiting for it to CONFIRM that before making a sound would
       hand every page turn to whether the platform reports the change. If it
       is still stalled it says so again a frame later, and the tracks stop. */
    liveRef.current = true
    applyRef.current()
  }, [playing, transport, music, speech, track, voice, srcKey])

  /* A dead track must not take the clip down with it. expo-audio surfaces no
     error event, so the honest signal is "it never became loaded". */
  React.useEffect(() => {
    if (!track || !playing || failed) return
    const id = setTimeout(() => {
      try { if (!music.isLoaded) setFailed(true) } catch { setFailed(true) }
    }, LOAD_GRACE_MS)
    return () => clearTimeout(id)
  }, [track, playing, failed, music])

  return { hasMusic: !!track && !failed, failed }
}
