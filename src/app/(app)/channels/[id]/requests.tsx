/* =========================================================
   Join requests.

   The decision endpoints are keyed by the USER id, not the
   request id — `requests.approve(channelId, userId)`. Getting
   that wrong 404s on every row, so it is worth saying out loud.

   A rejected person may request again (the row flips back to
   PENDING), which is why the rejected tab says so instead of
   reading as a ban.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, joinRequestFrom } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Button, Chip, ConfirmSheet, EmptyState, ErrorState, Header, ListFooter, Screen,
  SegmentedControl, SkeletonList, Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'
import { MemberRow } from '@/components/channels/MemberRow'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED'

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (r: any) => String(r.id)

export default function JoinRequestsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [tab, setTab] = React.useState<Tab>('PENDING')
  const [pendingBadge, setPendingBadge] = React.useState<number | null>(null)
  /* Frames that arrived while the list was scrolled away from the top. */
  const [incoming, setIncoming] = React.useState<any[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)

  const rights = useChannelRights(id)
  const canApprove = rights.can('canApproveJoinRequests')

  const list = usePaged<any>(
    ({ page, pageSize, signal }) => api.channels.requests.list(id, args({ status: tab, page, size: pageSize, signal })),
    { mode: 'page', pageSize: 50, enabled: !!id && canApprove, deps: [id, tab, canApprove], keyOf: (r: any) => String(r.id) },
  )

  React.useEffect(() => {
    if (tab === 'PENDING' && list.extra?.total != null) setPendingBadge(list.extra.total)
  }, [tab, list.extra])

  useChannelStream(id, {
    onJoinRequest: e => {
      /* The frame carries the RAW dto on purpose — map it here. */
      const row = joinRequestFrom((e as any).joinRequest)
      if (!row) return
      setPendingBadge(n => (n ?? 0) + 1)
      if (tab === 'PENDING') setIncoming(prev => (prev.some(x => x.id === row.id) ? prev : [row, ...prev]))
    },
    onMember: e => {
      if (e.memberChange !== 'ADDED') return
      list.setItems(prev => prev.filter(r => r.userId !== e.userId))
    },
  })

  const confirmBulk = useSheetState<'approve' | 'reject'>()

  const decide = async (row: any, action: 'approve' | 'reject') => {
    fireHaptic(action === 'approve' ? 'success' : 'warning')
    list.remove(String(row.id))
    setPendingBadge(n => Math.max(0, (n ?? 1) - 1))
    try {
      if (action === 'approve') await api.channels.requests.approve(id, row.userId)
      else await api.channels.requests.reject(id, row.userId)
    } catch (e: any) {
      /* "Already decided" and "not found" both mean somebody else got there
         first — the row is genuinely gone, so it stays gone and the tab
         re-reads rather than bouncing back. */
      toast.warn(errorText(e))
      setPendingBadge(null)
      void list.refresh()
    }
  }

  const bulk = async (action: 'approve' | 'reject') => {
    setBulkBusy(true)
    const rows = [...list.items]
    let done = 0
    for (const row of rows) {
      try {
        if (action === 'approve') await api.channels.requests.approve(id, row.userId)
        else await api.channels.requests.reject(id, row.userId)
        done += 1
        list.remove(String(row.id))
      } catch (e: any) {
        toast.error(`${errorText(e)} (${done}/${rows.length})`)
        break
      }
    }
    setBulkBusy(false)
    setPendingBadge(null)
    void list.refresh()
    if (done) toast.ok(`${action === 'approve' ? 'Approved' : 'Rejected'} ${done} of ${rows.length}`)
  }

  /* Identity-stable and item-first, so one pair of functions serves the whole
     roster and `renderItem` survives an incoming join-request frame. Declared
     above the refusal return — hooks may not sit behind an early exit. */
  const approve = useEvent((row: any) => { void decide(row, 'approve') })
  const reject = useEvent((row: any) => { void decide(row, 'reject') })
  const openProfile = useEvent((row: any) => router.push(chRoute.user(row.userId)))

  const surface = c.surface
  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <RequestRow
      row={item}
      tab={tab}
      surface={surface}
      onApprove={approve}
      onReject={reject}
      onOpen={openProfile}
    />
  ), [tab, surface, approve, reject, openProfile])

  if (!rights.loading && rights.channel && !canApprove) {
    return (
      <Screen background="sunken">
        <Header back title="Join requests" />
        <RefusalCard title="You can’t manage join requests here" onAction={() => router.back()} />
      </Screen>
    )
  }

  const showBulk = tab === 'PENDING' && list.items.length >= 3

  return (
    <Screen background="sunken">
      <Header
        back
        title="Join requests"
        subtitle={rights.channel?.title}
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}>
            <SegmentedControl
              options={[
                { value: 'PENDING', label: 'Pending', badge: pendingBadge ?? undefined },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
              value={tab}
              onChange={v => { setTab(v as Tab); setIncoming([]) }}
            />
          </View>
        }
      />

      {incoming.length ? (
        <Touchable
          onPress={() => { list.setItems(prev => [...incoming, ...prev]); setIncoming([]) }}
          feedback="scale"
          style={[styles.livePill, setback(t.shape.chip), { backgroundColor: c.accent }]}
        >
          <Text variant="caption" color={c.textOnAccent} align="center">
            {incoming.length} new {incoming.length === 1 ? 'request' : 'requests'}
          </Text>
        </Touchable>
      ) : null}

      {list.loading ? (
        <SkeletonList count={5} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={list.items}
          keyExtractor={keyExtractor}
          extraData={tab}
          renderItem={renderItem}
          ListEmptyComponent={
            tab === 'PENDING' ? (
              <EmptyState
                icon="checkCircle"
                title="No requests waiting"
                message="New requests appear here and in your notifications."
              />
            ) : (
              <EmptyState compact icon="hourglass" title="Nothing here yet." />
            )
          }
          ListFooterComponent={list.items.length ? <ListFooter loading={list.loadingMore} done={list.done} doneLabel="" /> : null}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={list.refreshing}
          onRefresh={() => void list.refresh()}
          contentContainerStyle={{ paddingBottom: showBulk ? 110 : 40 }}
        />
      )}

      {showBulk ? (
        <View style={[styles.bulk, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Button
            label={`Approve all (${list.items.length})`}
            variant="secondary"
            size="lg"
            loading={bulkBusy}
            onPress={() => confirmBulk.open('approve')}
            style={styles.flex}
          />
          <Button label="Reject all" variant="ghost" size="lg" onPress={() => confirmBulk.open('reject')} />
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirmBulk.visible}
        onClose={confirmBulk.close}
        title={confirmBulk.payload === 'approve' ? `Approve all ${list.items.length}?` : `Reject all ${list.items.length}?`}
        message={
          confirmBulk.payload === 'approve'
            ? 'Everyone waiting joins the channel right away.'
            : 'They can request again later.'
        }
        confirmLabel={confirmBulk.payload === 'approve' ? 'Approve all' : 'Reject all'}
        destructive={confirmBulk.payload === 'reject'}
        onConfirm={() => { const a = confirmBulk.payload; confirmBulk.close(); if (a) void bulk(a) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One request row. Memoized on scalars, with the per-row
   closures built inside the boundary.
   --------------------------------------------------------- */

const RequestRow = React.memo(function RequestRow({
  row, tab, surface, onApprove, onReject, onOpen,
}: {
  row: any
  tab: Tab
  surface: string
  onApprove: (row: any) => void
  onReject: (row: any) => void
  onOpen: (row: any) => void
}) {
  const approve = React.useCallback(() => onApprove(row), [onApprove, row])
  const reject = React.useCallback(() => onReject(row), [onReject, row])
  const open = React.useCallback(() => onOpen(row), [onOpen, row])

  return (
    <View style={{ backgroundColor: surface }}>
      <MemberRow
        member={row}
        showRolePill={false}
        subtitle={`${row.handle ? `@${row.handle} · ` : ''}Requested ${row.time}`}
        onPress={open}
        trailing={
          tab === 'PENDING' ? (
            <View style={styles.cluster}>
              <Button label="Approve" size="sm" onPress={approve} />
              <Button label="Reject" size="sm" variant="secondary" onPress={reject} />
            </View>
          ) : (
            <View style={styles.decided}>
              <Chip
                label={`${row.status === 'APPROVED' ? 'Approved' : 'Rejected'} ${row.time}`}
                tone={row.status === 'APPROVED' ? 'success' : 'neutral'}
                size="sm"
              />
              {row.decidedBy ? <Text variant="micro" tone="faint">by {row.decidedBy}</Text> : null}
              {row.status === 'REJECTED' ? <Text variant="micro" tone="faint">Can request again.</Text> : null}
            </View>
          )
        }
      />
    </View>
  )
})

const styles = StyleSheet.create({
  cluster: { flexDirection: 'row', gap: space.xs2, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 170 },
  decided: { alignItems: 'flex-end', gap: space.xs },
  /* "N new requests" is a labelled plate, not an unread COUNT badge — chip
     setback, not a pill. */
  livePill: { alignSelf: 'center', paddingHorizontal: space.md2, paddingVertical: space.xs2, borderCurve: 'continuous', marginBottom: space.xs2 },
  bulk: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
})
