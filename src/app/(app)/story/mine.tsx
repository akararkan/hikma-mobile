/* =========================================================
   Your story — the manager.

   Everything you can do to a live frame in one grid. It is not
   a player: the order here is newest-first, the order in the
   viewer is oldest-first, and swapping them would be the kind
   of quiet inconsistency nobody can name but everybody feels.
   ========================================================= */
import React from 'react'
import { AppState, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNetworkError, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { isHeld, isRemoved, recheckDelays } from '@/lib/moderation'
import { useMyStoryViews } from '@/lib/storyTray'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Button, ConfirmSheet, Header, Icon, Screen, Text, fireHaptic, toast,
} from '@/ui'
import { AddToHighlightSheet } from '@/components/stories/AddToHighlightSheet'
import { ExpiryChip } from '@/components/stories/ExpiryChip'
import { HighlightPill, NewHighlightPill, type HighlightRow } from '@/components/stories/HighlightPill'
import { ModerationBadge } from '@/components/stories/ModerationBadge'
import { StoryPoster } from '@/components/stories/StoryPoster'
import { StoryGridSkeleton, StoryStatStripSkeleton } from '@/components/stories/StorySkeleton'
import { BLACK, URGENT, ink, night, shade } from '@/components/stories/night'
import { invalidateStories } from '@/components/stories/trayStore'
import { fmtLeft, soonestExpiry, type StoryRow } from '@/components/stories/storyVisual'
import { VISIBILITY_GLYPH } from '@/components/stories/visibility'

const GUTTER = 8
const PAD = 16
/** How many viewer probes we are willing to have in the air at once. */
const PROBE_CHUNK = 5

export default function MyStoryScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const me = user?.id ? String(user.id) : null
  const { width } = useWindowDimensions()
  const cell = (width - PAD * 2 - GUTTER * 2) / 3

  const stories = useAsync<StoryRow[]>(() => api.stories.byAuthor(me), { enabled: !!me, deps: [me] })
  const highlights = useAsync<HighlightRow[]>(() => api.highlights.byAuthor(me), { enabled: !!me, deps: [me] })

  const rows = React.useMemo(() => stories.data ?? [], [stories.data])
  const [epoch, setEpoch] = React.useState(0)
  const { views, refresh: refreshViews } = useMyStoryViews(rows, epoch)

  const [perFrame, setPerFrame] = React.useState<Record<string, number>>({})
  const [menuFor, setMenuFor] = React.useState<StoryRow | null>(null)
  const [highlightFor, setHighlightFor] = React.useState<StoryRow | null>(null)
  const [deleteFor, setDeleteFor] = React.useState<StoryRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)

  /* A countdown that is never re-read starts lying within the minute, and an
     expired row simply vanishes from the server's answer — there is no sweep
     job and no read-time filter, so re-reading is the only way to notice. */
  useFocusEffect(React.useCallback(() => {
    void stories.refresh()
    const id = setInterval(() => {
      /* Focus is not foreground: backgrounding the app from this screen leaves
         the screen focused, so without this the countdown nobody can see costs
         a read every thirty seconds. The tick after the resume catches up. */
      if (AppState.currentState !== 'active') return
      void stories.refresh()
    }, 30000)
    return () => clearInterval(id)
  }, [me]))   // eslint-disable-line react-hooks/exhaustive-deps

  /* A hold clears silently. Re-poll on the server's own back-off, and stop as
     soon as nothing is held. */
  const held = rows.some(isHeld)
  React.useEffect(() => {
    if (!held) return undefined
    const timers = recheckDelays('STORY').map((ms: number) => setTimeout(() => void stories.refresh(), ms))
    return () => timers.forEach(clearTimeout)
  }, [held])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Per-cell viewer counts, chunked. A rejected probe leaves the badge blank:
     rendering 0 from a failure would be a lie about who saw you. */
  React.useEffect(() => {
    if (!rows.length) return undefined
    let alive = true
    void (async () => {
      for (let i = 0; i < rows.length; i += PROBE_CHUNK) {
        const slice = rows.slice(i, i + PROBE_CHUNK)
        const settled = await Promise.allSettled(slice.map(r => api.stories.viewers(r.storyId, 50)))
        if (!alive) return
        setPerFrame(prev => {
          const next = { ...prev }
          settled.forEach((s, j) => {
            if (s.status !== 'fulfilled') return
            const ids = new Set((s.value || []).map((v: any) => String(v.viewerId)).filter(Boolean))
            next[String(slice[j].storyId)] = ids.size
          })
          return next
        })
      }
    })()
    return () => { alive = false }
  }, [rows, epoch])

  const refreshAll = async () => {
    setRefreshing(true)
    setEpoch(n => n + 1)
    await Promise.all([stories.refresh(), highlights.refresh()])
    refreshViews()
    setRefreshing(false)
  }

  const remove = async (row: StoryRow) => {
    setDeleting(true)
    const index = rows.findIndex(r => String(r.storyId) === String(row.storyId))
    stories.setData(list => (list ?? []).filter(r => String(r.storyId) !== String(row.storyId)))
    setDeleteFor(null)
    try {
      await api.stories.remove(row.storyId)
      invalidateStories()
      setEpoch(n => n + 1)
      toast.ok('Story deleted')
    } catch (e: any) {
      /* No restore endpoint anywhere in this domain, so the rollback is local
         re-insertion at the index it came from. */
      stories.setData(list => {
        const back = [...(list ?? [])]
        back.splice(Math.max(0, index), 0, row)
        return back
      })
      toast.error(errorText(e))
    } finally {
      setDeleting(false)
    }
  }

  const soonest = soonestExpiry(rows)
  const loading = stories.loading
  const fatal = stories.error && !isNotFound(stories.error)

  return (
    <Screen style={{ backgroundColor: BLACK }}>
      <Header
        back
        overlay
        border={false}
        title="Your story"
        actions={[{ icon: 'add', label: 'New story', onPress: () => router.push('/story/compose' as any) }]}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={ink.full} />}
      >
        {fatal ? (
          <View style={[styles.errorCard, { backgroundColor: night.dangerSoft }]}>
            <Text variant="subhead" color={night.dangerText} align="ui" style={{ flex: 1 }}>
              {errorText(stories.error)}
            </Text>
            {!isNetworkError(stories.error) ? (
              <Button label="Retry" onPress={() => void stories.reload()} variant="ghost" size="sm" />
            ) : null}
          </View>
        ) : null}

        {loading ? <StoryStatStripSkeleton /> : (
          <View style={styles.strip}>
            <Stat label="Active" value={String(rows.length)} />
            <Divider />
            <Stat label="Viewers" value={views == null ? '—' : String(views)} />
            <Divider />
            <Stat label="Next to go" value={soonest ? fmtLeft(soonest) : '—'} />
          </View>
        )}

        {/* Eyebrows are `caption`: the Text primitive caps Latin and leaves
            Arabic and Kurdish untouched, so the label is authored in sentence
            case and never hardcoded in capitals. */}
        <Text variant="caption" weight="700" color={ink.faint} align="ui" style={styles.sectionLabel}>
          {`Active · ${rows.length}`}
        </Text>

        {loading ? (
          <StoryGridSkeleton screenWidth={width} />
        ) : !rows.length ? (
          <View style={styles.empty}>
            <Icon name="camera" size={56} color={ink.ghost} />
            <Text variant="title3" color={ink.full} align="center" style={{ marginTop: space.md2 }}>No active stories</Text>
            <Text variant="callout" color={ink.muted} align="center" style={styles.emptyBody}>
              Anything you share disappears after 8, 16 or 24 hours.
            </Text>
            <Button label="Create story" onPress={() => router.push('/story/compose' as any)} variant="onDark" style={{ marginTop: space.lg2 }} />
          </View>
        ) : (
          <View style={[styles.grid, { gap: GUTTER }]}>
            {rows.map(row => (
              <StoryPoster
                key={String(row.storyId)}
                story={row}
                width={cell}
                onPress={() => me && router.push(`/story/${me}?storyId=${row.storyId}` as any)}
                onLongPress={() => { fireHaptic('light'); setMenuFor(row) }}
                accessibilityLabel="Story frame"
              >
                <View style={[styles.visBadge, { backgroundColor: shade.chip }]}>
                  <Icon
                    name={VISIBILITY_GLYPH[String(row.visibility)] ?? 'globe'}
                    size={11}
                    color={ink.full}
                    filled={row.visibility === 'CLOSE_FRIENDS'}
                  />
                </View>

                <ExpiryChip expiresAt={row.expiresAt} compact style={styles.expiry} />

                {perFrame[String(row.storyId)] != null ? (
                  <View style={styles.viewCount}>
                    <Icon name="eye" size={11} color={ink.full} />
                    <Text variant="micro" color={ink.full}>{perFrame[String(row.storyId)]}</Text>
                  </View>
                ) : null}

                {isRemoved(row) ? (
                  <View style={[styles.removed, { backgroundColor: shade.heavy, borderColor: URGENT }]}>
                    <Text variant="micro" color={URGENT}>Removed</Text>
                  </View>
                ) : isHeld(row) ? (
                  <ModerationBadge item={row} size="overlay" />
                ) : null}
              </StoryPoster>
            ))}
          </View>
        )}

        {highlights.data?.length ? (
          <>
            <View style={[styles.rule, { backgroundColor: ink.hairline }]} />
            <Text variant="caption" weight="700" color={ink.faint} align="ui" style={styles.sectionLabel}>Highlights</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              <NewHighlightPill onPress={() => router.push('/highlight/new' as any)} />
              {highlights.data.map(h => (
                <HighlightPill
                  key={String(h.highlightId)}
                  highlight={h}
                  onPress={() => router.push(`/highlight/${h.highlightId}` as any)}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        <Text variant="footnote" color={ink.faint} align="ui" style={styles.note}>
          Stories disappear on their own. Add one to a highlight to keep it.
        </Text>
      </ScrollView>

      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenuFor(null)}
        actions={[
          {
            label: 'View insights',
            icon: 'stats',
            hidden: !!menuFor && isRemoved(menuFor),
            onPress: () => router.push(`/story/insights/${menuFor?.storyId}` as any),
          },
          {
            label: 'Add to highlight',
            icon: 'bookmark',
            hidden: !!menuFor && isRemoved(menuFor),
            onPress: () => setHighlightFor(menuFor),
          },
          { label: 'Delete', icon: 'trash', destructive: true, onPress: () => setDeleteFor(menuFor) },
        ]}
      />

      <AddToHighlightSheet
        visible={!!highlightFor}
        onClose={() => setHighlightFor(null)}
        viewerId={me}
        story={highlightFor}
        onAdded={() => void highlights.refresh()}
      />

      <ConfirmSheet
        visible={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        title="Delete this story?"
        message="People who haven't seen it won't be able to. This can't be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => deleteFor && void remove(deleteFor)}
      />
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="title3" weight="700" color={ink.full} align="center">{value}</Text>
      {/* `micro` caps Latin inside the primitive and leaves Arabic alone — a
          call-site .toUpperCase() would have shouted at every script. */}
      <Text variant="micro" color={ink.faint} align="center">{label}</Text>
    </View>
  )
}

function Divider() {
  return <View style={[styles.vRule, { backgroundColor: ink.hairline }]} />
}

const styles = StyleSheet.create({
  body: { paddingBottom: 48 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    marginHorizontal: PAD,
    marginBottom: space.md,
    padding: space.md,
    ...setback(shape.card),
    borderCurve: 'continuous',
  },
  strip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD, height: 52 },
  stat: { flex: 1, gap: space.xxs },
  vRule: { width: StyleSheet.hairlineWidth, height: 28 },
  sectionLabel: { paddingHorizontal: PAD, marginTop: 22, marginBottom: space.sm2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAD },
  visBadge: {
    position: 'absolute',
    top: 6,
    start: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiry: { position: 'absolute', top: 6, end: 6 },
  viewCount: { position: 'absolute', bottom: 6, start: 6, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  removed: {
    position: 'absolute',
    bottom: 6,
    end: 6,
    paddingHorizontal: space.xs2,
    height: 18,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: PAD, marginTop: 26 },
  rail: { gap: space.md2, paddingHorizontal: PAD, alignItems: 'flex-start' },
  note: { paddingHorizontal: PAD, marginTop: space.xxl },
  empty: { alignItems: 'center', paddingTop: space.huge, paddingHorizontal: space.xxxl },
  emptyBody: { maxWidth: 300, marginTop: space.xs },
})
