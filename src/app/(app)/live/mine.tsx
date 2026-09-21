/* =========================================================
   My streams.

   The only route that can reach an ENDED stream, and therefore
   the only way back to a finished recording — which is why an
   ended row is never removed from this list, only re-labelled.

   The four-way filter is client-side on purpose: `/streams/mine`
   has no status parameter, and faking one by re-fetching with a
   query the server ignores would silently return the same page
   and look broken.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useChatEvents } from '@/context/RealtimeContext'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, ConfirmSheet, Divider, EmptyState, Header, Icon,
  ListFooter, Screen, SegmentedControl, Skeleton, Text, Touchable, useSheetState, toast,
} from '@/ui'
import { SwipeableRow } from '@/components/notifications/SwipeableRow'
import { RecordingStatusChip } from '@/components/live/RecordingStatusChip'
import type { LiveStream } from '@/components/live/types'

type Filter = 'all' | 'live' | 'ended' | 'recorded'

/* Module scope. FlashList's ViewHolder memo compares keyExtractor AND
   ItemSeparatorComponent by identity — an inline arrow in either re-renders
   every mounted row, and an inline separator is a brand-new component TYPE,
   so React unmounts and remounts the divider instead of reconciling it. */
const keyExtractor = (s: LiveStream) => String(s.id)
const Separator = () => <Divider inset={92} />

export default function MyStreamsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()

  const [filter, setFilter] = React.useState<Filter>('all')
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)
  const menu = useSheetState<LiveStream>()
  const confirm = useSheetState<LiveStream>()
  const [deleting, setDeleting] = React.useState(false)

  const list = usePaged<LiveStream>(
    async ({ page, pageSize, signal }) => api.chat.streams.mine({ page, size: pageSize }, { signal }),
    { mode: 'page', pageSize: 20 },
  )

  useChatEvents(evt => {
    const type = String(evt?.type || '')
    if (type === 'stream.ended') {
      const id = evt.streamId || evt.stream?.id
      if (!id) return
      /* Re-label, never remove: this list is the only door back to the
         recording of a finished broadcast. */
      list.patch(String(id), s => ({ ...s, status: 'ENDED', isLive: false }))
      return
    }
    if (type === 'stream.started') {
      const s: LiveStream = evt.stream
      if (s?.id && user?.id && String(s.hostId) === String(user.id)) list.prepend(s)
    }
  })

  const rows = React.useMemo(() => list.items.filter(s => {
    if (filter === 'live') return s.isLive
    if (filter === 'ended') return !s.isLive
    if (filter === 'recorded') {
      /* Every state where footage exists or is being written — PAUSED (takes on
         disk, broadcast still live) and PROCESSING (takes being joined) included. */
      return s.recordingStatus === 'AVAILABLE' || s.recordingStatus === 'RECORDING'
        || s.recordingStatus === 'PAUSED' || s.recordingStatus === 'PROCESSING'
    }
    return true
  }), [list.items, filter])

  const open = (s: LiveStream) => router.push(s.isLive ? `/live/${s.id}/host` : `/live/${s.id}/manage`)

  const doDelete = async (s: LiveStream) => {
    setDeleting(true)
    try {
      await api.chat.streams.remove(s.id)
      list.remove(String(s.id))
      confirm.close()
      toast.ok('Stream deleted')
    } catch (e: any) {
      toast.error(errorText(e))
      confirm.close()
    } finally {
      setDeleting(false)
    }
  }

  /* Identity-stable and item-first, so the collapse flip on scroll and each
     `stream.ended` frame stop re-invoking renderItem for every mounted row. */
  const openStream = useEvent((s: LiveStream) => open(s))
  const openRowMenu = useEvent((s: LiveStream) => menu.open(s))
  const askDelete = useEvent((s: LiveStream) => confirm.open(s))
  const onScroll = useEvent((e: any) => setCollapsed(e.nativeEvent.contentOffset.y > 8))

  const renderItem = React.useCallback(({ item }: { item: LiveStream }) => (
    <StreamRow
      stream={item}
      danger={c.danger}
      onPress={openStream}
      onLongPress={openRowMenu}
      onDelete={askDelete}
    />
  ), [c.danger, openStream, openRowMenu, askDelete])

  return (
    <Screen>
      <Header
        large
        title="My streams"
        collapsed={collapsed}
        back
        actions={[{ icon: 'broadcast', onPress: () => router.push('/live/go'), label: 'Go live' }]}
        below={
          <View style={styles.segment}>
            <SegmentedControl<Filter>
              options={[
                { value: 'all', label: 'All' },
                { value: 'live', label: 'Live' },
                { value: 'ended', label: 'Ended' },
                { value: 'recorded', label: 'Recorded' },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </View>
        }
      />

      {list.loading && !list.items.length ? (
        <View>
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={styles.skelRow}>
              <Skeleton width={64} height={48} radius={t.radius.sm} />
              <View style={styles.flex}>
                <Skeleton width="70%" height={13} />
                <Skeleton width="42%" height={11} style={styles.skelBar} />
              </View>
            </View>
          ))}
        </View>
      ) : list.error && !list.items.length ? (
        <View style={styles.errorCard}>
          <Text variant="callout" tone="muted" align="ui">{errorText(list.error)}</Text>
          <Button label="Try again" onPress={list.reload} variant="tinted" size="sm" icon="refresh" style={styles.errorBtn} />
        </View>
      ) : !list.items.length ? (
        <EmptyState
          icon="broadcast"
          title="You haven't gone live yet"
          message="Your streams and their recordings will be listed here."
          actionLabel="Go live"
          onAction={() => router.push('/live/go')}
        />
      ) : !rows.length ? (
        <View style={styles.filterEmpty}>
          <Text variant="callout" tone="muted" align="center">
            No {filter} streams
          </Text>
          <Button label="Show all" onPress={() => setFilter('all')} variant="ghost" size="sm" />
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
          ItemSeparatorComponent={Separator}
          renderItem={renderItem}
          ListFooterComponent={
            <ListFooter
              loading={list.loadingMore}
              error={list.items.length ? list.error : null}
              onRetry={list.loadMore}
              done={list.done}
            />
          }
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.title}
        actions={[
          { label: 'Open', icon: 'external', onPress: () => menu.payload && open(menu.payload) },
          {
            label: 'Share watch link',
            icon: 'share',
            hidden: !menu.payload?.shareUrl,
            /* Only ever `shareUrl` — the ingest and WHIP URLs carry the key. */
            onPress: () => {
              const url = menu.payload?.shareUrl
              if (url) void Share.share({ message: url, url })
            },
          },
          {
            label: 'Recording',
            icon: 'download',
            onPress: () => menu.payload && router.push(`/live/${menu.payload.id}/recording`),
          },
          {
            label: 'Delete',
            icon: 'trash',
            destructive: true,
            onPress: () => menu.payload && confirm.open(menu.payload),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Delete this stream?"
        message="This also deletes the recording. This can't be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => confirm.payload && void doDelete(confirm.payload)}
      />
    </Screen>
  )
}

const StreamRow = React.memo(function StreamRow({
  stream, danger, onPress, onLongPress, onDelete,
}: {
  stream: LiveStream
  /** The swipe tint, passed as a scalar so the row memo can compare it. */
  danger: string
  onPress: (s: LiveStream) => void
  onLongPress: (s: LiveStream) => void
  onDelete: (s: LiveStream) => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(stream), [onPress, stream])
  const longPress = React.useCallback(() => onLongPress(stream), [onLongPress, stream])
  const trailing = React.useMemo(
    () => [{ label: 'Delete', icon: 'trash' as const, tint: danger, onTrigger: () => onDelete(stream) }],
    [danger, onDelete, stream],
  )

  return (
    <SwipeableRow resetKey={String(stream.id)} trailing={trailing}>
      <Touchable
        onPress={press}
        onLongPress={longPress}
        feedback="tint"
        noAutoHitSlop
        accessibilityLabel={`${stream.title}, ${stream.isLive ? 'live' : 'ended'}`}
        style={[styles.row, { backgroundColor: c.bg }]}
      >
        <View style={[styles.thumb, { borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}>
          {/* No thumbnail field exists on the API — the host avatar is the
              honest stand-in, rendered SHARP. It used to carry blurRadius 18,
              but QELAT has no blur (DESIGN.md §8.7) and this row sits on
              ordinary clay, not a pinned-dark room. The glyph below gets its
              legibility from an overlayChip plate instead. */}
          {stream.hostAvatarUrl ? (
            <Image
              source={{ uri: stream.hostAvatarUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={stream.id}
            />
          ) : (
            <Avatar uri={null} name={stream.title} seed={stream.id} size={64} square />
          )}
          <View style={[styles.thumbGlyph, { backgroundColor: c.overlayChip }]}>
            {stream.isLive
              ? <View style={[styles.dot, { backgroundColor: c.liveDot }]} />
              : <Icon name="play" size={18} color={c.overlayText} filled />}
          </View>
        </View>

        <View style={styles.flex}>
          {/* Serif — stream titles wear the display face on the web's owner
              catalogue (`.lv-mine-t b`). */}
          <Text variant="bodyStrong" serif align="ui" numberOfLines={2}>{stream.title}</Text>
          <View style={styles.metaRow}>
            {/* LIVE is the solid live-red plate with white ink (the sanctioned
                pure-white exception); ENDED stays the quiet neutral chip. */}
            <View
              style={[
                styles.statusPill,
                { backgroundColor: stream.isLive ? c.liveDot : c.surfaceSunken },
              ]}
            >
              <Text variant="micro" weight="700" color={stream.isLive ? '#FFFFFF' : c.textMuted}>
                {stream.isLive ? 'LIVE' : 'ENDED'}
              </Text>
            </View>
            <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
              {stream.time} · {stream.viewerCount} viewers
            </Text>
          </View>
        </View>

        <View style={styles.trailing}>
          <RecordingStatusChip status={stream.recordingStatus} size="sm" />
          <Icon name="forward" size={18} color={c.textFaint} />
        </View>
      </Touchable>
    </SwipeableRow>
  )
})

const styles = StyleSheet.create({
  segment: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 88 },
  thumb: { width: 64, height: 48, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { position: 'absolute', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  statusPill: { paddingHorizontal: space.xs2, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  trailing: { alignItems: 'flex-end', gap: space.xs2 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg2 },
  skelBar: { marginTop: space.sm },
  errorCard: { margin: space.lg, padding: space.lg2, alignItems: 'flex-start' },
  errorBtn: { marginTop: space.md },
  filterEmpty: { alignItems: 'center', paddingVertical: 48, gap: space.xs2 },
  flex: { flex: 1 },
})
