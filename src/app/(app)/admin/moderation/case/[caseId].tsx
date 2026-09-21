/* =========================================================
   One moderation case.

   This is the screen the content-privacy boundary lives on.
   Chat and live-chat bodies are NEVER shown to staff, in any
   admin view, ever — the server substitutes a placeholder into
   `fields[].text` and the console's job is to say so plainly
   and make the decision possible anyway, from the scores.

   Wire details that shape the code more than the layout:

   · A MISSING case is 400 MODERATION_CASE_NOT_FOUND, never a
     404, so `isNotFound()` will not catch it and the not-found
     branch lives in the error handler.
   · `thresholds.entityType` is LOWERCASE while
     `summary.entityType` is UPPERCASE — in the same payload.
     Everything is normalised through entityTypeName/Key.
   · `fields[].scores === {}` means "we could not read it", NOT
     "all zero". A row of empty bars would be a confident lie,
     so the block is replaced by a sentence.
   · `decidedAt` is ABSENT when undecided (NON_NULL is global),
     never present-and-null.
   · `teachModel` is a silent no-op for CHAT_MESSAGE /
     LIVE_CHAT — the switch is force-disabled rather than
     promising a training write that never happens.

   Neither decision needs step-up. That is deliberate in the
   controller: single decisions are the everyday act.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  api, codeOf, isRedactedType, logApiError, MODERATION_LABELS, entityTypeKey, entityTypeName,
} from '@/api'
import { ENTITY_LABEL } from '@/lib/moderation.js'
import { useRoleGate } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_CONSOLE_ROLES, MetaRow, MonoChip, Panel, RedactedText, ScoreBar,
  StaffGateLoading, StaffRefusal, StatusPill, VerdictPill, fmtDateTime, fmtDeadline, fmtMs,
} from '@/components/moderation'
import {
  ActionSheet, Button, ConfirmSheet, Divider, Field, Header, Icon, Screen, ScreenScroll,
  Skeleton, Text, toast, useSheetState,
} from '@/ui'

const FALLBACK_COPY: Record<string, string> = {
  FAIL_CLOSED: 'holds when the model is down',
  FAIL_OPEN_SHADOW: 'publishes when the model is down',
}

export default function CaseScreenGate() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Case" />
  if (gate === 'deny') return <StaffRefusal title="Case" />
  return <CaseScreen />
}

function CaseScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { caseId } = useLocalSearchParams<{ caseId: string }>()

  const [reason, setReason] = React.useState('')
  const [teach, setTeach] = React.useState(false)
  const [writeError, setWriteError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState<'APPROVE' | 'REJECT' | 'RESCORE' | null>(null)
  const menu = useSheetState()
  const confirmReject = useSheetState()

  const detail = useAsync<any>(() => api.moderation.review.get(String(caseId)), {
    enabled: !!caseId,
    deps: [caseId],
  })

  const summary = detail.data?.summary
  const fields: any[] = detail.data?.fields || []
  const thresholds = detail.data?.thresholds
  const bands = thresholds?.bands || {}

  const type = entityTypeName(summary?.entityType)
  const noun = (ENTITY_LABEL as Record<string, string>)[type] ?? type.toLowerCase()
  const redacted = isRedactedType(summary?.entityType)

  /* The deadline counter ticks only while the screen is focused; a backgrounded
     console re-rendering once a second for nothing is a battery bug. */
  const [now, setNow] = React.useState(() => Date.now())
  useFocusEffect(React.useCallback(() => {
    if (!summary?.holdDeadline) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [summary?.holdDeadline]))

  const decide = async (action: 'APPROVE' | 'REJECT') => {
    setBusy(action)
    setWriteError(null)
    /* Optimistic on the pill only — the authoritative row is re-read straight
       after, and the fields never change under a decision. */
    detail.setData((prev: any) => (prev ? { ...prev, summary: { ...prev.summary, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED' } } : prev))
    try {
      await api.moderation.review.decide(String(caseId), {
        action,
        reason: reason.trim() || undefined,
        teachModel: !redacted && teach,
      })
      toast.ok(action === 'APPROVE' ? 'Approved' : 'Rejected')
      await detail.reload()
    } catch (e: any) {
      if (codeOf(e) === 'INVALID_MODERATION_ACTION') logApiError(e, 'POST', `/admin/moderation/review/${caseId}/decide`)
      setWriteError(e)
      await detail.reload()
    } finally {
      setBusy(null)
    }
  }

  const rescore = async () => {
    setBusy('RESCORE')
    setWriteError(null)
    try {
      const res: any = await api.moderation.review.rescore(String(caseId))
      /* 'GONE' is a SYNTHETIC status the enum does not contain — never feed it
         to a status formatter. */
      if (String(res?.status) === 'GONE') {
        toast.warn('The underlying content no longer exists.')
        if (router.canGoBack()) router.back()
        return
      }
      /* A case still inside its hold window comes back PENDING unchanged. That
         is not a failure and must not read like one. */
      toast.ok(`Rescored — ${String(res?.status ?? 'unchanged').toLowerCase().replace(/_/g, ' ')}`)
      await detail.reload()
    } catch (e: any) {
      setWriteError(e)
    } finally {
      setBusy(null)
    }
  }

  if (detail.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Case" />
        <View style={{ padding: space.lg, gap: space.md2 }}>
          <Skeleton height={140} radius={t.radius.md} />
          <Skeleton height={180} radius={t.radius.md} />
          <Skeleton height={180} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (detail.error) {
    const missing = codeOf(detail.error) === 'MODERATION_CASE_NOT_FOUND'
    return (
      <Screen background="sunken">
        <Header back title="Case" />
        <View style={styles.center}>
          <Icon name={missing ? 'search' : 'error'} size={32} color={missing ? c.textFaint : c.danger} />
          <Text variant="title3" align="center" style={{ marginTop: space.md }}>
            {missing ? 'This case no longer exists.' : "Couldn't load this case"}
          </Text>
          {!missing ? (
            <ErrorStrip error={detail.error} onRetry={detail.reload} style={{ marginTop: space.md2, alignSelf: 'stretch' }} />
          ) : null}
          <Button label="Back to queue" onPress={() => router.back()} variant="tinted" style={{ marginTop: space.lg }} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Case"
        actions={[{ icon: 'more', onPress: menu.open, label: 'More' }]}
      />

      <ScreenScroll contentContainerStyle={{ paddingBottom: 200 }}>
        {/* ---- summary ---- */}
        <Panel>
          {summary?.slaBreached ? (
            <View style={[styles.slaBanner, { backgroundColor: c.dangerSoft, borderRadius: t.radius.xs }]}>
              <Icon name="hourglass" size={14} color={c.dangerText} />
              <Text variant="footnote" tone="danger" align="ui">SLA breached</Text>
            </View>
          ) : null}

          <View style={styles.summaryHead}>
            <Text variant="title2" align="ui" style={styles.flex}>{capitalise(noun)}</Text>
            <StatusPill status={summary?.status} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.xs2, marginTop: space.xs2 }}>
            <MonoChip label={String(summary?.reasonCode ?? '')} />
          </View>

          <Divider style={{ marginVertical: space.sm2 }} />

          <MetaRow
            label="Author"
            value={String(summary?.authorId ?? '—')}
            mono
            onPress={summary?.authorId ? () => router.push(`/u/${summary.authorId}` as any) : undefined}
          />
          <MetaRow label="Model version" value={String(summary?.modelVersion ?? '—')} mono />
          <MetaRow label="Submitted" value={fmtDateTime(summary?.submittedAt)} />
          <MetaRow
            label="Hold deadline"
            value={summary?.holdDeadline ? `${fmtDateTime(summary.holdDeadline)} · ${fmtDeadline(summary.holdDeadline, now)}` : '—'}
          />
          {/* NON_NULL: an undecided case has NO decidedAt key at all. */}
          {summary?.decidedAt ? <MetaRow label="Decided" value={fmtDateTime(summary.decidedAt)} /> : null}
          <MetaRow
            label="Prior rejections"
            value={String(summary?.authorPriorRejections ?? 0)}
            tone={Number(summary?.authorPriorRejections) > 0 ? 'danger' : 'default'}
          />
        </Panel>

        {/* ---- redaction gate ---- */}
        {redacted ? (
          <View
            style={[
              styles.gate,
              { backgroundColor: c.warningSoft, borderColor: c.warning, borderRadius: t.radius.md },
            ]}
          >
            <Icon name="lock" size={20} color={c.warningText} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" color={c.warningText} align="ui">Private message</Text>
              <Text variant="footnote" tone="secondary" align="ui" style={{ marginTop: space.xxs }}>
                Chat and live-chat bodies are never shown to staff. Decide from the scores below.
              </Text>
            </View>
          </View>
        ) : null}

        {/* ---- fields ---- */}
        {!fields.length ? (
          <Panel title="Fields">
            <Text variant="callout" tone="muted" align="ui">No text was stored for this case.</Text>
            <View style={{ flexDirection: 'row', marginTop: space.sm }}>
              <MonoChip label={String(summary?.reasonCode ?? 'NO_TEXT')} />
            </View>
          </Panel>
        ) : fields.map((field: any, i: number) => {
          const scores = field?.scores || {}
          const unreadable = Object.keys(scores).length === 0
          return (
            <Panel key={`${field?.fieldName ?? 'field'}:${i}`}>
              <View style={styles.fieldHead}>
                <MonoChip label={String(field?.fieldName ?? '—')} />
                <View style={styles.flex} />
                {field?.blocklistHit ? (
                  <MonoChip label={`keyword: ${field.blocklistHit}`} tone="danger" />
                ) : null}
                <VerdictPill verdict={field?.verdict} size="sm" />
              </View>

              <RedactedText text={field?.text} style={{ marginTop: space.sm2 }} />

              <View style={{ marginTop: space.md }}>
                {unreadable ? (
                  <Text variant="footnote" tone="muted" align="ui">
                    Scores could not be read for this field.
                  </Text>
                ) : (MODERATION_LABELS as string[]).map(label => (
                  <ScoreBar
                    key={label}
                    label={label}
                    score={Number(scores[label] ?? 0)}
                    band={bands?.[label]}
                    emphasised={field?.topLabel === label}
                  />
                ))}
              </View>
            </Panel>
          )
        })}

        {/* ---- thresholds ---- */}
        {thresholds ? (
          <Panel title="Thresholds in force">
            <MetaRow label="Entity type" value={entityTypeKey(thresholds.entityType)} mono />
            <MetaRow label="Hold ceiling" value={fmtMs(thresholds.holdMs)} />
            <MetaRow
              label="Fallback"
              value={`${thresholds.fallback ?? '—'} — ${FALLBACK_COPY[String(thresholds.fallback)] ?? 'unknown policy'}`}
            />
            <Button
              label="Tune these thresholds"
              variant="ghost"
              size="sm"
              style={{ marginStart: -space.md, marginTop: space.xs }}
              onPress={() => router.push({
                pathname: '/admin/moderation/settings',
                params: { entityType: entityTypeKey(thresholds.entityType) },
              })}
            />
          </Panel>
        ) : null}
      </ScreenScroll>

      {/* ---- decision footer ---- */}
      <View
        style={[
          styles.footer,
          { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {writeError ? (
          <ErrorStrip
            error={writeError}
            hint={codeOf(writeError) === 'INVALID_MODERATION_ACTION' ? 'This one is on us — the console sent an action the server does not know.' : undefined}
            style={{ marginBottom: space.sm }}
          />
        ) : null}

        <Field
          value={reason}
          onChangeText={setReason}
          placeholder="Reason (optional, shown in the audit trail)"
          /* Capped client-side because the server answers a field-error
             envelope rather than truncating. */
          maxLength={500}
          containerStyle={{ marginBottom: space.sm }}
        />

        <View style={styles.footerRow}>
          <Button
            label="Teach the model"
            icon={teach && !redacted ? 'checkCircle' : 'add'}
            variant="ghost"
            size="sm"
            disabled={redacted}
            onPress={() => setTeach(v => !v)}
            style={{ flex: 1, justifyContent: 'flex-start' }}
          />
          <Button
            label="Reject"
            onPress={confirmReject.open}
            variant="danger"
            size="md"
            disabled={!!busy}
            loading={busy === 'REJECT'}
          />
          <Button
            label="Approve"
            onPress={() => { void decide('APPROVE') }}
            variant="primary"
            size="md"
            disabled={!!busy}
            loading={busy === 'APPROVE'}
          />
        </View>
        {redacted ? (
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xxs }}>
            Teaching is not available for private messages
          </Text>
        ) : null}
      </View>

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title="Case"
        actions={[
          {
            label: 'Rescore against current thresholds',
            icon: 'refresh',
            onPress: () => { void rescore() },
          },
          {
            label: 'Copy case id',
            icon: 'copy',
            onPress: async () => {
              await Clipboard.setStringAsync(String(caseId))
              toast.ok('Case id copied')
            },
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmReject.visible}
        onClose={confirmReject.close}
        title={`Reject this ${noun}?`}
        message="The author is notified and the content stays hidden."
        confirmLabel="Reject"
        destructive
        loading={busy === 'REJECT'}
        onConfirm={() => { confirmReject.close(); void decide('REJECT') }}
      />
    </Screen>
  )
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  slaBanner: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, padding: space.sm, marginBottom: space.sm2 },
  gate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm2,
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  footer: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
})
