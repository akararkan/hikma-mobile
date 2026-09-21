/* =========================================================
   useEngagement — the shared like / save primitive.

   Both endpoints are TOGGLES that answer with the post-toggle
   state, so the contract is always the same four steps: flip
   locally, fire, RECONCILE from the response's boolean (never
   assume the flip landed the way we guessed), revert and
   surface `errorText` on failure.

   Toggles are LWT-guarded server-side, so a double tap can
   never double-bump the real counter — but the local optimistic
   count can drift, which is why the reconcile corrects the
   number and not just the flag.

   A 429 starts a cooldown on that ONE control and nothing
   auto-retries: the reaction bucket is 30/10s and a retry loop
   is how a rate limit becomes a ban.
   ========================================================= */
import React from 'react'
import { api, errorText, isRateLimited } from '@/api'
import { toast } from '@/ui'
import { useCooldown } from '@/hooks/useCooldown'

type Patch<T> = (id: string, fn: (item: T) => T) => void

export interface Likeable {
  id: string
  liked?: boolean
  likes?: number
}

export interface Saveable {
  id: string
  saved?: boolean
  saves?: number
  savedCollectionName?: string | null
}

export interface Engagement<T> {
  toggleLike: (item: T & Likeable) => Promise<void>
  toggleSave: (item: T & Saveable) => Promise<void>
  /** Seconds left on the reaction/social bucket, 0 when clear. */
  cooldown: number
}

export function useEngagement<T extends Likeable & Saveable>(patch: Patch<T>): Engagement<T> {
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const patchRef = React.useRef(patch)
  patchRef.current = patch

  const toggleLike = React.useCallback(async (item: T & Likeable) => {
    if (cooldown > 0) return
    const id = String(item.id)
    const was = !!item.liked
    patchRef.current(id, p => ({ ...p, liked: !was, likes: Math.max(0, (p.likes || 0) + (was ? -1 : 1)) }))
    try {
      const res: any = await api.posts.toggleReaction(id)
      const liked = !!res?.liked
      /* The server is the authority on the resulting state; correct the count
         only when it disagrees with what we drew. */
      patchRef.current(id, p => (p.liked === liked ? p : {
        ...p,
        liked,
        likes: Math.max(0, (p.likes || 0) + (liked ? 1 : -1)),
      }))
    } catch (e) {
      patchRef.current(id, p => ({ ...p, liked: was, likes: Math.max(0, (p.likes || 0) + (was ? 1 : -1)) }))
      if (isRateLimited(e)) startCooldown(e)
      toast.error(errorText(e))
    }
  }, [cooldown, startCooldown])

  const toggleSave = React.useCallback(async (item: T & Saveable) => {
    if (cooldown > 0) return
    const id = String(item.id)
    const was = !!item.saved
    const previousCollection = item.savedCollectionName ?? null
    patchRef.current(id, p => ({ ...p, saved: !was, saves: Math.max(0, (p.saves || 0) + (was ? -1 : 1)) }))
    try {
      const res: any = await api.posts.toggleSave(id)
      const saved = !!res?.saved
      patchRef.current(id, p => (p.saved === saved ? p : {
        ...p,
        saved,
        saves: Math.max(0, (p.saves || 0) + (saved ? 1 : -1)),
      }))
      if (!saved) {
        toast.info('Removed from Saved', {
          label: 'Undo',
          onPress: () => { void restore(id, previousCollection, patchRef.current) },
        })
      }
    } catch (e) {
      patchRef.current(id, p => ({ ...p, saved: was, saves: Math.max(0, (p.saves || 0) + (was ? 1 : -1)) }))
      if (isRateLimited(e)) startCooldown(e)
      toast.error(errorText(e))
    }
  }, [cooldown, startCooldown])

  return { toggleLike, toggleSave, cooldown }
}

/** Undo of an unsave — back into the bucket it came out of. */
async function restore<T extends Saveable>(id: string, collection: string | null, patch: Patch<T>) {
  try {
    const res: any = await api.posts.toggleSave(id, collection || undefined)
    patch(id, p => ({ ...p, saved: !!res?.saved, savedCollectionName: collection }))
  } catch (e) {
    toast.error(errorText(e))
  }
}
