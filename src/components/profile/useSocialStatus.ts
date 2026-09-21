/* =========================================================
   The relationship cache.

   `userFrom` hardcodes `isFollowing: false` on every row it
   maps, because UserResponse carries no relationship flag at
   all. A Follow button driven by that field is therefore
   permanently wrong — the ONLY source is
   GET /users/{id}/social-status, which is authenticated and
   costs one request per person.

   That makes a cache non-optional: a followers list of 20 rows
   would otherwise fire 20 requests at once and then fire them
   again when the user pushes a profile and comes back. So:
   one session-scoped Map, four concurrent reads, and every
   mutation writes `res.updatedStatus` back in — which is what
   keeps a pushed profile and the list behind it agreeing
   without either of them refetching.

   Mute is deliberately NOT here. It is a settings-privacy edge
   (`settings.privacy.muted.*`), not a social-graph one, so it
   is seeded separately and a block never implies a mute.
   ========================================================= */
import React from 'react'
import { api } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { on, AUTH_EXPIRED, SIGNED_OUT } from '@/platform/appEvents'

export interface SocialStatus {
  isFollowing: boolean
  isBlocking: boolean
  isRestricting: boolean
  isBlockedByThem: boolean
  /** Null when the server omitted it — never render 0 for an unknown count. */
  followerCount: number | null
  followingCount: number | null
}

export function normalizeStatus(raw: any): SocialStatus {
  return {
    isFollowing: !!raw?.isFollowing,
    isBlocking: !!raw?.isBlocking,
    isRestricting: !!raw?.isRestricting,
    isBlockedByThem: !!raw?.isBlockedByThem,
    followerCount: typeof raw?.followerCount === 'number' ? raw.followerCount : null,
    followingCount: typeof raw?.followingCount === 'number' ? raw.followingCount : null,
  }
}

/* ---------------------------------------------------------
   Store
   --------------------------------------------------------- */

const cache = new Map<string, SocialStatus>()
const inflight = new Map<string, Promise<SocialStatus>>()
const listeners = new Set<() => void>()

const emit = () => { for (const fn of [...listeners]) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/* A list scrolls faster than the network answers, so the reads are queued
   rather than fired: four at a time keeps the row buttons filling in from the
   top of the viewport instead of all arriving at once, minutes late. */
const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve() }
  return new Promise(resolve => queue.push(() => { active++; resolve() }))
}
function release() {
  active--
  queue.shift()?.()
}

async function read(id: string): Promise<SocialStatus> {
  await acquire()
  try {
    const next = normalizeStatus(await api.users.socialStatus(id))
    cache.set(id, next)
    emit()
    return next
  } finally {
    release()
  }
}

/** Load one relationship, coalescing concurrent callers for the same id. */
export function loadSocialStatus(id: string, force = false): Promise<SocialStatus> {
  if (!force) {
    const hit = cache.get(id)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(id)
    if (pending) return pending
  }
  const p = read(id).finally(() => { inflight.delete(id) })
  inflight.set(id, p)
  return p
}

/** Adopt a `SocialActionResponse.updatedStatus` (or a local optimistic flip). */
export function applySocialStatus(id: string, patch: Partial<SocialStatus> | any): SocialStatus {
  const base = cache.get(id) ?? normalizeStatus(null)
  const next: SocialStatus = { ...base, ...normalizePatch(patch) }
  cache.set(id, next)
  emit()
  return next
}

function normalizePatch(patch: any): Partial<SocialStatus> {
  if (!patch) return {}
  const out: Partial<SocialStatus> = {}
  for (const k of ['isFollowing', 'isBlocking', 'isRestricting', 'isBlockedByThem'] as const) {
    if (patch[k] !== undefined) out[k] = !!patch[k]
  }
  for (const k of ['followerCount', 'followingCount'] as const) {
    if (typeof patch[k] === 'number') out[k] = patch[k]
  }
  return out
}

export function peekSocialStatus(id: string): SocialStatus | null {
  return cache.get(id) ?? null
}

/** Drop everything. A second account must not inherit the first's edges. */
export function resetSocialCache() {
  cache.clear()
  inflight.clear()
  mutedIds = null
  mutedInflight = null
  emit()
}

on(AUTH_EXPIRED, () => resetSocialCache())
on(SIGNED_OUT, () => resetSocialCache())   // voluntary logout — same hygiene, different trigger

/* ---------------------------------------------------------
   Hooks
   --------------------------------------------------------- */

export interface SocialStatusHandle {
  status: SocialStatus | null
  loading: boolean
  error: any
  refresh: () => void
  apply: (patch: Partial<SocialStatus> | any) => void
}

export function useSocialStatus(userId?: string | null): SocialStatusHandle {
  const { signedIn } = useAuth()
  const id = userId ? String(userId) : ''

  const status = React.useSyncExternalStore(
    subscribe,
    () => (id ? cache.get(id) ?? null : null),
  )

  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = React.useCallback((force: boolean) => {
    /* Anonymous viewers get a 401 here by design — the caller hides the
       relationship controls instead, so there is nothing to ask for. */
    if (!id || !signedIn) return
    if (!force && cache.has(id)) return
    setLoading(true)
    setError(null)
    loadSocialStatus(id, force)
      .catch(e => { if (alive.current) setError(e) })
      .finally(() => { if (alive.current) setLoading(false) })
  }, [id, signedIn])

  React.useEffect(() => { load(false) }, [load])

  return {
    status,
    loading,
    error,
    refresh: React.useCallback(() => load(true), [load]),
    apply: React.useCallback((patch: any) => { if (id) applySocialStatus(id, patch) }, [id]),
  }
}

/* ---------------------------------------------------------
   Mute — one read of the id list per session, then local.
   --------------------------------------------------------- */

let mutedIds: Set<string> | null = null
let mutedInflight: Promise<Set<string>> | null = null

function loadMuted(): Promise<Set<string>> {
  if (mutedIds) return Promise.resolve(mutedIds)
  if (mutedInflight) return mutedInflight
  mutedInflight = api.settings.privacy.muted.ids()
    .then((ids: any) => {
      mutedIds = new Set((ids || []).map((x: any) => String(x)))
      emit()
      return mutedIds
    })
    .catch(() => new Set<string>())
    .finally(() => { mutedInflight = null })
  return mutedInflight
}

export function setMutedLocally(id: string, muted: boolean) {
  if (!mutedIds) mutedIds = new Set()
  if (muted) mutedIds.add(String(id))
  else mutedIds.delete(String(id))
  emit()
}

/** Whether the viewer has muted this account. `null` until the list is read. */
export function useMuted(userId?: string | null): boolean | null {
  const { signedIn } = useAuth()
  const id = userId ? String(userId) : ''

  const muted = React.useSyncExternalStore(
    subscribe,
    () => (mutedIds ? mutedIds.has(id) : null),
  )

  React.useEffect(() => { if (signedIn) void loadMuted() }, [signedIn])

  return id ? muted : null
}
