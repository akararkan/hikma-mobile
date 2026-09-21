/* =========================================================
   Live — discovery.

   Two independent arms. `followingLive()` and `live()` fail
   separately and must render separately: a failing "Following"
   row that blanks the Discover grid turns one dead endpoint
   into an empty product.

   An EMPTY following array is an empty state, not an error —
   the whole section collapses, heading included. Nobody wants
   a heading that says "Following" over nothing.

   Rail counts are approximate by design: `stream.viewer` is
   not fanned out to a host's followers, so a rail number
   drifts until the next fetch. That is the server's contract,
   not a bug to paper over with a poll.
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { applyStreamEvent } from '@/lib/liveRows'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Icon, Screen, Header, Skeleton, Text, Touchable,
  useSheetState,
} from '@/ui'
import { LiveCard, LiveRailCell } from '@/components/live/LiveCard'
import type { LiveStream } from '@/components/live/types'

/* liveRows.js is JavaScript, so its `{ skipHostId = null }` default infers as
   `null | undefined`. One typed alias beats an `as any` at both call sites. */
const foldRows = applyStreamEvent as (
  rows: LiveStream[],
  evt: any,
  opts?: { skipHostId?: string | null },
) => LiveStream[]

/* Module scope — FlashList compares by identity. */
const keyExtractor = (s: LiveStream) => String(s.id)

export default function LiveScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { user } = useAuth()

  const [following, setFollowing] = React.useState<LiveStream[]>([])
  const [discover, setDiscover] = React.useState<LiveStream[]>([])
  const [followErr, setFollowErr] = React.useState<any>(null)
  const [discoverErr, setDiscoverErr] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const menu = useSheetState<LiveStream>()

  const load = React.useCallback(async (mode: 'load' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true); else setLoading(true)
    /* Two arms, deliberately not Promise.all with one catch: one failing must
       not take the other's rows off the screen. */
    await Promise.all([
      (async () => {
        try { setFollowing((await api.chat.streams.followingLive()) || []); setFollowErr(null) }
        catch (e) { setFollowErr(e) }
      })(),
      (async () => {
        try { setDiscover((await api.chat.streams.live()) || []); setDiscoverErr(null) }
        catch (e) { setDiscoverErr(e) }
      })(),
    ])
    setLoading(false)
    setRefreshing(false)
  }, [])

  React.useEffect(() => { void load('load') }, [load])

  /* One subscription, two reducers. `applyStreamEvent` returns the SAME array
     when nothing changed, so this is safe on every frame on the socket. */
  useChatEvents(evt => {
    if (!String(evt?.type || '').startsWith('stream.')) return
    setFollowing(prev => foldRows(prev, evt, { skipHostId: user?.id ?? null }))
    setDiscover(prev => foldRows(prev, evt))
  })

  const gutter = 12
  const cardW = (width - t.layout.screenPadding * 2 - gutter) / 2
  const offline = isNetworkError(followErr) || isNetworkError(discoverErr)

  /* Identity-stable, so the two memoized cells below actually skip work when
     a `stream.*` frame lands and only one row's viewer count moved. */
  /* Directory taps open the PAGER; deep links keep the classic room. */
  const open = useEvent((s: LiveStream) => router.push(`/live/watch?start=${s.id}`))
  const openMenu = useEvent((s: LiveStream) => menu.open(s))

  /* Everything above the grid rides the list header, so the grid itself can
     be a real FlashList: the old ScrollView `.map` mounted EVERY discover
     card — and decoded every thumbnail — up front, on the one directory
     whose length is the whole platform's live census. */
  const listHeader = React.useMemo(() => (
    <>
      <View style={styles.goLiveRow}>
        {/* The page's one hot control — the web paints it live red
            (`.lv-head-acts .btn-primary{ background:var(--live) }`), not a
            second navy button. `danger` IS that plate: light liveDot and
            danger share #9C3A33. */}
        <Button
          label="Go live"
          icon="broadcast"
          onPress={() => router.push('/live/go')}
          variant="danger"
          size="md"
        />
      </View>

      {offline ? (
        <View style={[styles.strip, { backgroundColor: c.surfaceSunken }]}>
          <Icon name="offline" size={14} color={c.textMuted} />
          <Text variant="footnote" tone="muted" align="ui">Offline — this list may be out of date</Text>
        </View>
      ) : null}

      {/* Following — collapses entirely when empty. The rail rides a
          hairline card plate, the web's `.lv-rail` (§9.5): the ring cells
          sit on a card, not loose on the page. */}
      {loading ? (
        <RailSkeleton />
      ) : following.length ? (
        <View style={styles.section}>
          <View style={[styles.railCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: t.radius.card }]}>
            <View style={styles.railHead}>
              <Text variant="title3" serif align="ui" style={styles.flex}>Following</Text>
              <Text variant="footnote" tone="muted" align="ui">{following.length} live right now</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {following.map(s => <RailCell key={s.id} stream={s} onPress={open} />)}
            </ScrollView>
          </View>
        </View>
      ) : followErr && !offline ? (
        <InlineArm error={followErr} onRetry={() => load('load')} />
      ) : null}

      {/* Discover — serif masthead over a muted byline, the web's `.lv-sec`. */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="title3" serif align="ui" style={styles.flex}>Live now</Text>
          <Text variant="footnote" tone="muted" align="ui">most watched first</Text>
        </View>

        {loading ? (
          <View style={styles.grid}>
            {/* Thumb + three text lines — the paper card's real height. */}
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} width={cardW} height={cardW * 9 / 16 + 96} radius={t.radius.card} style={styles.gridCell} />
            ))}
          </View>
        ) : discoverErr && !discover.length ? (
          <InlineArm error={discoverErr} onRetry={() => load('load')} />
        ) : !discover.length ? (
          <View style={styles.empty}>
            <Icon name="broadcast" size={52} color={c.textFaint} />
            <Text variant="title3" align="center" style={styles.emptyTitle}>Nobody is live right now</Text>
            <Text variant="callout" tone="muted" align="center" style={styles.emptyCopy}>
              Be the first — start a stream and your followers get a ping.
            </Text>
            <Button label="Go live" onPress={() => router.push('/live/go')} variant="danger" size="md" style={styles.emptyBtn} />
          </View>
        ) : null}
      </View>
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [loading, following, followErr, discoverErr, discover.length, offline, cardW, c, t.radius.card, load, open, router])

  /* Column parity through logical padding reproduces the old 16/12/16 rhythm
     exactly ((width − 44) / 2 per card) and mirrors correctly in RTL. */
  const renderItem = React.useCallback(({ item, index }: { item: LiveStream; index: number }) => (
    <View style={index % 2 === 0 ? styles.cellStart : styles.cellEnd}>
      <DiscoverCard stream={item} onPress={open} onLongPress={openMenu} style={styles.cellCard} />
    </View>
  ), [open, openMenu])

  return (
    <Screen>
      <Header
        large
        title="Live"
        back
        actions={[{ icon: 'more', onPress: () => router.push('/live/mine'), label: 'My streams' }]}
      />

      <FlashList
        data={loading ? [] : discover}
        numColumns={2}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 84 }}
        ListHeaderComponent={listHeader}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
      />

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.title}
        subtitle={menu.payload ? `@${menu.payload.hostHandle}` : undefined}
        actions={[
          { label: 'Watch', icon: 'play', onPress: () => menu.payload && open(menu.payload) },
          {
            label: 'Share',
            icon: 'share',
            /* `shareUrl` is the ONLY link that is safe to hand out — ingestUrl
               and whipUrl carry the host's stream key. */
            hidden: !menu.payload?.shareUrl,
            onPress: () => {
              const url = menu.payload?.shareUrl
              if (url) void Share.share({ message: url, url })
            },
          },
          {
            label: `Open @${menu.payload?.hostHandle ?? ''}`,
            icon: 'person',
            hidden: !menu.payload?.hostHandle,
            onPress: () => router.push(`/u/${menu.payload?.hostHandle}`),
          },
          {
            /* ReportTargetType has no livestream value — the backend's only
               handle on a bad stream is its host, so the report targets the
               HOST as a USER and the label says so. */
            label: 'Report host',
            icon: 'flag',
            destructive: true,
            hidden: !menu.payload?.hostId,
            onPress: () => {
              const s = menu.payload
              if (s?.hostId) {
                router.push(reportHref({
                  targetType: 'USER',
                  targetId: String(s.hostId),
                  name: s.hostDisplayName || (s.hostHandle ? `@${s.hostHandle}` : undefined),
                  avatar: s.hostAvatarUrl ?? undefined,
                }))
              }
            },
          },
        ]}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The two grid cells.

   Both are memoized and take item-first handlers, so the press
   closure is built inside the boundary — one stable function
   serves the grid and a viewer-count frame repaints one card
   instead of all of them.
   --------------------------------------------------------- */

const DiscoverCard = React.memo(function DiscoverCard({
  stream, onPress, onLongPress, style,
}: {
  stream: LiveStream
  onPress: (s: LiveStream) => void
  onLongPress: (s: LiveStream) => void
  style?: any
}) {
  const press = React.useCallback(() => onPress(stream), [onPress, stream])
  const longPress = React.useCallback(() => onLongPress(stream), [onLongPress, stream])
  return <LiveCard stream={stream} onPress={press} onLongPress={longPress} style={style} />
})

const RailCell = React.memo(function RailCell({
  stream, onPress,
}: { stream: LiveStream; onPress: (s: LiveStream) => void }) {
  const press = React.useCallback(() => onPress(stream), [onPress, stream])
  return <LiveRailCell stream={stream} onPress={press} />
})

function RailSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><Skeleton width={110} height={20} /></View>
      <View style={styles.rail}>
        {Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={styles.railSkelCell}>
            <Skeleton circle width={68} height={68} />
            <Skeleton width={60} height={10} style={styles.railSkelBar} />
          </View>
        ))}
      </View>
    </View>
  )
}

function InlineArm({ error, onRetry }: { error: any; onRetry: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.arm, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md }]}>
      <Text variant="footnote" tone="muted" align="ui" style={styles.flex} numberOfLines={2}>
        {errorText(error)}
      </Text>
      <Touchable onPress={onRetry} feedback="dim" accessibilityLabel="Try again">
        <Text variant="subhead" tone="accent" align="ui">Try again</Text>
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  goLiveRow: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xs2, alignItems: 'flex-start' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, paddingHorizontal: space.md, height: 28, borderRadius: 8 },
  section: { paddingTop: space.md2 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  railCard: { marginHorizontal: space.lg, paddingVertical: space.md, borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous' },
  railHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingHorizontal: space.md2, paddingBottom: space.sm2 },
  rail: { flexDirection: 'row', paddingHorizontal: space.md2, gap: space.md2 },
  railSkelCell: { width: 84, alignItems: 'center' },
  railSkelBar: { marginTop: space.sm2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg, justifyContent: 'space-between' },
  gridCell: { marginBottom: space.md },
  /* FlashList numColumns cells: each column is half the list width, and the
     start/end padding pair rebuilds the 16-gutter-12-gutter-16 rhythm. */
  cellStart: { paddingStart: space.lg, paddingEnd: space.xs2, paddingBottom: space.md },
  cellEnd: { paddingStart: space.xs2, paddingEnd: space.lg, paddingBottom: space.md },
  cellCard: { width: '100%' },
  empty: { alignItems: 'center', paddingHorizontal: space.xxxl, paddingVertical: 44 },
  emptyTitle: { marginTop: space.md2 },
  emptyCopy: { marginTop: space.xs, maxWidth: 300 },
  emptyBtn: { marginTop: space.lg2 },
  arm: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.lg, padding: space.lg, minHeight: 72 },
  flex: { flex: 1 },
})
