/* =========================================================
   EditCommentSheet — author-only comment editing.

   PATCH /api/v1/posts/comments/{id} answers 204 No Content
   (engagement.md §3.5), so there is no row to read back: on
   success the sheet hands the text to the caller and the
   caller patches its own copy with `edited: true` — the same
   shape the COMMENT_EDITED broadcast writes, so the local
   write and the wire can never disagree.

   A failure keeps the draft verbatim in the field: an edit
   that also eats the correction is two punishments for one
   error.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, codeOf, errorText } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { isBlocked, moderationText } from '@/lib/moderation'
import { Button, Field, Sheet, toast } from '@/ui'
import { space } from '@/theme/tokens'

export interface EditCommentSheetProps {
  visible: boolean
  onClose: () => void
  /** The comment being edited — id plus the current body to prefill. */
  comment: { id: string; body: string } | null
  /** Fired after the 204 lands; the caller patches its list. */
  onSaved: (commentId: string, text: string) => void
  /** ILLEGAL_ARGUMENT means the comment was deleted meanwhile — the caller
   *  drops the row instead of leaving a ghost that can never save. */
  onGone?: (commentId: string) => void
}

export function EditCommentSheet({ visible, onClose, comment, onSaved, onGone }: EditCommentSheetProps) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /* JS hook — the cast pins the tuple so `cooldown` stays a number. */
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  /* Prefill once per open, keyed on the comment — not on every render, or
     typing would fight the prop. */
  const openedFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (visible && comment && openedFor.current !== comment.id) {
      openedFor.current = comment.id
      setText(comment.body)
      setError(null)
    }
    if (!visible) openedFor.current = null
  }, [visible, comment])

  const save = async () => {
    if (!comment || busy || cooldown > 0) return
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed === comment.body.trim()) { onClose(); return }
    setBusy(true)
    setError(null)
    try {
      await api.posts.editComment(comment.id, trimmed)
      onSaved(comment.id, trimmed)
      onClose()
    } catch (e: any) {
      if (codeOf(e) === 'ILLEGAL_ARGUMENT') {
        /* Deleted while the sheet was open. */
        onGone?.(comment.id)
        onClose()
        toast.error(errorText(e))
      } else if (isBlocked(e)) {
        /* The server's sentence verbatim, the draft kept, and no retry
           affordance — resubmitting identical text fails identically. */
        setError(moderationText(e))
      } else if (startCooldown(e)) {
        /* 429: the Save button becomes the countdown. */
        setError(errorText(e))
      } else {
        setError(errorText(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Edit comment"
      footer={
        <Button
          label={cooldown > 0 ? `Wait ${cooldown}s` : 'Save'}
          block
          size="lg"
          loading={busy}
          disabled={!text.trim() || cooldown > 0}
          onPress={() => { void save() }}
        />
      }
    >
      <View style={{ padding: space.lg }}>
        <Field
          value={text}
          onChangeText={v => { setText(v); if (error) setError(null) }}
          multiline
          maxLength={5000}
          minHeight={120}
          error={error}
          autoFocus
        />
      </View>
    </Sheet>
  )
}
