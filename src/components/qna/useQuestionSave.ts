/* =========================================================
   The bookmark, everywhere.

   Saves share the 30-per-minute social-action limiter, so a
   429 disables EVERY bookmark on the screen rather than just
   the one that was tapped — the next tap would fail too, and a
   control that fails silently teaches the user to distrust it.

   An unsave gets a 4s undo, because the row it removes may be
   the only way the user could find that question again.
   ========================================================= */
import React from 'react'
import { codeOf, errorText, isRateLimited } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { qna } from './api'
import { fireHaptic, toast } from '@/ui'
import { emitQna } from './events'
import { toQuestion, type QuestionView } from './types'

export function useQuestionSave(patch: (id: string, fn: (q: QuestionView) => QuestionView) => void) {
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const reconcile = React.useCallback((id: string, raw: any) => {
    const fresh = toQuestion(raw)
    patch(id, q => ({ ...q, saved: fresh.saved, saves: fresh.saves }))
    emitQna('saved:changed', { id, saved: fresh.saved })
  }, [patch])

  const revert = React.useCallback((id: string, saved: boolean, saves: number) => {
    patch(id, q => ({ ...q, saved, saves }))
  }, [patch])

  const save = React.useCallback(async (question: QuestionView, collection?: string) => {
    const { id, saved, saves } = question
    patch(id, q => ({ ...q, saved: true, saves: q.saves + (saved ? 0 : 1) }))
    fireHaptic('select')
    try {
      /* RAW QuestionResponse — this one is not mapped by the module. */
      reconcile(id, await qna.save(id, collection))
    } catch (e: any) {
      revert(id, saved, saves)
      if (isRateLimited(e)) { startCooldown(e); toast.warn(errorText(e)); return }
      /* QNA_SAVE_BLOCKED_RELATIONSHIP and everything else: the server's own
         sentence, verbatim. */
      toast.error(errorText(e))
    }
  }, [patch, reconcile, revert, startCooldown])

  const unsave = React.useCallback(async (question: QuestionView, opts: { undo?: boolean; collection?: string } = {}) => {
    const { id, saved, saves } = question
    patch(id, q => ({ ...q, saved: false, saves: Math.max(0, q.saves - (saved ? 1 : 0)) }))
    fireHaptic('select')
    try {
      reconcile(id, await qna.unsave(id))
      if (opts.undo) {
        toast.info('Removed from saved', {
          label: 'Undo',
          onPress: () => { void save({ ...question, saved: false }, opts.collection) },
        })
      }
    } catch (e: any) {
      revert(id, saved, saves)
      if (isRateLimited(e)) { startCooldown(e); toast.warn(errorText(e)); return }
      if (codeOf(e) === 'QNA_SAVE_BLOCKED_RELATIONSHIP') { toast.error(errorText(e)); return }
      toast.error(errorText(e))
    }
  }, [patch, reconcile, revert, save, startCooldown])

  const toggle = React.useCallback((question: QuestionView, opts: { undo?: boolean; collection?: string } = {}) => {
    if (cooldown > 0) return
    if (question.saved) void unsave(question, opts)
    else void save(question, opts.collection)
  }, [cooldown, save, unsave])

  return { cooldown, toggle, save, unsave }
}
