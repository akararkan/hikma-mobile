/* =========================================================
   Chats — the inbox.

   Almost all of this screen is a rendering of ChatContext:
   the ordering (pinned first, then newest activity with an
   exact Snowflake tiebreak) and the unread deltas live there
   because the badge has to stay right whether or not this tab
   is mounted. Typing and presence are per-key realtime
   subscriptions each row reads for itself, so a frame for one
   conversation repaints one row.

   What lives HERE is the interaction layer: swipes, the
   long-press menu, and the two states the provider cannot
   express — a failed refresh (offline) versus a dropped socket
   (reconnecting). Those are different sentences because they
   are different problems, and a single "offline" bar tells half
   the users something false.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { api, isNetworkError } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatActions, useChatInbox, useChatRequests, useChatSettings } from '@/context/ChatContext'
import { useTheme } from '@/theme/ThemeProvider'
import { radius, setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ConfirmSheet, EmptyState, Header, Icon, ListFooter, Screen,
  Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'
import { ConversationRow } from '@/components/chat/ConversationRow'
import { NewFollowers } from '@/components/chat/NewFollowers'
import { SwipeRow, type SwipeAction } from '@/components/chat/SwipeRow'
import { ChatErrorState, ConnectionBar, ConversationSkeleton } from '@/components/chat/states'
import { useUserDirectory, type UserCard } from '@/components/chat/userDirectory'
import { useTabRetap } from '@/components/nav/tabEvents'
import { useTabBarClearance } from '@/hooks/useTabBarClearance'

/** Mute durations, as ISO instants computed at tap time. `null` unmutes. */
const keyExtractor = (item: any) => String(item.id)

const MUTE_CHOICES: { label: string; hours: number | null }[] = [
  { label: 'For 8 hours', hours: 8 },
  { label: 'For 1 week', hours: 24 * 7 },
  { label: 'Always', hours: 24 * 365 * 20 },
]

/* ---------------------------------------------------------
   One inbox row. Memoized so the list only re-renders the rows
   whose conversation actually changed: everything volatile —
   typing, presence — is read INSIDE ConversationRow through the
   per-key realtime hooks, and every handler here is an
   item-typed callback the screen creates once. The SwipeRow
   action arrays are rebuilt only when this row's own pin/unread
   state moves.
   --------------------------------------------------------- */

interface InboxRowProps {
  item: any
  myId: string | null
  presenceVisible: boolean
  peerCard: UserCard | null
  nameOf: (userId: string) => string
  onOpen: (convo: any) => void
  onPrefetch: (convo: any) => void
  onRowLongPress: (convo: any) => void
  onTogglePin: (convo: any) => void
  onToggleRead: (convo: any) => void
  onArchive: (convo: any) => void
  onDelete: (convo: any) => void
}

const InboxRow = React.memo(function InboxRow({
  item, myId, presenceVisible, peerCard, nameOf,
  onOpen, onPrefetch, onRowLongPress, onTogglePin, onToggleRead, onArchive, onDelete,
}: InboxRowProps) {
  const t = useTheme()
  const c = t.colors
  const hasUnread = !!item.hasUnread || (item.unreadCount || 0) > 0

  const leading = React.useMemo<SwipeAction[]>(() => [
    {
      key: 'pin',
      label: item.pinned ? 'Unpin' : 'Pin',
      icon: item.pinned ? 'unpin' : 'pin',
      tint: c.warning,
      onTrigger: () => onTogglePin(item),
    },
    {
      key: 'read',
      label: hasUnread ? 'Read' : 'Unread',
      icon: 'mail',
      tint: c.info,
      onTrigger: () => onToggleRead(item),
    },
  ], [item, hasUnread, c.warning, c.info, onTogglePin, onToggleRead])

  const trailing = React.useMemo<SwipeAction[]>(() => [
    { key: 'archive', label: 'Archive', icon: 'archive', tint: c.accent, onTrigger: () => onArchive(item) },
    { key: 'delete', label: 'Delete', icon: 'trash', tint: c.danger, onTrigger: () => onDelete(item) },
  ], [item, c.accent, c.danger, onArchive, onDelete])

  const press = React.useCallback(() => onOpen(item), [onOpen, item])
  const pressIn = React.useCallback(() => onPrefetch(item), [onPrefetch, item])
  const longPress = React.useCallback(() => onRowLongPress(item), [onRowLongPress, item])

  return (
    <SwipeRow resetKey={String(item.id)} leading={leading} trailing={trailing}>
      <ConversationRow
        convo={item}
        peerCard={peerCard}
        nameOf={nameOf}
        presenceVisible={presenceVisible}
        myId={myId}
        onPress={press}
        onPressIn={pressIn}
        onLongPress={longPress}
      />
    </SwipeRow>
  )
})

export default function ChatsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const myId = user?.id ? String(user.id) : null

  const { conversations, loading, error, connected, inboxHasMore, inboxLoadingMore } = useChatInbox()
  const { requestCount } = useChatRequests()
  const chatSettings = useChatSettings()
  const {
    refreshInbox, loadMoreInbox, trackPresence, setUnreadCount,
    markRead, markUnread, togglePin, toggleMute, toggleArchive, deleteConvo,
  } = useChatActions()

  const dir = useUserDirectory()
  const listRef = React.useRef<FlashListRef<any>>(null)
  const menu = useSheetState<any>()
  const muteSheet = useSheetState<any>()
  const confirmDelete = useSheetState<any>()
  const [refreshing, setRefreshing] = React.useState(false)
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)
  const [offline, setOffline] = React.useState(false)

  /* Resolve the peers' avatars and presence for whatever is loaded. Both are
     coalesced and cached, so calling this on every render is cheap. */
  React.useEffect(() => {
    const peers = conversations.filter(x => !x.isGroup).map(x => x.peer?.id).filter(Boolean)
    dir.watchUsers(peers)
    trackPresence(peers)
  }, [conversations, dir, trackPresence])

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      /* refreshInbox swallows its own failure into a toast, so the offline
         flag is decided by a call that does not. unreadCount is the cheapest
         one, and re-seeding the absolute badge after a manual pull is exactly
         what the delta model asks for anyway — so its answer is applied rather
         than thrown away, which is what this used to do while claiming
         otherwise. One request, both jobs. */
      const [, unread] = await Promise.all([refreshInbox(), api.chat.unreadCount()])
      setUnreadCount(unread)
      setOffline(false)
    } catch (e) {
      setOffline(isNetworkError(e))
    } finally {
      setRefreshing(false)
    }
  }, [refreshInbox, setUnreadCount])

  /* Re-tapping Chat while it is the active tab: top first, refresh second.
     `collapsed` is already the "past 8pt" flag the header folds on, so it
     doubles as the at-top test rather than paying a second scroll listener
     for the same number. */
  useTabRetap('chat', () => {
    if (!collapsed) { void refresh(); return }
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  })

  const open = React.useCallback((convo: any) => {
    router.push(`/chat/${convo.id}`)
  }, [router])

  /* Finger-down warms the thread: prefetch really mounts the screen (its
     conversation, draft and first-page reads go out), so by the time the
     240ms push lands the bubbles are usually already there. Read-marking is
     safe — the thread marks read only while FOCUSED. Once per conversation
     per visit; the mount is idempotent either way. */
  const prefetched = React.useRef(new Set<string>())
  const prefetchThread = React.useCallback((convo: any) => {
    const id = String(convo.id)
    if (prefetched.current.has(id)) return
    prefetched.current.add(id)
    try { router.prefetch(`/chat/${id}`) } catch { /* best-effort */ }
  }, [router])

  const openMenu = menu.open
  const longPress = React.useCallback((convo: any) => {
    fireHaptic('select')
    openMenu(convo)
  }, [openMenu])

  /* ---- optimistic actions with an undo where one makes sense ---- */

  const archive = React.useCallback(async (convo: any) => {
    try {
      await toggleArchive(convo.id)
      toast.ok('Chat archived', { label: 'Undo', onPress: () => { toggleArchive(convo.id).catch(() => {}) } })
    } catch { /* toggleArchive already restored the row and toasted */ }
  }, [toggleArchive])

  /* deleteConvo restores the row and toasts the server's own words before it
     rethrows, so there is nothing left to say here — a second toast would
     just say it twice. The catch exists to keep the rejection from surfacing
     as an unhandled promise. */
  const remove = React.useCallback(async (convo: any) => {
    try { await deleteConvo(convo.id) }
    catch { /* the provider rolled the row back and explained why */ }
  }, [deleteConvo])

  const pin = React.useCallback((convo: any) => { void togglePin(convo.id) }, [togglePin])

  const toggleRead = React.useCallback((convo: any) => {
    const hasUnread = !!convo.hasUnread || (convo.unreadCount || 0) > 0
    void (hasUnread ? markRead(convo.id, convo.lastMessageId) : markUnread(convo.id))
  }, [markRead, markUnread])

  const requestDelete = React.useCallback((convo: any) => confirmDelete.open(convo), [confirmDelete.open])

  /* Stable identity: an inline object here re-measures the FlashList content
     container on renders that moved nothing.

     The old value was `insets.bottom + 60`, which is not the bar. TabBar
     renders at `tabBarHeight + max(insets.bottom, 8)` — 98pt with a home
     indicator, 72pt without — so 60 left the last row 4pt under the bar on an
     iPhone 15 and 12pt under it on a phone with no indicator. Derived now, so
     it cannot drift from the bar again. */
  const bottomPad = useTabBarClearance()
  const listPad = React.useMemo(() => ({ paddingBottom: bottomPad }), [bottomPad])

  /* Every dependency here is identity-stable, so renderItem survives inbox
     churn and FlashList leaves untouched cells alone. `peerCard` is passed
     from here rather than resolved in the row so a directory answer still
     breaks the memo for exactly the rows it names. */
  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <InboxRow
      item={item}
      myId={myId}
      presenceVisible={chatSettings.lastSeenVisible}
      peerCard={dir.userOf(item.peer?.id)}
      nameOf={dir.nameOf}
      onOpen={open}
      onPrefetch={prefetchThread}
      onRowLongPress={longPress}
      onTogglePin={pin}
      onToggleRead={toggleRead}
      onArchive={archive}
      onDelete={requestDelete}
    />
  ), [myId, chatSettings.lastSeenVisible, dir, open, prefetchThread, longPress, pin, toggleRead, archive, requestDelete])

  const chips = (
    <View style={styles.below}>
      <Touchable
        onPress={() => router.push('/chat/search')}
        feedback="dim"
        noAutoHitSlop
        accessibilityLabel="Search messages"
        style={[styles.searchPlate, { backgroundColor: c.surfaceSunken }]}
      >
        <Icon name="search" size={17} color={c.textMuted} />
        <Text variant="callout" tone="muted" align="ui">Search messages</Text>
      </Touchable>

      {/* Five chips outgrow a narrow phone — the rail scrolls rather than
          clipping Calls and Channels off the end. The badge rides in the
          scroll content, so it travels with its chip. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
        <Chip
          label="Requests"
          icon="mail"
          tone={requestCount > 0 ? 'accent' : 'neutral'}
          onPress={() => router.push('/chat/requests')}
        />
        {requestCount > 0 ? (
          <View style={[styles.chipBadge, { backgroundColor: c.danger }]}>
            <Text variant="micro" color={c.textOnAccent} align="center">{requestCount > 99 ? '99+' : requestCount}</Text>
          </View>
        ) : null}
        <Chip label="Archived" icon="archive" onPress={() => router.push('/chat/archived')} />
        <Chip label="Starred" icon="star" onPress={() => router.push('/chat/starred')} />
        {/* Calls are conversations too — a missed one is only findable here. */}
        <Chip label="Calls" icon="call" onPress={() => router.push('/calls')} />
        <Chip label="Channels" icon="channels" onPress={() => router.push('/channels')} />
      </ScrollView>
    </View>
  )

  return (
    <Screen>
      <Header
        large
        title="Chats"
        collapsed={collapsed}
        actions={[
          { icon: 'search', onPress: () => router.push('/chat/search'), label: 'Search messages' },
          { icon: 'settings', onPress: () => router.push('/chat/settings'), label: 'Chat privacy' },
          { icon: 'edit', onPress: () => router.push('/chat/new'), label: 'New chat', tone: 'accent' },
        ]}
        below={chips}
      />

      <ConnectionBar connected={connected} offline={offline} />

      {loading && !conversations.length ? (
        <ConversationSkeleton />
      ) : error && !conversations.length ? (
        <ChatErrorState error={error} title="Could not load your chats" onRetry={refresh} />
      ) : (
        <FlashList
          ref={listRef}
          data={conversations}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onEndReached={() => { if (inboxHasMore) void loadMoreInbox() }}
          onEndReachedThreshold={0.6}
          onScroll={e => {
            /* Updater-form guard: this fires per scroll frame, and only the
               flip across the 8pt boundary may schedule a screen render. */
            const next = e.nativeEvent.contentOffset.y > 8
            setCollapsed(prev => (prev === next ? prev : next))
          }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          contentContainerStyle={listPad}
          /* The component TYPE, not an element — module-level identity, per
             this file's own rule that everything handed to the FlashList
             stays identity-stable. It scrolls away with the inbox (web rail
             parity) and renders null when there is nothing to say. */
          ListHeaderComponent={NewFollowers}
          ListEmptyComponent={
            <EmptyState
              icon="chat"
              title="No conversations yet"
              message="Start a chat with someone you follow."
              actionLabel="New chat"
              onAction={() => router.push('/chat/new')}
            />
          }
          ListFooterComponent={
            conversations.length
              ? <ListFooter loading={inboxLoadingMore} done={!inboxHasMore} doneLabel="" />
              : null
          }
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.displayTitle}
        actions={[
          {
            label: menu.payload?.pinned ? 'Unpin' : 'Pin',
            icon: menu.payload?.pinned ? 'unpin' : 'pin',
            onPress: () => { if (menu.payload) void togglePin(menu.payload.id) },
          },
          {
            label: menu.payload?.muted ? 'Unmute' : 'Mute',
            icon: menu.payload?.muted ? 'bell' : 'mutedBell',
            onPress: () => {
              if (!menu.payload) return
              if (menu.payload.muted) void toggleMute(menu.payload.id)
              else muteSheet.open(menu.payload)
            },
          },
          {
            label: (menu.payload?.hasUnread || (menu.payload?.unreadCount || 0) > 0) ? 'Mark as read' : 'Mark as unread',
            icon: 'mail',
            onPress: () => {
              const row = menu.payload
              if (!row) return
              const unread = !!row.hasUnread || (row.unreadCount || 0) > 0
              void (unread ? markRead(row.id, row.lastMessageId) : markUnread(row.id))
            },
          },
          {
            label: 'Archive',
            icon: 'archive',
            onPress: () => { if (menu.payload) void archive(menu.payload) },
          },
          {
            label: 'Conversation info',
            icon: 'info',
            onPress: () => { if (menu.payload) router.push(`/chat/${menu.payload.id}/info`) },
          },
          {
            label: 'Delete chat',
            icon: 'trash',
            destructive: true,
            onPress: () => { if (menu.payload) confirmDelete.open(menu.payload) },
          },
        ]}
      />

      <ActionSheet
        visible={muteSheet.visible}
        onClose={muteSheet.close}
        title="Mute notifications"
        subtitle="You will still see the chat in your inbox."
        actions={MUTE_CHOICES.map(choice => ({
          label: choice.label,
          icon: 'mutedBell' as const,
          onPress: () => {
            if (!muteSheet.payload || choice.hours == null) return
            /* `mutedUntil` is an instant, not a flag — compute it now so a mute
               set at 21:00 lapses at 05:00 rather than "eight hours after the
               server happens to process it". */
            const until = new Date(Date.now() + choice.hours * 3600_000).toISOString()
            void toggleMute(muteSheet.payload.id, until)
          },
        }))}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this chat?"
        message={
          confirmDelete.payload?.isGroup && confirmDelete.payload?.myRole === 'OWNER'
            ? 'This deletes the group for everyone. The message history is retained but nobody can open it again.'
            : 'This removes it from your inbox. Everyone else keeps their copy.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const row = confirmDelete.payload
          confirmDelete.close()
          if (row) void remove(row)
        }}
      />
    </Screen>
  )
}

/* Component geometry, named once. The search plate is a control, so it takes
   the md-button height; the requests badge is the second sanctioned pill on
   this screen (DESIGN.md §9) and is sized to seat `micro` type. */
const SEARCH_PLATE_H = 40
const CHIP_BADGE = 18

const styles = StyleSheet.create({
  below: { paddingBottom: space.sm2, gap: space.sm2 },
  /* A md-button setback, not a pill: the two sanctioned pills are unread
     counters and LIVE badges (DON'T #9), and this is a 40pt text plate. */
  searchPlate: {
    ...setback(shape.buttonMd),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: SEARCH_PLATE_H,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md2,
  },
  chipRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  /* Rides the top-end corner of the Requests chip. The two negative offsets
     are the overlap, not spacing between siblings — they pull the badge onto
     the chip it counts for. `paddingHorizontal` 5 → 6: the one stray value on
     this screen, corrected by 1pt onto the grid. */
  chipBadge: {
    minWidth: CHIP_BADGE,
    height: CHIP_BADGE,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs2,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: -space.xs2,
    marginTop: -space.md2,
  },
})
