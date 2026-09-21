/* =========================================================
   The long-press menu on a channel post.

   `settings.protectedContent` REMOVES copy / forward / save
   instead of greying them: the server answers 403
   PROTECTED_CONTENT, so an offered-then-refused action is a
   worse answer than no action plus the one line that explains
   why. The subtitle carries that line.
   ========================================================= */
import React from 'react'
import { canRight } from '@/api'
import { ActionSheet, type SheetAction } from '@/ui'

export interface PostMenuTarget {
  post: any
  channel: any
  myAdminRow?: any
  meId?: string | null
}

export interface PostMenuSheetProps {
  visible: boolean
  onClose: () => void
  target: PostMenuTarget | null
  onComment?: () => void
  onCopy?: () => void
  onForward?: () => void
  onShareLink?: () => void
  onToggleStar?: () => void
  onTogglePin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** scope=me: hides the post for the caller alone. Offered to readers, who
   *  have no Delete — an admin already has the stronger action. */
  onHide?: () => void
  onReport?: () => void
  /** /pinned swaps Pin for Unpin regardless of the row's own flag. */
  forceUnpin?: boolean
}

export function PostMenuSheet({
  visible, onClose, target, onComment, onCopy, onForward, onShareLink,
  onToggleStar, onTogglePin, onEdit, onDelete, onHide, onReport, forceUnpin,
}: PostMenuSheetProps) {
  const post = target?.post
  const channel = target?.channel
  const settings = channel?.settings || {}
  const row = target?.myAdminRow
  const mine = !!post?.senderId && post.senderId === target?.meId

  const canEdit = canRight(row, 'canEditMessages')
  const canDelete = canRight(row, 'canDeleteMessages') || mine
  const canPin = canRight(row, 'canPinMessages')
  const guarded = !!settings.protectedContent

  const actions: (SheetAction | false)[] = [
    !!post?.comments === true || channel?.linkedGroupId
      ? { label: 'Reply in comments', icon: 'comment' as const, onPress: () => onComment?.() }
      : false,
    !guarded && { label: 'Copy text', icon: 'copy' as const, onPress: () => onCopy?.() },
    !guarded && { label: 'Forward', icon: 'forwardMsg' as const, onPress: () => onForward?.() },
    !!channel?.shareUrl && { label: 'Share link', icon: 'share' as const, onPress: () => onShareLink?.() },
    { label: post?.starred ? 'Remove from saved' : 'Save', icon: 'bookmark' as const, onPress: () => onToggleStar?.() },
    canPin && {
      label: forceUnpin || post?.pinned ? 'Unpin' : 'Pin',
      icon: forceUnpin || post?.pinned ? ('unpin' as const) : ('pin' as const),
      onPress: () => onTogglePin?.(),
    },
    canEdit && { label: 'Edit post', icon: 'edit' as const, onPress: () => onEdit?.() },
    canDelete && { label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => onDelete?.() },
    /* Only when there is no Delete: two trash-flavoured rows side by side is
       how someone deletes for everyone by accident. */
    !canDelete && !!onHide && { label: 'Hide for me', icon: 'eyeOff' as const, destructive: true, onPress: () => onHide?.() },
    !mine && { label: 'Report', icon: 'flag' as const, onPress: () => onReport?.() },
  ]

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title="Post"
      subtitle={guarded ? 'Forwarding is off in this channel' : undefined}
      actions={actions}
    />
  )
}
