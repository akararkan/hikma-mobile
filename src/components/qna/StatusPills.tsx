/* =========================================================
   The question's badge set, in one place so the feed card, the
   hero and the settings screen can never disagree about what
   "resolved" or "capped" looks like.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Chip } from '@/ui'
import type { QuestionView } from './types'
import { space } from '@/theme/tokens'

export function StatusPills({ question, size = 'sm' }: { question: QuestionView; size?: 'sm' | 'md' }) {
  const pills: React.ReactNode[] = []

  if (question.hasAcceptedAnswer) pills.push(<Chip key="resolved" label="Resolved" icon="checkCircle" tone="scholar" size={size} />)
  if (question.answersLocked) pills.push(<Chip key="locked" label="Locked" icon="lock" tone="neutral" size={size} />)
  if (question.status === 'CLOSED') pills.push(<Chip key="closed" label="Closed" tone="neutral" size={size} />)
  if (question.status === 'ARCHIVED') pills.push(<Chip key="archived" label="Archived" icon="archive" tone="neutral" size={size} />)
  /* A cap does not move the status, so this pill is the only place a reader
     learns the question is filling up. */
  if (question.maxAnswers != null) {
    pills.push(
      <Chip
        key="cap"
        label={`${question.answers} of ${question.maxAnswers} answers`}
        tone="warning"
        size={size}
      />,
    )
  }

  if (!pills.length) return null
  return <View style={styles.row}>{pills}</View>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs2 },
})
