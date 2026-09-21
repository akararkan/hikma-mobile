/* =========================================================
   Explore — the single search entry point for the whole app.

   It is a four-state machine behind one field:

     BROWSE   blurred, empty — trending rail, discovery grid,
              the four directory rows
     RECENTS  focused, empty — this device's history, then the
              account's own GLOBAL_SEARCH / HASHTAG_SEARCH trail
     SUGGEST  typing — debounced tag prefixes + top hits
     RESULTS  submitted — nine tabs, each with its OWN cursor

   Three things here are contracts, not preferences:

   1. `api.search.stream()` is the paging call. A request with no
      cursor runs OFFSET mode and omits `nextCursor` entirely, so
      a "load more" built on `page()` silently re-serves page 0
      for ever. `stream()` injects the head sentinel to open
      cursor mode on the first page.
   2. `degraded: true` is a 200 with Elasticsearch down. Banner,
      never an error, and it SUPPRESSES the empty state — an
      empty list with `degraded` set is a failure, not an absence.
   3. Two deep links already ship in the API client and land
      here: `/explore?q=` (activity's GLOBAL_SEARCH rows) and
      `/explore?sound=` (`hitHref` for SOUND hits). Both are
      honoured from the URL, and both are written back with
      `setParams` so the back gesture stays coherent.
   ========================================================= */
import React from 'react'
import {
  Keyboard, RefreshControl, ScrollView, Share, StyleSheet, View, useWindowDimensions,
} from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, cancelAnimation,
  useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { api, errorText, hitHref, isClientBug, isRateLimited } from '@/api'
import { normalizeTag } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useTabBarClearance } from '@/hooks/useTabBarClearance'
import { useAfterInteractions } from '@/hooks/useAfterInteractions'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Callout, ConfirmSheet, Divider, EmptyState, ErrorState, Header, Icon,
  ListFooter, NumericText, Screen, SearchField, Skeleton, Text, Touchable, TouchableRow,
  fireHaptic, formatCount, toast, useSheetState, type IconName,
} from '@/ui'
import {
  SEARCH_TABS, ScopeTagRail, SearchDegradedBanner, SearchResultRow, SearchResultSkeletonList,
  SearchTypeTabs, SoundSheet, TrendingTagRail, TRENDING_STALE_MS,
  canOpen, href, listActivity, recentSearches, searchStream, searchTags,
  useTransientRetry, usePushHit,
  TYPE_ICON, TYPE_LABEL, TAB_LABEL, typeSkin,
  type ActivityRow, type Recent, type SearchHit, type TabKey,
  type TagContentPage, type TagSuggestion, type TrendingTag,
} from '@/components/search'
import { useTabRetap } from '@/components/nav/tabEvents'

type Mode = 'browse' | 'recents' | 'suggest' | 'results'

interface TabState {
  items: SearchHit[]
  nextCursor: string
  degraded: boolean
  error: any
  loading: boolean
  loadingMore: boolean
  loaded: boolean
}

const EMPTY_TAB: TabState = {
  items: [], nextCursor: '', degraded: false, error: null,
  loading: false, loadingMore: false, loaded: false,
}

const keyOf = (h: SearchHit) => `${h.contentType}:${h.contentId}`
/* The ALL tab mixes USER / POST / RESEARCH / QUESTION / CHANNEL hits, and a
   SearchResultRow's leading element is a different shape for each. FlashList
   pools recycled cells BY ITEM TYPE, so without this a user row's React key
   gets handed to a reel plate and the whole subtree is torn down instead of
   swapping props. */
const getItemType = (h: SearchHit) => h.contentType
/* Module scope: an inline ItemSeparatorComponent is a new component TYPE every
   render, which remounts every visible separator and breaks the cell memo. */
const Sep = () => <Divider inset={68} />

export default function ExploreScreen() {
  const t = useTheme()
  const router = useRouter()
  const bottomPad = useTabBarClearance()
  const gate = useAuthGate()
  const params = useLocalSearchParams<{ q?: string; type?: string; sound?: string }>()
  const pushHit = usePushHit({ inExplore: true })
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  const [text, setText] = React.useState(() => String(params.q ?? ''))
  const [submitted, setSubmitted] = React.useState(() => String(params.q ?? ''))
  const [focused, setFocused] = React.useState(false)
  const [tab, setTab] = React.useState<TabKey>(() => (params.type as TabKey) || 'ALL')

  const trimmed = text.trim()
  const mode: Mode =
    trimmed && trimmed !== submitted ? 'suggest'
      : submitted ? 'results'
        : focused ? 'recents'
          : 'browse'

  const soundId = params.sound ? String(params.sound) : null

  /* The transition gate. Browse fired FIVE reads on mount; two of them draw
     the screen (`trending` is the rail at the top, `discover` is the grid
     under it) and those two stay exactly where they were. The other three —
     the two scope shelves far below the fold and the purely decorative usage
     line — plus the RECENTS history read, which belongs to a mode you cannot
     even reach without tapping the field, now wait for the slide to finish. */
  const ready = useAfterInteractions()

  /* ---- BROWSE ------------------------------------------------------- */

  const trendingAt = React.useRef(0)
  const trending = useAsync<TrendingTag[]>(
    () => api.tags.trending({ scope: 'ALL', limit: 20 }) as Promise<TrendingTag[]>,
    { onSuccess: () => { trendingAt.current = Date.now() } },
  )
  const topTag = trending.data?.[0]?.tag ?? ''
  const discover = useAsync<TagContentPage>(
    () => api.tags.content(topTag, { pageSize: 9 }) as Promise<TagContentPage>,
    { enabled: !!topTag, deps: [topTag] },
  )
  /* The per-scope leaderboards behind the editorial shelves. Errors are
     swallowed by rendering nothing — a dead shelf must not take Browse down.
     Both shelves sit below the grid, i.e. below the fold on every phone, so
     they are gated on the transition rather than raced against it. */
  const research = useAsync<TrendingTag[]>(
    () => api.tags.trending({ scope: 'RESEARCH', limit: 6 }) as Promise<TrendingTag[]>,
    { enabled: ready },
  )
  const questions = useAsync<TrendingTag[]>(
    () => api.tags.trending({ scope: 'QUESTION', limit: 6 }) as Promise<TrendingTag[]>,
    { enabled: ready },
  )
  /* scope='*' is the one-round-trip per-scope breakdown for the Discover
     header's subtitle. Purely decorative: never blocks the grid — which is
     also why it is the easiest of the five to put behind the gate. */
  const usage = useAsync<{ tag: string; scopes: Record<string, number> }>(
    () => api.tags.usage(topTag, { scope: '*' }) as Promise<{ tag: string; scopes: Record<string, number> }>,
    { enabled: ready && !!topTag, deps: [topTag] },
  )
  useTransientRetry(trending.error, trending.reload)
  useTransientRetry(discover.error, discover.reload)

  /* The leaderboard is a 10-minute server snapshot, so coming back to the tab
     is only worth a refetch once the cached copy could plausibly have moved.
     Held in a ref: a focus effect keyed on the async object would re-subscribe
     on every render. */
  const refreshTrending = React.useRef(trending.refresh)
  refreshTrending.current = trending.refresh
  useFocusEffect(React.useCallback(() => {
    if (trendingAt.current && Date.now() - trendingAt.current > TRENDING_STALE_MS) void refreshTrending.current()
  }, []))

  /* ---- RECENTS ------------------------------------------------------ */

  const [recents, setRecents] = React.useState<Recent[]>(() => recentSearches.list())
  const clearAll = useSheetState()
  /* RECENTS is only reachable by focusing the field, which needs a tap — so
     this read has never once been on screen during a transition it was
     nonetheless competing with. */
  const serverRecents = useAsync<ActivityRow[]>(
    () => listActivity({ types: ['GLOBAL_SEARCH', 'HASHTAG_SEARCH'], page: 0, size: 10 }),
    { enabled: ready && gate === 'allow' },
  )
  const [droppedRows, setDroppedRows] = React.useState<string[]>([])

  /* ---- SUGGEST ------------------------------------------------------ */

  const [sugTags, setSugTags] = React.useState<TagSuggestion[]>([])
  const [sugHits, setSugHits] = React.useState<SearchHit[]>([])
  const [suggesting, setSuggesting] = React.useState(false)
  const sugSeq = React.useRef(0)

  React.useEffect(() => {
    if (mode !== 'suggest') { setSuggesting(false); return }
    const term = trimmed
    const norm = normalizeTag(term)
    setSuggesting(true)
    const ctl = new AbortController()
    const id = setTimeout(async () => {
      const mine = ++sugSeq.current
      const [tagsRes, hitsRes] = await Promise.allSettled([
        /* No AbortSignal on tag search — the sequence number is the guard. */
        norm ? searchTags({ prefix: norm, scope: 'ALL', limit: 5 }) : Promise.resolve([] as TagSuggestion[]),
        searchStream(term, { size: 8, signal: ctl.signal }),
      ])
      if (mine !== sugSeq.current) return
      /* Tag autocomplete comes back tag-name ascending; popular-first is the
         useful order in a typeahead. */
      setSugTags(tagsRes.status === 'fulfilled'
        ? [...tagsRes.value].sort((a, b) => b.usageCount - a.usageCount)
        : [])
      setSugHits(hitsRes.status === 'fulfilled' ? hitsRes.value.results : [])
      setSuggesting(false)
    }, 250)
    /* Every keystroke kills the previous stream call. */
    return () => { clearTimeout(id); ctl.abort() }
  }, [mode, trimmed])

  /* ---- RESULTS ------------------------------------------------------ */

  const [tabs, setTabs] = React.useState<Record<string, TabState>>({})
  const tabsRef = React.useRef(tabs)
  tabsRef.current = tabs
  const submittedRef = React.useRef(submitted)
  submittedRef.current = submitted
  const inflight = React.useRef(new Map<string, AbortController>())
  const [hidden, setHidden] = React.useState<string[]>([])
  /* Bumped on every submit so re-searching the SAME term still refetches —
     `submitted` alone would be unchanged and the effect would never fire. */
  const [runNonce, setRunNonce] = React.useState(0)

  const runTab = React.useCallback(async (key: TabKey, kind: 'first' | 'more') => {
    const q = submittedRef.current
    /* A blank q short-circuits client-side anyway; guarding here keeps
       MISSING_PARAMETER — which is a client bug, not a user error — off the wire. */
    if (!q.trim()) return
    const cur = tabsRef.current[key] ?? EMPTY_TAB
    if (kind === 'more' && (!cur.nextCursor || cur.loadingMore)) return
    if (kind === 'first' && cur.loading) return

    inflight.current.get(key)?.abort()
    const ctl = new AbortController()
    inflight.current.set(key, ctl)

    setTabs(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? EMPTY_TAB), error: null, loading: kind === 'first', loadingMore: kind === 'more' },
    }))

    try {
      const res = await searchStream(q, {
        types: key === 'ALL' ? undefined : [key],
        cursor: kind === 'more' ? cur.nextCursor : undefined,
        size: 20,
        signal: ctl.signal,
      })

      setTabs(prev => {
        const before = prev[key] ?? EMPTY_TAB
        const merged = kind === 'more' ? [...before.items, ...res.results] : res.results
        /* A ranked merge can legitimately re-emit a row across pages, and a
           duplicate key is a hard crash in FlashList. */
        const seen = new Set<string>()
        const items = merged.filter(h => { const k = keyOf(h); if (seen.has(k)) return false; seen.add(k); return true })
        return {
          ...prev,
          [key]: { items, nextCursor: res.nextCursor, degraded: res.degraded, error: null, loading: false, loadingMore: false, loaded: true },
        }
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      if (isRateLimited(e)) startCooldown(e)
      setTabs(prev => ({
        ...prev,
        /* A client bug has already screamed through logApiError; showing it to
           the user would only blame them for our malformed request. */
        [key]: { ...(prev[key] ?? EMPTY_TAB), error: isClientBug(e) ? null : e, loading: false, loadingMore: false, loaded: true },
      }))
    }
  }, [startCooldown])

  React.useEffect(() => {
    if (mode !== 'results') return
    const st = tabsRef.current[tab]
    if (!st || (!st.loaded && !st.loading)) void runTab(tab, 'first')
  }, [mode, tab, submitted, runNonce, runTab])

  React.useEffect(() => () => { inflight.current.forEach(ctl => ctl.abort()) }, [])

  /* ---- deep links --------------------------------------------------- */

  React.useEffect(() => {
    const q = params.q ? String(params.q) : ''
    if (q && q !== submitted) { setText(q); setSubmitted(q); setTabs({}) }
  }, [params.q])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- actions ------------------------------------------------------ */

  const submit = (raw?: string) => {
    const term = (raw ?? text).trim()
    if (!term || cooldown > 0) return
    /* The commit point — lesser actions (chip taps) already buzz. */
    fireHaptic('light')
    Keyboard.dismiss()
    setFocused(false)
    setText(term)
    setSubmitted(term)
    setTabs({})
    setHidden([])
    setRecents(recentSearches.push(term, term.startsWith('#') ? 'tag' : 'text'))
    setRunNonce(n => n + 1)
    router.setParams({ q: term })
  }

  const onChangeText = (v: string) => {
    setText(v)
    if (!v.trim() && submitted) { setSubmitted(''); setTabs({}); router.setParams({ q: '' }) }
  }

  const cancel = () => {
    Keyboard.dismiss()
    setFocused(false)
    setText('')
    setSubmitted('')
    setTabs({})
    router.setParams({ q: '' })
  }

  const changeTab = (k: TabKey) => { setTab(k); router.setParams({ type: k }) }

  const rowMenu = useSheetState<SearchHit>()
  /* Both handed to every result row: identity-stable so the results list's
     renderItem is too. */
  const onHit = useEvent((hit: SearchHit) => pushHit(hit))
  const onHitMenu = useEvent((hit: SearchHit) => { fireHaptic('medium'); rowMenu.open(hit) })
  const shareLink = async (hit: SearchHit, copyOnly: boolean) => {
    const path = hitHref(hit)
    if (!path) return
    const url = Linking.createURL(path)
    if (copyOnly) { await Clipboard.setStringAsync(url); toast.ok('Link copied'); return }
    await Share.share({ message: url })
  }

  const removeRecent = (r: Recent) => { fireHaptic('light'); setRecents(recentSearches.remove(r.q)) }

  const removeServerRecent = async (row: ActivityRow) => {
    setDroppedRows(d => [...d, row.id])
    try {
      await api.activity.remove(row.id)
    } catch (e: any) {
      setDroppedRows(d => d.filter(id => id !== row.id))
      toast.error(errorText(e))
    }
  }

  const runClearAll = async () => {
    clearAll.close()
    setRecents(recentSearches.clear())
    if (gate !== 'allow') return
    try {
      /* One type per call — the endpoint takes a single type. */
      await api.activity.clear('GLOBAL_SEARCH')
      await api.activity.clear('HASHTAG_SEARCH')
      void serverRecents.reload()
      toast.ok('Search history cleared')
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  /* ---- render ------------------------------------------------------- */

  const active = tabs[tab] ?? EMPTY_TAB
  const visibleItems = React.useMemo(
    () => (hidden.length ? active.items.filter(h => !hidden.includes(keyOf(h))) : active.items),
    [active.items, hidden],
  )
  const busy = mode === 'suggest' ? suggesting : mode === 'results' ? active.loading || active.loadingMore : false

  return (
    <Screen>
      <Header
        border={mode !== 'results'}
        titleNode={
          <View style={styles.fieldRow}>
            <Animated.View
              style={styles.flex}
              layout={t.prefs.reducedMotion ? undefined : LinearTransition.duration(t.ms(180))}
            >
              <SearchField
                value={text}
                onChangeText={onChangeText}
                onFocus={() => setFocused(true)}
                onSubmit={() => submit()}
                placeholder="Search Hikmah Web"
                /* The hairline below is decorative; this is the announced
                   in-flight signal. */
                accessibilityState={{ busy }}
              />
            </Animated.View>
            {focused || submitted ? (
              <Animated.View
                entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(180))}
                exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(120))}
              >
                <Touchable onPress={cancel} feedback="dim" style={styles.cancel}>
                  <Text variant="callout" tone="accent">Cancel</Text>
                </Touchable>
              </Animated.View>
            ) : null}
          </View>
        }
        below={
          <>
            <ProgressHairline active={busy} />
            {mode === 'results' ? <SearchTypeTabs value={tab} onChange={changeTab} /> : null}
          </>
        }
      />

      {mode === 'browse' ? (
        <Browse
          trending={trending.data}
          trendingLoading={trending.loading}
          trendingError={trending.error}
          onRetryTrending={trending.reload}
          discover={discover.data}
          discoverLoading={discover.loading}
          usageScopes={!usage.loading && !usage.error ? usage.data?.scopes ?? null : null}
          research={research.error ? null : research.data}
          researchLoading={research.loading}
          questions={questions.error ? null : questions.data}
          questionsLoading={questions.loading}
          refreshing={trending.refreshing || discover.refreshing}
          onRefresh={() => {
            void trending.refresh(); void discover.refresh(); void usage.refresh()
            void research.refresh(); void questions.refresh()
          }}
        />
      ) : mode === 'recents' ? (
        <Recents
          recents={recents}
          serverRows={(serverRecents.data ?? []).filter(r => !droppedRows.includes(r.id))}
          serverLoading={serverRecents.loading}
          signedIn={gate === 'allow'}
          onPick={r => { setText(r.q); submit(r.q) }}
          onRemove={removeRecent}
          onRemoveServer={removeServerRecent}
          onClearAll={() => clearAll.open()}
          onManage={() => router.push(href('/search/history'))}
        />
      ) : mode === 'suggest' ? (
        <Suggest
          term={trimmed}
          tags={sugTags}
          hits={sugHits}
          suggesting={suggesting}
          onSubmit={() => submit()}
          onTag={tag => router.push(href(`/tags/${encodeURIComponent(tag)}`))}
          onHit={pushHit}
        />
      ) : (
        <Results
          tab={tab}
          state={active}
          items={visibleItems}
          cooldown={cooldown}
          query={submitted}
          bottomPad={bottomPad}
          onRetry={() => void runTab(tab, 'first')}
          onEnd={() => void runTab(tab, 'more')}
          onRefresh={() => void runTab(tab, 'first')}
          onHit={onHit}
          onHitMenu={onHitMenu}
          onJumpTab={changeTab}
        />
      )}

      <SoundSheet soundId={soundId} onClose={() => router.setParams({ sound: '' })} />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        actions={[
          { label: 'Copy link', icon: 'copy', onPress: () => rowMenu.payload && void shareLink(rowMenu.payload, true) },
          { label: 'Share', icon: 'share', onPress: () => rowMenu.payload && void shareLink(rowMenu.payload, false) },
          {
            label: 'Hide this result',
            icon: 'eyeOff',
            /* Session-local only: there is no "not interested" endpoint on this
               surface, so this must not pretend to teach the ranker. */
            subtitle: 'Hidden until you search again',
            onPress: () => rowMenu.payload && setHidden(h => [...h, keyOf(rowMenu.payload!)]),
          },
        ]}
      />

      <ConfirmSheet
        visible={clearAll.visible}
        onClose={clearAll.close}
        title="Clear recent searches?"
        message={gate === 'allow'
          ? 'This removes searches from this device and from your account.'
          : 'This removes searches saved on this device.'}
        confirmLabel="Clear"
        destructive
        onConfirm={() => void runClearAll()}
      />

    </Screen>
  )
}

/* ---------------------------------------------------------
   BROWSE
   --------------------------------------------------------- */

function Browse({
  trending, trendingLoading, trendingError, onRetryTrending,
  discover, discoverLoading, usageScopes,
  research, researchLoading, questions, questionsLoading,
  refreshing, onRefresh,
}: {
  trending: TrendingTag[] | null
  trendingLoading: boolean
  trendingError: any
  onRetryTrending: () => void
  discover: TagContentPage | null
  discoverLoading: boolean
  usageScopes: Record<string, number> | null
  research: TrendingTag[] | null
  researchLoading: boolean
  questions: TrendingTag[] | null
  questionsLoading: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const bottomPad = useTabBarClearance()
  const { width } = useWindowDimensions()
  /* 3-up with an 8pt gutter inside the screen padding. */
  const cell = (width - t.layout.screenPadding * 2 - 16) / 3
  const top = trending?.[0]?.tag ?? ''

  /* Re-tap of the Explore tab. The listener lives in the MODE, not the screen:
     browse, recents, suggest and results are four different scrollers and only
     one of them is ever mounted, so each owns its own subscription and the two
     that have nowhere to scroll (recents, suggest — the field is focused and
     the user is mid-query) stay quiet, which is also what keeps the bar's
     haptic honest. Offset in a ref: this must never re-render the shelf. */
  const scrollRef = React.useRef<ScrollView>(null)
  const scrollY = React.useRef(0)
  useTabRetap('explore', () => {
    if (scrollY.current < 8) { onRefresh(); return }
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  })

  /* Non-zero scopes only; the line disappears entirely rather than read
     "0 posts" under a healthy grid. */
  const usageLine = usageScopes
    ? ([['POST', 'posts'], ['QUESTION', 'questions'], ['RESEARCH', 'research'], ['REEL', 'reels']] as const)
      .filter(([k]) => (usageScopes[k] ?? 0) > 0)
      .map(([k, label]) => `${formatCount(usageScopes[k])} ${label}`)
      .join(' · ')
    : ''

  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textMuted} colors={[c.accent]} />
      }
    >
      <RailHeader kicker="Trending" title="Across Hikmah Web" actionLabel="See all" onAction={() => router.push(href('/tags'))} />
      {trendingError && !trending?.length ? (
        <Callout tone="warning" style={{ marginHorizontal: t.layout.screenPadding }} actionLabel="Retry" onAction={onRetryTrending}>
          {errorText(trendingError)}
        </Callout>
      ) : (
        <TrendingTagRail rows={trending} loading={trendingLoading} />
      )}

      {/* The grid is derived from the top trending tag, so with no leaderboard
          there is nothing to derive it from — the section stays away rather
          than rendering an empty promise. */}
      {top ? (
        <>
          <Divider style={{ marginTop: t.space.xxl }} />
          <RailHeader
            kicker="Discover"
            scholarly
            title={`#${top}`}
            subtitle={usageLine || undefined}
            actionLabel="See all"
            onAction={() => router.push(href(`/tags/${encodeURIComponent(top)}`))}
          />
          <View style={[styles.grid, { gap: t.space.sm, paddingHorizontal: t.layout.screenPadding }]}>
            {discoverLoading || !discover ? (
              Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} width={cell} height={cell} radius={t.radius.sm} />
              ))
            ) : discover.items.length ? (
              discover.items.slice(0, 9).map(row => (
                <DiscoverCell key={`${row.contentType}:${row.contentId}`} row={row} size={cell} />
              ))
            ) : (
              <Text variant="footnote" tone="faint" align="ui" style={{ padding: t.layout.screenPadding }}>
                Nothing tagged #{top} yet — be the first to use it.
              </Text>
            )}
          </View>
        </>
      ) : null}

      {/* The per-scope shelves. Each is gated on rows so an empty or failed
          leaderboard leaves no orphan header. */}
      {researchLoading || research?.length ? (
        <>
          <Divider style={{ marginTop: t.space.xxl }} />
          <RailHeader
            kicker="Research"
            scholarly
            title="In Research"
            actionLabel="See all"
            onAction={() => router.push(href({ pathname: '/tags', params: { scope: 'RESEARCH' } }))}
          />
          <ScopeTagRail scope="RESEARCH" rows={research} loading={researchLoading} />
        </>
      ) : null}

      {questionsLoading || questions?.length ? (
        <>
          <Divider style={{ marginTop: t.space.xxl }} />
          <RailHeader
            kicker="Q&A"
            title="Questions being asked"
            actionLabel="See all"
            onAction={() => router.push(href({ pathname: '/tags', params: { scope: 'QUESTION' } }))}
          />
          <ScopeTagRail scope="QUESTION" rows={questions} loading={questionsLoading} />
        </>
      ) : null}

      <Divider style={{ marginTop: t.space.xxl }} />
      <RailHeader kicker="Browse" title="The directory" />
      <View>
        <DirRow icon="people" label="People" onPress={() => router.push(href('/search/people'))} />
        <Divider inset={56} />
        <DirRow icon="channels" label="Channels" onPress={() => router.push(href('/channels'))} />
        <Divider inset={56} />
        {/* Live and Calls have hub screens nothing else links to — same reason
            the two scholarly libraries are listed below. */}
        <DirRow icon="live" label="Live" onPress={() => router.push(href('/live'))} />
        <Divider inset={56} />
        <DirRow icon="phone" label="Calls" onPress={() => router.push(href('/calls'))} />
        <Divider inset={56} />
        <DirRow icon="music" label="Sounds" onPress={() => router.push(href('/sounds'))} />
        <Divider inset={56} />
        <DirRow icon="hash" label="Tags" onPress={() => router.push(href('/tags'))} />
        <Divider inset={56} />
        {/* The two scholarly libraries. They have their own hub screens with
            their own feeds and filters, and search alone never surfaces them —
            without these rows nothing in the app links to either one. */}
        <DirRow icon="research" label="Research" onPress={() => router.push(href('/research'))} />
        <Divider inset={56} />
        <DirRow icon="qna" label="Questions & answers" onPress={() => router.push(href('/qna'))} />
      </View>
    </ScrollView>
  )
}

function DiscoverCell({ row, size }: { row: TagContentPage['items'][number]; size: number }) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const skin = typeSkin(c, row.contentType)
  const target = row.contentType === 'QUESTION' ? `/qna/${row.contentId}`
    : row.contentType === 'RESEARCH' ? `/research/${row.contentId}`
      : `/posts/${row.contentId}`

  return (
    <Touchable
      onPress={() => router.push(href(target))}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={`${TYPE_LABEL[row.contentType] ?? 'Item'}: ${row.titlePreview || 'untitled'}`}
      style={[
        styles.gridCell,
        {
          width: size,
          height: size,
          backgroundColor: c.surfaceSunken,
          borderColor: c.borderFaint,
          borderRadius: t.radius.sm,
          padding: t.space.md,
        },
      ]}
    >
      {/* Tag-feed rows carry NO media url, so this is a typographic tile by
          design rather than a broken <Image> waiting to happen. The disc is
          the same type→skin table every other search surface renders. */}
      <View style={[styles.cellGlyph, { backgroundColor: skin.bg }]}>
        <Icon name={TYPE_ICON[row.contentType] ?? 'file'} size={12} color={skin.fg} filled />
      </View>
      <Text variant="footnote" numberOfLines={3}>
        {row.titlePreview || `Untitled ${(row.contentType || 'item').toLowerCase()}`}
      </Text>
      <Text variant="micro" tone="muted" align="ui">
        {TYPE_LABEL[row.contentType] ?? row.contentType}
      </Text>
    </Touchable>
  )
}

/* Two-level editorial header: a small-caps kicker (gold for the scholarly
   sections) over a title-weight line, with the action baseline-aligned to
   the title. */
function RailHeader({ kicker, title, subtitle, scholarly, actionLabel, onAction }: {
  kicker: string
  title: string
  subtitle?: string
  scholarly?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  const t = useTheme()
  return (
    <View style={[styles.railHeader, { paddingHorizontal: t.layout.screenPadding, paddingTop: t.space.xxl, paddingBottom: t.space.sm }]}>
      <View style={styles.flex}>
        {/* No call-site transform: `caption` uppercases LATIN ONLY inside the
            Text primitive, and its letterSpacing is forced to 0 on Arabic
            script — a manual transform here would mangle both. */}
        <Text variant="caption" tone={scholarly ? 'scholar' : 'muted'} align="ui">
          {kicker}
        </Text>
        <Text variant="title3" align="ui" style={{ marginTop: space.xxs }}>{title}</Text>
        {subtitle ? <Text variant="footnote" tone="muted" align="ui">{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Touchable onPress={onAction} feedback="dim">
          <Text variant="subhead" tone="accent">{actionLabel}</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

function DirRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme()
  return (
    <TouchableRow onPress={onPress} accessibilityLabel={label}>
      <View style={[styles.dirRow, { paddingHorizontal: t.layout.screenPadding }]}>
        <Icon name={icon} size={22} color={t.colors.textSecondary} />
        <Text variant="body" align="ui" style={styles.flex}>{label}</Text>
        <Icon name={t.isRTL ? 'back' : 'forward'} size={16} color={t.colors.textFaint} />
      </View>
    </TouchableRow>
  )
}

/* ---------------------------------------------------------
   RECENTS
   --------------------------------------------------------- */

function Recents({
  recents, serverRows, serverLoading, signedIn,
  onPick, onRemove, onRemoveServer, onClearAll, onManage,
}: {
  recents: Recent[]
  serverRows: ActivityRow[]
  serverLoading: boolean
  signedIn: boolean
  onPick: (r: Recent) => void
  onRemove: (r: Recent) => void
  onRemoveServer: (row: ActivityRow) => void
  onClearAll: () => void
  onManage: () => void
}) {
  const t = useTheme()
  const router = useRouter()
  const bottomPad = useTabBarClearance()

  return (
    <Animated.View style={styles.flex} entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(120))}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        <View style={[styles.recentHead, { paddingHorizontal: t.layout.screenPadding }]}>
          <Text variant="caption" tone="muted" align="ui" style={styles.flex}>Recent</Text>
          <Touchable onPress={onManage} feedback="dim"><Text variant="subhead" tone="accent">Manage</Text></Touchable>
          {recents.length || serverRows.length ? (
            <Touchable onPress={onClearAll} feedback="dim">
              <Text variant="subhead" tone="danger">Clear all</Text>
            </Touchable>
          ) : null}
        </View>

        {recents.map(r => (
          <TouchableRow key={`local:${r.q}`} onPress={() => onPick(r)}>
            <View style={[styles.recentRow, { paddingHorizontal: t.layout.screenPadding }]}>
              <Icon name={r.kind === 'tag' ? 'hash' : 'history'} size={20} color={t.colors.textMuted} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>{r.q}</Text>
              <Touchable onPress={() => onRemove(r)} feedback="dim" accessibilityLabel={`Remove ${r.q}`}>
                <Icon name="close" size={18} color={t.colors.textFaint} />
              </Touchable>
            </View>
          </TouchableRow>
        ))}

        {signedIn ? (
          <>
            <View style={[styles.recentHead, { paddingHorizontal: t.layout.screenPadding }]}>
              <Text variant="caption" tone="muted" align="ui" style={styles.flex}>From your account</Text>
            </View>
            {serverLoading ? (
              <View style={{ gap: space.md, paddingHorizontal: t.layout.screenPadding, paddingVertical: space.sm }}>
                {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} width="62%" height={14} />)}
              </View>
            ) : serverRows.length ? serverRows.map(row => (
              <TouchableRow
                key={row.id}
                onPress={() => row.deepLink && router.push(href(row.deepLink))}
                disabled={!row.deepLink}
              >
                <View style={[styles.recentRow, { paddingHorizontal: t.layout.screenPadding }]}>
                  <Icon name="globe" size={20} color={t.colors.textMuted} />
                  <View style={styles.flex}>
                    {/* Server-rendered copy — shown verbatim, never re-worded. */}
                    <Text variant="callout" numberOfLines={1}>{row.subtitle || row.label}</Text>
                    <Text variant="caption" tone="faint" align="ui">{row.time}</Text>
                  </View>
                  <Touchable onPress={() => onRemoveServer(row)} feedback="dim" accessibilityLabel="Remove">
                    <Icon name="close" size={18} color={t.colors.textFaint} />
                  </Touchable>
                </View>
              </TouchableRow>
            )) : (
              <Text variant="footnote" tone="faint" align="center" style={{ paddingVertical: space.lg }}>
                Nothing saved to your account yet.
              </Text>
            )}
          </>
        ) : null}

        {!recents.length && !serverRows.length && !serverLoading ? (
          <>
            <Text variant="callout" tone="muted" align="center" style={{ paddingVertical: 48 }}>
              Searches you make will show up here.
            </Text>
            {/* The coldest state of the machine, at the moment of highest
                intent — offer the trending rail instead of describing the
                void. Self-fetching; failures render nothing by contract, and
                chips route to the tag page like every other rail. */}
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: t.space.xl, paddingBottom: t.space.sm }}>
              <Text variant="caption" tone="muted" align="ui">Trending</Text>
            </View>
            <TrendingTagRail onPressTag={tag => router.push(href(`/tags/${encodeURIComponent(tag)}`))} />
          </>
        ) : null}
      </ScrollView>
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   SUGGEST
   --------------------------------------------------------- */

function Suggest({
  term, tags, hits, suggesting, onSubmit, onTag, onHit,
}: {
  term: string
  tags: TagSuggestion[]
  hits: SearchHit[]
  suggesting: boolean
  onSubmit: () => void
  onTag: (tag: string) => void
  onHit: (hit: SearchHit) => void
}) {
  const t = useTheme()
  const c = t.colors
  const bottomPad = useTabBarClearance()
  const norm = normalizeTag(term)

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomPad }}
    >
      <TouchableRow onPress={onSubmit} accessibilityLabel={`Search for ${term}`}>
        <View style={[styles.suggestRow, { paddingHorizontal: t.layout.screenPadding, height: 52 }]}>
          <Icon name="search" size={19} color={c.textMuted} />
          <Text variant="body" numberOfLines={1} style={styles.flex}>
            Search for <Text variant="bodyStrong">{term}</Text>
          </Text>
        </View>
      </TouchableRow>

      {norm ? (
        <>
          <Divider inset={t.layout.screenPadding} />
          <TouchableRow onPress={() => onTag(norm)}>
            <View style={[styles.suggestRow, { paddingHorizontal: t.layout.screenPadding, height: 52 }]}>
              <Icon name="hash" size={19} color={c.accent} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>#{norm}</Text>
              <Text variant="caption" tone="faint">Tag</Text>
            </View>
          </TouchableRow>
        </>
      ) : null}

      {tags.length ? (
        <>
          <GroupHead label="Tags" />
          {tags.map(s => (
            <TouchableRow
              key={s.tag}
              onPress={() => onTag(s.tag)}
              accessibilityLabel={`Tag ${s.tag}, ${formatCount(s.usageCount)} uses`}
            >
              <View style={[styles.suggestRow, { paddingHorizontal: t.layout.screenPadding, height: 44 }]}>
                {/* Same 32pt leading slot as the compact SearchResultRow below,
                    so both groups share one left edge. */}
                <View style={[styles.sugDisc, { backgroundColor: c.accentSoft }]}>
                  <Icon name="hash" size={16} color={c.accent} />
                </View>
                {/* The endpoint is a prefix scan, so the completion — not the
                    typed part — is what the eye needs to verify. */}
                {s.tag.startsWith(norm) ? (
                  <Text variant="subhead" numberOfLines={1} style={styles.flex}>
                    {'#'}
                    <Text variant="subhead" tone="muted">{norm}</Text>
                    <Text variant="subhead" weight="700">{s.tag.slice(norm.length)}</Text>
                  </Text>
                ) : (
                  <Text variant="subhead" numberOfLines={1} style={styles.flex}>#{s.tag}</Text>
                )}
                <NumericText variant="caption" tone="faint">{formatCount(s.usageCount)}</NumericText>
              </View>
            </TouchableRow>
          ))}
        </>
      ) : null}

      {hits.length ? (
        <>
          <GroupHead label="Top results" />
          {hits.slice(0, 8).map(hit => (
            <SearchResultRow
              key={`${hit.contentType}:${hit.contentId}`}
              hit={hit}
              variant="compact"
              onPress={() => onHit(hit)}
            />
          ))}
        </>
      ) : null}

      {/* Suggest otherwise just ends — after a fruitless prefix the screen
          would be silent about the next step. */}
      {!suggesting ? (
        <Text variant="footnote" tone="faint" align="center" style={{ paddingVertical: t.space.xl }}>
          Press search for all results
        </Text>
      ) : null}
    </ScrollView>
  )
}

function GroupHead({ label }: { label: string }) {
  const t = useTheme()
  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.lg2, paddingBottom: space.xs2 }}>
      <Text variant="caption" tone="muted" align="ui">{label}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   RESULTS
   --------------------------------------------------------- */

function Results({
  tab, state, items, cooldown, query, bottomPad,
  onRetry, onEnd, onRefresh, onHit, onHitMenu, onJumpTab,
}: {
  tab: TabKey
  state: TabState
  items: SearchHit[]
  cooldown: number
  query: string
  /** Clearance past the translucent tab bar, from useTabBarClearance(). Passed
   *  in rather than derived here so this panel and the screen that hosts it
   *  cannot disagree — before the hook they did, by 16pt. */
  bottomPad: number
  onRetry: () => void
  onEnd: () => void
  onRefresh: () => void
  onHit: (hit: SearchHit) => void
  onHitMenu: (hit: SearchHit) => void
  onJumpTab: (k: TabKey) => void
}) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()

  /* The tag partition is live the instant content is written while the ES
     index warms on its own schedule — so for a single-token, tag-shaped
     query the tag feed is the one guaranteed-live escape hatch. */
  const emptyNorm = normalizeTag(query)
  const offerTagFeed = !!emptyNorm && !/\s/.test(query) && (query.startsWith('#') || tab === 'ALL')

  const reducedMotion = t.prefs.reducedMotion
  const fadeMs = t.ms(200)
  const showType = tab === 'ALL'
  /* useCallback with identity-stable deps only: FlashList's ViewHolder memo
     compares renderItem by reference, so an inline arrow here re-invokes it
     for every mounted cell on every render of this screen. */
  const renderItem = React.useCallback(({ item }: { item: SearchHit }) => (
    /* "Hide this result" removal: FlashList 2.0.2 has no itemLayoutAnimation
       prop, so the row fades itself out on unmount instead — worst case (a
       recycled holder never unmounting) it degrades to the previous hard cut,
       never to jank. */
    <Animated.View exiting={reducedMotion ? undefined : FadeOut.duration(fadeMs)}>
      <SearchResultRow
        hit={item}
        showType={showType}
        onPress={() => onHit(item)}
        onLongPress={canOpen(item) ? () => onHitMenu(item) : undefined}
      />
    </Animated.View>
  ), [reducedMotion, fadeMs, showType, onHit, onHitMenu])

  const listPad = React.useMemo(() => ({ paddingBottom: bottomPad }), [bottomPad])

  /* The results half of the Explore re-tap — see Browse. Declared above the
     two early returns, because a skeleton or an error state is still the
     mounted mode and must not silently drop the subscription. */
  const listRef = React.useRef<FlashListRef<SearchHit>>(null)
  const scrollY = React.useRef(0)
  /* The list is keyed by `tab` below, so switching type tabs remounts it at
     offset 0 — without this the ref would still hold the OLD tab's offset and
     the first re-tap on the new one would scroll to a top it is already at. */
  React.useEffect(() => { scrollY.current = 0 }, [tab])
  useTabRetap('explore', () => {
    if (scrollY.current < 8) { onRefresh(); return }
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  })

  if (state.loading && !items.length) return <SearchResultSkeletonList />
  if (state.error && !items.length) return <ErrorState error={state.error} onRetry={onRetry} />

  return (
    /* Keyed by tab: switching type tabs crossfades between differently-shaped
       lists instead of hard-cutting. Cursor state lives in the `tabs` record,
       so the remount costs nothing. */
    <Animated.View
      key={tab}
      style={styles.flex}
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(160))}
    >
    <FlashList
      ref={listRef}
      data={items}
      keyExtractor={keyOf}
      getItemType={getItemType}
      renderItem={renderItem}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={Keyboard.dismiss}
      onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y }}
      scrollEventThrottle={16}
      onEndReachedThreshold={0.6}
      onEndReached={onEnd}
      contentContainerStyle={listPad}
      refreshControl={
        <RefreshControl refreshing={state.loading} onRefresh={onRefresh} tintColor={c.textMuted} colors={[c.accent]} />
      }
      ListHeaderComponent={
        <>
          <SearchDegradedBanner visible={state.degraded} onRetry={onRetry} />
          {cooldown > 0 ? (
            <Callout tone="warning" icon="hourglass" style={{ marginHorizontal: t.layout.screenPadding, marginTop: space.md }}>
              {`Too many searches. Try again in ${cooldown}s.`}
            </Callout>
          ) : null}
        </>
      }
      ItemSeparatorComponent={Sep}
      ListEmptyComponent={
        /* Degraded suppresses this entirely: an empty list with the index down
           is a failure, not an absence. */
        state.degraded || state.loading ? null : (
          <View>
            <EmptyState
              icon="search"
              title={`No results for “${query}”`}
              message="Try a different spelling, or search another type."
              actionLabel={offerTagFeed ? `Open #${emptyNorm}` : undefined}
              onAction={offerTagFeed ? () => router.push(href(`/tags/${encodeURIComponent(emptyNorm)}`)) : undefined}
            />
            <Text variant="caption" tone="muted" align="center" style={{ paddingTop: t.space.lg, paddingBottom: t.space.sm }}>
              Try another type
            </Text>
            <View style={styles.typeChips}>
              {SEARCH_TABS.filter(k => k !== 'ALL' && k !== tab).map(k => (
                <Touchable
                  key={k}
                  onPress={() => onJumpTab(k)}
                  feedback="scale"
                  haptic="select"
                  accessibilityLabel={`Search ${TAB_LABEL[k]} instead`}
                  style={[styles.typeChip, { backgroundColor: typeSkin(c, k).bg }]}
                >
                  <Text variant="footnote" weight="600" color={typeSkin(c, k).fg}>{TAB_LABEL[k]}</Text>
                </Touchable>
              ))}
            </View>
          </View>
        )
      }
      ListFooterComponent={
        items.length ? (
          <ListFooter
            loading={state.loadingMore}
            error={state.items.length ? state.error : null}
            onRetry={onRetry}
            done={!state.nextCursor}
            doneLabel="End of results"
          />
        ) : null
      }
    />
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   The 2pt indeterminate hairline under the header. It is the
   only "a request is happening" signal in SUGGEST, where the
   previous list deliberately stays on screen.
   --------------------------------------------------------- */

function ProgressHairline({ active }: { active: boolean }) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const x = useSharedValue(-0.4)

  React.useEffect(() => {
    if (!active || t.prefs.reducedMotion) { cancelAnimation(x); x.value = -0.4; return }
    x.value = -0.4
    x.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, false)
    return () => cancelAnimation(x)
  }, [active, t.prefs.reducedMotion, x])

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * width }] }))

  /* Decorative: the busy state is announced on the search field itself. */
  const hidden = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  }

  if (!active) return <View {...hidden} style={styles.progressTrack} />
  if (t.prefs.reducedMotion) {
    return <View {...hidden} style={[styles.progressTrack, { backgroundColor: t.colors.accentSoft }]} />
  }
  return (
    <View {...hidden} style={[styles.progressTrack, { overflow: 'hidden' }]}>
      <Animated.View style={[styles.progressBar, { width: width * 0.4, backgroundColor: t.colors.accent }, style]} />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingEnd: space.xs2 },
  cancel: { paddingVertical: space.sm, paddingHorizontal: space.xxs },
  progressTrack: { height: 2 },
  progressBar: { height: 2, borderRadius: 2 },

  /* flex-end so a See-all action baseline-aligns to the title line, not the
     kicker. Vertical padding is inline (t.space tokens). */
  railHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'space-between' },
  cellGlyph: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 56 },

  /* 20pt between Manage and Clear all — two adjacent links, one of them
     destructive, need more than list-gap separation. */
  recentHead: { flexDirection: 'row', alignItems: 'center', gap: space.xl, height: 40 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 48 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  /* The 32pt leading slot compact SearchResultRow uses — one shared left edge
     across the TAGS and TOP RESULTS groups. */
  sugDisc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  typeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', paddingHorizontal: space.xxl },
  /* Chips, not pills (DON'T #9) — setback 8/3. */
  typeChip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    height: 32,
    paddingHorizontal: space.md2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
