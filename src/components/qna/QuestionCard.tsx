/* =========================================================
   The question row — feed, saved list, collection.

   TRAP worth stating once: `question.answers` is the top-level
   answer COUNT. `question.answerList` is an empty placeholder
   the adapter always emits, so nothing here may iterate it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, Icon, IconButton, Text, Touchable, VerifiedMark } from '@/ui'
import { MetricStat, SaveButton } from './buttons'
import { StatusPills } from './StatusPills'
import type { QuestionView } from './types'

/* Every callback takes the QUESTION back. FlashList's ViewHolder memo compares
   renderItem by identity, so a list that writes `onPress={() => open(item)}`
   mints a fresh renderItem — and re-renders every mounted cell — on each
   parent render, and this component's own React.memo never hits because its
   props are new lambdas. Item-first means ONE handler serves the whole list. */
export interface QuestionCardProps {
  question: QuestionView
  onPress: (q: QuestionView) => void
  onAuthorPress: (q: QuestionView) => void
  onTagPress: (tag: string) => void
  onToggleSave: (q: QuestionView) => void
  onLongPressSave?: (q: QuestionView) => void
  onOverflow: (q: QuestionView) => void
  /** The "Saved {relative}" line — only the saved-list endpoints send savedAt. */
  showSavedAt?: boolean
  saveCooldown?: number
  saveDisabled?: boolean
}

function QuestionCardBase({
  question, onPress, onAuthorPress, onTagPress, onToggleSave, onLongPressSave,
  onOverflow, showSavedAt, saveCooldown = 0, saveDisabled,
}: QuestionCardProps) {
  const t = useTheme()
  const c = t.colors
  const a = question._author
  const tags = question.tags.slice(0, 3)
  const overflowTags = question.tags.length - tags.length

  /* Bound here rather than at the call site: inside a memoized row a closure
     per render costs nothing, and it is what keeps the LIST's handlers — and
     therefore its renderItem — identity-stable. */
  const press = () => onPress(question)
  const author = () => onAuthorPress(question)
  const overflow = () => onOverflow(question)
  const toggleSave = () => onToggleSave(question)
  const longPressSave = onLongPressSave ? () => onLongPressSave(question) : undefined

  return (
    <Touchable
      onPress={press}
      onLongPress={overflow}
      feedback="scale"
      noAutoHitSlop
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderRadius: t.radius.lg,
          marginHorizontal: t.layout.screenPadding,
        },
      ]}
    >
      <View style={styles.authorRow}>
        <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={32} onPress={author} />
        <Touchable onPress={author} feedback="dim" noAutoHitSlop style={styles.authorText}>
          <View style={styles.nameRow}>
            <Text variant="subhead" weight="600" numberOfLines={1} align="ui" style={styles.shrink}>{a.full}</Text>
            {a.verified ? <VerifiedMark size={13} /> : null}
          </View>
          <Text variant="footnote" tone="muted" numberOfLines={1} align="ui">
            @{a.handle} · {question.time}
          </Text>
        </Touchable>
        <IconButton name="more" onPress={overflow} size={17} color={c.textFaint} accessibilityLabel="More options" />
      </View>

      <Text variant="title3" numberOfLines={3} align="auto" style={{ marginTop: space.xs2 }}>{question.title}</Text>

      {question.body ? (
        <Text variant="body" tone="secondary" numberOfLines={2} align="auto" style={{ marginTop: space.xs2 }}>
          {question.body}
        </Text>
      ) : null}

      {tags.length ? (
        <View style={[styles.tagRow, { marginTop: space.sm2 }]}>
          {tags.map(tag => (
            <Chip key={tag} label={`#${tag}`} tone="accent" size="sm" onPress={() => onTagPress(tag)} />
          ))}
          {overflowTags > 0 ? <Chip label={`+${overflowTags}`} tone="neutral" size="sm" /> : null}
        </View>
      ) : null}

      <StatusPills question={question} />

      <View style={[styles.metricRow, { marginTop: space.md }]}>
        <MetricStat icon="comment" value={question.answers} label="answers" />
        <MetricStat icon="eye" value={question.views} label="views" />
        <MetricStat icon="bookmark" value={question.saves} label="saves" />
        <View style={styles.spacer} />
        <SaveButton
          saved={question.saved}
          cooldown={saveCooldown}
          disabled={saveDisabled}
          onToggle={toggleSave}
          onLongPress={longPressSave}
        />
      </View>

      {showSavedAt && question.savedAt ? (
        <View style={[styles.savedRow, { borderTopColor: c.separator }]}>
          <Icon name="bookmark" size={12} color={c.accent} filled />
          <Text variant="footnote" tone="faint" align="ui">Saved {relative(question.savedAt)}</Text>
        </View>
      ) : null}
    </Touchable>
  )
}

/* Module scope: every `toLocaleDateString` call with an options bag builds a
   fresh Intl.DateTimeFormat internally — ICU pattern resolution on Hermes,
   an order of magnitude dearer than formatting through a cached instance. */
const SAVED_DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The saved-list rows are the only place a client-side relative time is
 *  needed: `savedAt` is a raw instant, unlike `time`, which the server
 *  already renders as prose. */
function relative(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const s = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w ago`
  return SAVED_DATE.format(then)
}

export const QuestionCard = React.memo(QuestionCardBase)

const styles = StyleSheet.create({
  card: { padding: space.lg, borderWidth: StyleSheet.hairlineWidth },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  authorText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  shrink: { flexShrink: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, marginBottom: space.xs2 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  spacer: { flex: 1 },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    marginTop: space.md, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth,
  },
})
