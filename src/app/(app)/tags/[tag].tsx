/* =========================================================
   Tag page — everything tagged #{tag}.

   A Cassandra partition per tag: newest-first, cursor-paged,
   live the instant something is written (no index to warm).
   That is why this — not search — is the honest answer to "did
   my post land?".

   The type filter is CLIENT-SIDE and says so, because the feed
   endpoint has no type parameter. While a filter is on, the
   screen keeps pulling cursor pages until it has enough matches
   or the partition ends, and the footer names how many rows
   that took — a filter that silently shows three of twenty
   loaded items reads as a broken tag.

   The rows carry no author, no counts and no media, and there
   is deliberately no fan-out to fetch them: twenty rows would
   be twenty requests for decoration.
   ========================================================= */
import React from 'react'
import { RefreshControl, Share, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import Animated, {
  interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { api, errorText, isTransient } from '@/api'
import { normalizeTag } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Callout, Divider, EmptyState, ErrorState, Header, ListFooter, Screen,
  Skeleton, Text, Touchable, fireHaptic, formatCount, toast, useSheetState,
} from '@/ui'
import {
  TagContentRow, contentHref, href, tagContent, useTransientRetry,
  type TagContentItem,
} from '@/components/search'

const FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'POST', label: 'Posts' },
  { value: 'REEL', label: 'Reels' },
  { value: 'QUESTION', label: 'Questions' },
  { value: 'RESEARCH', label: 'Research' },
]

const SCOPE_ORDER = ['ALL', 'RESEARCH', 'QUESTION', 'POST', 'REEL'] as const
const SCOPE_LABEL: Record<string, string> = {
  ALL: 'total', RESEARCH: 'research', QUESTION: 'questions', POST: 'posts', REEL: 'reels',
}

const PAGE = 20
/** Enough matching rows to fill a screen before the auto-loader rests. */
const FILTER_TARGET = 20

/* FlashList's imperative handle exposes getScrollableNode(), which is how
   reanimated attaches the worklet handler natively — the collapsing hero then
   follows the finger on the UI thread instead of racing the list's own render
   stack on the JS one. The cast is only there because createAnimatedComponent
   cannot carry the generic through. */
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList as React.ComponentType<any>) as unknown as typeof FlashList

/* Module scope: FlashList compares these by reference, and this list re-renders
   in bursts while the filter's auto-pager runs. */
const keyExtractor = (item: TagContentItem) => `${item.contentType}:${item.contentId}`
const Sep = () => <Divider />

export default function TagPageScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ tag?: string }>()
  const raw = String(params.tag ?? '')
  /* The server normalizes the path tag, so /tags/Hajj and /tags/hajj are one
     partition — normalizing here keeps the title honest about which. */
  const tag = normalizeTag(raw)

  const menu = useSheetState<TagContentItem>()
  const [filter, setFilter] = React.useState('ALL')
  const scrollY = useSharedValue(0)
  const listRef = React.useRef<any>(null)

  /* ---- header breakdown: one round-trip for all five scopes ---- */
  const usage = useAsync<{ tag: string; scopes: Record<string, number> }>(
    /* `scope: '*'` is the breakdown mode — one round-trip, not five. */
    () => api.tags.usage(tag, { scope: '*' }) as Promise<{ tag: string; scopes: Record<string, number> }>,
    { enabled: !!tag, deps: [tag] },
  )
  /* Cheap enough to re-read on every return from a detail screen; the feed is
     deliberately NOT refetched here so scroll position survives. */
  useFocusEffect(React.useCallback(() => { if (tag) void usage.refresh() }, [tag]))   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- feed ---- */
  const [items, setItems] = React.useState<TagContentItem[]>([])
  const [cursor, setCursor] = React.useState('')
  const [done, setDone] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const busy = React.useRef(false)
  const seen = React.useRef(new Set<string>())

  const load = React.useCallback(async (kind: 'first' | 'more' | 'refresh') => {
    if (!tag || busy.current) return
    if (kind === 'more' && (done || !cursor)) return
    busy.current = true
    if (kind === 'first') setLoading(true)
    else if (kind === 'refresh') setRefreshing(true)
    else setLoadingMore(true)
    if (kind !== 'more') setError(null)

    try {
      const res = await tagContent(tag, {
        cursor: kind === 'more' ? cursor : undefined,
        pageSize: PAGE,
      })
      if (kind !== 'more') seen.current = new Set()
      const fresh = res.items.filter(r => {
        const k = `${r.contentType}:${r.contentId}`
        if (seen.current.has(k)) return false
        seen.current.add(k)
        return true
      })
      setItems(prev => (kind === 'more' ? [...prev, ...fresh] : fresh))
      setCursor(res.nextCursor)
      /* Stop on an empty page or a short page as well as on an empty cursor:
         a partition that keeps handing back a token with no rows would loop. */
      setDone(!res.nextCursor || !res.items.length || res.items.length < PAGE)
    } catch (e: any) {
      setError(e)
    } finally {
      busy.current = false
      setLoading(false); setLoadingMore(false); setRefreshing(false)
    }
  }, [tag, cursor, done])

  React.useEffect(() => {
    setItems([]); setCursor(''); setDone(false); seen.current = new Set()
    void load('first')
  }, [tag])   // eslint-disable-line react-hooks/exhaustive-deps

  useTransientRetry(error, () => void load('first'))

  const filtered = React.useMemo(
    () => (filter === 'ALL' ? items : items.filter(r => r.contentType === filter)),
    [items, filter],
  )

  /* A client-side filter starves the list, so it drives the pager itself. */
  React.useEffect(() => {
    if (filter === 'ALL' || done || loading || loadingMore) return
    if (filtered.length >= FILTER_TARGET) return
    void load('more')
  }, [filter, filtered.length, done, loading, loadingMore, load])

  /* ---- collapsing header ----
     The hero measures itself once and only then takes over its own height, so
     the first layout is unconstrained and the collapse lands on the real
     number instead of a guess that clips a two-line Arabic tag.

     And yes, this is a HEIGHT animation on purpose. The obvious "make it a
     transform" rewrite — clip the hero, translateY its contents — does not
     work here, because the height IS the mechanism: shrinking it is what
     hands the vacated strip to the list below. A transform leaves the block
     occupying its full height, so the rows either gap away from the filter
     strip or hide behind the header plate (Header owns zIndex.header, so it
     always wins). Translating the list instead needs the list frame extended
     by heroH, and then the last rows of a barely-scrollable list become
     unreachable — the compensating pad is (heroH - collapse), which is a
     layout animation again. The honest fix is architectural: float the header
     over a full-height list on a contentInset and collapse at 1:1 with the
     finger. Not a two-line change; see the smoothness follow-ups. */
  const heroH = useSharedValue(0)
  const bigStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 52], [1, 0], 'clamp')
    if (!heroH.value) return { opacity }
    return {
      opacity,
      height: interpolate(scrollY.value, [0, 62], [heroH.value, 0], 'clamp'),
    }
  })
  const smallStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [34, 76], [0, 1], 'clamp'),
  }))

  const onScroll = useAnimatedScrollHandler({
    onScroll: e => { scrollY.value = e.contentOffset.y },
  })

  /* Identity-stable and item-first, so one pair of handlers serves every row
     and a page landing does not re-render the mounted window with it. */
  const openRow = useEvent((row: TagContentItem) => {
    const target = contentHref(row.contentType, row.contentId)
    if (target) router.push(href(target))
  })
  const longPressRow = useEvent((row: TagContentItem) => { fireHaptic('medium'); menu.open(row) })

  const renderItem = React.useCallback(({ item }: { item: TagContentItem }) => (
    <TagContentRow row={item} onPress={openRow} onLongPress={longPressRow} />
  ), [openRow, longPressRow])

  const scopes = usage.data?.scopes ?? null
  const copyTag = async () => { await Clipboard.setStringAsync(`#${tag}`); toast.ok('Tag copied') }

  return (
    <Screen>
      <Header
        back
        titleNode={
          <Animated.View style={smallStyle}>
            <Text variant="headline" align="center" numberOfLines={1}>#{tag}</Text>
          </Animated.View>
        }
        actions={[{ icon: 'share', onPress: () => void copyTag(), label: 'Copy tag' }]}
        border={false}
        below={
          <View>
            <Animated.View style={[styles.heroClip, bigStyle]}>
              <View
                style={[styles.hero, { paddingHorizontal: t.layout.screenPadding }]}
                onLayout={e => { heroH.value = e.nativeEvent.layout.height }}
              >
                <Text variant="display" numberOfLines={1} adjustsFontSizeToFit>#{tag}</Text>
                <View style={styles.chipWrap}>
                  {usage.loading && !scopes ? (
                    SCOPE_ORDER.map(k => <Skeleton key={k} width={72} height={28} radius={14} />)
                  ) : (
                    SCOPE_ORDER.map(k => (
                      <View
                        key={k}
                        style={[
                          styles.usageChip,
                          {
                            borderColor: c.border,
                            borderRadius: 14,
                            /* Zero-count scopes still render — the API returns
                               them as 0 precisely so the zero-state stays
                               consistent; a failed usage read shows em-dashes
                               and never blocks the feed. */
                            opacity: scopes && !scopes[k] ? 0.4 : 1,
                          },
                        ]}
                      >
                        <Text variant="caption" tone="secondary">
                          {scopes ? formatCount(scopes[k] ?? 0) : '—'} {SCOPE_LABEL[k]}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </Animated.View>

            <View style={[styles.filterStrip, { borderBottomColor: c.separator }]}>
              {FILTERS.map(f => {
                const on = f.value === filter
                return (
                  <Touchable
                    key={f.value}
                    onPress={() => {
                      setFilter(f.value)
                      listRef.current?.scrollToOffset?.({ offset: 0, animated: false })
                    }}
                    feedback="scale"
                    haptic="select"
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: on ? c.accent : c.surfaceSunken,
                      },
                    ]}
                  >
                    <Text variant="footnote" weight="600" color={on ? c.textOnAccent : c.textSecondary}>
                      {f.label}
                    </Text>
                  </Touchable>
                )
              })}
            </View>
          </View>
        }
      />

      {loading && !items.length ? (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[styles.skelRow, { paddingHorizontal: t.layout.screenPadding }]}>
              <Skeleton width={40} height={40} radius={12} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="82%" height={12} />
                <Skeleton width="40%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : error && !items.length ? (
        <ErrorState
          error={error}
          onRetry={() => void load('first')}
          title={isTransient(error) ? 'Tags are temporarily unavailable' : undefined}
        />
      ) : (
        <AnimatedFlashList
          ref={listRef}
          data={filtered}
          keyExtractor={keyExtractor}
          /* The cast is the same one the home feed carries: FlashList's props
             type the handler as a JS event callback, not a worklet. */
          onScroll={onScroll as any}
          scrollEventThrottle={16}
          onEndReachedThreshold={0.6}
          onEndReached={() => void load('more')}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setCursor(''); setDone(false); void load('refresh') }}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          ItemSeparatorComponent={Sep}
          ListEmptyComponent={
            <EmptyState
              icon="hash"
              title={`Nothing tagged #${tag} yet`}
              message={filter === 'ALL' ? 'Be the first to use it.' : `Nothing of this type in the ${items.length} loaded items.`}
              actionLabel={filter === 'ALL' ? 'Create a post' : 'Show everything'}
              onAction={() => (filter === 'ALL'
                ? router.push(href({ pathname: '/compose', params: { tags: tag } }))
                : setFilter('ALL'))}
            />
          }
          ListFooterComponent={
            <View>
              {filter !== 'ALL' && filtered.length ? (
                <Text variant="caption" tone="faint" align="center" style={{ paddingTop: space.md2 }}>
                  Filtered from {items.length} loaded items
                </Text>
              ) : null}
              {filtered.length ? (
                <ListFooter
                  loading={loadingMore}
                  error={items.length ? error : null}
                  onRetry={() => void load('more')}
                  done={done}
                  doneLabel="You’ve reached the end"
                />
              ) : null}
            </View>
          }
          renderItem={renderItem}
        />
      )}

      {/* A failed usage read must never take the feed with it — and the
          message has to clear the Android nav bar, which owns the first 48pt
          of a window this <Screen> takes no bottom edge for. */}
      {usage.error && !usage.data ? (
        <Callout tone="neutral" style={[styles.usageError, { bottom: Math.max(insets.bottom, 12) + 4 }]}>
          {errorText(usage.error)}
        </Callout>
      ) : null}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Copy link',
            icon: 'copy',
            onPress: async () => {
              const target = menu.payload && contentHref(menu.payload.contentType, menu.payload.contentId)
              if (!target) return
              await Clipboard.setStringAsync(Linking.createURL(target))
              toast.ok('Link copied')
            },
          },
          {
            label: 'Share',
            icon: 'share',
            onPress: async () => {
              const target = menu.payload && contentHref(menu.payload.contentType, menu.payload.contentId)
              if (!target) return
              await Share.share({ message: Linking.createURL(target) })
            },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  heroClip: { overflow: 'hidden' },
  hero: { paddingTop: space.xs, paddingBottom: space.sm2, gap: space.sm2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  usageChip: {
    height: 28, paddingHorizontal: space.sm2, justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterStrip: {
    flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm2,
    alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
  },
  /* A selection chip, so it wears the chip setback — not the pill.
     DESIGN.md §8.9 sanctions pills for unread counters and LIVE badges only. */
  filterChip: {
    height: 32, paddingHorizontal: space.md2, alignItems: 'center', justifyContent: 'center',
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 80 },
  usageError: { position: 'absolute', start: 16, end: 16 },
})
