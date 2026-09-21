/* =========================================================
   The three things a feed list has to watch for.

   1. usePostViewBatcher — one recordView per post per session,
      queued off the gesture rather than fired inside it.
   2. useChannelViewBatcher — the native replacement for the
      web's channel-view tracker, which is IntersectionObserver-
      based and cannot run here at all.
   3. useActiveVideo — which single row is allowed to play.

   All three share one FlashList viewability config, because
   FlashList takes exactly one `onViewableItemsChanged` and
   changing the config at runtime is unsupported.

   Every failure in here is swallowed on purpose: a lost view
   report costs a view, never correctness, and the server dedups
   both surfaces (a 7-day window for posts, a Redis HLL for
   channels) so re-reporting is free.
   ========================================================= */
import React from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { api } from '@/api'
import type { FeedRow } from './types'

const VISIBLE_PERCENT = 50
const MIN_VIEW_MS = 1000
const CHANNEL_FLUSH_MS = 900
const CHANNEL_BATCH = 100
const POST_FLUSH_MS = 900

export interface ViewableInfo {
  viewableItems: { item: FeedRow; key: string; index: number | null; isViewable: boolean }[]
  changed: { item: FeedRow; key: string; index: number | null; isViewable: boolean }[]
}

/* ---------------------------------------------------------
   Channel view batcher.
   --------------------------------------------------------- */

/** Returns `report(channelId, channelPostId)`. Ids stay STRINGS throughout —
 *  a channel message id is a snowflake past Number.MAX_SAFE_INTEGER. */
export function useChannelViewBatcher() {
  const pending = React.useRef(new Map<string, Set<string>>())
  const reported = React.useRef(new Set<string>())
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = React.useCallback(async () => {
    timer.current = null
    const batch = pending.current
    if (!batch.size) return
    pending.current = new Map()

    /* Sequential per channel: the endpoint is a write and a screenful of
       channel rows would otherwise open a dozen parallel connections. */
    for (const [channelId, ids] of batch) {
      const list = [...ids]
      for (let i = 0; i < list.length; i += CHANNEL_BATCH) {
        try { await api.channels.markViews(channelId, list.slice(i, i + CHANNEL_BATCH)) }
        catch { /* a lost report costs a view, not correctness */ }
      }
    }
  }, [])

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    void flush()
  }, [flush])

  return React.useCallback((channelId: string | null | undefined, channelPostId: string | null | undefined) => {
    if (!channelId || !channelPostId) return
    const cid = String(channelId)
    const mid = String(channelPostId)
    const key = `${cid}:${mid}`
    if (reported.current.has(key)) return
    reported.current.add(key)

    const set = pending.current.get(cid) ?? new Set<string>()
    set.add(mid)
    pending.current.set(cid, set)

    if (!timer.current) timer.current = setTimeout(() => { void flush() }, CHANNEL_FLUSH_MS)
  }, [flush])
}

/* ---------------------------------------------------------
   Post view batcher.

   Same shape as the channel one above, and for the same reason:
   `onViewableItemsChanged` runs mid-gesture, and firing a write
   per newly-visible row there puts a fetch on the JS thread on
   the frames that can least afford one. There is no bulk view
   endpoint for posts, so this cannot become one request — but it
   moves every request off the gesture and serialises them
   instead of opening a screenful of parallel connections.
   --------------------------------------------------------- */

function usePostViewBatcher() {
  const pending = React.useRef<string[]>([])
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = React.useCallback(async () => {
    timer.current = null
    const batch = pending.current
    if (!batch.length) return
    pending.current = []
    for (const id of batch) {
      try { await api.posts.recordView(id) }
      catch { /* a lost report costs a view, not correctness */ }
    }
  }, [])

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    void flush()
  }, [flush])

  /* Dedup lives in the caller's `seen` set, so this only ever queues an id
     once per session. */
  return React.useCallback((id: string) => {
    pending.current.push(id)
    if (!timer.current) timer.current = setTimeout(() => { void flush() }, POST_FLUSH_MS)
  }, [flush])
}

/* ---------------------------------------------------------
   The active video.

   One id in a module-level store with per-key listeners — the
   same shape RealtimeContext's presence store uses. Rows ask
   "am I the active video" via useIsActiveVideo(), so moving
   the flag wakes the row losing it and the row gaining it,
   never the list: the id must NOT be React state upstream of
   renderItem, or every hand-off re-invokes it for every
   visible row mid-scroll.
   --------------------------------------------------------- */

type Listener = () => void

let activeVideoId: string | null = null
const activeListeners = new Map<string, Set<Listener>>()

function wakeActive(key: string | null) {
  if (!key) return
  for (const fn of [...(activeListeners.get(key) ?? [])]) {
    try { fn() } catch { /* one broken subscriber must not starve the rest */ }
  }
}

function setActiveVideo(next: string | null) {
  if (next === activeVideoId) return
  const prev = activeVideoId
  activeVideoId = next
  wakeActive(prev)
  wakeActive(next)
}

function subscribeActiveVideo(key: string, fn: Listener) {
  const set = activeListeners.get(key) ?? new Set<Listener>()
  activeListeners.set(key, set)
  set.add(fn)
  return () => { set.delete(fn); if (!set.size) activeListeners.delete(key) }
}

/** True while THIS row is the one allowed to autoplay video. */
export function useIsActiveVideo(id: string): boolean {
  const subscribe = React.useCallback((fn: Listener) => subscribeActiveVideo(id, fn), [id])
  const read = React.useCallback(() => activeVideoId === id, [id])
  return React.useSyncExternalStore(subscribe, read)
}

/* ---------------------------------------------------------
   The one viewability handler.
   --------------------------------------------------------- */

export interface FeedTracking {
  viewabilityConfig: { itemVisiblePercentThreshold: number; minimumViewTime: number }
  onViewableItemsChanged: (info: ViewableInfo) => void
}

/** Wires post views, channel views and the single active video onto one
 *  FlashList viewability pass. */
export function useFeedTracking(): FeedTracking {
  const seen = React.useRef(new Set<string>())
  const reportChannel = useChannelViewBatcher()
  const reportPost = usePostViewBatcher()
  /* The last row viewability chose, so blur can drop the flag and focus can
     put it back without waiting for the list to move — `onViewableItemsChanged`
     only fires on scroll, and a feed you return to is usually still. */
  const lastPlayable = React.useRef<string | null>(null)
  const focused = React.useRef(false)

  /* The store outlives the screen; unmount must clear it or a stale id plays
     the wrong video on the next mount. */
  React.useEffect(() => () => setActiveVideo(null), [])

  /* The feed is a tab screen and never unmounts, so blur is the only signal
     that its video should stop: without this, pushing a post or switching to
     Reels leaves the row holding a decoder and — if the reader unmuted it —
     playing audio underneath whatever replaced it. */
  useFocusEffect(React.useCallback(() => {
    focused.current = true
    if (AppState.currentState === 'active') setActiveVideo(lastPlayable.current)
    return () => { focused.current = false; setActiveVideo(null) }
  }, []))

  /* Backgrounding is the same story minus the navigation event. Coming back
     only re-arms if the feed is still the screen on top — otherwise resuming
     from the Reels tab would restart the feed's video behind it. */
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') setActiveVideo(null)
      else if (focused.current) setActiveVideo(lastPlayable.current)
    })
    return () => sub.remove()
  }, [])

  const onViewableItemsChanged = React.useCallback((info: ViewableInfo) => {
    let firstPlayable: string | null = null

    for (const entry of info.viewableItems) {
      const item = entry.item as any
      if (!item) continue
      /* Missing kind means POST — the convention every caller already uses
         (keyExtractor's `item.kind ?? 'POST'`), and posts DO arrive kind-less:
         the scholar rail maps `postFromFeedItem` bare, without the feed
         dispatcher's stamp. Skipping them left those videos never activating
         and their views never recorded. */
      const kind = item.kind ?? 'POST'

      if (!firstPlayable && hasVideo(item)) firstPlayable = String(item.id)

      if (kind === 'CHANNEL_POST') {
        reportChannel(item.channel?.id, item.channelPostId)
        continue
      }
      if (kind === 'LIVE_RAIL' || kind === 'PYMK') continue

      const id = String(item.id || '')
      if (!id || seen.current.has(id)) continue
      seen.current.add(id)
      /* POST / RESEARCH / QUESTION all live behind the post view endpoint on
         the feed; a research or question row's own view is counted on
         click-through, so only real posts are reported here. */
      if (kind === 'POST') reportPost(id)
    }

    /* Most-visible wins, and "none visible" must clear the flag or a video
       keeps playing off-screen. */
    lastPlayable.current = firstPlayable
    setActiveVideo(firstPlayable)
  }, [reportChannel, reportPost])

  const viewabilityConfig = React.useMemo(
    () => ({ itemVisiblePercentThreshold: VISIBLE_PERCENT, minimumViewTime: MIN_VIEW_MS }),
    [],
  )

  return { viewabilityConfig, onViewableItemsChanged }
}

function hasVideo(item: any): boolean {
  return Array.isArray(item?.media) && item.media[0]?.type === 'VIDEO' && !!item.media[0]?.url
}
