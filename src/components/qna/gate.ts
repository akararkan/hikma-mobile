/* =========================================================
   The composer gate — the single most important rule in this
   domain, implemented once.

   TOP-LEVEL answering is gated on the SERVER-COMPUTED
   `acceptsNewAnswers`. Reaching maxAnswers does NOT move the
   question's status, so a status-derived gate leaves a dead
   composer that accepts text and then 400s.

   REPLIES are gated on lock/closed ONLY: a reanswer never
   counts toward answerCount or maxAnswers, so a capped
   question must still take replies.

   Because the banner, the docked bar, the compose screen and
   the empty state all ask the same question, they all ask it
   here — otherwise three of them eventually disagree.
   ========================================================= */
import { hasRole, isPlatformAdmin, type AuthUser } from '@/context/AuthContext'
import type { QuestionView } from './types'

export type GateReason = 'LOCKED' | 'CLOSED' | 'CAPPED' | 'ROLE' | 'SIGNED_OUT'
export interface GateResult { open: boolean; reason?: GateReason; copy?: string }

const OPEN_STATUSES = new Set(['OPEN', 'ANSWERED'])

/** Copy per reason. These state a UI fact the client already knows from the
 *  question object — they are never a stand-in for a server message. */
export function gateCopy(reason: GateReason, maxAnswers?: number | null): string {
  switch (reason) {
    case 'LOCKED': return 'The author locked answers on this question.'
    case 'CLOSED': return 'This question is closed and no longer accepts answers.'
    case 'CAPPED': return `This question reached its limit of ${maxAnswers ?? 0} answers.`
    case 'ROLE': return 'Only scholars and researchers can answer questions.'
    case 'SIGNED_OUT': return 'Sign in to answer this question.'
  }
}

export function canAnswerRole(user: AuthUser | null): boolean {
  return hasRole(user, 'SCHOLAR', 'RESEARCHER') || isPlatformAdmin(user)
}

export function canAskRole(user: AuthUser | null): boolean {
  return hasRole(user, 'SCHOLAR') || isPlatformAdmin(user)
}

/** Answer author, question author or platform admin may edit/delete an answer
 *  and manage its sources and attachments. */
export function canManageAnswer(
  user: AuthUser | null, question: QuestionView | null, answerAuthorId: string | null | undefined,
): boolean {
  if (!user) return false
  return user.id === answerAuthorId || user.id === question?.author || isPlatformAdmin(user)
}

export function canManageQuestion(user: AuthUser | null, question: QuestionView | null): boolean {
  if (!user || !question) return false
  return user.id === question.author || isPlatformAdmin(user)
}

export function composerGate(
  question: QuestionView | null,
  user: AuthUser | null,
  mode: 'ANSWER' | 'REPLY',
  signedIn: boolean,
): GateResult {
  if (!signedIn) return { open: false, reason: 'SIGNED_OUT', copy: gateCopy('SIGNED_OUT') }
  if (!canAnswerRole(user)) return { open: false, reason: 'ROLE', copy: gateCopy('ROLE') }
  if (!question) return { open: true }

  /* Priority order is fixed: locked beats closed beats capped, so a locked
     AND capped question never explains the wrong constraint. */
  if (question.answersLocked) return { open: false, reason: 'LOCKED', copy: gateCopy('LOCKED') }
  if (!OPEN_STATUSES.has(question.status)) return { open: false, reason: 'CLOSED', copy: gateCopy('CLOSED') }
  if (mode === 'REPLY') return { open: true }

  /* Trust the server's verdict when it sent one; only derive when the DTO
     revision omitted it (null == unknown, never false). */
  if (question.acceptsNewAnswers === false) {
    const capped = question.maxAnswers != null && question.answers >= question.maxAnswers
    return capped
      ? { open: false, reason: 'CAPPED', copy: gateCopy('CAPPED', question.maxAnswers) }
      : { open: false, reason: 'CLOSED', copy: gateCopy('CLOSED') }
  }
  if (question.acceptsNewAnswers == null && question.maxAnswers != null && question.answers >= question.maxAnswers) {
    return { open: false, reason: 'CAPPED', copy: gateCopy('CAPPED', question.maxAnswers) }
  }
  return { open: true }
}

/** Fold a fresh answer count back into the local gate. Used after a post and
 *  after ANSWER_CREATED / ANSWER_DELETED, both of which carry absolutes. */
export function recomputeAcceptsNewAnswers(q: QuestionView): boolean {
  if (q.answersLocked) return false
  if (!OPEN_STATUSES.has(q.status)) return false
  return q.maxAnswers == null || q.answers < q.maxAnswers
}
