/* =========================================================
   FollowButton — the 32pt control on every people row. Not a
   pill: the Button primitive gives it the sm setback (8/2), and
   the only pills left in the app are unread counters and LIVE
   badges (DESIGN.md §8.9).

   The one rule worth stating out loud: the initial state comes
   from `GET /users/{id}/social-status`, NEVER from
   `user.isFollowing`. The adapter documents that flag as false
   on every list row, and a button that reads it renders
   "Follow" for people you already follow.

   The status lives in the app's ONE relationship store
   (components/profile/useSocialStatus). This button used to keep
   a private Map of its own, which bought two bugs: it was never
   cleared on sign-out — signOut only emits SIGNED_OUT in-process,
   there is no bundle reload — so account B read account A's
   edges, and following someone from their profile left every
   search row still saying "Follow". Different chrome, same
   store: only the Spinner placeholder is ours.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText, isRateLimited } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useCooldown } from '@/hooks/useCooldown'
import { Button, ConfirmSheet, Spinner, toast, useSheetState } from '@/ui'
import { useSocialStatus } from '@/components/profile/useSocialStatus'

export interface FollowButtonProps {
  userId: string
  /** What to show until the shared status lands, when the caller already
   *  knows (a profile screen). Never written back into the store. */
  initial?: boolean
  size?: 'sm' | 'md'
  onChange?: (following: boolean) => void
  /** Ask before unfollowing — used for verified or large accounts. */
  confirmUnfollow?: boolean
  name?: string
}

export function FollowButton({
  userId, initial, size = 'sm', onChange, confirmUnfollow, name,
}: FollowButtonProps) {
  const gate = useAuthGate()
  const confirm = useSheetState()
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  /* Keyed on userId, so a recycled row reads the new account's edge out of the
     store instead of keeping the previous person's face. `error` is not
     surfaced: a status that will not load must not block the row, and the
     un-followed face is the recoverable guess (the write is idempotent at
     worst) where the followed one is not. */
  const { status, error, apply: patchStatus } = useSocialStatus(gate === 'allow' ? userId : null)
  const following = status ? status.isFollowing : error ? false : (initial ?? null)

  const [busy, setBusy] = React.useState(false)
  const alive = React.useRef(true)
  React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const apply = async (next: boolean) => {
    setBusy(true)
    patchStatus({ isFollowing: next })
    onChange?.(next)
    try {
      /* Adopt `updatedStatus` rather than re-reading: the response carries the
         authoritative flags AND both counts, so the profile screen behind this
         row lands on the same object without a second request. */
      const res: any = next ? await api.users.follow(userId) : await api.users.unfollow(userId)
      patchStatus(res?.updatedStatus ?? { isFollowing: next })
    } catch (e: any) {
      patchStatus({ isFollowing: !next })
      onChange?.(!next)
      if (alive.current) {
        if (isRateLimited(e)) startCooldown(e)
        toast.error(errorText(e))
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  /* A control that 401s is worse than no control. */
  if (gate !== 'allow') return null

  if (following === null) {
    return <View style={{ width: 84, height: 32, justifyContent: 'center' }}><Spinner /></View>
  }

  const label = cooldown > 0 ? `${cooldown}s` : following ? 'Following' : 'Follow'

  return (
    <>
      <Button
        label={label}
        size={size === 'md' ? 'md' : 'sm'}
        variant={following ? 'secondary' : 'primary'}
        loading={busy}
        disabled={cooldown > 0}
        haptic="light"
        onPress={() => {
          if (following && confirmUnfollow) confirm.open()
          else void apply(!following)
        }}
        style={{ minWidth: size === 'md' ? 104 : 88, justifyContent: 'center' }}
        accessibilityLabel={following ? `Unfollow ${name || 'this account'}` : `Follow ${name || 'this account'}`}
      />
      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={name ? `Unfollow ${name}?` : 'Unfollow?'}
        message="Their posts will stop appearing in your following feed."
        confirmLabel="Unfollow"
        destructive
        onConfirm={() => { confirm.close(); void apply(false) }}
      />
    </>
  )
}
