/* =========================================================
   FollowButton — the only place follow/unfollow is called.

   Three rules the backend forces:

     1. Never render "Follow" before a real socialStatus has
        landed. The list payload cannot tell you, so a hopeful
        "Follow" on an account you already follow is a lie the
        user only discovers by tapping it.
     2. Adopt `res.updatedStatus` rather than re-reading — the
        response carries the authoritative flags AND the two
        counts, so a refetch would be a slower way to learn the
        same thing.
     3. Roll the optimistic flip back on failure. A locked
        profile (FOLLOW_PROFILE_LOCKED) and a blocked
        relationship (FOLLOW_BLOCKED_RELATIONSHIP) both refuse
        with copy worth showing verbatim.
   ========================================================= */
import React from 'react'
import { api, errorText, isNotFound } from '@/api'
import { Button, ConfirmSheet, Skeleton, fireHaptic, toast, useSheetState } from '@/ui'
import { applySocialStatus, type SocialStatus } from './useSocialStatus'

export interface FollowButtonProps {
  userId: string
  status: SocialStatus | null
  /** Fires with the adopted status after every successful write. */
  onChange?: (next: SocialStatus) => void
  /** The row is gone server-side (404) — the parent should drop it. */
  onGone?: () => void
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  /** Ask before unfollowing. On a long list an accidental unfollow is
   *  unrecoverable without hunting the account down again. */
  confirmUnfollow?: boolean
  /** Tapping "Following" opens the caller's own sheet instead of unfollowing. */
  onPressFollowing?: () => void
  /** The not-yet-following label — "Follow back" on your own followers list. */
  followLabel?: string
  disabled?: boolean
}

const WIDTHS = { sm: 84, md: 104, lg: 120 }
/* Held once each, so the Button's style prop stops churning on every render
   of a list row. */
const MIN_WIDTH = { sm: { minWidth: WIDTHS.sm }, md: { minWidth: WIDTHS.md }, lg: { minWidth: WIDTHS.lg } } as const

/* Memoized: this sits in the trailing slot of every recycled people row, and
   `status` is the shared cache's own object — identity-stable until the
   relationship actually moves. */
export const FollowButton = React.memo(function FollowButton({
  userId, status, onChange, onGone, size = 'md', block = false,
  confirmUnfollow = false, onPressFollowing, followLabel = 'Follow', disabled,
}: FollowButtonProps) {
  const [pending, setPending] = React.useState(false)
  const confirm = useSheetState()

  const write = React.useCallback(async (kind: 'follow' | 'unfollow') => {
    if (pending) return
    setPending(true)
    const optimistic = applySocialStatus(userId, { isFollowing: kind === 'follow' })
    onChange?.(optimistic)
    fireHaptic(kind === 'follow' ? 'success' : 'light')
    try {
      const res: any = kind === 'follow' ? await api.users.follow(userId) : await api.users.unfollow(userId)
      const next = applySocialStatus(userId, res?.updatedStatus ?? { isFollowing: kind === 'follow' })
      onChange?.(next)
    } catch (e: any) {
      const reverted = applySocialStatus(userId, { isFollowing: kind !== 'follow' })
      onChange?.(reverted)
      /* A 404 means the account is gone or mid-deletion — not an error the
         user did anything about, so the row leaves rather than shouting. */
      if (isNotFound(e)) { onGone?.(); return }
      fireHaptic('error')
      toast.error(errorText(e))
    } finally {
      setPending(false)
    }
  }, [pending, userId, onChange, onGone])

  /* No radius override — the stand-in has to be the shape of the button that
     replaces it, and buttons are setback plates, never pills. */
  if (!status) return <Skeleton width={block ? '100%' : WIDTHS[size]} height={size === 'sm' ? 32 : 36} />

  if (status.isFollowing) {
    return (
      <>
        <Button
          label="Following"
          iconEnd={onPressFollowing ? 'down' : undefined}
          onPress={() => {
            if (onPressFollowing) { onPressFollowing(); return }
            if (confirmUnfollow) { confirm.open(); return }
            void write('unfollow')
          }}
          variant="secondary"
          size={size}
          block={block}
          loading={pending}
          disabled={disabled}
          style={block ? undefined : MIN_WIDTH[size]}
        />
        <ConfirmSheet
          visible={confirm.visible}
          onClose={confirm.close}
          title="Unfollow?"
          message="Their posts stop showing in your feed. You can follow them again at any time."
          confirmLabel="Unfollow"
          icon="personRemove"
          loading={pending}
          onConfirm={() => { confirm.close(); void write('unfollow') }}
        />
      </>
    )
  }

  return (
    <Button
      label={followLabel}
      onPress={() => void write('follow')}
      variant="primary"
      size={size}
      block={block}
      loading={pending}
      disabled={disabled}
      style={block ? undefined : MIN_WIDTH[size]}
    />
  )
})
