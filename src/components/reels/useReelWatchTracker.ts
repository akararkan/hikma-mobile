/* =========================================================
   Two different writes, two different contracts, one hook.

   recordView   bumps the post's view_count. The server dedupes
                per (post, user) for seven days, so firing it
                twice is harmless — it goes after ~1s of dwell
                so a fast scroll past a reel is not a view.

   recordWatch  writes the viewer's watch HISTORY and is NOT
                deduped server-side. One continuous view must
                therefore fire exactly once, which is what the
                local guard below is for: without it, every
                re-render that changed `active` would add a row
                to the user's history.

   Both are fire-and-forget, both are skipped when signed out
   (recordWatch 401s for anonymous callers; recordView is
   public but pointless without a session to dedupe against).
   ========================================================= */
import React from 'react'
import { api } from '@/api'

const MIN_WATCH_SECONDS = 3
const VIEW_DWELL_MS = 1000

export function useReelWatchTracker({
  postId, active, signedIn,
}: { postId: string | null | undefined; active: boolean; signedIn: boolean }) {
  const enteredAt = React.useRef(0)
  const viewed = React.useRef<Set<string>>(new Set())
  const watched = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (!postId || !active) return

    enteredAt.current = Date.now()

    let viewTimer: ReturnType<typeof setTimeout> | null = null
    if (!viewed.current.has(postId)) {
      viewTimer = setTimeout(() => {
        viewed.current.add(postId)
        api.posts.recordView(postId).catch(() => {})
      }, VIEW_DWELL_MS)
    }

    /* The dwell is measured on the way OUT — leaving the page, losing focus and
       unmounting are all the same event as far as history is concerned. */
    return () => {
      if (viewTimer) clearTimeout(viewTimer)
      const seconds = (Date.now() - enteredAt.current) / 1000
      enteredAt.current = 0
      if (!signedIn) return
      if (seconds < MIN_WATCH_SECONDS) return
      if (watched.current.has(postId)) return
      watched.current.add(postId)
      api.reels.recordWatch(postId, Math.round(seconds)).catch(() => {})
    }
  }, [postId, active, signedIn])
}
