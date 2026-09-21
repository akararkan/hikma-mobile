/* =========================================================
   Calls — the history.

   There is NO server endpoint for a user's own calls (only the
   admin one), so this screen is a MERGE of two honest sources:

     · CALL_MISSED notifications, which the server does keep
     · a device-local log written on every `call.ended` and
       every successful `calls.start`

   Which is why the footer says so out loud. A history that
   silently loses everything on a reinstall, with no
   explanation, reads as a bug; one that says "kept on this
   device" reads as a decision.

   The two sources overlap: one missed call produces both a
   notification and a local row. They collapse on `callId`
   first, and on {conversation, minute} for notification rows
   that carry no call id.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { mockEnabled } from '@/mock/flag.js'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, EmptyState, Header, Icon, ListFooter, Screen,
  SegmentedControl, SkeletonList, Text, Touchable, useSheetState, toast,
} from '@/ui'
import {
  readCallLog, removeCallLog, type CallLogEntry,
} from '@/components/call/callStore'
import { clock } from '@/components/live/types'

type Filter = 'all' | 'missed'

interface Row {
  key: string
  callId: string | null
  notifId: string | null
  conversationId: string | null
  peerId: string | null
  name: string
  handle: string | null
  avatar: string | null
  type: 'VOICE' | 'VIDEO'
  direction: 'IN' | 'OUT'
  status: string
  missed: boolean
  unread: boolean
  at: number
  aggregateCount: number
  /** "4:12" when the call connected, otherwise the terminal word. */
  detail: string
}

type Item = { kind: 'header'; key: string; label: string } | ({ kind: 'row' } & Row)

/* Module scope: FlashList compares both by identity and pools recycled cells
   by item type. Inline arrows here re-render every mounted cell on every
   screen render and let a day header's React key be handed to a call row,
   which unmounts the avatar and its image instead of swapping props. */
const keyExtractor = (item: Item) => item.key
const getItemType = (item: Item) => item.kind

export default function CallsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const demo = React.useMemo(() => mockEnabled(), [])

  const [filter, setFilter] = React.useState<Filter>('all')
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)
  const [log, setLog] = React.useState<CallLogEntry[]>(() => readCallLog())
  const sheet = useSheetState<Row>()

  const missed = usePaged<any>(
    async ({ page, pageSize, signal }) => api.notifications.list({ type: 'CALL_MISSED', page, size: pageSize, signal } as any),
    { mode: 'page', pageSize: 30, keyOf: (n: any) => String(n.id) },
  )

  /* Names for local rows whose peer never passed through a cache. One page of
     conversations covers the realistic case; beyond that the row falls back to
     initials, which is legible. */
  const convos = useAsync<any>(() => api.chat.conversations.list({ page: 0, size: 30 }), { enabled: !demo })

  useFocusEffect(React.useCallback(() => { setLog(readCallLog()) }, []))

  const peers = React.useMemo(() => {
    const map: Record<string, { name: string; handle: string | null; avatar: string | null; convId: string }> = {}
    for (const cv of convos.data?.items || []) {
      if (cv?.peer?.id) {
        map[String(cv.peer.id)] = {
          name: cv.peer.full || cv.displayTitle,
          handle: cv.peer.handle || null,
          avatar: cv.peer.profileImage ?? null,
          convId: String(cv.id),
        }
      }
    }
    return map
  }, [convos.data])

  const rows = React.useMemo(() => merge(log, missed.items, peers), [log, missed.items, peers])
  /* Memoized so the filtered array keeps its identity between renders —
     otherwise `sectioned` re-runs (and the list re-keys) on every tick. */
  const shown = React.useMemo(
    () => (filter === 'missed' ? rows.filter(r => r.missed) : rows),
    [filter, rows],
  )
  const items = React.useMemo(() => sectioned(shown), [shown])
  const stickies = React.useMemo(
    () => items.map((it, i) => (it.kind === 'header' ? i : -1)).filter(i => i >= 0),
    [items],
  )

  const refresh = React.useCallback(async () => {
    setLog(readCallLog())
    await missed.refresh()
  }, [missed])

  const markRead = (row: Row) => {
    if (!row.notifId || !row.unread) return
    void api.notifications.markRead(row.notifId).catch(() => { /* 404 = already read */ })
    missed.patch(row.notifId, (n: any) => ({ ...n, unread: false }))
  }

  const callBack = async (row: Row, type: 'VOICE' | 'VIDEO') => {
    if (demo) { toast.info('Calls aren’t part of the demo fixture.'); return }
    if (!row.conversationId) { toast.warn('No conversation for this call.'); return }
    router.push({
      pathname: '/call/[id]',
      params: { id: 'new', convId: row.conversationId, type },
    })
  }

  const remove = (row: Row) => {
    if (row.callId) setLog(removeCallLog(row.callId))
    if (row.notifId) {
      const id = row.notifId
      missed.remove(id)
      void api.notifications.remove(id).catch(() => { /* already gone */ })
    }
  }

  const markAllRead = () => {
    const ids = missed.items.filter((n: any) => n.unread).map((n: any) => String(n.id))
    if (!ids.length) return
    void api.notifications.markReadBulk(ids).catch(() => {})
    missed.setItems(prev => prev.map((n: any) => ({ ...n, unread: false })))
  }

  /* ---------- row plumbing ----------
     Item-first and identity-stable, so one function serves every row and
     renderItem's identity survives a page append — FlashList's ViewHolder
     memo compares renderItem by reference. */

  const onRowPress = useEvent((row: Row) => { markRead(row); sheet.open(row) })
  const onRowLongPress = useEvent((row: Row) => sheet.open(row))
  const onRowInfo = useEvent((row: Row) => {
    markRead(row)
    if (row.conversationId) router.push(`/chat/${row.conversationId}`)
  })

  const renderItem = React.useCallback(({ item }: { item: Item }) => (
    item.kind === 'header' ? (
      <View style={[styles.dayHeader, { backgroundColor: c.bg }]}>
        <Text variant="caption" tone="muted" align="ui">{item.label}</Text>
      </View>
    ) : (
      <CallRow
        row={item}
        onPress={onRowPress}
        onLongPress={onRowLongPress}
        onInfo={onRowInfo}
      />
    )
  ), [c.bg, onRowPress, onRowLongPress, onRowInfo])

  /* React only when the collapse boolean flips, not on every scroll frame. */
  const onScroll = React.useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const next = e.nativeEvent.contentOffset.y > 8
    setCollapsed(prev => (prev === next ? prev : next))
  }, [])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 60 }),
    [insets.bottom],
  )

  const listFooter = React.useMemo(() => (
    <>
      <ListFooter loading={missed.loadingMore} done={missed.done} doneLabel="" />
      <Text variant="footnote" tone="faint" align="ui" style={styles.note}>
        History is kept on this device. Missed calls also appear in your notifications.
      </Text>
    </>
  ), [missed.loadingMore, missed.done])

  return (
    <Screen>
      <Header
        large
        title="Calls"
        collapsed={collapsed}
        back
        actions={[
          { icon: 'checkCircle', onPress: markAllRead, label: 'Mark all read' },
          { icon: 'addCircle', onPress: () => router.push('/chat'), label: 'Start a call' },
        ]}
        below={
          <View style={styles.segment}>
            <SegmentedControl<Filter>
              options={[{ value: 'all', label: 'All' }, { value: 'missed', label: 'Missed' }]}
              value={filter}
              onChange={setFilter}
            />
          </View>
        }
      />

      {missed.error ? (
        <View style={[styles.strip, { backgroundColor: c.dangerSoft }]}>
          <Icon name={isNetworkError(missed.error) ? 'offline' : 'error'} size={14} color={c.danger} />
          <Text variant="footnote" tone="danger" align="ui" style={styles.flex} numberOfLines={2}>
            {isNetworkError(missed.error)
              ? 'Offline — showing calls from this device'
              : errorText(missed.error)}
          </Text>
          <Touchable onPress={missed.reload} feedback="dim" accessibilityLabel="Retry">
            <Text variant="footnote" tone="danger" weight="700">Retry</Text>
          </Touchable>
        </View>
      ) : null}

      {missed.loading && !rows.length ? (
        <SkeletonList count={6} />
      ) : !shown.length ? (
        <EmptyState
          icon="call"
          title={filter === 'missed' ? 'No missed calls' : 'No calls yet'}
          message={
            filter === 'missed'
              ? 'Calls you miss will be listed here.'
              : 'Calls you make and receive appear here.'
          }
          actionLabel="Start a call"
          onAction={() => router.push('/chat')}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          stickyHeaderIndices={stickies}
          refreshing={missed.refreshing}
          onRefresh={refresh}
          onEndReached={missed.loadMore}
          onEndReachedThreshold={0.6}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={contentStyle}
          renderItem={renderItem}
          ListFooterComponent={listFooter}
        />
      )}

      <ActionSheet
        visible={sheet.visible}
        onClose={sheet.close}
        title={sheet.payload?.name}
        subtitle={sheet.payload?.handle ? `@${sheet.payload.handle}` : undefined}
        actions={[
          { label: 'Voice call', icon: 'call', onPress: () => sheet.payload && void callBack(sheet.payload, 'VOICE') },
          { label: 'Video call', icon: 'videoCall', onPress: () => sheet.payload && void callBack(sheet.payload, 'VIDEO') },
          {
            label: 'Open chat',
            icon: 'chat',
            hidden: !sheet.payload?.conversationId,
            onPress: () => sheet.payload?.conversationId && router.push(`/chat/${sheet.payload.conversationId}`),
          },
          {
            label: 'Delete from history',
            icon: 'trash',
            destructive: true,
            onPress: () => sheet.payload && remove(sheet.payload),
          },
        ]}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Row
   --------------------------------------------------------- */

/* Memoized on item-first handlers: the screen hands the same three functions
   to every row, so a page append or a mark-read repaints only the rows whose
   own data moved. */
const CallRow = React.memo(function CallRow({
  row, onPress, onLongPress, onInfo,
}: {
  row: Row
  onPress: (row: Row) => void
  onLongPress: (row: Row) => void
  onInfo: (row: Row) => void
}) {
  const t = useTheme()
  const c = t.colors
  const glyph = row.direction === 'OUT' ? 'forwardMsg' : 'reply'

  return (
    <Touchable
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      feedback="tint"
      noAutoHitSlop
      accessibilityLabel={`${row.name}, ${row.missed ? 'missed' : row.direction === 'OUT' ? 'outgoing' : 'incoming'} ${row.type === 'VIDEO' ? 'video' : 'voice'} call`}
      style={[
        styles.row,
        { backgroundColor: row.unread ? c.dangerSoft : 'transparent' },
      ]}
    >
      <View style={[styles.leadBar, { backgroundColor: row.unread ? c.danger : 'transparent' }]} />
      <Avatar uri={row.avatar} name={row.name} seed={row.peerId ?? row.conversationId} size={48} />

      <View style={styles.flex}>
        <Text
          variant="bodyStrong"
          align="ui"
          numberOfLines={1}
          tone={row.missed ? 'danger' : 'default'}
        >
          {row.name}{row.aggregateCount > 1 ? ` (${row.aggregateCount})` : ''}
        </Text>
        <View style={styles.metaRow}>
          <Icon name={glyph} size={13} color={row.missed ? c.danger : c.textMuted} />
          <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
            {row.type === 'VIDEO' ? 'Video' : 'Voice'} · {row.detail}
          </Text>
        </View>
      </View>

      <Text variant="footnote" tone="muted" align="ui">{hhmm(row.at)}</Text>
      <Touchable
        onPress={() => onInfo(row)}
        feedback="dim"
        accessibilityLabel="Open the conversation"
        style={styles.info}
      >
        <Icon name="info" size={20} color={c.accent} />
      </Touchable>
    </Touchable>
  )
})

/* ---------------------------------------------------------
   Merge + grouping
   --------------------------------------------------------- */

function merge(
  log: CallLogEntry[],
  notifs: any[],
  peers: Record<string, { name: string; handle: string | null; avatar: string | null; convId: string }>,
): Row[] {
  const byKey = new Map<string, Row>()

  for (const e of log) {
    const p = e.peerId ? peers[e.peerId] : undefined
    const at = Date.parse(e.endedAt || e.startedAt || '') || 0
    /* "Missed" is the callee's word (calls.md — the CALL_MISSED bell goes to
       invitees on MISSED and CANCELLED only; DECLINED invitees saw the call,
       and the caller's own rang-out is "no answer", not missed). */
    const missedRow = e.direction === 'IN' && (e.status === 'MISSED' || e.status === 'CANCELLED')
    byKey.set(`call:${e.callId}`, {
      key: `call:${e.callId}`,
      callId: e.callId,
      notifId: null,
      conversationId: e.conversationId,
      peerId: e.peerId,
      name: p?.name || 'Call',
      handle: p?.handle ?? null,
      avatar: p?.avatar ?? null,
      type: e.type,
      direction: e.direction,
      status: e.status,
      missed: missedRow,
      unread: false,
      at,
      aggregateCount: 1,
      detail: detailOf(e),
    })
  }

  for (const n of notifs) {
    const convId = n.resourceType === 'Conversation' && n.resourceId ? String(n.resourceId) : null
    const at = Date.parse(n.createdAt || '') || 0
    /* Collapse onto the local row when there is one: same conversation, same
       minute. The notification carries no call id, so the bucket is the only
       handle we have on "this is the same event". */
    const bucket = convId ? `${convId}:${Math.floor(at / 60000)}` : `notif:${n.id}`
    const twin = [...byKey.values()].find(r =>
      r.conversationId && convId && r.conversationId === convId &&
      Math.abs(r.at - at) < 60000)

    if (twin) {
      twin.notifId = String(n.id)
      twin.unread = !!n.unread
      twin.missed = true
      twin.aggregateCount = Math.max(twin.aggregateCount, n.aggregateCount || 1)
      if (!twin.avatar) twin.avatar = n._actor?.profileImage ?? null
      if (twin.name === 'Call') twin.name = n._actor?.full || 'Missed call'
      continue
    }

    byKey.set(bucket, {
      key: `notif:${n.id}`,
      callId: null,
      notifId: String(n.id),
      conversationId: convId,
      peerId: n._actor?.id ? String(n._actor.id) : null,
      name: n._actor?.full || n.title || 'Missed call',
      handle: n._actor?.handle || null,
      avatar: n._actor?.profileImage ?? null,
      /* The body names the kind ("You missed a video call from @x"). */
      type: /video/i.test(String(n.body || '')) ? 'VIDEO' : 'VOICE',
      direction: 'IN',
      status: 'MISSED',
      missed: true,
      unread: !!n.unread,
      at,
      aggregateCount: n.aggregateCount || 1,
      detail: 'Missed',
    })
  }

  return [...byKey.values()].sort((a, b) => b.at - a.at)
}

function detailOf(e: CallLogEntry): string {
  /* MISSED = the ring ran out (calls.md §Lifecycle) — "missed" from the
     callee's side, "no answer" from the caller's. */
  if (e.status === 'MISSED') return e.direction === 'OUT' ? 'No answer' : 'Missed'
  if (e.status === 'DECLINED') return 'Declined'
  if (e.status === 'CANCELLED') return 'Cancelled'
  if (e.answeredAt && e.endedAt) {
    const secs = Math.round((Date.parse(e.endedAt) - Date.parse(e.answeredAt)) / 1000)
    if (Number.isFinite(secs) && secs > 0) return clock(secs)
  }
  return e.answeredAt ? 'Answered' : 'No answer'
}

function sectioned(rows: Row[]): Item[] {
  const out: Item[] = []
  let last = ''
  for (const r of rows) {
    const label = dayLabel(r.at)
    if (label !== last) {
      out.push({ kind: 'header', key: `h-${label}-${out.length}`, label })
      last = label
    }
    out.push({ kind: 'row', ...r })
  }
  return out
}

/* Built once at module load. Every `toLocale*` call with an options bag
   constructs a fresh Intl.DateTimeFormat internally — on Hermes that is ICU
   pattern resolution, and `hhmm` runs once per visible call row. */
const HHMM = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const DAY_SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

function dayLabel(at: number): string {
  if (!at) return 'Earlier'
  const d = new Date(at)
  const today = new Date()
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Today'
  const y = new Date(today.getTime() - 86_400_000)
  if (same(d, y)) return 'Yesterday'
  return DAY_SHORT.format(d)
}

function hhmm(at: number): string {
  if (!at) return ''
  return HHMM.format(at)
}

const styles = StyleSheet.create({
  segment: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  leadBar: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xxs },
  info: { padding: space.xs },
  /* No textTransform here: `caption` already uppercases and tracks LATIN ONLY
     inside the Text primitive, and a style-level transform would also hit
     Arabic and Kurdish, which have no case. */
  dayHeader: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs2 },
  note: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl },
  flex: { flex: 1 },
})
