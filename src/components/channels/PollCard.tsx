/* =========================================================
   The in-post poll.

   Two contract details drive the whole component:

   · `option.pct` is a share of VOTERS, not of votes — with a
     multi-answer poll those differ and the bars would sum past
     100% if recomputed naively. It is taken as given.
   · a quiz withholds `correctOptionIndex`/`explanation` until
     the viewer votes or the poll closes, so `null` there means
     "not revealed yet"; `poll.revealed` is the flag that says
     which of the two it is.

   Retracting a vote is refused on a quiz by design, so that
   affordance is absent rather than disabled.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, Text, Touchable } from '@/ui'

export interface PollCardProps {
  poll: any
  canClose?: boolean
  onVote?: (indexes: number[]) => void | Promise<void>
  onRetract?: () => void | Promise<void>
  onClose?: () => void | Promise<void>
  disabled?: boolean
}

export function PollCard({ poll, canClose, onVote, onRetract, onClose, disabled }: PollCardProps) {
  const t = useTheme()
  const c = t.colors
  const [draft, setDraft] = React.useState<number[]>([])
  const [busy, setBusy] = React.useState(false)

  if (!poll) return null

  const locked = disabled || poll.closed || busy
  const multi = poll.allowsMultipleAnswers && !poll.quiz
  const showResults = poll.voted || poll.closed

  const toggle = (index: number) => {
    if (locked) return
    if (multi) {
      setDraft(d => (d.includes(index) ? d.filter(i => i !== index) : [...d, index]))
      return
    }
    void submit([index])
  }

  const submit = async (indexes: number[]) => {
    if (!indexes.length || !onVote) return
    setBusy(true)
    try { await onVote(indexes); setDraft([]) } finally { setBusy(false) }
  }

  const act = async (fn?: () => void | Promise<void>) => {
    if (!fn) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.md }]}>
      <View style={styles.head}>
        <Icon name={poll.quiz ? 'help' : 'poll'} size={15} color={c.textMuted} />
        <Text variant="caption" tone="muted" align="ui">
          {poll.quiz ? 'Quiz' : multi ? 'Multiple answers' : 'Poll'}
          {poll.anonymous ? ' · Anonymous' : ''}
        </Text>
      </View>

      <Text variant="bodyStrong" align="auto">{poll.question}</Text>

      <View style={{ gap: space.xs2, marginTop: space.xs }}>
        {(poll.options || []).map((o: any) => {
          const picked = o.mine || draft.includes(o.index)
          const correct = poll.revealed && poll.correctOptionIndex === o.index
          const wrong = poll.revealed && o.mine && poll.correctOptionIndex != null && poll.correctOptionIndex !== o.index
          const tint = correct ? c.success : wrong ? c.danger : c.accent
          return (
            <Touchable
              key={o.index}
              onPress={() => toggle(o.index)}
              disabled={locked}
              feedback="dim"
              noAutoHitSlop
              accessibilityState={{ selected: picked }}
              style={[styles.option, { borderColor: picked ? tint : c.border, borderRadius: t.radius.sm }]}
            >
              {showResults ? (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { width: `${Math.min(100, o.pct)}%`, backgroundColor: tint, opacity: 0.13, borderRadius: t.radius.sm },
                  ]}
                />
              ) : null}
              <View
                style={[
                  multi ? styles.box : styles.dot,
                  { borderColor: picked ? tint : c.borderStrong, backgroundColor: picked ? tint : 'transparent' },
                ]}
              >
                {picked ? <Icon name="check" size={11} color={c.textOnAccent} /> : null}
              </View>
              <Text variant="callout" align="auto" style={styles.flex}>{o.text}</Text>
              {showResults ? (
                <Text variant="footnote" tone="muted">{o.pct}%</Text>
              ) : null}
              {correct ? <Icon name="checkCircle" size={15} color={c.success} filled /> : null}
            </Touchable>
          )
        })}
      </View>

      {poll.revealed && poll.explanation ? (
        <View style={[styles.explain, { backgroundColor: c.successSoft, borderRadius: t.radius.sm }]}>
          <Text variant="footnote" color={c.successText} align="auto">{poll.explanation}</Text>
        </View>
      ) : null}

      <View style={styles.foot}>
        <Text variant="caption" tone="muted" align="ui" style={styles.flex}>
          {poll.totalVoters === 1 ? '1 voter' : `${poll.totalVoters} voters`}
          {poll.closed ? ' · Closed' : ''}
        </Text>
        {multi && draft.length && !poll.voted ? (
          <Button label="Vote" size="sm" onPress={() => void submit(draft)} loading={busy} />
        ) : null}
        {poll.voted && !poll.quiz && !poll.closed && onRetract ? (
          <Touchable onPress={() => void act(onRetract)} feedback="dim" disabled={busy}>
            <Text variant="caption" tone="accent">Retract vote</Text>
          </Touchable>
        ) : null}
        {canClose && !poll.closed && onClose ? (
          <Touchable onPress={() => void act(onClose)} feedback="dim" disabled={busy}>
            <Text variant="caption" tone="danger">Stop poll</Text>
          </Touchable>
        ) : null}
      </View>
    </View>
  )
}

/** Fold a `poll.updated` frame into a local poll: counts only.
 *  The broadcast aggregate is viewer-NEUTRAL — assigning it wholesale wipes
 *  the viewer's own selection, which is the one thing they can see. */
export function mergePollFrame(local: any, frame: any) {
  if (!frame) return local
  if (!local) return frame
  const total = frame.totalVoters ?? local.totalVoters ?? 0
  const byIndex = new Map<number, any>((frame.options || []).map((o: any) => [o.index, o]))
  return {
    ...local,
    closed: !!frame.closed,
    totalVoters: total,
    options: (local.options || []).map((o: any) => {
      const next = byIndex.get(o.index)
      const voterCount = next?.voterCount ?? o.voterCount
      return { ...o, voterCount, pct: total > 0 ? Math.round((voterCount / total) * 100) : 0 }
    }),
    revealed: !!frame.closed || local.revealed,
  }
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  explain: { padding: space.sm2 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xxs },
  flex: { flex: 1 },
})
