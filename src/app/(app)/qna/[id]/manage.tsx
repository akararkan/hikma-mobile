/* =========================================================
   Answer settings — the author's control panel.

   Two behaviours here are contract, not preference:

   · Setting a cap BELOW the number of answers already posted
     is legal server-side. The client warns and then obeys;
     blocking it would be inventing a rule.
   · A limit change emits NO SSE event, so after a successful
     call the mapped question is pushed back into the detail
     screen's state by hand. Nothing else will tell it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { codeOf, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, ConfirmSheet, GroupFooter, GroupLabel, Header, Icon, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, Spinner, Text, Touchable, fireHaptic,
  toast, useSheetState,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { emitQna } from '@/components/qna/events'
import { canManageQuestion } from '@/components/qna/gate'
import { QnaErrorView, QnaRefusal, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { toQuestion, type QuestionView } from '@/components/qna/types'

const LIMITS = [
  { value: 'none', label: 'Unlimited' },
  { value: '1', label: '1' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: 'custom', label: 'Custom' },
]

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open', ANSWERED: 'Answered', CLOSED: 'Closed', ARCHIVED: 'Archived',
}

export default function AnswerSettingsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })
  const q = question.data

  const [lockBusy, setLockBusy] = React.useState(false)
  const [limitBusy, setLimitBusy] = React.useState(false)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [sectionError, setSectionError] = React.useState<{ where: 'lock' | 'limit'; message: string } | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [customLimit, setCustomLimit] = React.useState(10)
  const [pendingCap, setPendingCap] = React.useState<number | null>(null)
  const [lockCooldown, startLockCooldown] = useCooldown() as [number, (e: unknown) => boolean]
  const [limitCooldown, startLimitCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const confirmDelete = useSheetState()
  const confirmLowCap = useSheetState<number>()
  const debounce = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  React.useEffect(() => {
    if (q?.maxAnswers != null && ![1, 3, 5].includes(q.maxAnswers)) setCustomLimit(q.maxAnswers)
  }, [q?.maxAnswers])

  const push = (updated: QuestionView) => {
    question.setData(updated)
    /* The limit endpoint is silent on SSE, so the detail screen learns from
       here or not at all. */
    emitQna('question:updated', updated)
  }

  const handleError = (e: any, where: 'lock' | 'limit') => {
    const code = codeOf(e)
    if (code === 'ACCESS_FORBIDDEN') { setSectionError({ where, message: errorText(e) }); setRefused(true); return }
    if (e?.status === 429) { (where === 'lock' ? startLockCooldown : startLimitCooldown)(e) }
    setSectionError({ where, message: errorText(e) })
  }

  const toggleLock = async (next: boolean) => {
    if (!q || lockBusy) return
    setLockBusy(true)
    setSectionError(null)
    /* Optimistic, and reverted precisely — the switch is the only feedback. */
    question.setData(prev => (prev ? { ...prev, answersLocked: next, acceptsNewAnswers: next ? false : prev.acceptsNewAnswers } : prev))
    fireHaptic('light')
    try {
      const raw = next ? await qna.lockAnswers(q.id) : await qna.unlockAnswers(q.id)
      push(toQuestion(raw))
    } catch (e: any) {
      question.setData(prev => (prev ? { ...prev, answersLocked: !next } : prev))
      handleError(e, 'lock')
    } finally { setLockBusy(false) }
  }

  const applyLimit = async (max: number | null) => {
    if (!q) return
    setLimitBusy(true)
    setSectionError(null)
    const before = q.maxAnswers
    question.setData(prev => (prev ? { ...prev, maxAnswers: max } : prev))
    try {
      /* Omitting the argument drops the query param entirely, which is how the
         server is told to clear the cap. */
      const raw = max == null ? await qna.answerLimit(q.id) : await qna.answerLimit(q.id, max)
      push(toQuestion(raw))
    } catch (e: any) {
      question.setData(prev => (prev ? { ...prev, maxAnswers: before } : prev))
      handleError(e, 'limit')
    } finally { setLimitBusy(false) }
  }

  const chooseLimit = (value: string) => {
    if (!q) return
    if (value === 'none') { setPendingCap(null); void applyLimit(null); return }
    if (value === 'custom') { setPendingCap(customLimit); commitCustom(customLimit); return }
    const n = Number(value)
    if (n < q.answers) { confirmLowCap.open(n); return }
    setPendingCap(n)
    void applyLimit(n)
  }

  /* The stepper fires on every tap; one request per tap would burn the social
     limiter, so the commit waits for the user to settle. */
  const commitCustom = (n: number) => {
    setCustomLimit(n)
    setPendingCap(n)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      if (q && n < q.answers) { confirmLowCap.open(n); return }
      void applyLimit(n)
    }, 600)
  }

  const doDelete = async () => {
    if (!q) return
    setDeleteBusy(true)
    try {
      await qna.remove(q.id)
      emitQna('question:deleted', { id: q.id })
      confirmDelete.close()
      router.replace(qnaHref.home())
    } catch (e: any) {
      toast.error(errorText(e))
    } finally { setDeleteBusy(false) }
  }

  if (question.loading) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Answer settings" />
        <QnaSkeletons kind="sourceRow" count={3} />
      </Screen>
    )
  }

  if (question.error || !q) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Answer settings" />
        <QnaErrorView error={question.error} onRetry={question.reload} onBack={() => router.replace(qnaHref.home())} />
      </Screen>
    )
  }

  if (refused || !canManageQuestion(user, q)) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Answer settings" />
        <QnaRefusal
          title="Only the question author can change these settings."
          onBack={() => (router.canGoBack() ? router.back() : router.replace(qnaHref.home()))}
        />
      </Screen>
    )
  }

  const limitValue = q.maxAnswers == null ? 'none' : [1, 3, 5].includes(q.maxAnswers) ? String(q.maxAnswers) : 'custom'
  const cap = q.maxAnswers ?? 0
  const ratio = cap > 0 ? Math.min(1, q.answers / cap) : 0
  const barColor = cap > 0 && q.answers >= cap ? c.danger : ratio >= 0.8 ? c.warning : c.accent
  const accepting = q.acceptsNewAnswers ?? (!q.answersLocked && (q.status === 'OPEN' || q.status === 'ANSWERED') && (q.maxAnswers == null || q.answers < q.maxAnswers))

  return (
    <Screen background="sunken" edges={['top']}>
      <Header back title="Answer settings" subtitle={q.title} />

      <ScreenScroll>
        <GroupLabel>Answering</GroupLabel>
        <RowGroup inset={16}>
          <ListRow
            title="Lock answers"
            subtitle="Nobody can post new answers or replies while this is on"
            minHeight={60}
            accessory={
              lockBusy
                ? { kind: 'custom', node: <Spinner style={styles.rowSpinner} /> }
                : lockCooldown > 0
                  ? { kind: 'value', text: `Wait ${lockCooldown}s`, chevron: false }
                  /* The row's own switch accessory — themed by @/ui, no
                     colour literals here. */
                  : { kind: 'switch', value: q.answersLocked, onValueChange: v => void toggleLock(v) }
            }
          />
        </RowGroup>
        {sectionError?.where === 'lock' ? <SectionError message={sectionError.message} onRetry={() => setSectionError(null)} /> : null}

        <GroupLabel>Answer limit</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.md, marginHorizontal: t.layout.screenPadding }]}>
          <View style={styles.currentRow}>
            <Text variant="body" align="ui" style={styles.flex}>Current limit</Text>
            {limitBusy ? <Spinner style={styles.rowSpinner} /> : (
              <Text variant="callout" tone="muted" align="ui">
                {q.maxAnswers == null ? 'Unlimited' : `${q.maxAnswers} answers`}
              </Text>
            )}
          </View>

          <SegmentedControl
            options={LIMITS}
            value={pendingCap != null && limitValue === 'custom' ? 'custom' : limitValue}
            onChange={chooseLimit}
            style={{ marginTop: space.xs }}
          />

          {limitValue === 'custom' || pendingCap != null && ![1, 3, 5].includes(pendingCap) ? (
            <View style={[styles.stepper, { borderColor: c.border, borderRadius: t.radius.md }]}>
              <Touchable
                onPress={() => commitCustom(Math.max(1, customLimit - 1))}
                feedback="scale"
                haptic="select"
                style={styles.stepBtn}
                accessibilityLabel="Lower the limit"
              >
                <View style={[styles.minus, { backgroundColor: c.textSecondary }]} />
              </Touchable>
              <Text variant="title3" align="center" style={styles.flex}>{customLimit}</Text>
              <Touchable
                onPress={() => commitCustom(Math.min(999, customLimit + 1))}
                feedback="scale"
                haptic="select"
                style={styles.stepBtn}
                accessibilityLabel="Raise the limit"
              >
                <Icon name="add" size={18} color={c.textSecondary} />
              </Touchable>
            </View>
          ) : null}

          {q.maxAnswers != null ? (
            <View style={{ marginTop: space.md2 }}>
              <Text
                variant="footnote"
                align="ui"
                tone={q.answers >= cap ? 'warning' : 'muted'}
              >
                {q.answers} of {cap} answers used{q.answers >= cap ? ' — no new answers accepted' : ''}
              </Text>
              <View style={[styles.track, { backgroundColor: c.surfaceSunken }]}>
                <View style={{ width: `${Math.round(ratio * 100)}%`, height: '100%', backgroundColor: barColor, borderRadius: 2 }} />
              </View>
            </View>
          ) : null}
        </View>
        {sectionError?.where === 'limit' ? <SectionError message={sectionError.message} onRetry={() => setSectionError(null)} /> : null}
        <GroupFooter>Only top-level answers count. Replies are never capped.</GroupFooter>

        <GroupLabel>Status</GroupLabel>
        <RowGroup inset={16}>
          <ListRow
            title={`Currently: ${STATUS_LABEL[q.status] ?? q.status}`}
            minHeight={52}
            leading={
              <View
                style={{
                  width: 9, height: 9, borderRadius: 5,
                  backgroundColor: q.status === 'OPEN' ? c.success : q.status === 'ANSWERED' ? c.accent : c.textFaint,
                }}
              />
            }
          />
          <ListRow
            title={`Accepting new answers: ${accepting ? 'Yes' : 'No'}`}
            subtitle={accepting ? undefined : (q.answersLocked
              ? 'Answers are locked.'
              : q.status === 'CLOSED' || q.status === 'ARCHIVED'
                ? 'The question is closed.'
                : 'The answer limit has been reached.')}
            minHeight={52}
          />
        </RowGroup>
        {/* No endpoint sets CLOSED or ARCHIVED, so these two rows are
            deliberately read-only. */}

        <View style={{ marginTop: space.xxxl, marginHorizontal: t.layout.screenPadding }}>
          <Button label="Delete question" variant="danger" size="lg" block onPress={confirmDelete.open} />
        </View>
      </ScreenScroll>

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this question?"
        message="Every answer, reply, reaction, file and bookmark on it is deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleteBusy}
        onConfirm={doDelete}
      />

      <ConfirmSheet
        visible={confirmLowCap.visible}
        onClose={confirmLowCap.close}
        title="Set the limit below the answers already posted?"
        message={`This is below the ${q.answers} answers already posted. New answers will be refused.`}
        confirmLabel="Set anyway"
        onConfirm={() => {
          const n = confirmLowCap.payload
          confirmLowCap.close()
          if (n != null) { setPendingCap(n); setCustomLimit(n); void applyLimit(n) }
        }}
      />
    </Screen>
  )
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.strip, { marginHorizontal: t.layout.screenPadding, backgroundColor: t.colors.dangerSoft, borderRadius: t.radius.sm }]}>
      <Icon name="error" size={15} color={t.colors.dangerText} />
      <Text variant="footnote" color={t.colors.dangerText} align="ui" style={styles.flex}>{message}</Text>
      <Touchable onPress={onRetry} feedback="dim">
        <Text variant="footnote" weight="700" color={t.colors.dangerText}>Dismiss</Text>
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space.md2, borderWidth: StyleSheet.hairlineWidth },
  currentRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  rowSpinner: { padding: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', marginTop: space.md, borderWidth: StyleSheet.hairlineWidth, height: 48 },
  stepBtn: { width: 52, height: '100%', alignItems: 'center', justifyContent: 'center' },
  minus: { width: 15, height: 2, borderRadius: 1 },
  track: { height: 4, borderRadius: 2, marginTop: space.sm, overflow: 'hidden' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, marginTop: space.sm, minHeight: 44 },
})
