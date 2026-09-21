/* =========================================================
   PostMenuSheet — the '⋯' menu shared by the feed, the detail
   screen and the media viewer.

   Author-only entries are HIDDEN, never shown-and-403'd: the
   backend's ownership guard is an error path, not a UI state,
   and offering Delete on someone else's post only teaches the
   user that the app lies.

   There is deliberately no "hide this post" / "show less like
   this" / "mute author": none of those endpoints exist, and an
   affordance that silently does nothing is worse than none.
   ========================================================= */
import React from 'react'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Share } from 'react-native'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { ActionSheet, ConfirmSheet, toast } from '@/ui'
import { notePostDeleted } from '@/components/feed/postTombstones'

export interface PostMenuTarget {
  id: string
  author?: string
  saved?: boolean
  _author?: { full?: string; handle?: string; profileImage?: string | null } | null
  /** POST for a post row, COMMENT when the sheet is opened over a comment. */
  targetType?: 'POST' | 'COMMENT'
  /** A comment sheet reports the post it belongs to, for the report route. */
  postId?: string
  body?: string
  /** Set on a REPLY — the top-level ancestor whose `replyCount` a delete owes
   *  a decrement to. Null/absent on a top-level comment. */
  parentCommentId?: string | null
  /** Replies that go with a top-level comment: the post counter comes down by
   *  1 + this, because the server range-deletes the whole partition. */
  replyCount?: number
}

export interface PostMenuSheetProps {
  visible: boolean
  onClose: () => void
  post: PostMenuTarget | null
  /** The signed-in user's id — the whole basis of the author-only entries. */
  viewerId?: string | null
  onSave?: (target: PostMenuTarget) => void
  onEdit?: (target: PostMenuTarget) => void
  /** Called after a confirmed, successful delete so the caller can drop the row.
   *  The third argument is the target itself, so the caller can read
   *  `parentCommentId` / `replyCount` and settle its counters without having to
   *  find a row it has already been told to remove. */
  onDeleted?: (id: string, kind: 'POST' | 'COMMENT', target: PostMenuTarget) => void
  onReply?: (target: PostMenuTarget) => void
  onCopyText?: (target: PostMenuTarget) => void
}

export function PostMenuSheet({
  visible, onClose, post, viewerId, onSave, onEdit, onDeleted, onReply, onCopyText,
}: PostMenuSheetProps) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  /* ActionSheet closes BEFORE it runs the tapped action (90ms later, so the
     sheet is gone by the time a route pushes). Callers clear their target in
     onClose, so every handler here reads a latched copy instead of the prop —
     otherwise Delete would confirm against `null`. */
  const latched = React.useRef<PostMenuTarget | null>(null)
  if (post) latched.current = post
  const target = post ?? latched.current

  const isComment = target?.targetType === 'COMMENT'
  const isAuthor = !!target?.author && !!viewerId && String(target.author) === String(viewerId)
  const id = target?.id ?? ''

  const copyLink = async () => {
    if (!id) return
    try {
      /* shareLink is a PREVIEW read — it deliberately does not bump the
         counter, so this costs the author nothing until the link moves. */
      const info: any = await api.posts.shareLink(id)
      await Clipboard.setStringAsync(info?.shortUrl || info?.canonicalUrl || '')
      await api.posts.recordShare(id).catch(() => {})
      toast.ok('Link copied')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const shareVia = async () => {
    if (!id) return
    try {
      const info: any = await api.posts.shareLink(id)
      const url = info?.shortUrl || info?.canonicalUrl
      if (!url) return
      const res = await Share.share({ message: url, url })
      /* Only a completed activity is a share. A dismissed OS sheet must not
         write a ledger row or notify the author. */
      if (res.action === Share.sharedAction) await api.posts.recordShare(id).catch(() => {})
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const remove = async () => {
    if (!id) return
    setDeleting(true)
    try {
      if (isComment) await api.posts.deleteComment(id)
      else await api.posts.remove(id)
      /* Not optimistic: the 204 lands first, THEN the caller mutates. A comment
         delete is physical and range-deletes the reply partition with it — a
         rollback would have to resurrect state the client no longer holds. */
      /* `onDeleted` reaches ONE screen — the one this sheet was opened on.
         Every other list still holding the row (the feed under the detail
         screen, the profile grid, saved, liked, the reel pager) learns here.
         Comments are not tombstoned: their lists are always the screen that
         owns them, and `onDeleted` already settles the counters. */
      if (!isComment) notePostDeleted(id)
      onDeleted?.(id, isComment ? 'COMMENT' : 'POST', target as PostMenuTarget)
      toast.ok(isComment ? 'Comment deleted' : 'Post deleted')
      setConfirming(false)
    } catch (e) {
      /* Already gone is the outcome that was asked for — drop the row rather
         than raise an error about a row the user wanted removed. */
      if (isNotFound(e) || codeOf(e) === 'ILLEGAL_ARGUMENT') {
        if (!isComment) notePostDeleted(id)
        onDeleted?.(id, isComment ? 'COMMENT' : 'POST', target as PostMenuTarget)
        setConfirming(false)
      } else {
        toast.error(errorText(e))
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <ActionSheet
        visible={visible && !confirming}
        onClose={onClose}
        actions={[
          isComment && onReply ? { label: 'Reply', icon: 'reply', onPress: () => target && onReply(target) } : null,
          isComment
            ? {
              label: 'Copy text',
              icon: 'copy',
              onPress: async () => {
                await Clipboard.setStringAsync(target?.body || '')
                if (target) onCopyText?.(target)
                toast.ok('Copied')
              },
            }
            : {
              label: target?.saved ? 'Remove from saved' : 'Save',
              icon: 'bookmark',
              onPress: () => target && onSave?.(target),
            },
          !isComment ? { label: 'Copy link', icon: 'link', onPress: copyLink } : null,
          !isComment ? { label: 'Share via…', icon: 'share', onPress: shareVia } : null,
          !isComment
            ? { label: 'Save to collection', icon: 'gallery', onPress: () => router.push(`/post/${id}/save`) }
            : null,
          isAuthor && !isComment
            ? {
              label: 'Edit post',
              icon: 'edit',
              onPress: () => (onEdit && target ? onEdit(target) : router.push(`/post/${id}/edit`)),
            }
            : null,
          isAuthor && isComment && onEdit
            ? { label: 'Edit comment', icon: 'edit', onPress: () => target && onEdit(target) }
            : null,
          /* Signed out, the report POST is a guaranteed 401 — an action the
             server would refuse is absent, not disabled. */
          !isAuthor && !!viewerId
            ? {
              label: 'Report',
              icon: 'flag',
              destructive: true,
              onPress: () => router.push(reportHref({
                targetType: isComment ? 'COMMENT' : 'POST',
                targetId: id,
                authorId: target?.author ? String(target.author) : undefined,
                name: target?._author?.full || undefined,
                avatar: target?._author?.profileImage || undefined,
                snippet: target?.body || undefined,
              })),
            }
            : null,
          isAuthor
            ? {
              label: isComment ? 'Delete comment' : 'Delete post',
              icon: 'trash',
              destructive: true,
              onPress: () => setConfirming(true),
            }
            : null,
        ]}
      />

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={isComment ? 'Delete this comment?' : 'Delete this post?'}
        message={
          isComment
            ? 'Its replies are deleted with it. This cannot be undone.'
            : 'This removes it for everyone, along with its comments. This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </>
  )
}
