/* =========================================================
   openReel — "open THIS reel, in the list it was tapped in".

   Every surface that shows reels as tiles or rows hands the
   viewer the rows it already has and the index of the one that
   was tapped (reelInbox's open slot), so the pager opens ON
   that reel with its neighbours above and below and keeps
   swiping from there. Mixed lists (saved, liked, the home
   feed) hand over their REEL rows only; the tapped reel's index
   is recomputed inside that subset.

   The href grammar lives here too, so `?src=` is never left off
   a push by accident — a missing `src` silently means For You.
   ========================================================= */
import { putReelOpen } from './reelInbox'
import type { ReelSourceKind, ViewPost } from './types'

export interface ReelOpenOptions {
  src?: ReelSourceKind
  authorId?: string | null
  handle?: string | null
  soundId?: string | null
}

/** Same normalisation everywhere — the wire enum is uppercase, but one
 *  lowercase `postType` bounced /reels ↔ /posts forever. */
export function isReelPost(p: any): boolean {
  return String(p?.type ?? '').toUpperCase() === 'REEL'
}

export function reelHref(id: string, opts: ReelOpenOptions = {}): string {
  const q: string[] = []
  if (opts.src) q.push(`src=${opts.src}`)
  if (opts.authorId) q.push(`authorId=${encodeURIComponent(String(opts.authorId))}`)
  if (opts.handle) q.push(`handle=${encodeURIComponent(String(opts.handle))}`)
  if (opts.soundId) q.push(`soundId=${encodeURIComponent(String(opts.soundId))}`)
  return `/reels/${id}${q.length ? `?${q.join('&')}` : ''}`
}

/** Push the viewer on `post`, positioned inside `list` (which may mix types). */
export function openReelIn(
  router: { push: (href: any) => void },
  list: readonly any[] | null | undefined,
  post: any,
  opts: ReelOpenOptions = {},
) {
  const id = String(post?.id ?? '')
  if (!id) return
  const reels = (list || []).filter(isReelPost) as ViewPost[]
  const index = reels.findIndex(p => String(p.id) === id)
  putReelOpen({
    id,
    items: index >= 0 ? reels : [post as ViewPost],
    index: Math.max(0, index),
  })
  router.push(reelHref(id, opts))
}
