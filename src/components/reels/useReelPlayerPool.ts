/* =========================================================
   Three players, for as long as the tab is watched.

   A reel feed is unbounded; VideoPlayers are not. Each one
   holds a decoder, and a phone gives you a handful before
   playback starts failing silently on the oldest — so the pool
   is fixed at three (previous / active / next) and recycles
   them with replaceAsync as the index moves. Everything
   further away renders a static plate, which is also why
   swiping fast never spins up a fourth decode. The tab stays
   mounted behind the rest of the app, so on blur the pool
   PARKS after a grace period: every slot's source is dropped
   (a sourceless player keeps no decoder) and the window
   reloads on refocus, resuming the active clip where it was.

   Slot assignment is `index % 3`, which is what makes the
   handoff free: the three indexes in the window are always in
   three different slots, so moving one page forward only ever
   replaces the source of the page that just left the window.

   TWO ORDERING FACTS THIS FILE IS BUILT AROUND.

   1. `useVideoPlayer` registers its own release effect at the
      call site, i.e. BEFORE every effect written below it.
      React destroys a component's effects in registration
      order, so on unmount the three players are released
      FIRST and anything this hook does afterwards would be
      talking to a dead native object ("Any subsequent calls to
      native functions of the object will throw"). Hence
      `released` — an effect registered above the players,
      whose cleanup therefore runs before theirs. Every
      touch of a player is gated on it. It is a lifecycle
      signal, not a try/catch: if a player throws for any
      OTHER reason we still want to hear about it.
   2. `replaceAsync` resolves off the main queue, so two
      replaces issued on one slot can complete out of order.
      Each slot therefore has a generation counter and a
      promise chain: the newest issue wins, stale completions
      are dropped, and autoplay is re-issued when the load
      lands (a `play()` against a player mid-replace is
      swallowed by AVPlayer, which is the classic "the reel
      won't start after a fast swipe").
   ========================================================= */
import { useVideoPlayer, type VideoPlayer } from 'expo-video'
import React from 'react'
import { Platform } from 'react-native'
import { clipUrlOf, isStillReel, type ViewPost } from './types'

export type ClipStatus = 'idle' | 'loading' | 'readyToPlay' | 'error'

export interface ReelPlayerPool {
  /** null for anything outside the ±1 window, or for a still reel. */
  getPlayer: (index: number) => VideoPlayer | null
  activePlayer: VideoPlayer | null
  statusOf: (index: number) => ClipStatus
  /** Re-issue the source for one page — the "Couldn't play this reel" retry. */
  retry: (index: number) => void
}

const SLOTS = 3
const slotOf = (i: number) => ((i % SLOTS) + SLOTS) % SLOTS

/* Expo Video caches progressive files on-device, but its iOS cache cannot
   accept HLS or DASH. Reels are normally MP4, so cache those repeat plays
   while leaving streaming sources on the native streaming path. */
const cacheableClip = (url: string | null) => !!url && /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url)
const clipSource = (url: string | null) => (
  url ? (cacheableClip(url) ? { uri: url, useCaching: true } : { uri: url }) : null
)

/* How long a blur may last before the decoders are let go. The comments
   route and a quick hop to another tab both blur the pager, and coming back
   inside the grace costs nothing — but position survives parking too (the
   active clip resumes where it was), so the grace only has to beat the
   COMMON dip, not the longest imaginable one. */
const PARK_AFTER_BLUR_MS = 30_000

export function useReelPlayerPool(
  items: ViewPost[],
  activeIndex: number,
  { muted, paused, focused }: { muted: boolean; paused: boolean; focused: boolean },
): ReelPlayerPool {
  /* MUST stay above the useVideoPlayer calls — see (1) in the header. Leaving
     the screen also has to stop the audio, and this is the LAST moment the
     players are still alive, so the pause lives here rather than in a cleanup
     further down (a paused player still holds its decoder, and iOS will
     happily keep the audio session warm for it). */
  const playersRef = React.useRef<VideoPlayer[]>([])
  const released = React.useRef(false)
  React.useEffect(() => {
    released.current = false
    return () => {
      for (const p of playersRef.current) p.pause()
      released.current = true
    }
  }, [])

  const setup = React.useCallback((p: VideoPlayer) => {
    p.loop = true
    p.timeUpdateEventInterval = 0.25
    /* Three decoders share one pipe, and the defaults assume they don't.
       Android buffers 20s PER PLAYER ahead — the two neighbours eat exactly
       the bandwidth the active clip needs for its first frame; 8s is a full
       pass of most reels anyway. It also refuses to START until 2s are
       buffered, and `waitsToMinimizeStalling` is iOS's version of the same
       gate — but the neighbour pre-attach is this pool's stall insurance,
       so the active clip gets to start on its first buffered frame. */
    p.bufferOptions = {
      preferredForwardBufferDuration: 8,
      minBufferForPlayback: 1,
      waitsToMinimizeStalling: false,
    }
    /* The reel's own three tracks (clip, added sound, voiceover) are MEANT to
       play together. WHO ENFORCES THAT is platform-shaped, and the two answers
       are opposite:
       · ANDROID — audio focus is one grant per app, and expo-audio already
         holds it for the added tracks (armReelAudioSession sets 'doNotMix').
         A second request from ExoPlayer makes the system hand expo-audio's
         listener a LOSS, which pauses every playable it owns: the added track
         goes silent. So the video asks for nothing here.
       · iOS — there is no focus to lose, and audioMixingMode does exactly one
         thing: it decides the app's session options. 'mixWithOthers' inserts
         .mixWithOthers into the category EVERY time a player starts, which
         silently undoes armReelAudioSession() — reels then play on TOP of
         whatever podcast the phone was already playing, which is the one
         outcome mute.ts exists to prevent. 'doNotMix' agrees with the session
         instead, and the three tracks still share it happily. */
    p.audioMixingMode = Platform.OS === 'android' ? 'mixWithOthers' : 'doNotMix'
  }, [])

  /* Three unconditional hook calls, not a loop — the pool size is a constant
     precisely so this can be written the way React requires. */
  const p0 = useVideoPlayer(null, setup)
  const p1 = useVideoPlayer(null, setup)
  const p2 = useVideoPlayer(null, setup)
  const players = React.useMemo(() => [p0, p1, p2], [p0, p1, p2])
  playersRef.current = players

  const loaded = React.useRef<(string | null)[]>([null, null, null])
  /** Which page each slot's current source belongs to — a slot serves indexes
   *  n, n±3, n±6…, so "same url" is not the same question as "same page". */
  const loadedFor = React.useRef<number[]>([-1, -1, -1])
  const generation = React.useRef<number[]>([0, 0, 0])
  const chain = React.useRef<Promise<void>[]>([
    Promise.resolve(), Promise.resolve(), Promise.resolve(),
  ])
  const [statuses, setStatuses] = React.useState<ClipStatus[]>(['idle', 'idle', 'idle'])
  const [tick, setTick] = React.useState(0)

  const parked = React.useRef(false)
  /** Where the active clip was when the pool parked, keyed by its URL — the
   *  list can shift under a delete while blurred, so an index would lie. */
  const resumeRef = React.useRef<{ url: string; at: number } | null>(null)

  const setSlotStatus = React.useCallback((slot: number, next: ClipStatus) => {
    setStatuses(prev => (prev[slot] === next ? prev : prev.map((s, i) => (i === slot ? next : s))))
  }, [])

  /* The play effect below reads these at completion time rather than closing
     over a render's values — a load that lands two swipes later must obey
     where the user is NOW. */
  const activeRef = React.useRef(activeIndex)
  activeRef.current = activeIndex
  const pausedRef = React.useRef(paused)
  pausedRef.current = paused

  React.useEffect(() => {
    const subs = players.map((p, slot) =>
      p.addListener('statusChange', ({ status }: any) => setSlotStatus(slot, status)),
    )
    return () => {
      /* Unmount: the players are already released and removing a listener
         reaches into the native emitter. Nothing to detach from. */
      if (released.current) return
      for (const s of subs) s.remove()
    }
  }, [players, setSlotStatus])

  /* Only the urls in the window matter here — `items` gets a fresh identity on
     every optimistic like, every SSE delta and every hydration merge, and
     re-running this effect on all of those is how a mid-swipe merge used to
     re-issue the source of the page under the user's thumb. */
  const windowKey = React.useMemo(() => (
    [0, 1, -1].map(offset => {
      const i = activeIndex + offset
      const item = items[i]
      if (!item) return ''
      return isStillReel(item) ? 'still' : (clipUrlOf(item) ?? '')
    }).join(' ')
  ), [items, activeIndex])

  /* Window assignment. Active first: on a fast swipe the neighbours can wait a
     frame, but the page under the user's thumb cannot. */
  React.useEffect(() => {
    /* A parked pool must stay parked: an SSE merge or hydration landing while
       the tab is blurred moves windowKey, and reloading here would quietly
       re-take the three decoders with nobody watching. The unpark effect
       below re-arms this via `tick` on refocus. */
    if (parked.current) return
    for (const offset of [0, 1, -1]) {
      const index = activeIndex + offset
      if (index < 0 || index >= items.length) continue
      const item = items[index]
      const slot = slotOf(index)
      const url = isStillReel(item) ? null : clipUrlOf(item)
      if (loaded.current[slot] === url) continue
      /* Never yank the source out from under the page being watched. The
         hydrated read can come back with a re-transcode or a freshly signed
         url for a clip that is playing perfectly well; swapping it there is a
         black frame and an audio drop on the reel under the user's thumb. The
         one already loaded stays until the page is left. */
      if (offset === 0 && url && loaded.current[slot] && loadedFor.current[slot] === index) continue

      loaded.current[slot] = url
      loadedFor.current[slot] = index
      const mine = ++generation.current[slot]
      const player = players[slot]
      setSlotStatus(slot, url ? 'loading' : 'idle')

      /* One replace at a time per slot, newest wins. */
      chain.current[slot] = chain.current[slot]
        .then(() => {
          if (released.current || generation.current[slot] !== mine) return undefined
          player.pause()
          return player.replaceAsync(clipSource(url))
        })
        .then(() => {
          if (released.current || generation.current[slot] !== mine) return
          /* Back from a parked blur: pick the clip up where it was left. */
          if (url && resumeRef.current?.url === url) {
            player.currentTime = resumeRef.current.at
            resumeRef.current = null
          }
          /* The source only just landed; the play effect fired while the
             replace was still in flight, so the autoplay is re-issued here. */
          if (url && slot === slotOf(activeRef.current) && !pausedRef.current) player.play()
        })
        .catch(() => {
          if (generation.current[slot] !== mine) return
          /* Roll the bookkeeping back — claiming the slot holds a url it never
             loaded is what used to leave a page permanently black, with the
             window effect skipping it forever. The card's Retry re-issues it,
             and the status has to say so or the affordance never renders. */
          if (loaded.current[slot] === url) { loaded.current[slot] = null; loadedFor.current[slot] = -1 }
          setSlotStatus(slot, 'error')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, activeIndex, players, tick, items.length, setSlotStatus])

  /* Blur parking. Without this the three decoders outlive the first visit to
     Reels by the whole session — the tab never unmounts. The sources are
     dropped through each slot's own chain so an in-flight replace cannot
     land after the unload and resurrect its decoder.

     The timer lives in a REF and is cleared only on refocus, never in an
     effect cleanup: the tab's freezeOnBlur tears this effect down one tick
     after blur, so a cleanup-cleared timer died before it could ever fire and
     the decoders lived on for the whole session. The callback is freeze-safe
     — it touches players and refs directly, and the slot-status writes flush
     when the tab thaws. A real unmount is covered by the `released` guard. */
  const parkTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (focused) {
      if (parkTimer.current) { clearTimeout(parkTimer.current); parkTimer.current = null }
      if (!parked.current) return
      parked.current = false
      /* The window effect's deps are unchanged since it parked — re-arm it. */
      setTick(n => n + 1)
      return
    }
    if (parkTimer.current) clearTimeout(parkTimer.current)
    parkTimer.current = setTimeout(() => {
      parkTimer.current = null
      if (released.current || parked.current) return
      parked.current = true
      const activeSlot = slotOf(activeRef.current)
      const activeUrl = loaded.current[activeSlot]
      if (activeUrl) {
        const at = players[activeSlot].currentTime
        resumeRef.current = at > 0 ? { url: activeUrl, at } : null
      }
      for (let slot = 0; slot < SLOTS; slot++) {
        loaded.current[slot] = null
        loadedFor.current[slot] = -1
        const mine = ++generation.current[slot]
        const player = players[slot]
        chain.current[slot] = chain.current[slot]
          .then(() => {
            if (released.current || generation.current[slot] !== mine) return undefined
            player.pause()
            return player.replaceAsync(null)
          })
          .catch(() => { /* a failed unload still detached the old source */ })
        setSlotStatus(slot, 'idle')
      }
    }, PARK_AFTER_BLUR_MS)
  }, [focused, players, setSlotStatus])

  React.useEffect(() => {
    if (released.current) return
    for (const p of players) p.muted = muted
  }, [players, muted])

  /* Exactly one player may be playing. Anything else is two soundtracks. */
  React.useEffect(() => {
    if (released.current) return
    const active = slotOf(activeIndex)
    players.forEach((p, slot) => {
      if (slot === active && !paused && items.length) p.play()
      else p.pause()
    })
  }, [players, activeIndex, paused, items.length])

  const inWindow = React.useCallback(
    (index: number) => Math.abs(index - activeIndex) <= 1,
    [activeIndex],
  )

  const retry = React.useCallback((index: number) => {
    const slot = slotOf(index)
    loaded.current[slot] = null
    loadedFor.current[slot] = -1
    /* `statusChange` is the only other writer, and a slot that errored will
       not emit again until a source loads — so the retry has to clear the
       error itself or the plate never goes away. */
    setSlotStatus(slot, 'loading')
    setTick(n => n + 1)
  }, [setSlotStatus])

  return React.useMemo<ReelPlayerPool>(() => ({
    getPlayer: (index: number) => (inWindow(index) ? players[slotOf(index)] : null),
    activePlayer: items.length ? players[slotOf(activeIndex)] : null,
    statusOf: (index: number) => (inWindow(index) ? statuses[slotOf(index)] : 'idle'),
    retry,
  }), [players, activeIndex, statuses, inWindow, items.length, retry])
}
