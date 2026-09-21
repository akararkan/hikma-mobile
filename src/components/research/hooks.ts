/* =========================================================
   The domain's data hooks.

   Two facts about the research API drive everything here:

   1. Every LIST endpoint returns a bare adapter-mapped array —
      no envelope, no total, no hasMore. `usePaged` in `page`
      mode already ends a list when a page comes back short,
      which is exactly that contract, so `useResearchList` is a
      typed wrapper rather than a second pager.
   2. `get()` returns the RAW DTO. Every screen that reads a
      paper maps it through `adapters.researchDetailFrom`, so
      that mapping lives in one place here.
   ========================================================= */
import React from 'react'
import { useRouter } from 'expo-router'
import { adapters, api, applyResearchDelta, openStream } from '@/api'
import { useCooldown as useCooldownRaw } from '@/hooks/useCooldown'
import { usePaged, type PagedState } from '@/hooks/usePaged'
import { useAsync } from '@/hooks/useAsync'
import { storage } from '@/platform/storage'
import { toast } from '@/ui'
import type { Metrics, ResearchCardData, ResearchDetail, ResearchStatus } from './types'

/** The JS hook returns a tuple TypeScript infers as a union array. */
export function useCooldown(): [number, (secondsOrError: any) => boolean] {
  return useCooldownRaw() as [number, (secondsOrError: any) => boolean]
}

/* ---------------------------------------------------------
   Lists.
   --------------------------------------------------------- */

export type ResearchListFetcher = (args: { page: number; size: number }) => Promise<ResearchCardData[]>

export function useResearchList(
  fetch: ResearchListFetcher,
  { enabled = true, size = 20, deps = [] }: { enabled?: boolean; size?: number; deps?: React.DependencyList } = {},
): PagedState<ResearchCardData> {
  return usePaged<ResearchCardData>(
    ({ page, pageSize }) => fetch({ page: page ?? 0, size: pageSize }),
    { mode: 'page', pageSize: size, enabled, deps },
  )
}

/* ---------------------------------------------------------
   Save / unsave — the one write that appears on six screens.

   `save` and `unsave` both answer with a fresh RAW
   ResearchResponse, so the reconciliation is authoritative and
   the optimistic flip only has to survive the round trip.
   --------------------------------------------------------- */

export interface SavePatch { saved: boolean; saves: number }

export async function toggleSaveRemote(id: string, next: boolean, collection = 'Default'): Promise<SavePatch> {
  const raw = next ? await api.research.save(id, collection) : await api.research.unsave(id)
  const mapped = adapters.researchDetailFrom(raw) as ResearchDetail
  return { saved: !!mapped.saved, saves: mapped.metrics?.saves ?? 0 }
}

/* ---------------------------------------------------------
   The paper itself.

   Owns the view record, the shared SSE channel, the counter
   deltas and the reconcile-on-reconnect re-fetch. Screens that
   only read (the reader, the promo player) deliberately pass
   `subscribe: false` — the per-user socket cap is five.
   --------------------------------------------------------- */

export interface ResearchDetailState {
  detail: ResearchDetail | null
  error: any
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
  reload: () => Promise<void>
  patch: (fn: (d: ResearchDetail) => ResearchDetail) => void
  setMetrics: (m: Metrics) => void
  /** True while a publish is held for automated review. */
  held: 'checking' | 'review' | null
  setHeld: (v: 'checking' | 'review' | null) => void
}

export function useResearchDetail(
  id: string | undefined,
  { subscribe = true, recordView = true }: { subscribe?: boolean; recordView?: boolean } = {},
): ResearchDetailState {
  const router = useRouter()
  const [held, setHeld] = React.useState<'checking' | 'review' | null>(null)

  const state = useAsync<ResearchDetail>(
    async () => adapters.researchDetailFrom(await api.research.get(id)) as ResearchDetail,
    { enabled: !!id, deps: [id] },
  )
  const { setData, reload } = state

  const viewed = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!recordView || !id || !state.data || viewed.current === id) return
    viewed.current = id
    /* Fire and forget, always: the server dedupes per (research, user) forever,
       and a failed view record must never surface. */
    void Promise.resolve(api.research.recordView(id)).catch(() => {})
  }, [id, state.data, recordView])

  const patch = React.useCallback((fn: (d: ResearchDetail) => ResearchDetail) => {
    setData(prev => (prev ? fn(prev) : prev))
  }, [setData])

  const setMetrics = React.useCallback((m: Metrics) => {
    setData(prev => (prev ? { ...prev, metrics: m } : prev))
  }, [setData])

  /* openStream replays its cached `connected` payload to a late joiner, so the
     first callback lands microseconds after the initial load — reconciling
     there would just be a second identical GET. */
  const greeted = React.useRef(false)
  React.useEffect(() => { greeted.current = false }, [id])

  React.useEffect(() => {
    if (!subscribe || !id) return
    return openStream('researches', id, {
      /* Every LATER (re)connect is a reconcile point: the stream carries
         deltas, so anything that happened while the socket was down is only
         recoverable from REST. */
      onConnected: () => {
        if (!greeted.current) { greeted.current = true; return }
        void reload()
      },
      onEvent: (evt: any) => {
        if (evt?.eventType === 'RESEARCH_DELETED') {
          toast.info('This paper was deleted.')
          if (router.canGoBack()) router.back()
          return
        }
        if (evt?.eventType === 'RESEARCH_PUBLISHED' || evt?.eventType === 'RESEARCH_UPDATED') {
          setData(prev => (prev && evt.status ? { ...prev, status: evt.status as ResearchStatus } : prev))
          /* The event carries a status and nothing else — a metadata edit can
             have changed the title, tags, toggles and media. */
          void reload()
          return
        }
        setData(prev => (prev ? { ...prev, metrics: applyResearchDelta(prev.metrics, evt) } : prev))
      },
    })
  }, [id, subscribe, reload, setData, router])

  return {
    detail: state.data,
    error: state.error,
    loading: state.loading,
    refreshing: state.refreshing,
    refresh: state.refresh,
    reload: state.reload,
    patch,
    setMetrics,
    held,
    setHeld,
  }
}

/* ---------------------------------------------------------
   Recent research searches — MMKV, newest first, capped at 10.
   --------------------------------------------------------- */

const RECENT_KEY = 'research.recentSearches'

export function useRecentSearches(): {
  recent: string[]
  push: (q: string) => void
  remove: (q: string) => void
  clear: () => void
} {
  const [recent, setRecent] = React.useState<string[]>(() => {
    try {
      const raw = storage.getItem(RECENT_KEY)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.filter((s: unknown) => typeof s === 'string').slice(0, 10) : []
    } catch { return [] }
  })

  const write = React.useCallback((list: string[]) => {
    setRecent(list)
    try { storage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* a full disk must not break search */ }
  }, [])

  return {
    recent,
    push: React.useCallback((q: string) => {
      const v = q.trim()
      if (!v) return
      setRecent(prev => {
        const next = [v, ...prev.filter(x => x.toLowerCase() !== v.toLowerCase())].slice(0, 10)
        try { storage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    }, []),
    remove: React.useCallback((q: string) => {
      setRecent(prev => {
        const next = prev.filter(x => x !== q)
        try { storage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    }, []),
    clear: React.useCallback(() => write([]), [write]),
  }
}

/* ---------------------------------------------------------
   Held-publish rechecking.

   A publish that answers 200 with the paper still DRAFT was
   held by the classifier, and nothing will ever tell us it
   cleared — there is no moderation event on any stream. So the
   screen re-reads itself on the documented back-off and gives
   up into "under review" at the entity ceiling.
   --------------------------------------------------------- */

export function useHoldRecheck(
  active: boolean,
  delays: number[],
  onTick: () => void,
  onCeiling: () => void,
) {
  const tick = React.useRef(onTick)
  const ceiling = React.useRef(onCeiling)
  tick.current = onTick
  ceiling.current = onCeiling

  React.useEffect(() => {
    if (!active) return
    const timers = delays.map((ms, i) =>
      setTimeout(() => {
        tick.current()
        if (i === delays.length - 1) ceiling.current()
      }, ms),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
