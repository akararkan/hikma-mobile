/* =========================================================
   Blocklist — the instant lever that needs no retrain.

   BLOCK refuses the write outright at create time; FLAG
   publishes and files a hit into the reactive inbox. That is
   the whole difference and it is why this screen exists
   separately from the training data: a word added here bites
   immediately, a word added there only after a retrain.

   The endpoint is `findAll()` — no params, no pagination, no
   sorting. Filtering and ordering are entirely the client's
   job, which is why the caption says how many rows are
   actually loaded rather than implying a page.

   Two write quirks:
   · `add` is an UPSERT on the normalised form, so "add" can
     silently be an edit — the response is read back and the
     toast says which it was.
   · `update` IGNORES `keyword`. Changing the word itself means
     delete + add, so the edit sheet disables that field and
     says so instead of letting a rename fail silently.

   `remove` is the one delete on this surface where an unknown
   id is a REAL 404 (the model deletes answer 204) — so
   isNotFound means the row was already gone: drop it locally
   and show nothing.

   Scroll shape: module-scope keyExtractor, a memoized row with
   ROW-FIRST handlers, and a header held by useMemo — FlashList's
   ViewHolder memo compares renderItem BY IDENTITY, and this
   screen re-renders on every keystroke in the filter field.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, BLOCKLIST_SEVERITIES, isNotFound } from '@/api'
import { useRoleGate } from '@/context/AuthContext'
import { useAsync, useDebounced, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_CONSOLE_ROLES, Mono, Panel, Pill, StaffGateLoading, StaffRefusal,
  isCancelled, withStepUpAction,
} from '@/components/moderation'
import {
  Button, Chip, ConfirmSheet, Divider, EmptyState, ErrorState, Field, Header, Icon,
  Screen, SearchField, SegmentedControl, Sheet, Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'

const keyExtractor = (item: any) => String(item?.id ?? item?.keyword)

const SEVERITY_OPTIONS = [
  { value: '', label: 'All' },
  ...(BLOCKLIST_SEVERITIES as string[]).map(s => ({ value: s, label: s === 'BLOCK' ? 'Block' : 'Flag' })),
]

export default function BlocklistGate() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Blocklist" />
  if (gate === 'deny') return <StaffRefusal title="Blocklist" />
  return <BlocklistScreen />
}

function BlocklistScreen() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()

  const [query, setQuery] = React.useState('')
  const [severity, setSeverity] = React.useState('')
  const [testOpen, setTestOpen] = React.useState(false)
  const debounced = useDebounced(query, 200)

  const addSheet = useSheetState()
  const editSheet = useSheetState<{ row: any }>()
  const deleteConfirm = useSheetState<{ row: any }>()

  const list = useAsync<any[]>(async () => (await api.moderation.blocklist.list()) || [], { deps: [] })
  const rows = list.data || []

  const filtered = React.useMemo(() => {
    const q = debounced.trim().toLowerCase()
    return rows
      .filter(r => (!severity || String(r?.severity).toUpperCase() === severity))
      .filter(r => (!q || String(r?.keyword ?? '').toLowerCase().includes(q) || String(r?.note ?? '').toLowerCase().includes(q)))
      .sort((a, b) => String(a?.keyword ?? '').localeCompare(String(b?.keyword ?? '')))
  }, [rows, debounced, severity])

  const remove = async (row: any) => {
    const id = String(row?.id ?? '')
    const before = rows
    list.setData(prev => (prev || []).filter(r => String(r?.id) !== id))
    try {
      await api.moderation.blocklist.remove(id)
      toast.ok(`Removed “${row?.keyword}”`)
    } catch (e: any) {
      /* A real 404 here means the row was already gone — the optimistic drop
         was correct, so say nothing. */
      if (isNotFound(e)) return
      list.setData(before)
      toast.error('Could not remove that keyword.')
    }
  }

  /* Row-first and identity-stable, so one instance of each serves every cell.
     These live ABOVE the loading/error early returns on purpose: `useAsync`
     starts with loading === true, so a hook declared below the guard would
     be skipped on the first render and appear on the second. */
  const onRowPress = useEvent((row: any) => editSheet.open({ row }))
  const onRowDelete = useEvent((row: any) => deleteConfirm.open({ row }))
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <KeywordRow row={item} onPress={onRowPress} onDelete={onRowDelete} />,
    [onRowPress, onRowDelete],
  )

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 40 }),
    [insets.bottom],
  )

  /* The header carries a SearchField, a SegmentedControl and the test card —
     a fresh element identity would rebuild all of it on every keystroke. */
  const listHeader = React.useMemo(() => (
    <View>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm2 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Filter keywords" />
      </View>
      <SegmentedControl
        options={SEVERITY_OPTIONS}
        value={severity}
        onChange={setSeverity}
        style={{ marginHorizontal: space.lg, marginTop: space.sm2 }}
      />

      <Touchable
        onPress={() => setTestOpen(v => !v)}
        feedback="tint"
        noAutoHitSlop
        style={[styles.testHead, { borderBottomColor: c.separator }]}
      >
        <Icon name="scan" size={16} color={c.textSecondary} />
        <Text variant="subhead" align="ui" style={styles.flex}>Test some text</Text>
        <Icon name={testOpen ? 'up' : 'down'} size={15} color={c.textFaint} />
      </Touchable>
      {testOpen ? <TestCard /> : null}

      <Text variant="caption" tone="faint" align="ui" style={styles.caption}>
        Showing all {rows.length} keyword{rows.length === 1 ? '' : 's'} — this endpoint has no paging or sorting.
      </Text>
    </View>
  ), [query, severity, testOpen, rows.length, c.separator, c.textSecondary, c.textFaint])

  if (list.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Blocklist" />
        <View style={{ padding: space.lg, gap: space.md2 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={{ gap: space.xs2 }}>
              <Skeleton width="38%" height={14} />
              <Skeleton width="62%" height={11} />
            </View>
          ))}
        </View>
      </Screen>
    )
  }

  if (list.error && !rows.length) {
    return (
      <Screen background="sunken">
        <Header back title="Blocklist" />
        <ErrorState error={list.error} onRetry={list.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Blocklist"
        actions={[{ icon: 'add', onPress: addSheet.open, label: 'Add keyword' }]}
      />

      <FlashList
        data={filtered}
        keyExtractor={keyExtractor}
        contentContainerStyle={contentStyle}
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
          debounced.trim() || severity ? (
            <EmptyState
              icon="search"
              title={`No keywords match “${debounced.trim() || severity}”`}
              actionLabel="Clear"
              onAction={() => { setQuery(''); setSeverity('') }}
            />
          ) : (
            <EmptyState
              icon="key"
              title="No keywords"
              message="Nothing is on the deny-list yet."
              actionLabel="Add one"
              onAction={addSheet.open}
            />
          )
        }
      />

      <AddSheet visible={addSheet.visible} onClose={addSheet.close} onSaved={() => { addSheet.close(); void list.reload() }} />
      <EditSheet
        visible={editSheet.visible}
        row={editSheet.payload?.row}
        onClose={editSheet.close}
        onSaved={() => { editSheet.close(); void list.reload() }}
      />

      <ConfirmSheet
        visible={deleteConfirm.visible}
        onClose={deleteConfirm.close}
        title={`Delete “${deleteConfirm.payload?.row?.keyword ?? ''}”?`}
        message="It stops being enforced immediately."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const row = deleteConfirm.payload?.row
          deleteConfirm.close()
          if (row) void remove(row)
        }}
      />
    </Screen>
  )
}

/* Memoized, with ROW-FIRST handlers so one function serves every cell. */
const KeywordRow = React.memo(function KeywordRow(
  { row, onPress, onDelete }: { row: any; onPress: (row: any) => void; onDelete: (row: any) => void },
) {
  const t = useTheme()
  const c = t.colors
  const swipe = React.useRef<any>(null)
  const block = String(row?.severity).toUpperCase() === 'BLOCK'

  /* Swipeable diffs its action renderer by identity — a fresh arrow re-registers
     the pane on every render. */
  const rightActions = React.useCallback(() => (
        <Touchable
          onPress={() => { swipe.current?.close(); onDelete(row) }}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel="Delete keyword"
          style={[styles.swipeAction, { backgroundColor: c.danger }]}
        >
          <Icon name="trash" size={19} color={c.textOnAccent} />
          <Text variant="micro" color={c.textOnAccent}>Delete</Text>
        </Touchable>
  ), [c.danger, c.textOnAccent, onDelete, row])

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={2}
      overshootRight={false}
      renderRightActions={rightActions}
    >
      <Touchable
        onPress={() => onPress(row)}
        feedback="tint"
        noAutoHitSlop
        style={[styles.row, { backgroundColor: c.bg, borderBottomColor: c.separator }]}
      >
        <View style={styles.flex}>
          <View style={styles.rowHead}>
            <Mono variant="body" align="ui" numberOfLines={1} style={styles.flex}>{String(row?.keyword ?? '')}</Mono>
            <Pill label={block ? 'BLOCK' : 'FLAG'} tone={block ? 'danger' : 'warning'} size="sm" />
          </View>
          {row?.note ? (
            <Text variant="footnote" tone="muted" align="auto" numberOfLines={1} style={{ marginTop: space.xxs }}>
              {String(row.note)}
            </Text>
          ) : null}
        </View>
        <Icon name="forward" size={15} color={c.textFaint} />
      </Touchable>
    </ReanimatedSwipeable>
  )
})

/* ---------------------------------------------------------
   Test card. `matches` entries are PRE-FORMATTED display
   strings ("idiot (BLOCK)"), not objects — rendered verbatim,
   never parsed for a severity that is not there.
   --------------------------------------------------------- */
function TestCard() {
  const t = useTheme()
  const c = t.colors
  const [text, setText] = React.useState('')
  const [result, setResult] = React.useState<any>(null)
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.moderation.blocklist.test(text))
    } catch (e: any) {
      /* CONTENT_BLOCKED_BY_POLICY can come back from THIS endpoint — it is the
         last user-visible producer of that code, and here it is a result, not
         a composer refusal. */
      setResult(null)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel padded style={{ marginTop: 0 }}>
      <Field
        value={text}
        onChangeText={setText}
        placeholder="Paste text to check"
        multiline
        minHeight={80}
      />
      <Button
        label="Test"
        onPress={run}
        variant="secondary"
        size="md"
        block
        disabled={!text.trim() || busy}
        loading={busy}
        style={{ marginTop: space.sm2 }}
      />

      {error ? <ErrorStrip error={error} style={{ marginTop: space.sm2 }} /> : null}

      {result ? (
        <View style={{ marginTop: space.md }}>
          <Divider style={{ marginBottom: space.sm2 }} />
          <Text variant="title3" tone={result.matched ? 'danger' : 'success'} align="ui">
            {result.matched ? 'Matched' : 'No match'}
          </Text>
          <View style={styles.matchWrap}>
            {(result.matches || []).map((m: string, i: number) => (
              <Chip key={`${m}:${i}`} label={String(m)} tone="danger" size="sm" />
            ))}
          </View>
        </View>
      ) : null}
    </Panel>
  )
}

function AddSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [keyword, setKeyword] = React.useState('')
  const [severity, setSeverity] = React.useState('FLAG')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!visible) return
    setKeyword(''); setSeverity('FLAG'); setNote(''); setError(null)
  }, [visible])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      /* Built as a variable rather than inline: the api module is JS, so its
         inferred parameter type omits the fields that carry no default. */
      const payload = { keyword: keyword.trim(), severity, note: note.trim() || undefined }
      const res: any = await withStepUpAction(() => api.moderation.blocklist.add(payload))
      /* UPSERT: read the response back rather than assuming a new row. */
      toast.ok(`Saved “${res?.keyword ?? keyword.trim()}”`)
      onSaved()
    } catch (e: any) {
      if (!isCancelled(e)) setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add keyword"
      footer={
        <Button label="Save" onPress={save} variant="primary" size="lg" block disabled={!keyword.trim() || busy} loading={busy} />
      }
    >
      <View style={{ padding: space.xl, gap: space.md }}>
        <Field
          label="Keyword"
          value={keyword}
          onChangeText={setKeyword}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          hint="Trimmed and truncated to 100 characters."
        />
        <View>
          <Text variant="subhead" tone="secondary" align="ui" style={{ marginBottom: space.xs2 }}>Severity</Text>
          <SegmentedControl
            options={(BLOCKLIST_SEVERITIES as string[]).map(s => ({ value: s, label: s === 'BLOCK' ? 'Block' : 'Flag' }))}
            value={severity}
            onChange={setSeverity}
          />
          <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
            {severity === 'BLOCK'
              ? 'Refuses the write outright at create time.'
              : 'Publishes and files a hit into Reports & flags.'}
          </Text>
        </View>
        <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
        <Text variant="caption" tone="faint" align="ui">
          Adding an existing word UPDATES it in place — this is an upsert on the normalised form.
        </Text>
        {error ? <ErrorStrip error={error} /> : null}
      </View>
    </Sheet>
  )
}

function EditSheet({
  visible, row, onClose, onSaved,
}: { visible: boolean; row: any; onClose: () => void; onSaved: () => void }) {
  const [severity, setSeverity] = React.useState('FLAG')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!visible || !row) return
    setSeverity(String(row?.severity || 'FLAG').toUpperCase())
    setNote(String(row?.note ?? ''))
    setError(null)
  }, [visible, row])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.moderation.blocklist.update(String(row?.id), { severity, note })
      toast.ok('Updated')
      onSaved()
    } catch (e: any) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Edit keyword"
      footer={<Button label="Save" onPress={save} variant="primary" size="lg" block loading={busy} disabled={busy} />}
    >
      <View style={{ padding: space.xl, gap: space.md }}>
        <Field
          label="Keyword"
          value={String(row?.keyword ?? '')}
          editable={false}
          hint="The patch ignores the word itself — to change it, delete this row and add the new one."
        />
        <View>
          <Text variant="subhead" tone="secondary" align="ui" style={{ marginBottom: space.xs2 }}>Severity</Text>
          <SegmentedControl
            options={(BLOCKLIST_SEVERITIES as string[]).map(s => ({ value: s, label: s === 'BLOCK' ? 'Block' : 'Flag' }))}
            value={severity}
            onChange={setSeverity}
          />
        </View>
        <Field label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
        {error ? <ErrorStrip error={error} /> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  caption: { paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  testHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    minHeight: 64,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swipeAction: { width: 84, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  matchWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, marginTop: space.sm },
})
