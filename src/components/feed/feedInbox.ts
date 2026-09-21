/* =========================================================
   feedInbox — the one-slot handoff from the composer to the
   feed.

   The composer is a modal route, so it cannot call setState on
   the screen underneath it, and a router param would persist
   the whole post object into navigation state (which the
   navigator serialises). So: a module-level slot, written on a
   successful publish and read exactly once when the feed
   regains focus.

   Read-and-clear on purpose — a post must be unshifted once,
   not on every subsequent focus.
   ========================================================= */
import type { PostView } from './types'

let created: PostView | null = null
let edited: PostView | null = null

/** Called by the composer after a successful create. */
export function putCreatedPost(post: PostView | null) { created = post }

/** Called by the edit screen after a successful save. */
export function putEditedPost(post: PostView | null) { edited = post }

export function takeCreatedPost(): PostView | null {
  const p = created
  created = null
  return p
}

export function takeEditedPost(): PostView | null {
  const p = edited
  edited = null
  return p
}
