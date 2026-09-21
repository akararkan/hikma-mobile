/* =========================================================
   The composer → reels-tab hand-off.

   Publishing a reel leaves you on the single-reel viewer, and
   the tab you came from keeps whatever page it had already
   fetched. So the reel you just made was simply ABSENT from
   the feed until a pull-to-refresh or an app restart — which
   reads, correctly, as "my reel didn't post".

   Refetching on focus would not fix it either. `/reels/for-you`
   is engagement-ranked over the last three day buckets, so a
   brand-new reel with zero engagement lands wherever its
   recency term puts it — usually not at the top, and never
   reliably at position 0. `/reels/following` excludes you by
   construction, because you do not follow yourself.

   So the composer hands the row over directly, exactly the way
   feedInbox does for posts, and the tab prepends it. The row
   handed over is `postFromResponse`-shaped rather than
   `postFromFeedItem`-shaped; both are ViewPost, and the next
   real refresh replaces it with the server's own copy.

   Single-slot and read-once on purpose: two reels published
   back to back means the second one is the one you are looking
   at, and a queue would prepend a reel the user has already
   navigated past.
   ========================================================= */
import type { ViewPost } from './types'

let created: ViewPost | null = null

/** Called by the reel composer after a successful publish. */
export function putCreatedReel(reel: ViewPost | null) { created = reel }

/** Called by the reels tab on focus. Clears the slot. */
export function takeCreatedReel(): ViewPost | null {
  const r = created
  created = null
  return r
}

/* ---------------------------------------------------------
   The tap → viewer hand-off.

   A grid or a list that shows reels already holds the rows
   around the one that was tapped. Handing them over lets the
   viewer open ON that reel with its neighbours in place and
   keep swiping from there, instead of re-reading the reel and
   restarting the feed from its head behind it — which read as
   "it opened reels, not MY reel".

   Read WITHOUT clearing: React may run a state initializer
   twice in development and the second call must see the same
   rows. The viewer clears the slot when it unmounts, and a slot
   older than the TTL is ignored so a stale one can never be
   picked up by a later tap on the same reel from elsewhere.
   --------------------------------------------------------- */

export interface ReelOpen {
  id: string
  items: ViewPost[]
  index: number
  at: number
}

const OPEN_TTL_MS = 15_000
let opened: ReelOpen | null = null

/** Called by the surface that was tapped, right before it pushes the viewer. */
export function putReelOpen(o: Omit<ReelOpen, 'at'>) {
  opened = { ...o, at: Date.now() }
}

/** Called by the viewer at mount. Null unless the slot is for THIS reel and fresh. */
export function takeReelOpen(id: string): ReelOpen | null {
  if (!opened || opened.id !== id || Date.now() - opened.at > OPEN_TTL_MS) return null
  return opened
}

export function clearReelOpen(id: string) {
  if (opened?.id === id) opened = null
}
