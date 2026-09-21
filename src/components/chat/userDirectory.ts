/* =========================================================
   The chat user directory.

   MessageResponse, ConversationResponse.peer, MemberResponse
   and ParticipantSummary all carry id / username / fullName and
   NOTHING ELSE — no avatar, no verified flag. That is a
   deliberate backend decision (the chat tables do not join the
   profile table), so the client resolves pictures itself.

   The rules that make that affordable:
     · one GET /users/{id}/profile per unknown id, ever
     · a 40ms coalesce window, so a screenful of bubbles that
       all mention the same three people fires three requests
     · an in-flight guard, so scrolling back and forth cannot
       queue the same id twice
     · a NULL is cached too — a deleted account must not be
       re-requested once per render for the rest of the session

   Module-level rather than context state on purpose: the cache
   has to survive navigating between the inbox, a thread and a
   member list, which unmount each other.
   ========================================================= */
import React from 'react'
import { api } from '@/api'

export interface UserCard {
  id: string
  full: string
  handle: string
  profileImage: string | null
  verified: boolean
  initials: string
}

const cache = new Map<string, UserCard | null>()
const inflight = new Set<string>()
const pending = new Set<string>()
const subscribers = new Set<() => void>()

let timer: ReturnType<typeof setTimeout> | null = null
let version = 0

function publish() {
  version += 1
  for (const fn of [...subscribers]) {
    try { fn() } catch { /* one stale screen must not starve the rest */ }
  }
}

function flush() {
  timer = null
  const ids = [...pending]
  pending.clear()
  if (!ids.length) return

  for (const id of ids) inflight.add(id)
  Promise.all(ids.map(id =>
    api.users.profile(id)
      .then((u: any) => {
        cache.set(id, u
          ? {
            id: String(u.id ?? id),
            full: u.full || u.displayName || u.username || 'Member',
            handle: u.handle || '',
            profileImage: u.profileImage || u.avatarUrl || null,
            verified: !!u.verified,
            initials: u.initials || '',
          }
          : null)
      })
      /* Cache the failure as `null`. A 404 is permanent (the account is
         gone) and a 5xx re-requested on every render would hammer the
         profile endpoint from a list that is already scrolling. */
      .catch(() => { cache.set(id, null) })
      .finally(() => { inflight.delete(id) }),
  )).then(publish)
}

/** Ask for a set of ids. Safe to call on every render — unknown ids are
 *  queued once, known ones cost a Set lookup. */
export function watchUsers(ids: (string | null | undefined)[]) {
  let queued = false
  for (const raw of ids) {
    const id = raw ? String(raw) : ''
    if (!id || cache.has(id) || inflight.has(id) || pending.has(id)) continue
    pending.add(id)
    queued = true
  }
  if (queued && !timer) timer = setTimeout(flush, 40)
}

/** The resolved card, or null while it is unknown. */
export function userOf(id: string | null | undefined): UserCard | null {
  return id ? cache.get(String(id)) ?? null : null
}

/**
 * Merge the directory over a chat DTO's author stub. The stub already has the
 * name and the deterministic gradient seed; only the picture and the tick are
 * missing, and they must not overwrite a name the chat row got right.
 */
export function enrichAuthor(author: any, userId?: string | null): any {
  const card = userOf(userId ?? author?.id)
  if (!card) return author
  return {
    ...author,
    full: author?.full || card.full,
    handle: author?.handle || card.handle,
    profileImage: card.profileImage ?? author?.profileImage ?? null,
    verified: card.verified || !!author?.verified,
  }
}

/**
 * Re-render this component whenever the directory learns something.
 *
 * Returns stable functions plus a version counter, so a memoised row can
 * depend on `version` and nothing else.
 */
export function useUserDirectory() {
  /* The counter is component state, not a read of the module's `version`:
     the returned object has to change identity when the directory learns
     something, or a memoised renderItem that lists `dir` as its only
     directory dependency never re-runs and the row keeps its placeholder
     avatar forever. `publish()` bumps every subscriber; the bump drives
     both the re-render AND the new object below. */
  const [tick, setTick] = React.useState(version)

  React.useEffect(() => {
    /* Mirror the module counter rather than counting locally, so a mount
       that happened mid-flush catches up on the first effect and an
       already-current subscriber bails out of the re-render for free. */
    const fn = () => setTick(version)
    subscribers.add(fn)
    fn()
    return () => { subscribers.delete(fn) }
  }, [])

  return React.useMemo(() => ({
    watchUsers,
    userOf,
    enrichAuthor,
    /** Display name for a bare id — typing rows and system messages. */
    nameOf: (id: string | null | undefined) => userOf(id)?.full || '',
    version: tick,
  }), [tick])
}
