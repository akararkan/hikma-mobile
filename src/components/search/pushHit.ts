/* =========================================================
   pushHit — the canonical navigator for a search hit.

   `hitHref` in src/api is the source of truth for where a hit
   goes, but two of its eight answers are not expo-router paths
   and have to be translated here rather than at every call site:

     ANSWER  `/qna/{parentId}#answer-{contentId}` — a `#fragment`
             is part of the PATH to expo-router, so this becomes
             a params push and the question screen scrolls itself.
     SOUND   `/explore?sound={contentId}` — on Explore that is a
             param change on the screen you are already on, not a
             push onto itself.

   `canOpen` exists so a row renders itself non-tappable instead
   of failing on press: an ANSWER hit with no `parentId` has no
   destination at all.
   ========================================================= */
import React from 'react'
import { useRouter, type Href } from 'expo-router'
import { hitHref } from '@/api'
import type { SearchHit } from './searchTypes'

export function canOpen(hit: SearchHit | null | undefined): boolean {
  return !!hit && !!hitHref(hit)
}

/** `hitHref` sends a REEL hit through the post screen, which only exists to
 *  discover the type and hand a reel on. The type is already known here, so a
 *  reel is addressed to the viewer directly; everything else is `hitHref`'s
 *  own answer. Share and copy still use `hitHref` — that path is the server's
 *  canonical one. */
export function hitPath(hit: SearchHit | null | undefined): string | null {
  if (!hit) return null
  if (hit.contentType === 'REEL' && hit.contentId) return `/reels/${hit.contentId}`
  return hitHref(hit)
}

/** expo-router's typed-route union is generated from the files that existed
 *  when the dev server last swept the tree, so a link into a screen another
 *  part of the app owns does not type-check until that file lands. Every path
 *  routed through here is in the deep-link contract the API client ALREADY
 *  emits (`hitHref`, `activityLink`, `mentions` rewrites), so the destination
 *  is fixed by the server, not by what happens to be on disk today. */
export function href(path: string | { pathname: string; params?: Record<string, string> }): Href {
  return path as unknown as Href
}

export interface PushHitOptions {
  /** True on the Explore tab, where a SOUND hit opens the sheet in place. */
  inExplore?: boolean
}

export function usePushHit(opts: PushHitOptions = {}) {
  const router = useRouter()
  const inExplore = !!opts.inExplore

  return React.useCallback((hit: SearchHit) => {
    const target = hitPath(hit)
    if (!target) return

    if (hit.contentType === 'ANSWER') {
      router.push(href({ pathname: '/qna/[id]', params: { id: String(hit.parentId), answer: hit.contentId } }))
      return
    }
    if (hit.contentType === 'SOUND') {
      if (inExplore) router.setParams({ sound: hit.contentId })
      else router.push(href(`/sounds/${hit.contentId}`))
      return
    }
    router.push(href(target))
  }, [router, inExplore])
}
