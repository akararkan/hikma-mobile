/* =========================================================
   Your activity — the private, self-only action history.

   Paging here is NOT `page`. The server ignores it and hands
   back the same newest window for any value, so the list pages
   backwards with the `to` bound, which is INCLUSIVE: every
   older page re-emits the row you already have. usePaged's
   dedupe drops it, and a page that carries nothing BUT that
   duplicate is how the end of history announces itself.

   Everything on a row is server-rendered. `label` and
   `subtitle` are printed verbatim — there is deliberately no
   client-side enum→copy table, because the server already owns
   that copy in the user's language.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isClientBug, isNetworkError, isNotFound, isTransient, logApiError } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, ConfirmSheet, EmptyState, ErrorState, Header, Icon, InlineError,
  Screen, Spinner, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ActivityRow } from '@/components/notifications/ActivityRow'
import { FilterChipRail } from '@/components/notifications/FilterChipRail'
import {
  ActivitySkeleton, DateSectionHeader, NewItemsPill,
} from '@/components/notifications/ListParts'
import { SwipeableRow } from '@/components/notifications/SwipeableRow'
import { ACTIVITY_GROUPS, activityTypeLabel, localDay } from '@/components/notifications/constants'
import type { ActivityItem, ReelWatch } from '@/components/notifications/types'

type ListItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; row: ActivityItem }

interface Confirm {
  title: string
  message: string
  label: string
  run: () => Promise<void>
}

/* The api modules are JS: TypeScript infers their option bags from the
   destructuring defaults, so the filter keys (no default, hence no inferred
   type) drop out of the signature. This restores the contract that
   api/activity.js documents. */
const listActivity = api.activity.list as (
  args: { types?: string[]; from?: string; to?: string; size?: number; signal?: AbortSignal },
) => Promise<ActivityItem[]>

/* Module scope, like every other list in the app: a fresh arrow here is a new
   prop identity on every render, and FlashList compares these by reference. */
const keyExtractor = (item: ListItem) => item.key
const getItemType = (item: ListItem) => item.kind

const PAGE_SIZE = 30
/** DELETE /users/me/activity is capped per call. `deleted === CAP` means
 *  "call again", not "done" — the banner says so rather than claiming success. */
const CLEAR_CAP = 10000
const PILL_OFFSET = 100

export default function ActivityScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const params = useLocalSearchParams<{ types?: string; from?: string; to?: string }>()
  const paramTypes = String(params.types || '')
  const paramFrom = String(params.from || '')
  const paramTo = String(params.to || '')

  const [types, setTypes] = React.useState<string[]>(() => paramTypes.split(',').filter(Boolean))
  const [from, setFrom] = React.useState<string | null>(paramFrom || null)
  const [to, setTo] = React.useState<string | null>(paramTo || null)

  const [newCount, setNewCount] = React.useState(0)
  const [clearing, setClearing] = React.useState(false)
  const [clearedTotal, setClearedTotal] = React.useState(0)
  const [capReached, setCapReached] = React.useState(false)

  const listRef = React.useRef<FlashListRef<ListItem>>(null)
  const offset = React.useRef(0)
  const [chromeHeight, setChromeHeight] = React.useState(0)

  const overflow = useSheetState()
  const clearMenu = useSheetState()
  const rowMenu = useSheetState<ActivityItem>()
  const confirm = useSheetState<Confirm>()

  /* The filter modal navigates back with params rather than mutating shared
     state, so this is the single point where they land. */
  React.useEffect(() => {
    setTypes(paramTypes.split(',').filter(Boolean))
    setFrom(paramFrom || null)
    setTo(paramTo || null)
  }, [paramTypes, paramFrom, paramTo])

  const typesKey = types.join(',')
  const filtersActive = types.length > 0 || !!from || !!to

  const groupKey = React.useMemo(() => {
    if (!types.length) return 'all'
    const g = ACTIVITY_GROUPS.find(x => x.types.length === types.length && x.types.every(y => types.includes(y)))
    return g ? g.key : 'custom'
  }, [types])

  const fetchPage = React.useCallback(async ({ cursor, pageSize, signal }: { cursor?: string | null; pageSize: number; signal: AbortSignal }) => {
    const upper = cursor ?? to ?? undefined
    const rows = await listActivity({
      types,
      from: from ?? undefined,
      to: upper,
      size: pageSize,
      signal,
    })

    const oldest = rows.length ? rows[rows.length - 1].createdAt : null
    /* No progress means the window is exhausted: `to` is inclusive, so a page
       whose oldest row is the bound itself would otherwise loop forever. */
    const next = !rows.length || !oldest || oldest === cursor ? null : oldest
    return { items: rows, nextCursor: next }
  }, [types, from, to])

  const {
    items, error, loading, refreshing, loadingMore, done,
    loadMore, refresh, reload, setItems, remove, prepend,
  } = usePaged<ActivityItem>(fetchPage, {
    mode: 'cursor',
    pageSize: PAGE_SIZE,
    deps: [typesKey, from, to],
  })

  /* The watched-reels card is a header, not a filterable row — it is hidden
     (and its request skipped) the moment a filter narrows the list. */
  const reelsCard = useAsync<{ items: ReelWatch[]; total: number | null }>(
    () => api.reels.watched({ size: 3 }),
    { enabled: !filtersActive },
  )

  /* ---------- 400 VALIDATION_FAILED is OUR bug, not the user's ---------- */

  React.useEffect(() => {
    if (!error || !isClientBug(error)) return
    logApiError(error, 'GET', '/api/v1/users/me/activity')
    setTypes([]); setFrom(null); setTo(null)
    toast.error("Something went wrong with those filters — they've been reset.")
  }, [error])

  const autoRetried = React.useRef(false)
  React.useEffect(() => {
    if (!error) { autoRetried.current = false; return }
    if (!isTransient(error) || autoRetried.current || items.length) return
    autoRetried.current = true
    const id = setTimeout(() => { void reload() }, 3000)
    return () => clearTimeout(id)
  }, [error, items.length, reload])

  /* ---------- live stream, scoped to focus ---------- */

  const refetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current) }, [])

  const handleLive = useEvent((row: ActivityItem) => {
    /* When the server omits the compact `activity` mirror, activityFrom()
       degrades the flat event to label:'Activity', no subtitle, no time and no
       deepLink. Prepending that would paint a blank row, so it triggers a
       refetch of the newest window instead. */
    const unenriched = row.label === 'Activity' && !row.subtitle
    if (unenriched) {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => { void refresh() }, 800)
      return
    }
    if (types.length && row.type && !types.includes(row.type)) return
    /* A `to` bound means the user is reading history, not watching the present. */
    if (to) return
    if (items.some(r => r.id === row.id)) return
    if (offset.current < PILL_OFFSET) prepend(row)
    else setNewCount(n => n + 1)
  })

  useFocusEffect(React.useCallback(() => {
    /* Unlike the notification stream this one has no shared manager and no
       server timeout, so it lives and dies with the screen. */
    const off = api.activity.stream({ onActivity: handleLive, onError: () => { /* self-healing by design */ } })
    return () => off?.()
  }, [handleLive]))

  /* ---------- mutations ---------- */

  const removeRow = React.useCallback(async (row: ActivityItem) => {
    const index = items.findIndex(r => r.id === row.id)
    remove(row.id)
    try {
      await api.activity.remove(row.id)
    } catch (e: any) {
      /* 404 = already gone, so the optimistic removal was right. Anything else
         (403 on a row that is not yours) puts it back and quotes the server. */
      if (isNotFound(e)) return
      setItems(prev => {
        const at = index < 0 ? prev.length : Math.min(index, prev.length)
        return [...prev.slice(0, at), row, ...prev.slice(at)]
      })
      toast.error(errorText(e))
    }
  }, [items, remove, setItems])

  const runClear = React.useCallback(async (type?: string) => {
    setClearing(true)
    try {
      const res: any = await api.activity.clear(type)
      const deleted = Number(res?.deleted ?? 0)
      setClearedTotal(prev => prev + deleted)
      setCapReached(deleted === CLEAR_CAP)
      if (deleted === CLEAR_CAP) {
        /* Documented cap, not a failure — the banner offers the next call. */
        void reload()
      } else {
        setItems([])
        toast.ok(`${deleted} ${deleted === 1 ? 'entry' : 'entries'} cleared`)
      }
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setClearing(false)
    }
  }, [reload, setItems])

  /* ---------- navigation ---------- */

  /* Item-first and identity-stable, so ONE function serves every row and
     renderItem's identity survives a page append — `removeRow` alone is
     re-created whenever `items` moves, and a renderItem that listed it would
     re-arm the swipe gesture on every mounted row mid-scroll. */
  const openRow = useEvent((row: ActivityItem) => { if (row.deepLink) router.push(row.deepLink as any) })
  const onRowLongPress = useEvent((row: ActivityItem) => rowMenu.open(row))
  const onRowRemove = useEvent((row: ActivityItem) => { void removeRow(row) })

  const openFilter = () => router.push({
    pathname: '/(app)/activity/filter',
    params: { types: typesKey, from: from ?? '', to: to ?? '' },
  } as any)

  const pickGroup = (key: string) => {
    const g = ACTIVITY_GROUPS.find(x => x.key === key)
    setTypes(g ? g.types : [])
    setNewCount(0)
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

  const clearRange = () => { setFrom(null); setTo(null) }

  /* ---------- list assembly ---------- */

  const data = React.useMemo<ListItem[]>(() => {
    const out: ListItem[] = []
    const seen = new Set<string>()
    let day = ''
    for (const row of items) {
      if (!row?.id || seen.has(row.id)) continue
      seen.add(row.id)
      const d = row.date || localDay(row.createdAt) || 'Earlier'
      /* Index-qualified so a prepended row that re-opens a day cannot collide
         with the header already in the list. */
      if (d !== day) { day = d; out.push({ kind: 'header', key: `h:${d}:${out.length}`, title: d }) }
      out.push({ kind: 'row', key: row.id, row })
    }
    return out
  }, [items])

  const stickyIndices = React.useMemo(
    () => data.reduce<number[]>((acc, it, i) => { if (it.kind === 'header') acc.push(i); return acc }, []),
    [data],
  )

  const offline = isNetworkError(error) && items.length > 0
  const rangeLabel = from || to ? `${shortDate(from) || 'Any'} – ${shortDate(to) || 'Any'}` : null

  /* Re-created only when something a row actually renders moves: the swipe
     lock and the action tint. ActivityRow's memo then absorbs every row the
     list did not touch, so a refresh or a bulk-clear tick no longer re-runs a
     gesture-handler + Reanimated setup for the whole viewport. */
  const renderItem = React.useCallback(({ item }: { item: ListItem }) => {
    if (item.kind === 'header') return <DateSectionHeader title={item.title} />
    const row = item.row
    return (
      <SwipeableRow
        resetKey={String(row.id)}
        enabled={!offline && !clearing}
        trailing={[{ label: 'Remove', icon: 'trash', tint: c.danger, onTrigger: () => onRowRemove(row) }]}
      >
        <ActivityRow row={row} onPress={openRow} onLongPress={onRowLongPress} />
      </SwipeableRow>
    )
  }, [offline, clearing, c.danger, onRowRemove, openRow, onRowLongPress])

  const header = (
    <View>
      {capReached ? (
        <View style={[styles.capCard, { backgroundColor: c.warningSoft, borderColor: c.warning }]}>
          <View style={styles.flex}>
            <Text variant="subhead" weight="600" align="ui">
              Cleared {clearedTotal.toLocaleString()} entries (the per-call limit).
            </Text>
            <Text variant="footnote" tone="secondary" align="ui" style={styles.capBody}>
              Older entries are still there. Run it again to keep going.
            </Text>
          </View>
          <Button label="Continue clearing" size="sm" variant="tinted" loading={clearing} onPress={() => void runClear()} />
        </View>
      ) : null}

      {!filtersActive ? (
        <Touchable
          onPress={() => router.push('/(app)/activity/reels' as any)}
          feedback="tint"
          noAutoHitSlop
          accessibilityLabel="Watched reels"
          style={[styles.reelsCard, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <View style={styles.thumbStack}>
            {(reelsCard.data?.items ?? []).slice(0, 3).map((r, i) => (
              <View
                key={r.id}
                style={[
                  styles.thumb,
                  {
                    borderColor: c.surface,
                    backgroundColor: c.surfaceSunken,
                    marginStart: i === 0 ? 0 : -14,
                    height: 56 - i * 6,
                    zIndex: 3 - i,
                  },
                ]}
              >
                {r.thumb ? (
                  <Image source={{ uri: r.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} recyclingKey={r.id} cachePolicy="memory-disk" />
                ) : null}
              </View>
            ))}
            {!(reelsCard.data?.items ?? []).length ? (
              <View style={[styles.thumb, { borderColor: c.surface, backgroundColor: c.surfaceSunken }]}>
                <View style={styles.center}><Icon name="reels" size={18} color={c.textFaint} /></View>
              </View>
            ) : null}
          </View>

          <View style={styles.reelsText}>
            <Text variant="body" weight="600" align="ui">Watched reels</Text>
            {/* No count here on purpose: the Page envelope's totalElements
                reflects ONLY the returned window (activity.md §5.2) — with
                size=3 it would claim "3 reels" for any history of three or
                more. There is no honest total to print. */}
          </View>
          <Icon name="forward" size={20} color={c.textFaint} />
        </Touchable>
      ) : null}
    </View>
  )

  const empty = filtersActive ? (
    <EmptyState
      icon="filter"
      title="Nothing for these filters"
      message={from || to ? 'Try a wider date range.' : 'No history matches the types you picked.'}
      actionLabel="Clear filters"
      onAction={() => { setTypes([]); clearRange() }}
    />
  ) : (
    <EmptyState
      icon="history"
      title="No activity yet"
      message="Everything you do on Hikmah Web — reactions, comments, searches, follows — will be listed here, privately."
    />
  )

  return (
    <Screen>
      <View onLayout={e => setChromeHeight(e.nativeEvent.layout.height)}>
        <Header
          back
          title="Your activity"
          actions={[{ icon: 'more', onPress: () => overflow.open(), label: 'More' }]}
          below={
            <>
              <FilterChipRail
                options={ACTIVITY_GROUPS}
                value={groupKey}
                onChange={pickGroup}
                trailing={
                  <Touchable
                    onPress={openFilter}
                    haptic="select"
                    feedback="scale"
                    noAutoHitSlop
                    accessibilityLabel="More filters"
                    style={[styles.filterChip, { borderColor: c.border }]}
                  >
                    <Icon name="filter" size={15} color={c.textSecondary} />
                    <Text variant="subhead" weight="600" tone="secondary" align="ui">Filter</Text>
                    {groupKey === 'custom' || from || to ? (
                      <View style={[styles.dot, { backgroundColor: c.accent }]} />
                    ) : null}
                  </Touchable>
                }
              />
              {rangeLabel ? (
                <View style={styles.rangeRow}>
                  <Touchable
                    onPress={clearRange}
                    feedback="scale"
                    noAutoHitSlop
                    accessibilityLabel="Clear date range"
                    style={[styles.rangeChip, { backgroundColor: c.accentSoft }]}
                  >
                    <Text variant="footnote" tone="accent" align="ui">{rangeLabel}</Text>
                    <Icon name="close" size={14} color={c.accentText} />
                  </Touchable>
                </View>
              ) : null}
            </>
          }
        />
      </View>

      {offline ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn}
          exiting={t.prefs.reducedMotion ? undefined : FadeOut}
          style={[styles.offline, { backgroundColor: c.warningSoft }]}
        >
          <Icon name="offline" size={14} color={c.warningText} />
          <Text variant="footnote" tone="warning" align="ui">
            You&apos;re offline — showing your last loaded activity.
          </Text>
        </Animated.View>
      ) : null}

      {clearing ? (
        <View style={styles.clearingRow}>
          <Spinner label={`Clearing… ${clearedTotal.toLocaleString()} removed`} />
        </View>
      ) : null}

      {/* Chrome above the list, never ListHeaderComponent: a list header's
          height becomes firstItemOffset, and FlashList's mount-time sticky
          compute pins a phantom copy of the first date header over it until
          the first scroll — the same bug the notifications banner had. */}
      {header}

      {loading ? <ActivitySkeleton /> : error && !items.length && !isClientBug(error) ? (
        <ErrorState
          error={error}
          onRetry={reload}
          title={isTransient(error) ? 'Your history is temporarily unavailable.' : "Couldn't load your activity"}
        />
      ) : (
        <FlashList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          stickyHeaderIndices={stickyIndices}
          ListEmptyComponent={empty}
          onScroll={e => { offset.current = e.nativeEvent.contentOffset.y }}
          scrollEventThrottle={32}
          /* Every sibling feed is infinite; the footer button survives as the
             retry/afterthought affordance. */
          onEndReached={() => { if (!offline && !loadingMore && !done) loadMore() }}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          style={clearing ? styles.dimmed : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setNewCount(0); void refresh(); void reelsCard.refresh() }}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {items.length && !done ? (
                <Button
                  label={loadingMore ? 'Loading…' : 'Load older'}
                  variant="ghost"
                  size="md"
                  block
                  loading={loadingMore}
                  disabled={offline || loadingMore}
                  onPress={loadMore}
                />
              ) : items.length ? (
                <Text variant="footnote" tone="faint" align="center">That&apos;s the start of your history.</Text>
              ) : null}

              {error && items.length ? <InlineError error={error} onRetry={loadMore} /> : null}

              <Text variant="footnote" tone="faint" align="center" style={styles.privacy}>
                Only you can see your activity. Clearing it here does not delete your posts,
                comments or reactions.
              </Text>
            </View>
          }
        />
      )}

      <NewItemsPill
        count={newCount}
        top={chromeHeight + 8}
        onPress={() => { setNewCount(0); listRef.current?.scrollToOffset({ offset: 0, animated: true }); void refresh() }}
      />

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title="Your activity"
        actions={[
          { label: 'Filter…', icon: 'filter', onPress: openFilter },
          { label: 'Watched reels', icon: 'reels', onPress: () => router.push('/(app)/activity/reels' as any) },
          {
            label: 'Clear history…',
            icon: 'trash',
            destructive: true,
            disabled: offline || clearing,
            onPress: () => clearMenu.open(),
          },
        ]}
      />

      <ActionSheet
        visible={clearMenu.visible}
        onClose={clearMenu.close}
        title="Clear history"
        actions={[
          {
            label: 'Clear everything',
            icon: 'trash',
            destructive: true,
            onPress: () => confirm.open({
              title: 'Clear your activity history?',
              message: "This can't be undone. It removes your private history only — your posts, comments and reactions stay exactly where they are.",
              label: 'Clear',
              run: () => runClear(),
            }),
          },
          types.length === 1 ? {
            label: `Clear only ${activityTypeLabel(types[0])}`,
            icon: 'trash',
            destructive: true,
            onPress: () => confirm.open({
              title: `Clear ${activityTypeLabel(types[0])}?`,
              message: "This can't be undone. Only this kind of entry is removed from your private history.",
              label: 'Clear',
              run: () => runClear(types[0]),
            }),
          } : null,
        ]}
      />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.label}
        subtitle={rowMenu.payload?.subtitle || undefined}
        actions={rowMenu.payload ? [
          rowMenu.payload.deepLink ? { label: 'Open', icon: 'external', onPress: () => openRow(rowMenu.payload!) } : null,
          { label: 'Remove from history', icon: 'trash', destructive: true, onPress: () => void removeRow(rowMenu.payload!) },
          rowMenu.payload.type ? {
            label: `Clear all ${activityTypeLabel(rowMenu.payload.type)}`,
            icon: 'trash',
            destructive: true,
            onPress: () => {
              const type = rowMenu.payload!.type!
              confirm.open({
                title: `Clear ${activityTypeLabel(type)}?`,
                message: "This can't be undone. Only this kind of entry is removed from your private history.",
                label: 'Clear',
                run: () => runClear(type),
              })
            },
          } : null,
        ] : []}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={confirm.payload?.title ?? ''}
        message={confirm.payload?.message}
        confirmLabel={confirm.payload?.label ?? 'Clear'}
        destructive
        loading={clearing}
        onConfirm={() => { const spec = confirm.payload; confirm.close(); void spec?.run() }}
      />
    </Screen>
  )
}

/** 'Jun 1' from an ISO instant — the active-range chip only. */
function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, height: 32 },
  clearingRow: { paddingVertical: space.xs },
  dimmed: { opacity: 0.5 },

  filterChip: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },

  rangeRow: { height: 36, justifyContent: 'center', paddingHorizontal: space.lg, paddingBottom: space.xs },
  rangeChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: space.sm2,
  },

  capCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    margin: space.lg,
    marginBottom: space.xs,
    padding: space.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  capBody: { marginTop: space.xxs },

  reelsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginVertical: space.md,
    padding: space.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 84,
  },
  thumbStack: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 40, height: 56, borderRadius: 6, borderWidth: 2, overflow: 'hidden' },
  reelsText: { flex: 1 },

  footer: { paddingHorizontal: space.lg, paddingTop: space.md },
  privacy: { paddingVertical: space.xxl },
})
