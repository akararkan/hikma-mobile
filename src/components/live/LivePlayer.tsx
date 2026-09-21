/* =========================================================
   LivePlayer — one surface, two transports.

   WHEP first (WebRTC, sub-second), HLS second. Both stay,
   because they fail in opposite directions: WHEP needs the
   media engine and a reachable UDP path, HLS reaches
   everything and arrives 5–15s late. The docs call HLS the
   universal-reach fallback and it is exactly that — the ladder
   is WHEP → HLS → poster, never WHEP → nothing.

   `hasWebRTC` is the gate. A build without the engine skips
   straight to HLS and behaves precisely as it did before.

   Four behaviours the naive version gets wrong:

   1. WHEP 404s until the publisher's first packet, the same
      way HLS 404s until the first segment. That is the NORMAL
      start of a broadcast, so both climb a retry ladder before
      anything is called an error.
   2. A dead WHEP session does not heal. The peer connection
      leaving `connected` leaves the LAST DECODED FRAME on
      screen — a still picture that looks live. So a failed
      transport hands over to HLS instead of holding it.
   3. HLS is not started while WHEP is still negotiating.
      Running both means two copies of the same broadcast over
      the same uplink and, once audio is playing on each, an
      echo a second apart.
   4. Under the demo fixture `playbackUrl` is a ~4KB
      `data:video/mp4` URI. AVPlayer/ExoPlayer refuse it, and
      showing a retry card for a fixture that will never load
      is noise — so a data: source goes straight to the poster.
   5. A pushed route (a profile, the stage sheet, supporters)
      leaves this surface MOUNTED and invisible — a full-screen
      decoder chewing frames and uplink behind another screen.
      `active` gates the DECODE and nothing else: the WHEP peer
      connection stays up, so coming back is instant rather than
      a fresh handshake.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useEvent } from 'expo'
import { useVideoPlayer, VideoView, type VideoContentFit, type VideoPlayerStatus } from 'expo-video'
import { RTCView } from 'react-native-webrtc'
import { Button, Spinner, Text } from '@/ui'
import { hasWebRTC, playWhep, type WatchHandle } from '@/lib/liveWebrtc'
import { BROADCAST_PLATE, FILL, ROOM, withAlpha } from './skin'
import { space } from '@/theme/tokens'

/** What is actually delivering pixels right now. */
export type LiveTransport = 'whep' | 'hls' | 'none'

export interface LivePlayerProps {
  playbackUrl: string | null
  /** WebRTC out. Tried first, and only when the engine is in the build. */
  whepUrl?: string | null
  muted?: boolean
  /** False while this surface is covered by a pushed route. Stops decoding
   *  without touching the transport — pass `useIsFocused()`. */
  active?: boolean
  /** Blurred host avatar — the backdrop while buffering and the fallback. */
  poster?: string | null
  contentFit?: VideoContentFit
  /** Called on every expo-video status change so a host console can cross-fade
   *  its "waiting for your encoder" panel out the moment segments appear. */
  onStatus?: (status: VideoPlayerStatus) => void
  /** Fires when the transport changes — the latency chip reads this. */
  onTransport?: (transport: LiveTransport) => void
  /** Hide the inline error card — the host console shows its own panel. */
  quiet?: boolean
  maxRetries?: number
  style?: StyleProp<ViewStyle>
}

const RETRY_MS = 3000
const WHEP_TRIES = 3
const WHEP_RETRY_MS = 2000

export function LivePlayer({
  playbackUrl, whepUrl, muted = false, active = true, poster, contentFit = 'cover',
  onStatus, onTransport, quiet = false, maxRetries = 10, style,
}: LivePlayerProps) {
  const wantWhep = hasWebRTC && !!whepUrl

  /* Remembering WHICH url gave up, rather than a boolean, is what lets a fresh
     url (join() mints the authoritative one) re-arm WHEP with no reset effect
     racing the attempt effect. */
  const [spentWhepUrl, setSpentWhepUrl] = React.useState<string | null>(null)
  const [whepStream, setWhepStream] = React.useState<any>(null)
  const whepSpent = !wantWhep || spentWhepUrl === whepUrl

  React.useEffect(() => {
    if (!wantWhep || whepSpent || !whepUrl) return
    let cancelled = false
    let handle: WatchHandle | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let tries = 0

    const surrender = () => {
      if (cancelled) return
      setWhepStream(null)
      setSpentWhepUrl(whepUrl)
    }

    const attempt = async () => {
      try {
        const h = await playWhep(whepUrl, {
          onStream: s => { if (!cancelled) setWhepStream(s) },
          onState: s => {
            if (s === 'failed' || s === 'disconnected' || s === 'closed') surrender()
          },
        })
        if (cancelled) { h.stop(); return }
        handle = h
      } catch {
        if (cancelled) return
        tries += 1
        if (tries >= WHEP_TRIES) { surrender(); return }
        timer = setTimeout(() => { void attempt() }, WHEP_RETRY_MS)
      }
    }
    void attempt()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      handle?.stop()
      setWhepStream(null)
    }
  }, [whepUrl, wantWhep, whepSpent])

  /* RTCView has no volume: muting a WebRTC stream means disabling its audio
     tracks. This is also how a host's self-monitor avoids feeding back. */
  React.useEffect(() => {
    if (!whepStream) return
    try { whepStream.getAudioTracks().forEach((tr: any) => { tr.enabled = !muted }) }
    catch { /* the stream went away mid-toggle */ }
  }, [whepStream, muted])

  /* Same handle, the other track kind: a disabled video track stops the
     decoder without renegotiating, so the picture is back the frame `active`
     flips rather than after another offer/answer. */
  React.useEffect(() => {
    if (!whepStream) return
    try { whepStream.getVideoTracks().forEach((tr: any) => { tr.enabled = active }) }
    catch { /* the stream went away mid-toggle */ }
  }, [whepStream, active])

  const whepLive = !!whepStream
  const whepPending = wantWhep && !whepSpent && !whepLive

  /* A data: URI is the fixture's stand-in for a stream; the native players
     reject it, so never hand it over in the first place. */
  const hlsUrl = playbackUrl && !playbackUrl.startsWith('data:') ? playbackUrl : null
  const playable = whepLive || whepPending ? null : hlsUrl
  /* WHEP surrendered and there is no HLS rung to fall to: without a terminal
     state this path spun forever (poster) or sat as a bare plate (no poster),
     with nothing to press. */
  const deadEnd = wantWhep && whepSpent && !whepLive && !hlsUrl

  const player = useVideoPlayer(playable ? { uri: playable } : null, p => {
    p.loop = false
    p.muted = muted
    p.timeUpdateEventInterval = 0
    /* useVideoPlayer rebuilds the player when the source changes, so this runs
       again on a ladder swap — including one that happens while the surface is
       covered. Autoplaying there is the very thing `active` exists to stop. */
    if (playable && active) p.play()
  })

  const event = useEvent(player, 'statusChange', { status: player.status })
  const status: VideoPlayerStatus = event?.status ?? 'idle'

  const [attempts, setAttempts] = React.useState(0)
  const giveUp = attempts >= maxRetries

  React.useEffect(() => {
    try { player.muted = muted } catch { /* released mid-swap */ }
  }, [player, muted])
  React.useEffect(() => { onStatus?.(status) }, [status, onStatus])
  React.useEffect(() => { setAttempts(0) }, [playable])

  /* HLS has no track handle, so the gate is the player itself. Coming back
     REPLACES rather than resumes: pause() holds the position, and a live feed
     resumed there is however long the route was covered behind the edge — the
     retry ladder already uses replace() for exactly that reason. The ref skips
     the mount run, where the initializer above has already decided. */
  const wasActive = React.useRef(active)
  React.useEffect(() => {
    if (wasActive.current === active) return
    wasActive.current = active
    if (!playable) return
    try {
      if (active) { player.replace({ uri: playable }); player.play() }
      else player.pause()
    } catch { /* released mid-swap */ }
  }, [active, playable, player])

  const transport: LiveTransport = whepLive ? 'whep' : playable ? 'hls' : 'none'
  React.useEffect(() => { onTransport?.(transport) }, [transport, onTransport])

  React.useEffect(() => {
    /* No ladder-climbing behind a covered route — it would spend the attempt
       budget on a picture nobody can see. The gate above replaces and plays on
       the way back in, which is the retry. */
    if (status !== 'error' || !playable || giveUp || !active) return
    const id = setTimeout(() => {
      setAttempts(n => n + 1)
      try { player.replace({ uri: playable }); player.play() } catch { /* replaced mid-teardown */ }
    }, RETRY_MS)
    return () => clearTimeout(id)
  }, [status, playable, giveUp, player, active])

  const retryNow = () => {
    /* A manual retry re-arms BOTH ladders: the host may have come back since. */
    setSpentWhepUrl(null)
    if (!playable) return
    setAttempts(0)
    try { player.replace({ uri: playable }); player.play() } catch { /* ignore */ }
  }

  const showPoster = !whepLive && (!playable || status !== 'readyToPlay')

  return (
    <View style={[styles.wrap, style]}>
      {/* The base ground is the web's navy broadcast plate (`.lv-stage`) —
          waiting, buffering and posterless states rest on it instead of a
          flat black pane. Everything else paints over it. */}
      <LinearGradient colors={BROADCAST_PLATE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {/* The stand-in backdrop, the TikTok way: the host's picture BLURRED
          and dimmed behind a centered, ringed avatar — a sharp avatar
          stretched full-bleed painted the whole room one muddy colour. The
          blur is media treatment on a dark-by-design surface (owner's TikTok
          directive), not chrome — DESIGN.md's no-blur law governs chrome. */}
      {showPoster && poster ? (
        <>
          <Image
            source={{ uri: poster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            blurRadius={26}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(ROOM.bg, 0.45) }]} />
        </>
      ) : null}

      {whepLive ? (
        <RTCView
          streamURL={whepStream.toURL()}
          objectFit={contentFit === 'contain' ? 'contain' : 'cover'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {playable ? (
        /* Keyed on the source: when the WHEP↔HLS ladder swaps `playable`,
           useVideoPlayer releases the old player under a still-mounted native
           view — the "already released" prop crash. The key replaces both
           together. */
        <VideoView
          key={playable}
          player={player}
          contentFit={contentFit}
          nativeControls={false}
          allowsPictureInPicture={false}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {!deadEnd && (whepPending || (playable && status === 'loading') || (showPoster && !!poster)) ? (
        <View style={styles.center} pointerEvents="none">
          {showPoster && poster ? (
            <View style={[styles.posterRing, { borderColor: withAlpha(ROOM.fg, 0.6) }]}>
              <Image
                source={{ uri: poster }}
                style={styles.posterFace}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </View>
          ) : null}
          <Spinner color={ROOM.fg} style={showPoster && poster ? styles.posterSpin : undefined} />
        </View>
      ) : null}

      {!quiet && (deadEnd || (playable && status === 'error')) ? (
        /* box-none: the card must not swallow the whole surface — before it,
           every tap across the picture (the heart layer, chrome) died here,
           including in the buttonless pre-giveUp state where capturing bought
           nothing. The Button keeps its own touches. */
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: ROOM.glassStrong }]}>
            <Text variant="headline" color={ROOM.fg} align="center">
              {deadEnd || giveUp ? 'Still no picture' : "Can't reach the stream"}
            </Text>
            <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.cardCopy}>
              {deadEnd || giveUp
                ? 'The host may have stopped publishing.'
                : 'The host may still be starting up.'}
            </Text>
            {deadEnd || giveUp ? (
              <Button label="Try again" onPress={retryNow} variant="secondary" size="sm" style={styles.cardBtn} />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: ROOM.pane, overflow: 'hidden' },
  center: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  /* The connecting face: a sharp 84pt circle on the blurred wash. */
  posterRing: { width: 92, height: 92, borderRadius: 46, borderWidth: 2, padding: space.xxs, overflow: 'hidden' },
  posterFace: { flex: 1, borderRadius: 42 },
  posterSpin: { marginTop: space.md2 },
  card: { paddingHorizontal: space.xl, paddingVertical: space.lg, borderRadius: 16, alignItems: 'center', maxWidth: 280 },
  cardCopy: { marginTop: space.xs },
  cardBtn: { marginTop: space.md },
})
