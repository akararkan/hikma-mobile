/* =========================================================
   Stories — the hub.

   The rail on the feed is deliberately silent: it renders
   nothing when there is nothing and never shows an error. This
   is where the same data gets to speak at full size, so the
   empty state, the offline strip and the "your story failed to
   load" line all live here rather than up there.
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isHeld } from '@/lib/moderation'
import { isMyStoryUnseen, isStoryUnseen, markMyStorySeen, markStorySeen } from '@/lib/storySeen'
import { useMyStoryViews } from '@/lib/storyTray'
import { setback, shape, space } from '@/theme/tokens'
import { ActionSheet, Button, Header, Icon, Screen, Text, Touchable, fireHaptic, toast } from '@/ui'
import { HighlightPill, NewHighlightPill, type HighlightRow } from '@/components/stories/HighlightPill'
import { StoryRing } from '@/components/stories/StoryRing'
import { StoryCardSkeleton, StoryGridSkeleton } from '@/components/stories/StorySkeleton'
import { BLACK, RING_STEEL, ink, night, shade } from '@/components/stories/night'
import { refreshTray, useStoryTray, type TrayEntry } from '@/components/stories/trayStore'
import { fmtLeft, frameGradient, newestAt, soonestExpiry, type StoryRow } from '@/components/stories/storyVisual'

const GUTTER = 8
const PAD = 16

export default function StoriesHubScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const me = user?.id ? String(user.id) : null
  const { width } = useWindowDimensions()
  const cell = (width - PAD * 2 - GUTTER * 2) / 3

  const { tray, loading: trayLoading } = useStoryTray(me)

  /* The rail swallows this failure by design; the hub is where it gets to be
     visible, so the card reads its own copy rather than the store's. */
  const mine = useAsync<StoryRow[]>(() => api.stories.byAuthor(me), { enabled: !!me, deps: [me] })
  const highlights = useAsync<HighlightRow[]>(() => api.highlights.byAuthor(me), { enabled: !!me, deps: [me] })

  const [epoch, setEpoch] = React.useState(0)
  useFocusEffect(React.useCallback(() => { setEpoch(n => n + 1); void mine.refresh(); return undefined }, [me]))   // eslint-disable-line react-hooks/exhaustive-deps

  const frames = mine.data ?? []
  const { views, refresh: refreshViews } = useMyStoryViews(frames, epoch)
  const myNewest = React.useMemo(() => newestAt(frames), [frames])
  const [menuFor, setMenuFor] = React.useState<TrayEntry | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const refreshAll = async () => {
    setRefreshing(true)
    await Promise.all([refreshTray(true), mine.refresh(), highlights.refresh()])
    refreshViews()
    setRefreshing(false)
  }

  const openMine = () => {
    if (!me) return
    if (!frames.length) { router.push('/story/compose' as any); return }
    markMyStorySeen(myNewest, views)
    setEpoch(n => n + 1)
    router.push(`/story/${me}` as any)
  }

  const openAuthor = (entry: TrayEntry) => {
    markStorySeen(String(entry.authorId), entry.at)
    setEpoch(n => n + 1)
    router.push(`/story/${entry.authorId}?source=tray` as any)
  }

  const held = frames.filter(isHeld).length
  const offline = isNetworkError(mine.error)

  return (
    <Screen style={{ backgroundColor: BLACK }}>
      <Header
        back
        large
        overlay
        border={false}
        title="Stories"
        actions={[
          { icon: 'star', label: 'Close friends', onPress: () => router.push('/close-friends' as any), tone: 'default' },
          { icon: 'addCircle', label: 'New story', onPress: () => router.push('/story/compose' as any) },
        ]}
      />

      {offline ? (
        <View style={[styles.offline, { backgroundColor: night.warningSoft }]}>
          <Icon name="offline" size={14} color={night.warning} />
          <Text variant="footnote" color={night.warning} align="ui">You’re offline — showing what we have.</Text>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={ink.full} />}
      >
        {/* SECTION A — your story */}
        {mine.loading ? <StoryCardSkeleton /> : (
          <Touchable
            onPress={openMine}
            onLongPress={() => { fireHaptic('light'); router.push('/story/mine' as any) }}
            feedback="scale"
            noAutoHitSlop
            style={[styles.card, { backgroundColor: ink.fill }]}
          >
            <StoryRing
              uri={user?.profileImage || null}
              initials={(user?.displayName || user?.handle || 'You').slice(0, 2).toUpperCase()}
              size={64}
              state={!frames.length ? 'own-empty' : isMyStoryUnseen(myNewest, views) ? 'unseen' : 'seen'}
              gapColor={BLACK}
            />
            <View style={styles.cardText}>
              <Text variant="headline" color={ink.full} align="ui" numberOfLines={1}>
                {frames.length ? 'Your story' : 'Add to your story'}
              </Text>
              <MyStoryLine
                frames={frames}
                views={views}
                held={held}
                error={mine.error}
                onRetry={() => void mine.reload()}
              />
            </View>
            <Touchable
              onPress={() => router.push('/story/compose' as any)}
              feedback="scale"
              accessibilityLabel="New story"
              style={[styles.ghostBtn, { borderColor: ink.hairline }]}
            >
              <Icon name="add" size={20} color={ink.full} />
            </Touchable>
          </Touchable>
        )}

        {/* SECTION B — recent */}
        <SectionLabel>Recent</SectionLabel>
        {trayLoading && !tray.length ? (
          <StoryGridSkeleton screenWidth={width} />
        ) : !tray.length ? (
          <View style={styles.empty}>
            <Icon name="camera" size={56} color={ink.ghost} />
            <Text variant="title3" color={ink.full} align="center" style={{ marginTop: space.md2 }}>No stories yet</Text>
            <Text variant="callout" color={ink.muted} align="center" style={styles.emptyBody}>
              Stories from people you follow show up here and disappear after 24 hours.
            </Text>
            <Button label="Add yours" onPress={() => router.push('/story/compose' as any)} variant="onDark" style={{ marginTop: space.lg2 }} />
          </View>
        ) : (
          <View style={[styles.grid, { gap: GUTTER }]}>
            {tray.map(entry => (
              <TrayCell
                key={String(entry.authorId)}
                entry={entry}
                size={cell}
                unseen={isStoryUnseen(entry.authorId, entry.at)}
                onPress={() => openAuthor(entry)}
                onLongPress={() => { fireHaptic('light'); setMenuFor(entry) }}
              />
            ))}
          </View>
        )}

        {/* SECTION C — highlights. Hidden entirely when there are none, and
            silently when the read failed: a rail of archives is not worth an
            error state on someone else's screen. */}
        {highlights.data?.length ? (
          <>
            <SectionLabel>Highlights</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              <NewHighlightPill onPress={() => router.push('/highlight/new' as any)} />
              {highlights.data.map(h => (
                <HighlightPill
                  key={String(h.highlightId)}
                  highlight={h}
                  onPress={() => router.push(`/highlight/${h.highlightId}` as any)}
                />
              ))}
              <Touchable
                onPress={() => me && router.push(`/highlights/${me}` as any)}
                feedback="scale"
                noAutoHitSlop
                style={[styles.seeAll, { borderColor: ink.hairline }]}
              >
                <Text variant="caption" color={ink.muted} align="center">See all</Text>
                <Icon name="forward" size={14} color={ink.muted} />
              </Touchable>
            </ScrollView>
          </>
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.author?.full}
        actions={[
          {
            label: 'View profile',
            icon: 'person',
            onPress: () => router.push(`/u/${menuFor?.author?.handle || menuFor?.authorId}` as any),
          },
          {
            label: 'Mute stories',
            icon: 'mutedBell',
            onPress: async () => {
              if (!menuFor) return
              try {
                await api.settings.privacy.muted.mute(menuFor.authorId)
                toast.ok('Stories muted')
                void refreshTray(true)
              } catch (e: any) { toast.error(errorText(e)) }
            },
          },
          /* No Report here: a tray entry names an AUTHOR, not a story, and the
             safety endpoint needs the story's id. It is offered in the viewer,
             where there is one. */
        ]}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The card's second line carries four different truths.
   --------------------------------------------------------- */

function MyStoryLine({
  frames, views, held, error, onRetry,
}: { frames: StoryRow[]; views: number | null; held: number; error: any; onRetry: () => void }) {
  if (error) {
    return (
      <View style={styles.retryRow}>
        <Text variant="subhead" color={night.dangerText} align="ui" numberOfLines={1} style={{ flex: 1 }}>
          {errorText(error)}
        </Text>
        <Touchable onPress={onRetry} feedback="dim" style={{ paddingHorizontal: space.xs2 }}>
          <Text variant="subhead" color={night.accentText}>Retry</Text>
        </Touchable>
      </View>
    )
  }

  if (!frames.length) {
    return <Text variant="subhead" color={ink.soft} align="ui" numberOfLines={1}>Share a photo, a video or a thought.</Text>
  }

  /* `views == null` is UNKNOWN, not zero: a failed probe must never render as
     "0 viewers". */
  const count = frames.length === 1 ? '1 frame' : `${frames.length} frames`
  const soonest = soonestExpiry(frames)
  const tail = views != null
    ? ` · ${views === 1 ? '1 viewer' : `${views} viewers`}`
    : soonest ? ` · oldest goes in ${fmtLeft(soonest)}` : ''

  return (
    <View style={styles.retryRow}>
      <Text variant="subhead" color={ink.soft} align="ui" numberOfLines={1}>{count}{tail}</Text>
      {held ? (
        <View style={[styles.heldChip, { backgroundColor: ink.fillStrong }]}>
          <Text variant="micro" color={ink.full}>Checking…</Text>
        </View>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   One author, as a poster.
   --------------------------------------------------------- */

function TrayCell({
  entry, size, unseen, onPress, onLongPress,
}: { entry: TrayEntry; size: number; unseen: boolean; onPress: () => void; onLongPress: () => void }) {
  const [g0, g1] = frameGradient(String(entry.authorId))
  const body = (
    <View style={[styles.cellInner, { borderRadius: 12 }]}>
      {entry.cover ? (
        <Image
          source={{ uri: entry.cover }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={String(entry.authorId)}
        />
      ) : (
        <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={[shade.clear, shade.scrimBottom]} style={styles.cellScrim} />

      <View style={styles.cellAvatar}>
        <StoryRing
          uri={entry.author?.profileImage || null}
          initials={entry.author?.initials || '··'}
          avc={entry.author?.avc}
          size={26}
          state={unseen ? 'unseen' : 'seen'}
          gapColor={BLACK}
        />
      </View>

      {entry.count > 1 ? (
        <View style={[styles.countPill, { backgroundColor: shade.chip }]}>
          <Text variant="micro" color={ink.full} align="center">{entry.count}</Text>
        </View>
      ) : null}

      <View style={styles.cellText}>
        <Text variant="caption" color={ink.full} numberOfLines={1}>{entry.author?.full || 'Member'}</Text>
        <Text variant="micro" weight="400" color={ink.muted} numberOfLines={1}>{entry.time}</Text>
      </View>
    </View>
  )

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`${entry.author?.full || 'Member'}'s story`}
      style={{ width: size, height: size * 1.5 }}
    >
      {unseen ? (
        /* Steel border, not the retired gradient — SealRing law (§5). */
        <View style={[styles.cellUnseen, { borderColor: RING_STEEL }]}>{body}</View>
      ) : (
        <View style={[styles.cellSeen, { borderColor: ink.hairline }]}>{body}</View>
      )}
    </Touchable>
  )
}

/* `caption` uppercases LATIN ONLY, inside the Text primitive, and forces
   letterSpacing to 0 on an Arabic-script run. A call-site .toUpperCase() plus
   a hardcoded tracking value could do neither. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" weight="700" color={ink.faint} align="ui" style={styles.sectionLabel}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.huge },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 32, paddingHorizontal: PAD },
  card: {
    height: 96,
    marginHorizontal: PAD,
    ...setback(shape.card),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    padding: space.md2,
  },
  cardText: { flex: 1, gap: space.xs },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  heldChip: {
    paddingHorizontal: space.sm,
    height: 18,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { paddingHorizontal: PAD, marginTop: space.xxl, marginBottom: space.sm2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAD },
  cellUnseen: { flex: 1, borderRadius: 14, borderWidth: 2, padding: space.xxs },
  cellSeen: { flex: 1, borderRadius: 14, borderWidth: 1, padding: space.xxs },
  cellInner: { flex: 1, overflow: 'hidden' },
  cellScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },
  cellAvatar: { position: 'absolute', top: 6, start: 6 },
  /* A count badge — one of the two sanctioned pills (DESIGN.md §3). */
  countPill: {
    position: 'absolute',
    top: 6,
    end: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: space.xs2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { position: 'absolute', start: 8, end: 6, bottom: 7 },
  empty: { alignItems: 'center', paddingTop: space.huge, paddingHorizontal: space.xxxl },
  emptyBody: { maxWidth: 280, marginTop: space.xs },
  rail: { gap: space.md2, paddingHorizontal: PAD, alignItems: 'flex-start' },
  seeAll: {
    height: 64,
    paddingHorizontal: space.md,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
})
