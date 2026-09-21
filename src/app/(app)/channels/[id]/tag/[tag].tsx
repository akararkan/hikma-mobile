/* =========================================================
   One tag inside one channel.

   `messages.byTag` is an EXACT keyword lookup against the search
   index, with a bounded Cassandra fallback while that index is
   cold. So an empty answer moments after a post was published is
   normal rather than wrong — the empty copy says so instead of
   implying something broke.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, EmptyState, ErrorState, Header, Screen, SkeletonCard, Text, fireHaptic,
  toast, useSheetState,
} from '@/ui'
import { ChannelPostCard } from '@/components/channels/ChannelPostCard'
import { PostMenuSheet } from '@/components/channels/PostMenuSheet'
import { RefusalCard, useTransientRetry } from '@/components/channels/states'
import { useChannelRights, usePostViews } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { useAuth } from '@/context/AuthContext'

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (p: any) => String(p.id)

export default function ChannelTagScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id, tag } = useLocalSearchParams<{ id: string; tag: string }>()
  const clean = String(tag || '').replace(/^#/, '')

  const rights = useChannelRights(id)
  const channel = rights.channel
  const posts = useAsync<any[]>(() => api.chat.messages.byTag(id, clean), { enabled: !!id && !!clean, deps: [id, clean] })
  useTransientRetry(posts.error, posts.reload)

  const views = usePostViews(id)
  const menu = useSheetState<any>()

  const notMember = posts.error?.status === 403

  const react = async (post: any, emoji: string) => {
    try {
      const fresh = await api.chat.messages.react(post.id, emoji)
      posts.setData(prev => (prev || []).map(p => (p.id === post.id ? { ...p, reactions: fresh } : p)))
    } catch (e: any) { toast.error(errorText(e)) }
  }
  const unreact = async (post: any) => {
    try {
      const fresh = await api.chat.messages.unreact(post.id)
      posts.setData(prev => (prev || []).map(p => (p.id === post.id ? { ...p, reactions: fresh } : p)))
    } catch (e: any) { toast.error(errorText(e)) }
  }
  const vote = async (post: any, indexes: number[]) => {
    try {
      const poll = await api.chat.messages.vote(post.id, indexes)
      posts.setData(prev => (prev || []).map(p => (p.id === post.id ? { ...p, poll } : p)))
    } catch (e: any) { toast.error(errorText(e)) }
  }

  /* Identity-stable and item-first: one function per action serves the whole
     list, so a reaction landing on ONE post does not re-invoke renderItem for
     every mounted card. */
  const openPost = useEvent((post: any) => router.push(chRoute.post(id, String(post.id))))
  const openMedia = useEvent((post: any, index: number) => router.push(chRoute.viewer(id, String(post.id), {
    index, title: channel?.title, protected: !!channel?.settings?.protectedContent,
  })))
  const onReactPost = useEvent((post: any, emoji: string) => { void react(post, emoji) })
  const onUnreactPost = useEvent((post: any) => { void unreact(post) })
  const onVotePost = useEvent((post: any, indexes: number[]) => vote(post, indexes))
  const onMenuPost = useEvent((post: any) => { fireHaptic('medium'); menu.open(post) })
  const onTagPress = useEvent((next: string) => router.push(chRoute.tag(id, next)))
  const onMentionPress = useEvent((handle: string) => router.push(chRoute.user(handle)))

  const canClosePoll = rights.can('canEditMessages')
  const myAdminRow = rights.myAdminRow

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <TagPostRow
      post={item}
      channel={channel}
      myAdminRow={myAdminRow}
      canClosePoll={canClosePoll}
      onOpen={openPost}
      onOpenMedia={openMedia}
      onReact={onReactPost}
      onUnreact={onUnreactPost}
      onVote={onVotePost}
      onMenu={onMenuPost}
      onTagPress={onTagPress}
      onMentionPress={onMentionPress}
    />
  ), [
    channel, myAdminRow, canClosePoll, openPost, onReactPost, onUnreactPost,
    onVotePost, onMenuPost, onTagPress, onMentionPress,
  ])

  if (notMember) {
    return (
      <Screen>
        <Header back title={`#${clean}`} subtitle={channel?.title} />
        <RefusalCard error={posts.error} title="Subscribe to read this channel" icon="lock" />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        title={`#${clean}`}
        subtitle={channel?.title}
        actions={channel?.shareUrl ? [{
          icon: 'share',
          label: 'Share this tag',
          onPress: () => void Share.share({ message: `${channel.shareUrl}?tag=${encodeURIComponent(clean)}` }).catch(() => {}),
        }] : []}
      />

      <View style={[styles.context, { borderBottomColor: c.separator }]}>
        <Text variant="title2" tone="accent" align="center" style={styles.hash}>#</Text>
        <Text variant="subhead" tone="muted" align="ui" style={styles.flex} numberOfLines={2}>
          {posts.data ? `${posts.data.length} ${posts.data.length === 1 ? 'post' : 'posts'} in ${channel?.title || 'this channel'}` : ' '}
        </Text>
        <Button
          label="Search all of Hikmah Web"
          variant="ghost"
          size="sm"
          onPress={() => router.push(chRoute.search(id))}
        />
      </View>

      {posts.loading ? (
        <View><SkeletonCard /><SkeletonCard /><SkeletonCard /></View>
      ) : posts.error ? (
        <ErrorState error={posts.error} onRetry={posts.reload} />
      ) : (
        <FlashList
          data={posts.data || []}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          /* Channel cards carry media and run tall; 250px of default buffer
             prepares barely one cell ahead of the viewport. */
          drawDistance={600}
          ListEmptyComponent={
            <EmptyState
              icon="hash"
              title={`No posts tagged #${clean}`}
              message="Tags are re-extracted whenever a post is edited, so this can change."
            />
          }
          ListFooterComponent={
            posts.data?.length ? (
              <Text variant="footnote" tone="muted" align="center" style={{ padding: space.xl }}>
                Exact matches only — #{clean} and similar tags are separate.
              </Text>
            ) : null
          }
          onViewableItemsChanged={views.onViewableItemsChanged}
          viewabilityConfig={views.viewabilityConfig}
          refreshing={posts.refreshing}
          onRefresh={() => void posts.refresh()}
          contentContainerStyle={{ paddingTop: space.sm, paddingBottom: space.huge }}
        />
      )}

      <PostMenuSheet
        visible={menu.visible}
        onClose={menu.close}
        target={{ post: menu.payload, channel, myAdminRow: rights.myAdminRow, meId: user?.id }}
        onComment={() => router.push(chRoute.post(id, String(menu.payload.id)))}
        onShareLink={() => channel?.shareUrl && void Share.share({ message: channel.shareUrl }).catch(() => {})}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One tagged post. The card's callbacks are all `() => void`, so
   the per-post closures are built here, inside the memo, rather
   than once per post on every render of the screen.
   --------------------------------------------------------- */

const TagPostRow = React.memo(function TagPostRow({
  post, channel, myAdminRow, canClosePoll,
  onOpen, onOpenMedia, onReact, onUnreact, onVote, onMenu, onTagPress, onMentionPress,
}: {
  post: any
  channel: any
  myAdminRow: any
  canClosePoll: boolean
  onOpen: (post: any) => void
  onOpenMedia: (post: any, index: number) => void
  onReact: (post: any, emoji: string) => void
  onUnreact: (post: any) => void
  onVote: (post: any, indexes: number[]) => void | Promise<void>
  onMenu: (post: any) => void
  onTagPress: (tag: string) => void
  onMentionPress: (handle: string) => void
}) {
  const open = React.useCallback(() => onOpen(post), [onOpen, post])
  const openMedia = React.useCallback((i: number) => onOpenMedia(post, i), [onOpenMedia, post])
  const react = React.useCallback((emoji: string) => onReact(post, emoji), [onReact, post])
  const unreact = React.useCallback(() => onUnreact(post), [onUnreact, post])
  const vote = React.useCallback((indexes: number[]) => onVote(post, indexes), [onVote, post])
  const menu = React.useCallback(() => onMenu(post), [onMenu, post])

  return (
    <View style={styles.postWrap}>
      <ChannelPostCard
        post={post}
        channel={channel}
        myAdminRow={myAdminRow}
        canClosePoll={canClosePoll}
        onPress={open}
        onPressComments={open}
        onOpenMedia={openMedia}
        onReact={react}
        onUnreact={unreact}
        onVote={vote}
        onMenu={menu}
        onTagPress={onTagPress}
        onMentionPress={onMentionPress}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  postWrap: { marginBottom: space.sm },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hash: { width: 20 },
  flex: { flex: 1 },
})
