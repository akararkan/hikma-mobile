/* =========================================================
   Message info.

   The empty list has TWO causes and they need two different
   sentences. `seenBy` is symmetrically gated: with read
   receipts off you receive none and the array is EMPTY, and
   readers who turned theirs off are omitted from everyone
   else's list. Saying "no one has read this yet" in the first
   case is simply false, and the user has no way to tell.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, isNotFound } from '@/api'
import { gteId } from '@/api'
import { useChatActions, useChatSettings } from '@/context/ChatContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Header, Icon, InlineError, Screen, SkeletonList, Text, Touchable, toast, VerifiedMark,
} from '@/ui'
import { MediaGrid } from '@/components/chat/MediaGrid'
import { absoluteTime, snippetOf } from '@/components/chat/format'
import { ChatErrorState } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

const keyExtractor = (item: any) => String(item.userId)

export default function MessageInfoScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, messageId } = useLocalSearchParams<{ id: string; messageId: string }>()
  const convId = String(id)

  const { subscribe } = useChatActions()
  const chatSettings = useChatSettings()
  const dir = useUserDirectory()

  const message = useAsync<any>(() => api.chat.messages.get(messageId), { deps: [messageId] })
  const readers = useAsync<any[]>(() => api.chat.messages.seenBy(messageId), { deps: [messageId] })

  /* A receipt whose high-water mark reaches this message means that reader has
     seen it — append them rather than re-reading the whole list. */
  React.useEffect(() => subscribe(evt => {
    if (evt.type !== 'receipt.read' || String(evt.conversationId) !== convId) return
    if (!gteId(evt.lastReadMessageId, String(messageId))) return
    void readers.reload()
  }), [subscribe, convId, messageId, readers])

  React.useEffect(() => {
    dir.watchUsers((readers.data || []).map(r => r.userId))
  }, [readers.data, dir])

  React.useEffect(() => {
    if (!message.error) return
    if (isNotFound(message.error)) { toast.warn('This message is no longer available.'); router.back() }
    else if (codeOf(message.error) === 'NOT_A_MEMBER') { toast.warn('You are not a member of this conversation.'); router.back() }
  }, [message.error, router])

  const m = message.data
  const list = readers.data || []
  const readersSettled = !!readers.data && !readers.error
  const visual = React.useMemo(
    () => (m?.media || []).filter((x: any) => x.kind === 'IMAGE' || x.kind === 'VIDEO'),
    [m?.media],
  )

  const openReader = useEvent((reader: any) => router.push(`/u/${reader.handle || reader.userId}`))

  /* Identity-stable: a `receipt.read` frame reloads the reader list, and a
     churning renderItem would re-invoke every mounted row rather than the one
     the frame added. */
  const renderItem = React.useCallback(({ item }: { item: any }) => {
    const card = dir.userOf(item.userId)
    return (
      <Touchable onPress={() => openReader(item)} feedback="tint" noAutoHitSlop style={styles.reader}>
        <Avatar uri={card?.profileImage} name={item.fullName} seed={item.userId} size={40} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text variant="subhead" numberOfLines={1} style={styles.shrink}>{item.fullName}</Text>
            {card?.verified ? <VerifiedMark size={12} /> : null}
          </View>
          {item.handle ? <Text variant="footnote" tone="muted" align="ui">@{item.handle}</Text> : null}
        </View>
      </Touchable>
    )
  }, [dir, openReader])

  /* By reference, not a fresh element: this header carries the message
     preview and two stat rows, and FlashList re-renders the header ViewHolder
     whenever its identity moves. */
  const listHeader = React.useMemo(() => (
    <View>
      <View style={[styles.preview, { backgroundColor: c.surface }]}>
        {visual.length ? <MediaGrid media={visual} maxWidth={240} radius={12} /> : null}
        <Text variant="callout" align="auto">{m?.body || snippetOf(m)}</Text>
      </View>

      <View style={[styles.stat, { borderBottomColor: c.separator }]}>
        <Icon name="tickSingle" size={18} color={c.textSecondary} />
        <Text variant="footnote" align="ui" style={styles.flex}>Sent</Text>
        <Text variant="footnote" tone="muted" align="ui">{absoluteTime(m?.createdAt)}</Text>
      </View>
      {m?.editedAt ? (
        <View style={[styles.stat, { borderBottomColor: c.separator }]}>
          <Icon name="edit" size={18} color={c.textSecondary} />
          <Text variant="footnote" align="ui" style={styles.flex}>Edited</Text>
          <Text variant="footnote" tone="muted" align="ui">{absoluteTime(m.editedAt)}</Text>
        </View>
      ) : null}

      <View style={styles.sectionLabel}>
        {/* `micro` uppercases Latin inside the primitive — no call-site
            transform, so an Arabic UI is not shouted at. The count is dropped
            while the read is in flight or failed: "Read by 0" is an assertion,
            and we do not have the answer yet. */}
        <Text variant="micro" tone="muted" align="ui">
          {readersSettled ? `Read by ${list.length}` : 'Read by'}
        </Text>
      </View>
    </View>
  ), [c.surface, c.separator, c.textSecondary, visual, m, list.length, readersSettled])

  return (
    <Screen background="sunken">
      <Header title="Message info" closeButton back={() => router.back()} />

      {message.loading && !m ? (
        <SkeletonList count={4} />
      ) : !m ? (
        <ChatErrorState error={message.error} title="Could not load this message" onRetry={message.reload} back={() => router.back()} />
      ) : (
        <FlashList
          data={list}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            readers.loading ? (
              <SkeletonList count={3} />
            ) : readers.error ? (
              /* THE THIRD CAUSE. This screen exists because an empty list has
                 two meanings; a failed read is a third, and printing "no one
                 has read this yet" over it tells the user something false
                 about their own message. */
              <InlineError error={readers.error} onRetry={readers.reload} />
            ) : (
              <View style={styles.empty}>
                {chatSettings.readReceiptsEnabled ? (
                  <Text variant="footnote" tone="muted" align="center">No one has read this yet.</Text>
                ) : (
                  <>
                    <Text variant="footnote" tone="muted" align="center">
                      Read receipts are off, so this list is empty for you.
                    </Text>
                    <Touchable onPress={() => router.push('/chat/settings')} feedback="dim" noAutoHitSlop style={styles.link}>
                      <Text variant="footnote" tone="accent" align="center">Chat privacy settings</Text>
                    </Touchable>
                  </>
                )}
              </View>
            )
          }
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  preview: { margin: space.md, padding: space.md, gap: space.sm, ...setback(shape.card), borderCurve: 'continuous' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionLabel: { paddingHorizontal: space.lg, paddingTop: space.lg2, paddingBottom: space.xs2 },
  reader: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
  flex: { flex: 1 },
  empty: { padding: space.xxl, gap: space.xs2 },
  link: { paddingVertical: space.xs },
})
