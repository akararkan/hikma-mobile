/* =========================================================
   Pinned messages.

   Soft-deleting a message also unpins it server-side, so this
   list self-corrects off the `message.deleted` frame rather
   than needing its own refetch. Pinning is announced in the
   chat as a system message, which the footer says out loud —
   people expect a pin to be private and it is not.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useChatActions, useConversation } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, shape, space } from '@/theme/tokens'
import { Avatar, EmptyState, Header, Icon, Screen, Text, Touchable, toast } from '@/ui'
import { MediaGrid } from '@/components/chat/MediaGrid'
import { VoiceNote } from '@/components/chat/VoiceNote'
import { clockTime, snippetOf } from '@/components/chat/format'
import { canPin } from '@/components/chat/permissions'
import { ChatErrorState, MessageCardSkeleton } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

const keyExtractor = (item: any) => String(item.id)

/* By reference, so the footer ViewHolder is not rebuilt on every render. */
function AnnounceNote() {
  return (
    <Text variant="caption" tone="faint" align="center" style={styles.footnote}>
      Pinning a message announces it in the chat.
    </Text>
  )
}

export default function PinnedScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const { subscribe } = useChatActions()
  /* The live row, subscribed per-key — `canPin` reads myRole from it, and a
     render-time getConvo() would go permanently stale now that this screen no
     longer re-renders on inbox churn. */
  const convo = useConversation(convId)
  const dir = useUserDirectory()

  const pinned = useAsync<any[]>(() => api.chat.messages.pinned(convId), { deps: [convId] })
  const rows = pinned.data || []

  useFocusEffect(React.useCallback(() => { void pinned.reload() }, [convId]))   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => subscribe(evt => {
    if (String(evt.conversationId) !== convId) return
    if (evt.type === 'message.deleted') {
      pinned.setData(prev => (prev ?? []).filter(m => String(m.id) !== String(evt.messageId)))
    } else if (evt.type === 'conversation.updated' && (evt.memberChange === 'PINNED' || evt.memberChange === 'UNPINNED')) {
      void pinned.reload()
    }
  }), [subscribe, convId, pinned])

  React.useEffect(() => { dir.watchUsers(rows.map(m => m.senderId)) }, [rows, dir])

  const unpin = useEvent(async (message: any) => {
    pinned.setData(prev => (prev ?? []).filter(m => String(m.id) !== String(message.id)))
    try {
      await api.chat.messages.unpin(convId, message.id)
      toast.ok('Unpinned', {
        label: 'Undo',
        onPress: () => {
          api.chat.messages.pin(convId, message.id)
            .then(() => pinned.reload())
            .catch(e => toast.warn(chatError(e, 'Could not restore the pin')))
        },
      })
    } catch (e) {
      void pinned.reload()
      toast.error(chatError(e, 'Could not unpin this message'))
    }
  })

  const mayPin = canPin(convo)

  const openMessage = useEvent((message: any) => router.replace(`/chat/${convId}?jump=${message.id}`))

  /* Identity-stable: FlashList compares renderItem by reference and re-invokes
     every mounted cell when it moves, and this screen re-renders on every
     `message.deleted` frame. */
  const renderItem = React.useCallback(({ item }: { item: any }) => {
    const card = dir.userOf(item.senderId)
    const visual = (item.media || []).filter((m: any) => m.kind === 'IMAGE' || m.kind === 'VIDEO')
    const voice = (item.media || []).find((m: any) => m.kind === 'VOICE')
    return (
      <Touchable
        onPress={() => openMessage(item)}
        feedback="dim"
        noAutoHitSlop
        style={[styles.card, { backgroundColor: c.surface, borderStartColor: c.accent }]}
      >
        <View style={styles.head}>
          <Avatar uri={card?.profileImage} name={item.sender?.full} seed={item.senderId} size={32} />
          <Text variant="footnote" weight="600" numberOfLines={1} style={styles.flex}>
            {item.sender?.full || 'Member'}
          </Text>
          <Text variant="caption" tone="faint" align="ui">{clockTime(item.createdAt)}</Text>
          {mayPin ? (
            <Touchable onPress={() => { void unpin(item) }} feedback="scale" accessibilityLabel="Unpin">
              <Icon name="unpin" size={19} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>

        {visual.length ? <MediaGrid media={visual} maxWidth={200} radius={10} /> : null}
        {voice ? (
          <VoiceNote media={voice} messageId={String(item.id)} compact />
        ) : null}
        {item.body ? (
          <Text variant="callout" align="auto" numberOfLines={3}>{item.body}</Text>
        ) : !visual.length && !voice ? (
          <Text variant="callout" tone="muted" align="auto">{snippetOf(item)}</Text>
        ) : null}
      </Touchable>
    )
  }, [c, dir, mayPin, openMessage, unpin])

  return (
    <Screen background="sunken">
      <Header back title="Pinned messages" subtitle={rows.length ? `${rows.length} pinned` : undefined} />

      {pinned.loading && !rows.length ? (
        <MessageCardSkeleton count={3} />
      ) : pinned.error && !rows.length ? (
        <ChatErrorState error={pinned.error} title="Could not load pinned messages" onRetry={pinned.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ padding: space.md, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <EmptyState
              icon="pin"
              title="Nothing pinned"
              message="Long-press a message and choose Pin to keep it here."
            />
          }
          ListFooterComponent={rows.length ? AnnounceNote : null}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  /* THE STELE with an accent selvedge at the start edge — card setback, no
     shadow (DESIGN.md §6, FeedCard). */
  card: {
    borderStartWidth: rule.selvedge, padding: space.md, marginBottom: space.sm2, gap: space.sm,
    ...setback(shape.card), borderCurve: 'continuous',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  footnote: { paddingVertical: space.lg2, paddingHorizontal: space.xxl },
})
