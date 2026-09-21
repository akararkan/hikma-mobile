/* =========================================================
   Like / accept / delete, with their optimism and their exact
   rollbacks. Imported by both the detail screen and the thread
   screen so the two cannot drift.

   The like path coalesces on a 700ms window. There is one
   reaction type in this domain and the limiter is 30 per 10
   seconds; a double-tap that fired two requests would spend a
   fifteenth of that budget undoing itself.
   ========================================================= */
import React from 'react'
import { codeOf, errorText, isNotFound, isRateLimited } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { qna } from './api'
import { fireHaptic, toast } from '@/ui'
import { emitQna } from './events'
import { recomputeAcceptsNewAnswers } from './gate'
import { toAnswer, type AnswerView, type QuestionView } from './types'

export interface AnswerActionHost {
  patchAnswer: (answerId: string, parentAnswerId: string | null, fn: (a: AnswerView) => AnswerView) => void
  removeAnswer: (answerId: string, parentAnswerId: string | null) => void
  patchQuestion: (fn: (q: QuestionView) => QuestionView) => void
}

interface PendingLike {
  timer: ReturnType<typeof setTimeout>
  start: boolean
  startLikes: number
  target: boolean
  parent: string | null
}

export function useAnswerActions(questionId: string | undefined, host: AnswerActionHost) {
  const [likeCooldown, startLikeCooldown] = useCooldown() as [number, (e: unknown) => boolean]
  const [acceptDenied, setAcceptDenied] = React.useState(false)
  const [unacceptableIds, setUnacceptableIds] = React.useState<Set<string>>(() => new Set())
  const [acceptBusyId, setAcceptBusyId] = React.useState<string | null>(null)

  const hostRef = React.useRef(host)
  hostRef.current = host
  const pending = React.useRef(new Map<string, PendingLike>())

  React.useEffect(() => () => {
    for (const p of pending.current.values()) clearTimeout(p.timer)
    pending.current.clear()
  }, [])

  const applyLike = React.useCallback((id: string, parent: string | null, liked: boolean, likes: number) => {
    hostRef.current.patchAnswer(id, parent, a => ({ ...a, _liked: liked, myReaction: liked ? 'LIKE' : null, likes }))
  }, [])

  const commitLike = React.useCallback(async (id: string) => {
    const entry = pending.current.get(id)
    if (!entry || !questionId) return
    pending.current.delete(id)
    /* Back where it started — the taps cancelled out, so no request at all. */
    if (entry.target === entry.start) return

    try {
      const raw = entry.target
        ? await qna.react(questionId, id)
        : await qna.unreact(questionId, id)
      /* RAW QuestionAnswerResponse — the module does not map these two. */
      const fresh = toAnswer(raw)
      applyLike(id, entry.parent, fresh.myReaction === 'LIKE', fresh.likes)
    } catch (e: any) {
      applyLike(id, entry.parent, entry.start, entry.startLikes)
      if (isRateLimited(e)) { startLikeCooldown(e); return }
      if (isNotFound(e)) {
        /* Deleted under us — dropping the row is more honest than an error. */
        hostRef.current.removeAnswer(id, entry.parent)
        return
      }
      if (codeOf(e) === 'ANSWER_REACTION_BLOCKED_RELATIONSHIP') { toast.error(errorText(e)); return }
      toast.error(errorText(e))
    }
  }, [questionId, applyLike, startLikeCooldown])

  const toggleLike = React.useCallback((answer: AnswerView, next: boolean) => {
    if (likeCooldown > 0) return
    fireHaptic('light')
    const prev = pending.current.get(answer.id)
    const start = prev ? prev.start : answer._liked
    const startLikes = prev ? prev.startLikes : answer.likes
    if (prev) clearTimeout(prev.timer)

    applyLike(answer.id, answer.parentAnswerId, next, Math.max(0, startLikes + (next === start ? 0 : next ? 1 : -1)))

    const timer = setTimeout(() => { void commitLike(answer.id) }, 700)
    pending.current.set(answer.id, { timer, start, startLikes, target: next, parent: answer.parentAnswerId })
  }, [likeCooldown, applyLike, commitLike])

  const toggleAccept = React.useCallback(async (answer: AnswerView, next: boolean) => {
    if (!questionId || answer.parentAnswerId) return
    setAcceptBusyId(answer.id)
    hostRef.current.patchAnswer(answer.id, null, a => ({ ...a, accepted: next }))
    hostRef.current.patchQuestion(q => {
      const n = Math.max(0, q.acceptedAnswerCount + (next ? 1 : -1))
      return { ...q, acceptedAnswerCount: n, hasAcceptedAnswer: n > 0 }
    })
    fireHaptic(next ? 'success' : 'light')

    try {
      const raw = next ? await qna.accept(questionId, answer.id) : await qna.unaccept(questionId, answer.id)
      const fresh = toAnswer(raw)
      hostRef.current.patchAnswer(answer.id, null, a => ({ ...a, accepted: fresh.accepted }))
    } catch (e: any) {
      hostRef.current.patchAnswer(answer.id, null, a => ({ ...a, accepted: !next }))
      hostRef.current.patchQuestion(q => {
        const n = Math.max(0, q.acceptedAnswerCount + (next ? -1 : 1))
        return { ...q, acceptedAnswerCount: n, hasAcceptedAnswer: n > 0 }
      })
      const code = codeOf(e)
      if (code === 'REANSWER_NOT_ACCEPTABLE') {
        /* Our bug: the control leaked onto a reply. Hide it and say so in the
           log rather than blaming the user. */
        console.error('[qna] BUG: accept offered on a reanswer — canAccept must be false when parentAnswerId is set.')
        setUnacceptableIds(prev => new Set(prev).add(answer.id))
        return
      }
      if (code === 'ACCESS_FORBIDDEN') { setAcceptDenied(true); return }
      if (isRateLimited(e)) { startLikeCooldown(e); return }
      toast.error(errorText(e))
    } finally {
      setAcceptBusyId(null)
    }
  }, [questionId, startLikeCooldown])

  const removeAnswerRow = React.useCallback(async (answer: AnswerView) => {
    if (!questionId) return false
    try {
      await qna.deleteAnswer(questionId, answer.id)
      hostRef.current.removeAnswer(answer.id, answer.parentAnswerId)
      if (answer.parentAnswerId) {
        const parent = answer.parentAnswerId
        hostRef.current.patchAnswer(parent, null, a => ({ ...a, replyCount: Math.max(0, a.replyCount - 1) }))
      } else {
        hostRef.current.patchQuestion(q => {
          const count = Math.max(0, q.answers - 1)
          const accepted = answer.accepted ? Math.max(0, q.acceptedAnswerCount - 1) : q.acceptedAnswerCount
          const nextQ: QuestionView = {
            ...q,
            answers: count,
            status: count === 0 && q.status === 'ANSWERED' ? 'OPEN' : q.status,
            acceptedAnswerCount: accepted,
            hasAcceptedAnswer: accepted > 0,
          }
          return { ...nextQ, acceptsNewAnswers: recomputeAcceptsNewAnswers(nextQ) }
        })
      }
      emitQna('answer:deleted', { questionId, answerId: answer.id, parentAnswerId: answer.parentAnswerId })
      toast.ok('Deleted')
      return true
    } catch (e: any) {
      if (isNotFound(e)) {
        hostRef.current.removeAnswer(answer.id, answer.parentAnswerId)
        return true
      }
      toast.error(errorText(e))
      return false
    }
  }, [questionId])

  const canAcceptRow = React.useCallback(
    (answer: AnswerView) => !acceptDenied && !answer.parentAnswerId && !unacceptableIds.has(answer.id),
    [acceptDenied, unacceptableIds],
  )

  return { likeCooldown, toggleLike, toggleAccept, removeAnswerRow, canAcceptRow, acceptBusyId }
}
