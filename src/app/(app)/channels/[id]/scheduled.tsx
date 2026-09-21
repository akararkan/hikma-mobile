/* =========================================================
   The send-later queue.

   There is no PATCH for a scheduled message, so "edit" is
   cancel-and-recreate. The confirm says that out loud rather
   than pretending the row moved.

   Permissions are re-checked when the job fires, not when it is
   queued, which is why a FAILED row can appear for a post that
   was perfectly legal when it was written.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ConfirmSheet, EmptyState, ErrorState, Header, Icon, Screen,
  Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'item'; key: string; row: any }

/* Module scope. FlashList compares these by identity, and `getItemType` keeps
   the sticky day header and the card in separate recycle pools. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function ScheduledScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const list = useAsync<any[]>(() => api.chat.scheduled.list(id), { enabled: !!id, deps: [id] })

  /* The relative labels ("in 3h") are the only thing that changes between
     fetches, so a minute tick re-renders instead of re-fetching. */
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const iv = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(iv)
  }, [])

  useFocusEffect(React.useCallback(() => { void list.refresh() }, [id]))   // eslint-disable-line react-hooks/exhaustive-deps

  useChannelStream(id, {
    /* A queued post that just fired arrives as a normal message — drop the
       row whose body it matches rather than waiting for the next focus. */
    onMessage: e => {
      const body = e.message?.body
      if (!body) return
      list.setData(prev => (prev || []).filter(r => r.body !== body))
    },
  })

  const menu = useSheetState<any>()
  const confirmCancel = useSheetState<any>()

  const canPost = rights.can('canPostMessages')

  const cancel = async (row: any) => {
    const before = list.data
    list.setData(prev => (prev || []).filter(r => r.id !== row.id))
    try { await api.chat.scheduled.cancel(row.id) }
    catch (e: any) {
      if (isNotFound(e)) { toast.warn('That post has already been sent'); return }
      list.setData(before ?? null)
      toast.error(errorText(e))
    }
  }

  const rows = React.useMemo<Row[]>(() => {
    const sorted = [...(list.data || [])].sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    const out: Row[] = []
    let lastDay = ''
    for (const row of sorted) {
      const day = dayLabel(row.scheduledAt)
      if (day !== lastDay) { out.push({ kind: 'day', key: `d-${day}`, label: day }); lastDay = day }
      out.push({ kind: 'item', key: String(row.id), row })
    }
    return out
  }, [list.data])

  const stickyIndices = React.useMemo(
    () => rows.map((r, i) => (r.kind === 'day' ? i : -1)).filter(i => i >= 0),
    [rows],
  )

  /* Identity-stable, so the minute tick above re-renders the labels without
     re-invoking renderItem for every mounted card. */
  const openMenu = useEvent((row: any) => menu.open(row))

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View style={[styles.day, { backgroundColor: c.bgSunken, paddingHorizontal: t.layout.screenPadding }]}>
          {/* `caption` uppercases Latin only, inside the Text primitive. */}
          <Text variant="caption" tone="muted" align="ui">{item.label}</Text>
        </View>
      )
    }
    return <ScheduledCard row={item.row} onPress={openMenu} />
  }, [c.bgSunken, t.layout.screenPadding, openMenu])

  if (!rights.loading && rights.channel && !canPost) {
    return (
      <Screen background="sunken">
        <Header back title="Scheduled" />
        <RefusalCard title="You can’t post in this channel" onAction={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Scheduled"
        subtitle={rights.channel?.title}
        actions={[{ icon: 'add', onPress: () => router.push(chRoute.compose(id, { preset: 'schedule' })), label: 'Schedule a post' }]}
      />

      {list.loading ? (
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={96} radius={12} />)}
        </View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          stickyHeaderIndices={stickyIndices}
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              icon="clock"
              title="Nothing scheduled"
              message="Write a post now and pick when it goes out."
              actionLabel="Schedule a post"
              onAction={() => router.push(chRoute.compose(id, { preset: 'schedule' }))}
            />
          }
          ListFooterComponent={
            list.data?.length ? (
              <Text variant="footnote" tone="muted" align="center" style={{ padding: space.xl }}>
                Scheduled posts are sent through the normal path — permissions are re-checked when they fire.
              </Text>
            ) : null
          }
          refreshing={list.refreshing}
          onRefresh={() => void list.refresh()}
          contentContainerStyle={{ paddingBottom: space.huge, paddingTop: space.xs }}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={clockLabel(menu.payload?.scheduledAt)}
        subtitle={dayLabel(menu.payload?.scheduledAt)}
        actions={[
          {
            label: menu.payload?.status === 'FAILED' ? 'Post now' : 'Edit',
            icon: 'edit',
            subtitle: menu.payload?.status === 'FAILED' ? undefined : 'Editing re-schedules this post.',
            onPress: () => router.push(chRoute.compose(id, { preset: 'schedule', body: menu.payload?.body })),
          },
          { label: 'Cancel this post', icon: 'trash', destructive: true, onPress: () => confirmCancel.open(menu.payload) },
        ]}
      />

      <ConfirmSheet
        visible={confirmCancel.visible}
        onClose={confirmCancel.close}
        title="Cancel this scheduled post?"
        message="It won’t be sent."
        confirmLabel="Cancel it"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => { const row = confirmCancel.payload; confirmCancel.close(); void cancel(row) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One queued post.

   Memoized: the minute tick above re-renders this screen every
   60s purely to refresh the "in 3h" labels, and without the memo
   that would repaint every thumbnail with it.
   --------------------------------------------------------- */

const ScheduledCard = React.memo(function ScheduledCard({
  row, onPress,
}: { row: any; onPress: (row: any) => void }) {
  const t = useTheme()
  const c = t.colors
  const failed = row.status === 'FAILED'
  const press = React.useCallback(() => onPress(row), [onPress, row])
  const thumb = row.media?.[0]?.thumbnailUrl || row.media?.[0]?.url

  return (
    <Touchable
      onPress={press}
      feedback="dim"
      noAutoHitSlop
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderRadius: t.radius.md,
          marginHorizontal: t.layout.screenPadding,
          borderStartWidth: failed ? 3 : 0,
          borderStartColor: c.danger,
        },
      ]}
    >
      <View style={styles.timeCol}>
        <Text variant="bodyStrong" align="center">{clockLabel(row.scheduledAt)}</Text>
        <Text variant="micro" tone="muted" align="center">{relative(row.scheduledAt)}</Text>
      </View>
      <View style={[styles.hair, { backgroundColor: c.separator }]} />
      <View style={styles.flex}>
        {row.type !== 'TEXT' ? (
          <Chip label={typeLabel(row.type)} tone="neutral" size="sm" style={styles.typeChip} />
        ) : null}
        <Text variant="callout" numberOfLines={3} align="auto">{row.body || '(no text)'}</Text>
        {failed ? (
          <Text variant="caption" tone="danger" align="ui" style={styles.failedLine}>
            Failed to send — permission was denied when it fired
          </Text>
        ) : null}
      </View>
      {row.media?.length ? (
        <View style={[styles.thumb, { backgroundColor: c.surfaceSunken }]}>
          {thumb ? (
            <Image
              source={{ uri: thumb }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              /* Without this a recycled row keeps painting the PREVIOUS post's
                 bitmap until the new source resolves. No transition: a 56pt
                 thumb's cross-fade is never seen to completion on a flick. */
              recyclingKey={String(row.id)}
            />
          ) : (
            <Icon name="file" size={18} color={c.textFaint} />
          )}
          {row.media.length > 1 ? (
            <View style={[styles.plus, { backgroundColor: c.overlayChip }]}>
              <Text variant="micro" color={c.overlayText}>+{row.media.length - 1}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <Icon name="more" size={18} color={c.textMuted} />
    </Touchable>
  )
})

/* ---------------------------------------------------------
   Time labels.

   The formatters are module-scope: every `toLocale*` call with an
   options bag builds a fresh Intl.DateTimeFormat internally, and
   on Hermes that ICU pattern resolution is an order of magnitude
   dearer than formatting through a cached instance.
   --------------------------------------------------------- */

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const CLOCK_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function dayLabel(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  const tomorrow = new Date(today.getTime() + 86400e3)
  if (sameDay(d, tomorrow)) return 'Tomorrow'
  return DAY_FMT.format(d)
}

function clockLabel(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return CLOCK_FMT.format(d)
}

function relative(iso?: string | null): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'due'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function typeLabel(type: string): string {
  switch (type) {
    case 'IMAGE': return 'Photo'
    case 'VIDEO': return 'Video'
    case 'POLL': return 'Poll'
    case 'FILE': return 'File'
    default: return type
  }
}

const styles = StyleSheet.create({
  day: { paddingTop: space.md2, paddingBottom: space.xs2, height: 32, justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, padding: space.md, marginBottom: space.sm },
  timeCol: { width: 44, gap: space.xxs },
  hair: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  thumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  plus: { position: 'absolute', bottom: 2, end: 2, paddingHorizontal: space.xs, borderRadius: 4 },
  typeChip: { marginBottom: space.xs2 },
  failedLine: { marginTop: space.xs },
  flex: { flex: 1 },
})
