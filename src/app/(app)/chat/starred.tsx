/* =========================================================
   Starred messages.

   A star is private and per-viewer: the same message row is
   starred for me and not for anyone else, and the server
   filters out anything deleted for everyone or deleted for me,
   so no tombstone can ever appear here.

   The endpoint returns a BARE LIST rather than a Spring page —
   there is no `hasMore` to trust — so the end of the list is a
   short page, which is exactly what usePaged's `page` mode
   already infers.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useChatActions } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, EmptyState, Header, Icon, ListFooter, Screen, Text,
  Touchable, toast, useSheetState,
} from '@/ui'
import { MediaGrid } from '@/components/chat/MediaGrid'
import { FileTile } from '@/components/chat/Payloads'
import { VoiceNote } from '@/components/chat/VoiceNote'
import { MessageCardSkeleton, ChatErrorState } from '@/components/chat/states'
import { snippetOf } from '@/components/chat/format'
import { useUserDirectory } from '@/components/chat/userDirectory'

const keyExtractor = (item: any) => String(item.id)

/* By reference, so the header ViewHolder is not remounted on every render of
   the screen. */
function Intro() {
  return (
    <Text variant="footnote" tone="muted" align="ui" style={styles.intro}>
      Only you can see your starred messages.
    </Text>
  )
}

export default function StarredScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { convId } = useLocalSearchParams<{ convId?: string }>()
  const { getConvo } = useChatActions()
  const dir = useUserDirectory()
  const menu = useSheetState<any>()

  const list = usePaged<any>(
    ({ page, pageSize }) => api.chat.messages.starred({ page: page ?? 0, size: pageSize }),
    { mode: 'page', pageSize: 30, deps: [] },
  )

  /* There is no server-side conversation filter on this endpoint, so the
     ?convId= entry point narrows the list here and the header says so. */
  const rows = React.useMemo(
    () => (convId ? list.items.filter(m => String(m.conversationId) === String(convId)) : list.items),
    [list.items, convId],
  )

  React.useEffect(() => { dir.watchUsers(rows.map(m => m.senderId)) }, [rows, dir])

  const unstar = React.useCallback(async (message: any) => {
    list.remove(String(message.id))
    try {
      await api.chat.messages.unstar(message.id)
      toast.ok('Removed from starred', {
        label: 'Undo',
        onPress: () => {
          api.chat.messages.star(message.id)
            .then(() => list.prepend(message))
            .catch(e => toast.error(chatError(e, 'Could not restore the star')))
        },
      })
    } catch (e) {
      list.prepend(message)
      toast.error(chatError(e, 'Could not unstar this message'))
    }
  }, [list])

  const renderItem = React.useCallback(({ item }: { item: any }) => {
    const convo = getConvo(item.conversationId)
    const card = dir.userOf(item.senderId)
    const visual = (item.media || []).filter((m: any) => m.kind === 'IMAGE' || m.kind === 'VIDEO')
    const voice = (item.media || []).find((m: any) => m.kind === 'VOICE')
    const file = (item.media || []).find((m: any) => m.kind === 'FILE')

    return (
      <Touchable
        onPress={() => router.push(`/chat/${item.conversationId}?jump=${item.id}`)}
        onLongPress={() => menu.open(item)}
        feedback="dim"
        noAutoHitSlop
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint }]}
      >
        <View style={styles.topLine}>
          {/* No call-site transform: a conversation title can be Arabic or
              Kurdish, and `micro` uppercases Latin only, inside the Text
              primitive where the script is known. */}
          <Text variant="micro" tone="muted" align="ui" numberOfLines={1} style={styles.flex}>
            {convo?.displayTitle || 'Conversation'}
          </Text>
          <Text variant="caption" tone="faint" align="ui">{item.time}</Text>
        </View>

        <View style={styles.senderRow}>
          <Avatar uri={card?.profileImage} name={item.sender?.full} seed={item.senderId} size={28} />
          <Text variant="footnote" weight="600" numberOfLines={1} style={styles.flex}>
            {item.sender?.full || 'Member'}
          </Text>
          <Touchable onPress={() => { void unstar(item) }} feedback="scale" accessibilityLabel="Unstar">
            <Icon name="star" size={20} color={c.scholar} filled />
          </Touchable>
        </View>

        {visual.length ? <MediaGrid media={visual} maxWidth={220} radius={10} /> : null}
        {voice ? (
          <VoiceNote media={voice} messageId={String(item.id)} compact />
        ) : null}
        {file ? <FileTile media={file} fg={c.text} fgMuted={c.textMuted} /> : null}

        {item.body ? (
          <Text variant="callout" align="auto" numberOfLines={4}>{item.body}</Text>
        ) : !visual.length && !voice && !file ? (
          <Text variant="callout" tone="muted" align="auto">{snippetOf(item)}</Text>
        ) : null}
      </Touchable>
    )
    /* `menu.open` rather than `menu`: useSheetState rebuilds its wrapper object
       every render, and a churning renderItem re-invokes every mounted cell —
       FlashList's ViewHolder memo compares renderItem by identity. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, getConvo, dir, router, menu.open, unstar])

  const scopedTitle = convId ? getConvo(convId)?.displayTitle : null

  return (
    <Screen background="sunken">
      <Header back title="Starred messages" subtitle={scopedTitle ? `in ${scopedTitle}` : undefined} />

      {list.loading ? (
        <MessageCardSkeleton count={4} />
      ) : list.error ? (
        <ChatErrorState error={list.error} title="Could not load starred messages" onRetry={list.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
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
          contentContainerStyle={{ padding: space.md, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={Intro}
          ListEmptyComponent={
            <EmptyState
              icon="star"
              title="No starred messages"
              message="Long-press a message and choose Star to save it here."
            />
          }
          ListFooterComponent={rows.length ? <ListFooter loading={list.loadingMore} done={list.done} doneLabel="" /> : null}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Jump to message',
            icon: 'forward',
            onPress: () => {
              const m = menu.payload
              if (m) router.push(`/chat/${m.conversationId}?jump=${m.id}`)
            },
          },
          {
            label: 'Forward',
            icon: 'forwardMsg',
            onPress: () => { if (menu.payload) router.push(`/chat/forward?messageId=${menu.payload.id}`) },
          },
          {
            label: 'Unstar',
            icon: 'star',
            destructive: true,
            onPress: () => { if (menu.payload) void unstar(menu.payload) },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  /* THE STELE: card setback, 1px course, no shadow. */
  card: {
    borderWidth: StyleSheet.hairlineWidth, padding: space.md, marginBottom: space.sm2, gap: space.sm,
    ...setback(shape.card), borderCurve: 'continuous',
  },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  intro: { paddingHorizontal: space.xs, paddingBottom: space.sm2 },
})
