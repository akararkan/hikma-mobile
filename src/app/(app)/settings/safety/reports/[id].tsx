/* =========================================================
   One report — and the only real appeal affordance in the app.

   POST /api/v1/safety/reports/{id}/appeal is reporter-only and
   allowed only from ACTIONED or DISMISSED, which reach the
   client as ACTION_TAKEN / NO_ACTION. Everything else disables
   the button with a sentence saying why, because a button that
   409s is a worse answer than no button.

   There is NO GET /safety/reports/{id}. The list hands the whole
   row over in params so this screen paints instantly; a cold
   deep link falls back to a BOUNDED scan of the first 50 rows
   rather than paging forever after an id that may not exist.

   The appeal is deliberately NOT optimistic. A pill that flips
   to "Appeal under review" and then has to flip back is a lie
   the user cannot undo — the outcome only moves after the 2xx.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, isNotFound } from '@/api'
import { useAsync, useAction } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  CooldownButton, ErrorStrip, OutcomePill, fmtDateTime, reasonLabel, targetNoun,
} from '@/components/moderation'
import {
  Button, ConfirmSheet, Header, Icon, Screen, ScreenScroll, Skeleton, Text, useSheetState,
} from '@/ui'

const APPEALABLE = new Set(['ACTION_TAKEN', 'NO_ACTION'])

/* The reporter is never shown the internal ReportState, so the rail is derived
   from the coarse outcome alone. Inventing intermediate steps would be a guess
   about someone else's moderation record. */
const STEPS = ['Submitted', 'Reviewed', 'Outcome', 'Appeal']

function filledSteps(outcome: string): number {
  if (outcome === 'APPEAL_UNDER_REVIEW') return 4
  if (outcome === 'ACTION_TAKEN' || outcome === 'NO_ACTION') return 3
  return 1
}

export default function ReportDetailScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, row } = useLocalSearchParams<{ id: string; row?: string }>()

  /* Params first: JSON.parse of the row the list passed. A malformed param is
     treated as absent rather than thrown — the fallback scan covers it. */
  const seeded = React.useMemo(() => {
    if (!row) return null
    try { return JSON.parse(String(row)) } catch { return null }
  }, [row])

  const [report, setReport] = React.useState<any>(seeded)
  const [appealError, setAppealError] = React.useState<any>(null)
  const [blocked, setBlocked] = React.useState(false)
  const [cooldown, startCooldown] = useCooldown()
  const confirm = useSheetState()

  const lookup = useAsync<any>(
    async () => {
      const res = await api.settings.safety.myReports({ page: 0, size: 50 })
      return (res?.items || []).find((r: any) => String(r?.id) === String(id)) ?? null
    },
    { enabled: !seeded && !!id, deps: [id] },
  )

  React.useEffect(() => {
    if (lookup.data) setReport(lookup.data)
  }, [lookup.data])

  const refetch = React.useCallback(async () => {
    const res = await api.settings.safety.myReports({ page: 0, size: 50 })
    const fresh = (res?.items || []).find((r: any) => String(r?.id) === String(id))
    if (fresh) setReport(fresh)
  }, [id])

  const appeal = useAction(
    async () => api.settings.safety.appeal(String(id)),
    {
      onSuccess: (res: any) => {
        setAppealError(null)
        /* Read the server's own outcome back; the optimistic fallback only
           applies AFTER a 2xx, when the transition is a fact. */
        setReport((prev: any) => ({ ...(prev || {}), outcome: res?.outcome || 'APPEAL_UNDER_REVIEW' }))
      },
      onError: (e: any) => {
        setAppealError(e)
        startCooldown(e)
        const code = codeOf(e)
        if (code === 'REPORT_NOT_APPEALABLE' || code === 'NOT_REPORTER') {
          setBlocked(true)
          /* The 409 means our copy of the row is stale — re-read it so the
             footer stops offering something the server already refused. */
          if (code === 'REPORT_NOT_APPEALABLE') void refetch().catch(() => {})
        }
      },
    },
  )

  const gone = isNotFound(appealError) || (!seeded && !lookup.loading && !lookup.error && lookup.data === null)

  if (gone) {
    return (
      <Screen background="sunken">
        <Header back title="Report" />
        <View style={styles.center}>
          <Icon name="search" size={32} color={c.textFaint} />
          <Text variant="title3" align="center" style={{ marginTop: space.md }}>This report is no longer available.</Text>
          <Button
            label="Back to reports"
            onPress={() => router.back()}
            variant="tinted"
            style={{ marginTop: space.lg }}
          />
        </View>
      </Screen>
    )
  }

  if (!report && lookup.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Report" />
        <View style={{ padding: space.lg, gap: space.md2, alignItems: 'center' }}>
          <Skeleton width={120} height={22} radius={11} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="40%" height={12} />
          <Skeleton width="100%" height={160} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  const outcome = String(report?.outcome || 'UNDER_REVIEW').toUpperCase()
  const canAppeal = APPEALABLE.has(outcome) && !blocked

  return (
    <Screen background="sunken">
      <Header back title="Report" />
      <ScreenScroll contentContainerStyle={{ paddingBottom: space.xxl }}>
        <View style={styles.head}>
          <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(200))} key={outcome}>
            <OutcomePill outcome={outcome} />
          </Animated.View>
          <Text variant="title3" align="ui" style={{ marginTop: space.sm2 }}>
            {targetNoun(report?.targetType)} · {reasonLabel(report?.reason)}
          </Text>
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs }}>
            Filed {fmtDateTime(report?.createdAt)}
          </Text>
        </View>

        {report?.details ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.md }]}>
            <Text variant="caption" tone="muted" align="ui">WHAT YOU TOLD US</Text>
            <View style={[styles.quote, { borderStartColor: c.border }]}>
              <Text variant="callout" tone="secondary" align="auto">{String(report.details)}</Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.md }]}>
          {STEPS.map((step, i) => {
            const on = i < filledSteps(outcome)
            const last = i === STEPS.length - 1
            return (
              <View key={step} style={styles.railRow}>
                <View style={styles.railGutter}>
                  <View
                    style={[
                      styles.node,
                      on
                        ? { backgroundColor: c.accent, borderColor: c.accent }
                        : { backgroundColor: 'transparent', borderColor: c.borderStrong },
                    ]}
                  />
                  {!last ? <View style={[styles.railLine, { backgroundColor: on ? c.accent : c.border }]} /> : null}
                </View>
                <Text
                  variant="callout"
                  tone={on ? 'default' : 'faint'}
                  align="ui"
                  style={{ paddingBottom: last ? 0 : 16 }}
                >
                  {step}
                </Text>
              </View>
            )
          })}
        </View>

        <View style={[styles.card, { backgroundColor: c.surfaceSunken, borderColor: c.borderFaint, borderRadius: t.radius.md }]}>
          <Text variant="footnote" tone="muted" align="ui">
            What happened to the other account is their private moderation record.
            We can tell you that we acted, never how.
          </Text>
        </View>
      </ScreenScroll>

      <View
        style={[
          styles.footer,
          { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {appealError ? (
          <ErrorStrip
            error={appealError}
            onRetry={
              /* Retry only where retrying can plausibly succeed: never for a
                 refusal the server already made final. */
              blocked || cooldown > 0 ? undefined : () => { void appeal.run() }
            }
            style={{ marginBottom: space.sm2 }}
          />
        ) : null}

        {canAppeal ? (
          <CooldownButton
            label="Appeal this outcome"
            cooldown={cooldown}
            pending={appeal.pending}
            onPress={confirm.open}
          />
        ) : (
          <Text variant="footnote" tone="muted" align="center">
            {outcome === 'APPEAL_UNDER_REVIEW'
              ? 'Your appeal is being reviewed.'
              : blocked
                ? 'This report can no longer be appealed.'
                : 'You can appeal once a decision is made.'}
          </Text>
        )}
      </View>

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Appeal this outcome?"
        message="A person will re-review this report."
        confirmLabel="Appeal"
        icon="flag"
        loading={appeal.pending}
        onConfirm={() => { confirm.close(); void appeal.run() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  head: { alignItems: 'center', paddingHorizontal: space.xxl, paddingTop: space.xl },
  card: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.md2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quote: { borderStartWidth: 3, paddingStart: space.md, marginTop: space.sm },
  railRow: { flexDirection: 'row', gap: space.md },
  railGutter: { width: 14, alignItems: 'center' },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: space.xs },
  railLine: { width: 2, flex: 1, marginVertical: space.xxs },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
