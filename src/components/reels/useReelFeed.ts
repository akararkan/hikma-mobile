/* =========================================================
   One hook, four incompatible paging models.

   `usePaged` covers the two shapes the rest of the app uses
   (cursor and page). The reels domain has neither for half its
   feeds, and mixing them up is silent rather than loud:

     for-you   NO pagination at all. Every call returns a
               freshly ranked top-N, so pages are appended with
               a Set dedupe and the list is NEVER re-sorted on
               rankScore (that would fight the server's own
               diversity re-ranker).
     following cursor = the last row's raw createdAt.
     latest    UTC DAY BUCKETS. 'YYYY-MM-DD' walking backwards;
               an empty bucket is not the end of the feed, so
               it takes seven consecutive empty days to stop.
     sound     one window of N id-tuples, hydrated one GET per
               row. No cursor exists on that endpoint.
     watched   one window of the watch ledger (it ignores
               `page`), hydrated the same way, resumed from the
               seed's own entry.

   Hence a bespoke hook rather than a fifth mode on usePaged:
   the day walk and the dedupe-on-re-request are feed-specific
   behaviour, not a paging strategy anyone else wants.
   ========================================================= */
import React from 'react'
import { api, isTransient } from '@/api'
import type { ReelSourceKind, ViewPost } from './types'

const MAX_EMPTY_DAYS = 7
const FOR_YOU_PAGE = 10
const CURSOR_PAGE = 10
const DAY_PAGE = 20
const SOUND_WINDOW = 30
const WATCH_WINDOW = 40
/** posts.get hydrations in the air at once — a window must not open forty sockets. */
const HYDRATE_CHUNK = 6

export interface ReelFeedArgs {
  kind: ReelSourceKind
  authorId?: string | null
  soundId?: string | null
  /** 'YYYY-MM-DD' UTC to start the Latest walk from. Defaults to today. */
  startDay?: string | null
  /** A deep link's own reel, shown first while the continuation loads. Cursor
   *  sources also begin AFTER it rather than at the head of the feed, so the
   *  pager is positioned at the reel rather than restarting the list. */
  seed?: ViewPost | null
  /** The rows the tap happened in (reelInbox's open slot). The list opens as
   *  these, nothing is fetched until the user reaches their tail, and the
   *  continuation resumes from that tail. */
  initialItems?: ViewPost[] | null
  enabled?: boolean
}

export interface ReelFeedState {
  items: ViewPost[]
  setItems: React.Dispatch<React.SetStateAction<ViewPost[]>>
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  error: any
  done: boolean
  loadMore: () => void
  refresh: () => void
  reload: () => void
}

export function utcDay(d: Date | string | null | undefined): string {
  const date = d ? new Date(d) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** One GET per id, a few at a time, misses dropped — a watch entry outlives
 *  the reel it points at by design. */
async function hydrate(ids: string[]): Promise<ViewPost[]> {
  const out: ViewPost[] = []
  for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
    const settled = await Promise.allSettled(ids.slice(i, i + HYDRATE_CHUNK).map(id => api.posts.get(id)))
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value as ViewPost)
    }
  }
  return out
}

export function useReelFeed({
  kind, authorId, soundId, startDay, seed, initialItems, enabled = true,
}: ReelFeedArgs): ReelFeedState {
  /* Mount-time only: rows handed over with the tap are the list, and the
     first fetch is skipped for them (once — the mount effect consumes the
     flag). State rather than a ref so the tail can be read during render. */
  const [initial] = React.useState<ViewPost[] | null>(() => (initialItems?.length ? initialItems : null))
  const tail = initial ? initial[initial.length - 1] : null
  const initialPending = React.useRef(!!initial)

  const [items, setItems] = React.useState<ViewPost[]>(() => initial ?? (seed ? [seed] : []))
  const [loading, setLoading] = React.useState(enabled && !initial)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [done, setDone] = React.useState(false)

  const seen = React.useRef(new Set<string>((initial ?? (seed ? [seed] : [])).map(p => p.id)))
  /* Handed-over rows continue from THEIR tail; a lone seed continues from
     itself (see fetchBatch — a null cursor there means "after the seed"). */
  const cursor = React.useRef<string | null>(tail?.createdAt ?? null)
  const day = React.useRef<string>(startDay || utcDay((tail ?? seed)?.createdAt))
  const emptyDays = React.useRef(0)
  const inflight = React.useRef(false)
  const alive = React.useRef(true)
  const retried = React.useRef(false)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /* A deep link's own reel arrives one render after mount (its own GET), and it
     has to be playable before the continuation lands — otherwise the screen is
     blank for as long as the back-fill takes. */
  React.useEffect(() => {
    if (!seed?.id) return
    seen.current.add(seed.id)
    setItems(prev => (prev.length ? prev : [seed]))
  }, [seed?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Seeded lists start with the deep link's own reel already in place, so a
     reset has to put it back rather than blank the screen.

     `retried` is deliberately NOT cleared here. `run` calls reset() at the top
     of every 'first' and 'refresh' attempt, including the attempt the retry
     timer itself scheduled — clearing the flag there re-armed the retry on
     every pass and turned "exactly one delayed retry" into a 2-second poll
     that never stopped while the backend answered 503. It is cleared only
     where a NEW user-initiated cycle begins, and on success. */
  const reset = React.useCallback(() => {
    seen.current = new Set(seed ? [seed.id] : [])
    cursor.current = null
    day.current = startDay || utcDay(seed?.createdAt)
    emptyDays.current = 0
  }, [seed, startDay])

  const fetchBatch = React.useCallback(async (mode: 'first' | 'more' | 'refresh'): Promise<ViewPost[]> => {
    switch (kind) {
      case 'for-you':
      case 'none':
        return api.reels.forYou({ pageSize: FOR_YOU_PAGE })

      /* A first page under a seed starts AFTER the seed (its createdAt is the
         cursor), so a reel opened from a grid continues with the reels that
         follow it there — not with the newest, which the user just scrolled
         past to reach it. The tab has no seed and starts at the head. */
      case 'following':
        return api.reels.following({
          pageSize: CURSOR_PAGE,
          cursor: mode === 'more' ? cursor.current ?? undefined : seed?.createdAt ?? undefined,
        } as any)

      case 'author':
        if (!authorId) return []
        return api.reels.byAuthor(authorId, {
          pageSize: DAY_PAGE,
          cursor: mode === 'more' ? cursor.current ?? undefined : seed?.createdAt ?? undefined,
        } as any)

      case 'latest': {
        /* Walk backwards until a bucket has rows or the week runs out. One
           request per empty day is the endpoint's shape, not a choice. */
        const out: ViewPost[] = []
        while (emptyDays.current < MAX_EMPTY_DAYS && !out.length) {
          const rows: ViewPost[] = await api.reels.feed({ day: day.current, pageSize: DAY_PAGE } as any)
          if (rows.length) {
            emptyDays.current = 0
            out.push(...rows)
            /* A full bucket may have more below it, but the endpoint has no
               intra-day cursor — so the next page is always the day before. */
            day.current = previousDay(day.current)
          } else {
            emptyDays.current += 1
            day.current = previousDay(day.current)
          }
        }
        return out
      }

      case 'sound': {
        if (!soundId) return []
        const rows: any[] = await api.sounds.posts(soundId, SOUND_WINDOW)
        const settled = await Promise.allSettled((rows || []).map(r => api.posts.get(r.postId)))
        return settled
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<ViewPost>).value)
          .filter(Boolean)
      }

      case 'watched': {
        /* One window of the ledger (the endpoint ignores `page`), resumed from
           the seed's own entry so swiping continues down the history rather
           than replaying it from the top. Ids repeat in a watch history; the
           Set keeps one GET per reel. */
        if (mode === 'more') return []
        const res: any = await api.reels.watched({ size: WATCH_WINDOW })
        const ids: string[] = (res?.items || []).map((r: any) => String(r?.reelId || '')).filter(Boolean)
        const at = seed ? ids.indexOf(seed.id) : -1
        return hydrate([...new Set(at >= 0 ? ids.slice(at + 1) : ids)])
      }

      default:
        return []
    }
  }, [kind, authorId, soundId, seed])

  const run = React.useCallback(async (mode: 'first' | 'more' | 'refresh') => {
    if (!enabled || inflight.current) return
    if (mode === 'more' && done) return
    inflight.current = true

    if (mode === 'first') { setLoading(true); setError(null) }
    else if (mode === 'refresh') { setRefreshing(true); setError(null) }
    else setLoadingMore(true)

    if (mode !== 'more') reset()

    try {
      const batch = await fetchBatch(mode)
      if (!alive.current) return

      const fresh: ViewPost[] = []
      for (const row of batch) {
        if (!row?.id || seen.current.has(row.id)) continue
        seen.current.add(row.id)
        fresh.push(row)
      }

      if (mode === 'more') setItems(prev => [...prev, ...fresh])
      else setItems(seed ? [seed, ...fresh.filter(r => r.id !== seed.id)] : fresh)

      /* End-of-list per model. for-you never truly ends; it stops only when a
         whole re-request produced nothing new, which means the ranking has
         converged on what is already on screen. */
      if (kind === 'latest') setDone(emptyDays.current >= MAX_EMPTY_DAYS)
      else if (kind === 'sound' || kind === 'watched' || kind === 'none') setDone(true)
      else if (kind === 'for-you') setDone(mode === 'more' && !fresh.length)
      else {
        const last = batch[batch.length - 1]
        cursor.current = last?.createdAt ?? null
        setDone(!batch.length || !cursor.current)
      }
      retried.current = false
    } catch (e: any) {
      if (!alive.current) return
      if (e?.name === 'AbortError') return
      setError(e)
      /* Exactly one delayed retry, and only for the 503s the docs call
         transient. Anything else is a dead end the user must be told about. */
      if (isTransient(e) && !retried.current) {
        retried.current = true
        setTimeout(() => { if (alive.current) void run(mode) }, 2000)
      }
    } finally {
      inflight.current = false
      if (alive.current) { setLoading(false); setRefreshing(false); setLoadingMore(false) }
    }
  }, [enabled, done, fetchBatch, reset, kind, seed])

  React.useEffect(() => {
    if (!enabled) { setLoading(false); return }
    setDone(false)
    retried.current = false
    /* Rows that came with the tap ARE the first page — nothing to fetch until
       the user reaches their tail. Once only: a later kind/author change is a
       real new list. */
    if (initialPending.current) { initialPending.current = false; return }
    /* Empty FIRST. Switching tabs while the previous feed's rows are still on
       screen would show For You's reels under the Following label for as long
       as the request takes, which is worse than a skeleton. */
    setItems(seed ? [seed] : [])
    void run('first')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind, authorId, soundId])

  const loadMore = React.useCallback(() => {
    if (loading || refreshing || loadingMore || done) return
    void run('more')
  }, [run, loading, refreshing, loadingMore, done])

  /* Both are user-initiated: a pull or a Try again earns a fresh retry budget. */
  const refresh = React.useCallback(() => {
    setDone(false); retried.current = false; void run('refresh')
  }, [run])
  const reload = React.useCallback(() => {
    setDone(false); retried.current = false; void run('first')
  }, [run])

  return { items, setItems, loading, refreshing, loadingMore, error, done, loadMore, refresh, reload }
}
