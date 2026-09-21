/* =========================================================
   Posts you liked.

   `reactionHistory` hands back LIGHT tuples — { userId,
   createdAt, postId } — with no adapter and no post attached,
   and there is no cursor: pageSize (max 100) is the whole
   window. So the grid is built from ids and each tile hydrates
   itself as it approaches the viewport, capped so a fast flick
   cannot open sixty connections.

   A tuple whose post 404s is DROPPED silently and the grid
   reflows: the ledger outlives a hard-deleted post by design,
   and the docs say to treat isNotFound as "skip this row"
   rather than as an error.
   ========================================================= */
import React from 'react'
import { RefreshControl, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText, isNotFound } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { ActionSheet, EmptyState, ErrorState, Header, Screen, toast } from '@/ui'
import { PostTile } from '@/components/feed/PostTile'
import { isReelPost, openReelIn } from '@/components/reels/openReel'
import { GridSkeleton } from '@/components/feed/FeedSkeleton'
import { usePostTombstones } from '@/components/feed/postTombstones'
import type { PostView } from '@/components/feed/types'

const WINDOW = 100
const MAX_INFLIGHT = 6
/* Roughly 1.5 screens of a 3-column grid — the hydration horizon. */
const LOOKAHEAD = 36

interface LikeTuple { userId: string; createdAt: string; postId: string }

/* Module scope: FlashList compares keyExtractor by identity, and a fresh arrow
   re-renders every mounted tile on every screen render. */
const keyExtractor = (r: LikeTuple) => String(r.postId)

export default function LikedScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  const { width } = useWindowDimensions()

  const ledger = useAsync<LikeTuple[]>(
    () => api.posts.reactionHistory(user!.id, WINDOW),
    { enabled: gate === 'allow' && !!user?.id, deps: [user?.id] },
  )

  const [posts, setPosts] = React.useState<Record<string, PostView>>({})
  const [dead, setDead] = React.useState<Set<string>>(() => new Set())

  /* `dead` already means "this tuple's post is gone" — it is what a 404 on
     hydration writes. A post deleted elsewhere in the app is the same fact
     learned earlier, so it goes to the same place: the tile reflows out
     instead of waiting for a hydration that would 404. */
  const dropPost = React.useCallback((id: string) => {
    setDead(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  usePostTombstones(dropPost)
  const [horizon, setHorizon] = React.useState(LOOKAHEAD)
  const [menuPost, setMenuPost] = React.useState<PostView | null>(null)
  const inflight = React.useRef(new Set<string>())

  const tuples = React.useMemo(
    () => (ledger.data || []).filter(r => !dead.has(String(r.postId))),
    [ledger.data, dead],
  )

  /* Per-MOUNT, not per-effect-run: this effect re-runs on every post that
     lands, and a per-run flag would discard results the previous run started
     while `finally` had already cleared them from `inflight` — the same ids
     would then be fetched again, forever. */
  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])

  React.useEffect(() => {
    const wanted = tuples
      .slice(0, horizon)
      .map(r => String(r.postId))
      .filter(pid => pid && !posts[pid] && !dead.has(pid) && !inflight.current.has(pid))
      .slice(0, MAX_INFLIGHT)

    for (const pid of wanted) {
      inflight.current.add(pid)
      api.posts.get(pid)
        .then((p: any) => { if (alive.current) setPosts(prev => ({ ...prev, [pid]: p })) })
        .catch(e => {
          /* The ledger can outlive its post — that is not an error state. */
          if (alive.current && isNotFound(e)) setDead(prev => new Set(prev).add(pid))
        })
        .finally(() => { inflight.current.delete(pid) })
    }
  }, [tuples, horizon, posts, dead])

  const refresh = async () => {
    setPosts({})
    setDead(new Set())
    setHorizon(LOOKAHEAD)
    inflight.current.clear()
    await ledger.refresh()
  }

  const unlike = async (post: PostView) => {
    const pid = String(post.id)
    try {
      const res: any = await api.posts.toggleReaction(pid)
      if (!res?.liked) {
        setDead(prev => new Set(prev).add(pid))
        toast.ok('Unliked')
      }
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* Two columns, 4:5 cells — the 3-column squares were too small to read a
     post in; a preview you cannot see is no preview. */
  const tile = Math.floor(width / 2)
  const tileH = Math.round(tile * 1.25)

  /* A liked reel opens the viewer on itself, among the other liked reels that
     have hydrated; an unhydrated or ordinary post goes to the detail screen,
     which hands a reel on itself. */
  const openLiked = useEvent((item: LikeTuple) => {
    const post = posts[String(item.postId)]
    if (post && isReelPost(post)) {
      const hydrated = tuples.map(r => posts[String(r.postId)]).filter(Boolean)
      openReelIn(router, hydrated, post, { src: 'for-you' })
      return
    }
    router.push(`/post/${item.postId}`)
  })

  /* PostTile's press handlers are zero-argument by contract, so the per-row
     closures cannot be hoisted — but this renderItem's identity now only
     moves when the hydrated posts or the tile size do, which is what stops
     FlashList re-invoking it for every mounted cell on every render. */
  const renderItem = React.useCallback(({ item }: { item: LikeTuple }) => {
    const post = posts[String(item.postId)]
    return (
      <PostTile
        post={post ?? null}
        size={tile}
        height={tileH}
        loading={!post}
        onPress={() => openLiked(item)}
        onLongPress={() => post && setMenuPost(post)}
      />
    )
  }, [posts, tile, tileH, openLiked])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 40 }),
    [insets.bottom],
  )

  const onEndReached = React.useCallback(
    () => setHorizon(h => Math.min(tuples.length, h + LOOKAHEAD)),
    [tuples.length],
  )

  if (gate === 'deny') {
    return (
      <Screen>
        <Header back title="Posts you liked" />
        <EmptyState
          icon="heart"
          title="Sign in to see your likes"
          message="Your reaction history lives on your account."
          actionLabel="Sign in"
          onAction={() => router.replace('/sign-in')}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header back title="Posts you liked" />

      {ledger.loading ? (
        <GridSkeleton columns={2} count={6} />
      ) : ledger.error ? (
        <ErrorState error={ledger.error} onRetry={() => { void ledger.reload() }} />
      ) : !tuples.length ? (
        <EmptyState icon="heart" title="Nothing here yet" message="Posts you like show up here." />
      ) : (
        <FlashList
          data={tuples}
          numColumns={2}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentStyle}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.8}
          refreshControl={
            <RefreshControl
              refreshing={ledger.refreshing}
              onRefresh={() => { void refresh() }}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          renderItem={renderItem}
        />
      )}

      <ActionSheet
        visible={!!menuPost}
        onClose={() => setMenuPost(null)}
        actions={[
          { label: 'Unlike', icon: 'heart', onPress: () => { if (menuPost) void unlike(menuPost) } },
          {
            label: menuPost?.saved ? 'Remove from saved' : 'Save',
            icon: 'bookmark',
            onPress: () => {
              if (!menuPost) return
              void api.posts.toggleSave(menuPost.id).catch(e => toast.error(errorText(e)))
            },
          },
          { label: 'Share', icon: 'share', onPress: () => menuPost && router.push(`/post/${menuPost.id}/share`) },
        ]}
      />
    </Screen>
  )
}

