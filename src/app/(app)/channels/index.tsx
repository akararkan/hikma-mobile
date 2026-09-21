/* =========================================================
   Channels home — my inbox's channels, plus the directory.

   `discover` is NOT paged: the server hard-caps it at 50 rows
   ordered by subscriber count. So the screen says so when the
   cap is hit and offers the two real narrowing tools (a query, a
   category) instead of a "load more" that cannot load more.
   Everything past that comes from the search index, which IS
   cursor-paged, and lands under its own divider so the user can
   tell a directory row from a search hit.

   A leading '@' is a different intent from a search: it resolves
   one exact handle, so it gets its own card at the top rather
   than being buried in ranked results.
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText, isNotFound } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { useChatActions } from '@/context/ChatContext'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Badge, Callout, Chip, ChipRail, DisclosureIcon, EmptyState,
  ErrorState, Header, Icon, InlineError, Screen, SearchField, Skeleton, Spinner, Text,
  ConfirmSheet, Touchable, TouchableRow, fireHaptic, formatCount, toast, useSheetState,
} from '@/ui'
import { ChannelRow } from '@/components/channels/ChannelRow'
import { CHANNEL_CATEGORIES } from '@/components/channels/ChannelForm'
import { TopStrip, useTransientRetry } from '@/components/channels/states'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

/* The server treats "muted until" as an instant, so "forever" is simply an
   instant nobody will reach. `null` is the unmute signal and cannot double as
   an indefinite mute. */
const MUTE_FOREVER = () => new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString()

const DISCOVER_CAP = 50

type Row =
  | { kind: 'rail'; key: string }
  | { kind: 'mine-error'; key: string }
  | { kind: 'archived'; key: string; count: number }
  | { kind: 'section'; key: string; title: string; caption?: string }
  | { kind: 'resolver'; key: string; handle: string }
  | { kind: 'channel'; key: string; channel: any }
  | { kind: 'hit'; key: string; hit: any }
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'skeleton'; key: string }

/* Module scope: FlashList's ViewHolder memo compares these by identity, so an
   inline arrow re-renders every mounted cell on every keystroke in the search
   field. `getItemType` also keeps the eight row shapes in eight recycle pools
   instead of one — a skeleton's React key must never land on a directory row. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function ChannelsHome() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [q, setQ] = React.useState('')
  const [committed, setCommitted] = React.useState('')
  const [category, setCategory] = React.useState('')

  /* One timer, and Submit simply short-circuits it — a user who hit the search
     key has already told us they are done typing. */
  React.useEffect(() => {
    const id = setTimeout(() => setCommitted(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])

  const mine = useAsync<any>(() => api.chat.conversations.list({ page: 0, size: 50 }), { deps: [] })
  const archived = useAsync<any>(() => api.chat.conversations.archived({ page: 0, size: 30 }), { deps: [] })
  const discover = useAsync<any[]>(
    signal => api.channels.discover(committed, { category }, { signal }),
    { deps: [committed, category] },
  )
  useTransientRetry(discover.error, discover.reload)
  useTransientRetry(mine.error, mine.reload)

  /* The inbox rail is refetched on focus rather than subscribed: a channel
     joined on another screen has to appear here, and the list is 50 rows. */
  useFocusEffect(React.useCallback(() => { void mine.refresh() }, [mine.refresh]))

  const myChannels = React.useMemo(() => {
    const items: any[] = mine.data?.items || []
    return items
      .filter(x => x?.isChannel)
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || ''))
      })
  }, [mine.data])

  const archivedChannels = React.useMemo(
    () => (archived.data?.items || []).filter((x: any) => x?.isChannel),
    [archived.data],
  )

  const handleQuery = committed.startsWith('@') ? committed.slice(1).trim() : ''
  const searching = !!committed || !!category

  /* ---- 'More matches': the cursor-paged tail from the search index ---- */
  const [more, setMore] = React.useState<{ hits: any[]; cursor: string; done: boolean; loading: boolean; degraded: boolean }>(
    { hits: [], cursor: '', done: false, loading: false, degraded: false },
  )
  React.useEffect(() => { setMore({ hits: [], cursor: '', done: false, loading: false, degraded: false }) }, [committed, category])

  const loadMore = React.useCallback(async () => {
    if (committed.length < 2 || committed.startsWith('@')) return
    if (more.loading || more.done) return
    setMore(m => ({ ...m, loading: true }))
    try {
      const res: any = await api.search.stream(committed, args({ types: ['CHANNEL'], size: 20, cursor: more.cursor || undefined }))
      setMore(m => ({
        hits: [...m.hits, ...(res.results || [])],
        cursor: res.nextCursor || '',
        done: !res.nextCursor || !(res.results || []).length,
        loading: false,
        degraded: !!res.degraded,
      }))
    } catch (e: any) {
      /* A search-backend wobble must never read as "no channels" — the
         directory results above are still perfectly good. */
      setMore(m => ({ ...m, loading: false, done: true, degraded: true }))
      if (!isNotFound(e)) toast.warn(errorText(e))
    }
  }, [committed, more.loading, more.done, more.cursor])

  /* ---- rows ---- */

  const { dropConvo } = useChatActions()
  const rowMenu = useSheetState<any>()
  /* Archive is gated like the chat inbox gates it — a rail with a handful of
     channels makes an accidental archive read as a deleted channel. */
  const confirmArchive = useSheetState<any>()
  const confirmLeave = useSheetState<any>()
  const [leaveBusy, setLeaveBusy] = React.useState(false)

  const leaveChannel = React.useCallback(async (convo: any) => {
    if (!convo?.id || leaveBusy) return
    setLeaveBusy(true)
    try {
      /* Through the provider so the CHAT rail drops the row too — this screen
         refreshes its own two lists, but the channel also has a row in the
         chat inbox and nothing here was telling it. */
      await dropConvo(String(convo.id), () => api.channels.unsubscribe(String(convo.id)), 'Could not leave this channel')
      confirmLeave.close()
      toast.ok(`Left ${convo.displayTitle || 'the channel'}`)
      void mine.refresh()
      void archived.refresh()
    } catch { /* the provider restored the row and said why */ } finally {
      setLeaveBusy(false)
    }
  }, [leaveBusy, confirmLeave, mine, archived, dropConvo])
  /* Archived channels swap into the same rail rather than getting a screen of
     their own: there are rarely more than a handful, and a push would be a
     whole navigation stack for a list of three. */
  const [showArchived, setShowArchived] = React.useState(false)

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []

    if (!searching) {
      const rail = showArchived ? archivedChannels : myChannels
      /* A failed "mine" read must not erase the section: an empty rail and a
         broken one look identical, and a subscriber would see an app that
         forgot their channels with nothing to retry. */
      const railBroken = !!mine.error && !mine.loading && !rail.length
      if (rail.length || railBroken) {
        out.push({ kind: 'section', key: 's-mine', title: showArchived ? 'Archived channels' : 'Your channels' })
      }
      if (mine.loading || rail.length) out.push({ kind: 'rail', key: 'rail' })
      else if (railBroken) out.push({ kind: 'mine-error', key: 'mine-error' })
      if (archivedChannels.length) out.push({ kind: 'archived', key: 'archived', count: archivedChannels.length })
    }

    const results = discover.data || []
    out.push({
      kind: 'section',
      key: 's-discover',
      title: searching ? 'Results' : 'Discover',
      caption: results.length >= DISCOVER_CAP
        ? 'Top 50 most-subscribed — narrow with a search or a category'
        : undefined,
    })

    if (handleQuery) out.push({ kind: 'resolver', key: `res-${handleQuery}`, handle: handleQuery })

    if (discover.loading) {
      for (let i = 0; i < 6; i++) out.push({ kind: 'skeleton', key: `sk-${i}` })
      return out
    }

    for (const ch of results) out.push({ kind: 'channel', key: `c-${ch.id}`, channel: ch })

    if (more.hits.length) {
      out.push({ kind: 'divider', key: 'more', label: 'More matches' })
      const seen = new Set(results.map((r: any) => r.id))
      for (const hit of more.hits) {
        if (seen.has(hit.contentId)) continue
        seen.add(hit.contentId)
        out.push({ kind: 'hit', key: `h-${hit.contentId}`, hit })
      }
    }
    return out
  }, [searching, showArchived, myChannels, archivedChannels, mine.loading, mine.error, discover.data, discover.loading, handleQuery, more.hits])

  const stickyIndices = React.useMemo(
    () => rows.map((r, i) => (r.kind === 'section' ? i : -1)).filter(i => i >= 0),
    [rows],
  )

  /* ---- inbox row actions ---- */

  const patchConvo = (id: string, patch: any) =>
    mine.setData((prev: any) => (prev ? { ...prev, items: prev.items.map((x: any) => (x.id === id ? { ...x, ...patch } : x)) } : prev))

  const toggleMute = async (convo: any) => {
    const next = convo.muted ? null : MUTE_FOREVER()
    patchConvo(convo.id, { muted: !convo.muted, mutedUntil: next })
    try { await api.chat.conversations.mute(convo.id, next) }
    catch (e: any) { patchConvo(convo.id, { muted: convo.muted, mutedUntil: convo.mutedUntil }); toast.error(errorText(e)) }
  }
  const togglePin = async (convo: any) => {
    patchConvo(convo.id, { pinned: !convo.pinned })
    try { await api.chat.conversations.pin(convo.id, !convo.pinned) }
    catch (e: any) { patchConvo(convo.id, { pinned: convo.pinned }); toast.error(errorText(e)) }
  }
  const archive = async (convo: any, next: boolean) => {
    const drop = (state: any) => (state ? { ...state, items: state.items.filter((x: any) => x.id !== convo.id) } : state)
    ;(next ? mine : archived).setData(drop)
    try {
      await api.chat.conversations.archive(convo.id, next)
      void mine.refresh()
      void archived.refresh()
    } catch (e: any) {
      void mine.refresh()
      void archived.refresh()
      toast.error(errorText(e))
    }
  }

  /* ---- row plumbing ----
     Every handler handed to a row is identity-stable (useEvent) and takes what
     it needs as an argument, so ONE function serves every row and `renderItem`
     only changes when something a row actually renders moved. */

  const openChannel = useEvent((channelId: string) => router.push(chRoute.channel(channelId)))
  const openTileMenu = useEvent((convo: any) => { fireHaptic('medium'); rowMenu.open(convo) })
  const clearSearch = useEvent(() => { setQ(''); setCommitted(''); setCategory('') })
  const toggleArchived = useEvent(() => setShowArchived(v => !v))
  const patchDirectoryRow = useEvent((next: any) =>
    discover.setData(prev => (prev || []).map(x => (x.id === next.id ? next : x))))

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    switch (item.kind) {
      case 'section':
        return (
          <View style={[styles.section, { backgroundColor: c.bg, paddingHorizontal: t.layout.screenPadding }]}>
            <Text variant="title3" align="ui">{item.title}</Text>
            {item.caption ? (
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{item.caption}</Text>
            ) : null}
          </View>
        )

      case 'rail':
        return mine.loading && !myChannels.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railPad}>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} width={132} height={164} radius={16} />)}
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={142} decelerationRate="fast" contentContainerStyle={styles.railPad}>
            {(showArchived ? archivedChannels : myChannels).map((convo: any) => (
              <ChannelTile
                key={convo.id}
                convo={convo}
                onPress={openChannel}
                onLongPress={openTileMenu}
              />
            ))}
            <Touchable
              onPress={clearSearch}
              feedback="scale"
              noAutoHitSlop
              style={[styles.tile, styles.seeAll, { borderColor: c.border }]}
            >
              <Icon name="search" size={22} color={c.textMuted} />
              <Text variant="footnote" tone="muted" align="center">See all</Text>
            </Touchable>
          </ScrollView>
        )

      case 'mine-error':
        return (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}>
            <InlineError error={mine.error} onRetry={mine.reload} />
          </View>
        )

      case 'archived':
        return (
          <TouchableRow onPress={toggleArchived}>
            <View style={[styles.archiveRow, { paddingHorizontal: t.layout.screenPadding }]}>
              <Icon name="archive" size={18} color={c.textMuted} />
              <Text variant="callout" align="ui" style={styles.flex}>
                {showArchived ? 'Back to your channels' : `Archived channels (${item.count})`}
              </Text>
              <Icon name={showArchived ? 'up' : 'down'} size={16} color={c.textFaint} />
            </View>
          </TouchableRow>
        )

      case 'resolver':
        return <ResolverCard handle={item.handle} />

      case 'channel':
        return (
          <DirectoryRow channel={item.channel} onOpen={openChannel} onSubscribe={patchDirectoryRow} />
        )

      case 'hit':
        return <SearchHitRow hit={item.hit} onOpen={openChannel} />

      case 'divider':
        return (
          <View style={[styles.moreDivider, { borderTopColor: c.separator }]}>
            <Text variant="caption" tone="faint" align="center">{item.label}</Text>
          </View>
        )

      case 'skeleton':
        return (
          <View style={[styles.skRow, { paddingHorizontal: t.layout.screenPadding }]}>
            <Skeleton circle width={48} height={48} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Skeleton width="52%" height={12} />
              <Skeleton width="78%" height={10} />
            </View>
          </View>
        )
    }
  }, [
    c, t.layout.screenPadding, mine.loading, mine.error, mine.reload, myChannels, archivedChannels,
    showArchived, openChannel, openTileMenu, clearSearch, toggleArchived, patchDirectoryRow,
  ])

  /* Passed by reference rather than as a fresh element, so the footer's
     ViewHolder is not torn down on every render of this screen. */
  const footer = React.useMemo(() => (
    <View style={{ paddingVertical: space.md }}>
      {more.loading ? <Spinner /> : null}
      {discover.error && (discover.data?.length ?? 0) > 0 ? (
        <Callout tone="danger" style={{ margin: t.layout.screenPadding }}>{errorText(discover.error)}</Callout>
      ) : null}
    </View>
  ), [more.loading, discover.error, discover.data, t.layout.screenPadding])

  const empty = discover.loading ? null : discover.error ? (
    <ErrorState error={discover.error} onRetry={discover.reload} />
  ) : committed ? (
    <EmptyState
      icon="search"
      title={`No channels match “${committed}”`}
      message="Try a shorter word, or browse a category."
      actionLabel="Clear search"
      onAction={() => { setQ(''); setCommitted(''); setCategory('') }}
    />
  ) : (
    <EmptyState
      icon="channels"
      title="The directory is quiet right now"
      message="Public channels show up here as people create them."
      actionLabel="Create the first one"
      onAction={() => router.push(chRoute.create())}
    />
  )

  return (
    <Screen>
      <Header
        large
        title="Channels"
        actions={[{ icon: 'add', onPress: () => router.push(chRoute.create()), label: 'New channel' }]}
        border={false}
        below={
          <View style={{ paddingBottom: space.sm }}>
            <View style={{ paddingHorizontal: t.layout.screenPadding }}>
              <SearchField
                value={q}
                onChangeText={v => { setQ(v); if (v) setCategory('') }}
                onSubmit={() => setCommitted(q.trim())}
                placeholder="Search channels or @handle"
              />
            </View>
            {!q ? (
              <ChipRail style={{ marginTop: space.sm2 }}>
                <Chip
                  label="All"
                  selected={!category}
                  onPress={() => { fireHaptic('select'); setCategory('') }}
                />
                {CHANNEL_CATEGORIES.map(slug => (
                  <Chip
                    key={slug}
                    label={slug.charAt(0).toUpperCase() + slug.slice(1)}
                    selected={category === slug}
                    onPress={() => { fireHaptic('select'); setQ(''); setCommitted(''); setCategory(category === slug ? '' : slug) }}
                  />
                ))}
              </ChipRail>
            ) : null}
          </View>
        }
      />

      {more.degraded && committed.length >= 2 ? (
        <TopStrip>Search is temporarily unavailable — showing directory results only.</TopStrip>
      ) : null}

      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        extraData={`${category}:${committed}:${showArchived}`}
        stickyHeaderIndices={stickyIndices}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.7}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={mine.refreshing || discover.refreshing}
            onRefresh={() => { void mine.refresh(); void discover.refresh(); void archived.refresh() }}
            tintColor={c.textMuted}
            colors={[c.accent]}
          />
        }
      />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.displayTitle}
        actions={[
          { label: 'Open', icon: 'channels', onPress: () => router.push(chRoute.channel(rowMenu.payload.id)) },
          {
            label: rowMenu.payload?.muted ? 'Unmute' : 'Mute',
            icon: rowMenu.payload?.muted ? 'bell' : 'mutedBell',
            onPress: () => void toggleMute(rowMenu.payload),
          },
          {
            label: rowMenu.payload?.pinned ? 'Unpin' : 'Pin to top',
            icon: rowMenu.payload?.pinned ? 'unpin' : 'pin',
            onPress: () => void togglePin(rowMenu.payload),
          },
          {
            label: showArchived ? 'Move back to inbox' : 'Archive',
            icon: 'archive',
            /* Unarchive restores — no gate; archiving hides and gets one. */
            onPress: () => (showArchived
              ? void archive(rowMenu.payload, false)
              : confirmArchive.open(rowMenu.payload)),
          },
          {
            label: 'Leave channel',
            icon: 'logout',
            destructive: true,
            onPress: () => confirmLeave.open(rowMenu.payload),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmLeave.visible}
        onClose={confirmLeave.close}
        title={`Leave ${confirmLeave.payload?.displayTitle || 'this channel'}?`}
        message="You stop receiving its posts. A public channel can be rejoined any time; a request-to-join channel asks again."
        confirmLabel="Leave"
        destructive
        loading={leaveBusy}
        onConfirm={() => { void leaveChannel(confirmLeave.payload) }}
      />

      <ConfirmSheet
        visible={confirmArchive.visible}
        onClose={confirmArchive.close}
        title={`Archive ${confirmArchive.payload?.displayTitle || 'this channel'}?`}
        message="It moves under “Archived channels” at the end of the rail — nothing is deleted and you stay subscribed."
        confirmLabel="Archive"
        onConfirm={() => { void archive(confirmArchive.payload, true); confirmArchive.close() }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The two directory rows.

   Both are memoized and both take an item-first `onOpen`, so the
   press closure is created INSIDE the memo boundary — one stable
   function serves the whole list and a re-render of the screen
   never repaints a row whose channel did not move.
   --------------------------------------------------------- */

const DirectoryRow = React.memo(function DirectoryRow({
  channel, onOpen, onSubscribe,
}: { channel: any; onOpen: (id: string) => void; onSubscribe: (next: any) => void }) {
  const press = React.useCallback(() => onOpen(String(channel.id)), [onOpen, channel.id])
  return <ChannelRow channel={channel} onPress={press} onSubscribe={onSubscribe} />
})

const SearchHitRow = React.memo(function SearchHitRow({
  hit, onOpen,
}: { hit: any; onOpen: (id: string) => void }) {
  const press = React.useCallback(() => onOpen(String(hit.contentId)), [onOpen, hit.contentId])
  /* The search index answers with a hit shape, not a channel — this is the
     one place that adaption happens, and it is memoized with the row. */
  const channel = React.useMemo(() => ({
    id: hit.contentId,
    title: hit.titlePreview || 'Channel',
    handle: hit.authorUsername,
    subscriberCount: null,
    description: '',
  }), [hit.contentId, hit.titlePreview, hit.authorUsername])
  return (
    <ChannelRow
      channel={channel}
      subtitle={hit.authorUsername ? `@${hit.authorUsername}` : 'From search'}
      trailing="chevron"
      onPress={press}
    />
  )
})

/* ---------------------------------------------------------
   The carousel tile.

   `convoFrom` carries `memberCount`, not `subscriberCount` —
   they are the same number under two names, and the inbox row is
   the only source available here without a call per tile.
   --------------------------------------------------------- */

const ChannelTile = React.memo(function ChannelTile({
  convo, onPress, onLongPress,
}: { convo: any; onPress: (id: string) => void; onLongPress: (convo: any) => void }) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(String(convo.id)), [onPress, convo.id])
  const longPress = React.useCallback(() => onLongPress(convo), [onLongPress, convo])
  return (
    <Touchable
      onPress={press}
      onLongPress={longPress}
      feedback="scale"
      noAutoHitSlop
      style={[styles.tile, { backgroundColor: c.surfaceSunken }]}
    >
      <Avatar uri={convo.avatarUrl} name={convo.displayTitle} seed={convo.id} size={56} square />
      <Text variant="subhead" weight="600" align="center" numberOfLines={2} style={{ marginTop: space.sm }}>
        {convo.displayTitle}
      </Text>
      <Text variant="caption" tone="muted" align="center" numberOfLines={1}>
        {formatCount(convo.memberCount)} subscribers
      </Text>
      <View style={styles.tileFlags}>
        {convo.pinned ? <Icon name="pin" size={11} color={c.textFaint} /> : null}
        {convo.muted ? <Icon name="mutedBell" size={11} color={c.textFaint} /> : null}
      </View>
      {/* The COUNT when the row carries one, the bare dot when it only knows
          "something" — the inbox pill grammar (ConversationRow), and one of
          the two sanctioned pills. */}
      {convo.unreadCount > 0 ? (
        <View style={styles.tileDot}><Badge count={convo.unreadCount} tone="accent" /></View>
      ) : convo.hasUnread ? (
        <View style={styles.tileDot}><Badge dot tone="accent" /></View>
      ) : null}
    </Touchable>
  )
})

/* ---------------------------------------------------------
   The @handle resolver — one exact lookup, not a search.
   --------------------------------------------------------- */

function ResolverCard({ handle }: { handle: string }) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  const go = async () => {
    setBusy(true)
    try {
      const ch = await api.channels.byHandle(handle)
      if (ch) router.push(chRoute.channel(ch.id))
    } catch (e: any) {
      toast.warn(isNotFound(e) ? `No channel is called @${handle}.` : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Touchable
      onPress={go}
      disabled={busy}
      feedback="dim"
      noAutoHitSlop
      style={[styles.resolver, { backgroundColor: c.accentSofter, marginHorizontal: t.layout.screenPadding, borderRadius: t.radius.md }]}
    >
      <Icon name="at" size={20} color={c.accent} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" tone="accent" align="ui">Go to @{handle}</Text>
        <Text variant="caption" tone="muted" align="ui">Open this exact channel</Text>
      </View>
      {busy ? <Spinner /> : <DisclosureIcon color={c.accent} />}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  section: { paddingTop: space.lg, paddingBottom: space.sm },
  railPad: { paddingHorizontal: space.lg, gap: space.sm2, paddingBottom: space.xs },
  /* A tile is a bounded plate carrying text, so it wears the card setback
     (crowned top, rooted bottom) rather than a uniform radius. */
  tile: {
    width: 132,
    height: 164,
    ...setback(shape.card),
    borderCurve: 'continuous',
    padding: space.sm2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAll: { borderWidth: StyleSheet.hairlineWidth, gap: space.xs2, backgroundColor: 'transparent' },
  tileFlags: { flexDirection: 'row', gap: space.xs2, marginTop: space.xs2, height: 12 },
  tileDot: { position: 'absolute', top: 10, end: 10 },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.md2 },
  resolver: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md2, marginBottom: space.xs2 },
  moreDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.md2, paddingTop: space.sm2, paddingBottom: space.xs },
  skRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, alignItems: 'center' },
  flex: { flex: 1 },
})
