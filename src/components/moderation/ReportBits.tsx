/* =========================================================
   Safety-report vocabulary.

   The nouns and the outcome colours are CLIENT-owned: the API
   sends `targetType: "RESEARCH"` and `outcome: "ACTION_TAKEN"`
   and nothing else, so every surface that renders a report —
   the hub card, the list, the detail screen — has to agree on
   what those words look like in a sentence. One map, three
   screens.

   The reporter is only ever told a COARSE outcome. What
   actually happened to the other account is that account's
   private moderation record; showing or guessing at it is how a
   report form becomes a harassment tool.
   ========================================================= */
import React from 'react'
import { REPORT_OUTCOME_LABELS, REPORT_REASONS } from '@/api'
import { Pill } from './parts'

/** REPORT_TARGET_TYPES → the noun that reads naturally mid-sentence. */
export const REPORT_TARGET_NOUNS: Record<string, string> = {
  USER: 'account',
  POST: 'post',
  COMMENT: 'comment',
  RESEARCH: 'research paper',
  QUESTION: 'question',
  ANSWER: 'answer',
  MESSAGE: 'message',
  CHANNEL: 'channel',
  STORY: 'story',
}

export function targetNoun(type?: string | null): string {
  const key = String(type || '').toUpperCase()
  return REPORT_TARGET_NOUNS[key] ?? (key ? key.toLowerCase().replace(/_/g, ' ') : 'item')
}

const REASON_LABELS: Record<string, string> = Object.fromEntries(REPORT_REASONS as [string, string][])

export function reasonLabel(reason?: string | null): string {
  const key = String(reason || '').toUpperCase()
  return REASON_LABELS[key] ?? (key ? key.toLowerCase().replace(/_/g, ' ') : '—')
}

type OutcomeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const OUTCOME_TONE: Record<string, OutcomeTone> = {
  UNDER_REVIEW: 'info',
  ACTION_TAKEN: 'success',
  NO_ACTION: 'neutral',
  APPEAL_UNDER_REVIEW: 'warning',
}

export function outcomeTone(outcome?: string | null): OutcomeTone {
  return OUTCOME_TONE[String(outcome || '').toUpperCase()] ?? 'neutral'
}

/** An unknown outcome renders its raw value in a grey pill rather than blank —
 *  a report with no visible status reads as a report that was lost. */
export function OutcomePill({ outcome, size }: { outcome?: string | null; size?: 'sm' | 'md' }) {
  const key = String(outcome || '').toUpperCase()
  const label = (REPORT_OUTCOME_LABELS as Record<string, string>)[key] ?? (key || 'Under review')
  return <Pill label={label} tone={outcomeTone(key)} size={size} />
}
