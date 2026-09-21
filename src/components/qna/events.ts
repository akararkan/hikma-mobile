/* =========================================================
   The hand-back channel between Q&A screens.

   The SSE stream actor-skips your own actions: after you post
   an answer, edit a question or delete a source, nothing will
   ever arrive to tell you about it. Waiting for your own event
   is a hang. So the screen that performed the write publishes
   the mapped view object here, and whichever screens are still
   mounted patch themselves in place instead of refetching.

   Route params are the obvious alternative and the wrong one:
   expo-router persists them, so a stale draft or a deleted id
   comes back on the next cold start of the same route.
   ========================================================= */
import React from 'react'
import type { AnswerView, QuestionView } from './types'

export interface QnaEventMap {
  'question:created': QuestionView
  'question:updated': QuestionView
  'question:deleted': { id: string }
  'answer:created': { questionId: string; answer: AnswerView }
  'answer:updated': { questionId: string; answer: AnswerView }
  'answer:deleted': { questionId: string; answerId: string; parentAnswerId: string | null }
  'saved:changed': { id: string; saved: boolean; collection?: string }
}

type Handler<K extends keyof QnaEventMap> = (payload: QnaEventMap[K]) => void

const listeners = new Map<string, Set<(p: any) => void>>()

export function emitQna<K extends keyof QnaEventMap>(type: K, payload: QnaEventMap[K]) {
  for (const fn of [...(listeners.get(type) ?? [])]) {
    try { fn(payload) } catch { /* one broken listener must not starve the rest */ }
  }
}

export function onQna<K extends keyof QnaEventMap>(type: K, fn: Handler<K>): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(fn as (p: any) => void)
  return () => { listeners.get(type)?.delete(fn as (p: any) => void) }
}

/** Subscribe for the life of a component. The handler lives in a ref so an
 *  inline arrow does not re-subscribe on every render. */
export function useQnaEvent<K extends keyof QnaEventMap>(type: K, fn: Handler<K>) {
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => onQna(type, p => ref.current(p)), [type])
}
