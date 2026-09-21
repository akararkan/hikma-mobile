/* =========================================================
   Training data — teach the classifier.

   Label keys are the sharpest edge here. The training-example
   writer reads `labels.get(wire)` DIRECTLY: an alias like
   `identity_attack` (which the threshold endpoints do accept)
   silently stores 0. Everything goes through `labelsTo()`,
   which coerces a selection into the exact six wire keys.

   Golden cases are the one place request and response disagree:
   you POST `identity_hate` and the raw entity comes back with
   `identityHate` and no `labels` key at all — hence
   `goldenLabelsOf()` on the read side.

   Two more shapes worth stating out loud:
   · A repeat submission is an EDIT, not a duplicate. Dedup is a
     normalised SHA-256, so re-posting a sentence updates its
     labels and resets trainedInVersion.
   · The golden list is a BARE ARRAY with no total, so "is there
     another page?" can only be inferred from a full page.

   There is deliberately NO CSV import: the client module
   exposes no import method, and offering one that cannot work
   is worse than the endpoint not existing.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  api, MODERATION_LABELS, TRAINING_SOURCES, goldenLabelsOf, labelsTo,
} from '@/api'
import { useAuth, useRoleGate, hasRole } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_ADMIN_ROLES, MOD_CONSOLE_ROLES, Mono, MonoChip, Panel, ScoreBar,
  StaffGateLoading, StaffRefusal, Tile,
} from '@/components/moderation'
import {
  ActionSheet, Button, Chip, ChipRail, Divider, EmptyState, ErrorState, Field, Header, Icon,
  ListFooter, Screen, ScreenScroll, SegmentedControl, Sheet, Skeleton, Text, Touchable,
  toast, useSheetState,
} from '@/ui'

type Tab = 'examples' | 'golden' | 'probe'

const TABS: { value: Tab; label: string }[] = [
  { value: 'examples', label: 'Examples' },
  { value: 'golden', label: 'Golden' },
  { value: 'probe', label: 'Probe' },
]

const keyExtractor = (item: any) => String(item?.id ?? '')

export default function TrainingGate() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Training data" />
  if (gate === 'deny') return <StaffRefusal title="Training data" />
  return <TrainingScreen />
}

function TrainingScreen() {
  const t = useTheme()
  const [tab, setTab] = React.useState<Tab>('examples')

  return (
    <Screen background="sunken">
      <Header back title="Training data" />
      <SegmentedControl
        options={TABS}
        value={tab}
        onChange={setTab}
        style={{ marginHorizontal: space.lg, marginVertical: space.sm2 }}
      />
      {tab === 'examples' ? <ExamplesTab /> : tab === 'golden' ? <GoldenTab /> : <ProbeTab />}
    </Screen>
  )
}

/* ---------------------------------------------------------
   Examples
   --------------------------------------------------------- */

function ExamplesTab() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const isAdmin = hasRole(user, MOD_ADMIN_ROLES)

  const [source, setSource] = React.useState('')
  const addSheet = useSheetState<{ mode: 'example' | 'word' }>()
  const fab = useSheetState()

  const list = usePaged<any>(
    ({ page, pageSize, signal }) => {
      /* Assembled as a variable: the api module is JS and its inferred
         parameter type drops every field that carries no default. */
      const args = { source: source || undefined, page, pageSize, signal }
      return api.moderation.model.trainingExamples(args)
    },
    { mode: 'page', pageSize: 50, keyOf: r => String(r?.id ?? ''), deps: [source] },
  )

  const summary = list.extra?.summary || {}

  const remove = useEvent(async (row: any) => {
    const id = String(row?.id ?? '')
    list.remove(id)
    try {
      await api.moderation.model.removeTrainingExample(id)
      /* 204 even for an unknown id (Spring Data's deleteById is a no-op), so
         204 is never proof — the undo re-adds through the writer instead. */
      toast.ok('Example removed', {
        label: 'Undo',
        onPress: async () => {
          try {
            await api.moderation.model.addTrainingExample({
              text: row?.text, labels: row?.labels, note: row?.note,
            })
            await list.refresh()
          } catch { toast.error('Could not restore that example.') }
        },
      })
    } catch {
      await list.refresh()
      toast.error('Could not remove that example.')
    }
  })

  /* Hooks live above the early returns. renderItem is useCallback-stable and
     `remove` is row-first, so one function serves every cell — FlashList's
     ViewHolder memo compares renderItem BY IDENTITY. */
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <ExampleRow row={item} canDelete={isAdmin} onDelete={remove} />,
    [isAdmin, remove],
  )

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 100 }),
    [insets.bottom],
  )

  /* Three tiles and a chip rail — a fresh element identity would rebuild the
     whole band on every list render. */
  const listHeader = React.useMemo(() => (
    <View>
      <View style={styles.summary}>
        <Tile label="Total" value={String(summary.total ?? 0)} />
        <Tile label="Untrained" value={String(summary.untrained ?? 0)} />
        <Tile label="Golden" value={String(summary.golden ?? 0)} />
      </View>
      <ChipRail style={{ paddingVertical: space.sm2 }}>
        <Chip label="All sources" selected={!source} size="sm" onPress={() => setSource('')} />
        {(TRAINING_SOURCES as string[]).map(s => (
          <Chip
            key={s}
            label={s.toLowerCase().replace(/_/g, ' ')}
            selected={source === s}
            size="sm"
            onPress={() => setSource(s)}
          />
        ))}
      </ChipRail>
    </View>
  ), [summary.total, summary.untrained, summary.golden, source])

  if (list.loading) {
    return (
      <View style={{ padding: space.lg, gap: space.md2 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ gap: space.sm }}>
            <Skeleton width="88%" height={13} />
            <Skeleton width="56%" height={11} />
          </View>
        ))}
      </View>
    )
  }

  if (list.error && !list.items.length) {
    return <ErrorState error={list.error} onRetry={list.reload} />
  }

  return (
    <View style={styles.flex}>
      <FlashList
        data={list.items}
        keyExtractor={keyExtractor}
        contentContainerStyle={contentStyle}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={listHeader}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            icon="library"
            title="No examples yet"
            message="Nothing has been labelled for this source."
            actionLabel="Add one"
            onAction={() => addSheet.open({ mode: 'example' })}
          />
        }
        ListFooterComponent={
          list.items.length ? (
            <ListFooter
              loading={list.loadingMore}
              error={list.items.length ? list.error : null}
              onRetry={list.loadMore}
              done={list.done}
              doneLabel={`${list.extra?.totalElements ?? list.items.length} example(s)`}
            />
          ) : null
        }
      />

      <Button
        label="Add"
        icon="add"
        variant="primary"
        size="lg"
        onPress={fab.open}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      />

      <ActionSheet
        visible={fab.visible}
        onClose={fab.close}
        title="Add"
        actions={[
          { label: 'Add example', icon: 'edit', onPress: () => addSheet.open({ mode: 'example' }) },
          { label: 'Add word', icon: 'hash', onPress: () => addSheet.open({ mode: 'word' }) },
        ]}
      />

      <LabelledTextSheet
        visible={addSheet.visible}
        onClose={addSheet.close}
        mode={addSheet.payload?.mode ?? 'example'}
        onSaved={() => { addSheet.close(); void list.refresh() }}
      />
    </View>
  )
}

/* Memoized, with a ROW-FIRST `onDelete` so one function serves every cell. */
const ExampleRow = React.memo(function ExampleRow({
  row, canDelete, onDelete,
}: { row: any; canDelete: boolean; onDelete: (row: any) => void }) {
  const t = useTheme()
  const c = t.colors
  /* `labels` always carries all six wire keys as 0/1 — no defaulting needed,
     but read defensively anyway since one bad row must not blank the list. */
  const labels = row?.labels || {}

  return (
    <View style={[styles.row, { backgroundColor: c.bg, borderBottomColor: c.separator }]}>
      <View style={styles.flex}>
        <Text variant="footnote" align="auto" numberOfLines={3}>{String(row?.text ?? '')}</Text>
        <View style={styles.labelWrap}>
          {(MODERATION_LABELS as string[]).map(label => (
            <View
              key={label}
              style={[
                styles.tinyChip,
                {
                  backgroundColor: labels[label] ? c.dangerSoft : c.surfaceSunken,
                  borderRadius: t.radius.xs,
                },
              ]}
            >
              <Mono variant="micro" color={labels[label] ? c.dangerText : c.textFaint}>
                {label.slice(0, 3)}
              </Mono>
            </View>
          ))}
        </View>
        <View style={styles.metaWrap}>
          <MonoChip label={String(row?.source ?? '—').toLowerCase()} />
          <Text variant="micro" tone="faint" align="ui">
            {row?.trainedInVersion ? String(row.trainedInVersion) : 'untrained'}
          </Text>
        </View>
      </View>
      {canDelete ? (
        <Touchable onPress={() => onDelete(row)} feedback="dim" accessibilityLabel="Delete example">
          <Icon name="trash" size={17} color={c.danger} />
        </Touchable>
      ) : null}
    </View>
  )
})

/* ---------------------------------------------------------
   Golden set
   --------------------------------------------------------- */

function GoldenTab() {
  const t = useTheme()
  const c = t.colors
  const { user } = useAuth()
  const isAdmin = hasRole(user, MOD_ADMIN_ROLES)
  const PAGE = 50

  const [page, setPage] = React.useState(0)
  const [rows, setRows] = React.useState<any[]>([])
  const addSheet = useSheetState<{ mode: 'golden' }>()

  const load = useAsync<any[]>(
    async () => (await api.moderation.model.goldenCases({ page, pageSize: PAGE })) || [],
    { deps: [page] },
  )

  React.useEffect(() => {
    if (!load.data) return
    setRows(prev => (page === 0 ? load.data! : [...prev, ...load.data!]))
  }, [load.data, page])

  const remove = async (row: any) => {
    const id = String(row?.id ?? '')
    setRows(prev => prev.filter(r => String(r?.id) !== id))
    try {
      await api.moderation.model.removeGoldenCase(id)
      toast.ok('Golden case removed')
    } catch {
      toast.error('Could not remove that case.')
      setPage(0)
      await load.reload()
    }
  }

  if (load.loading && !rows.length) {
    return (
      <View style={{ padding: space.lg, gap: space.md2 }}>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={54} radius={t.radius.sm} />)}
      </View>
    )
  }

  if (load.error && !rows.length) return <ErrorState error={load.error} onRetry={load.reload} />

  return (
    <ScreenScroll>
      <Text variant="footnote" tone="muted" align="ui" style={styles.caption}>
        The regression suite the promotion gate scores against. Never trained on.
      </Text>

      {!rows.length ? (
        <EmptyState
          icon="star"
          title="No golden cases"
          message="Add the sentences a new model must never get wrong."
          actionLabel={isAdmin ? 'Add golden case' : undefined}
          onAction={() => addSheet.open({ mode: 'golden' })}
        />
      ) : rows.map((row: any, i: number) => {
        /* camelCase columns and no `labels` key at all — normalise on read. */
        const labels = goldenLabelsOf(row) as Record<string, number>
        return (
          <View
            key={String(row?.id ?? i)}
            style={[styles.goldenRow, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.sm }]}
          >
            <View style={styles.flex}>
              <Text variant="footnote" align="auto" numberOfLines={3}>{String(row?.text ?? '')}</Text>
              <View style={styles.labelWrap}>
                {(MODERATION_LABELS as string[]).map(label => (
                  <View
                    key={label}
                    style={[
                      styles.tinyChip,
                      { backgroundColor: labels[label] ? c.dangerSoft : c.surfaceSunken, borderRadius: t.radius.xs },
                    ]}
                  >
                    <Mono variant="micro" color={labels[label] ? c.dangerText : c.textFaint}>{label.slice(0, 3)}</Mono>
                  </View>
                ))}
              </View>
            </View>
            {isAdmin ? (
              <Touchable onPress={() => remove(row)} feedback="dim" accessibilityLabel="Delete golden case">
                <Icon name="trash" size={17} color={c.danger} />
              </Touchable>
            ) : null}
          </View>
        )
      })}

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md2, gap: space.sm2 }}>
        <Text variant="caption" tone="faint" align="center">Showing {rows.length}</Text>
        {/* No total on the wire: a full page is the only signal another may exist. */}
        {load.data && load.data.length === PAGE ? (
          <Button label="Load more" onPress={() => setPage(p => p + 1)} variant="secondary" size="md" block loading={load.loading} />
        ) : null}
        {isAdmin ? (
          <Button label="Add golden case" icon="add" variant="primary" size="md" block onPress={() => addSheet.open({ mode: 'golden' })} />
        ) : null}
      </View>

      <LabelledTextSheet
        visible={addSheet.visible}
        onClose={addSheet.close}
        mode="golden"
        onSaved={() => { addSheet.close(); setPage(0); void load.reload() }}
      />
    </ScreenScroll>
  )
}

/* ---------------------------------------------------------
   Probe
   --------------------------------------------------------- */

function ProbeTab() {
  const t = useTheme()
  const [text, setText] = React.useState('')
  const [result, setResult] = React.useState<any>(null)
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  const score = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.moderation.model.scoreProbe(text))
    } catch (e: any) {
      setResult(null)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const scores = result?.scores || {}

  return (
    <ScreenScroll>
      <Panel title="Score arbitrary text" subtitle="Nothing is stored — this creates no case.">
        <Field
          value={text}
          onChangeText={setText}
          placeholder="Type or paste anything"
          multiline
          minHeight={110}
          maxLength={2000}
        />
        <Button
          label="Score"
          onPress={score}
          variant="primary"
          size="md"
          block
          disabled={!text.trim() || busy}
          loading={busy}
          style={{ marginTop: space.sm2 }}
        />
      </Panel>

      {error ? (
        <Panel>
          <ErrorStrip error={error} onRetry={score} />
        </Panel>
      ) : null}

      {result ? (
        <Panel>
          <View style={styles.probeHead}>
            <MonoChip label={String(result.modelVersion ?? '—')} tone="accent" />
            <Text variant="caption" tone="muted" align="ui">{Number(result.inferenceMs ?? 0)}ms</Text>
          </View>
          <Divider style={{ marginVertical: space.sm2 }} />
          {(MODERATION_LABELS as string[]).map(label => (
            <ScoreBar key={label} label={label} score={Number(scores[label] ?? 0)} showTicks={false} />
          ))}
        </Panel>
      ) : null}
    </ScreenScroll>
  )
}

/* ---------------------------------------------------------
   The add sheet, shared by all three writers.
   --------------------------------------------------------- */

function LabelledTextSheet({
  visible, onClose, mode, onSaved,
}: {
  visible: boolean
  onClose: () => void
  mode: 'example' | 'word' | 'golden'
  onSaved: () => void
}) {
  const t = useTheme()
  const [text, setText] = React.useState('')
  const [note, setNote] = React.useState('')
  const [picked, setPicked] = React.useState<string[]>([])
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!visible) return
    setText(''); setNote(''); setPicked([]); setError(null)
  }, [visible])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      /* labelsTo() guarantees the exact six wire keys — an alias here silently
         stores 0 in the training writer. */
      const labels = labelsTo(picked)
      if (mode === 'word') {
        const res: any = await api.moderation.model.addWord({ word: text.trim(), labels, note: note.trim() || undefined })
        /* The server's own note says this only matters after a retrain. */
        toast.ok(String(res?.note || 'Word added'))
      } else if (mode === 'golden') {
        await api.moderation.model.addGoldenCase({ text: text.trim(), labels, note: note.trim() || undefined })
        toast.ok('Golden case saved')
      } else {
        await api.moderation.model.addTrainingExample({ text: text.trim(), labels, note: note.trim() || undefined })
        toast.ok('Example saved')
      }
      onSaved()
    } catch (e: any) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'word' ? 'Add word' : mode === 'golden' ? 'Add golden case' : 'Add example'

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View>
          <Text variant="caption" tone="muted" align="ui" style={{ marginBottom: space.sm }}>
            {mode === 'word'
              ? 'A word only changes anything after a retrain. For an instant ban, add it to the blocklist too.'
              : 'Re-posting the same sentence UPDATES its labels instead of adding a row.'}
          </Text>
          <Button
            label="Save"
            onPress={save}
            variant="primary"
            size="lg"
            block
            disabled={!text.trim() || busy}
            loading={busy}
          />
        </View>
      }
    >
      <View style={{ padding: space.xl, gap: space.md }}>
        <Field
          label={mode === 'word' ? 'Word' : 'Text'}
          value={text}
          onChangeText={setText}
          multiline={mode !== 'word'}
          minHeight={mode === 'word' ? 48 : 100}
          autoCapitalize="none"
          placeholder={mode === 'word' ? 'one word' : 'The sentence to label'}
        />

        <View>
          <Text variant="subhead" tone="secondary" align="ui" style={{ marginBottom: space.xs2 }}>Labels</Text>
          <View style={styles.labelPicker}>
            {(MODERATION_LABELS as string[]).map(label => (
              <Chip
                key={label}
                label={label}
                size="sm"
                selected={picked.includes(label)}
                onPress={() => setPicked(p => (p.includes(label) ? p.filter(x => x !== label) : [...p, label]))}
              />
            ))}
          </View>
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs2 }}>
            Selecting none is allowed — an all-zero row is a valid negative example.
          </Text>
        </View>

        <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />

        {error ? <ErrorStrip error={error} /> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summary: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs },
  caption: { paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  goldenRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm2,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  labelWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs2 },
  tinyChip: { paddingHorizontal: space.xs2, paddingVertical: space.xxs },
  metaWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs2 },
  labelPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  probeHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  fab: { position: 'absolute', end: 16 },
})
