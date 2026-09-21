/* =========================================================
   ResearchCommentMenu — the one menu every research comment
   surface mounts: the comments list, the single-thread screen
   and the three-row preview under a paper.

   It exists because those three used to disagree. The thread
   screen drew a '⋯' wired to an empty function, and the
   preview drew no control at all while still letting you like
   the row — an affordance that does nothing is worse than an
   absent one, so the menu became a component instead of a
   copy.

   Permission rules, straight from research/social.md:
     · edit          — comment author only
     · delete        — comment author OR the research owner
     · hide / unhide — comment author OR the research owner
     · report        — anyone but the author, and only signed in
   Entries are HIDDEN, never shown-and-403'd.

   Delete is NOT optimistic. It is a soft delete with no undo,
   so the confirm button holds `loading` until the 204 lands
   and only then does the caller drop the row. `ALREADY_DELETED`
   and 404 are the outcome we wanted anyway — the row goes,
   silently.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { adapters, api, codeOf, errorText, isNotFound, isRateLimited } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { reportHref } from '@/components/system/Moderation'
import { ActionSheet, Button, ConfirmSheet, Field, Sheet, toast } from '@/ui'
import { useCooldown } from './hooks'
import type { ResearchComment } from './types'
import { space } from '@/theme/tokens'

export interface ResearchCommentMenuProps {
  visible: boolean
  onClose: () => void
  comment: ResearchComment | null
  researchId: string
  viewerId?: string | null
  /** The paper's author — the second half of the delete/hide permission. */
  isResearchOwner?: boolean
  /** Omit on surfaces with no reply affordance; never pass a no-op. */
  onReply?: (comment: ResearchComment) => void
  /** Patches the caller's copy of the row (body / edited / hidden). */
  onPatch?: (commentId: string, patch: Partial<ResearchComment>) => void
  /** Fired once the row is really gone — after the 204, or on "already gone". */
  onDeleted?: (comment: ResearchComment) => void
}

export function ResearchCommentMenu({
  visible, onClose, comment, researchId, viewerId, isResearchOwner,
  onReply, onPatch, onDeleted,
}: ResearchCommentMenuProps) {
  const router = useRouter()

  /* The ActionSheet closes BEFORE it runs the tapped action, so the edit and
     confirm steps outlive the menu. `useSheetState.close()` keeps its payload
     for exactly this reason — the subject survives the sheet. */
  const target = comment

  const [confirming, setConfirming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown()

  const isAuthor = !!target?.author && !!viewerId && String(target.author) === String(viewerId)
  const canModerate = isAuthor || !!isResearchOwner

  const openEdit = (c: ResearchComment) => {
    setText(c.body)
    setEditError(null)
    setEditing(true)
  }

  const copy = async () => {
    if (!target) return
    await Clipboard.setStringAsync(target.body || '')
    toast.ok('Copied')
  }

  const save = async () => {
    if (!target || saving) return
    const trimmed = text.trim()
    if (!trimmed) return
    /* An edit that changes nothing is a request that can only fail or waste
       the limiter. */
    if (trimmed === target.body.trim()) { setEditing(false); return }
    setSaving(true)
    setEditError(null)
    try {
      const raw = await api.research.editComment(researchId, target.id, trimmed)
      const fresh = adapters.researchCommentFrom(raw) as ResearchComment
      onPatch?.(target.id, { body: fresh.body, edited: true, mediaUrl: fresh.mediaUrl })
      setEditing(false)
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'COMMENT_DELETED' || code === 'ALREADY_DELETED' || isNotFound(e)) {
        /* Deleted while the sheet was open — a ghost row that can never save. */
        onDeleted?.(target)
        setEditing(false)
        toast.error(errorText(e))
      } else if (isRateLimited(e)) {
        /* The limiter, not the text: the draft stays and the button counts
           itself back in. */
        startCooldown(e)
        setEditError(errorText(e))
      } else if (isBlocked(e)) {
        /* The server's sentence verbatim, the draft kept, and no retry
           affordance: resubmitting identical text fails identically. */
        setEditError(moderationText(e))
      } else {
        setEditError(errorText(e))
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!target || deleting) return
    setDeleting(true)
    try {
      await api.research.deleteComment(researchId, target.id)
      onDeleted?.(target)
      setConfirming(false)
      toast.ok('Comment deleted')
    } catch (e: any) {
      if (codeOf(e) === 'ALREADY_DELETED' || isNotFound(e)) {
        onDeleted?.(target)
        setConfirming(false)
        return
      }
      toast.error(errorText(e))
    } finally {
      setDeleting(false)
    }
  }

  const toggleHide = async (c: ResearchComment) => {
    const next = !c.hidden
    onPatch?.(c.id, { hidden: next })
    try {
      if (next) await api.research.hideComment(researchId, c.id)
      else await api.research.unhideComment(researchId, c.id)
    } catch (e: any) {
      onPatch?.(c.id, { hidden: c.hidden })
      toast.error(errorText(e))
    }
  }

  return (
    <>
      <ActionSheet
        visible={visible && !confirming && !editing}
        onClose={onClose}
        title={target?._author.full}
        actions={[
          onReply
            ? { label: 'Reply', icon: 'reply', onPress: () => target && onReply(target) }
            : null,
          { label: 'Copy text', icon: 'copy', onPress: copy },
          {
            label: 'Edit comment',
            icon: 'edit',
            hidden: !isAuthor,
            onPress: () => target && openEdit(target),
          },
          {
            label: target?.hidden ? 'Unhide comment' : 'Hide comment',
            icon: 'eyeOff',
            hidden: !canModerate,
            onPress: () => { if (target) void toggleHide(target) },
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            /* Hidden on your own comment and while signed out — an action the
               server would refuse is absent, not disabled. */
            hidden: !target || !viewerId || isAuthor,
            onPress: () => {
              if (!target) return
              router.push(reportHref({
                targetType: 'COMMENT',
                targetId: target.id,
                authorId: target.author || undefined,
                name: target._author.full || undefined,
                avatar: target._author.profileImage || undefined,
                snippet: target.body || undefined,
              }))
            },
          },
          {
            label: 'Delete comment',
            icon: 'trash',
            destructive: true,
            hidden: !canModerate,
            onPress: () => setConfirming(true),
          },
        ]}
      />

      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Edit comment"
        footer={
          <Button
            label={cooldown > 0 ? `Save (${cooldown})` : 'Save'}
            block
            size="lg"
            loading={saving}
            disabled={!text.trim() || cooldown > 0}
            onPress={() => { void save() }}
          />
        }
      >
        <View style={{ padding: space.lg }}>
          <Field
            value={text}
            onChangeText={v => { setText(v); if (editError) setEditError(null) }}
            multiline
            maxLength={5000}
            minHeight={140}
            error={editError}
            autoFocus
          />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this comment?"
        /* Research deletes are soft and do NOT cascade to replies (social.md
           §delete), so this must not promise that they do. */
        message="It disappears for everyone and its reactions are cleared. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => { void remove() }}
      />
    </>
  )
}
