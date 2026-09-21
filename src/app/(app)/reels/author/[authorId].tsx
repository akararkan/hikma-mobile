/* =========================================================
   An author's reels, as a grid.

   Reads the dedicated by-author REEL endpoint rather than
   filtering the mixed profile feed: a 20-row mixed page can
   legitimately contain zero reels, so client-side filtering
   produces an empty grid for someone who has posted forty.

   The stats row degrades to null rather than 0 (USER_API
   §6.9), which is why the subtitle reads `stats?.reels ??
   items.length` and never prints a hard zero.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { api, errorText, isNetworkError, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { OfflinePill, ReelErrorPlate, ReelPlate } from '@/components/reels/FeedStates'
import { openReelIn } from '@/components/reels/openReel'
import { ReelGridSkeleton, ReelGridTile } from '@/components/reels/ReelGridTile'
import { STAGE } from '@/components/reels/skin'
import type { ViewPost } from '@/components/reels/types'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Icon, Spinner, Text, Touchable, toast, useSheetState,
} from '@/ui'

const GUTTER = 2
const COLUMNS = 3

/* Module scope, so FlashList sees ONE identity for the life of the screen:
   ViewHolder memoises each cell on the identity of keyExtractor's siblings —
   a fresh arrow re-renders every mounted tile on every render of this screen. */
const keyExtractor = (item: ViewPost) => String(item.id)

export default function AuthorReelsScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { user } = useAuth()
  const params = useLocalSearchParams<{ authorId: string; handle?: string }>()
  const authorId = params.authorId

  const preview = useSheetState<ViewPost>()

  const feed = usePaged<ViewPost>(
    ({ cursor, pageSize, signal }) => api.reels.byAuthor(authorId, { cursor: cursor ?? undefined, pageSize, signal } as any),
    { mode: 'cursor', pageSize: 24, enabled: !!authorId, deps: [authorId] },
  )

  const stats = useAsync<any>(() => api.users.stats(authorId), { enabled: !!authorId, deps: [authorId] })
  /* Only ask for the profile when the caller could not hand us the handle. */
  const author = useAsync<any>(() => api.users.get(authorId), {
    enabled: !!authorId && !params.handle,
    deps: [authorId],
  })

  const handle = params.handle || author.data?.handle || ''
  const isMine = !!user?.id && user.id === authorId
  const tileWidth = Math.floor((width - GUTTER * (COLUMNS - 1)) / COLUMNS)
  const reelCount = stats.data?.reels ?? (feed.items.length || null)

  /* Identity-stable and post-taking, so one function serves every tile and
     ReelGridTile's React.memo can skip the cells a render did not touch. */
  const openTile = useEvent((post: ViewPost) => {
    /* The grid's own rows go with the tap: the pager opens on this tile and
       continues with the author's reels after it. */
    openReelIn(router, feed.items, post, { src: 'author', authorId, handle })
  })
  const previewTile = useEvent((post: ViewPost) => preview.open(post))

  const copyLink = async (post: ViewPost) => {
    try {
      const link: any = await api.posts.shareLink(post.id)
      await Clipboard.setStringAsync(link?.shortUrl || link?.canonicalUrl || '')
      toast.ok('Link copied')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* Recreated only when the tile width moves (a rotation) — never on a page
     append, a stats read or the author profile landing. */
  const renderItem = React.useCallback(({ item }: { item: ViewPost }) => (
    <View style={styles.cell}>
      <ReelGridTile post={item} width={tileWidth - GUTTER} onPress={openTile} onLongPress={previewTile} />
    </View>
  ), [tileWidth, openTile, previewTile])

  const body = () => {
    if (feed.loading) {
      return (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 12 }, (_, i) => <ReelGridSkeleton key={i} width={tileWidth} />)}
        </View>
      )
    }
    if (feed.error && !feed.items.length) {
      if (isNotFound(feed.error) || isNotFound(author.error)) {
        return <ReelPlate icon="person" title="This account is no longer available." />
      }
      return <ReelErrorPlate error={feed.error} onRetry={feed.reload} />
    }
    if (!feed.items.length) {
      return (
        <ReelPlate
          icon="reels"
          title={handle ? `@${handle} hasn’t posted any reels yet.` : 'No reels yet.'}
          body={isMine ? 'Your reels will show up here.' : undefined}
          actionLabel={isMine ? 'Create a reel' : undefined}
          onAction={isMine ? () => router.push('/reels/compose') : undefined}
        />
      )
    }

    return (
      <FlashList
        data={feed.items}
        numColumns={COLUMNS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        /* 9:16 cells are ~200pt tall, so the platform default of 250px is
           barely one row of buffer and a fast fling outruns the render stack. */
        drawDistance={600}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={feed.refresh}
            tintColor={STAGE.fgMuted}
            colors={[t.colors.cta]}
            progressBackgroundColor={STAGE.plate}
          />
        }
        ListFooterComponent={
          feed.loadingMore
            ? <Spinner label="Loading more…" />
            : feed.done
              ? <Text variant="caption" color={STAGE.fgFaint} align="center" style={styles.endNote}>That&rsquo;s everything</Text>
              : <View style={{ height: 12 }} />
        }
      />
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Touchable onPress={() => router.back()} feedback="scale" accessibilityLabel="Go back" style={styles.navBtn}>
          <Icon name={t.isRTL ? 'forward' : 'back'} size={24} color={STAGE.fg} />
        </Touchable>
        <View style={styles.headerTitle}>
          <Text variant="headline" color={STAGE.fg} align="center" numberOfLines={1}>
            {handle ? `@${handle}` : 'Reels'}
          </Text>
          {reelCount != null ? (
            <Text variant="caption" color={STAGE.fgMuted} align="center">
              {reelCount} {reelCount === 1 ? 'reel' : 'reels'}
            </Text>
          ) : null}
        </View>
        <View style={styles.navBtn} />
      </View>

      {feed.error && isNetworkError(feed.error) && feed.items.length ? <OfflinePill top={insets.top + 60} /> : null}

      {body()}

      <ActionSheet
        visible={preview.visible}
        onClose={preview.close}
        title={preview.payload?.body ? preview.payload.body.slice(0, 80) : 'Reel'}
        actions={[
          { label: 'Open', icon: 'play', onPress: () => preview.payload && openTile(preview.payload) },
          { label: 'Copy link', icon: 'link', onPress: () => { if (preview.payload) void copyLink(preview.payload) } },
          /* Reporting needs the reel open — the report sheet is attached to the
             player, not to a tile, and a report filed from a thumbnail the user
             never watched is not a report worth filing. */
          {
            label: 'Open and report',
            icon: 'flag',
            hidden: isMine,
            onPress: () => preview.payload && openTile(preview.payload),
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.plate },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2 },
  navBtn: { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, justifyContent: 'center', height: 56 },
  cell: { paddingEnd: GUTTER, paddingBottom: GUTTER },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER, opacity: 0.6 },
  endNote: { paddingVertical: space.xxl },
})
