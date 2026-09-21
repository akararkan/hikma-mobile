/* =========================================================
   One saved collection.

   There is no per-collection read on the wire, so the filter is
   CLIENT-SIDE over the same `savedPosts` cursor. That has one
   consequence worth stating plainly: a full page can contribute
   zero rows to this screen, so paging keeps going while the
   filtered list is below a screenful and the previous page came
   back full. Stopping on "this page added nothing" would end
   the list early and look like the collection is smaller than
   it is.

   There is also no collection-delete endpoint. "Remove all"
   is sequential unsaves, which is exactly what deleting a
   collection means here — the name disappears with its last
   post.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { usePostTombstones } from '@/components/feed/postTombstones'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, ConfirmSheet, EmptyState, ErrorState, Header, ListFooter, Screen, Text, toast,
} from '@/ui'
import { PostTile } from '@/components/feed/PostTile'
import { isReelPost, openReelIn } from '@/components/reels/openReel'
import { GridSkeleton } from '@/components/feed/FeedSkeleton'
import type { PostView } from '@/components/feed/types'

const PAGE = 100
/* Per-FETCH walk bound; loadMore resumes from the returned cursor, so the
   collection itself is unbounded. */
const MAX_PAGES = 6
const SCREENFUL = 24

const savedArgs = (a: { cursor?: string | null; pageSize: number; signal?: AbortSignal }) => a as any

/* Module scope: FlashList compares keyExtractor by identity, so an inline
   arrow re-renders every mounted tile on every screen render. */
const keyExtractor = (p: PostView) => String(p.id)

export default function CollectionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  const { width } = useWindowDimensions()
  const { collection } = useLocalSearchParams<{ collection: string }>()
  const name = decodeURIComponent(String(collection || ''))

  const [selecting, setSelecting] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [menuPost, setMenuPost] = React.useState<PostView | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [progress, setProgress] = React.useState('')

  /* Walk the source cursor until the filter has a screenful — a full page can
     legitimately contribute zero rows (see the header comment). The walk is
     bounded per FETCH and loadMore resumes from the returned cursor: the old
     version stopped at 24 rows forever, so a 200-post collection silently
     ended there. */
  const list = usePaged<PostView>(async ({ cursor, signal }) => {
    const out: PostView[] = []
    let c: string | null | undefined = cursor || undefined
    for (let hop = 0; hop < MAX_PAGES; hop++) {
      const rows: PostView[] = await api.posts.savedPosts(user!.id, savedArgs({ cursor: c, pageSize: PAGE, signal }))
      if (!rows.length) return { items: out, nextCursor: null }
      out.push(...rows.filter(p => (p.savedCollectionName ?? '') === name))
      c = rows[rows.length - 1]?.savedAt
      if (!c || rows.length < PAGE) return { items: out, nextCursor: null }
      if (out.length >= SCREENFUL) break
    }
    return { items: out, nextCursor: c ?? null }
  }, { mode: 'cursor', enabled: gate === 'allow' && !!user?.id, deps: [user?.id, name] })

  usePostTombstones(list.remove)
  const items = list.items

  /* A deep collection can filter to zero across one walk, and with no rows
     there is no scroll to drive onEndReached — keep the cursor moving until
     the first match or the true end. */
  React.useEffect(() => {
    if (!list.loading && !list.loadingMore && !list.done && !list.error && items.length === 0) list.loadMore()
  }, [list.loading, list.loadingMore, list.done, list.error, items.length, list.loadMore])

  React.useEffect(() => {
    /* The collection ceases to exist with its last post — do not leave the
       user staring at an empty folder that can never refill. */
    if (!list.loading && list.done && items.length === 0 && !clearing) {
      const id = setTimeout(() => router.back(), 900)
      return () => clearTimeout(id)
    }
  }, [list.loading, list.done, items.length, clearing, router])

  const removeOne = async (post: PostView) => {
    list.remove(String(post.id))
    try {
      await api.posts.unsave(post.id)
      toast.info('Removed from Saved', {
        label: 'Undo',
        onPress: () => {
          void api.posts.toggleSave(post.id, name)
            .then(() => list.refresh())
            .catch(e => toast.error(errorText(e)))
        },
      })
    } catch (e) {
      toast.error(errorText(e))
      void list.refresh()
    }
  }

  const removeMany = async (ids: string[]) => {
    setClearing(true)
    let done = 0
    let failed = 0
    for (const id of ids) {
      setProgress(`Removing ${++done} of ${ids.length}…`)
      try { await api.posts.unsave(id) } catch { failed++ }
    }
    setClearing(false)
    setProgress('')
    setSelecting(false)
    setSelected(new Set())
    toast.ok(failed ? `Removed ${ids.length - failed} of ${ids.length}` : `Removed ${ids.length} posts`)
    await list.reload()
  }

  const tile = Math.floor(width / 3)

  /* A reel opens the viewer on itself, among this collection's other reels;
     anything else is the post detail. Identity-stable so renderItem's is. */
  const openItem = useEvent((item: PostView) => {
    if (isReelPost(item)) openReelIn(router, items, item, { src: 'for-you' })
    else router.push(`/post/${item.id}`)
  })

  /* PostTile's press handlers are zero-argument by contract, so the per-row
     closures stay — but renderItem's identity now only moves with the
     selection state, which is what stops FlashList re-invoking it for every
     mounted tile on every render. */
  const renderItem = React.useCallback(({ item }: { item: PostView }) => (
    <PostTile
      post={item}
      size={tile}
      selectable={selecting}
      selected={selected.has(String(item.id))}
      onPress={() => {
        if (!selecting) { openItem(item); return }
        setSelected(prev => {
          const next = new Set(prev)
          next.has(String(item.id)) ? next.delete(String(item.id)) : next.add(String(item.id))
          return next
        })
      }}
      onLongPress={() => {
        if (selecting) return
        setSelecting(true)
        setSelected(new Set([String(item.id)]))
      }}
    />
  ), [tile, selecting, selected, openItem])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 40 }),
    [insets.bottom],
  )

  /* By reference, so the footer's ViewHolder survives screen renders. */
  const footer = React.useMemo(() => (
    <ListFooter
      loading={list.loadingMore}
      error={items.length ? list.error : null}
      onRetry={list.loadMore}
      done={list.done && items.length > 0}
    />
  ), [list.loadingMore, list.error, list.done, list.loadMore, items.length])

  if (gate === 'deny') {
    return (
      <Screen>
        <Header back title={name} />
        <EmptyState icon="lock" title="Sign in to see this collection" actionLabel="Sign in" onAction={() => router.replace('/sign-in')} />
      </Screen>
    )
  }

  const selectedIds = [...selected]

  return (
    <Screen>
      <Header
        back={selecting ? () => { setSelecting(false); setSelected(new Set()) } : true}
        title={selecting ? `${selected.size} selected` : name}
        subtitle={selecting ? undefined : `${items.length}${list.done ? '' : '+'} post${items.length === 1 ? '' : 's'}`}
        actions={selecting
          ? [{
            icon: 'trash',
            label: 'Remove selected',
            tone: 'danger',
            onPress: () => { if (selectedIds.length) void removeMany(selectedIds) },
          }]
          : [{ icon: 'more', label: 'More', onPress: () => setConfirmClear(true) }]}
      />

      {progress ? (
        <Text variant="footnote" tone="muted" align="center" style={styles.progress}>{progress}</Text>
      ) : null}

      {list.loading || (!items.length && !list.done && !list.error) ? (
        <GridSkeleton />
      ) : list.error && !items.length ? (
        <ErrorState error={list.error} onRetry={() => { void list.reload() }} />
      ) : !items.length ? (
        <View style={styles.empty}>
          <EmptyState
            icon="bookmark"
            title="This collection is empty"
            message="A collection disappears once its last post is unsaved."
          />
          <Button label="Back to Saved" onPress={() => router.back()} variant="tinted" />
        </View>
      ) : (
        <FlashList
          data={items}
          numColumns={3}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentStyle}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={() => { void list.refresh() }}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          renderItem={renderItem}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={footer}
        />
      )}

      <ActionSheet
        visible={!!menuPost}
        onClose={() => setMenuPost(null)}
        actions={[
          { label: 'Move to collection', icon: 'gallery', onPress: () => menuPost && router.push(`/post/${menuPost.id}/save`) },
          { label: 'Share', icon: 'share', onPress: () => menuPost && router.push(`/post/${menuPost.id}/share`) },
          { label: 'Remove from saved', icon: 'bookmark', destructive: true, onPress: () => { if (menuPost) void removeOne(menuPost) } },
        ]}
      />

      <ConfirmSheet
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={`Remove all from “${name}”?`}
        message="Each post is unsaved one at a time. The collection disappears with its last post."
        confirmLabel="Remove all"
        destructive
        loading={clearing}
        onConfirm={() => { setConfirmClear(false); void removeMany(items.map(p => String(p.id))) }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  progress: { paddingVertical: space.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
})
