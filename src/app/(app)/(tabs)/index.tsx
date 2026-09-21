/* =========================================================
   Home — the ranked feed.

   One request paints the whole screen (`GET /feed/home`:
   items + liveNow + an authoritative nextCursor), and three
   rules from FEED_API shape everything below:

   1. Render `items` IN THE ORDER RECEIVED. `rankScore` is
      telemetry; re-sorting on it fights the diversity re-ranker
      and breaks the cursor.
   2. `nextCursor` is authoritative and `null` means the end.
      Ranked order is not chronological, so it can never be
      derived from the last row.
   3. liveNow, channel digests and explore injections are
      FIRST-PAGE ONLY. A cursor page with none of them is
      normal, not a degraded read.

   The FEED_NEW_POST hint can only ever produce the pill: a
   ranked feed cannot blind-prepend, because where a post
   belongs is a server decision.

   THREE TABS, mirroring the web's FeedPage:

     For you   the ranked pipeline (server default);
     Latest    `ranked=false` — the same endpoint, chronological;
     Scholars  not a feed mode at all: a client-side aggregation
               of globally sourced scholar content (all research —
               publishing is role-gated — plus scholar-authored
               questions) merged with scholar posts already in the
               loaded feed. The home feed is social-graph-first, so
               filtering it alone would miss nearly every scholar
               you don't follow.

   The web's right-hand rail (research desk, open questions,
   trending tags) has no column to live in on a phone, so those
   surfaces ride IN the timeline as discovery bands — which also
   means an account with a quiet follow graph still meets
   research, Q&A and live content on day one.
   ========================================================= */
import { api, errorText, isTransient } from '@/api'
import {
    FeedFolio, QnaBand, ResearchRail, TrendingBand,
    type OpenQuestionItem, type ResearchRailItem, type TrendTagItem,
} from '@/components/feed/DiscoveryBands'
import { ComposerRow } from '@/components/feed/ComposerRow'
import { isReelPost, openReelIn } from '@/components/reels/openReel'
import { FeedCard, type FeedCardProps } from '@/components/feed/FeedCard'
import { FEED_GAP, feedPlate } from '@/components/feed/plate'
import { takeCreatedPost, takeEditedPost } from '@/components/feed/feedInbox'
import { usePostTombstones } from '@/components/feed/postTombstones'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { LiveRail } from '@/components/feed/LiveRail'
import { NewPostsPill } from '@/components/feed/NewPostsPill'
import { warmTray } from '@/components/stories/trayStore'
import { LiveFeedCard } from '@/components/feed/LiveFeedCard'
import { takeWarmHomePage } from '@/components/feed/feedWarm'
import { PymkStrip } from '@/components/feed/PymkStrip'
import type { FeedAuthor, FeedItem, FeedRow, LiveStreamView, PostView, SuggestionView } from '@/components/feed/types'
import { useFeedTracking, useIsActiveVideo } from '@/components/feed/useFeedTracking'
import { ComposeFab } from '@/components/nav/ComposeFab'
import { useTabRetap } from '@/components/nav/tabEvents'
import { PostMenuSheet, type PostMenuTarget } from '@/components/post/PostMenuSheet'
import { useEngagement } from '@/components/post/useEngagement'
import { StoryRail } from '@/components/stories/StoryRail'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useChatEvents, useNotificationEvents, useNotificationUnread, useReconcile } from '@/context/RealtimeContext'
import { useAfterInteractions } from '@/hooks/useAfterInteractions'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTabBarClearance } from '@/hooks/useTabBarClearance'
import { markPymkShown, pymkDue } from '@/lib/pymkTimer'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
    EmptyState, ErrorState, Header, ListFooter, Screen, SegmentedControl, Wordmark, fireHaptic, toast,
} from '@/ui'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useFocusEffect, useRouter } from 'expo-router'
import React from 'react'
import { AppState, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
    useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const PAGE_SIZE = 20
const LIVE_POLL_MS = 60_000
/* One delayed retry for a 503, and one only: the datastore-unavailable family
   is transient by contract, and a loop turns one outage into two. */
const TRANSIENT_RETRY_MS = 2500
/* The segmented row the header carries under the wordmark:
   2 top + 40 control (34 cell + 2×3 track padding) + 10 bottom. */
const SEG_ROW_H = 52

type Mode = 'ranked' | 'latest'
type FeedTab = 'foryou' | 'latest' | 'scholars'

/* Where the discovery bands sit (0-based item index each lands AFTER).
   Research leads — it is the app's identity — then people, questions,
   trending. A short page appends whatever never reached its slot, so a
   quiet follow graph still gets the full tour. */
const RESEARCH_SLOT = 1
/* The mid-scroll live reminder — between the research shelf and PYMK. */
const LIVE_CARD_SLOT = 3
const QNA_SLOT = 6
const TREND_SLOT = 9

/* A "scholar" author = a verified contributor: SCHOLAR/RESEARCHER role, or
   the verified flag set — the web's isScholarAuthor, verbatim. */
const isScholarAuthor = (a?: FeedAuthor | null) =>
  !!a && (a.role === 'SCHOLAR' || a.role === 'RESEARCHER' || a.verified)
const tsOf = (x: any) => (x?.createdAt ? new Date(x.createdAt).getTime() : 0)

/* `api.posts.home` is JavaScript, and TypeScript infers its parameter shape
   from the `= {}` default — which only surfaces the keys that carry defaults.
   Widening here keeps the cast in one place instead of at every call. */
const homeArgs = (a: { cursor?: string; pageSize: number; ranked?: boolean; signal?: AbortSignal }) => a as any

/* FlashList's imperative handle exposes getScrollableNode(), which is how
   reanimated finds the real scroll view and attaches the worklet handler
   natively — FlashList's own (JS) virtualization handler keeps working
   untouched beside it. The cast is only there because createAnimatedComponent
   cannot carry the generic through. */
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList as React.ComponentType<any>) as unknown as typeof FlashList

/* Kind-qualified: the Scholars tab merges three entity families whose ids
   are allowed to collide across types (the web dedupes on kind:id for the
   same reason). */
const keyExtractor = (item: FeedRow) => `${item.kind ?? 'POST'}:${item.id}`
const getItemType = (item: FeedRow) => item.kind ?? 'POST'

/* The list header, module-scope for a stable identity: a fresh component per
   render would be a new ViewHolder identity and re-render the whole story
   tray (avatars, seal rings) on every unrelated screen render.

   The order is the argument: the dateline says what day it is, the composer
   says what YOU can do, the tray says who has posted in the last day — and
   only then does somebody else's post begin. A timeline that opens on a
   stranger's photograph reads as a magazine; this reads as a place you are
   a member of. */
function FeedListHeader() {
  const t = useTheme()
  const c = t.colors
  return (
    <>
      <FeedFolio />
      <ComposerRow />
      {/* The tray takes the plate too — a bare rail on the clay ground under
          a column of plates reads as a rail that failed to load its card. */}
      <View style={[feedPlate, styles.tray, { backgroundColor: c.surface, borderColor: c.separator }]}>
        <StoryRail />
      </View>
    </>
  )
}

export default function HomeScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  /* The narrow badges context: this screen needs one counter, and the shell
     surface would re-render the whole feed on every presence/typing frame. */
  /* The notification counter ALONE — the shared unread object used to drag
     this whole screen through every counted chat message. */
  const notificationUnread = useNotificationUnread()

  const listRef = React.useRef<FlashListRef<FeedRow>>(null)
  const [tab, setTab] = React.useState<FeedTab>('foryou')
  /* Held as its OWN state rather than derived from `tab`: Scholars is not a
     feed mode — it re-reads the already-loaded feed — and deriving the wire
     flag from the tab would make a hop through Scholars silently refetch the
     timeline in the other mode and back again (the web holds these apart for
     the same reason). */
  const [mode, setMode] = React.useState<Mode>('ranked')
  const [liveNow, setLiveNow] = React.useState<LiveStreamView[]>([])
  const [suggestions, setSuggestions] = React.useState<SuggestionView[]>([])
  const [followed, setFollowed] = React.useState<Set<string>>(() => new Set())
  const [newPosts, setNewPosts] = React.useState(0)
  const [muted, setMuted] = React.useState(true)
  /* State, not a ref: the target is READ in JSX (PostMenuSheet's `post`), and
     a render-time ref read bailed the compiler out of the whole screen. The
     target survives close so the sheet has content through its exit slide. */
  const [menu, setMenu] = React.useState<{ open: boolean; target: PostMenuTarget | null }>({ open: false, target: null })

  /* The discovery surfaces — the web rail's data, banded into the list. */
  const [openQuestions, setOpenQuestions] = React.useState<OpenQuestionItem[]>([])
  const [researchShelf, setResearchShelf] = React.useState<ResearchRailItem[]>([])
  const [trends, setTrends] = React.useState<TrendTagItem[]>([])

  /* Scholars aggregation: research + scholar Q&A, loaded lazily the first
     time the tab opens (null = not loaded yet); merged with scholar posts
     from the home feed at render time. */
  const [scholarExtra, setScholarExtra] = React.useState<FeedItem[] | null>(null)
  const scholarBusy = React.useRef(false)

  /* Scroll state lives entirely on the UI thread — nothing here may setState,
     because a re-render mid-gesture is when a dropped frame shows most.
     `atTop` is only READ from JS handlers (tab retap, feed-new-post), and a
     shared-value read is synchronous, so no state mirror is needed. */
  const scrollY = useSharedValue(0)
  const lastY = useSharedValue(0)
  const fabShown = useSharedValue(1)
  const fabTarget = useSharedValue(1)
  const atTop = () => scrollY.value < 8

  /* pymkDue() is read ONCE and frozen — a lazy useState initializer does
     exactly that, and unlike a render-time ref read it doesn't bail the
     compiler out of this whole screen. Re-evaluating per render would let the
     strip vanish under the reader's thumb as the cooldown ticked past. */
  const [pymkAllowed] = React.useState(pymkDue)
  const shownRef = React.useRef(false)

  const enabled = gate === 'allow'
  const onFeedTab = tab !== 'scholars'

  /* The transition gate. The TIMELINE is never behind it — `feed` fires on
     mount as it always did, because a home feed that is a skeleton for an
     extra quarter second is not smoother, it is slower. What waits are the
     four SECOND-TIER reads that used to land in the middle of the slide:
     the live-rail top-up, the three discovery-band leaderboards, and PYMK.
     Under reduced motion there is no slide and this is `true` on frame one. */
  const ready = useAfterInteractions()

  /* The story tray, in PARALLEL with feed page 1: the rail is FlashList
     header content, so its own mount (and the refresh the hook fires there)
     otherwise waits for the feed's first page — the rings popped in a full
     round-trip late and shoved the first post down. */
  React.useEffect(() => { warmTray(user?.id) }, [user?.id])

  /* The ranked pipeline is stateless and deterministic (feed/algorithm.md):
     the same content window scores the same way on every read, so a
     pull-to-refresh with nothing new returns the identical page — which reads
     as "refresh does nothing". Owner's call: when a FIRST page comes back as
     exactly the set already on screen, rotate it so the reader meets it in a
     new order. Cursor pages are never touched (nextCursor stays authoritative)
     and a page with any new content renders in server order, so the ranked
     contract only bends on a provably-stale repeat. */
  const lastFirstPageSig = React.useRef('')

  const feed = usePaged<FeedItem>(
    ({ cursor, pageSize, signal }) => {
      const wire = () => api.posts.home(homeArgs({
        cursor: cursor ?? undefined,
        pageSize,
        /* Only put `ranked` on the wire when we mean false — the default has
           to stay the server's. */
        ranked: mode === 'latest' ? false : undefined,
        /* usePaged aborts this on refresh/unmount — dropping it made the
           abort a no-op on the wire and pinned skeletons behind a stalled
           request. */
        signal,
      }))
      /* The splash may already have this exact page in flight (feedWarm,
         kicked during the brand hold). Ranked FIRST pages only — "Latest"
         and every later page always go to the wire, and the cache is spent
         on the one consult. */
      const read: Promise<any> = !cursor && mode !== 'latest'
        ? takeWarmHomePage().then(warm => warm ?? wire())
        : wire()
      return read.then((res: any) => {
      let pageItems = res.items as FeedItem[]
      if (!cursor && pageItems.length > 2) {
        const sig = pageItems.map(i => `${(i as any).kind ?? 'POST'}:${i.id}`).join(',')
        if (sig === lastFirstPageSig.current) {
          const off = 1 + Math.floor(Math.random() * (pageItems.length - 1))
          pageItems = [...pageItems.slice(off), ...pageItems.slice(0, off)]
        } else {
          lastFirstPageSig.current = sig
        }
      }
      /* The rail rows ride the feed's first page — mirrored here, in the
         response handler, rather than via a set-state-in-effect on `extra`
         that double-rendered the screen per page and bailed the compiler. */
      if (!cursor && Array.isArray(res.liveNow)) setLiveNow(res.liveNow)
      return {
        items: pageItems,
        nextCursor: res.nextCursor,
        extra: { liveNow: res.liveNow, ranked: res.ranked },
      }
      })
    },
    { mode: 'cursor', pageSize: PAGE_SIZE, enabled, deps: [mode, enabled] },
  )

  const { items, extra, loading, refreshing, loadingMore, done, error } = feed

  /* ---------- the live rail ---------- */

  /* The rail is REFETCHED, never folded locally. /feed/live-now is not "the
     streams I follow": it is followed hosts first, topped up to ten with the
     most-watched public streams, blocked hosts removed. stream.started fans
     out only to a host's followers, so prepending the event's own row would
     break that ordering, and removing one would leave the vacated top-up slot
     empty. The doc's instruction is literally "refresh the rail". */
  const pullLive = React.useCallback(() => {
    api.posts.liveNow()
      .then((rows: any) => {
        const next: LiveStreamView[] = rows || []
        /* Key-equal payloads keep the old identity — this array feeds a
           renderItem dep, and most refreshes answer "same streams". */
        setLiveNow(prev => (
          prev.map(s => String(s.id)).join() === next.map(s => String(s.id)).join() ? prev : next
        ))
      })
      .catch(() => {})
  }, [])

  /* The poll is now the FALLBACK, not the mechanism: it covers the top-up
     slots, whose hosts the viewer does not follow and whose start/end
     therefore never reaches this device. */
  useFocusEffect(React.useCallback(() => {
    if (!enabled) return
    /* Held until the screen has arrived. The rail is NOT blank meanwhile: the
       feed's own first page carries `liveNow` (extra), and this refetch is only
       the top-up read described above — so the deferral costs nothing visible
       and buys a request that no longer competes with the slide. Re-runs when
       `ready` flips, which is what arms the 60s poll. */
    if (!ready) return
    let alive = true
    /* Focus is not foreground: pressing home leaves this screen focused, and
       Home is the tab most likely to be on top when the app goes away. Without
       the AppState check the rail keeps waking the radio every 60s, on a
       metered connection, for something nobody can see. */
    const pull = () => { if (alive && AppState.currentState === 'active') pullLive() }
    pull()
    const id = setInterval(pull, LIVE_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [enabled, ready, pullLive]))

  /* A followed host going live should light the rail now, not up to a minute
     later. This rides the chat stream that RealtimeContext already holds open
     — no new emitter, so the backend's five-per-user LRU cap is untouched.
     Debounced because one host starting fans out several frames. */
  const liveDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (liveDebounce.current) clearTimeout(liveDebounce.current) }, [])
  useChatEvents(evt => {
    const type = String((evt as any)?.type || '')
    if (type !== 'stream.started' && type !== 'stream.ended') return
    if (liveDebounce.current) return
    liveDebounce.current = setTimeout(() => { liveDebounce.current = null; pullLive() }, 1000)
  }, enabled)

  /* ---------- discovery surfaces ---------- */

  /* Every surface fail-opens to []: a band is a garnish, and a broken
     leaderboard must never take the feed with it. Research and questions are
     SAMPLED from a wider read so each pull-to-refresh deals a different hand
     — the bands are discovery, and discovery that never changes stops being
     looked at. Trending stays in rank order (it IS an ordering). */
  const pullDiscovery = React.useCallback(() => {
    const deal = <T,>(rows: T[], n: number): T[] => {
      const pool = [...rows]
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      return pool.slice(0, n)
    }
    api.qna.feed({ limit: 20 })
      .then((r: any) => {
        const open = (r?.items || []).filter((q: any) => q.status === 'OPEN')
        setOpenQuestions(deal(open, 3))
      })
      .catch(() => {})
    api.research.feed({ size: 16 })
      .then((rows: any) => setResearchShelf(deal(rows || [], 8)))
      .catch(() => {})
    api.tags.trending({ scope: 'ALL', limit: 10 })
      .then((rows: any) => {
        /* Dedupe by tag: the endpoint can return the same tag twice (seen on
           live data), and the chip key needs one row per tag. */
        const seen = new Set<string>()
        setTrends((rows || []).filter((x: any) => x.tag && !seen.has(x.tag) && seen.add(x.tag)).slice(0, 8))
      })
      .catch(() => {})
  }, [])

  /* Three leaderboard reads for three garnishes that sit at item slots 1, 6
     and 9 — none of them is the feed, and none of them can even be BANDED into
     the list until the first page lands. Firing them during the slide bought
     nothing and cost three parses on the JS thread mid-transition.
     Pull-to-refresh calls pullDiscovery directly and is untouched. */
  React.useEffect(() => {
    if (enabled && ready) pullDiscovery()
  }, [enabled, ready, pullDiscovery])

  /* ---------- the Scholars aggregation ---------- */

  const loadScholars = React.useCallback(() => {
    if (scholarBusy.current) return
    scholarBusy.current = true
    Promise.allSettled([api.research.feed({ size: 20 }), api.qna.feed({ limit: 30 })])
      .then(([r, q]) => {
        const research = (r.status === 'fulfilled' ? ((r.value as any) || []) : [])
          /* researchFrom's cover is a CSS shorthand and carries no hasCover;
             the feed card decides image-vs-plate on that flag. */
          .map((row: any) => ({ ...row, hasCover: row.hasCover ?? /url\("/.test(String(row.cover || '')) }))
        const questions = (q.status === 'fulfilled' ? (((q.value as any)?.items) || []) : [])
          .filter((item: any) => isScholarAuthor(item._author))
        setScholarExtra([...research, ...questions] as FeedItem[])
      })
      .finally(() => { scholarBusy.current = false })
  }, [])

  React.useEffect(() => {
    if (tab === 'scholars' && scholarExtra == null) loadScholars()
  }, [tab, scholarExtra, loadScholars])

  const pickTab = React.useCallback((k: FeedTab) => {
    setTab(k)
    if (k === 'foryou') setMode('ranked')
    else if (k === 'latest') setMode('latest')
  }, [])

  /* ---------- people you may know ---------- */

  /* The strip lands at item 4 at the earliest and needs three suggestions
     before it renders at all — it has never been on screen during the slide,
     so there was never a reason for its read to be. */
  React.useEffect(() => {
    if (!enabled || !pymkAllowed || !ready) return
    let alive = true
    api.posts.suggestionsDetailed({ limit: 10 })
      .then((rows: any) => { if (alive) setSuggestions(rows || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [enabled, pymkAllowed, ready])

  const showPymk = pymkAllowed && suggestions.length >= 3

  React.useEffect(() => {
    /* The clock only starts when the strip ACTUALLY renders — burning the
       window on a load that returned nobody would cost the user hours. */
    if (showPymk && !shownRef.current) { shownRef.current = true; markPymkShown() }
  }, [showPymk])

  /* ---------- realtime ---------- */

  useNotificationEvents(e => {
    if (e.type !== 'feed-new-post') return
    /* The composer already inserted our own post; a hint about it would show a
       pill that refreshes to exactly what is already on screen. */
    if (user?.id && String((e as any).authorId) === String(user.id)) return
    /* On the Scholars tab the hint is still counted (a new post is a new
       post) but never auto-refreshes — that tab is not a feed mode. */
    if (tab !== 'scholars' && atTop()) { void feed.refresh(); return }
    setNewPosts(n => n + 1)
  }, enabled)

  /* Every (re)connect means "you may have missed hints" — reconcile via REST. */
  useReconcile(() => { void feed.refresh() }, enabled)

  /* Keyed on `feed.reload` (stable), not `feed`: under realtime churn a
     fresh feed identity per render would clear and re-arm this timeout
     forever, pushing the retry back indefinitely. */
  React.useEffect(() => {
    if (!error || items.length || !isTransient(error)) return
    const id = setTimeout(() => { void feed.reload() }, TRANSIENT_RETRY_MS)
    return () => clearTimeout(id)
  }, [error, items.length, feed.reload])

  useFocusEffect(React.useCallback(() => {
    const fresh = takeCreatedPost()
    if (fresh) {
      feed.prepend({ ...fresh, kind: 'POST' } as FeedItem)
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    const updated = takeEditedPost()
    if (updated) feed.patch(String(updated.id), prev => ({ ...prev, ...updated } as FeedItem))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []))

  /* The feed's own PostMenuSheet drops the row through `onDeleted`. This is
     the other direction: a post deleted on the DETAIL screen this feed pushed
     to — or in the reel pager, or from a profile grid — used to stay in the
     feed until the next refresh, because the 204 reached only the screen that
     fired it. */
  usePostTombstones(feed.remove)

  /* ---------- interactions ---------- */

  const patch = React.useCallback((id: string, fn: (p: any) => any) => {
    feed.patch(id, prev => fn(prev) as FeedItem)
  }, [feed.patch])

  const { toggleLike, toggleSave } = useEngagement<any>(patch)
  const { viewabilityConfig, onViewableItemsChanged } = useFeedTracking()

  /* The masthead is a control, not a label: tapping the wordmark does what
     re-tapping the tab does — top of the feed, and a refresh if you are
     already there. One behaviour, two ways in. */
  const backToTop = React.useCallback(() => {
    if (atTop()) { void feed.refresh(); return }
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [atTop, feed])

  useTabRetap('index', backToTop)

  const showNew = () => {
    setNewPosts(0)
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
    void feed.refresh()
  }

  const follow = React.useCallback(async (authorId: string) => {
    const already = followed.has(String(authorId))
    setFollowed(prev => {
      const next = new Set(prev)
      already ? next.delete(String(authorId)) : next.add(String(authorId))
      return next
    })
    try {
      if (already) await api.users.unfollow(authorId)
      else await api.users.follow(authorId)
    } catch (e) {
      setFollowed(prev => {
        const next = new Set(prev)
        already ? next.add(String(authorId)) : next.delete(String(authorId))
        return next
      })
      /* The button springs back — say why, like every other follow path. */
      toast.error(errorText(e))
    }
  }, [followed])

  const openItem = React.useCallback((item: FeedItem) => {
    switch (item.kind) {
      case 'RESEARCH': router.push(`/research/${item.id}`); break
      case 'QUESTION': router.push(`/qna/${item.id}`); break
      case 'CHANNEL_POST':
        if (!item.channel?.id) return
        /* messageId stays a STRING — it is a snowflake past MAX_SAFE_INTEGER. */
        router.push({
          pathname: '/channels/[id]',
          params: { id: item.channel.id, messageId: String(item.channelPostId ?? '') },
        })
        break
      default:
        /* Reels share the generic POST row shape in the home feed, but their
           immersive player, continuation feed and three-player pool live at
           /reels/[id] rather than the ordinary post detail route. */
        if (isReelPost(item)) openReelIn(router, [item], item, { src: 'for-you' })
        else router.push(`/post/${item.id}`)
    }
  }, [router])

  const dismissSuggestion = React.useCallback(async (s: SuggestionView) => {
    setSuggestions(prev => prev.filter(x => x.candidateId !== s.candidateId))
    try { await api.posts.dismissSuggestion(s.candidateId) } catch { /* permanent either way */ }
  }, [])

  /* ---------- rows ---------- */

  const rows = React.useMemo<FeedRow[]>(() => {
    const out: FeedRow[] = []
    if (liveNow.length) out.push({ kind: 'LIVE_RAIL', id: '__live' })

    if (tab === 'scholars') {
      /* The web's aggregation, verbatim: globally sourced scholar content +
         scholar posts already in the loaded feed, de-duped on kind:id (ids
         can collide across entity types), newest first. Sorting is legal
         here — this list is client-assembled, not the server-ranked page. */
      const scholarPosts = items.filter(p => (p.kind === 'POST' || !p.kind) && isScholarAuthor((p as any)._author))
      const seen = new Set<string>()
      const merged = [...(scholarExtra ?? []), ...scholarPosts]
        .filter(x => {
          if (!x || (x as any).id == null) return false
          const k = `${(x as any).kind || 'POST'}:${(x as any).id}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .sort((a, b) => tsOf(b) - tsOf(a))
      if (merged.length) out.push(...merged)
      else if (scholarExtra != null) out.push({ kind: 'EMPTY_NOTE', id: '__empty' })
      return out
    }

    /* The feed tabs: server order untouched, discovery banded between rows.
       Bands whose slot the page never reaches are appended — a two-post feed
       still shows the research desk and the open questions. */
    const bands: FeedRow[] = []
    if (researchShelf.length) bands.push({ kind: 'RESEARCH_RAIL', id: '__research' })
    /* The live card re-surfaces liveNow[0] (followed-first by contract) for
       the reader who scrolled past the rail. */
    if (liveNow.length) bands.push({ kind: 'LIVE_CARD', id: '__livecard' })
    if (openQuestions.length) bands.push({ kind: 'QNA_BAND', id: '__qna' })
    if (trends.length) bands.push({ kind: 'TRENDING', id: '__trending' })
    const slotOf = (row: FeedRow) =>
      row.kind === 'RESEARCH_RAIL' ? RESEARCH_SLOT
        : row.kind === 'LIVE_CARD' ? LIVE_CARD_SLOT
        : row.kind === 'QNA_BAND' ? QNA_SLOT
        : TREND_SLOT
    /* The shift-on-slot walk below needs ascending slots. */
    bands.sort((a, b) => slotOf(a) - slotOf(b))

    if (!items.length) {
      out.push({ kind: 'EMPTY_NOTE', id: '__empty' }, ...bands)
      return out
    }

    const pymkAt = Math.min(4, items.length - 1)
    items.forEach((item, i) => {
      out.push(item)
      if (showPymk && i === pymkAt) out.push({ kind: 'PYMK', id: '__pymk' })
      while (bands.length && slotOf(bands[0]) === i) out.push(bands.shift() as FeedRow)
    })
    out.push(...bands)
    return out
  }, [tab, items, liveNow.length, showPymk, scholarExtra, researchShelf.length, openQuestions.length, trends.length])

  const headerH = insets.top + t.layout.headerHeight + SEG_ROW_H
  /* Memoized: a fresh style object per render makes FlashList re-measure its
     content container on renders that moved nothing.

     The bottom was `insets.bottom + 60`, which is not the tab bar. TabBar
     renders at `tabBarHeight + max(insets.bottom, 8)` — 98pt with a home
     indicator, 72pt without — so the last card sat 4pt under the bar on an
     iPhone 15 and 12pt under it on a phone with no indicator. Derived now
     (hooks/useTabBarClearance), from the same two tokens the bar uses. */
  const bottomPad = useTabBarClearance()
  const listPad = React.useMemo(
    () => ({ paddingTop: headerH, paddingBottom: bottomPad }),
    [headerH, bottomPad],
  )
  const hairline = useAnimatedStyle(() => ({ opacity: Math.min(1, scrollY.value / 24) }))

  const reducedMotion = t.prefs.reducedMotion
  const spring = t.motion.spring
  const onScroll = useAnimatedScrollHandler({
    onScroll: e => {
      const y = e.contentOffset.y
      /* Tuck the create button away while the reader is moving DOWN the feed,
         and bring it back the moment they reverse or stop near the top. The
         threshold keeps a jittery finger from flickering it. The whole thing
         runs as a worklet: visibility is a shared value the FAB consumes
         directly, so a scroll frame never schedules React work. */
      const dy = y - lastY.value
      if (Math.abs(dy) > 6) {
        const next = dy < 0 || y < 40 ? 1 : 0
        if (fabTarget.value !== next) {
          fabTarget.value = next
          fabShown.value = reducedMotion ? next : withSpring(next, spring)
        }
        lastY.value = y
      }
      scrollY.value = y
    },
  }, [reducedMotion, spring])

  /* ---------- row plumbing ----------
     Every handler handed to a row is identity-stable (useEvent), and every
     per-row prop is a scalar — that is what lets FeedCard's React.memo skip
     the rows a render did not touch. */

  const onFollow = useEvent((authorId: string) => { void follow(authorId) })
  const onLike = useEvent((p: PostView) => { void toggleLike(p) })
  const onSave = useEvent((p: PostView) => { void toggleSave(p) })
  const onSaveLongPress = useEvent((p: PostView) => router.push(`/post/${p.id}/save`))
  const onShare = useEvent((p: PostView) => router.push(`/post/${p.id}/share`))
  const onComment = useEvent((p: PostView) => router.push({ pathname: '/post/[id]', params: { id: p.id, focus: 'comment' } }))
  const onMenu = useEvent((p: PostView) => {
    setMenu({ open: true, target: { id: p.id, author: p.author, saved: p.saved, _author: p._author, targetType: 'POST' } })
  })
  const closeMenu = useEvent(() => setMenu(m => ({ ...m, open: false })))
  const onPressAuthor = useEvent((id: string) => router.push(`/u/${id}`))
  const onPressChannel = useEvent((id: string) => router.push(`/channels/${id}`))
  const onPressTag = useEvent((tag: string) => router.push(`/tags/${tag}`))
  const onPressMention = useEvent((h: string) => router.push(`/u/${h}`))
  const onToggleMute = useEvent(() => setMuted(m => !m))
  /* Id-taking so every row shares this ONE function; FeedCard closes it over
     its own id. */
  const refetchPost = useEvent((id: string) => api.posts.get(id))
  /* The fresh row carries its own id, so the patch needs no per-row closure. */
  const onModerationCleared = useEvent((fresh: any) => {
    feed.patch(String(fresh.id), prev => ({ ...prev, ...fresh } as FeedItem))
  })
  /* Discovery entries open the PAGER (swipe to the next stream); direct
     links and notifications keep the classic single room. */
  const onPressLive = useEvent((s: LiveStreamView) => router.push(`/live/watch?start=${s.id}`))
  const onSeeAllLive = useEvent(() => router.push('/live'))
  const onFollowSuggestion = useEvent((s: SuggestionView) => { void follow(s.candidateId) })
  const onDismissSuggestion = useEvent((s: SuggestionView) => { void dismissSuggestion(s) })
  const onSeeAllSuggestions = useEvent(() => router.push('/suggestions'))
  const onClosePymk = useEvent(() => { markPymkShown(); setSuggestions([]) })
  const onPressResearchTile = useEvent((r: ResearchRailItem) => router.push(`/research/${r.id}`))
  const onSeeAllResearch = useEvent(() => router.push('/research'))
  const onPressOpenQuestion = useEvent((q: OpenQuestionItem) => router.push(`/qna/${q.id}`))
  const onSeeAllQna = useEvent(() => router.push('/qna'))
  const onSeeAllTags = useEvent(() => router.push('/tags'))
  const onFindPeople = useEvent(() => router.push('/suggestions'))

  /* Recreated only when a value a row actually renders moves (mute, follow
     set, band payloads) — everything else in here is stable. The active video
     is deliberately NOT here: each row subscribes to its own flag inside
     FeedCardRow, so a hand-off re-renders two rows, not the list. */
  const renderItem = React.useCallback(({ item }: { item: FeedRow }) => {
    if (item.kind === 'LIVE_CARD') {
      /* liveNow[0] is followed-first by contract; the row was only inserted
         while the array was non-empty, and it degrades to nothing if the
         stream ended between renders. */
      const s = liveNow[0]
      return s ? <LiveFeedCard stream={s} onPress={onPressLive} /> : null
    }
    if (item.kind === 'LIVE_RAIL') {
      return (
        <View style={styles.band}>
          <LiveRail streams={liveNow} onPress={onPressLive} onSeeAll={onSeeAllLive} />
        </View>
      )
    }
    if (item.kind === 'PYMK') {
      return (
        <View style={styles.band}>
          <PymkStrip
            suggestions={suggestions}
            followedIds={followed}
            onFollow={onFollowSuggestion}
            onUnfollow={onFollowSuggestion}
            onDismiss={onDismissSuggestion}
            onPressPerson={onPressAuthor}
            onSeeAll={onSeeAllSuggestions}
            onClose={onClosePymk}
          />
        </View>
      )
    }
    if (item.kind === 'RESEARCH_RAIL') {
      return (
        <View style={styles.band}>
          <ResearchRail items={researchShelf} onPressItem={onPressResearchTile} onSeeAll={onSeeAllResearch} />
        </View>
      )
    }
    if (item.kind === 'QNA_BAND') {
      return (
        <View style={styles.band}>
          <QnaBand questions={openQuestions} onPressQuestion={onPressOpenQuestion} onSeeAll={onSeeAllQna} />
        </View>
      )
    }
    if (item.kind === 'TRENDING') {
      return (
        <View style={styles.band}>
          <TrendingBand tags={trends} onPressTag={onPressTag} onSeeAll={onSeeAllTags} />
        </View>
      )
    }
    if (item.kind === 'EMPTY_NOTE') {
      return (
        /* On the plate like everything else — an empty state adrift on the
           clay ground reads as a row that failed to draw. */
        <View style={[feedPlate, styles.band, styles.note, { backgroundColor: c.surface, borderColor: c.separator }]}>
          <EmptyState
            compact
            icon="sparkle"
            title={tab === 'scholars' ? 'No scholar content yet' : 'Your feed is quiet'}
            message={tab === 'scholars'
              ? 'Research, questions and posts from verified scholars will appear here.'
              : 'Follow a few people and their posts land here — meanwhile, here is what the community is working on.'}
            actionLabel={tab === 'scholars' ? undefined : 'Find people'}
            onAction={tab === 'scholars' ? undefined : onFindPeople}
          />
        </View>
      )
    }
    return (
      <View style={styles.band}>
        <FeedCardRow
          item={item}
          followed={followed.has(String((item as any).author))}
          onFollow={onFollow}
          onLike={onLike}
          onSave={onSave}
          onSaveLongPress={onSaveLongPress}
          onShare={onShare}
          onComment={onComment}
          onMenu={onMenu}
          onPress={openItem}
          onPressAuthor={onPressAuthor}
          onPressChannel={onPressChannel}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
          muted={muted}
          onToggleMute={onToggleMute}
          refetch={item.kind === 'POST' || !item.kind ? refetchPost : undefined}
          onModerationCleared={onModerationCleared}
        />
      </View>
    )
  }, [
    c.surface, c.separator,
    tab, liveNow, suggestions, followed, muted, openItem,
    researchShelf, openQuestions, trends,
    onPressLive, onSeeAllLive, onFollowSuggestion, onDismissSuggestion,
    onSeeAllSuggestions, onClosePymk, onFollow, onLike, onSave, onSaveLongPress,
    onShare, onComment, onMenu, onPressAuthor, onPressChannel, onPressTag,
    onPressMention, onToggleMute, refetchPost, onModerationCleared,
    onPressResearchTile, onSeeAllResearch, onPressOpenQuestion, onSeeAllQna,
    onSeeAllTags, onFindPeople,
  ])

  if (gate === 'deny') {
    return (
      <Screen background="sunken">
        <Header title="Home" />
        <EmptyState
          icon="person"
          title="Sign in to see your feed"
          message="The home feed is built from the people and channels you follow."
          actionLabel="Sign in"
          onAction={() => router.replace('/sign-in')}
        />
      </Screen>
    )
  }

  /* Scholars shows the skeleton until ITS sources land; the feed tabs until
     the first page does. An errored feed still yields to Scholars, whose
     sources are independent of the timeline. */
  const firstLoad = tab === 'scholars' ? scholarExtra == null : loading && !items.length

  const body = firstLoad ? (
    <View style={{ paddingTop: headerH }}><FeedSkeleton /></View>
  ) : onFeedTab && error && !items.length ? (
    <View style={{ paddingTop: headerH }}>
      <ErrorState error={error} onRetry={() => { void feed.reload() }} />
    </View>
  ) : (
    <AnimatedFlashList
      ref={listRef}
      data={rows}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      renderItem={renderItem}
      onScroll={onScroll as any}
      scrollEventThrottle={16}
      /* Paging drives the SERVER feed; the Scholars aggregation is a fixed
         client-side merge — paging under it would re-sort rows mid-scroll. */
      onEndReached={onFeedTab ? feed.loadMore : undefined}
      onEndReachedThreshold={0.6}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged as any}
      /* 350, not more: every prebuilt card in the window decodes its images
         up front, and this list is media-heavy. */
      drawDistance={350}
      contentContainerStyle={listPad}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            /* The single most-repeated gesture in the app confirms itself —
               fireHaptic already sits behind the haptics preference. */
            fireHaptic('light')
            setNewPosts(0)
            void feed.refresh()
            pullDiscovery()
            if (tab === 'scholars') setScholarExtra(null)
            /* The recompute is 202/async, so the re-read is deliberately late
               rather than chained onto its (empty) response. */
            api.posts.recomputeSuggestions().catch(() => {})
            if (pymkAllowed) {
              setTimeout(() => {
                api.posts.suggestionsDetailed({ limit: 10 })
                  .then((r: any) => setSuggestions(r || []))
                  .catch(() => {})
              }, 1500)
            }
          }}
          progressViewOffset={headerH}
          tintColor={c.textMuted}
          colors={[c.accent]}
          progressBackgroundColor={c.surface}
        />
      }
      /* The component, not an element — see FeedListHeader. */
      ListHeaderComponent={FeedListHeader}
      ListFooterComponent={
        <ListFooter
          loading={onFeedTab ? loadingMore : false}
          error={onFeedTab && items.length ? error : null}
          onRetry={feed.loadMore}
          done={onFeedTab ? done : rows.length > 0}
          doneLabel="You're all caught up"
        />
      }
    />
  )

  return (
    <Screen background="sunken">
      {body}

      <Header
        floating
        border={false}
        actionSurface="soft"
        titleNode={
          /* The wordmark reads as the masthead, and the mark IS its first
             letter (ui/Wordmark) — Lora carries "ikmah Web" from there. Alone
             on its row: the tabs moved to their own full-width row below,
             which is what gives all three room to breathe on a phone. */
          <Wordmark size={22} color={c.text} onPress={backToTop} style={styles.wordmark} />
        }
        /* Creating lives in the FAB, which covers all six things this app can
           make. The header carries the bell plus the two destinations that have
           no tab of their own — Live only surfaces in-feed while someone is
           actually live, and Channels was otherwise buried in Explore. */
        actions={[
          { icon: 'live', label: 'Live', onPress: () => router.push('/live') },
          { icon: 'channels', label: 'Channels', onPress: () => router.push('/channels') },
          { icon: 'bell', label: 'Notifications', onPress: () => router.push('/notifications'), badge: notificationUnread || null },
        ]}
        below={
          <>
            <View style={styles.segRow}>
              <SegmentedControl<FeedTab>
                options={[
                  { value: 'foryou', label: 'For you' },
                  { value: 'latest', label: 'Latest' },
                  { value: 'scholars', label: 'Scholars' },
                ]}
                value={tab}
                onChange={pickTab}
              />
            </View>
            <Animated.View style={[styles.hairline, { backgroundColor: c.separator }, hairline]} />
          </>
        }
      />

      <NewPostsPill visible={newPosts > 0 && onFeedTab} count={newPosts} onPress={showNew} top={headerH} />

      <ScrollAwareFab shown={fabShown} />

      <PostMenuSheet
        visible={menu.open}
        onClose={closeMenu}
        post={menu.target}
        viewerId={user?.id}
        onSave={target => { void toggleSave({ id: target.id, saved: target.saved } as any) }}
        onDeleted={id => feed.remove(String(id))}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One feed card. `isActiveVideo` is read here via a per-key
   subscription instead of arriving as a renderItem prop, so
   the active-video hand-off wakes exactly the row losing the
   flag and the row gaining it. Everything else passes through
   untouched, which keeps FeedCard's React.memo effective.
   --------------------------------------------------------- */
function FeedCardRow(props: Omit<FeedCardProps, 'isActiveVideo'>) {
  const isActiveVideo = useIsActiveVideo(String(props.item.id))
  return <FeedCard {...props} isActiveVideo={isActiveVideo} />
}

/* ---------------------------------------------------------
   The FAB, driven straight from the scroll worklet.

   ComposeFab's `visible` prop is React state, and flipping
   state from inside an active scroll gesture re-renders the
   whole screen at the worst possible moment. So the FAB stays
   mounted as always-visible and this wrapper replays its tuck
   (fade, shrink, drop) from the shared value on the UI thread.
   pointerEvents rides the animated style so a hidden FAB
   swallows no taps; the chooser Sheet is a Modal, so the
   wrapper's opacity never touches it.
   --------------------------------------------------------- */
function ScrollAwareFab({ shown }: { shown: SharedValue<number> }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { width: winW, height: winH } = useWindowDimensions()

  /* The wrapper spans the screen (so ComposeFab's own absolute placement
     still lands where it always did), which means the scale needs an explicit
     origin at the FAB's centre — 16 edge inset + half of the 56 button,
     mirrored under RTL where flex-end puts the button on the left. */
  const originX = t.isRTL ? 44 : winW - 44
  const originY = winH - (insets.bottom + t.layout.tabBarHeight + 14 + 28)

  const anim = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: 0.7 + shown.value * 0.3 }, { translateY: (1 - shown.value) * 24 }],
    pointerEvents: shown.value > 0.5 ? ('box-none' as const) : ('none' as const),
  }))

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: [originX, originY, 0] }, anim]}>
      <ComposeFab />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  /* THE COLUMN. Every row is a full-bleed plate (feed/plate.ts) and the only
     ground the feed shows is the seam between two of them — no side margins,
     because the content is worth more than the frame around it. The band owns
     the seam and nothing else, so renderItem's deps stay untouched. */
  band: { marginBottom: FEED_GAP },
  /* The story tray's plate: the rail brings its own side padding. */
  tray: { paddingVertical: space.sm2, marginBottom: FEED_GAP },
  note: { paddingVertical: space.sm },
  /* The tracking lives inside the lockup now, so this is only its seat. */
  wordmark: { paddingVertical: space.xxs },
  /* 2 + the control's 40 + 10 = SEG_ROW_H. Change them together. */
  segRow: { paddingHorizontal: space.md2, paddingTop: space.xxs, paddingBottom: space.sm2 },
  hairline: { height: StyleSheet.hairlineWidth },
})
