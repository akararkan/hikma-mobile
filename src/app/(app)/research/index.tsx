/* =========================================================
   Research hub — the discovery entry point.

   NOTE: the spec placed this at `(app)/(tabs)/research.tsx`,
   but the tab layout is owned by another domain and lists five
   tabs that do not include research. This is the same screen at
   `/research`, which is also where every deep link in the
   platform already points (search.js's hitHref, the mention and
   notification rewrites), so nothing else has to change if it
   later becomes a tab.

   Each segment keeps its own pager instance and only ever
   enables it once: coming back to a tab must not refetch a feed
   the user already scrolled.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import { api } from '@/api'
import { hasRole, useAuth, useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Chip, ChipRail, EmptyState, Header, ListFooter, Screen, SegmentedControl, Text, Touchable,
  Icon, formatCount,
} from '@/ui'
import {
  ResearchCard, ResearchCardListSkeleton, useResearchMenu,
} from '@/components/research/ResearchCard'
import { ErrorPanel, SignInPrompt, useTransientRetry } from '@/components/research/states'
import { useResearchList } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { ResearchCardData, TrendingTag } from '@/components/research/types'

type Segment = 'latest' | 'following' | 'mine'

/* FlashList's ViewHolder memo compares renderItem AND ItemSeparatorComponent
   BY IDENTITY, and a separator declared inline is worse still — it is a
   brand-new component TYPE every render, so React remounts every visible
   separator rather than reconciling it. Both live at module scope; `Sep`
   reads the theme itself instead of closing over the screen's `c`. */
const keyExtractor = (item: ResearchCardData) => String(item.id)

function Sep() {
  const c = useTheme().colors
  return <View style={[styles.sep, { backgroundColor: c.separator }]} />
}

export default function ResearchHubScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const authGate = useAuthGate()
  const canAuthor = hasRole(user, ['SCHOLAR', 'RESEARCHER', 'ADMIN', 'SUPER_ADMIN'])

  const [segment, setSegment] = React.useState<Segment>('latest')
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)
  /* Enabling is one-way: a segment that has loaded stays loaded, which is what
     makes switching back free. */
  const [visited, setVisited] = React.useState<Segment[]>(['latest'])
  const seen = (s: Segment) => visited.includes(s)

  const latest = useResearchList(({ page, size }) => api.research.feed({ page, size }), { enabled: true })
  const following = useResearchList(
    ({ page, size }) => api.research.following({ page, size }),
    { enabled: seen('following') && authGate === 'allow' },
  )
  const mine = useResearchList(
    ({ page, size }) => api.research.myAll({ page, size }),
    { enabled: seen('mine') && canAuthor },
  )

  const list = segment === 'latest' ? latest : segment === 'following' ? following : mine

  const trending = useAsync<TrendingTag[]>(() => api.tags.trending({ scope: 'RESEARCH', limit: 20 }))
  useTransientRetry(list.error, list.reload)

  const menu = useResearchMenu({
    onPatch: (id, patch) => list.patch(id, row => ({ ...row, ...patch })),
  })

  const select = (s: Segment) => {
    setSegment(s)
    setVisited(v => (v.includes(s) ? v : [...v, s]))
  }

  /* ---------- row plumbing ----------
     One identity-stable long-press handler serves every row (item-first, so no
     per-row closure), and the only thing that can move `renderItem` is the
     boolean the card actually renders. */
  const showStatus = segment === 'mine'
  const openMenu = useEvent((item: ResearchCardData) => menu.open(item))
  const renderItem = React.useCallback(
    ({ item }: { item: ResearchCardData }) => (
      <ResearchCard item={item} showStatus={showStatus} onLongPress={openMenu} />
    ),
    [showStatus, openMenu],
  )

  /* Header/footer are ViewHolders too — a fresh element identity re-renders
     them on every parent render, so both are memoized by reference. */
  const listHeader = React.useMemo(
    () => (list.error && list.items.length
      ? <ErrorPanel error={list.error} onRetry={list.reload} compact />
      : null),
    [list.error, list.items.length, list.reload],
  )
  const listFooter = React.useMemo(
    () => (list.items.length
      ? <ListFooter loading={list.loadingMore} error={null} done={list.done} doneLabel="You have reached the earliest paper" />
      : null),
    [list.items.length, list.loadingMore, list.done],
  )

  /* The collapse only has two states; without the ref guard this fires a
     setState on every one of the ~60 scroll frames a second. */
  const collapsedRef = React.useRef(false)
  const onScroll = useEvent((e: any) => {
    const next = e.nativeEvent.contentOffset.y > 8
    if (next === collapsedRef.current) return
    collapsedRef.current = next
    setCollapsed(next)
  })

  const options = [
    { value: 'latest' as const, label: 'Latest' },
    { value: 'following' as const, label: 'Following' },
    ...(canAuthor ? [{ value: 'mine' as const, label: 'My papers' }] : []),
  ]

  const below = (
    <View>
      <Text variant="footnote" tone="muted" align="ui" style={styles.subtitle}>
        Peer work from the institute — read, cite and keep.
      </Text>
      <SegmentedControl options={options} value={segment} onChange={select} style={styles.segments} />
      {trending.error ? (
        <Text variant="caption" tone="faint" align="ui" style={styles.trendingFail}>Trending unavailable</Text>
      ) : (
        <ChipRail style={styles.rail}>
          <Chip label="All" tone="neutral" onPress={() => router.push(to('/research/tags'))} />
          {(trending.data || []).map(row => (
            <Chip
              key={row.tag}
              label={`#${row.tag} · ${formatCount(row.usageCount)}`}
              tone="scholar"
              onPress={() => router.push(to(`/research/tag/${encodeURIComponent(row.tag)}`))}
            />
          ))}
          <Chip label="See all" icon="forward" onPress={() => router.push(to('/research/tags'))} />
        </ChipRail>
      )}
    </View>
  )

  const empty = (() => {
    if (segment === 'following' && authGate !== 'allow') {
      return <SignInPrompt message="Sign in to follow researchers and see their new papers here." />
    }
    if (list.loading) return <ResearchCardListSkeleton />
    if (list.error && !list.items.length) return <ErrorPanel error={list.error} onRetry={list.reload} />
    if (segment === 'following') {
      return (
        <EmptyState
          icon="people"
          title="You are not following any researchers yet."
          message="Follow a scholar and their new papers land here first."
          actionLabel="Browse latest"
          onAction={() => select('latest')}
        />
      )
    }
    if (segment === 'mine') {
      return (
        <EmptyState
          icon="edit"
          title="You have not started a paper yet."
          message="Drafts stay private until you publish them."
          actionLabel="Start a paper"
          onAction={() => router.push(to('/research/compose'))}
        />
      )
    }
    return (
      <EmptyState
        icon="research"
        title="No papers published yet."
        message="Published research from the institute appears here."
      />
    )
  })()

  return (
    <Screen>
      <Header
        large
        title="Research"
        collapsed={collapsed}
        actions={[
          { icon: 'search', onPress: () => router.push(to('/research/search')), label: 'Search papers' },
          { icon: 'bookmark', filled: true, onPress: () => router.push(to('/research/saved')), label: 'Saved papers' },
        ]}
        below={below}
      />

      <FlashList
        data={list.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={listFooter}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        onScroll={onScroll}
        scrollEventThrottle={16}
        /* A research card is a 16:9 plate plus title, abstract, tags, author
           and metrics — 300pt+. The platform default 250 prepares barely one
           cell ahead, so a fling outruns the render stack. */
        drawDistance={500}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={() => { void list.refresh() }}
            tintColor={c.textMuted}
            colors={[c.accent]}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}
      />

      {canAuthor ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(220))}
          style={[styles.fabWrap, { bottom: insets.bottom + 24 }]}
        >
          <Touchable
            onPress={() => router.push(to('/research/compose'))}
            feedback="scale"
            haptic="medium"
            accessibilityLabel="Start a paper"
            /* No shadow: QELAT depth is letterpress + a drawn rule, so the FAB
               separates with a 1px border in `accentPressed` (DESIGN.md §6). */
            style={[styles.fab, setback(t.shape.fab), { backgroundColor: c.accent, borderColor: c.accentPressed }]}
          >
            <Icon name="edit" size={24} color={c.textOnAccent} />
          </Touchable>
        </Animated.View>
      ) : null}

      {menu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  subtitle: { paddingHorizontal: space.lg, paddingBottom: space.md },
  segments: { marginHorizontal: space.lg },
  rail: { paddingVertical: space.sm2 },
  trendingFail: { paddingHorizontal: space.lg, paddingVertical: space.md2 },
  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: space.lg },
  fabWrap: { position: 'absolute', end: 20 },
  /* ComposeFab's shape (DESIGN.md §6): a 56pt plate on the fab setback with a
     1px accentPressed border — never a circle, never a shadow. */
  fab: { width: 56, height: 56, borderWidth: 1, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
})
