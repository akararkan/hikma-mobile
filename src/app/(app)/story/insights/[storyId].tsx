/* =========================================================
   Story insights — who saw this, and how the poll is doing.

   Two privacy facts shape the whole screen: the viewer log is
   AUTHOR ONLY, and it is capped at one page with no cursor. So
   a 403 here is a hard refusal with no retry, and a full page
   has to say out loud that it is not the whole list —
   presenting a capped listing as complete is the failure the
   error guide calls out by name.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { adapters, api, errorText, isNotFound, logApiError } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { useEvent } from '@/hooks/useAsync'
import { Button, Icon, Text, Touchable, toast } from '@/ui'
import { ExpiryChip } from '@/components/stories/ExpiryChip'
import { StoryRowsSkeleton } from '@/components/stories/StorySkeleton'
import { ViewerRow, placeholderPerson, type ViewerPerson } from '@/components/stories/ViewerRow'
import { BLACK, POLL_A, POLL_B, ink, night, withAlpha } from '@/components/stories/night'
import { usePollTally, useStoryTray } from '@/components/stories/trayStore'
import { frameGradient, posterOf, type StoryPoll, type StoryRow, type Tally } from '@/components/stories/storyVisual'
import { VISIBILITY_LABEL } from '@/components/stories/visibility'

/** The one page the endpoint serves (no cursor — stories.md viewer log);
 *  asked for explicitly, double its default 50, to push the cap out. */
const VIEWER_PAGE = 100
/* Same bargain on the voter list: one page, no cursor (polls.md), so ask for
   double the default 50 and say so when the answer fills it. */
const VOTER_PAGE = 100
const HYDRATE_CHUNK = 10

interface VoteRow { voterId: string; choice: 'A' | 'B'; votedAt: string }

/* Module scope: FlashList keeps a cell's React key only while the extractor's
   answer holds still, and ViewHolder's memo compares the separator/renderer
   props by identity. Neither reads anything off the screen. */
const viewerKey = (r: any) => String(r.viewerId)

function ListEmpty() {
  return (
    <View style={styles.empty}>
      <Icon name="eye" size={40} color={ink.ghost} />
      <Text variant="headline" color={ink.full} align="center" style={styles.emptyTitle}>No views yet</Text>
      <Text variant="subhead" color={ink.muted} align="center">You’ll see who watched here.</Text>
    </View>
  )
}

export default function StoryInsightsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useTheme()
  /* This route is not enumerated in (app)/_layout, so the presentation is
     declared here — and a modal with no `animation` inherits that stack's
     slide_from_right, which would slide the sheet in from the SIDE while every
     other modal in the app rises. Spelling it out costs the inherited
     reduced-motion cut, so that branch is spelled out too (DESIGN.md §7). */
  const modalIn = t.prefs.reducedMotion ? 'none' as const : 'slide_from_bottom' as const
  const { user } = useAuth()
  const me = user?.id ? String(user.id) : null
  const { storyId } = useLocalSearchParams<{ storyId: string }>()
  const { connected } = useStoryTray(me)

  const [story, setStory] = React.useState<StoryRow | null>(null)
  const [viewers, setViewers] = React.useState<{ viewerId: string; viewedAt: string }[] | null>(null)
  const [people, setPeople] = React.useState<Record<string, ViewerPerson>>({})
  const [poll, setPoll] = React.useState<StoryPoll | null>(null)
  const [tally, setTally] = React.useState<Tally | null>(null)
  const [tab, setTab] = React.useState<'viewers' | 'poll'>('viewers')
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  const pushed = usePollTally(poll?.pollId)
  React.useEffect(() => { if (pushed) setTally(pushed) }, [pushed])

  /* ---- loads --------------------------------------------------------- */

  const loadViewers = React.useCallback(async () => {
    if (!storyId) return
    try {
      const rows = (await api.stories.viewers(storyId, VIEWER_PAGE)) || []
      setViewers(rows)
      setError(null)
      /* Hydrate in chunks and memoise: a rejected lookup renders a placeholder
         row rather than disappearing, because the count is already true. */
      const ids = [...new Set(rows.map((r: any) => String(r.viewerId)).filter(Boolean))] as string[]
      for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
        const slice = ids.slice(i, i + HYDRATE_CHUNK)
        const settled = await Promise.allSettled(slice.map(id => api.users.get(id)))
        setPeople(prev => {
          const next = { ...prev }
          settled.forEach((s, j) => {
            next[slice[j]] = (s.status === 'fulfilled' && s.value ? s.value : placeholderPerson(slice[j])) as ViewerPerson
          })
          return next
        })
      }
    } catch (e: any) {
      setError(e)
    }
  }, [storyId])

  const loadResults = React.useCallback(async (pollId: string) => {
    try {
      const r = await api.stories.results(pollId)
      setTally({ voteA: Number(r?.voteA) || 0, voteB: Number(r?.voteB) || 0 })
    } catch (e) { logApiError(e, 'GET', 'polls/results') }
  }, [])

  React.useEffect(() => {
    if (!storyId) return
    let alive = true
    void (async () => {
      setLoading(true)
      /* The only read that returns a story row is by-author — there is no
         get-one endpoint — so the frame's own metadata comes from your list. */
      if (me) {
        api.stories.byAuthor(me)
          .then((rows: StoryRow[]) => {
            if (alive) setStory((rows || []).find(r => String(r.storyId) === String(storyId)) ?? null)
          })
          .catch(() => {})
      }
      await loadViewers()
      try {
        const p = await api.stories.getPoll(storyId)
        if (alive && p?.pollId) { setPoll(p); await loadResults(p.pollId) }
      } catch (e: any) {
        if (!isNotFound(e)) logApiError(e, 'GET', 'stories/poll')
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [storyId, me, loadViewers, loadResults])

  /* Every `connected` means events were missed while the emitter was down, so
     the counters are re-read before any further push is trusted. */
  React.useEffect(() => {
    if (!connected || !poll?.pollId) return
    void loadResults(poll.pollId)
  }, [connected, poll?.pollId, loadResults])

  const refresh = async () => {
    setRefreshing(true)
    await loadViewers()
    if (poll?.pollId) await loadResults(poll.pollId)
    setRefreshing(false)
  }

  /* ---- the list's stable props ----------------------------------------
     FlashList's ViewHolder memo compares renderItem BY IDENTITY, so an inline
     arrow re-renders every mounted row on every hydrate chunk and every
     realtime tally. The two per-row handlers are cached per viewer id — the
     row's props are `() => void` and one closure per person, minted once, is
     what lets ViewerRow's own React.memo actually hit. Both read through
     useEvent wrappers, so a cached handler never goes stale. */
  const openProfile = useEvent((viewerId: string) => {
    const person = people[viewerId] ?? placeholderPerson(viewerId)
    router.push(`/u/${person.handle || person.id}` as any)
  })
  const messageViewer = useEvent((viewerId: string) => { void openDM(viewerId, router) })
  const rowHandlers = React.useRef(new Map<string, { press: () => void; message: () => void }>())
  const handlersFor = React.useCallback((viewerId: string) => {
    const cache = rowHandlers.current
    let pair = cache.get(viewerId)
    if (!pair) {
      pair = { press: () => openProfile(viewerId), message: () => messageViewer(viewerId) }
      cache.set(viewerId, pair)
    }
    return pair
  }, [openProfile, messageViewer])

  const renderViewer = React.useCallback(({ item }: { item: any }) => {
    const viewerId = String(item.viewerId)
    const person = people[viewerId] ?? placeholderPerson(viewerId)
    const handlers = handlersFor(viewerId)
    return <ViewerRow user={person} at={item.viewedAt} onPress={handlers.press} onMessage={handlers.message} />
  }, [people, handlersFor])

  const viewerCount = viewers?.length ?? 0
  const listHeader = React.useMemo(() => (
    <View style={styles.subHead}>
      <Text variant="callout" weight="600" color={ink.full} align="ui" style={styles.flex}>
        {viewerCount === 1 ? '1 viewer' : `${viewerCount} viewers`}
      </Text>
      <View style={styles.liveRow}>
        <View style={[styles.dot, { backgroundColor: connected ? night.success : ink.ghost }]} />
        {/* `micro` caps Latin inside the primitive — the literals stay in
            sentence case so ar/ckb is never force-capped. */}
        <Text variant="micro" color={connected ? night.success : ink.faint}>
          {connected ? 'Live' : 'Reconnecting…'}
        </Text>
      </View>
    </View>
  ), [viewerCount, connected])

  const overCap = viewerCount >= VIEWER_PAGE
  const listFooter = React.useMemo(() => (
    <View style={styles.footer}>
      {overCap ? (
        <Text variant="footnote" color={night.warning} align="ui">
          Showing the {VIEWER_PAGE} most recent viewers.
        </Text>
      ) : null}
      <Text variant="footnote" color={ink.faint} align="ui">Viewer lists disappear when the story does.</Text>
    </View>
  ), [overCap])

  /* ---- refusals ------------------------------------------------------- */

  const forbidden = error?.status === 403
  const missing = isNotFound(error)

  if (forbidden || missing) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: BLACK, padding: space.xxxl, gap: space.sm2 }]}>
        <Stack.Screen options={{ presentation: 'modal', animation: modalIn }} />
        <Icon name="lock" size={40} color={ink.muted} />
        <Text variant="title3" color={ink.full} align="center">
          {missing ? 'This story is no longer available.' : errorText(error)}
        </Text>
        <Button label="Close" onPress={() => router.back()} variant="tinted" style={{ marginTop: space.md }} />
      </View>
    )
  }

  const rows = viewers ?? []
  const votes = tally ? tally.voteA + tally.voteB : null

  return (
    <View style={[styles.fill, { backgroundColor: BLACK, paddingTop: insets.top ? 8 : 0 }]}>
      <Stack.Screen options={{ presentation: 'modal', animation: modalIn }} />

      <View style={styles.grabberWrap}><View style={[styles.grabber, { backgroundColor: ink.ghost }]} /></View>

      <View style={styles.head}>
        <Thumb story={story} />
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text variant="bodyStrong" color={ink.full} align="ui">
            {story ? adapters.timeAgo(story.createdAt) : 'Story'}
          </Text>
          <View style={styles.metaRow}>
            {story?.expiresAt ? <ExpiryChip expiresAt={story.expiresAt} plain /> : null}
            {story?.visibility ? (
              <Text variant="caption" color={ink.faint}>
                {story.expiresAt ? ' · ' : ''}{VISIBILITY_LABEL[String(story.visibility)] ?? ''}
              </Text>
            ) : null}
          </View>
        </View>
        <Touchable onPress={() => router.back()} feedback="scale" accessibilityLabel="Close" style={styles.iconBtn}>
          <Icon name="close" size={22} color={ink.full} />
        </Touchable>
      </View>

      <View style={styles.strip}>
        <Tile value={viewers == null ? '—' : String(rows.length)} label="Views" />
        <Tile value={votes == null ? '—' : String(votes)} label="Votes" />
        <Tile value={story?.expiresAt ? <ExpiryChip expiresAt={story.expiresAt} plain /> : '—'} label="Time left" />
      </View>

      {poll ? (
        <View style={[styles.segment, { backgroundColor: ink.fillStrong }]}>
          {(['viewers', 'poll'] as const).map(key => (
            <Touchable
              key={key}
              onPress={() => setTab(key)}
              feedback="none"
              haptic="select"
              noAutoHitSlop
              accessibilityState={{ selected: tab === key }}
              style={[styles.segmentBtn, tab === key ? { backgroundColor: ink.full } : null]}
            >
              <Text variant="subhead" weight="700" color={tab === key ? BLACK : ink.muted} align="center">
                {key === 'viewers' ? 'Viewers' : 'Poll'}
              </Text>
            </Touchable>
          ))}
        </View>
      ) : null}

      {loading ? (
        <StoryRowsSkeleton />
      ) : tab === 'poll' && poll ? (
        <PollTab poll={poll} tally={tally ?? { voteA: 0, voteB: 0 }} people={people} setPeople={setPeople} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={viewerKey}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ink.full} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={listFooter}
          renderItem={renderViewer}
        />
      )}
    </View>
  )
}

/* ---------------------------------------------------------
   Poll tab
   --------------------------------------------------------- */

function PollTab({
  poll, tally, people, setPeople,
}: {
  poll: StoryPoll
  tally: Tally
  people: Record<string, ViewerPerson>
  setPeople: React.Dispatch<React.SetStateAction<Record<string, ViewerPerson>>>
}) {
  const router = useRouter()
  const total = tally.voteA + tally.voteB
  const pctA = total ? Math.round((tally.voteA / total) * 100) : 0
  const pctB = total ? 100 - pctA : 0

  return (
    <View style={{ flex: 1 }}>
      <Text variant="title3" color={ink.full} align="auto" style={styles.question}>{poll.question}</Text>
      <OptionBlock
        poll={poll}
        choice="A"
        label={poll.optionA}
        count={tally.voteA}
        pct={pctA}
        leading={total > 0 && tally.voteA >= tally.voteB}
        people={people}
        setPeople={setPeople}
        onOpenProfile={id => router.push(`/u/${id}` as any)}
      />
      <OptionBlock
        poll={poll}
        choice="B"
        label={poll.optionB}
        count={tally.voteB}
        pct={pctB}
        leading={total > 0 && tally.voteB > tally.voteA}
        people={people}
        setPeople={setPeople}
        onOpenProfile={id => router.push(`/u/${id}` as any)}
      />
      <Text variant="footnote" color={ink.faint} align="ui" style={styles.note}>Only you can see who voted.</Text>
    </View>
  )
}

function OptionBlock({
  poll, choice, label, count, pct, leading, people, setPeople, onOpenProfile,
}: {
  poll: StoryPoll
  choice: 'A' | 'B'
  label: string
  count: number
  pct: number
  leading: boolean
  people: Record<string, ViewerPerson>
  setPeople: React.Dispatch<React.SetStateAction<Record<string, ViewerPerson>>>
  onOpenProfile: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [voters, setVoters] = React.useState<VoteRow[] | null>(null)
  const [denied, setDenied] = React.useState(false)
  const t = useTheme()

  const target = useDerivedValue(() => withTiming(pct, { duration: t.ms(300) }), [pct])

  /* CLIP-TRANSLATE, not scaleX — and the difference is the whole point on a
     48pt bar. The fill keeps its own 12pt radius so the leading cap stays a
     true circle; scaleX would squash that cap into an oval that changes shape
     as the tally moves (at 20% it becomes a lens). Instead the fill is laid
     out full-width ONCE and slid sideways; the track's own overflow:'hidden'
     eats whatever hangs past the start edge and rounds what is left. Sliding
     is a transform, so no layout runs per frame; the price is that a translate
     needs POINTS, not a percentage, hence the measured width below.

     Do not "simplify" this back into a scaleX. */
  const w = useSharedValue(0)
  const rtl = t.isRTL /* hoisted: capture a boolean in the worklet, not the theme */
  const fill = useAnimatedStyle(() => {
    const f = Math.max(0, Math.min(1, target.value / 100))
    /* Travel is PHYSICAL and does not mirror itself: LTR slides the box out to
       the left, RTL to the right. Hidden until measured — one frame of nothing
       beats one frame of a bar that reads 100%. */
    const travel = (1 - f) * w.value
    return {
      opacity: w.value > 0 ? 1 : 0,
      transform: [{ translateX: rtl ? travel : -travel }],
    }
  })

  const expand = async () => {
    setOpen(o => !o)
    if (voters || denied) return
    try {
      const rows = (await api.stories.voters(poll.pollId, choice, VOTER_PAGE)) || []
      setVoters(rows)
      const ids = [...new Set(rows.map((r: any) => String(r.voterId)))] as string[]
      const settled = await Promise.allSettled(ids.map(id => api.users.get(id)))
      setPeople(prev => {
        const next = { ...prev }
        settled.forEach((s, i) => {
          next[ids[i]] = (s.status === 'fulfilled' && s.value ? s.value : placeholderPerson(ids[i])) as ViewerPerson
        })
        return next
      })
    } catch (e: any) {
      /* ACCESS_FORBIDDEN also fires for polls created before the reverse index
         existed. The tallies stay; only the names go. */
      if (e?.status === 403) setDenied(true)
      else toast.error(errorText(e))
    }
  }

  return (
    <View style={styles.optionWrap}>
      <View
        style={[styles.track, { backgroundColor: ink.fillStrong }]}
        onLayout={e => { w.value = e.nativeEvent.layout.width }}
      >
        <Animated.View
          style={[styles.trackFill, { backgroundColor: withAlpha(choice === 'A' ? POLL_A : POLL_B, 0.45) }, fill]}
        />
        <Text variant="bodyStrong" weight={leading ? '800' : '600'} color={ink.full} align="ui" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {leading ? <Icon name="check" size={14} color={ink.full} /> : null}
        <Text variant="callout" weight="700" color={ink.full} style={{ marginStart: space.sm }}>{count} · {pct}%</Text>
      </View>

      {denied ? (
        <Text variant="footnote" color={ink.faint} align="ui" style={styles.disclosure}>
          Voter names aren’t available for this poll.
        </Text>
      ) : (
        <Touchable onPress={expand} feedback="dim" noAutoHitSlop style={styles.disclosure}>
          <Text variant="subhead" color={ink.muted} align="ui" style={{ flex: 1 }}>See who voted</Text>
          <Icon name={open ? 'up' : 'down'} size={15} color={ink.muted} />
        </Touchable>
      )}

      {open && voters ? (
        <View>
          {voters.length === 0 ? (
            <Text variant="footnote" color={ink.faint} align="ui" style={styles.disclosure}>No votes for this option yet.</Text>
          ) : voters.map(v => {
            const person = people[String(v.voterId)] ?? placeholderPerson(String(v.voterId))
            return (
              <ViewerRow
                key={String(v.voterId)}
                user={person}
                at={v.votedAt}
                onPress={() => onOpenProfile(person.handle || person.id)}
              />
            )
          })}
          {/* A full page means there is no way to know how many more there
              are — the endpoint has no cursor. Say what the list IS rather
              than letting it read as the whole tally. */}
          {voters.length >= VOTER_PAGE ? (
            <Text variant="footnote" color={night.warning} align="ui" style={styles.disclosure}>
              Showing the {VOTER_PAGE} most recent voters.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Bits
   --------------------------------------------------------- */

function Thumb({ story }: { story: StoryRow | null }) {
  const uri = story ? posterOf(story) : null
  const [g0, g1] = frameGradient(story?.storyId || 'story')
  return (
    <View style={[styles.thumb, { backgroundColor: ink.fill }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={story?.storyId}
        />
      ) : (
        <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
    </View>
  )
}

function Tile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: ink.fill }]}>
      {typeof value === 'string'
        ? <Text variant="title2" weight="700" color={ink.full} align="center">{value}</Text>
        : value}
      {/* `micro` caps Latin inside the primitive and leaves Arabic alone. */}
      <Text variant="micro" color={ink.faint} align="center">{label}</Text>
    </View>
  )
}

async function openDM(userId: string, router: ReturnType<typeof useRouter>) {
  try {
    const convo = await api.chat.conversations.createDirect(userId)
    if (convo?.id) router.push(`/chat/${convo.id}` as any)
  } catch (e: any) {
    toast.error(errorText(e))
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grabberWrap: { alignItems: 'center', paddingVertical: space.sm },
  grabber: { width: 36, height: 4, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md2 },
  thumb: { width: 48, height: 64, borderRadius: 8, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  tile: {
    flex: 1,
    height: 64,
    ...setback(shape.card),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  /* SegmentedControl per DESIGN.md §6: setback track, setback thumb. It was a
     pill pair; the sanctioned pills are unread counters and LIVE badges. */
  segment: {
    flexDirection: 'row',
    height: 36,
    ...setback(shape.buttonMd),
    borderCurve: 'continuous',
    padding: space.xs,
    marginHorizontal: space.lg,
    marginTop: space.lg,
  },
  segmentBtn: {
    flex: 1,
    ...setback(shape.buttonSm),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHead: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: space.lg },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  empty: { alignItems: 'center', paddingTop: 96, paddingHorizontal: space.xxxl },
  emptyTitle: { marginTop: space.md },
  flex: { flex: 1 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md2, paddingBottom: space.huge, gap: space.xs2 },
  question: { paddingHorizontal: space.lg, marginTop: space.md, marginBottom: space.xs },
  optionWrap: { paddingHorizontal: space.lg, marginTop: space.md },
  track: { height: 48, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md2 },
  /* Full-bleed and laid out once; the tally moves it with translateX and the
     track's overflow:'hidden' eats the overhang. `start`/`end` rather than the
     old physical `left`, so the fill grows from the reading edge in Arabic and
     Kurdish too. It keeps its radius — that is exactly what clip-translate
     buys over scaleX. */
  trackFill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderRadius: 12 },
  disclosure: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: space.xxs },
  note: { paddingHorizontal: space.lg, marginTop: space.lg2 },
})
