/* =========================================================
   Watched reels.

   The endpoint has a trap worth stating plainly: it IGNORES
   `page`. Every call returns the newest window of `size`, and
   `totalElements` counts only that window — so "Show more"
   GROWS the window (capped at 100) and REPLACES the list.
   Incrementing the page would silently re-render the same rows
   for ever.

   Deleting is honest about its own limit too: the server scans
   only the caller's most recent 500 entries and answers 204
   either way, so a row that comes back after a refresh gets
   the caveat rather than an error.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Redirect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Swipeable } from 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import { api, errorText, isNetworkError, isNotFound } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { OfflinePill, ReelErrorPlate, ReelPlate } from '@/components/reels/FeedStates'
import { openReelIn } from '@/components/reels/openReel'
import { PLATE_GRADIENT, STAGE } from '@/components/reels/skin'
import { clock } from '@/components/reels/types'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, ConfirmSheet, Icon, Skeleton, Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'

interface WatchRow {
  id: string
  reelId: string
  watchedSeconds: number
  title: string
  thumb: string | null
  durationSeconds: number | null
  _author: { handle: string; full: string; profileImage: string | null; id: string }
  time: string
}

const STEP = 20
const MAX_WINDOW = 100
/** How many posts.get hydrations may be in the air at once. */
const HYDRATE_CHUNK = 8

/* Module scope: FlashList's ViewHolder memo compares keyExtractor's siblings
   by identity, so an arrow declared in the screen body re-renders every
   mounted row on every hydration merge — and this screen merges in chunks. */
const keyExtractor = (row: WatchRow) => String(row.id)

export default function WatchedReelsScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()

  const [size, setSize] = React.useState(STEP)
  const [rows, setRows] = React.useState<WatchRow[]>([])
  const [clearing, setClearing] = React.useState(false)
  const confirmClear = useSheetState()

  const history = useAsync<any>(() => api.reels.watched({ size }), {
    enabled: gate === 'allow',
    deps: [size],
    onSuccess: res => setRows(res?.items ?? []),
  })

  /* The watched endpoint's mapper populates only `reel.id` today — title,
     thumb and author all arrive empty (api/reels.js reelViewFrom notes this
     and points screens at posts.get(reelId) for the clip). Hydrate in chunks,
     fail-open per row: a reel deleted since it was watched keeps its
     placeholder row, because the history entry is real either way. */
  const hydratedIds = React.useRef(new Set<string>())
  React.useEffect(() => {
    const need = rows.filter(r => r.reelId && !r.title && !hydratedIds.current.has(r.reelId))
    if (!need.length) return undefined
    let alive = true
    void (async () => {
      for (let i = 0; i < need.length; i += HYDRATE_CHUNK) {
        const slice = need.slice(i, i + HYDRATE_CHUNK)
        const settled = await Promise.allSettled(slice.map(r => api.posts.get(r.reelId)))
        if (!alive) return
        for (const r of slice) hydratedIds.current.add(r.reelId)
        setRows(prev => prev.map(row => {
          const j = slice.findIndex(s => s.id === row.id)
          if (j < 0 || settled[j].status !== 'fulfilled') return row
          const full: any = (settled[j] as PromiseFulfilledResult<any>).value
          if (!full) return row
          return {
            ...row,
            title: row.title || full.body || '',
            thumb: row.thumb
              || full.media?.[0]?.poster
              || (full.media?.[0]?.type === 'IMAGE' ? full.media?.[0]?.url : null)
              || null,
            _author: row._author?.handle ? row._author : full._author ?? row._author,
          }
        }))
      }
    })()
    return () => { alive = false }
  }, [rows])

  /* Every handler a row is given is identity-stable and row-taking, so ONE
     function serves the whole list and WatchedRow's React.memo can skip the
     rows a hydration chunk did not touch. They sit above the auth gate because
     useEvent is a hook and the gate returns early. */
  const remove = useEvent(async (row: WatchRow) => {
    const before = rows
    setRows(prev => prev.filter(r => r.id !== row.id))
    fireHaptic('warning')
    try {
      await api.reels.deleteWatched(row.id)
    } catch (e) {
      setRows(before)
      toast.error(errorText(e))
    }
  })

  const open = useEvent(async (row: WatchRow) => {
    try {
      /* Verify before navigating: a history row outlives the reel it points at,
         and a dead deep link is a worse answer than an honest offer to tidy up. */
      const post = await api.posts.get(row.reelId)
      /* The verified read IS the reel — hand it over rather than reading it
         twice; `watched` continues down the history from this entry. */
      openReelIn(router, [post], post, { src: 'watched' })
    } catch (e) {
      if (isNotFound(e)) {
        toast.warn('That reel is no longer available', {
          label: 'Remove',
          onPress: () => { void remove(row) },
        })
      } else {
        toast.error(errorText(e))
      }
    }
  })

  const copyLink = useEvent(async (row: WatchRow) => {
    try {
      const link: any = await api.posts.shareLink(row.reelId)
      await Clipboard.setStringAsync(link?.shortUrl || link?.canonicalUrl || '')
      toast.ok('Link copied')
    } catch (e) {
      toast.error(errorText(e))
    }
  })

  const offline = isNetworkError(history.error)
  /* Recreated only when the offline flag flips — not on every hydration merge,
     which is what would otherwise re-render every mounted row. */
  const renderItem = React.useCallback(({ item }: { item: WatchRow }) => (
    <WatchedRow row={item} offline={offline} onOpen={open} onDelete={remove} onCopy={copyLink} />
  ), [offline, open, remove, copyLink])

  /* The endpoint 401s for anonymous callers, so the gate runs BEFORE the call
     rather than turning a predictable 401 into an error screen. */
  if (gate === 'deny') return <Redirect href="/(auth)/sign-in" />

  const total = history.data?.total ?? rows.length
  const canGrow = size < MAX_WINDOW && rows.length >= size

  const clearAll = async () => {
    setClearing(true)
    try {
      const res: any = await api.reels.clearWatched()
      setRows([])
      confirmClear.close()
      toast.ok(`Cleared ${res?.deleted ?? 0} watched reels`)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setClearing(false)
    }
  }

  const body = () => {
    if (history.loading && !rows.length) {
      return (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={56} height={88} radius={8} />
              <View style={{ flex: 1, gap: space.sm, paddingTop: space.xs2 }}>
                <Skeleton width="72%" height={13} />
                <Skeleton width="38%" height={11} />
                <Skeleton width="52%" height={11} />
              </View>
            </View>
          ))}
        </View>
      )
    }
    if (history.error && !rows.length) return <ReelErrorPlate error={history.error} onRetry={history.reload} />
    if (!rows.length) {
      return (
        <ReelPlate
          icon="clock"
          title="No watch history yet"
          body="Reels you watch show up here so you can find them again."
          actionLabel="Browse reels"
          onAction={() => router.replace('/(app)/(tabs)/reels')}
        />
      )
    }

    return (
      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={history.refreshing}
            onRefresh={history.refresh}
            tintColor={STAGE.fgMuted}
            colors={[t.colors.cta]}
            progressBackgroundColor={STAGE.plate}
          />
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {canGrow ? (
              <Button
                label={history.loading ? 'Loading…' : 'Show more'}
                onPress={() => setSize(s => Math.min(MAX_WINDOW, s + STEP))}
                variant="secondary"
                size="md"
                loading={history.loading}
                block
              />
            ) : null}
            <Text variant="caption" color={STAGE.fgFaint} align="center" style={styles.caveat}>
              History older than your most recent 500 watches can only be removed with Clear all.
            </Text>
          </View>
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
        <Text variant="headline" color={STAGE.fg} align="center" style={{ flex: 1 }}>Watched reels</Text>
        <Touchable
          onPress={() => confirmClear.open()}
          disabled={!rows.length}
          feedback="dim"
          accessibilityLabel="Clear all watch history"
          style={styles.clearBtn}
        >
          <Text variant="subhead" weight="600" color={rows.length ? STAGE.danger : STAGE.fgGhost}>Clear all</Text>
        </Touchable>
      </View>

      {rows.length ? (
        <View style={styles.captionBar}>
          <Text variant="footnote" color={STAGE.fgMuted}>{total} watched</Text>
          <Text variant="caption" color={STAGE.fgFaint}>Newest first</Text>
        </View>
      ) : null}

      {history.error && isNetworkError(history.error) && rows.length ? <OfflinePill top={insets.top + 60} /> : null}

      {body()}

      <ConfirmSheet
        visible={confirmClear.visible}
        onClose={confirmClear.close}
        title="Clear watch history?"
        message="This deletes your entire watch history. Reels you watched stay counted for their authors."
        confirmLabel="Clear"
        destructive
        loading={clearing}
        onConfirm={clearAll}
      />
    </View>
  )
}

const WatchedRow = React.memo(function WatchedRow({
  row, offline, onOpen, onDelete, onCopy,
}: {
  row: WatchRow
  offline: boolean
  onOpen: (row: WatchRow) => void
  onDelete: (row: WatchRow) => void
  onCopy: (row: WatchRow) => void
}) {
  const t = useTheme()
  const open = React.useCallback(() => onOpen(row), [onOpen, row])
  const del = React.useCallback(() => onDelete(row), [onDelete, row])
  const copy = React.useCallback(() => onCopy(row), [onCopy, row])

  const renderRight = () => (
    <Touchable
      onPress={del}
      disabled={offline}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel="Delete from history"
      style={[styles.swipeDelete, { backgroundColor: t.colors.danger }]}
    >
      <Icon name="trash" size={20} color={STAGE.fg} />
      <Text variant="caption" weight="600" color={STAGE.fg}>Delete</Text>
    </Touchable>
  )

  return (
    <Swipeable renderRightActions={offline ? undefined : renderRight} overshootRight={false}>
      <Touchable onPress={open} onLongPress={copy} feedback="tint" noAutoHitSlop style={styles.row}>
        <View style={styles.thumb}>
          {row.thumb ? (
            <Image
              source={{ uri: row.thumb }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              /* Without this a recycled row keeps painting the PREVIOUS reel's
                 bitmap until the new one decodes — a flick through history
                 shows visibly wrong thumbs. */
              recyclingKey={row.reelId}
            />
          ) : (
            <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.thumbPlay}>
            <Icon name="play" size={16} color={STAGE.fg} filled />
          </View>
        </View>

        <View style={styles.rowText}>
          <Text variant="subhead" weight="500" color={STAGE.fg} numberOfLines={2}>
            {row.title || 'Reel'}
          </Text>
          <Text variant="footnote" color={STAGE.fgMuted} numberOfLines={1}>
            @{row._author?.handle || 'member'}
          </Text>
          <Text variant="caption" color={STAGE.fgFaint} numberOfLines={1}>
            {clock(row.watchedSeconds)} watched · {row.time}
          </Text>
        </View>

        <Touchable
          onPress={del}
          disabled={offline}
          feedback="dim"
          accessibilityLabel="Remove from history"
          style={styles.rowRemove}
        >
          <Icon name="close" size={16} color={STAGE.fgFaint} />
        </Touchable>
      </Touchable>
    </Swipeable>
  )
})

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.plate },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2 },
  navBtn: { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
  clearBtn: { paddingHorizontal: space.md, height: 56, justifyContent: 'center' },
  captionBar: {
    height: 34,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: STAGE.plate,
  },
  thumb: { width: 56, height: 88, borderRadius: 8, overflow: 'hidden', backgroundColor: STAGE.tile },
  thumbPlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: space.xs },
  rowRemove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  swipeDelete: { width: 72, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  footer: { padding: space.lg, gap: space.md2 },
  caveat: { paddingHorizontal: space.sm },
})
