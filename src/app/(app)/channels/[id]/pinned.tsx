/* =========================================================
   Pinned posts.

   `messages.pinned` is not paged — the whole set comes back
   newest-pin-first, so there is no footer and no cursor here.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ConfirmSheet, EmptyState, ErrorState, Header, Screen, SkeletonCard, Text, Touchable,
  toast, useSheetState,
} from '@/ui'
import { ChannelPostCard } from '@/components/channels/ChannelPostCard'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (p: any) => String(p.id)

export default function PinnedScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const pinned = useAsync<any[]>(() => api.chat.messages.pinned(id), { enabled: !!id, deps: [id] })
  const confirmUnpin = useSheetState<any>()

  useFocusEffect(React.useCallback(() => { void pinned.refresh() }, [id]))   // eslint-disable-line react-hooks/exhaustive-deps

  /* A tombstoned pin has to disappear without a refetch — the pinned list is
     not paged, so a stale card would sit here until the next focus. */
  useChannelStream(id, {
    onDeleted: e => pinned.setData(prev => (prev || []).filter(p => String(p.id) !== String(e.messageId))),
  })

  const canPin = rights.can('canPinMessages')

  const unpin = async (post: any) => {
    const before = pinned.data
    pinned.setData(prev => (prev || []).filter(p => p.id !== post.id))
    try { await api.chat.messages.unpin(id, post.id) }
    catch (e: any) { pinned.setData(before ?? null); toast.error(errorText(e)) }
  }

  /* Identity-stable handlers, so `renderItem` never changes and FlashList's
     cell memo can skip the cards a re-render did not touch. */
  const openPost = useEvent((post: any) => router.push(chRoute.post(id, String(post.id))))
  const openMedia = useEvent((post: any, index: number) => router.push(chRoute.viewer(id, String(post.id), {
    index, title: rights.channel?.title, protected: !!rights.channel?.settings?.protectedContent,
  })))
  const openTag = useEvent((tag: string) => router.push(chRoute.tag(id, tag)))
  const openMention = useEvent((handle: string) => router.push(chRoute.user(handle)))
  const askUnpin = useEvent((post: any) => confirmUnpin.open(post))

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <PinnedCard
      post={item}
      channel={rights.channel}
      myAdminRow={rights.myAdminRow}
      canPin={canPin}
      onOpen={openPost}
      onOpenMedia={openMedia}
      onTagPress={openTag}
      onMentionPress={openMention}
      onUnpin={askUnpin}
    />
  ), [rights.channel, rights.myAdminRow, canPin, openPost, openTag, openMention, askUnpin])

  return (
    <Screen background="sunken">
      <Header
        back
        title="Pinned posts"
        subtitle={pinned.data ? `${pinned.data.length} pinned` : rights.channel?.title}
      />

      {pinned.loading ? (
        <View><SkeletonCard /><SkeletonCard /></View>
      ) : pinned.error ? (
        <ErrorState error={pinned.error} onRetry={pinned.reload} />
      ) : (
        <FlashList
          data={pinned.data || []}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              icon="pin"
              title="Nothing is pinned"
              message={canPin ? 'Pin a post from its menu to highlight it here.' : 'Admins pin posts they want everyone to see.'}
            />
          }
          ListFooterComponent={
            canPin && pinned.data?.length ? (
              <Text variant="footnote" tone="muted" align="center" style={{ padding: space.xl }}>
                Pinned posts appear in the bar at the top of the channel.
              </Text>
            ) : null
          }
          refreshing={pinned.refreshing}
          onRefresh={() => void pinned.refresh()}
          contentContainerStyle={{ paddingVertical: space.md }}
        />
      )}

      <ConfirmSheet
        visible={confirmUnpin.visible}
        onClose={confirmUnpin.close}
        title="Unpin this post?"
        message="It stays in the channel — it just stops being highlighted."
        confirmLabel="Unpin"
        destructive
        onConfirm={() => { const p = confirmUnpin.payload; confirmUnpin.close(); void unpin(p) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One pinned card. Memoized, with the per-post closures built
   inside the boundary so a re-render of the screen does not
   repaint every card.
   --------------------------------------------------------- */

const PinnedCard = React.memo(function PinnedCard({
  post, channel, myAdminRow, canPin, onOpen, onOpenMedia, onTagPress, onMentionPress, onUnpin,
}: {
  post: any
  channel: any
  myAdminRow: any
  canPin: boolean
  onOpen: (post: any) => void
  onOpenMedia: (post: any, index: number) => void
  onTagPress: (tag: string) => void
  onMentionPress: (handle: string) => void
  onUnpin: (post: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const open = React.useCallback(() => onOpen(post), [onOpen, post])
  const openMedia = React.useCallback((i: number) => onOpenMedia(post, i), [onOpenMedia, post])
  const unpin = React.useCallback(() => onUnpin(post), [onUnpin, post])

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderRadius: t.radius.md,
          marginHorizontal: t.layout.screenPadding,
          borderStartColor: c.accent,
        },
      ]}
    >
      <Text variant="caption" tone="faint" align="ui" style={styles.pinnedAt}>Pinned {post.time}</Text>
      <ChannelPostCard
        post={post}
        channel={channel}
        myAdminRow={myAdminRow}
        variant="compact"
        onPress={open}
        onOpenMedia={openMedia}
        onTagPress={onTagPress}
        onMentionPress={onMentionPress}
      />
      <View style={styles.footer}>
        <Touchable onPress={open} feedback="dim">
          <Text variant="subhead" tone="accent" align="ui">Read post</Text>
        </Touchable>
        {canPin ? (
          <Touchable onPress={unpin} feedback="dim">
            <Text variant="subhead" tone="danger" align="ui">Unpin</Text>
          </Touchable>
        ) : null}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  card: { borderStartWidth: 3, overflow: 'hidden', marginBottom: space.sm2, paddingTop: space.sm },
  pinnedAt: { position: 'absolute', top: 10, end: 14, zIndex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.xl, paddingHorizontal: space.lg, paddingBottom: space.md2 },
})
