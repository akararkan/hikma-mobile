/* =========================================================
   Watched reels — the private reel watch history.

   Two server behaviours the UI has to be honest about:

   · `page` is ignored. "Show more" means re-requesting with a
     LARGER size (20 → 60 → 120 → 240) and REPLACING the list;
     page+1 would hand back the identical newest window and
     duplicate every cell.
   · DELETE answers 204 whether or not it deleted anything — the
     server only scans your newest 500 entries. So a removal is
     verified by a refetch, and an entry that survives says so
     instead of silently coming back on the next launch.
   · THE LEDGER CARRIES NO POSTER. ReelViewMapper builds each
     row's reel summary with the id and nothing else — no
     thumbnailUrl, no mediaUrl — so every cell drew the
     "no video" glyph and the history was a wall of grey. The
     posters are therefore hydrated by id, exactly the way the
     Liked grid hydrates its tiles: only for rows near the
     viewport, capped so a fast flick cannot open sixty
     connections, and kept for the life of the screen. One extra
     read per cell you actually look at, and none for the rest.
   ========================================================= */
import { api, errorText, isNetworkError, isTransient } from '@/api'
import { ReelGridSkeleton } from '@/components/notifications/ListParts'
import { reelHref } from '@/components/reels/openReel'
import { ReelWatchCell } from '@/components/notifications/ReelWatchCell'
import { clockTime } from '@/components/notifications/constants'
import type { ReelWatch } from '@/components/notifications/types'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
    ActionSheet, Button, ConfirmSheet, EmptyState, ErrorState, Header, Icon,
    Screen, Spinner, Text, toast, useSheetState,
} from '@/ui'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import React from 'react'
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface WatchedPage { items: ReelWatch[]; total: number | null; hasMore: boolean }

const SIZES = [20, 60, 120, 240]
const GUTTER = 2
const COLUMNS = 3
/* Two screens of a 3-column grid — the hydration horizon. */
const LOOKAHEAD = 24
/* The same ceiling the Liked grid uses: a flick must not open sixty sockets. */
const MAX_INFLIGHT = 6
/* Module scope: FlashList compares keyExtractor by identity, and an inline
   lambda is a new identity on every render. */
const keyExtractor = (item: ReelWatch) => String(item.id)
/** The delete endpoint only scans the caller's newest 500 entries. */
const DELETE_SCAN_LIMIT = 500

export default function WatchedReelsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [size, setSize] = React.useState(SIZES[0])
  const [clearing, setClearing] = React.useState(false)

  const detail = useSheetState<{ item: ReelWatch; index: number }>()
  const overflow = useSheetState()
  const confirm = useSheetState()
  const notice = useSheetState()

  const { data, error, loading, refreshing, refresh, reload, setData } =
    useAsync<WatchedPage>(() => api.reels.watched({ size }), { deps: [size] })

  /* ---- posters, hydrated by id (see the header) ---- */
  const [posters, setPosters] = React.useState<Record<string, string | null>>({})
  const [horizon, setHorizon] = React.useState(LOOKAHEAD)
  const inflight = React.useRef(new Set<string>())
  /* Per-MOUNT, not per-effect-run: this effect re-runs on every poster that
     lands, and a per-run flag would discard results the previous run started. */
  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])

  React.useEffect(() => {
    const wanted = (data?.items || [])
      .slice(0, horizon)
      .map(r => String(r.reelId || ''))
      .filter(id => id && !(id in posters) && !inflight.current.has(id))
      .slice(0, MAX_INFLIGHT)

    for (const id of wanted) {
      inflight.current.add(id)
      api.posts.get(id)
        .then((p: any) => {
          /* The clip's own poster, never its url — an mp4 handed to an Image
             is a grey placeholder on iOS and nothing at all on Android. */
          const clip = (p?.media || []).find((m: any) => m.type === 'VIDEO') || p?.media?.[0]
          if (alive.current) setPosters(prev => ({ ...prev, [id]: clip?.poster || null }))
        })
        /* A watch entry outlives a deleted reel by design — a miss is a cell
           without a poster, not an error. */
        .catch(() => { if (alive.current) setPosters(prev => ({ ...prev, [id]: null })) })
        .finally(() => { inflight.current.delete(id) })
    }
  }, [data?.items, horizon, posters])

  const growHorizon = React.useCallback(
    () => setHorizon(h => Math.min((data?.items || []).length, h + LOOKAHEAD)),
    [data?.items],
  )

  const items = data?.items ?? []
  const cellWidth = (width - GUTTER * (COLUMNS + 1)) / COLUMNS
  const offline = isNetworkError(error) && items.length > 0
  const atCap = size >= SIZES[SIZES.length - 1]

  const autoRetried = React.useRef(false)
  React.useEffect(() => {
    if (!error) { autoRetried.current = false; return }
    if (!isTransient(error) || autoRetried.current || items.length) return
    autoRetried.current = true
    const id = setTimeout(() => { void reload() }, 3000)
    return () => clearTimeout(id)
  }, [error, items.length, reload])

  /* Item-first and identity-stable, so renderItem below holds ONE identity —
     an inline arrow per row re-invoked every mounted cell on every render and
     defeated ReelWatchCell's memo. */
  const openReel = useEvent((item: ReelWatch) => {
    /* reelId is the POST id. item.id is the watch entry and lands on a 404.
       `watched` continues down the history from this entry. */
    router.push(reelHref(String(item.reelId), { src: 'watched' }) as any)
  })
  const openDetail = useEvent((item: ReelWatch) => {
    const index = items.indexOf(item)
    detail.open({ item, index: index < 0 ? 0 : index })
  })

  const renderItem = React.useCallback(({ item }: { item: ReelWatch }) => (
    <View style={styles.cellWrap}>
      <ReelWatchCell
        item={item}
        width={cellWidth}
        poster={posters[String(item.reelId || '')] ?? null}
        onPress={openReel}
        onLongPress={openDetail}
      />
    </View>
  ), [cellWidth, posters, openReel, openDetail])

  const removeEntry = async (item: ReelWatch, index: number) => {
    setData(prev => (prev ? { ...prev, items: prev.items.filter(r => r.id !== item.id) } : prev))
    try {
      await api.reels.deleteWatched(item.id)
    } catch (e: any) {
      setData(prev => {
        if (!prev) return prev
        const at = Math.min(index, prev.items.length)
        return { ...prev, items: [...prev.items.slice(0, at), item, ...prev.items.slice(at)] }
      })
      toast.error(errorText(e))
      return
    }

    /* 204 is not proof of deletion for a deep entry, so reconcile. */
    setTimeout(async () => {
      try {
        const fresh = await api.reels.watched({ size }) as WatchedPage
        setData(fresh)
        if (fresh.items.some(r => r.id === item.id)) notice.open()
      } catch { /* the next refresh reconciles instead */ }
    }, 400)
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      const res: any = await api.reels.clearWatched()
      const deleted = Number(res?.deleted ?? 0)
      setSize(SIZES[0])
      setData({ items: [], total: 0, hasMore: false })
      toast.ok(`${deleted} ${deleted === 1 ? 'entry' : 'entries'} cleared`)
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setClearing(false)
    }
  }

  const payload = detail.payload
  const deepEntry = (payload?.index ?? 0) >= DELETE_SCAN_LIMIT

  return (
    <Screen>
      <Header
        back
        title="Watched reels"
        actions={[{ icon: 'more', onPress: () => overflow.open(), label: 'More' }]}
      />

      {offline ? (
        <View style={[styles.offline, { backgroundColor: c.warningSoft }]}>
          <Icon name="offline" size={14} color={c.warningText} />
          <Text variant="footnote" tone="warning" align="ui">
            You&apos;re offline — showing your last loaded history.
          </Text>
        </View>
      ) : null}

      {/* "Show more" re-requests the whole window at a larger size, so the
          grid stays on screen while it lands — swapping it for the skeleton
          would throw the user's place away on every step. */}
      {loading && !items.length ? (
        <ReelGridSkeleton cellWidth={cellWidth} />
      ) : error && !items.length ? (
        <ErrorState error={error} onRetry={reload} title="Couldn't load your watch history" />
      ) : !items.length ? (
        <EmptyState
          icon="reels"
          title="No watched reels"
          message="Reels you watch show up here so you can find them again."
          actionLabel="Browse reels"
          onAction={() => router.push('/(app)/(tabs)/reels' as any)}
        />
      ) : (
        <FlashList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={keyExtractor}
          extraData={cellWidth}
          style={clearing ? styles.dimmed : undefined}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: GUTTER / 2 }}
          onEndReachedThreshold={0.6}
          onEndReached={growHorizon}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          ListHeaderComponent={
            <View style={styles.subheader}>
              <Text variant="footnote" tone="faint" align="ui">
                {items.length} {items.length === 1 ? 'reel' : 'reels'} · newest first
              </Text>
            </View>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {/* Not gated on the envelope's `hasMore`: totalElements counts
                  only the returned window (activity.md §5.2), which makes
                  `last` true — and hasMore false — on every full page. A full
                  window is the only signal that more history may exist. */}
              {!atCap && items.length >= size ? (
                <Button
                  label={loading ? 'Loading…' : 'Show more'}
                  variant="ghost"
                  size="md"
                  block
                  loading={loading}
                  disabled={offline || refreshing || loading}
                  onPress={() => setSize(prev => SIZES[Math.min(SIZES.indexOf(prev) + 1, SIZES.length - 1)])}
                />
              ) : atCap ? (
                <Text variant="footnote" tone="faint" align="center">
                  Showing your {SIZES[SIZES.length - 1]} most recent watches.
                </Text>
              ) : null}
              <Text variant="footnote" tone="faint" align="center" style={styles.privacy}>
                Only you can see what you&apos;ve watched. Clearing this does not change the
                reels&apos; view counts.
              </Text>
            </View>
          }
        />
      )}

      {clearing ? (
        <View style={[StyleSheet.absoluteFill, styles.clearing]} pointerEvents="none">
          <Spinner label="Clearing…" size="large" />
        </View>
      ) : null}

      {/* ---------- one entry ---------- */}
      <ActionSheet
        visible={detail.visible}
        onClose={detail.close}
        title={payload?.item.title || 'Reel'}
        subtitle={payload
          ? `${payload.item._author.full}${payload.item._author.handle ? ` @${payload.item._author.handle}` : ''} · Watched ${clockTime(payload.item.watchedSeconds)} · ${payload.item.time}`
          : undefined}
        actions={payload ? [
          { label: 'Open reel', icon: 'reels', onPress: () => openReel(payload.item) },
          deepEntry
            ? {
              label: 'Clear all watch history',
              icon: 'trash',
              destructive: true,
              subtitle: 'Older entries can only be removed by clearing the whole history.',
              onPress: () => confirm.open(),
            }
            : {
              label: 'Remove from history',
              icon: 'trash',
              destructive: true,
              onPress: () => void removeEntry(payload.item, payload.index),
            },
        ] : []}
      />

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title="Watched reels"
        actions={[
          {
            label: 'Clear watch history',
            icon: 'trash',
            destructive: true,
            disabled: offline || clearing || !items.length,
            onPress: () => confirm.open(),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Clear watch history?"
        message="This removes your private list of watched reels. The reels themselves and their view counts are not affected."
        confirmLabel="Clear"
        destructive
        loading={clearing}
        onConfirm={() => { confirm.close(); void clearAll() }}
      />

      {/* The honest surface of the server's 500-row delete scan. */}
      <ActionSheet
        visible={notice.visible}
        onClose={notice.close}
        title="That entry is too far back to remove"
        subtitle="The server only searches your 500 most recent watches. Clear the whole history to remove it."
        actions={[
          { label: 'Clear whole history', icon: 'trash', destructive: true, onPress: () => confirm.open() },
        ]}
        cancelLabel="Not now"
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, height: 32 },
  subheader: { height: 34, justifyContent: 'center', paddingHorizontal: space.lg },
  cellWrap: { padding: GUTTER / 2 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.lg },
  privacy: { paddingVertical: space.xl },
  dimmed: { opacity: 0.5 },
  clearing: { alignItems: 'center', justifyContent: 'center' },
})
