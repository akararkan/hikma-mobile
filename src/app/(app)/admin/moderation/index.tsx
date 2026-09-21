/* =========================================================
   Review queue — the staff side of automated moderation.

   Three traps shape this screen and none of them are visible in
   the JSON:

   1. `counts` is GLOBAL, not a count of the filtered result.
      The caption under the tiles says so out loud, because a
      filtered view whose tiles disagree with its rows reads as
      a console hiding something.
   2. The filters are NOT composable. The controller is an
      if/else-if chain and `slaBreached` WINS — the api module
      already drops entityType under it, so the UI must never
      show both as active or it would be describing a request
      the server did not run.
   3. `preview` is built from an unordered field fetch. It is a
      hint about the case, never "the body", and for
      CHAT_MESSAGE / LIVE_CHAT it is the redaction placeholder:
      chat bodies are never shown to staff, in any admin view,
      ever.

   Single decisions need no step-up — that is deliberate in the
   controller, since deciding cases is the everyday act. Bulk
   does, and <StepUpHost/> satisfies it globally; the wrapper
   here only exists to swallow a cancelled prompt.

   Scroll shape: QueueRow is memoized and every handler it takes
   is ROW-FIRST and identity-stable (useEvent), so one function
   serves the whole queue instead of four fresh closures per
   cell. renderItem and keyExtractor are stable for the same
   reason — FlashList's ViewHolder memo compares renderItem BY
   IDENTITY, and this screen re-renders on every selection tap.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  api, adapters, codeOf, isRedactedType, logApiError,
  MODERATED_ENTITY_TYPES, MODERATION_REDACTED, MODERATION_STATUSES, entityTypeName,
} from '@/api'
import { ENTITY_LABEL } from '@/lib/moderation.js'
import { useRoleGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ErrorStrip, MOD_CONSOLE_ROLES, MonoChip, StaffGateLoading, StaffRefusal,
  Tile, WarningBanner, isCancelled, withStepUpAction,
} from '@/components/moderation'
import {
  ActionSheet, Button, Chip, ChipRail, ConfirmSheet, EmptyState, ErrorState, Field,
  Header, Icon, ListFooter, Screen, SegmentedControl, Sheet, Skeleton, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'

/* REASON_CODES rendered as the short words a moderator actually says. */
const REASON_LABEL: Record<string, string> = {
  MODEL: 'model',
  BLOCKLIST: 'keyword',
  SLA_BREACH: 'SLA',
  ADMIN: 'admin',
  INFERENCE_UNAVAILABLE: 'model down',
  DISABLED: 'off',
  NO_TEXT: 'no text',
}

const STATUS_OPTIONS = (MODERATION_STATUSES as string[]).map(s => ({
  value: s,
  label: s === 'IN_REVIEW' ? 'In review' : s.charAt(0) + s.slice(1).toLowerCase(),
}))

const BULK_CAP = 100

const keyExtractor = (item: any) => String(item.caseId)

/* Module scope so the list header is one stable element type, not a fresh
   component identity on every screen render. */
const PreviewNote = React.memo(function PreviewNote() {
  return (
    <Text variant="caption" tone="faint" align="ui" style={styles.previewNote}>
      Preview is an arbitrary field, not the body.
    </Text>
  )
})

export default function ReviewQueueScreen() {
  const gate = useRoleGate(MOD_CONSOLE_ROLES)
  if (gate === 'loading') return <StaffGateLoading title="Review queue" />
  /* A rights refusal is FINAL — no retry, and the queue call is never made. */
  if (gate === 'deny') return <StaffRefusal title="Review queue" />
  return <ReviewQueue />
}

function ReviewQueue() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  /* Filters live in component state, not the URL, so a back-navigation from a
     case returns to the same view instead of the default queue. */
  const [status, setStatus] = React.useState<string>('IN_REVIEW')
  const [entityType, setEntityType] = React.useState<string>('')
  const [slaBreached, setSlaBreached] = React.useState(false)
  const [sort, setSort] = React.useState<string>('risk')

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [selecting, setSelecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [teach, setTeach] = React.useState(false)
  const [bulkError, setBulkError] = React.useState<any>(null)
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [results, setResults] = React.useState<any[] | null>(null)
  const [showWarning, setShowWarning] = React.useState(false)

  const typeSheet = useSheetState()
  const sortSheet = useSheetState()
  const menu = useSheetState()
  const confirm = useSheetState<{ action: 'APPROVE' | 'REJECT' }>()

  const queue = usePaged<any>(
    ({ page, pageSize, signal }) => {
      /* Assembled as a variable: the api module is JS and its inferred
         parameter type drops every field that carries no default. */
      const args = { status, entityType: entityType || undefined, slaBreached, sort, page, pageSize, signal }
      return api.moderation.review.list(args)
    },
    {
      mode: 'page',
      pageSize: 50,
      keyOf: r => String(r?.caseId ?? ''),
      deps: [status, entityType, slaBreached, sort],
      onError: e => {
        /* INVALID_MODERATION_SETTING here means WE sent a status or entityType
           the enum does not have — our bug, not the moderator's. */
        if (codeOf(e) === 'INVALID_MODERATION_SETTING') {
          logApiError(e, 'GET', '/admin/moderation/review')
          setStatus('IN_REVIEW'); setEntityType(''); setSlaBreached(false); setSort('risk')
        }
      },
    },
  )

  const health = useAsync<any>(() => api.moderation.review.metrics({ windowHours: 24 }), { deps: [] })
  const inferenceUp = health.data?.model?.inferenceUp !== false
  /* Only fetched when the dot is red: `warning` is present only when moderation
     is disabled or inference is down, and it is SERVER copy. */
  const settings = useAsync<any>(() => api.moderation.settings.get(), {
    enabled: !health.loading && !inferenceUp,
    deps: [inferenceUp, health.loading],
  })

  const counts = queue.extra?.counts || { inReview: 0, pending: 0, slaBreached: 0 }
  const filtersActive = status !== 'IN_REVIEW' || !!entityType || slaBreached || sort !== 'risk'

  const clearSelection = () => { setSelected(new Set()); setSelecting(false); setBulkError(null) }

  const toggle = (caseId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(caseId)) next.delete(caseId)
      else if (next.size < BULK_CAP) next.add(caseId)
      else toast.warn(`Bulk decisions are capped at ${BULK_CAP} cases.`)
      return next
    })
  }

  const selectPage = () => {
    const ids = queue.items.slice(0, BULK_CAP).map((r: any) => String(r.caseId))
    setSelected(new Set(ids))
    if (queue.items.length > BULK_CAP) toast.info(`Selected the first ${BULK_CAP} — that's the server's limit.`)
  }

  /* Teaching is a SILENT no-op for chat and live chat: the response still says
     success. Force the switch off rather than promise a training write that
     never happens. */
  const redactedSelected = React.useMemo(
    () => queue.items.some((r: any) => selected.has(String(r.caseId)) && isRedactedType(r.entityType)),
    [queue.items, selected],
  )

  const runBulk = async (action: 'APPROVE' | 'REJECT') => {
    const caseIds = [...selected]
    if (!caseIds.length) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      const res = await withStepUpAction(() => api.moderation.review.bulk({
        action, caseIds, reason: reason.trim() || undefined, teachModel: !redactedSelected && teach,
      }))
      const rows: any[] = Array.isArray(res) ? res : []
      const failed = rows.filter(r => r?.outcome !== 'ok')
      if (failed.length) setResults(rows)
      else {
        toast.ok(`${caseIds.length} case${caseIds.length === 1 ? '' : 's'} ${action === 'APPROVE' ? 'approved' : 'rejected'}`)
        clearSelection()
        setReason('')
      }
      await queue.refresh()
    } catch (e: any) {
      /* A dismissed step-up prompt is a decision, not a failure — show nothing. */
      if (!isCancelled(e)) setBulkError(e)
    } finally {
      setBulkBusy(false)
    }
  }

  const retryFailed = async () => {
    const ids = (results || []).filter(r => r?.outcome !== 'ok').map(r => String(r.caseId))
    setResults(null)
    setSelected(new Set(ids))
    if (ids.length) toast.info(`${ids.length} left to retry.`)
  }

  /* Optimistic quick decision: patch the row, roll it back on failure. Single
     decides need no step-up, which is what makes a swipe reasonable here. */
  const quickDecide = useEvent(async (row: any, action: 'APPROVE' | 'REJECT') => {
    const key = String(row.caseId)
    const before = row.status
    fireHaptic(action === 'APPROVE' ? 'success' : 'warning')
    queue.patch(key, r => ({ ...r, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', _pending: true }))
    try {
      await api.moderation.review.decide(key, { action })
      queue.patch(key, r => ({ ...r, _pending: false }))
    } catch (e: any) {
      queue.patch(key, r => ({ ...r, status: before, _pending: false }))
      toast.error(codeOf(e) ? `Couldn't decide that case.` : 'Could not reach the server.')
    }
  })

  /* Row-first and identity-stable: one instance of each handler serves every
     cell, so QueueRow's memo only misses on the rows whose own scalars moved. */
  const onRowPress = useEvent((row: any) => {
    if (selecting) { toggle(String(row.caseId)); return }
    router.push({ pathname: '/admin/moderation/case/[caseId]', params: { caseId: String(row.caseId) } })
  })
  const onRowLongPress = useEvent((row: any) => {
    if (selecting) return
    fireHaptic('medium')
    setSelecting(true)
    toggle(String(row.caseId))
  })
  const onApprove = useEvent((row: any) => { void quickDecide(row, 'APPROVE') })
  const onReject = useEvent((row: any) => { void quickDecide(row, 'REJECT') })

  /* `selected` is a Set, so the row is handed the derived BOOLEAN — a Set prop
     would break the memo for every row on every selection tap. */
  const renderRow = React.useCallback(({ item }: { item: any }) => (
    <QueueRow
      row={item}
      selecting={selecting}
      selected={selected.has(String(item.caseId))}
      onPress={onRowPress}
      onLongPress={onRowLongPress}
      onApprove={onApprove}
      onReject={onReject}
    />
  ), [selecting, selected, onRowPress, onRowLongPress, onApprove, onReject])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + (selecting ? 180 : 32) }),
    [insets.bottom, selecting],
  )

  return (
    <Screen background="sunken">
      <Header
        back
        title={selecting ? `${selected.size} selected` : 'Review queue'}
        actions={selecting ? [] : [
          { icon: 'stats', onPress: () => router.push('/admin/moderation/metrics'), label: 'Moderation health' },
          { icon: 'more', onPress: menu.open, label: 'More' },
        ]}
      />

      {/* ---- header block ---- */}
      {selecting ? (
        <View style={[styles.selectBar, { backgroundColor: c.surface, borderBottomColor: c.separator }]}>
          <Button label="Select all on page" onPress={selectPage} variant="ghost" size="sm" />
          <View style={styles.flex} />
          <Button label="Cancel" onPress={clearSelection} variant="ghost" size="sm" />
        </View>
      ) : (
        <View style={[styles.headerBlock, { backgroundColor: c.bg, borderBottomColor: c.separator }]}>
          <View style={styles.tiles}>
            <Tile label="In review" value={counts.inReview ?? 0} />
            <Tile label="Pending" value={counts.pending ?? 0} />
            <Tile label="SLA breached" value={counts.slaBreached ?? 0} tone={counts.slaBreached ? 'danger' : 'neutral'} />
          </View>
          <View style={styles.countCaption}>
            <Text variant="micro" tone="faint" align="ui" style={styles.flex}>
              Counts are platform-wide, not filtered
            </Text>
            {!health.loading ? (
              <Touchable onPress={() => setShowWarning(v => !v)} feedback="dim" noAutoHitSlop>
                <View style={styles.health}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: inferenceUp ? c.success : c.danger }} />
                  <Text variant="micro" tone={inferenceUp ? 'muted' : 'danger'}>
                    {inferenceUp ? 'model up' : 'model down'}
                  </Text>
                </View>
              </Touchable>
            ) : null}
          </View>

          <SegmentedControl
            options={STATUS_OPTIONS}
            value={status}
            onChange={v => { clearSelection(); setStatus(v) }}
            style={{ marginHorizontal: space.lg, marginTop: space.sm }}
          />

          <ChipRail style={{ marginTop: space.sm2, marginBottom: space.sm2 }}>
            <Chip
              label={entityType ? capitalise((ENTITY_LABEL as Record<string, string>)[entityType] ?? entityType) : 'Type'}
              icon="filter"
              selected={!!entityType}
              tone={slaBreached ? 'neutral' : 'accent'}
              size="sm"
              onPress={slaBreached ? undefined : typeSheet.open}
              style={slaBreached ? { opacity: t.alpha.disabled } : undefined}
            />
            <Chip
              label="SLA breached"
              icon="hourglass"
              selected={slaBreached}
              size="sm"
              onPress={() => {
                clearSelection()
                setSlaBreached(v => {
                  /* The server ignores entityType under slaBreached; clearing it
                     keeps the chips honest about what was asked. */
                  if (!v) setEntityType('')
                  return !v
                })
              }}
            />
            <Chip
              label={sort === 'oldest' ? 'Oldest first' : 'Risk first'}
              icon="sort"
              size="sm"
              onPress={sortSheet.open}
            />
          </ChipRail>

          {slaBreached ? (
            <Text variant="micro" tone="faint" align="ui" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              SLA filter replaces the type filter
            </Text>
          ) : null}
        </View>
      )}

      {showWarning && !inferenceUp ? (
        <WarningBanner
          text={settings.data?.warning || 'The inference service is not answering.'}
          style={{ marginHorizontal: space.lg, marginTop: space.sm2 }}
        />
      ) : null}

      {queue.loading ? (
        <View>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={[styles.skeleton, { borderBottomColor: c.separator }]}>
              <Skeleton width={44} height={44} radius={10} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="46%" height={12} />
                <Skeleton width="88%" height={11} />
                <Skeleton width="62%" height={10} />
              </View>
            </View>
          ))}
        </View>
      ) : queue.error && !queue.items.length ? (
        <ErrorState error={queue.error} onRetry={queue.reload} title="Couldn't load the queue" />
      ) : (
        <FlashList
          data={queue.items}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          extraData={`${selecting}:${selected.size}`}
          contentContainerStyle={contentStyle}
          onEndReached={queue.loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={queue.refreshing}
              onRefresh={() => { void queue.refresh(); void health.refresh() }}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          ListHeaderComponent={PreviewNote}
          ListEmptyComponent={
            <EmptyState
              icon="archive"
              title="Nothing to review"
              message="The queue is clear for this filter."
              actionLabel={filtersActive ? 'Clear filters' : undefined}
              onAction={() => { setStatus('IN_REVIEW'); setEntityType(''); setSlaBreached(false); setSort('risk') }}
            />
          }
          ListFooterComponent={
            queue.items.length ? (
              <ListFooter
                loading={queue.loadingMore}
                error={queue.items.length ? queue.error : null}
                onRetry={queue.loadMore}
                done={queue.done}
              />
            ) : null
          }
        />
      )}

      {/* ---- bulk bar ---- */}
      {selecting ? (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          {bulkError ? <ErrorStrip error={bulkError} style={{ marginBottom: space.sm }} /> : null}
          <Field
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (shown in the audit trail)"
            maxLength={500}
            containerStyle={{ marginBottom: space.sm }}
          />
          <View style={styles.bulkRow}>
            <Touchable
              onPress={() => { if (!redactedSelected) setTeach(v => !v) }}
              disabled={redactedSelected}
              feedback="dim"
              noAutoHitSlop
              style={styles.teachRow}
            >
              <Icon
                name={teach && !redactedSelected ? 'checkCircle' : 'add'}
                size={18}
                color={redactedSelected ? c.textFaint : teach ? c.accent : c.textMuted}
                filled={teach && !redactedSelected}
              />
              <Text variant="footnote" tone={redactedSelected ? 'faint' : 'secondary'} align="ui">
                Teach the model
              </Text>
            </Touchable>
            <Button
              label="Reject"
              onPress={() => confirm.open({ action: 'REJECT' })}
              variant="danger"
              size="md"
              disabled={!selected.size || bulkBusy}
            />
            <Button
              label="Approve"
              onPress={() => confirm.open({ action: 'APPROVE' })}
              variant="primary"
              size="md"
              disabled={!selected.size || bulkBusy}
              loading={bulkBusy}
            />
          </View>
          {redactedSelected ? (
            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
              Not available for private messages
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ---- sheets ---- */}
      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title="Moderation"
        actions={[
          { label: 'Decision engine', icon: 'settings', onPress: () => router.push('/admin/moderation/settings') },
          { label: 'Classifier', icon: 'robot', onPress: () => router.push('/admin/moderation/model') },
          { label: 'Reports & flags', icon: 'flag', onPress: () => router.push('/admin/moderation/inbox') },
          { label: 'Blocklist', icon: 'key', onPress: () => router.push('/admin/moderation/blocklist') },
          { label: 'Training data', icon: 'library', onPress: () => router.push('/admin/moderation/training') },
        ]}
      />

      <ActionSheet
        visible={typeSheet.visible}
        onClose={typeSheet.close}
        title="Content type"
        actions={[
          { label: 'Any type', icon: 'list', onPress: () => setEntityType('') },
          ...(MODERATED_ENTITY_TYPES as string[]).map(key => ({
            label: capitalise((ENTITY_LABEL as Record<string, string>)[key] ?? key),
            subtitle: entityType === key ? 'Current' : undefined,
            onPress: () => { clearSelection(); setEntityType(key) },
          })),
        ]}
      />

      <ActionSheet
        visible={sortSheet.visible}
        onClose={sortSheet.close}
        title="Sort"
        subtitle="Anything other than 'oldest' means risk-first server-side."
        actions={[
          { label: 'Risk first', icon: 'trending', subtitle: sort === 'risk' ? 'Current' : undefined, onPress: () => setSort('risk') },
          { label: 'Oldest first', icon: 'clock', subtitle: sort === 'oldest' ? 'Current' : undefined, onPress: () => setSort('oldest') },
        ]}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={confirm.payload?.action === 'REJECT' ? `Reject ${selected.size} case${selected.size === 1 ? '' : 's'}?` : `Approve ${selected.size} case${selected.size === 1 ? '' : 's'}?`}
        message={
          confirm.payload?.action === 'REJECT'
            ? 'The authors are notified and the content stays hidden.'
            : 'The content becomes visible to everyone.'
        }
        confirmLabel={confirm.payload?.action === 'REJECT' ? 'Reject' : 'Approve'}
        destructive={confirm.payload?.action === 'REJECT'}
        loading={bulkBusy}
        onConfirm={() => {
          const action = confirm.payload?.action
          confirm.close()
          if (action) void runBulk(action)
        }}
      />

      <Sheet
        visible={!!results}
        onClose={() => setResults(null)}
        title="Bulk results"
        subtitle="Per-item failures never fail the call."
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm2 }}>
            <Button label="Done" onPress={() => { setResults(null); clearSelection() }} variant="secondary" size="lg" style={{ flex: 1 }} />
            <Button label="Retry failed" onPress={retryFailed} variant="primary" size="lg" style={{ flex: 1 }} />
          </View>
        }
      >
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.xs2 }}>
          {(results || []).map((r: any, i: number) => (
            <View key={String(r?.caseId ?? i)} style={styles.resultRow}>
              <Icon
                name={r?.outcome === 'ok' ? 'checkCircle' : 'error'}
                size={17}
                color={r?.outcome === 'ok' ? c.success : c.danger}
              />
              <View style={styles.flex}>
                <MonoChip label={String(r?.caseId ?? '')} />
                {/* A raw exception message, not an errorCode — text is all it is. */}
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

/* ---------------------------------------------------------
   The row. Memoized, and every handler is ROW-FIRST so the
   screen can hand the same function to all 50 cells — a fresh
   arrow per row would make the memo useless.
   --------------------------------------------------------- */

const QueueRow = React.memo(function QueueRow({
  row, selecting, selected, onPress, onLongPress, onApprove, onReject,
}: {
  row: any
  selecting: boolean
  selected: boolean
  onPress: (row: any) => void
  onLongPress: (row: any) => void
  onApprove: (row: any) => void
  onReject: (row: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const swipe = React.useRef<any>(null)

  const type = entityTypeName(row?.entityType)
  const noun = (ENTITY_LABEL as Record<string, string>)[type] ?? type.toLowerCase()
  const score = Number(row?.topScore ?? 0)
  const rule = score >= 0.8 ? c.danger : score >= 0.5 ? c.warning : c.border
  const redacted = isRedactedType(row?.entityType)
  const decided = row?.status === 'APPROVED' || row?.status === 'REJECTED'

  const body = (
    <View
      style={[
        styles.row,
        {
          backgroundColor: selected ? c.accentSofter : c.bg,
          borderBottomColor: c.separator,
          opacity: decided ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.rowRule, { backgroundColor: rule }]} />

      {selecting ? (
        <View style={styles.check}>
          {selected
            ? <Icon name="checkCircle" size={22} color={c.accent} filled />
            : <View style={[styles.hollow, { borderColor: c.borderStrong }]} />}
        </View>
      ) : (
        <View style={[styles.glyph, { backgroundColor: c.surfaceSunken }]}>
          <Text variant="title3" tone="muted" align="center">{noun.charAt(0).toUpperCase()}</Text>
        </View>
      )}

      <View style={styles.flex}>
        <View style={styles.rowHead}>
          <Text variant="subhead" weight="700" align="ui" numberOfLines={1}>{capitalise(noun)}</Text>
          <MonoChip label={REASON_LABEL[String(row?.reasonCode)] ?? String(row?.reasonCode ?? '')} />
          {row?.slaBreached ? (
            <View style={[styles.slaPill, { backgroundColor: c.warningSoft }]}>
              <Text variant="micro" color={c.warningText}>SLA</Text>
            </View>
          ) : null}
        </View>

        {redacted ? (
          <View style={styles.lockRow}>
            <Icon name="lock" size={12} color={c.textFaint} />
            <Text variant="caption" tone="faint" italic align="ui" numberOfLines={1} style={styles.flex}>
              {MODERATION_REDACTED}
            </Text>
          </View>
        ) : (
          <Text variant="footnote" tone="secondary" align="auto" numberOfLines={2} style={{ marginTop: space.xxs }}>
            {row?.preview || '—'}
          </Text>
        )}

        <View style={styles.metaRow}>
          <Text variant="caption" tone="faint" align="ui" numberOfLines={1} style={styles.flex}>
            {row?.topLabel ? `${row.topLabel} ${score.toFixed(3)} · ` : ''}
            {row?.modelVersion ? `${row.modelVersion} · ` : ''}
            {adapters.timeAgo(row?.submittedAt)}
          </Text>
          {Number(row?.authorPriorRejections) > 0 ? (
            <View style={[styles.slaPill, { backgroundColor: c.warningSoft }]}>
              <Text variant="micro" color={c.warningText}>{row.authorPriorRejections} prior</Text>
            </View>
          ) : null}
        </View>
      </View>

      {!selecting ? <Icon name="forward" size={15} color={c.textFaint} /> : null}
    </View>
  )

  const pressable = (
    <Touchable
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      delayLongPress={420}
      feedback="tint"
      noAutoHitSlop
    >
      {body}
    </Touchable>
  )

  /* Swipeable diffs its action renderers by identity — rebuilding them per
     render re-registers the pane on every parent pass. */
  const leftActions = React.useCallback(() => (
    <SwipeAction label="Approve" icon="check" tint={c.success} onPress={() => { swipe.current?.close(); onApprove(row) }} />
  ), [c.success, onApprove, row])
  const rightActions = React.useCallback(() => (
    <SwipeAction label="Reject" icon="close" tint={c.danger} onPress={() => { swipe.current?.close(); onReject(row) }} />
  ), [c.danger, onReject, row])

  if (selecting) return pressable

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={leftActions}
      renderRightActions={rightActions}
    >
      {pressable}
    </ReanimatedSwipeable>
  )
})

function SwipeAction({
  label, icon, tint, onPress,
}: { label: string; icon: 'check' | 'close'; tint: string; onPress: () => void }) {
  const t = useTheme()
  return (
    <Touchable
      onPress={onPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.swipeAction, { backgroundColor: tint }]}
    >
      <Icon name={icon} size={20} color={t.colors.textOnAccent} />
      <Text variant="micro" color={t.colors.textOnAccent}>{label}</Text>
    </Touchable>
  )
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerBlock: { borderBottomWidth: StyleSheet.hairlineWidth },
  tiles: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm2 },
  countCaption: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs2 },
  health: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm2,
    paddingVertical: space.xs2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewNote: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    minHeight: 108,
    paddingEnd: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowRule: { width: 4, alignSelf: 'stretch', borderTopEndRadius: 2, borderBottomEndRadius: 2 },
  glyph: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  check: { width: 44, alignItems: 'center' },
  hollow: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs },
  slaPill: { paddingHorizontal: space.xs2, paddingVertical: space.xxs, borderRadius: 6 },
  skeleton: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    height: 108,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swipeAction: { width: 84, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  bulkBar: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  teachRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flex: 1 },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingVertical: space.sm },
})
