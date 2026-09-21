/* =========================================================
   The one tray, kept fresh by the ONE tray socket the app owns.

   The story-tray SSE stream is already open app-wide in
   src/context/RealtimeContext.tsx (stream 3 of the three the
   shell holds — realtime/overview.md §3), and the backend caps
   a user at FIVE emitters with LRU eviction. Opening a second
   tray socket here would spend a slot the per-story / per-post
   streams need and could evict the app's own chat stream — so
   this store NEVER dials `api.stories.trayStream` itself. It
   subscribes to the provider's fan-out (`subscribeStoryTray`)
   and folds the events into module state.

   The module-singleton shape (rather than a second provider)
   buys one thing: the viewer can read the ordered tray
   synchronously (`traySnapshot()`) to decide its page list
   before its first render.

   Three pieces of state live here:

     tray   followed authors with an active story, assembled by
            '@/lib/storyTray' (there is NO tray list endpoint)
     mine   your own frames, so the rail's own ring and the hub's
            "Your story" card share one read
     poll   the author-only live tally bus — poll_vote_cast is
            one of the two documented events that REPLACE a
            counter instead of nudging it
   ========================================================= */
import React from 'react'
import { adapters, api, assetUrl } from '@/api'
import { useRealtimeApi, useRealtimeConnection } from '@/context/RealtimeContext'
import { invalidateTray, loadTray } from '@/lib/storyTray'
import type { StoryRow, Tally } from './storyVisual'

export interface TrayEntry {
  authorId: string
  author: { id: string; full: string; handle: string; initials: string; avc: string; profileImage: string | null; verified?: boolean }
  cover: string | null
  /** Newest TEXT frame's words, only when no cover exists — the tile paints
   *  them on their frameGradient instead of a blank plate. */
  preview?: string | null
  /** The storyId that seeds that gradient. */
  previewSeed?: string | null
  count: number
  at: number
  /** Epoch ms of the LAST frame to expire — the sweep in publish() drops the
   *  ring when it passes, so a ring cannot outlive its stories between
   *  fan-outs. Null when the wire carried nothing. */
  expiresAt?: number | null
  time: string
}

export interface TraySnapshot {
  tray: TrayEntry[]
  mine: StoryRow[]
  loading: boolean
  /** The app shell's realtime streams have handshaken and not errored —
   *  mirrored from RealtimeContext's badge (the streams are torn down and
   *  re-dialled together on background/foreground, so one flag covers all). */
  connected: boolean
}

const EMPTY: TraySnapshot = { tray: [], mine: [], loading: false, connected: false }

let snap: TraySnapshot = EMPTY
let viewerId: string | null = null
let mounts = 0
let unsubscribeStream: (() => void) | null = null
let trayInflight: Promise<void> | null = null
let mineInflight: Promise<void> | null = null

const listeners = new Set<() => void>()
const tallies = new Map<string, Tally>()
const tallyListeners = new Map<string, Set<(t: Tally) => void>>()

function publish(next: Partial<TraySnapshot>) {
  /* Expiry sweep at the one write choke point: an SSE-inserted ring carries
     its own expiresAt, and without this it survived until the next fan-out
     even after every frame behind it was gone. */
  if (next.tray) {
    const now = Date.now()
    next = { ...next, tray: next.tray.filter(e => !e.expiresAt || e.expiresAt > now) }
  }
  snap = { ...snap, ...next }
  listeners.forEach(fn => fn())
}

/* ---------------------------------------------------------
   Reads
   --------------------------------------------------------- */

/** Re-run the client-side fan-out. `force` drops the 60s module cache first —
 *  pull-to-refresh and every SSE (re)connect both mean "you may have missed
 *  something", which is exactly when a cached answer is the wrong one. */
export function refreshTray(force = false): Promise<void> {
  if (!viewerId) return Promise.resolve()
  if (trayInflight && !force) return trayInflight
  if (force) invalidateTray()
  const id = viewerId
  publish({ loading: !snap.tray.length })
  /* Same bookkeeping as refreshMine below: a forced refresh REPLACES the
     registered read, so a superseded one must neither publish its (possibly
     pre-invalidation) rows over its successor's nor deregister it — both are
     gated on the promise still being the one on record. */
  const p: Promise<void> = loadTray(id)
    .then((rows: any) => { if (viewerId === id && trayInflight === p) publish({ tray: (rows || []) as TrayEntry[], loading: false }) })
    /* loadTray fail-opens to [] and never throws; this only catches a bug. */
    .catch(() => { if (viewerId === id && trayInflight === p) publish({ loading: false }) })
    .finally(() => { if (trayInflight === p) trayInflight = null })
  trayInflight = p
  return p
}

function fetchMine(): Promise<void> {
  const id = viewerId
  if (!id) return Promise.resolve()
  return api.stories.byAuthor(id)
    .then((rows: StoryRow[]) => { if (viewerId === id) publish({ mine: rows || [] }) })
    .catch(() => {})
}

/** Your own live frames. Fail-open for the same reason the rail is: a broken
 *  own-story read must not take a garnish down with it. Screens that need to
 *  SHOW the failure (the hub's card) call byAuthor themselves. `force` means
 *  "a write just committed": instead of returning an inflight read that may
 *  predate it, chain a fresh one behind it. */
export function refreshMine(force = false): Promise<void> {
  if (!viewerId) return Promise.resolve()
  if (mineInflight) {
    if (!force) return mineInflight
    const chained: Promise<void> = mineInflight
      .then(() => fetchMine())
      .finally(() => { if (mineInflight === chained) mineInflight = null })
    mineInflight = chained
    return chained
  }
  const p: Promise<void> = fetchMine()
    .finally(() => { if (mineInflight === p) mineInflight = null })
  mineInflight = p
  return p
}

/** After any own-story create or delete, anywhere in the app. */
export function invalidateStories() {
  invalidateTray()
  void refreshTray(true)
  void refreshMine(true)
}

/** The ordered tray, readable outside React — the viewer needs it before its
 *  first render to build its page list. */
export function traySnapshot(): TrayEntry[] { return snap.tray }

/* ---------------------------------------------------------
   The fan-out subscription.

   RealtimeContext owns the socket; this store only routes its
   events. Payloads arrive as { type, ...StoryTrayEvent } —
   type is 'new_story' | 'story_removed' | 'poll_vote_cast'
   (realtime.md#story-tray-stream).
   --------------------------------------------------------- */

function onTrayEvent(ev: any) {
  const id = viewerId
  switch (ev?.type) {
    case 'new_story': {
      /* The stream does not fan your own posts back to you, and if it ever
         did, your ring is not lit by your own frame — it is lit by a view. */
      if (!ev?.authorId || (id && String(ev.authorId) === String(id))) return
      const authorId = String(ev.authorId)
      const author = adapters.authorFrom({
        id: ev.authorId, username: ev.authorUsername, fullName: ev.authorFullName, profileImage: ev.authorAvatarUrl,
      })
      const previous = snap.tray.find(r => String(r.authorId) === authorId)
      publish({
        tray: [
          {
            authorId,
            author,
            /* A pushed row carries only what the frame carried. Blanking a real
               image is worse than serving a slightly stale one — and the text
               preview survives the same way until the next fan-out rebuilds it. */
            cover: ev.thumbnailUrl ? assetUrl(ev.thumbnailUrl) : (previous?.cover ?? null),
            preview: ev.thumbnailUrl ? null : (previous?.preview ?? null),
            previewSeed: ev.thumbnailUrl ? null : (previous?.previewSeed ?? null),
            count: previous ? previous.count + 1 : 1,
            at: Date.now(),
            /* The frame carries its own expiry (realtime.md tray table); a
               fresh frame extends the ring past any older stamp. */
            expiresAt: ev.expiresAt
              ? Math.max(new Date(ev.expiresAt).getTime() || 0, previous?.expiresAt ?? 0) || null
              : (previous?.expiresAt ?? null),
            time: 'now',
          },
          ...snap.tray.filter(r => String(r.authorId) !== authorId),
        ],
      })
      invalidateTray()
      return
    }

    case 'story_removed': {
      if (!ev?.authorId) return
      const authorId = String(ev.authorId)
      /* Known coarseness, inherited from the shipped hook: the payload names a
         story but the rail is keyed by author, so an author with other live
         frames vanishes until the next fan-out puts them back. */
      publish({ tray: snap.tray.filter(r => String(r.authorId) !== authorId) })
      invalidateTray()
      void refreshTray(true)
      return
    }

    case 'poll_vote_cast': {
      const pollId = ev?.pollId != null ? String(ev.pollId) : ''
      if (!pollId) return
      /* REPLACE, never ±1. The numbers come from the counter read the vote
         itself performed — this is one of exactly two documented exceptions to
         the delta model. */
      const next: Tally = { voteA: Number(ev.voteA) || 0, voteB: Number(ev.voteB) || 0 }
      tallies.set(pollId, next)
      tallyListeners.get(pollId)?.forEach(fn => fn(next))
      return
    }

    default:
  }
}

/* ---------------------------------------------------------
   Hooks
   --------------------------------------------------------- */

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/* One reconcile per epoch bump, however many components are mounted. */
let lastEpoch: number | null = null

/**
 * Warm the tray BEFORE the rail mounts. The rail lives in the home feed's
 * FlashList header, so the hook's own mount refresh otherwise waits for feed
 * page 1 to resolve — one full round-trip of serial latency on every cold
 * open. Same viewer bookkeeping as the hook's mount effect; the stream
 * fan-out still attaches when the first rail subscribes, and refreshTray's
 * in-flight guard folds the two calls into one read.
 */
export function warmTray(id?: string | null): void {
  const me = id ? String(id) : null
  if (!me) return
  if (viewerId !== me) {
    viewerId = me
    snap = { ...EMPTY, loading: true }
    invalidateTray()
  }
  void refreshTray(false)
  void refreshMine()
}

/**
 * The tray, live. Mount it anywhere; the first subscriber attaches this store
 * to the app-wide tray stream's fan-out (RealtimeContext stream 3 — never a
 * socket of its own, see the header) and the last detaches it.
 */
export function useStoryTray(id?: string | null): TraySnapshot & { refresh: () => Promise<void> } {
  const { subscribeStoryTray } = useRealtimeApi()
  const conn = useRealtimeConnection()
  const state = React.useSyncExternalStore(subscribe, () => snap, () => snap)

  React.useEffect(() => {
    const me = id ? String(id) : null
    if (!me) return undefined
    if (viewerId !== me) {
      /* A different account signed in: nothing cached about the old one is
         true any more. */
      viewerId = me
      snap = { ...EMPTY, loading: true }
      invalidateTray()
    }
    mounts += 1
    if (mounts === 1) unsubscribeStream = subscribeStoryTray(onTrayEvent)
    void refreshTray(false)
    void refreshMine()
    return () => {
      mounts -= 1
      if (mounts === 0) { unsubscribeStream?.(); unsubscribeStream = null }
    }
  }, [id, subscribeStoryTray])

  /* Mirror the shell's stream health, and reconcile on every (re)connect: the
     provider bumps `epoch` per handshake, and whatever the tray stream would
     have pushed while the sockets were down was never delivered
     (realtime.md#reconnection-checklist). Module-level guard so N mounted
     subscribers trigger ONE re-fan-out. */
  React.useEffect(() => {
    if (snap.connected !== conn.connected) publish({ connected: conn.connected })
    if (lastEpoch === null) { lastEpoch = conn.epoch; return }
    if (conn.epoch !== lastEpoch) {
      lastEpoch = conn.epoch
      void refreshTray(true)
      void refreshMine()
    }
  }, [conn.connected, conn.epoch])

  const refresh = React.useCallback(async () => {
    await Promise.all([refreshTray(true), refreshMine()])
  }, [])

  return { ...state, refresh }
}

/**
 * Live tallies for one poll, pushed to its AUTHOR only. Returns null until
 * something arrives — a null here means "no push yet", never "zero votes".
 */
export function usePollTally(pollId?: string | null): Tally | null {
  const [tally, setTally] = React.useState<Tally | null>(() => (pollId ? tallies.get(String(pollId)) ?? null : null))

  React.useEffect(() => {
    if (!pollId) { setTally(null); return undefined }
    const key = String(pollId)
    setTally(tallies.get(key) ?? null)
    let set = tallyListeners.get(key)
    if (!set) { set = new Set(); tallyListeners.set(key, set) }
    set.add(setTally)
    return () => {
      set!.delete(setTally)
      if (!set!.size) tallyListeners.delete(key)
    }
  }, [pollId])

  return tally
}
