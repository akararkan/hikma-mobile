/* =========================================================
   Moderation health — the ops board.

   Zero is a real answer here. A window with no traffic shows
   0 everywhere plus a line saying so; it never shows an empty
   state, because "nothing happened" and "we could not load
   anything" are different facts and the ops board is exactly
   where confusing them costs an hour.

   Two wire details drive the code:

   · `volume.byEntityType` keys and `sla[].entityType` are
     LOWERCASE while the queue's `entityType` is uppercase.
     Everything goes through entityTypeName before it becomes a
     noun.
   · `windowHours` has NO server-side upper clamp and the
     response ECHOES the raw request value while querying
     max(1, n). The api module floors it, so the echo printed in
     the footer is always true.

   Roles widen to ANALYST here — this is the one moderation
   screen an analyst can open.
   ========================================================= */
import React from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, entityTypeName } from '@/api'
import { ENTITY_LABEL } from '@/lib/moderation.js'
import { useRoleGate } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  MOD_ANALYTICS_ROLES, MetaRow, Mono, Panel, StaffGateLoading, StaffRefusal,
  Tile, WarningBanner,
} from '@/components/moderation'
import {
  Button, Divider, ErrorState, Header, Icon, Screen, ScreenScroll, SegmentedControl,
  Skeleton, Text, Touchable,
} from '@/ui'

const WINDOWS = [
  { value: '1', label: '1h' },
  { value: '24', label: '24h' },
  { value: '168', label: '7d' },
  { value: '720', label: '30d' },
]

export default function MetricsGate() {
  const gate = useRoleGate(MOD_ANALYTICS_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Moderation health" />
  if (gate === 'deny') return <StaffRefusal title="Moderation health" message="The ops board is limited to moderation staff." />
  return <MetricsScreen />
}

function MetricsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const [windowHours, setWindowHours] = React.useState('24')

  const m = useAsync<any>(() => api.moderation.review.metrics({ windowHours: Number(windowHours) }), {
    deps: [windowHours],
  })
  const settings = useAsync<any>(() => api.moderation.settings.get(), { deps: [] })

  /* A 60s poll while the board is on screen; a backgrounded console must not
     keep asking. `useFocusEffect` covers navigation, AppState covers the home
     button — a blurred screen that is still "focused" would poll forever. */
  const refreshRef = React.useRef(m.refresh)
  refreshRef.current = m.refresh
  useFocusEffect(React.useCallback(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void refreshRef.current()
    }, 60_000)
    return () => clearInterval(id)
  }, []))

  const model = m.data?.model || {}
  const queue = m.data?.queue || {}
  const bands = m.data?.bands || {}
  const volume = m.data?.volume || {}
  const labels: any[] = m.data?.labels || []
  const sla: any[] = m.data?.sla || []
  const dataset = m.data?.dataset || {}

  const byType: Record<string, any> = volume.byEntityType || {}
  const idle = !m.loading && !m.error && !Number(volume.submitted)

  if (m.loading && !m.data) {
    return (
      <Screen background="sunken">
        <Header back title="Moderation health" />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={40} radius={t.radius.sm} />
          <Skeleton height={150} radius={t.radius.md} />
          <Skeleton height={90} radius={t.radius.md} />
          <Skeleton height={160} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (m.error && !m.data) {
    return (
      <Screen background="sunken">
        <Header back title="Moderation health" />
        <ErrorState error={m.error} onRetry={m.reload} />
      </Screen>
    )
  }

  const maxLabelCount = Math.max(1, ...labels.map(l => Number(l?.count) || 0))

  return (
    <Screen background="sunken">
      <Header back title="Moderation health" />
      <ScreenScroll refreshing={m.refreshing} onRefresh={m.refresh}>
        <SegmentedControl
          options={WINDOWS}
          value={windowHours}
          onChange={setWindowHours}
          style={{ marginHorizontal: space.lg, marginTop: space.sm2 }}
        />

        {m.data?.enabled === false ? (
          <View style={[styles.masterOff, { backgroundColor: c.dangerSoft, borderRadius: t.radius.xs }]}>
            <Icon name="warning" size={16} color={c.dangerText} />
            <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>
              Automated moderation is off. Only the keyword blocklist is enforced.
            </Text>
          </View>
        ) : null}

        {/* Server copy — verbatim, never paraphrased. */}
        <WarningBanner text={settings.data?.warning} style={{ marginHorizontal: space.lg, marginTop: space.sm2 }} />

        {/* ---- model health ---- */}
        <Panel title="Model">
          <View style={styles.grid}>
            <Tile
              label="Inference"
              value={model.inferenceUp === false ? 'DOWN' : 'UP'}
              tone={model.inferenceUp === false ? 'danger' : 'success'}
            />
            <Tile label="Resident" value={String(model.residentVersion ?? '—')} />
            <Tile label="Circuit" value={String(model.circuitState ?? '—')} tone={model.circuitState === 'OPEN' ? 'danger' : 'neutral'} />
          </View>
          <View style={[styles.grid, { marginTop: space.sm }]}>
            <Tile label="Calls" value={String(model.calls ?? 0)} />
            <Tile label="Failures" value={String(model.failures ?? 0)} tone={Number(model.failures) > 0 ? 'warning' : 'neutral'} />
            <Tile label="Avg latency" value={`${Math.round(Number(model.avgLatencyMs ?? 0))}ms`} />
          </View>

          <Divider style={{ marginVertical: space.sm2 }} />
          <MetaRow
            label="Active version"
            value={`${model.activeVersion ?? '—'}${model.macroF1 != null ? ` · F1 ${Number(model.macroF1).toFixed(2)}` : ''}`}
            mono
          />
          <View style={styles.checkRow}>
            <Icon
              name={model.registryInSync === false ? 'warning' : 'checkCircle'}
              size={15}
              color={model.registryInSync === false ? c.warning : c.success}
            />
            <Text variant="footnote" tone={model.registryInSync === false ? 'warning' : 'muted'} align="ui">
              {model.registryInSync === false ? 'Registry out of sync' : 'Registry in sync'}
            </Text>
          </View>
          {/* Normal, not an incident: the training container only runs on demand. */}
          {model.trainingUp === false ? (
            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
              Training service down
            </Text>
          ) : null}
        </Panel>

        {/* ---- queue ---- */}
        <Panel title="Queue">
          <View style={styles.grid}>
            <Tile label="In review" value={String(queue.inReview ?? 0)} />
            <Tile label="Pending" value={String(queue.pending ?? 0)} />
            <Tile
              label="SLA breached"
              value={String(queue.slaBreached ?? 0)}
              tone={Number(queue.slaBreached) > 0 ? 'danger' : 'neutral'}
              onPress={() => router.push('/admin/moderation')}
            />
          </View>
        </Panel>

        {/* ---- band split ---- */}
        <Panel title="Decision split">
          <Text variant="title2" align="ui">
            {Number(bands.autoDecidedPercent ?? 0).toFixed(1)}% decided automatically
          </Text>
          <StackedBar
            parts={[
              { value: Number(bands.autoApproved ?? 0), color: c.success, label: 'Auto-approved' },
              { value: Number(bands.sentToReview ?? 0), color: c.warning, label: 'Sent to review' },
              { value: Number(bands.autoRejected ?? 0), color: c.danger, label: 'Auto-rejected' },
            ]}
          />
        </Panel>

        {/* ---- volume by type ---- */}
        <Panel title="Volume by type" subtitle={`${Number(volume.submitted ?? 0)} submitted in this window`}>
          <View style={styles.tableHead}>
            <Text variant="micro" tone="faint" align="ui" style={styles.colType}>TYPE</Text>
            <Text variant="micro" tone="faint" align="center" style={styles.col}>APR</Text>
            <Text variant="micro" tone="faint" align="center" style={styles.col}>REJ</Text>
            <Text variant="micro" tone="faint" align="center" style={styles.col}>REV</Text>
            <Text variant="micro" tone="faint" align="center" style={styles.col}>PEND</Text>
          </View>
          {Object.keys(byType).length === 0 ? (
            <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.sm }}>
              No moderation activity in this window.
            </Text>
          ) : Object.entries(byType).map(([key, counts]: [string, any]) => {
            const name = entityTypeName(key)
            return (
              <Touchable
                key={key}
                onPress={() => router.push('/admin/moderation')}
                feedback="tint"
                noAutoHitSlop
                style={styles.tableRow}
              >
                <Text variant="footnote" align="ui" numberOfLines={1} style={styles.colType}>
                  {capitalise((ENTITY_LABEL as Record<string, string>)[name] ?? name.toLowerCase())}
                </Text>
                {/* An idle type comes back as `{}` — render 0, never blank. */}
                <Mono variant="caption" align="center" style={styles.col}>{Number(counts?.APPROVED ?? 0)}</Mono>
                <Mono variant="caption" align="center" style={styles.col}>{Number(counts?.REJECTED ?? 0)}</Mono>
                <Mono variant="caption" align="center" style={styles.col}>{Number(counts?.IN_REVIEW ?? 0)}</Mono>
                <Mono variant="caption" align="center" style={styles.col}>{Number(counts?.PENDING ?? 0)}</Mono>
              </Touchable>
            )
          })}
        </Panel>

        {/* ---- top labels ---- */}
        <Panel title="Top labels">
          {!labels.length ? (
            <Text variant="footnote" tone="muted" align="ui">No labels fired in this window.</Text>
          ) : labels.map((l: any) => (
            <View key={String(l?.label)} style={styles.labelRow}>
              <Mono variant="caption" tone="secondary" align="ui" style={styles.labelName} numberOfLines={1}>
                {String(l?.label ?? '')}
              </Mono>
              <View style={[styles.labelTrack, { backgroundColor: c.surfaceSunken }]}>
                <View
                  style={{
                    width: `${Math.round((Number(l?.count ?? 0) / maxLabelCount) * 100)}%`,
                    height: '100%',
                    backgroundColor: c.accent,
                    borderRadius: 3,
                  }}
                />
              </View>
              <Mono variant="caption" tone="muted" align="right" style={styles.labelCount}>
                {Number(l?.count ?? 0)}
              </Mono>
              <Mono variant="caption" tone="faint" align="right" style={styles.labelScore}>
                {Number(l?.avgScore ?? 0).toFixed(4)}
              </Mono>
            </View>
          ))}
        </Panel>

        {/* ---- SLA ---- */}
        <Panel title="SLA compliance">
          {!sla.length ? (
            <Text variant="footnote" tone="muted" align="ui">Nothing was held in this window.</Text>
          ) : sla.map((s: any) => {
            const name = entityTypeName(s?.entityType)
            const pct = Number(s?.withinSlaPercent ?? 0)
            return (
              <View key={String(s?.entityType)} style={styles.slaRow}>
                <Text variant="footnote" align="ui" style={styles.flex} numberOfLines={1}>
                  {capitalise((ENTITY_LABEL as Record<string, string>)[name] ?? name.toLowerCase())}
                </Text>
                <Text variant="caption" tone="muted" align="ui">
                  {Number(s?.total ?? 0) - Number(s?.breached ?? 0)} of {Number(s?.total ?? 0)} within SLA
                </Text>
                <Mono variant="caption" tone={pct < 99 ? 'danger' : 'muted'} align="right" style={styles.slaPct}>
                  {pct.toFixed(1)}%
                </Mono>
              </View>
            )
          })}
        </Panel>

        {/* ---- dataset ---- */}
        <Panel title="Training data">
          <View style={styles.grid}>
            <Tile label="Examples" value={String(dataset.total ?? 0)} />
            <Tile label="Untrained" value={String(dataset.untrained ?? 0)} />
            <Tile label="Golden" value={String(dataset.golden ?? 0)} />
          </View>
          <Button
            label="Open training data"
            variant="ghost"
            size="sm"
            style={{ marginStart: -space.md, marginTop: space.xs2 }}
            onPress={() => router.push('/admin/moderation/training')}
          />
        </Panel>

        <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.lg, marginBottom: space.sm }}>
          Window: {m.data?.windowHours ?? windowHours}h
          {idle ? ' · no moderation activity in this window' : ''}
        </Text>
      </ScreenScroll>
    </Screen>
  )
}

function StackedBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const t = useTheme()
  const total = parts.reduce((a, p) => a + (Number(p.value) || 0), 0)
  return (
    <View style={{ marginTop: space.sm2 }}>
      <View style={[styles.stack, { backgroundColor: t.colors.surfaceSunken }]}>
        {total > 0
          ? parts.map(p => (
            <View key={p.label} style={{ flex: Math.max(0, Number(p.value) || 0), backgroundColor: p.color }} />
          ))
          : null}
      </View>
      <View style={styles.legend}>
        {parts.map(p => (
          <View key={p.label} style={styles.legendItem}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.color }} />
            <Text variant="micro" tone="muted" align="ui">{p.label} {Number(p.value) || 0}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  masterOff: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginTop: space.sm2, padding: space.sm2 },
  grid: { flexDirection: 'row', gap: space.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs2 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: space.xs2 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  colType: { flex: 1 },
  col: { width: 44 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs2 },
  labelName: { width: 92 },
  labelTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  labelCount: { width: 40 },
  labelScore: { width: 48 },
  slaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs2 },
  slaPct: { width: 52 },
  stack: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
})
