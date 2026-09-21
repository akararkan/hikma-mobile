/* =========================================================
   Decision engine — runtime policy without a redeploy.

   The asymmetries on this surface are real and none of them
   are guessable from the JSON:

   · GET /settings/thresholds with no entityType defaults to
     POST. PUT /settings/thresholds with no entityType means
     GLOBAL. Same endpoint pair, opposite meanings — so the
     "Global" chip reads POST's bands and says so, rather than
     pretending it is showing a global row that cannot be read.
   · putHoldDurations REQUIRES entityType. Omitting it answers
     "Unknown moderation setting key: null", which reads like a
     bug report rather than a form error, so Save stays disabled
     until a type is picked.
   · `inlineMs` is NOT validated on write and IS clamped at read
     to max(100, min(v, max(200, hold/2))). A saved value can
     legitimately differ from the effective one, so the card
     always re-renders from the returned `effective` block and
     names the clamp when the two disagree.
   · An empty threshold patch is 400 INVALID_THRESHOLD, not a
     no-op — refused locally so it never reaches the wire.
   · `overrides` values are ALWAYS strings, even when they mean
     numbers or booleans, and the key namespace is NOT
     validated: a typo becomes a permanent, inert row.

   Six of the writes here need step-up. <StepUpHost/> satisfies
   it globally and the server arms a ~300s window, so saving
   thresholds and then holds costs one password entry.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  api, codeOf, FALLBACK_POLICIES, MODERATED_ENTITY_TYPES, MODERATION_LABELS,
  entityTypeKey, entityTypeName,
} from '@/api'
import { ENTITY_LABEL } from '@/lib/moderation.js'
import { useAuth, useRoleGate, hasRole } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_ADMIN_ROLES, MOD_CONSOLE_ROLES, Mono, MonoChip, Panel,
  StaffGateLoading, StaffRefusal, WarningBanner, fmtMs, isCancelled, withStepUpAction,
} from '@/components/moderation'
import {
  Button, Chip, ChipRail, Divider, Field, Header, Icon, ListRow, Screen, ScreenScroll,
  SegmentedControl, Sheet, Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'

const FALLBACK_COPY: Record<string, string> = {
  FAIL_CLOSED: 'hold content when the model is down',
  FAIL_OPEN_SHADOW: 'publish and flag',
}

type Edge = 'low' | 'high'
type Edits = Record<string, Partial<Record<Edge, string>>>

export default function EngineSettingsGate() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Decision engine" />
  if (gate === 'deny') return <StaffRefusal title="Decision engine" />
  return <EngineSettings />
}

function EngineSettings() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const isAdmin = hasRole(user, MOD_ADMIN_ROLES)
  const params = useLocalSearchParams<{ entityType?: string }>()

  const [entity, setEntity] = React.useState<string>(() => entityTypeName(params.entityType) || 'POST')
  const [edits, setEdits] = React.useState<Edits>({})
  const [thresholdError, setThresholdError] = React.useState<any>(null)
  const [savingBands, setSavingBands] = React.useState(false)

  const settings = useAsync<any>(() => api.moderation.settings.get(), { deps: [] })
  const bands = useAsync<any>(() => api.moderation.settings.thresholds(entity || undefined), { deps: [entity] })

  const effective = settings.data?.effective || {}
  const effectiveType = entity ? (effective.entityTypes || {})[entityTypeKey(entity)] : null

  /* ---- hold card state, seeded from `effective` and re-seeded after a save ---- */
  const [holdMs, setHoldMs] = React.useState('')
  const [inlineMs, setInlineMs] = React.useState('')
  const [fallback, setFallback] = React.useState('FAIL_CLOSED')
  const [enabled, setEnabled] = React.useState(true)
  const [holdError, setHoldError] = React.useState<any>(null)
  const [savingHold, setSavingHold] = React.useState(false)
  const [holdDirty, setHoldDirty] = React.useState(false)

  React.useEffect(() => {
    setHoldMs(effectiveType?.holdMs != null ? String(effectiveType.holdMs) : '')
    setInlineMs(effectiveType?.inlineMs != null ? String(effectiveType.inlineMs) : '')
    setFallback(String(effectiveType?.fallback || 'FAIL_CLOSED').toUpperCase().replace(/-/g, '_'))
    setEnabled(effectiveType?.enabled !== false)
    setHoldDirty(false)
  }, [effectiveType])

  const bandOf = (label: string) => (bands.data?.bands || {})[label] || {}
  const edgeValue = (label: string, edge: Edge) => {
    const edited = edits[label]?.[edge]
    if (edited != null) return edited
    const v = bandOf(label)[edge]
    return v == null ? '' : String(v)
  }

  const setEdge = (label: string, edge: Edge, value: string) => {
    setThresholdError(null)
    setEdits(prev => ({ ...prev, [label]: { ...prev[label], [edge]: value } }))
  }

  const editedCount = Object.values(edits).reduce((n, e) => n + Object.keys(e || {}).length, 0)

  const saveBands = async () => {
    /* An empty patch is 400 INVALID_THRESHOLD server-side, so it is refused
       here with a sentence instead. */
    if (!editedCount) { toast.warn('Change at least one band.'); return }

    const labels: Record<string, Record<string, number>> = {}
    for (const [label, edge] of Object.entries(edits)) {
      const patch: Record<string, number> = {}
      for (const key of ['low', 'high'] as Edge[]) {
        const raw = edge?.[key]
        if (raw == null || raw === '') continue
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          setThresholdError({ code: 'INVALID_THRESHOLD', status: 400, message: `${label} ${key} must be between 0 and 1.` })
          return
        }
        patch[key] = n
      }
      const low = patch.low ?? Number(bandOf(label).low)
      const high = patch.high ?? Number(bandOf(label).high)
      if (Number.isFinite(low) && Number.isFinite(high) && high < low) {
        setThresholdError({ code: 'INVALID_THRESHOLD', status: 400, message: `${label}: high must not be below low.` })
        return
      }
      if (Object.keys(patch).length) labels[label] = patch
    }

    setSavingBands(true)
    setThresholdError(null)
    try {
      /* Absent entityType means GLOBAL here — the opposite of the GET. */
      await withStepUpAction(() => api.moderation.settings.putThresholds({
        entityType: entity || undefined,
        labels,
      }))
      setEdits({})
      toast.ok('Thresholds saved')
      await Promise.all([settings.reload(), bands.reload()])
    } catch (e: any) {
      if (!isCancelled(e)) setThresholdError(e)
    } finally {
      setSavingBands(false)
    }
  }

  const saveHold = async () => {
    if (!entity) return
    setSavingHold(true)
    setHoldError(null)
    try {
      await withStepUpAction(() => api.moderation.settings.putHoldDurations({
        entityType: entity,
        holdMs: holdMs === '' ? undefined : Number(holdMs),
        inlineMs: inlineMs === '' ? undefined : Number(inlineMs),
        fallback,
        enabled,
      }))
      toast.ok('Hold settings saved')
      /* Re-read rather than trusting the input: inlineMs is clamped at read. */
      await settings.reload()
    } catch (e: any) {
      if (!isCancelled(e)) setHoldError(e)
    } finally {
      setSavingHold(false)
    }
  }

  const clampedInline = effectiveType?.inlineMs != null && inlineMs !== '' && Number(inlineMs) !== Number(effectiveType.inlineMs)

  if (settings.loading && !settings.data) {
    return (
      <Screen background="sunken">
        <Header back title="Decision engine" />
        <View style={{ padding: space.lg, gap: space.md }}>
          {/* No radius override: Skeleton falls back to the setback shape. */}
          <Skeleton height={36} />
          <Skeleton height={260} radius={t.radius.md} />
          <Skeleton height={200} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Decision engine" />

      <ChipRail style={{ paddingVertical: space.sm2 }}>
        <Chip
          label="Global"
          selected={!entity}
          size="sm"
          onPress={() => { setEntity(''); setEdits({}) }}
        />
        {(MODERATED_ENTITY_TYPES as string[]).map(key => (
          <Chip
            key={key}
            label={capitalise((ENTITY_LABEL as Record<string, string>)[key] ?? key)}
            selected={entity === key}
            size="sm"
            onPress={() => { setEntity(key); setEdits({}) }}
          />
        ))}
      </ChipRail>

      <ScreenScroll
        refreshing={settings.refreshing}
        onRefresh={() => { void settings.refresh(); void bands.refresh() }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Each card saves itself rather than sharing one footer: the three
            writes are three endpoints with three failure modes, and a single
            "Save changes" that half-succeeds would leave the screen unable to
            say which half. Step-up is still prompted once — the server's
            window covers the run. */}
        {/* Server copy for a 2xx caveat — verbatim. */}
        <WarningBanner text={settings.data?.warning} style={{ marginHorizontal: space.lg, marginTop: space.xs }} />

        {/* ---- thresholds ---- */}
        <Panel
          title="Thresholds"
          subtitle={
            entity
              ? `Bands for ${(ENTITY_LABEL as Record<string, string>)[entity] ?? entity.toLowerCase()}`
              : 'Showing POST bands — the read has no global mode. Saving writes the GLOBAL band.'
          }
        >
          {bands.loading ? (
            <View style={{ gap: space.sm2 }}>
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={44} radius={t.radius.xs} />)}
            </View>
          ) : bands.error ? (
            <ErrorStrip error={bands.error} onRetry={bands.reload} />
          ) : (
            (MODERATION_LABELS as string[]).map(label => (
              <BandRow
                key={label}
                label={label}
                low={edgeValue(label, 'low')}
                high={edgeValue(label, 'high')}
                changed={!!edits[label]}
                onChange={(edge, v) => setEdge(label, edge, v)}
              />
            ))
          )}

          {thresholdError ? <ErrorStrip error={thresholdError} style={{ marginTop: space.sm2 }} /> : null}

          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.sm2 }}>
            low and high are independently optional — only what you change is written.
          </Text>
          <Button
            label={editedCount ? `Save ${editedCount} change${editedCount === 1 ? '' : 's'}` : 'Save thresholds'}
            onPress={saveBands}
            variant="primary"
            size="md"
            block
            disabled={!editedCount || savingBands}
            loading={savingBands}
            style={{ marginTop: space.sm2 }}
          />
        </Panel>

        {/* ---- hold / fallback ---- */}
        <Panel title="Hold and fallback">
          {!entity ? (
            <Text variant="footnote" tone="muted" align="ui">
              Pick a content type — hold settings have no global form.
            </Text>
          ) : (
            <>
              <Field
                label="Hold ceiling (ms)"
                value={holdMs}
                onChangeText={v => { setHoldMs(v.replace(/[^0-9]/g, '')); setHoldDirty(true); setHoldError(null) }}
                keyboardType="number-pad"
                hint={`${fmtMs(Number(holdMs) || 0)} · allowed 500–600000`}
                containerStyle={{ marginBottom: space.md }}
              />
              <Field
                label="Inline budget (ms)"
                value={inlineMs}
                onChangeText={v => { setInlineMs(v.replace(/[^0-9]/g, '')); setHoldDirty(true); setHoldError(null) }}
                keyboardType="number-pad"
                hint={
                  clampedInline
                    ? `Effective: ${effectiveType?.inlineMs}ms (clamped)`
                    : 'Clamped on read to max(100, min(v, max(200, hold/2)))'
                }
                containerStyle={{ marginBottom: space.md }}
              />

              <Text variant="subhead" tone="secondary" align="ui" style={{ marginBottom: space.xs2 }}>Fallback</Text>
              <SegmentedControl
                options={(FALLBACK_POLICIES as string[]).map(p => ({ value: p, label: p === 'FAIL_CLOSED' ? 'Fail closed' : 'Fail open' }))}
                value={fallback}
                onChange={v => { setFallback(v); setHoldDirty(true) }}
              />
              <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
                {fallback} — {FALLBACK_COPY[fallback] ?? 'unknown policy'}
              </Text>

              <ListRow
                title="Enabled for this type"
                flush
                accessory={{ kind: 'switch', value: enabled, onValueChange: v => { setEnabled(v); setHoldDirty(true) } }}
              />

              {holdError ? (
                <ErrorStrip
                  error={holdError}
                  hint={codeOf(holdError) === 'INVALID_MODERATION_SETTING' ? 'Pick a content type first.' : undefined}
                />
              ) : null}

              <Button
                label="Save hold settings"
                onPress={saveHold}
                variant="primary"
                size="md"
                block
                disabled={!holdDirty || savingHold}
                loading={savingHold}
                style={{ marginTop: space.sm2 }}
              />
            </>
          )}
        </Panel>

        <DryRunCard entity={entity} edits={edits} />

        {/* Hidden for MODERATOR rather than letting them retry into a 403. */}
        {isAdmin ? <OverridesCard overrides={settings.data?.overrides || {}} onChanged={() => settings.reload()} /> : null}

        <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.lg2, paddingHorizontal: space.xxl }}>
          Override values are stored as strings and the key namespace is not validated — a typo becomes a
          permanent, inert row.
        </Text>
      </ScreenScroll>
    </Screen>
  )
}

/* ---------------------------------------------------------
   One label's band.

   No dual-thumb slider: the project carries no slider
   dependency, and a hand-rolled gesture thumb on a 0.001-
   precision value is worse than typing it. The preview strip
   below the inputs does the job a slider was for — showing
   where the two edges cut the range.
   --------------------------------------------------------- */
function BandRow({
  label, low, high, changed, onChange,
}: {
  label: string
  low: string
  high: string
  changed: boolean
  onChange: (edge: Edge, v: string) => void
}) {
  const t = useTheme()
  const c = t.colors
  const lowN = Math.max(0, Math.min(1, Number(low) || 0))
  const highN = Math.max(lowN, Math.min(1, Number(high) || 0))

  return (
    <View style={styles.bandRow}>
      <View style={styles.bandHead}>
        <Mono variant="caption" tone="secondary" align="ui" style={styles.flex}>{label}</Mono>
        {changed ? <View style={[styles.dot, { backgroundColor: c.accent }]} /> : null}
      </View>

      <View style={[styles.preview, { backgroundColor: c.surfaceSunken }]}>
        <View style={{ flex: lowN, backgroundColor: c.success }} />
        <View style={{ flex: Math.max(0, highN - lowN), backgroundColor: c.warning }} />
        <View style={{ flex: Math.max(0, 1 - highN), backgroundColor: c.danger }} />
      </View>

      <View style={styles.bandInputs}>
        <Field
          value={low}
          onChangeText={v => onChange('low', v.replace(/[^0-9.]/g, ''))}
          placeholder="low"
          keyboardType="decimal-pad"
          containerStyle={styles.flex}
          minHeight={40}
        />
        <Field
          value={high}
          onChangeText={v => onChange('high', v.replace(/[^0-9.]/g, ''))}
          placeholder="high"
          keyboardType="decimal-pad"
          containerStyle={styles.flex}
          minHeight={40}
        />
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Dry run — "what would this do?"

   No step-up: nothing is written and no model call is made.
   With no ids it evaluates zero fields and returns a confident,
   meaningless zero, so the button stays disabled and says why.
   --------------------------------------------------------- */
function DryRunCard({ entity, edits }: { entity: string; edits: Edits }) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const [ids, setIds] = React.useState<string[]>([])
  const [pasted, setPasted] = React.useState('')
  const [result, setResult] = React.useState<any>(null)
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  const collect = async () => {
    setBusy(true)
    setError(null)
    try {
      const out: string[] = []
      /* Five pages of 100 is the module's 500-id ceiling; asking for more
         throws a plain Error rather than a field-error envelope. */
      for (let page = 0; page < 5 && out.length < 500; page++) {
        const args = { status: 'IN_REVIEW', entityType: entity || undefined, pageSize: 100, page }
        const res = await api.moderation.review.list(args)
        const rows = res?.items || []
        out.push(...rows.map((r: any) => String(r.caseId)))
        if (rows.length < 100) break
      }
      setIds(out.slice(0, 500))
      toast.ok(`Collected ${Math.min(out.length, 500)} case ids`)
    } catch (e: any) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    const merged = [...new Set([...ids, ...pasted.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)])]
    if (!merged.length) return
    setBusy(true)
    setError(null)
    try {
      const labels: Record<string, Record<string, number>> = {}
      for (const [label, edge] of Object.entries(edits)) {
        const patch: Record<string, number> = {}
        for (const key of ['low', 'high'] as Edge[]) {
          const raw = edge?.[key]
          if (raw != null && raw !== '' && Number.isFinite(Number(raw))) patch[key] = Number(raw)
        }
        if (Object.keys(patch).length) labels[label] = patch
      }
      setResult(await api.moderation.settings.dryRun({
        entityType: entity || undefined,
        labels: Object.keys(labels).length ? labels : undefined,
        caseIds: merged,
      }))
    } catch (e: any) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const total = ids.length + pasted.split(/[\s,]+/).filter(Boolean).length
  const changed: any[] = result?.changed || []

  return (
    <Panel title="What would this do?" subtitle="Nothing is written and no model call is made.">
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="Use the current queue page"
          onPress={collect}
          variant="secondary"
          size="sm"
          disabled={busy}
          style={styles.flex}
        />
      </View>
      <Field
        value={pasted}
        onChangeText={setPasted}
        placeholder="…or paste case ids, separated by spaces"
        multiline
        minHeight={64}
        containerStyle={{ marginTop: space.sm2 }}
      />

      {error ? <ErrorStrip error={error} style={{ marginTop: space.sm2 }} /> : null}

      <Button
        label={total ? `Dry run ${total} case${total === 1 ? '' : 's'}` : 'Dry run'}
        onPress={run}
        variant="tinted"
        size="md"
        block
        disabled={!total || busy}
        loading={busy}
        style={{ marginTop: space.sm2 }}
      />
      {!total ? (
        <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs2 }}>
          Select cases first — a dry run with no ids reports a confident zero.
        </Text>
      ) : null}

      {result ? (
        <View style={{ marginTop: space.md }}>
          <Divider style={{ marginBottom: space.sm2 }} />
          <Text variant="subhead" align="ui">
            Evaluated {Number(result.evaluated ?? 0)} fields · {Number(result.unchanged ?? 0)} unchanged · {changed.length} changed
          </Text>
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
            The three numbers need not add up: fields with unreadable scores are counted in neither.
          </Text>
          {changed.map((row: any, i: number) => (
            <Touchable
              key={`${row?.caseId}:${row?.field}:${i}`}
              onPress={() => router.push({ pathname: '/admin/moderation/case/[caseId]', params: { caseId: String(row?.caseId) } })}
              feedback="tint"
              noAutoHitSlop
              style={styles.dryRow}
            >
              <View style={styles.flex}>
                <MonoChip label={String(row?.caseId ?? '')} />
                <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }}>{String(row?.field ?? '')}</Text>
              </View>
              <View style={[styles.transition, { backgroundColor: c.accentSoft, borderRadius: t.radius.xs }]}>
                <Text variant="micro" color={c.accentText}>
                  {String(row?.before ?? '?')} → {String(row?.after ?? '?')}
                </Text>
              </View>
            </Touchable>
          ))}
        </View>
      ) : null}
    </Panel>
  )
}

/* ---------------------------------------------------------
   Raw overrides — ADMIN only, and the only irreversible button
   in the console.
   --------------------------------------------------------- */
function OverridesCard({
  overrides, onChanged,
}: { overrides: Record<string, string>; onChanged: () => void }) {
  const t = useTheme()
  const [key, setKey] = React.useState('')
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)
  const [typed, setTyped] = React.useState('')
  const resetSheet = useSheetState()

  const add = async () => {
    if (!key.trim()) return
    setBusy(true); setError(null)
    try {
      await withStepUpAction(() => api.moderation.settings.rawPut(key.trim().toLowerCase(), value))
      setKey(''); setValue('')
      toast.ok('Override saved')
      onChanged()
    } catch (e: any) {
      if (!isCancelled(e)) setError(e)
    } finally { setBusy(false) }
  }

  const remove = async (k: string) => {
    setBusy(true); setError(null)
    try {
      await withStepUpAction(() => api.moderation.settings.rawDelete(k))
      /* An UNKNOWN key also answers 204, so success is not proof the row
         existed — always re-read. */
      onChanged()
      toast.ok('Override removed')
    } catch (e: any) {
      if (!isCancelled(e)) setError(e)
    } finally { setBusy(false) }
  }

  const resetAll = async () => {
    setBusy(true); setError(null)
    try {
      await withStepUpAction(() => api.moderation.settings.reset())
      resetSheet.close()
      setTyped('')
      toast.ok('Every override dropped')
      onChanged()
    } catch (e: any) {
      if (!isCancelled(e)) setError(e)
    } finally { setBusy(false) }
  }

  const rows = Object.entries(overrides || {})

  return (
    <Panel title="Raw overrides" subtitle="Admin only. Values are always strings.">
      {!rows.length ? (
        <Text variant="footnote" tone="muted" align="ui">No overrides — the engine is on its configured defaults.</Text>
      ) : rows.map(([k, v]) => (
        <View key={k} style={styles.overrideRow}>
          <View style={styles.flex}>
            <Mono variant="caption" tone="secondary" align="ui" numberOfLines={1}>{k}</Mono>
            <Mono variant="footnote" align="ui" numberOfLines={1}>{String(v)}</Mono>
          </View>
          <Touchable onPress={() => remove(k)} disabled={busy} feedback="dim" accessibilityLabel={`Delete ${k}`}>
            <Icon name="trash" size={17} color={t.colors.danger} />
          </Touchable>
        </View>
      ))}

      <Divider style={{ marginVertical: space.md }} />

      <View style={{ gap: space.sm }}>
        <Field value={key} onChangeText={setKey} placeholder="setting.key" autoCapitalize="none" autoCorrect={false} minHeight={44} />
        <Field value={value} onChangeText={setValue} placeholder="value" autoCapitalize="none" autoCorrect={false} minHeight={44} />
        <Button label="Add override" onPress={add} variant="secondary" size="md" block disabled={!key.trim() || busy} />
      </View>

      {error ? <ErrorStrip error={error} style={{ marginTop: space.sm2 }} /> : null}

      <Button
        label="Reset all overrides"
        onPress={resetSheet.open}
        variant="danger"
        size="md"
        block
        style={{ marginTop: space.md2 }}
      />

      <Sheet
        visible={resetSheet.visible}
        onClose={() => { resetSheet.close(); setTyped('') }}
        title="Reset all overrides"
        subtitle="This drops every override and is irreversible."
        footer={
          <Button
            label="Reset everything"
            onPress={resetAll}
            variant="danger"
            size="lg"
            block
            loading={busy}
            disabled={typed.trim().toUpperCase() !== 'RESET'}
          />
        }
      >
        <View style={{ padding: space.xl, gap: space.sm2 }}>
          <Text variant="callout" tone="secondary" align="ui">
            The whole engine falls back to configuration defaults. There is no undo endpoint.
          </Text>
          <Field
            label="Type RESET to confirm"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
      </Sheet>
    </Panel>
  )
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bandRow: { paddingVertical: space.sm },
  bandHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  preview: { flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: space.xs2 },
  bandInputs: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  dryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm },
  transition: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  overrideRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm },
})
