/* =========================================================
   One transport interface, two clocks.

   A reel is either a video (expo-video owns the clock) or a
   still photo (nothing owns a clock, so we make one). The
   progress bar, the scrubber, the pause glyph and the audio
   mirror all want the same four questions answered, so they
   ask a Transport rather than branching on the media type in
   five places.

   The web's still-clock did this by extending EventTarget and
   dispatching DOM Events — neither exists on native, so the
   still half is re-implemented here on a requestAnimationFrame
   loop.
   ========================================================= */
import React from 'react'
import type { VideoPlayer } from 'expo-video'

export interface Transport {
  play(): void
  pause(): void
  /** Seconds, clamped by the implementation. */
  seek(t: number): void
  getTime(): number
  /** 0 while the clip's metadata has not landed. */
  getDuration(): number
  isPlaying(): boolean
  /** Returns an unsubscribe. Fires ~4×/s while playing. */
  onTime(fn: (time: number, duration: number) => void): () => void
  /** Fires when the clip really starts or stops — a buffer stall included.
   *  `onTime` cannot report a stall (a stalled clock sends no updates) and
   *  polling `isPlaying` would only find it late, so anything that has to move
   *  WITH the picture listens here. Returns an unsubscribe. */
  onPlayingChange(fn: (isPlaying: boolean) => void): () => void
  /** Fires each time the clip reaches its end. With `loop` on, expo-video
   *  emits `playToEnd` on BOTH platforms before restarting (iOS emits then
   *  seeks to zero; Android emits on the repeat transition), so this is the
   *  auto-advance signal — and looping stays the natural fallback for
   *  whoever ignores it. Returns an unsubscribe. */
  onEnded(fn: () => void): () => void
}

/** Wrap an expo-video player. Cheap and allocation-free per call — the object
 *  is memoised by the caller against the player identity. */
export function videoTransport(player: VideoPlayer): Transport {
  return {
    play() { try { player.play() } catch { /* released mid-swipe */ } },
    pause() { try { player.pause() } catch { /* released mid-swipe */ } },
    seek(t) { try { player.currentTime = Math.max(0, t) } catch { /* not seekable yet */ } },
    getTime() { try { return player.currentTime || 0 } catch { return 0 } },
    getDuration() { try { return player.duration || 0 } catch { return 0 } },
    isPlaying() { try { return !!player.playing } catch { return false } },
    onTime(fn) {
      const sub = player.addListener('timeUpdate', (e: any) => {
        fn(e?.currentTime ?? 0, (() => { try { return player.duration || 0 } catch { return 0 } })())
      })
      /* The unsubscribe is guarded for the same reason as everything above it,
         and this one is not hypothetical: the pool owns the players and lives
         in the PAGER, and React destroys a parent's effects before its
         children's — so on unmount the player is already released by the time
         a card's or the progress bar's cleanup gets here, and removing the
         last listener reaches into the native emitter. A throw inside an
         unmount cleanup is re-thrown by React with no boundary above the reels
         stack, which is a hard crash on leaving the tab. */
      return () => { try { sub.remove() } catch { /* released with the pool */ } }
    },
    onPlayingChange(fn) {
      const sub = player.addListener('playingChange', (e: any) => fn(!!e?.isPlaying))
      /* Guarded for the reason spelled out under onTime: on unmount the pool
         has already released these players. */
      return () => { try { sub.remove() } catch { /* released with the pool */ } }
    },
    onEnded(fn) {
      const sub = player.addListener('playToEnd', () => fn())
      /* Guarded for the reason spelled out under onTime. */
      return () => { try { sub.remove() } catch { /* released with the pool */ } }
    },
  }
}

/* ---------------------------------------------------------
   useStillReelDriver — the photo reel's synthetic clock.

   A still has no natural length, so it gets 6 seconds and
   loops, which is what makes the progress bar, the scrub
   gesture and the added sound behave identically to a video.
   The loop only runs while the page is active AND playing, so
   an off-screen still costs nothing.
   --------------------------------------------------------- */

export function useStillReelDriver(durationSeconds = 6, active = false): Transport {
  const time = React.useRef(0)
  const playing = React.useRef(false)
  const raf = React.useRef<number | null>(null)
  const last = React.useRef(0)
  const subs = React.useRef(new Set<(t: number, d: number) => void>())
  const playSubs = React.useRef(new Set<(v: boolean) => void>())
  const endSubs = React.useRef(new Set<() => void>())
  const duration = Math.max(0.5, durationSeconds || 6)

  const durRef = React.useRef(duration)
  durRef.current = duration

  const stop = React.useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null }
  }, [])

  const tick = React.useCallback((now: number) => {
    const dt = last.current ? (now - last.current) / 1000 : 0
    last.current = now
    const advanced = time.current + dt
    time.current = advanced % durRef.current
    for (const fn of subs.current) fn(time.current, durRef.current)
    /* The wrap is this clock's `playToEnd` — announced AFTER the time subs so
       an advance triggered by it never paints against a stale position. */
    if (advanced >= durRef.current) for (const fn of endSubs.current) fn()
    raf.current = requestAnimationFrame(tick)
  }, [])

  const start = React.useCallback(() => {
    if (raf.current != null) return
    last.current = 0
    raf.current = requestAnimationFrame(tick)
  }, [tick])

  /* Leaving the page rewinds: a still that resumes three seconds in on the way
     back looks like a bug rather than a loop. */
  React.useEffect(() => {
    if (active) return
    const was = playing.current
    playing.current = false
    time.current = 0
    stop()
    for (const fn of subs.current) fn(0, durRef.current)
    if (was) for (const fn of playSubs.current) fn(false)
  }, [active, stop])

  React.useEffect(() => stop, [stop])

  return React.useMemo<Transport>(() => ({
    /* The synthetic clock cannot stall, so its play/pause IS its playing state
       — the still half of `onPlayingChange` is simply this pair announcing
       itself. */
    play() {
      if (!playing.current) { playing.current = true; for (const fn of playSubs.current) fn(true) }
      start()
    },
    pause() {
      if (playing.current) { playing.current = false; for (const fn of playSubs.current) fn(false) }
      stop()
    },
    seek(t) {
      time.current = Math.min(durRef.current, Math.max(0, t))
      for (const fn of subs.current) fn(time.current, durRef.current)
    },
    getTime() { return time.current },
    getDuration() { return durRef.current },
    isPlaying() { return playing.current },
    onTime(fn) {
      subs.current.add(fn)
      fn(time.current, durRef.current)
      return () => { subs.current.delete(fn) }
    },
    onPlayingChange(fn) {
      playSubs.current.add(fn)
      return () => { playSubs.current.delete(fn) }
    },
    onEnded(fn) {
      endSubs.current.add(fn)
      return () => { endSubs.current.delete(fn) }
    },
  }), [start, stop])
}
