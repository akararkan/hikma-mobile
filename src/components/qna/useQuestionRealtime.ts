/* =========================================================
   The SSE event table for one question — implemented once so
   the detail page and the thread page cannot drift.

   Two rules shape every line below.

   (1) Q&A events carry FRESH ABSOLUTE counters. Overwrite the
       local number; never add. This is the OPPOSITE of the
       Post channel, and applyPostDelta must not be used here.
       Idempotent operations deliberately re-broadcast the
       authoritative number so a desynced optimistic UI heals.

   (2) The actor's own subscription is skipped on broadcast.
       Every event you receive belongs to somebody else, which
       is why viewer state (`_liked`, `saved`) is never read
       from or written by an event — the payloads are
       viewer-neutral and `myReaction` is always null on the
       wire.

   The stream is also treated as ANONYMOUS: realtime.js appends
   ?token=, but this endpoint relies on a cookie the RN runtime
   has no dependable jar for. It connects anyway (auth is
   optional) and nothing breaks, because nothing viewer-
   specific is read from it.
   ========================================================= */
import React from 'react'
import { useRealtime } from '@/hooks/useRealtime'
import { qna } from './api'
import { recomputeAcceptsNewAnswers } from './gate'
import type { ConnectionState } from './QnaState'
import { toAnswer, type AnswerView, type QuestionView } from './types'

export interface QuestionRealtimeHandlers {
  setQuestion: React.Dispatch<React.SetStateAction<QuestionView | null>>
  setAnswers: React.Dispatch<React.SetStateAction<AnswerView[]>>
  setReplies: React.Dispatch<React.SetStateAction<Record<string, AnswerView[]>>>
  setShares?: (n: number) => void
  /** Which thread roots are open right now — a ref so an expand does not
   *  re-subscribe the socket. */
  expandedRoots?: React.MutableRefObject<Set<string>>
  onQuestionDeleted?: () => void
  onReconcile?: () => void
  /** A new answer arrived from somebody else — show a pill, do not jump. */
  onNewAnswer?: (answer: AnswerView) => void
}

export function useQuestionRealtime(questionId: string | undefined, h: QuestionRealtimeHandlers): ConnectionState {
  const [state, setState] = React.useState<ConnectionState>('reconnecting')
  const ref = React.useRef(h)
  ref.current = h
  const connectedSeen = React.useRef(false)
  const refetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current) }, [])

  const patchRow = React.useCallback((answerId: string, parentAnswerId: string | null, fn: (a: AnswerView) => AnswerView) => {
    if (parentAnswerId) {
      ref.current.setReplies(prev => {
        const list = prev[parentAnswerId]
        if (!list) return prev
        return { ...prev, [parentAnswerId]: list.map(r => (r.id === answerId ? fn(r) : r)) }
      })
      return
    }
    ref.current.setAnswers(prev => prev.map(a => (a.id === answerId ? fn(a) : a)))
  }, [])

  const onEvent = React.useCallback((evt: any) => {
    const type = evt?.eventType || evt?.type
    const answerId: string | undefined = evt?.answerId
    const parentAnswerId: string | null = evt?.parentAnswerId ?? null

    switch (type) {
      case 'ANSWER_CREATED': {
        if (!evt.answer) return
        const row = toAnswer(evt.answer)
        /* The questions stream has no ?token= fallback server-side, so this
           subscription is effectively anonymous on RN and the actor-skip
           (keyed on viewerId) cannot suppress your own echo. The insert is
           deduped anyway; the "new answer" pill must follow the same rule or
           your own post announces itself. */
        let inserted = false
        ref.current.setAnswers(prev => {
          if (prev.some(a => a.id === row.id)) return prev
          inserted = true
          return [...prev, row]
        })
        ref.current.setQuestion(prev => {
          if (!prev) return prev
          const next: QuestionView = {
            ...prev,
            answers: typeof evt.questionAnswerCount === 'number' ? evt.questionAnswerCount : prev.answers,
            status: prev.status === 'OPEN' ? 'ANSWERED' : prev.status,
          }
          return { ...next, acceptsNewAnswers: recomputeAcceptsNewAnswers(next) }
        })
        if (inserted) ref.current.onNewAnswer?.(row)
        return
      }

      case 'REANSWER_CREATED': {
        const root = parentAnswerId
        if (!root) return
        ref.current.setAnswers(prev => prev.map(a => (
          a.id === root && typeof evt.answerReplyCount === 'number' ? { ...a, replyCount: evt.answerReplyCount } : a
        )))
        if (!ref.current.expandedRoots?.current.has(root) || !evt.answer) return
        const row = toAnswer(evt.answer)
        ref.current.setReplies(prev => {
          const list = prev[root] || []
          return list.some(r => r.id === row.id) ? prev : { ...prev, [root]: [...list, row] }
        })
        return
      }

      case 'ANSWER_EDITED': {
        if (!answerId || !evt.answer) return
        const fresh = toAnswer(evt.answer)
        /* PRESERVE the viewer fields: the event DTO is viewer-neutral, so a
           blind replace silently un-likes the row for the current viewer. */
        patchRow(answerId, parentAnswerId, prev => ({ ...fresh, myReaction: prev.myReaction, _liked: prev._liked }))
        return
      }

      case 'ANSWER_DELETED': {
        if (!answerId) return
        if (parentAnswerId) {
          ref.current.setReplies(prev => {
            const list = prev[parentAnswerId]
            if (!list) return prev
            return { ...prev, [parentAnswerId]: list.filter(r => r.id !== answerId) }
          })
          ref.current.setAnswers(prev => prev.map(a => (
            a.id === parentAnswerId && typeof evt.answerReplyCount === 'number' ? { ...a, replyCount: evt.answerReplyCount } : a
          )))
          return
        }
        let wasAccepted = false
        ref.current.setAnswers(prev => {
          wasAccepted = prev.some(a => a.id === answerId && a.accepted)
          return prev.filter(a => a.id !== answerId)
        })
        ref.current.setReplies(prev => {
          if (!(answerId in prev)) return prev
          const { [answerId]: _dropped, ...rest } = prev
          return rest
        })
        ref.current.setQuestion(prev => {
          if (!prev) return prev
          const count = typeof evt.questionAnswerCount === 'number' ? evt.questionAnswerCount : Math.max(0, prev.answers - 1)
          const acceptedCount = wasAccepted ? Math.max(0, prev.acceptedAnswerCount - 1) : prev.acceptedAnswerCount
          const next: QuestionView = {
            ...prev,
            answers: count,
            status: count === 0 && prev.status === 'ANSWERED' ? 'OPEN' : prev.status,
            acceptedAnswerCount: acceptedCount,
            hasAcceptedAnswer: acceptedCount > 0,
          }
          return { ...next, acceptsNewAnswers: recomputeAcceptsNewAnswers(next) }
        })
        return
      }

      case 'ANSWER_REACTION_ADDED':
      case 'ANSWER_REACTION_REMOVED': {
        if (!answerId || typeof evt.answerReactionCount !== 'number') return
        patchRow(answerId, parentAnswerId, prev => ({ ...prev, likes: evt.answerReactionCount }))
        return
      }

      /* Registered in the enum, never emitted — there is one reaction type.
         Handled as a deliberate no-op rather than left to fall through. */
      case 'ANSWER_REACTION_CHANGED':
        return

      case 'ANSWER_ACCEPTED':
      case 'ANSWER_UNACCEPTED': {
        if (!answerId) return
        const accepted = evt.answer?.accepted ?? type === 'ANSWER_ACCEPTED'
        let changed = false
        ref.current.setAnswers(prev => prev.map(a => {
          if (a.id !== answerId || a.accepted === accepted) return a
          changed = true
          return { ...a, accepted }
        }))
        if (!changed) return
        /* The event carries no acceptedAnswerCount, so adjust locally. */
        ref.current.setQuestion(prev => {
          if (!prev) return prev
          const n = Math.max(0, prev.acceptedAnswerCount + (accepted ? 1 : -1))
          return { ...prev, acceptedAnswerCount: n, hasAcceptedAnswer: n > 0 }
        })
        return
      }

      case 'QUESTION_UPDATED': {
        /* Only the body is on the wire; title, tags and keywords are not, so
           one debounced read picks them up without a burst per keystroke
           upstream. */
        if (typeof evt.body === 'string') ref.current.setQuestion(prev => (prev ? { ...prev, body: evt.body } : prev))
        if (refetchTimer.current) clearTimeout(refetchTimer.current)
        refetchTimer.current = setTimeout(() => {
          if (!questionId) return
          qna.get(questionId)
            .then(q => ref.current.setQuestion(q))
            .catch(() => {})
        }, 1500)
        return
      }

      case 'QUESTION_DELETED':
        ref.current.onQuestionDeleted?.()
        return

      case 'QUESTION_LOCKED':
        ref.current.setQuestion(prev => (prev ? { ...prev, answersLocked: true, acceptsNewAnswers: false } : prev))
        return

      case 'QUESTION_UNLOCKED':
        ref.current.setQuestion(prev => {
          if (!prev) return prev
          const next: QuestionView = { ...prev, answersLocked: false }
          return { ...next, acceptsNewAnswers: recomputeAcceptsNewAnswers(next) }
        })
        return

      case 'VIEW_COUNT_UPDATED':
        if (typeof evt.questionViewCount === 'number') {
          ref.current.setQuestion(prev => (prev ? { ...prev, views: evt.questionViewCount } : prev))
        }
        return

      case 'SAVE_COUNT_UPDATED':
        /* Never touch `saved`: this fires for other people's saves too and
           says nothing about whether YOU saved it. */
        if (typeof evt.questionSaveCount === 'number') {
          ref.current.setQuestion(prev => (prev ? { ...prev, saves: evt.questionSaveCount } : prev))
        }
        return

      case 'SHARE_COUNT_UPDATED':
        if (typeof evt.shareCount === 'number') ref.current.setShares?.(evt.shareCount)
        return

      default:
        return
    }
  }, [patchRow, questionId])

  const onConnected = React.useCallback((payload: any) => {
    if (payload?.mock) { setState('mock'); connectedSeen.current = true; return }
    setState('connected')
    /* Every `connected` after the first means "anything emitted while you
       were down is gone" — there is no event-id replay. */
    if (connectedSeen.current) ref.current.onReconcile?.()
    connectedSeen.current = true
  }, [])

  const onError = React.useCallback(() => {
    /* No envelope exists on an SSE failure. Flip the dot and let the
       EventSource reconnect; never toast, never parse. */
    setState(prev => (prev === 'mock' ? prev : 'reconnecting'))
  }, [])

  useRealtime('questions', questionId ?? null, { onEvent, onConnected, onError })

  return state
}
