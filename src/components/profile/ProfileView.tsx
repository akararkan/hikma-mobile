/* =========================================================
   ProfileView — one component, two screens.

   The owner's tab and /user/[id] are the same page with three
   differences, and all three are consequences of the API
   rather than design choices:

     · the READ differs. `meProfile()` is uncached server-side
       and carries profileViews plus non-public links; the
       public `profile(id)` is cached for five minutes and
       zeroes profileViews. Using the wrong one is how a
       profile shows stale data straight after an edit.
     · the QUESTIONS tab is owner-only. `qna.mine()` exists;
       there is no public per-user question endpoint, so the
       tab must not appear on anyone else's profile.
     · the button pair. Owner gets Edit + Share; everyone else
       gets a relationship button driven by socialStatus — and
       never by `user.isFollowing`, which the adapter hardcodes
       to false on every row it maps.
   ========================================================= */
import React from 'react'
import {
  RefreshControl, Share, StyleSheet, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  FadeIn, runOnJS, useAnimatedScrollHandler, useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { api, errorText, isDuplicate, isNotFound } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { usePostTombstones } from '@/components/feed/postTombstones'
import { useAuth } from '@/context/AuthContext'
import { useNotificationEvents, useReconcile } from '@/context/RealtimeContext'
import { useTabRetap } from '@/components/nav/tabEvents'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, Chip, EmptyState, ErrorState, Header, IconButton,
  ListFooter, Screen, ScreenScroll, SegmentedControl, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { FollowButton } from './FollowButton'
import { ProfileDocuments } from './ProfileDocuments'
import { ProfileHeader, ProfileHeaderSkeleton } from './ProfileHeader'
import { openReelIn } from '@/components/reels/openReel'
import { PostCard, QuestionCard, ReelTile, ResearchCard, TabSkeleton } from './ProfileCards'
import { RelationshipSheet, profileLink } from './RelationshipSheet'
import { useMuted, useSocialStatus, type SocialStatus } from './useSocialStatus'
import type { StatKey, Stats } from './StatRow'

type Tab = 'posts' | 'reels' | 'research' | 'questions'

/* The detail routes other domains own, in the object form typed routes want
   for a dynamic segment. One place, so a rename over there is one edit here. */
const href = {
  post: (id: string) => ({ pathname: '/post/[id]' as const, params: { id } }),
  research: (id: string) => ({ pathname: '/research/[id]' as const, params: { id } }),
  question: (id: string) => ({ pathname: '/qna/[id]' as const, params: { id } }),
}

/** Cursor page args as a variable, not a literal: the api modules are JS and
 *  TS infers their `= {}` option bags without the keys that carry no default,
 *  so an inline literal trips the excess-property check on `cursor`. */
function cursorArgs(cursor: string | null | undefined, pageSize: number) {
  const args: { cursor?: string | null; pageSize: number } = { cursor, pageSize }
  return args
}

const TAB_OPTIONS: { value: Tab; label: string; icon: any }[] = [
  { value: 'posts', label: 'Posts', icon: 'grid' },
  { value: 'reels', label: 'Reels', icon: 'reels' },
  { value: 'research', label: 'Research', icon: 'research' },
  { value: 'questions', label: 'Questions', icon: 'qna' },
]

/* Frozen so the memoized header sees the same array identity on every render
   — a fresh literal here would defeat its own memo. */
const OWNER_TABS: Tab[] = ['posts', 'reels', 'research', 'questions']
const PUBLIC_TABS: Tab[] = ['posts', 'reels', 'research']
const OWNER_STAT_KEYS: StatKey[] = ['posts', 'reels', 'research', 'questions', 'followers', 'following']
const PUBLIC_STAT_KEYS: StatKey[] = ['posts', 'reels', 'research', 'followers', 'following']

/* FlashList's imperative handle exposes getScrollableNode(), which is how
   reanimated attaches the scroll worklet natively while FlashList's own JS
   virtualization handler keeps working beside it. The cast exists only
   because createAnimatedComponent cannot carry the generic through. */
const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as React.ComponentType<any>,
) as unknown as typeof FlashList

/* Module scope, so the identity never changes — FlashList's ViewHolder memo
   compares renderItem and keyExtractor's output per cell, and an inline arrow
   here re-invokes renderItem for every mounted cell on every screen render.
   `renderItem` itself stays stable a different way: FlashList hands it
   `extraData` (the active tab) and lists it in the cell's memo deps, so one
   function renders all four cell shapes and the cells still repaint on a tab
   change. getItemType gets no extraData from FlashList
   (RecyclerViewManager.getItemType calls it with (item, index) only), so it
   has to live in the body and close over `tab` — see below. */
const keyExtractor = (item: any) => String(item?.id ?? '')

export interface ProfileViewProps {
  /** Omitted for the owner's own tab — the id comes from the session. */
  userId?: string
  owner: boolean
  /** ONLY the You-tab mount passes this: re-tapping the tab then answers
   *  with the standard two-step (top when scrolled, refresh when there).
   *  A pushed profile must not steal the bar's event. */
  tabRetap?: boolean
}

export function ProfileView({ userId, owner, tabRetap }: ProfileViewProps) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user: me, signedIn } = useAuth()

  const [tab, setTab] = React.useState<Tab>('posts')
  const [pinned, setPinned] = React.useState(false)
  const scrollY = useSharedValue(0)
  /* The measured header lives twice: a ref for the JS-thread scrollToOffset in
     onStat, and a shared value the scroll worklet can read without crossing
     threads. Both are written by the one onLayout. */
  const headerHeight = React.useRef(0)
  const headerH = useSharedValue(0)
  const pinnedSV = useSharedValue(0)
  const pinnedRef = React.useRef(false)
  const listRef = React.useRef<any>(null)

  const shareSheet = useSheetState()
  const relSheet = useSheetState()
  const followingSheet = useSheetState()

  /* ---- reads ---- */

  const targetId = owner ? String(me?.id || '') : String(userId || '')

  const profile = useAsync<any>(
    () => (owner ? api.users.meProfile() : api.users.profile(targetId)),
    { enabled: owner ? true : !!targetId, deps: [owner, targetId] },
  )

  const user = profile.data ?? (owner ? me : null)
  const cachedOnly = !!profile.error && !!user

  const statsId = String(user?.id || targetId || '')
  const stats = useAsync<Stats>(
    () => api.users.stats(statsId),
    { enabled: !!statsId, deps: [statsId] },
  )
  /* stats() degrades instead of throwing, so "failed" is all four content
     counts coming back null — not an exception. */
  const statsDegraded = !!stats.data && stats.data.posts == null && stats.data.followers == null

  const madhhabId = user?.madhhabId ?? null
  const madhhab = useAsync<any>(
    () => api.madhhabs.byId(madhhabId),
    { enabled: madhhabId != null, deps: [madhhabId] },
  )

  const rel = useSocialStatus(owner ? null : targetId)
  const muted = useMuted(owner ? null : targetId)

  /* ---- tabs ---- */

  const tabs = owner ? OWNER_TABS : PUBLIC_TABS
  /* Built once per tab set, not per render: this array is a prop of the
     memoized header and of the pinned strip below it. */
  const tabOptions = React.useMemo(() => TAB_OPTIONS.filter(o => tabs.includes(o.value)), [tabs])

  /* Lazy: a tab costs nothing until it is first shown, and then keeps its
     pages when the user flips away and back. */
  const [visited, setVisited] = React.useState<Record<string, boolean>>({ posts: true })
  React.useEffect(() => { setVisited(v => (v[tab] ? v : { ...v, [tab]: true })) }, [tab])

  const authorId = String(user?.id || targetId || '')
  const canRead = !!authorId && !rel.status?.isBlockedByThem && !rel.status?.isBlocking

  const posts = usePaged<any>(
    ({ cursor, pageSize }) => api.posts.byAuthor(authorId, cursorArgs(cursor, pageSize)),
    { mode: 'cursor', pageSize: 20, enabled: canRead && !!visited.posts, deps: [authorId, canRead] },
  )
  const reels = usePaged<any>(
    ({ cursor, pageSize }) => api.reels.byAuthor(authorId, cursorArgs(cursor, pageSize)),
    { mode: 'cursor', pageSize: 20, enabled: canRead && !!visited.reels, deps: [authorId, canRead] },
  )
  const research = usePaged<any>(
    ({ page, pageSize }) => api.research.byResearcher(authorId, { page, size: pageSize }),
    { mode: 'page', pageSize: 20, enabled: canRead && !!visited.research, deps: [authorId, canRead] },
  )
  const questions = usePaged<any>(
    ({ page, pageSize }) => api.qna.mine({ page, size: pageSize }),
    { mode: 'page', pageSize: 20, enabled: owner && canRead && !!visited.questions, deps: [authorId, canRead] },
  )

  const active = tab === 'reels' ? reels : tab === 'research' ? research : tab === 'questions' ? questions : posts

  /* A post or a reel deleted anywhere else in the app — from the detail
     screen this grid pushed to, from the reel pager, from the feed — is
     dropped from these windows too. `remove` is usePaged's, identity-stable,
     so this arms once per tab. */
  usePostTombstones(posts.remove)
  usePostTombstones(reels.remove)

  /* ---- realtime ----
     There is no per-user stream. A follow arrives on the shared notification
     socket, aggregated under one id and re-delivered, so the counts are
     re-READ rather than patched — and debounced, because a burst of follows
     is one number either way. */
  const statsRefresh = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpStats = React.useCallback(() => {
    if (statsRefresh.current) return
    statsRefresh.current = setTimeout(() => { statsRefresh.current = null; void stats.refresh() }, 2000)
  }, [stats])
  React.useEffect(() => () => { if (statsRefresh.current) clearTimeout(statsRefresh.current) }, [])

  useNotificationEvents(e => {
    if (!owner) return
    if (e.type === 'notification' && e.notification?.type === 'NEW_FOLLOWER') bumpStats()
  })

  useReconcile(() => {
    void stats.refresh()
    if (owner) void profile.refresh()
  })

  /* ---- interactions ---- */

  const onRefresh = React.useCallback(() => {
    void profile.refresh()
    void stats.refresh()
    void active.refresh()
    if (!owner) rel.refresh()
  }, [profile, stats, active, owner, rel])

  /* Message — createDirect is documented existing-or-new, so this doubles as
     "open our conversation". Busy-latched: a double-tap must not race two
     creates. */
  const msgBusy = React.useRef(false)
  const messageAuthor = React.useCallback(async () => {
    if (msgBusy.current || !authorId) return
    msgBusy.current = true
    try {
      const convo: any = await api.chat.conversations.createDirect(authorId)
      if (convo?.id) router.push(`/chat/${convo.id}`)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      msgBusy.current = false
    }
  }, [authorId, router])

  /* Profile was the one tab where re-tapping the bar was dead. The sentinel
     name keeps the hook unconditional while a pushed profile stays deaf. */
  useTabRetap(tabRetap ? 'profile' : '__inactive', () => {
    if (pinnedRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: true })
    else onRefresh()
  })

  const topGap = insets.top + t.layout.headerHeight

  /* The list's scroll runs entirely on the UI thread: the cover parallax reads
     `scrollY` there, and the only thing JS still needs is the pinned flip —
     one crossing per flip instead of ~60 per second. */
  /* One writer for both the ref and the state, so the two scroll paths below
     can never disagree about whether the header is pinned. */
  const applyPinned = React.useCallback((next: boolean) => {
    pinnedRef.current = next
    pinnedSV.value = next ? 1 : 0
    setPinned(next)
  }, [pinnedSV])

  const onScroll = useAnimatedScrollHandler({
    onScroll: e => {
      const y = e.contentOffset.y
      scrollY.value = y
      const next = y > Math.max(120, headerH.value - topGap) ? 1 : 0
      if (next !== pinnedSV.value) {
        pinnedSV.value = next
        runOnJS(applyPinned)(next === 1)
      }
    },
  }, [topGap])

  /* The blocked/blocking body is a plain ScrollView (no tabs, no list), so it
     keeps the JS handler — a static page cannot outrun it. */
  const onScrollJS = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y
    scrollY.value = y
    const next = y > Math.max(120, headerHeight.current - topGap)
    if (next !== pinnedRef.current) applyPinned(next)
  }, [scrollY, topGap, applyPinned])

  const onHeaderLayout = useEvent((h: number) => { headerHeight.current = h; headerH.value = h })

  const onStat = useEvent((key: StatKey) => {
    if (key === 'followers') { router.push({ pathname: '/user/[id]/followers', params: { id: authorId } }); return }
    if (key === 'following') { router.push({ pathname: '/user/[id]/following', params: { id: authorId } }); return }
    const asTab = key as Tab
    if (tabs.includes(asTab)) {
      setTab(asTab)
      listRef.current?.scrollToOffset?.({ offset: Math.max(0, headerHeight.current - 120), animated: true })
    }
  })

  /* ---- row plumbing ----
     One function per destination instead of one closure per row: FlashList's
     ViewHolder memo compares renderItem by identity, so an inline arrow here
     would re-invoke it for every mounted cell on every screen render. The
     active tab arrives as `extraData`, which is what lets renderItem stay
     stable while still rendering four different cells. */
  const openPost = useEvent((item: any) => router.push(href.post(String(item.id))))
  const openResearch = useEvent((item: any) => router.push(href.research(String(item.id))))
  const openQuestion = useEvent((item: any) => router.push(href.question(String(item.id))))
  /* A reel opens the swipeable pager INSIDE this grid's rows, on the tapped
     tile, continuing with this author's reels from there — the same hand-off
     the standalone author grid makes (src/app/(app)/reels/author/[authorId].tsx),
     so the two entry points land on the same screen with the same feed. */
  const openReel = useEvent((item: any) => {
    openReelIn(router, reels.items, item, { src: 'author', authorId, handle: user?.handle })
  })

  const renderItem = React.useCallback(({ item, extraData }: { item: any; extraData?: any }) => {
    if (extraData === 'reels') return <ReelTile reel={item} onPress={openReel} />
    if (extraData === 'research') return <ResearchCard item={item} onPress={openResearch} />
    if (extraData === 'questions') return <QuestionCard item={item} onPress={openQuestion} />
    return <PostCard post={item} onPress={openPost} />
  }, [openPost, openReel, openResearch, openQuestion])

  /* Each tab's data is homogeneous, so the type IS the tab. The pools stay
     separate across a tab switch and a QuestionCard never inherits a
     PostCard's React key. Re-created on a tab change and that is fine —
     FlashList reads this off a props ref, not through a memo comparator. */
  const getItemType = React.useCallback(() => tab, [tab])

  const listPad = React.useMemo(
    () => ({ paddingBottom: insets.bottom + (owner ? 90 : 40) }),
    [insets.bottom, owner],
  )

  /* Sheet openers and the header's write-backs, hoisted so the memoized
     header's props are all identity-stable. */
  const openShareSheet = useEvent(() => shareSheet.open())
  const openRelSheet = useEvent(() => relSheet.open())
  const openFollowingSheet = useEvent(() => followingSheet.open())
  const goEditProfile = useEvent(() => router.push('/profile/edit'))
  const goSignIn = useEvent(() => router.push('/(auth)/sign-in'))
  const goCompose = useEvent(() => router.push('/compose'))
  const onFollowChange = useEvent((next: SocialStatus) => { if (next) void stats.refresh() })
  const onRelChange = useEvent((patch: Partial<SocialStatus>) => rel.apply(patch))

  const link = profileLink(user?.handle, authorId)

  /* ---- states ---- */

  if (profile.loading && !user) {
    return (
      <Screen>
        <Header back={!owner} floating overlay border={false} />
        <ProfileHeaderSkeleton />
        <TabSkeleton />
      </Screen>
    )
  }

  if (profile.error && !user) {
    /* A 404 here is an account that is gone or mid-deletion — a quiet state,
       not an error with a retry that can never succeed. */
    if (isNotFound(profile.error)) {
      return (
        <Screen>
          <Header back title="" border={false} />
          <EmptyState
            icon="person"
            title="This account is no longer available"
            message="It may have been deleted, or the link is out of date."
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        </Screen>
      )
    }
    return (
      <Screen>
        <Header back={!owner} title="" border={false} />
        <ErrorState error={profile.error} onRetry={profile.reload} />
      </Screen>
    )
  }

  if (!user) {
    return (
      <Screen>
        <Header back={!owner} title="" border={false} />
        <EmptyState icon="person" title="Profile unavailable" message="Nothing to show for this account yet." />
      </Screen>
    )
  }

  const blockedByThem = !!rel.status?.isBlockedByThem
  const blocking = !!rel.status?.isBlocking

  /* The element identity still changes every render — React.memo inside
     ProfileListHeader is what stops the cover image, the stats row, the
     specialization chips and the segmented control from re-rendering with it.
     Every prop below is a scalar or an identity-stable value for exactly that
     reason. */
  const headerBlock = (
    <ProfileListHeader
      user={user}
      stats={stats.data}
      statsDegraded={statsDegraded}
      madhhabRow={madhhab.data}
      owner={owner}
      signedIn={signedIn}
      cachedOnly={cachedOnly}
      authorId={authorId}
      onMessage={!owner && signedIn && canRead ? messageAuthor : undefined}
      scrollY={scrollY}
      statKeys={owner ? OWNER_STAT_KEYS : PUBLIC_STAT_KEYS}
      relStatus={rel.status}
      muted={muted}
      blocking={blocking}
      blockedByThem={blockedByThem}
      tab={tab}
      tabOptions={tabOptions}
      onHeaderLayout={onHeaderLayout}
      onStat={onStat}
      onEditProfile={goEditProfile}
      onSignIn={goSignIn}
      onOpenRelSheet={openRelSheet}
      onOpenShareSheet={openShareSheet}
      onOpenFollowingSheet={openFollowingSheet}
      onFollowChange={onFollowChange}
      onRelChange={onRelChange}
      onChangeTab={setTab}
    />
  )

  /* A relationship, not the network, is the reason the body is empty — so
     there is no retry and no tabs, only the honest explanation. */
  if (blockedByThem || blocking) {
    return (
      <Screen>
        <Header
          back={!owner}
          floating
          overlay={!pinned}
          translucent={pinned}
          title={pinned ? user.full : ''}
          border={pinned}
          actions={[{ icon: 'more', onPress: relSheet.open, label: 'More options' }]}
        />
        <ScreenScroll onScroll={onScrollJS} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          {headerBlock}
          <EmptyState
            icon={blocking ? 'block' : 'lock'}
            title={blocking ? `You blocked @${user.handle}` : 'This account is not available to you'}
            message={blocking
              ? 'They cannot follow you or see your posts. Unblocking does not restore the follows you had.'
              : undefined}
            actionLabel={blocking ? 'Unblock' : undefined}
            onAction={blocking ? relSheet.open : undefined}
          />
        </ScreenScroll>
        <Sheets
          user={user}
          authorId={authorId}
          link={link}
          owner={owner}
          rel={rel}
          muted={muted}
          shareSheet={shareSheet}
          relSheet={relSheet}
          followingSheet={followingSheet}
          onStats={() => void stats.refresh()}
        />
      </Screen>
    )
  }

  const emptyForTab = () => {
    /* `visited` is set in an effect, so a freshly opened tab renders once with
       nothing loading and nothing loaded — the skeleton covers that frame
       rather than flashing an empty state at a list that is about to fill. */
    if (!visited[tab] || active.loading) return <TabSkeleton grid={tab === 'reels'} />
    if (active.error) return <ErrorState error={active.error} onRetry={active.reload} compact />
    const copy = {
      posts: owner
        ? { title: 'No posts yet', message: 'Your posts show up here.', action: 'Create your first post' }
        : { title: 'No posts yet', message: 'When they post, it shows up here.', action: null },
      reels: owner
        ? { title: 'No reels yet', message: 'Short videos you publish land here.', action: 'Make a reel' }
        : { title: 'No reels yet', message: null, action: null },
      research: owner
        ? { title: 'No research published', message: 'Publish a paper and it appears here.', action: null }
        : { title: 'No research published', message: null, action: null },
      questions: { title: 'You have not asked anything yet', message: 'Questions you ask show up here.', action: 'Ask a question' },
    }[tab]
    return (
      <EmptyState
        icon={tab === 'reels' ? 'reels' : tab === 'research' ? 'research' : tab === 'questions' ? 'qna' : 'edit'}
        title={copy.title}
        message={copy.message ?? undefined}
        actionLabel={owner && copy.action ? copy.action : undefined}
        onAction={owner && copy.action ? goCompose : undefined}
        compact
      />
    )
  }

  return (
    <Screen>
      <Header
        back={!owner}
        floating
        overlay={!pinned}
        translucent={pinned}
        title={pinned ? user.full : ''}
        subtitle={pinned ? `@${user.handle}` : undefined}
        actions={owner
          ? [
            { icon: 'share', onPress: shareSheet.open, label: 'Share your profile' },
            { icon: 'settings', onPress: () => router.push('/settings'), label: 'Settings' },
          ]
          : [{ icon: 'more', onPress: relSheet.open, label: 'More options' }]}
        border={pinned}
      />

      <AnimatedFlashList
        ref={listRef}
        key={tab === 'reels' ? 'grid' : 'list'}
        data={active.items}
        extraData={tab}
        numColumns={tab === 'reels' ? 3 : 1}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        ListHeaderComponent={headerBlock}
        ListEmptyComponent={emptyForTab()}
        ListFooterComponent={
          active.items.length
            ? <ListFooter loading={active.loadingMore} error={active.error} onRetry={active.loadMore} done={active.done} />
            : null
        }
        onEndReached={active.loadMore}
        onEndReachedThreshold={0.6}
        onScroll={onScroll as any}
        scrollEventThrottle={16}
        /* 600, not the platform's 250: the reels grid is ~200pt of tile per
           row and a research card is taller still, so the default buffer is
           under one cell and a fast flick outruns the render stack. */
        drawDistance={600}
        contentContainerStyle={listPad}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={profile.refreshing || active.refreshing}
            onRefresh={onRefresh}
            progressViewOffset={topGap}
            tintColor={t.colors.textMuted}
            colors={[t.colors.accent]}
          />
        }
      />

      {/* The tab bar leaves with the header; this one takes over so switching
          tabs never means scrolling back to the top first. */}
      {pinned ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(140))}
          style={[
            styles.pinnedTabs,
            { top: topGap, backgroundColor: t.colors.bg, borderBottomColor: t.colors.separator },
          ]}
        >
          <SegmentedControl<Tab>
            options={tabOptions}
            value={tab}
            onChange={setTab}
            variant="underline"
          />
        </Animated.View>
      ) : null}

      {owner ? (
        /* The ComposeFab plate: setback 18/8 with a 1px accentPressed rule
           (DESIGN.md §6). No glow, no shadow — depth is the letterpress the
           Touchable already gives it. */
        <Touchable
          onPress={goCompose}
          feedback="scale"
          haptic="medium"
          accessibilityLabel="Create"
          style={[
            styles.fab,
            {
              bottom: insets.bottom + 74,
              backgroundColor: t.colors.accent,
              borderColor: t.colors.accentPressed,
              ...setback(t.shape.fab),
            },
          ]}
        >
          <Text variant="title2" color={t.colors.textOnAccent} align="center">+</Text>
        </Touchable>
      ) : null}

      <Sheets
        user={user}
        authorId={authorId}
        link={link}
        owner={owner}
        rel={rel}
        muted={muted}
        shareSheet={shareSheet}
        relSheet={relSheet}
        followingSheet={followingSheet}
        onStats={() => void stats.refresh()}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The list header, memoized.

   This is the heaviest thing on the screen — cover image,
   avatar, stat row, specialization chips, badges, bio, and the
   segmented control — and it sits in a ViewHolder that
   re-renders whenever the element handed to ListHeaderComponent
   changes identity, which is every render of the screen. So it
   is a React.memo component fed only scalars and stable
   references: the two action slots are built HERE rather than
   passed in as elements, because a fresh <Button> in a prop
   would miss the memo on every single render.
   --------------------------------------------------------- */

interface ProfileListHeaderProps {
  user: any
  stats: Stats | null
  statsDegraded: boolean
  madhhabRow: any
  owner: boolean
  signedIn: boolean
  cachedOnly: boolean
  authorId: string
  scrollY: SharedValue<number>
  statKeys: StatKey[]
  relStatus: SocialStatus | null
  muted: boolean | null
  blocking: boolean
  blockedByThem: boolean
  tab: Tab
  tabOptions: typeof TAB_OPTIONS
  onHeaderLayout: (height: number) => void
  onStat: (key: StatKey) => void
  onEditProfile: () => void
  onSignIn: () => void
  onOpenRelSheet: () => void
  onOpenShareSheet: () => void
  /** Absent for the owner and while either direction blocks. */
  onMessage?: () => void
  onOpenFollowingSheet: () => void
  onFollowChange: (next: SocialStatus) => void
  onRelChange: (patch: Partial<SocialStatus>) => void
  onChangeTab: (tab: Tab) => void
}

const ProfileListHeader = React.memo(function ProfileListHeader({
  user, stats, statsDegraded, madhhabRow, owner, signedIn, cachedOnly, authorId,
  scrollY, statKeys, relStatus, muted, blocking, blockedByThem, tab, tabOptions,
  onHeaderLayout, onStat, onEditProfile, onSignIn, onOpenRelSheet, onOpenShareSheet,
  onMessage, onOpenFollowingSheet, onFollowChange, onRelChange, onChangeTab,
}: ProfileListHeaderProps) {
  const t = useTheme()
  const onLayout = React.useCallback(
    (e: LayoutChangeEvent) => onHeaderLayout(e.nativeEvent.layout.height),
    [onHeaderLayout],
  )
  const segStyle = React.useMemo(
    () => ({ marginTop: space.md, backgroundColor: t.colors.bg }),
    [t.colors.bg],
  )

  return (
    <View onLayout={onLayout}>
      {cachedOnly ? (
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
          <Chip label="Showing a cached profile" icon="offline" tone="warning" size="sm" />
        </View>
      ) : null}

      <ProfileHeader
        user={user}
        stats={stats}
        statsDegraded={statsDegraded}
        owner={owner}
        madhhabRow={madhhabRow}
        scrollY={scrollY}
        statKeys={statKeys}
        onStat={onStat}
        onAvatarPress={owner ? onEditProfile : undefined}
        onCoverPress={owner ? onEditProfile : undefined}
        primary={owner ? (
          <Button label="Edit profile" onPress={onEditProfile} variant="secondary" size="md" />
        ) : !signedIn ? (
          <Button label="Sign in to follow" onPress={onSignIn} variant="primary" size="md" />
        ) : blocking ? (
          <Button label="Unblock" onPress={onOpenRelSheet} variant="secondary" size="md" />
        ) : (
          <FollowButton
            userId={authorId}
            status={relStatus}
            onChange={onFollowChange}
            onPressFollowing={onOpenFollowingSheet}
            size="md"
          />
        )}
        secondary={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {/* Message beside Follow — the pair every profile action row on
                the platform teaches. createDirect returns the existing
                conversation when one exists, so this is also "open our chat". */}
            {onMessage ? (
              <IconButton
                name="chat"
                onPress={onMessage}
                accessibilityLabel={`Message ${user?.displayName || user?.handle || 'this member'}`}
                surface="soft"
                size={19}
              />
            ) : null}
            <IconButton
              name={owner ? 'share' : 'more'}
              onPress={owner ? onOpenShareSheet : onOpenRelSheet}
              accessibilityLabel={owner ? 'Share your profile' : 'More options'}
              surface="soft"
              size={19}
            />
          </View>
        }
      >
        <RelationshipStrips
          status={relStatus}
          muted={muted}
          userId={authorId}
          onChange={onRelChange}
        />
      </ProfileHeader>

      {/* The scholar's CV/documents (ProfileResponse.attachments) — rendered
          only when any exist, and never across a block: the tabs' gate is the
          right gate for content too. */}
      {!blockedByThem && !blocking ? <ProfileDocuments attachments={user?.attachments} /> : null}

      {!blockedByThem && !blocking ? (
        <SegmentedControl<Tab>
          options={tabOptions}
          value={tab}
          onChange={onChangeTab}
          variant="underline"
          style={segStyle}
        />
      ) : null}
    </View>
  )
})

/* ---------------------------------------------------------
   The quiet strips under the stat row: restricted, muted.
   Restrict copy must never imply the other person was told.
   --------------------------------------------------------- */

function RelationshipStrips({
  status, muted, userId, onChange,
}: {
  status: SocialStatus | null
  muted: boolean | null
  userId: string
  onChange: (patch: Partial<SocialStatus>) => void
}) {
  const t = useTheme()
  const [busy, setBusy] = React.useState(false)
  if (!status?.isRestricting && !muted) return null

  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, marginTop: space.md, gap: space.sm }}>
      {status?.isRestricting ? (
        <Callout
          tone="neutral"
          icon="eyeOff"
          actionLabel={busy ? 'Removing…' : 'Undo'}
          onAction={async () => {
            setBusy(true)
            try {
              const res: any = await api.users.unrestrict(userId)
              onChange(res?.updatedStatus ?? { isRestricting: false })
            } catch (e: any) { toast.error(errorText(e)) } finally { setBusy(false) }
          }}
        >
          You restrict this account. They are not told.
        </Callout>
      ) : null}

      {muted ? (
        <Callout tone="neutral" icon="mutedBell">
          Muted — you will not see their posts.
        </Callout>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Close friends, from the profile.

   Close friends is TWO unsynchronized stores (story/
   close-friends.md): /close-friends (Cassandra) is what story
   visibility enforces and the management screen edits;
   /users/me/close-friends (Postgres) is the validated,
   hydrated user-module list. A toggle that wrote only one
   would let the two sets drift apart per person, so this
   writes BOTH — the story circle first, because is-member
   (the only single-user probe either family has) reads that
   store and therefore decides the label and the flip; then
   the user-module list as a mirror, whose "already there" /
   "never there" answers are drift being healed, not failures.
   --------------------------------------------------------- */

function useCloseFriendToggle(userId: string | null) {
  const { signedIn } = useAuth()
  const [override, setOverride] = React.useState<boolean | null>(null)
  const [pending, setPending] = React.useState(false)

  /* Anonymous callers get `false` from is-member rather than a 401, but the
     sheet this feeds is unreachable signed out — skip the request entirely. */
  const probe = useAsync<boolean>(
    () => api.closeCircle.isMember(userId),
    { enabled: !!userId && signedIn, deps: [userId] },
  )

  const member = override ?? probe.data === true

  const toggle = React.useCallback(async () => {
    if (!userId || pending) return
    const was = member
    const settled = () => (was
      ? toast.info('Removed from close friends')
      : toast.ok('Added to close friends'))
    setPending(true)
    setOverride(!was)
    try {
      /* The authoritative write: idempotent 204 both ways, effective for
         story visibility immediately. Its failure is THE failure — revert. */
      await (was ? api.closeCircle.remove(userId) : api.closeCircle.add(userId))
    } catch (e: any) {
      setOverride(was)
      toast.error(errorText(e))
      setPending(false)
      return
    }
    try {
      await (was ? api.closeFriends.remove(userId) : api.closeFriends.add(userId))
      settled()
    } catch (e: any) {
      /* 409 on add / 404 on remove = the mirror already agreed (the stores
         were historically written by different screens). Anything else is a
         real refusal worth quoting — but the flip stands: the circle the
         label reads has already committed. */
      if (was ? isNotFound(e) : isDuplicate(e)) settled()
      else toast.error(errorText(e))
    }
    setPending(false)
  }, [userId, member, pending])

  return { member, pending, loading: probe.loading, toggle }
}

/* ---------------------------------------------------------
   Every overlay this screen owns, in one place so both bodies
   (normal and blocked) mount the identical set.
   --------------------------------------------------------- */

function Sheets({
  user, authorId, link, owner, rel, muted, shareSheet, relSheet, followingSheet, onStats,
}: any) {
  const router = useRouter()
  const closeFriend = useCloseFriendToggle(owner ? null : authorId)

  return (
    <>
      <ActionSheet
        visible={shareSheet.visible}
        onClose={shareSheet.close}
        title="Share profile"
        actions={[
          {
            label: 'Copy profile link',
            icon: 'copy',
            onPress: async () => { await Clipboard.setStringAsync(link); toast.ok('Link copied') },
          },
          {
            label: 'Send in a message',
            icon: 'chat',
            onPress: () => {
              /* profileLink degrades to a bare `@handle` when no web origin is
                 configured — the chat card needs a URL, so fall back to the
                 app's own deep link there. */
              const url = /^https?:\/\//.test(link) ? link : Linking.createURL(`/u/${user?.handle || authorId}`)
              router.push({
                pathname: '/chat/share',
                params: { url, kind: 'profile', label: user?.full || (user?.handle ? `@${user.handle}` : 'Profile') },
              })
            },
          },
          { label: 'Share…', icon: 'share', onPress: () => { void Share.share({ message: link }) } },
          { label: 'Show my QR', icon: 'qr', onPress: () => router.push('/settings/qr') },
        ]}
      />

      {!owner ? (
        <>
          <RelationshipSheet
            visible={relSheet.visible}
            onClose={relSheet.close}
            user={{ id: authorId, full: user?.full, handle: user?.handle }}
            status={rel.status}
            muted={muted}
            onChange={() => onStats()}
          />

          <ActionSheet
            visible={followingSheet.visible}
            onClose={followingSheet.close}
            title={user?.full}
            subtitle="You follow this account"
            actions={[
              {
                label: closeFriend.member ? 'Remove from close friends' : 'Add to close friends',
                icon: 'star',
                disabled: closeFriend.pending || closeFriend.loading,
                onPress: () => void closeFriend.toggle(),
              },
              {
                label: 'Unfollow',
                icon: 'personRemove',
                destructive: true,
                onPress: async () => {
                  try {
                    const res: any = await api.users.unfollow(authorId)
                    rel.apply(res?.updatedStatus ?? { isFollowing: false })
                    onStats()
                  } catch (e: any) { toast.error(errorText(e)) }
                },
              },
            ]}
          />
        </>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  pinnedTabs: { position: 'absolute', left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  fab: {
    position: 'absolute', end: 18, width: 54, height: 54,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: rule.course, borderCurve: 'continuous',
  },
})
