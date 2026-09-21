/* =========================================================
   Saved.

   Two things about this list are unlike every other feed:

   · it pages on `savedAt`, NOT `createdAt`. Saving an old post
     puts it at the top, so a createdAt cursor would skip rows
     silently.
   · "collections" are derived. There is no collections API —
     the names come from grouping `savedCollectionName` over
     these very rows, which is also why a collection stops
     existing when its last post is unsaved.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { adapters, api, errorText } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { usePostTombstones } from '@/components/feed/postTombstones'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ChipRail, EmptyState, ErrorState, Header, ListFooter, Screen, toast,
} from '@/ui'
import { PostCard } from '@/components/feed/PostCard'
import { FEED_GAP } from '@/components/feed/plate'
import { PostTile } from '@/components/feed/PostTile'
import { isReelPost, openReelIn } from '@/components/reels/openReel'
import { FeedSkeleton, GridSkeleton } from '@/components/feed/FeedSkeleton'
import { useEngagement } from '@/components/post/useEngagement'
import { useViewMode } from '@/lib/useViewMode'
import type { PostView } from '@/components/feed/types'

const PAGE_SIZE = 24

/* `savedPosts` is JS and TypeScript reads its option shape off the `= {}`
   default, which only surfaces the keys that carry one. */
const savedArgs = (a: { cursor?: string | null; pageSize: number; signal?: AbortSignal }) => a as any

/* Module scope: FlashList compares keyExtractor by identity, so an inline
   arrow re-renders every mounted card on every screen render. */
const keyExtractor = (p: PostView) => String(p.id)

export default function SavedScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  const { width } = useWindowDimensions()
  const listRef = React.useRef<FlashListRef<PostView>>(null)

  const [view, setView] = useViewMode('saved', 'grid') as ['grid' | 'feed', (v: string) => void]
  const [menuPost, setMenuPost] = React.useState<PostView | null>(null)

  const enabled = gate === 'allow' && !!user?.id

  const saved = usePaged<PostView>(
    ({ cursor, pageSize, signal }) => api.posts.savedPosts(user!.id, savedArgs({ cursor, pageSize, signal }))
      .then((rows: PostView[]) => ({
        items: rows,
        /* The wire cursor is the last row's `savedAt` (engagement.md §4.4) —
           usePaged's bare-array fallback derives `createdAt`, which on this
           endpoint is the POST's creation time and silently skips every row
           saved between the two instants. */
        nextCursor: rows.length ? rows[rows.length - 1]?.savedAt ?? null : null,
      })),
    { mode: 'cursor', pageSize: PAGE_SIZE, enabled, deps: [user?.id, enabled] },
  )

  /* Saving does not outlive the post: a post deleted from anywhere else in
     the app leaves this list too, rather than sitting here until a refresh
     and 404ing when tapped. */
  usePostTombstones(saved.remove)

  const { items, loading, refreshing, loadingMore, done, error } = saved

  const patch = React.useCallback((id: string, fn: (p: any) => any) => {
    saved.patch(id, prev => fn(prev) as PostView)
  }, [saved])
  const { toggleLike } = useEngagement<any>(patch)

  const collections = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of items) {
      const key = p.savedCollectionName ?? ''
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
  }, [items])

  const unsave = async (post: PostView) => {
    const previous = post.savedCollectionName ?? null
    saved.remove(String(post.id))
    try {
      await api.posts.unsave(post.id)
      toast.info('Removed from Saved', {
        label: 'Undo',
        onPress: () => {
          void api.posts.toggleSave(post.id, previous || undefined)
            .then(() => saved.refresh())
            .catch(e => toast.error(errorText(e)))
        },
      })
    } catch (e) {
      toast.error(errorText(e))
      void saved.refresh()
    }
  }

  /* ---------- row plumbing ----------
     Every handler a card gets is item-first and identity-stable (useEvent),
     so PostCard's own memo can skip the rows a render did not touch and
     renderItem's identity only moves when the layout mode or tile size does. */

  const onLike = useEvent((p: PostView) => { void toggleLike(p) })
  const onSave = useEvent((p: PostView) => { void unsave(p) })
  const onSaveLongPress = useEvent((p: PostView) => router.push(`/post/${p.id}/save`))
  const onShare = useEvent((p: PostView) => router.push(`/post/${p.id}/share`))
  const onComment = useEvent((p: PostView) => router.push({ pathname: '/post/[id]', params: { id: p.id, focus: 'comment' } }))
  /* A saved reel opens the viewer on itself, among the other saved reels —
     never the post detail, which would only bounce it there. */
  const onOpenPost = useEvent((p: PostView) => {
    if (isReelPost(p)) openReelIn(router, items, p, { src: 'for-you' })
    else router.push(`/post/${p.id}`)
  })
  const onMenu = useEvent((p: PostView) => setMenuPost(p))
  const onPressAuthor = useEvent((uid: string) => router.push(`/u/${uid}`))
  const onPressTag = useEvent((tag: string) => router.push(`/tags/${tag}`))
  const onPressMention = useEvent((h: string) => router.push(`/u/${h}`))

  const grid = view === 'grid'
  /* Two columns, 4:5 cells — big enough that a save is recognisable at a
     glance (the 3-column squares read as postage stamps). */
  const tile = Math.floor(width / 2)
  const tileH = Math.round(tile * 1.25)

  const renderItem = React.useCallback(({ item }: { item: PostView }) => (grid ? (
    <PostTile
      post={item}
      size={tile}
      height={tileH}
      onPress={() => onOpenPost(item)}
      onLongPress={() => onMenu(item)}
    />
  ) : (
    <View style={styles.band}>
      <PostCard
        post={item}
        showSourceLabel={false}
        footnote={item.savedAt ? `Saved ${adapters.timeAgo(item.savedAt)}${item.savedCollectionName ? ` · ${item.savedCollectionName}` : ''}` : null}
        onLike={onLike}
        onSave={onSave}
        onSaveLongPress={onSaveLongPress}
        onShare={onShare}
        onComment={onComment}
        onMenu={onMenu}
        onPress={onOpenPost}
        onPressAuthor={onPressAuthor}
        onPressTag={onPressTag}
        onPressMention={onPressMention}
      />
    </View>
  )), [
    grid, tile, tileH, onLike, onSave, onSaveLongPress, onShare, onComment,
    onMenu, onOpenPost, onPressAuthor, onPressTag, onPressMention,
  ])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 40 }),
    [insets.bottom],
  )

  const listFooter = React.useMemo(() => (
    <ListFooter
      loading={loadingMore}
      error={items.length ? error : null}
      onRetry={saved.loadMore}
      done={done}
      doneLabel="That's everything you saved"
    />
  ), [loadingMore, error, items.length, saved.loadMore, done])

  if (gate === 'deny') {
    return (
      <Screen>
        <Header back title="Saved" />
        <EmptyState
          icon="bookmark"
          title="Sign in to see your saves"
          message="Saved posts live on your account."
          actionLabel="Sign in"
          onAction={() => router.replace('/sign-in')}
        />
      </Screen>
    )
  }

  return (
    <Screen background={grid ? 'plain' : 'sunken'}>
      <Header
        back
        title="Saved"
        actions={[
          { icon: 'grid', label: 'Grid', onPress: () => setView('grid'), filled: grid, tone: grid ? 'accent' : 'default' },
          { icon: 'list', label: 'List', onPress: () => setView('feed'), filled: !grid, tone: !grid ? 'accent' : 'default' },
        ]}
        below={
          collections.length ? (
            <ChipRail style={styles.chips}>
              <Chip label="All" selected size="sm" />
              {collections.map(([name, count]) => (
                <Chip
                  key={name}
                  label={`${name}  ${count}`}
                  onPress={() => router.push(`/saved/${encodeURIComponent(name)}`)}
                  size="sm"
                />
              ))}
            </ChipRail>
          ) : undefined
        }
      />

      {loading ? (
        grid ? <GridSkeleton columns={2} count={6} /> : <FeedSkeleton count={3} rail={false} />
      ) : error && !items.length ? (
        <ErrorState error={error} onRetry={() => { void saved.reload() }} />
      ) : !items.length ? (
        <EmptyState
          icon="bookmark"
          title="Nothing saved yet"
          message="Tap the bookmark on any post to keep it here."
        />
      ) : (
        /* Remounting on the mode flip is what lets the cross-fade read as one
           layout replacing another rather than a list reflowing in place. */
        <Animated.View
          key={grid ? 'grid' : 'feed'}
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(160)}
          style={styles.flex}
        >
          <FlashList
            ref={listRef}
            data={items}
            key={grid ? 'grid' : 'feed'}
            numColumns={grid ? 2 : 1}
            keyExtractor={keyExtractor}
            onEndReached={saved.loadMore}
            onEndReachedThreshold={0.6}
            /* Feed mode's cells are full post cards — the platform default of
               250px is under one cell of buffer, so a fast fling outruns the
               render stack. The grid's tiles are dense and stay at the
               default, where the prefetch is cheap. */
            drawDistance={grid ? undefined : 600}
            contentContainerStyle={contentStyle}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { void saved.refresh() }}
                tintColor={c.textMuted}
                colors={[c.accent]}
              />
            }
            renderItem={renderItem}
            ListFooterComponent={listFooter}
          />
        </Animated.View>
      )}

      <ActionSheet
        visible={!!menuPost}
        onClose={() => setMenuPost(null)}
        actions={[
          { label: 'Move to collection', icon: 'gallery', onPress: () => menuPost && router.push(`/post/${menuPost.id}/save`) },
          { label: 'Share', icon: 'share', onPress: () => menuPost && router.push(`/post/${menuPost.id}/share`) },
          {
            label: 'Remove from saved',
            icon: 'bookmark',
            destructive: true,
            onPress: () => { if (menuPost) void unsave(menuPost) },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /* Same column geometry as home — full-bleed plates, the band owns the seam. */
  band: { marginBottom: FEED_GAP },
  chips: { paddingVertical: space.sm2 },
})
