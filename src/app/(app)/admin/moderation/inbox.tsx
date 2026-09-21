/* =========================================================
   Reports & flags — the pre-existing REACTIVE queue.

   Distinct from the review queue in every way that matters: it
   is fed by humans and by the media pipeline rather than by the
   classifier, and its row is a different record with different
   field names. The two deliberately do not share a card.

   The traps this screen has to state rather than hide:

   · Without an explicit `targetType`, the reports feeder is
     narrowed server-side to POST, COMMENT and STORY. USER,
     RESEARCH, QUESTION, ANSWER, MESSAGE and CHANNEL reports are
     INVISIBLE unless asked for by name — the caption says so,
     because an empty list otherwise reads as "all clear".
   · Paging is applied PER FEEDER and the three lists are then
     concatenated, so one page can hold up to 3× the page size
     and page 2 is not "the next 50 of one ordering".
   · An unrecognised `source` returns [] rather than a 400, so
     the source control is kept to QUEUE_SOURCES values only.
   · A wrong action/type pair is NOT a 400 — it comes back as a
     per-target `error` string inside a 200 array. Filtering the
     action menu by the selection's type is what prevents a
     confusing partial success.
   · `reportCount` is COUNT(*), not distinct reporters.

   Scroll shape: `rowKey` is module scope (it is both the
   keyExtractor and the selection key, so it must not churn),
   InboxRow is memoized, and every handler it takes is ROW-FIRST
   and identity-stable — FlashList's ViewHolder memo compares
   renderItem BY IDENTITY, and this screen re-renders on every
   selection tap.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, adapters, QUEUE_BULK_ACTIONS, QUEUE_SOURCES, REPORT_TARGET_TYPES } from '@/api'
import { useRoleGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_CONSOLE_ROLES, MonoChip, Pill, StaffGateLoading, StaffRefusal,
  isCancelled, targetNoun, withStepUpAction,
} from '@/components/moderation'
import {
  ActionSheet, Button, Chip, ChipRail, ConfirmSheet, EmptyState, ErrorState, Field, Header,
  Icon, ListFooter, Screen, SegmentedControl, Sheet, Skeleton, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'

const SOURCE_OPTIONS = [
  { value: '', label: 'All' },
  ...(QUEUE_SOURCES as string[]).map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
]

const SOURCE_GLYPH: Record<string, 'flag' | 'image' | 'key'> = {
  reports: 'flag', media: 'image', keywords: 'key',
}

const BULK_CAP = 100

/* A queue row has no id — the tuple below is what makes one unique, and it is
   both the FlashList key and the selection key. */
const rowKey = (r: any) => `${r?.source}:${r?.targetType}:${r?.targetRef}:${r?.reason}`

export default function InboxGate() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Reports & flags" />
  if (gate === 'deny') return <StaffRefusal title="Reports & flags" />
  return <InboxScreen />
}

function InboxScreen() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()

  const [source, setSource] = React.useState('')
  const [targetType, setTargetType] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [selecting, setSelecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [results, setResults] = React.useState<any[] | null>(null)

  const actionSheet = useSheetState()
  const confirm = useSheetState<{ action: string; label: string }>()
  const resolveConfirm = useSheetState<{ row: any }>()

  const list = usePaged<any>(
    ({ page, pageSize, signal }) => {
      /* Assembled as a variable: the api module is JS and its inferred
         parameter type drops every field that carries no default. */
      const args = {
        source: source || undefined,
        targetType: source === 'reports' && targetType ? targetType : undefined,
        page,
        pageSize,
        signal,
      }
      return api.moderation.queue.list(args)
    },
    {
      mode: 'page',
      pageSize: 50,
      keyOf: rowKey,
      deps: [source, targetType],
    },
  )

  const selectedRows = React.useMemo(
    () => list.items.filter(r => selected.has(rowKey(r))),
    [list.items, selected],
  )

  /* Only offer the action/type pairs the controller actually accepts for THIS
     selection; anything else comes back as a per-target error inside a 200. */
  const availableActions = React.useMemo(() => {
    const types = new Set(selectedRows.map(r => String(r?.targetType || '').toUpperCase()))
    return (QUEUE_BULK_ACTIONS as { action: string; type: string; label: string }[])
      .filter(a => types.size > 0 && [...types].every(ty => ty === a.type))
  }, [selectedRows])

  const clearSelection = () => { setSelected(new Set()); setSelecting(false); setError(null) }

  const toggle = useEvent((r: any) => {
    const key = rowKey(r)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < BULK_CAP) next.add(key)
      else toast.warn(`Bulk actions are capped at ${BULK_CAP} items.`)
      return next
    })
  })

  const runBulk = async (action: string) => {
    if (!selectedRows.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await withStepUpAction(() => api.moderation.queue.bulk({
        action,
        targets: selectedRows.map(r => ({ type: r?.targetType, id: r?.targetRef })),
        reason: reason.trim() || undefined,
      }))
      const rows: any[] = Array.isArray(res) ? res : []
      if (rows.some(r => r?.outcome !== 'ok')) setResults(rows)
      else {
        toast.ok(`${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'} actioned`)
        clearSelection()
        setReason('')
      }
      await list.refresh()
    } catch (e: any) {
      if (!isCancelled(e)) setError(e)
    } finally {
      setBusy(false)
    }
  }

  const resolveKeyword = async (row: any) => {
    const key = rowKey(row)
    list.remove(key)
    try {
      await api.moderation.queue.resolveKeyword(String(row?.targetRef ?? ''))
      /* 204 for an unknown hitId too — the refresh, not the status, is proof. */
      toast.ok('Keyword hit resolved')
      await list.refresh()
    } catch {
      await list.refresh()
      toast.error('Could not resolve that hit.')
    }
  }

  /* Row-first and identity-stable: one instance of each handler serves every
     cell, so InboxRow's memo only misses where its own scalars moved. */
  const onRowPress = useEvent((r: any) => { if (selecting) toggle(r) })
  const onRowLongPress = useEvent((r: any) => {
    if (selecting || String(r?.source) !== 'reports') return
    fireHaptic('medium')
    setSelecting(true)
    toggle(r)
  })
  const onResolve = useEvent((r: any) => resolveConfirm.open({ row: r }))

  /* The row takes the derived BOOLEAN, never the selection Set. */
  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <InboxRow
      row={item}
      selecting={selecting}
      selected={selected.has(rowKey(item))}
      onPress={onRowPress}
      onLongPress={onRowLongPress}
      onResolve={onResolve}
    />
  ), [selecting, selected, onRowPress, onRowLongPress, onResolve])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + (selecting ? 160 : 40) }),
    [insets.bottom, selecting],
  )

  return (
    <Screen background="sunken">
      <Header
        back
        title={selecting ? `${selected.size} selected` : 'Reports & flags'}
        actions={selecting ? [] : []}
      />

      {selecting ? (
        <View style={[styles.selectBar, { backgroundColor: c.surface, borderBottomColor: c.separator }]}>
          <Button label="Cancel" onPress={clearSelection} variant="ghost" size="sm" />
          <View style={styles.flex} />
          <Button
            label="Actions"
            onPress={actionSheet.open}
            variant="ghost"
            size="sm"
            disabled={!selectedRows.length || !availableActions.length}
          />
        </View>
      ) : (
        <View style={{ backgroundColor: c.bg, borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }}>
          <SegmentedControl
            options={SOURCE_OPTIONS}
            value={source}
            onChange={v => { clearSelection(); setSource(v); if (v !== 'reports') setTargetType('') }}
            style={{ marginHorizontal: space.lg, marginTop: space.sm2 }}
          />
          {source === 'reports' ? (
            <>
              <ChipRail style={{ paddingVertical: space.sm2 }}>
                <Chip label="Default three" selected={!targetType} size="sm" onPress={() => setTargetType('')} />
                {(REPORT_TARGET_TYPES as string[]).map(ty => (
                  <Chip
                    key={ty}
                    label={targetNoun(ty)}
                    selected={targetType === ty}
                    size="sm"
                    onPress={() => setTargetType(ty)}
                  />
                ))}
              </ChipRail>
              <Text variant="caption" tone="faint" align="ui" style={styles.caption}>
                Without a target type, only POST, COMMENT and STORY reports are shown.
              </Text>
            </>
          ) : null}
        </View>
      )}

      {error ? <ErrorStrip error={error} style={{ marginHorizontal: space.lg, marginTop: space.sm2 }} /> : null}

      {list.loading ? (
        <View>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[styles.skeleton, { borderBottomColor: c.separator }]}>
              <Skeleton width={34} height={34} circle />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="52%" height={12} />
                <Skeleton width="72%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : list.error && !list.items.length ? (
        <ErrorState error={list.error} onRetry={list.reload} title="Couldn't load the queue" />
      ) : (
        <FlashList
          data={list.items}
          keyExtractor={rowKey}
          extraData={`${selecting}:${selected.size}`}
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
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              icon="flag"
              title="Nothing flagged"
              message="Report target types must be selected explicitly — the default view only covers posts, comments and stories."
            />
          }
          ListFooterComponent={
            list.items.length ? (
              <>
                <ListFooter
                  loading={list.loadingMore}
                  error={list.items.length ? list.error : null}
                  onRetry={list.loadMore}
                  done={list.done}
                />
                <Text variant="caption" tone="faint" align="center" style={{ paddingHorizontal: space.xxxl, paddingBottom: space.lg }}>
                  Paging is applied per feeder, so one page can hold up to 3× the page size.
                </Text>
              </>
            ) : null
          }
        />
      )}

      {selecting ? (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <Field
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (shown in the audit trail)"
            maxLength={500}
            containerStyle={{ marginBottom: space.sm }}
          />
          {!availableActions.length && selectedRows.length ? (
            <Text variant="caption" tone="faint" align="ui" style={{ marginBottom: space.sm }}>
              No action covers every selected target type — narrow the selection.
            </Text>
          ) : null}
          <Button
            label="Choose action"
            onPress={actionSheet.open}
            variant="primary"
            size="lg"
            block
            disabled={!availableActions.length || busy}
            loading={busy}
          />
        </View>
      ) : null}

      <ActionSheet
        visible={actionSheet.visible}
        onClose={actionSheet.close}
        title={`${selectedRows.length} selected`}
        subtitle="Only actions valid for every selected target are listed."
        actions={availableActions.map(a => ({
          label: a.label,
          destructive: a.action === 'TAKEDOWN' || a.action === 'DELETE' || a.action === 'SOUND_REJECT',
          onPress: () => confirm.open({ action: a.action, label: a.label }),
        }))}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={`${confirm.payload?.label ?? 'Apply'} · ${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'}?`}
        message="Per-target failures come back inside a 200, so some may succeed and some may not."
        confirmLabel="Apply"
        destructive
        loading={busy}
        onConfirm={() => {
          const action = confirm.payload?.action
          confirm.close()
          if (action) void runBulk(action)
        }}
      />

      <ConfirmSheet
        visible={resolveConfirm.visible}
        onClose={resolveConfirm.close}
        title="Resolve this keyword hit?"
        message="There is no un-resolve endpoint."
        confirmLabel="Resolve"
        onConfirm={() => {
          const row = resolveConfirm.payload?.row
          resolveConfirm.close()
          if (row) void resolveKeyword(row)
        }}
      />

      <Sheet
        visible={!!results}
        onClose={() => setResults(null)}
        title="Results"
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm2 }}>
            <Button label="Done" onPress={() => { setResults(null); clearSelection() }} variant="secondary" size="lg" style={styles.flex} />
            <Button
              label="Retry failed"
              onPress={() => {
                const failedIds = new Set((results || []).filter(r => r?.outcome !== 'ok').map(r => String(r?.id)))
                setResults(null)
                setSelected(new Set(list.items.filter(r => failedIds.has(String(r?.targetRef))).map(rowKey)))
              }}
              variant="primary"
              size="lg"
              style={styles.flex}
            />
          </View>
        }
      >
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.xs2 }}>
          {(results || []).map((r: any, i: number) => (
            <View key={`${r?.type}:${r?.id}:${i}`} style={styles.resultRow}>
              <Icon name={r?.outcome === 'ok' ? 'checkCircle' : 'error'} size={17} color={r?.outcome === 'ok' ? c.success : c.danger} />
              <View style={styles.flex}>
                <MonoChip label={`${r?.type ?? ''} ${r?.id ?? ''}`} />
                {/* A raw exception message, not an errorCode. */}
                {r?.error ? (
                  <Text variant="caption" tone="danger" align="ui" style={{ marginTop: space.xs }}>{String(r.error)}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  )
}

/* Memoized, with ROW-FIRST handlers so one function serves all 50 cells. */
const InboxRow = React.memo(function InboxRow({
  row, selecting, selected, onPress, onLongPress, onResolve,
}: {
  row: any
  selecting: boolean
  selected: boolean
  onPress: (row: any) => void
  onLongPress: (row: any) => void
  onResolve: (row: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const source = String(row?.source ?? '')
  const glyph = SOURCE_GLYPH[source] ?? 'flag'

  return (
    <Touchable
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      delayLongPress={420}
      feedback={selecting ? 'tint' : 'none'}
      noAutoHitSlop
      style={[styles.row, { backgroundColor: selected ? c.accentSofter : c.bg, borderBottomColor: c.separator }]}
    >
      {selecting ? (
        <View style={styles.check}>
          {selected
            ? <Icon name="checkCircle" size={22} color={c.accent} filled />
            : <View style={[styles.hollow, { borderColor: c.borderStrong }]} />}
        </View>
      ) : (
        <View style={[styles.glyph, { backgroundColor: c.surfaceSunken }]}>
          <Icon name={glyph} size={17} color={c.textSecondary} />
        </View>
      )}

      <View style={styles.flex}>
        <Text variant="subhead" weight="700" align="ui" numberOfLines={1}>
          {String(row?.targetType ?? '—')} · {String(row?.reason ?? '—')}
        </Text>
        <MonoChip label={String(row?.targetRef ?? '')} style={{ marginTop: space.xs }} />
        <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
          First seen {adapters.timeAgo(row?.firstSeen)} · Last seen {adapters.timeAgo(row?.lastSeen)}
        </Text>
      </View>

      <View style={styles.trailing}>
        <Touchable
          onLongPress={() => toast.info('Reports, not distinct reporters.')}
          feedback="none"
          noAutoHitSlop
        >
          <View style={[styles.countPill, { backgroundColor: c.surfaceSunken }]}>
            <Text variant="caption" tone="secondary">{Number(row?.reportCount ?? 0)}</Text>
          </View>
        </Touchable>
        {row?.state ? <Pill label={String(row.state)} tone="neutral" size="sm" /> : null}
        {source === 'keywords' && !selecting ? (
          <Button label="Resolve" onPress={() => onResolve(row)} variant="ghost" size="sm" />
        ) : null}
      </View>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  caption: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm2,
    paddingVertical: space.xs2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    minHeight: 92,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  glyph: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  check: { width: 34, alignItems: 'center' },
  hollow: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  trailing: { alignItems: 'flex-end', gap: space.xs2 },
  countPill: { minWidth: 26, paddingHorizontal: space.sm, paddingVertical: space.xxs, borderRadius: 10, alignItems: 'center' },
  skeleton: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    height: 92,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bulkBar: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingVertical: space.sm },
})
