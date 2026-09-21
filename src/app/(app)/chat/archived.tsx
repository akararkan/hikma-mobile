/* =========================================================
   Archived chats.

   The list is server-ordered by activity with NO pinned-first
   grouping: pinning an archived chat is a preference for when
   it comes back, not a reason to float it here.

   Archiving is per-user and silent — the peer and the group are
   untouched — and a new message does not un-archive anything.
   The strip under the header says so, because every messenger
   answers that question differently and guessing wrong means
   missing messages.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/context/AuthContext'
import { useChatActions, useChatInbox, useChatSettings } from '@/context/ChatContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ConfirmSheet, EmptyState, Header, ListFooter, Screen, Text, toast, useSheetState,
} from '@/ui'
import { ConversationRow } from '@/components/chat/ConversationRow'
import { SwipeRow, type SwipeAction } from '@/components/chat/SwipeRow'
import { ConversationSkeleton } from '@/components/chat/states'
import { useUserDirectory, type UserCard } from '@/components/chat/userDirectory'

const keyExtractor = (item: any) => String(item.id)

/* ---------------------------------------------------------
   One archived row, memoized, exactly like the inbox's. The
   swipe panes were being rebuilt as two fresh arrays inside
   renderItem for every row on every screen render — and this
   screen re-renders on every archived-list frame. Now each row
   rebuilds its own only when its own pin/unread state moves,
   and every handler it receives is created once by the screen.
   --------------------------------------------------------- */

interface ArchivedRowProps {
  item: any
  myId: string | null
  presenceVisible: boolean
  peerCard: UserCard | null
  nameOf: (userId: string) => string
  onOpen: (convo: any) => void
  onTogglePin: (convo: any) => void
  onToggleRead: (convo: any) => void
  onUnarchive: (convo: any) => void
  onDelete: (convo: any) => void
}

const ArchivedRow = React.memo(function ArchivedRow({
  item, myId, presenceVisible, peerCard, nameOf,
  onOpen, onTogglePin, onToggleRead, onUnarchive, onDelete,
}: ArchivedRowProps) {
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
    { key: 'unarchive', label: 'Unarchive', icon: 'archive', tint: c.accent, onTrigger: () => onUnarchive(item) },
    { key: 'delete', label: 'Delete', icon: 'trash', tint: c.danger, onTrigger: () => onDelete(item) },
  ], [item, c.accent, c.danger, onUnarchive, onDelete])

  const press = React.useCallback(() => onOpen(item), [onOpen, item])
  /* Unarchive, not delete: the row's PRIMARY action must have a non-gesture
     path, and pointing the only fallback at the destructive one meant a
     reader (or anyone who missed the swipe) could delete but never restore. */
  const longPress = React.useCallback(() => onUnarchive(item), [onUnarchive, item])

  return (
    <SwipeRow resetKey={String(item.id)} leading={leading} trailing={trailing}>
      <ConversationRow
        convo={item}
        peerCard={peerCard}
        nameOf={nameOf}
        presenceVisible={presenceVisible}
        myId={myId}
        onPress={press}
        onLongPress={longPress}
      />
    </SwipeRow>
  )
})

export default function ArchivedScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const myId = user?.id ? String(user.id) : null

  /* No typingIn/presenceOf here: ConversationRow subscribes to its own
     conversation's keys when they are left undefined, so a typing or presence
     frame repaints one row instead of the whole screen. */
  const { archived, archivedHasMore } = useChatInbox()
  const chatSettings = useChatSettings()
  const {
    loadArchived, loadMoreArchived, trackPresence,
    markRead, markUnread, togglePin, toggleArchive, deleteConvo,
  } = useChatActions()

  const dir = useUserDirectory()
  const confirmDelete = useSheetState<any>()
  const [loading, setLoading] = React.useState(!archived.length)
  const [refreshing, setRefreshing] = React.useState(false)

  React.useEffect(() => {
    void loadArchived().finally(() => setLoading(false))
  }, [loadArchived])

  React.useEffect(() => {
    const peers = archived.filter(x => !x.isGroup).map(x => x.peer?.id).filter(Boolean)
    dir.watchUsers(peers)
    trackPresence(peers)
  }, [archived, dir, trackPresence])

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    await loadArchived()
    setRefreshing(false)
  }, [loadArchived])

  const unarchive = React.useCallback(async (convo: any) => {
    try {
      await toggleArchive(convo.id)
      toast.ok('Chat unarchived', { label: 'Undo', onPress: () => { toggleArchive(convo.id).catch(() => {}) } })
    } catch { /* toggleArchive already restored the row and toasted */ }
  }, [toggleArchive])

  /* One handler per ACTION, created once and shared by every row — the row
     rides each callback's first argument. */
  const open = React.useCallback((convo: any) => router.push(`/chat/${convo.id}`), [router])
  const pin = React.useCallback((convo: any) => { void togglePin(convo.id) }, [togglePin])
  const toggleRead = React.useCallback((convo: any) => {
    const hasUnread = !!convo.hasUnread || (convo.unreadCount || 0) > 0
    void (hasUnread ? markRead(convo.id, convo.lastMessageId) : markUnread(convo.id))
  }, [markRead, markUnread])
  const requestDelete = React.useCallback((convo: any) => confirmDelete.open(convo), [confirmDelete.open])   // eslint-disable-line react-hooks/exhaustive-deps

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <ArchivedRow
      item={item}
      myId={myId}
      presenceVisible={chatSettings.lastSeenVisible}
      peerCard={dir.userOf(item.peer?.id)}
      nameOf={dir.nameOf}
      onOpen={open}
      onTogglePin={pin}
      onToggleRead={toggleRead}
      onUnarchive={unarchive}
      onDelete={requestDelete}
    />
  ), [myId, chatSettings.lastSeenVisible, dir, open, pin, toggleRead, unarchive, requestDelete])

  return (
    <Screen>
      <Header back title="Archived" />

      <View style={[styles.note, { borderBottomColor: c.separator }]}>
        <Text variant="footnote" tone="muted" align="ui">
          Archived chats stay here until you unarchive them. New messages do not un-archive a chat.
        </Text>
      </View>

      {loading && !archived.length ? (
        <ConversationSkeleton count={5} />
      ) : (
        <FlashList
          data={archived}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onEndReached={() => { if (archivedHasMore) void loadMoreArchived() }}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <EmptyState icon="archive" title="Nothing archived" message="Chats you archive will appear here." />
          }
          ListFooterComponent={
            archived.length ? <ListFooter done={!archivedHasMore} doneLabel="" /> : null
          }
        />
      )}

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this chat?"
        message="This removes it from your inbox. Everyone else keeps their copy."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const row = confirmDelete.payload
          confirmDelete.close()
          if (!row) return
          deleteConvo(row.id).catch(() => { /* the provider rolled the row back and explained why */ })
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: space.lg, paddingVertical: space.sm2, borderBottomWidth: StyleSheet.hairlineWidth },
})
