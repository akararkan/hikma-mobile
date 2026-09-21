/* =========================================================
   Classifier — the model registry and its lifecycle.

   Role note: `model.versions` is ADMIN | ANALYST and NOT
   moderator, who gets a 403 here while being allowed everywhere
   else on that controller. The queue's overflow menu still
   lists this screen, so the gate has to be real rather than
   decorative.

   Three lifecycle truths worth more than the layout:

   · `retrain` answers 202 with a PLACEHOLDER row whose version
     is `job-{jobId}`. It is a receipt, not a model — the card
     says so instead of showing a version that will never train.
   · `promote` reloads the container BEFORE flipping the
     registry, so INFERENCE_UNAVAILABLE means nothing changed.
     That reassurance is client copy and it matters: without it
     an admin re-promotes into an outage.
   · `shadow` has NO server-side status precondition. Any
     version can be forced to SHADOW, including a FAILED one —
     so the guard lives here or nowhere.

   `retrainRefresh` returns how many jobs settled ON THIS CALL:
   0 means "nothing new", not "nothing running".
   ========================================================= */
import React from 'react'
import { AppState, RefreshControl, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, errorText } from '@/api'
import { useAuth, useRoleGate, hasRole } from '@/context/AuthContext'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, HealthDot, MOD_ADMIN_ROLES, MOD_MODEL_ROLES, MetaRow, Mono, Panel,
  StaffGateLoading, StaffRefusal, VersionStatusPill, fmtDateTime, isCancelled, withStepUpAction,
} from '@/components/moderation'
import {
  Button, ConfirmSheet, Divider, EmptyState, ErrorState, Field, Header, Icon, ListFooter,
  Screen, ScreenScroll, Sheet, Skeleton, Text, toast, useSheetState,
} from '@/ui'

const LIVE_STATUSES = new Set(['TRAINING', 'EVALUATING'])

export default function ModelGate() {
  const gate = useRoleGate(MOD_MODEL_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Classifier" />
  if (gate === 'deny') {
    return (
      <StaffRefusal
        title="Classifier"
        message="The model registry is limited to admins and analysts."
      />
    )
  }
  return <ModelScreen />
}

function ModelScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const isAdmin = hasRole(user, MOD_ADMIN_ROLES)

  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [gateFailure, setGateFailure] = React.useState<{ id: string; message: string } | null>(null)

  const retrainSheet = useSheetState()
  const rollbackConfirm = useSheetState()
  const shadowConfirm = useSheetState<{ id: string; version: string }>()
  const promoteConfirm = useSheetState<{ id: string; version: string }>()

  const [baseVersion, setBaseVersion] = React.useState('')
  const [notes, setNotes] = React.useState('')

  const list = usePaged<any>(
    ({ page, pageSize, signal }) => {
      /* Assembled as a variable: the api module is JS and its inferred
         parameter type drops every field that carries no default. */
      const args = { page, pageSize, signal }
      return api.moderation.model.versions(args)
    },
    /* Default pageSize is 20 here, not 50 — the versions endpoint echoes no
       paging at all, so the caller owns the cursor. */
    { mode: 'page', pageSize: 20, keyOf: r => String(r?.id ?? r?.version ?? ''), deps: [] },
  )

  const health = list.extra?.health || {}
  const items: any[] = list.items
  const active = items.find(v => String(v?.status).toUpperCase() === 'ACTIVE')
  const training = items.some(v => LIVE_STATUSES.has(String(v?.status).toUpperCase()))

  /* Poll only while something is actually moving, and only in the foreground:
     a console left open on a finished run must not keep the endpoint warm. */
  const refreshRef = React.useRef(list.refresh)
  refreshRef.current = list.refresh
  useFocusEffect(React.useCallback(() => {
    if (!training) return
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void refreshRef.current()
    }, 15_000)
    return () => clearInterval(id)
  }, [training]))

  const run = async (key: string, fn: () => Promise<any>, okMessage?: string) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      if (okMessage) toast.ok(okMessage)
      await list.refresh()
    } catch (e: any) {
      if (isCancelled(e)) return
      if (codeOf(e) === 'MODEL_GATE_FAILED') return   // handled by its own confirmation
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const promote = async (id: string, force: boolean) => {
    setBusy(`promote:${id}`)
    setError(null)
    try {
      await withStepUpAction(() => api.moderation.model.promote(id, { force }))
      toast.ok('Promoted')
      setGateFailure(null)
      await list.refresh()
    } catch (e: any) {
      if (isCancelled(e)) return
      /* The ONLY path to force: true is this deliberate second confirmation. */
      if (codeOf(e) === 'MODEL_GATE_FAILED') setGateFailure({ id, message: errorText(e) })
      else setError(e)
    } finally {
      setBusy(null)
    }
  }

  const code = codeOf(error)

  if (list.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Classifier" />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={44} radius={t.radius.sm} />
          <Skeleton height={150} radius={t.radius.md} />
          <Skeleton height={130} radius={t.radius.md} />
          <Skeleton height={130} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (list.error && !items.length) {
    return (
      <Screen background="sunken">
        <Header back title="Classifier" />
        <ErrorState error={list.error} onRetry={list.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Classifier"
        actions={isAdmin ? [{
          icon: 'refresh',
          label: 'Refresh jobs',
          onPress: () => void run('jobs', async () => {
            const res: any = await api.moderation.model.retrainRefresh()
            const n = Number(res?.settled ?? 0)
            /* 0 settled means nothing NEW finished — say that, not "no jobs". */
            toast.info(n ? `${n} job${n === 1 ? '' : 's'} settled` : 'No jobs settled on this call')
          }),
        }] : []}
      />

      <ScreenScroll
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
      >
        {/* ---- health strip ---- */}
        <View style={[styles.health, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.md }]}>
          <HealthDot up={health.inferenceUp !== false} label={health.inferenceUp === false ? 'Inference down' : 'Inference up'} />
          <Mono variant="caption" tone="muted" align="ui">{String(health.residentVersion ?? '—')}</Mono>
          <View style={styles.flex} />
          <Text variant="caption" tone="muted" align="ui">{String(health.circuitState ?? '—')}</Text>
          <Text variant="caption" tone="muted" align="ui">{Math.round(Number(health.avgLatencyMs ?? 0))}ms</Text>
        </View>
        <View style={styles.healthNotes}>
          <HealthDot
            up={health.registryInSync !== false}
            label={health.registryInSync === false ? 'Registry out of sync' : 'Registry in sync'}
          />
          {/* Normal state, not an incident. */}
          {health.trainingUp === false ? (
            <Text variant="caption" tone="faint" align="ui">Training service down</Text>
          ) : null}
        </View>

        {error ? (
          <ErrorStrip
            error={error}
            hint={
              code === 'INFERENCE_UNAVAILABLE' ? 'Nothing was changed.'
                : code === 'MODEL_VERSION_NOT_FOUND' ? 'Nothing to roll back to.'
                  : code === 'TRAINING_ALREADY_RUNNING' ? 'The list polls itself while a run is in flight.'
                    : undefined
            }
            action={
              code === 'TRAINING_DATASET_TOO_SMALL'
                ? { label: 'Add training examples', onPress: () => router.push('/admin/moderation/training') }
                : undefined
            }
            onRetry={code === 'TRAINING_SERVICE_UNAVAILABLE' ? () => setError(null) : undefined}
            retryLabel="Dismiss"
            style={{ marginHorizontal: space.lg, marginTop: space.md }}
          />
        ) : null}

        {/* ---- active version ---- */}
        {active ? (
          <Panel title="Active version">
            <Mono variant="title2" align="ui">{String(active.version)}</Mono>
            <View style={{ marginTop: space.sm }}>
              <MetaRow label="Macro F1" value={active.macroF1 != null ? Number(active.macroF1).toFixed(3) : '—'} mono />
              <MetaRow label="Examples" value={`${active.trainingExamples ?? 0} train · ${active.validationCount ?? 0} val`} />
              <MetaRow label="Promoted" value={fmtDateTime(active.promotedAt)} />
            </View>
            {active.notes ? (
              <Text variant="footnote" tone="secondary" align="auto" style={{ marginTop: space.sm }}>{String(active.notes)}</Text>
            ) : null}
          </Panel>
        ) : null}

        {/* ---- versions ---- */}
        {!items.length ? (
          <EmptyState
            icon="robot"
            title="No model versions yet"
            message="Nothing has been trained on this deployment."
            actionLabel={isAdmin ? 'Start a retrain' : undefined}
            onAction={retrainSheet.open}
          />
        ) : items.map(v => (
          <VersionCard
            key={String(v?.id ?? v?.version)}
            version={v}
            isAdmin={isAdmin}
            busy={busy}
            onShadow={() => shadowConfirm.open({ id: String(v.id), version: String(v.version) })}
            onPromote={() => promoteConfirm.open({ id: String(v.id), version: String(v.version) })}
          />
        ))}

        {items.length ? (
          <ListFooter
            loading={list.loadingMore}
            error={list.items.length ? list.error : null}
            onRetry={list.loadMore}
            done={list.done}
            doneLabel={`${list.extra?.totalElements ?? items.length} version(s)`}
          />
        ) : null}

        {isAdmin ? (
          <View style={styles.bottomActions}>
            <Button
              label="Retrain"
              icon="robot"
              variant="primary"
              size="lg"
              style={styles.flex}
              disabled={training || busy != null}
              onPress={() => { setBaseVersion(String(active?.version ?? '')); retrainSheet.open() }}
            />
            <Button
              label="Roll back"
              variant="danger"
              size="lg"
              style={styles.flex}
              disabled={busy != null}
              onPress={rollbackConfirm.open}
            />
          </View>
        ) : null}
        {training ? (
          <Text variant="caption" tone="muted" align="center" style={{ marginTop: space.sm }}>
            A training run is in progress — this list refreshes itself every 15 seconds.
          </Text>
        ) : null}
      </ScreenScroll>

      {/* ---- sheets ---- */}
      <Sheet
        visible={retrainSheet.visible}
        onClose={retrainSheet.close}
        title="Start a retrain"
        subtitle="Answers 202 with a receipt, not a model."
        footer={
          <Button
            label="Start"
            variant="primary"
            size="lg"
            block
            loading={busy === 'retrain'}
            onPress={() => {
              retrainSheet.close()
              void run('retrain', () => withStepUpAction(() => api.moderation.model.retrain({
                baseVersion: baseVersion.trim() || undefined,
                notes: notes.trim() || undefined,
              })), 'Training started')
            }}
          />
        }
      >
        <View style={{ padding: space.xl, gap: space.md }}>
          <Field
            label="Base version"
            value={baseVersion}
            onChangeText={setBaseVersion}
            placeholder="Defaults to the active version"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Why this run?" />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={rollbackConfirm.visible}
        onClose={rollbackConfirm.close}
        title="Roll back the classifier?"
        message="The most recently retired version is re-promoted with force."
        confirmLabel="Roll back"
        destructive
        loading={busy === 'rollback'}
        onConfirm={() => {
          rollbackConfirm.close()
          void run('rollback', () => withStepUpAction(() => api.moderation.model.rollback()), 'Rolled back')
        }}
      />

      <ConfirmSheet
        visible={shadowConfirm.visible}
        onClose={shadowConfirm.close}
        title={`Run ${shadowConfirm.payload?.version ?? ''} in shadow?`}
        message="It is scored alongside the active model and never enforced."
        confirmLabel="Shadow"
        loading={busy?.startsWith('shadow') ?? false}
        onConfirm={() => {
          const id = shadowConfirm.payload?.id
          shadowConfirm.close()
          if (id) void run(`shadow:${id}`, () => api.moderation.model.shadow(id), 'Running in shadow')
        }}
      />

      <ConfirmSheet
        visible={promoteConfirm.visible}
        onClose={promoteConfirm.close}
        title={`Promote ${promoteConfirm.payload?.version ?? ''}?`}
        message="It becomes the model every check runs against."
        confirmLabel="Promote"
        loading={busy?.startsWith('promote') ?? false}
        onConfirm={() => {
          const id = promoteConfirm.payload?.id
          promoteConfirm.close()
          if (id) void promote(id, false)
        }}
      />

      <ConfirmSheet
        visible={!!gateFailure}
        onClose={() => setGateFailure(null)}
        title="This version failed the promotion gate"
        message={gateFailure?.message}
        confirmLabel="Promote anyway"
        cancelLabel="Cancel"
        destructive
        icon="warning"
        loading={busy?.startsWith('promote') ?? false}
        onConfirm={() => {
          const id = gateFailure?.id
          setGateFailure(null)
          /* force: true is recorded in the audit trail. It is never the default
             path — this is the second, deliberate tap. */
          if (id) void promote(id, true)
        }}
      />
    </Screen>
  )
}

function VersionCard({
  version, isAdmin, busy, onShadow, onPromote,
}: {
  version: any
  isAdmin: boolean
  busy: string | null
  onShadow: () => void
  onPromote: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const status = String(version?.status ?? '').toUpperCase()
  const receipt = /^job-/.test(String(version?.version ?? '')) && status === 'TRAINING'
  const promotable = ['READY', 'SHADOW', 'RETIRED'].includes(status)
  const shadowable = !['FAILED', 'ACTIVE'].includes(status)

  return (
    <Panel>
      <View style={styles.cardHead}>
        <Mono variant="bodyStrong" align="ui" style={styles.flex} numberOfLines={1}>{String(version?.version ?? '—')}</Mono>
        <VersionStatusPill status={status} />
      </View>

      {receipt ? (
        <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs2 }}>
          This is a receipt, not a model yet — poll for the real row.
        </Text>
      ) : null}

      <View style={{ marginTop: space.sm }}>
        <MetaRow label="Base" value={String(version?.baseCheckpoint ?? '—')} mono />
        <MetaRow label="Examples" value={`${version?.trainingExamples ?? 0} train · ${version?.validationCount ?? 0} val`} />
        <MetaRow label="Macro F1" value={version?.macroF1 != null ? Number(version.macroF1).toFixed(3) : '—'} mono />
        <MetaRow
          label="Gate"
          value={
            <View style={styles.gateRow}>
              <Icon
                name={version?.gatePassed === false ? 'close' : 'check'}
                size={14}
                color={version?.gatePassed === false ? c.danger : c.success}
              />
              <Text variant="footnote" tone="secondary" align="ui" style={styles.flex}>
                {String(version?.gateDetail ?? (version?.gatePassed === false ? 'Failed' : 'Passed'))}
              </Text>
            </View>
          }
        />
        <MetaRow label="Trained" value={fmtDateTime(version?.trainedAt)} />
        {version?.completedAt ? <MetaRow label="Completed" value={fmtDateTime(version.completedAt)} /> : null}
      </View>

      {/* The trainer's own message — rendered verbatim, it is the only account
          of why a run failed. */}
      {version?.error ? (
        <View style={[styles.errorBlock, { backgroundColor: c.dangerSoft, borderRadius: t.radius.xs }]}>
          <Text variant="caption" tone="danger" align="auto">{String(version.error)}</Text>
        </View>
      ) : null}

      {version?.notes ? (
        <Text variant="caption" tone="muted" align="auto" style={{ marginTop: space.sm }}>{String(version.notes)}</Text>
      ) : null}

      {isAdmin && (promotable || shadowable) ? (
        <>
          <Divider style={{ marginVertical: space.sm2 }} />
          <View style={styles.actions}>
            {shadowable ? (
              <Button label="Shadow" onPress={onShadow} variant="secondary" size="sm" disabled={busy != null} />
            ) : null}
            {promotable ? (
              <Button label="Promote" onPress={onPromote} variant="tinted" size="sm" disabled={busy != null} />
            ) : null}
          </View>
          {status === 'FAILED' ? (
            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
              A failed version cannot be shadowed.
            </Text>
          ) : null}
        </>
      ) : null}
    </Panel>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  health: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  healthNotes: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.xs2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  errorBlock: { padding: space.sm, marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' },
  bottomActions: { flexDirection: 'row', gap: space.sm2, marginHorizontal: space.lg, marginTop: space.xl },
})
