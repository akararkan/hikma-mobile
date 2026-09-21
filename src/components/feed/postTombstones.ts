/* =========================================================
   postTombstones — "this post is gone", broadcast to every
   list still holding it.

   A post is deleted from ONE screen and lives in several. Delete
   from the detail screen and the feed that pushed you there still
   renders the row; so does the profile grid behind it, the saved
   collection, the liked grid, the reel pager. Each of those is an
   independent usePaged / useAsync window with its own copy, and
   the 204 reaches none of them — `onDeleted` only ever reaches the
   screen the sheet was opened on.

   This is the other half of that callback: the deleting screen
   still drops its own row through `onDeleted` (it often has
   counters to settle at the same time), and every OTHER mounted
   list learns through here.

   NOT the one-slot handoff feedInbox does for creates and edits.
   A tombstone has many readers, not one, and it must survive being
   read — a list that mounts AFTER the delete (navigating back to a
   profile) has to learn about it too, which is why the hook drains
   the whole set on mount rather than taking a value once.
   ========================================================= */
import React from 'react'

/* Session-scoped and small: only ids the user actually saw deleted
   land here. The cap is a backstop against a session that deletes
   for an hour, and evicting is safe — the server stops returning a
   deleted post on the next fetch, so the tombstone only ever has to
   outlive the state already in memory. */
const CAP = 300

const dead = new Set<string>()
const listeners = new Set<(id: string) => void>()

/** Called by the delete paths (PostMenuSheet, ReelMoreSheet) after the
 *  server has confirmed — never optimistically. A post that is still
 *  there must never be tombstoned, because nothing un-tombstones it. */
export function notePostDeleted(id: string | number | null | undefined) {
  if (id == null) return
  const key = String(id)
  if (dead.has(key)) return
  dead.add(key)
  if (dead.size > CAP) dead.delete(dead.values().next().value as string)
  for (const fn of [...listeners]) {
    try { fn(key) } catch { /* one broken list must not starve the rest */ }
  }
}

/** Has this post been deleted during this session? For renderers that
 *  filter rather than drop. */
export function isPostDeleted(id: string | number | null | undefined): boolean {
  return id != null && dead.has(String(id))
}

export function subscribeToPostDeletes(fn: (id: string) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Keep one list free of deleted posts.
 *
 * `drop` is the list's own single-row removal — `usePaged`'s `remove`, or
 * whatever a hand-rolled list uses. It must be identity-stable (usePaged's is
 * `useCallback`-stable with no deps); an unstable one re-runs the drain every
 * render, which is idempotent but wasteful.
 *
 * The drain on mount is the important half: a list that was unmounted when the
 * delete happened — the profile you navigate back to, a saved collection
 * opened afterwards — never saw the event and would otherwise render the row
 * from its own cached page.
 */
export function usePostTombstones(drop: (id: string) => void) {
  React.useEffect(() => {
    for (const id of dead) drop(id)
    return subscribeToPostDeletes(drop)
  }, [drop])
}
