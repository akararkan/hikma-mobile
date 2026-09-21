/* =========================================================
   usePaged — infinite lists, for both paging models.

   The backend uses two, and mixing them up is silent:

     cursor   Cassandra-backed feeds. The server hands back the
              next cursor (or the caller derives it from the
              last row). Stop when the cursor is null or the
              page comes back empty.
     page     Postgres lists. `{ items, hasMore, page, total }`
              via the pageOf() helper the api modules share.

   Both are `mode` here, so a screen swaps one for the other by
   changing a string rather than rewriting its list logic.

   Two rules the docs are explicit about and this enforces:
   page sizes clamp to 100, and duplicate ids are dropped —
   ranked feeds legitimately re-emit an item across pages and
   a duplicate key crashes FlashList.
   ========================================================= */
import React from 'react'

export type PageMode = 'cursor' | 'page'

export interface PagedResult<T> {
  items: T[]
  nextCursor?: string | null
  hasMore?: boolean
  /** Anything else the first page carried — liveNow, totals, facets. */
  extra?: any
}

export interface UsePagedOptions<T> {
  mode?: PageMode
  pageSize?: number
  enabled?: boolean
  deps?: React.DependencyList
  /** Stable identity for dedupe + list keys. Defaults to `item.id`. */
  keyOf?: (item: T) => string
  /** Cursor mode only: which field of the LAST row is the next cursor, for
   *  fetchers that return a bare array / no `nextCursor`. Defaults to
   *  `createdAt` (the /feed contract) — endpoints whose cursor is a different
   *  field (savedAt on saves lists) MUST declare it here instead of relying
   *  on the call site remembering to wrap the result. */
  cursorOf?: (item: T) => string | null | undefined
  onError?: (e: any) => void
}

export interface PagedState<T> {
  items: T[]
  extra: any
  error: any
  loading: boolean          // first page
  refreshing: boolean       // pull to refresh
  loadingMore: boolean      // footer
  done: boolean             // no more pages
  loadMore: () => void
  refresh: () => Promise<void>
  reload: () => Promise<void>
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  /** Insert at the head, dropping any existing copy — realtime prepends. */
  prepend: (item: T) => void
  /** Replace one item in place, by key. */
  patch: (key: string, fn: (item: T) => T) => void
  /** Drop one item by key. */
  remove: (key: string) => void
}

const MAX_PAGE_SIZE = 100

export function usePaged<T>(
  fetcher: (args: { cursor?: string | null; page?: number; pageSize: number; signal: AbortSignal }) => Promise<PagedResult<T> | T[]>,
  {
    mode = 'cursor',
    pageSize = 20,
    enabled = true,
    deps = [],
    keyOf = (i: any) => String(i?.id ?? ''),
    cursorOf,
    onError,
  }: UsePagedOptions<T> = {},
): PagedState<T> {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize))

  const [items, setItems] = React.useState<T[]>([])
  const [extra, setExtra] = React.useState<any>(null)
  const [error, setError] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [done, setDone] = React.useState(false)

  const cursor = React.useRef<string | null | undefined>(undefined)
  const page = React.useRef(0)
  const seen = React.useRef(new Set<string>())
  const inflight = React.useRef(false)
  const alive = React.useRef(true)
  const seq = React.useRef(0)
  const abort = React.useRef<AbortController | null>(null)

  const fnRef = React.useRef(fetcher)
  fnRef.current = fetcher
  const keyRef = React.useRef(keyOf)
  keyRef.current = keyOf
  const cursorOfRef = React.useRef(cursorOf)
  cursorOfRef.current = cursorOf
  const errRef = React.useRef(onError)
  errRef.current = onError

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abort.current?.abort() }
  }, [])

  const load = React.useCallback(async (kind: 'first' | 'more' | 'refresh') => {
    if (!enabled) return
    /* 'more' yields to whatever is in flight; a refresh/reload must NOT — the
       first load can be wedged on a dead connection, and returning here made
       pull-to-refresh a silent no-op until the socket died. Preempt instead:
       abort the wire (http.js really cancels now) and supersede — the seq
       counter below discards the losing response. */
    if (inflight.current) {
      if (kind === 'more') return
      abort.current?.abort()
    }
    if (kind === 'more' && done) return

    inflight.current = true
    const mine = ++seq.current

    if (kind === 'first') { setLoading(true); setError(null) }
    else if (kind === 'refresh') { setRefreshing(true); setError(null) }
    else setLoadingMore(true)

    if (kind !== 'more') {
      abort.current?.abort()
      cursor.current = undefined
      page.current = 0
      seen.current = new Set()
    }

    const ctl = new AbortController()
    abort.current = ctl

    try {
      const raw = await fnRef.current({
        cursor: kind === 'more' ? cursor.current : undefined,
        page: kind === 'more' ? page.current : 0,
        pageSize: size,
        signal: ctl.signal,
      })
      if (!alive.current || mine !== seq.current) return

      const res: PagedResult<T> = Array.isArray(raw) ? { items: raw } : raw
      const batch = res.items || []

      /* Dedupe against everything already shown. A ranked feed can legitimately
         re-emit a row on a later page; a duplicate key is a hard crash in
         FlashList, so this is not optional. */
      const fresh: T[] = []
      for (const it of batch) {
        const k = keyRef.current(it)
        if (!k) { fresh.push(it); continue }
        if (seen.current.has(k)) continue
        seen.current.add(k)
        fresh.push(it)
      }

      if (kind === 'more') setItems(prev => [...prev, ...fresh])
      else { setItems(fresh); setExtra(res.extra ?? (Array.isArray(raw) ? null : stripItems(res))) }

      /* End-of-list, per model. An empty page always ends it: a cursor feed
         that keeps handing back a cursor with no rows would loop forever. */
      if (mode === 'cursor') {
        /* NULL is an ANSWER, not an absence: cursor endpoints send
           nextCursor:null to mean start-of-history (chat MessagePage —
           posts.md), so only an UNDEFINED field may fall back to deriving a
           timestamp cursor from the last row — `??` here once paged such
           feeds forever. `hasMore:false` is equally final for endpoints that
           report it alongside a cursor. */
        const next = res.nextCursor !== undefined
          ? res.nextCursor
          : !batch.length ? null
            : cursorOfRef.current ? (cursorOfRef.current(batch[batch.length - 1]) ?? null)
              : deriveCursor(batch)
        cursor.current = next
        setDone(!batch.length || !next || res.hasMore === false)
      } else {
        page.current += 1
        setDone(res.hasMore === false || !batch.length || batch.length < size)
      }
    } catch (e: any) {
      if (!alive.current || mine !== seq.current) return
      if (e?.name === 'AbortError') return
      setError(e)
      errRef.current?.(e)
    } finally {
      /* A preempted load must not clear the flag its successor now owns. */
      if (mine === seq.current) inflight.current = false
      if (alive.current && mine === seq.current) {
        setLoading(false); setRefreshing(false); setLoadingMore(false)
      }
    }
  }, [enabled, mode, size, done])

  React.useEffect(() => {
    if (!enabled) { setLoading(false); return }
    setDone(false)
    void load('first')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const loadMore = React.useCallback(() => {
    if (loading || refreshing || loadingMore || done) return
    void load('more')
  }, [load, loading, refreshing, loadingMore, done])

  const refresh = React.useCallback(async () => { setDone(false); await load('refresh') }, [load])
  const reload = React.useCallback(async () => { setDone(false); await load('first') }, [load])

  const prepend = React.useCallback((item: T) => {
    const k = keyRef.current(item)
    setItems(prev => [item, ...prev.filter(i => keyRef.current(i) !== k)])
    if (k) seen.current.add(k)
  }, [])

  const patch = React.useCallback((key: string, fn: (item: T) => T) => {
    setItems(prev => prev.map(i => (keyRef.current(i) === key ? fn(i) : i)))
  }, [])

  const remove = React.useCallback((key: string) => {
    setItems(prev => prev.filter(i => keyRef.current(i) !== key))
    seen.current.delete(key)
  }, [])

  /* Identity moves only when the state does — the methods are all
     useCallback-stable. Screens key effects and row callbacks on this object,
     and a fresh literal per render turns every unrelated render into a
     re-armed timer or a defeated React.memo downstream. */
  return React.useMemo(() => ({
    items, extra, error, loading, refreshing, loadingMore, done,
    loadMore, refresh, reload, setItems, prepend, patch, remove,
  }), [
    items, extra, error, loading, refreshing, loadingMore, done,
    loadMore, refresh, reload, prepend, patch, remove,
  ])
}

/** Legacy `/feed`-style endpoints hand back a bare array and expect the caller
 *  to page on the last row's timestamp. The server tail-pins the oldest
 *  timeline item precisely so this works. */
function deriveCursor(batch: any[]): string | null {
  if (!batch.length) return null
  const last: any = batch[batch.length - 1]
  return last?.createdAt ?? last?.cursor ?? null
}

function stripItems(res: any) {
  const { items, nextCursor, hasMore, ...rest } = res || {}
  return Object.keys(rest).length ? rest : null
}
