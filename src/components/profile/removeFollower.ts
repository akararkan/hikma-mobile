/* =========================================================
   removeFollower — "take this account off my followers".

   The backend has no remove-follower endpoint (user/social.md
   lists follow, block and restrict, nothing else), but it
   documents that a BLOCK tears down the follow edges in both
   directions and that an UNBLOCK does not restore them. Block
   then unblock is therefore exactly the operation, and both
   halves are silent by design (UserBlocked / UserUnblocked
   never notify — errors/user-facing-messages.md).

   What the pair costs, and what this module does about it:

     · YOUR follow of them goes too. Re-following afterwards
       would fire a NEW_FOLLOWER notification at the very
       person you just removed, so it is NOT redone here — the
       confirm copy says so and the profile has a Follow button.
     · A restriction is superseded by the block. Restrict is
       silent, so it IS re-applied afterwards.
     · If the unblock half fails the person stays blocked. The
       edge is gone either way, so the caller still drops the
       row; it just has to say what happened.
   ========================================================= */
import { api } from '@/api'
import { applySocialStatus, type SocialStatus } from './useSocialStatus'

export interface RemoveFollowerResult {
  /** The unblock half failed — the account is still blocked. */
  unblockError: any | null
  /** They were restricted before and the restriction could not be re-applied. */
  restrictError: any | null
}

export async function removeFollower(id: string, before: SocialStatus | null): Promise<RemoveFollowerResult> {
  const wasRestricting = !!before?.isRestricting

  /* Throws before anything changed — the caller reports it and the row stays. */
  const blocked: any = await api.users.block(id)
  applySocialStatus(id, blocked?.updatedStatus ?? { isBlocking: true, isFollowing: false, isRestricting: false })

  let unblockError: any = null
  try {
    const res: any = await api.users.unblock(id)
    applySocialStatus(id, res?.updatedStatus ?? { isBlocking: false })
  } catch (e) {
    unblockError = e
  }

  let restrictError: any = null
  if (wasRestricting && !unblockError) {
    try {
      const res: any = await api.users.restrict(id)
      applySocialStatus(id, res?.updatedStatus ?? { isRestricting: true })
    } catch (e) {
      restrictError = e
    }
  }

  return { unblockError, restrictError }
}
