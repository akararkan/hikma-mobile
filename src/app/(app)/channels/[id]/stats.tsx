/* =========================================================
   Statistics.

   The adapter keeps two buckets and so does this screen: member
   numbers come from Postgres and are EXACT, while post types,
   views, forwards and top posts are best-effort Redis aggregates
   maintained on the hot path. Every figure carries which one it
   is, because presenting a HyperLogLog estimate with Postgres
   authority is the one way an analytics panel actively lies.

   Nothing renders a zero for a number the API did not send.
   "No data yet" and "0" are different answers.

   SSE carries deltas, not counters, so a live frame nudges a
   tile by ±1 and every `connected` re-reads the whole payload.
   ========================================================= */
import React from 'react'
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { captureRef } from 'react-native-view-shot'
import { JOIN_SOURCE_LABELS, api, errorText, isNetworkError } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Card, Header, Icon, Screen, ScreenScroll, Skeleton, Text, Touchable, formatCount, toast,
} from '@/ui'
import { AreaChart, BarChart, StackedBar, StackedLegend, type Segment } from '@/components/channels/Charts'
import { ChannelStatCard } from '@/components/channels/ChannelStatCard'
import { RefusalCard, TopStrip } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

/** Five named slots, then everything else folded into one grey remainder —
 *  a sixth hue would be invented rather than assigned. */
const MAX_SEGMENTS = 5

export default function ChannelStatsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const stats = useAsync<any>(() => api.channels.stats(id), { enabled: !!id, deps: [id] })

  /* Keep the last good payload on screen through a wobble: an analytics panel
     that blanks itself is less useful than one that says how old it is. */
  const lastGood = React.useRef<any>(null)
  if (stats.data) lastGood.current = stats.data
  const [lastAt, setLastAt] = React.useState<number>(() => Date.now())
  React.useEffect(() => { if (stats.data) setLastAt(Date.now()) }, [stats.data])

  const data = stats.data ?? lastGood.current
  const degraded = !!stats.error && !!lastGood.current
  const offline = isNetworkError(stats.error)

  /* The poller pauses when the screen is not focused — and while offline,
     where it would only burn battery re-failing. Focus is not foreground,
     though: backgrounding the app leaves this screen focused, so without the
     AppState check the panel keeps waking the radio every 60s for figures
     nobody is looking at. Same guard as the home tab's live rail. */
  useFocusEffect(React.useCallback(() => {
    if (offline) return
    const iv = setInterval(() => {
      if (AppState.currentState !== 'active') return
      void stats.refresh()
    }, 60000)
    return () => clearInterval(iv)
  }, [offline, stats.refresh]))

  useChannelStream(id, {
    onMember: e => stats.setData((prev: any) => {
      if (!prev) return prev
      /* PROMOTED / DEMOTED are role changes on this same frame — only a
         join/leave moves the count. */
      const delta = e.memberChange === 'UNSUBSCRIBED' ? -1
        : (e.memberChange === 'SUBSCRIBED' || e.memberChange === 'ADDED') ? 1 : 0
      if (!delta) return prev
      return { ...prev, subscriberCount: Math.max(0, prev.subscriberCount + delta) }
    }),
    onMessage: () => stats.setData((prev: any) => (prev ? { ...prev, postCount: prev.postCount + 1 } : prev)),
    onReconcile: () => { void stats.refresh() },
  })

  const gutter = t.layout.screenPadding
  const full = width - gutter * 2
  const half = (full - 10) / 2

  const sources: Segment[] = React.useMemo(() => {
    const rows = (data?.joinsBySource || []) as { key: string; value: number }[]
    if (rows.length <= MAX_SEGMENTS) {
      return rows.map(r => ({ key: r.key, label: (JOIN_SOURCE_LABELS as any)[r.key] || r.key, value: r.value }))
    }
    const head = rows.slice(0, MAX_SEGMENTS - 1)
    const tail = rows.slice(MAX_SEGMENTS - 1).reduce((n, r) => n + r.value, 0)
    return [
      ...head.map(r => ({ key: r.key, label: (JOIN_SOURCE_LABELS as any)[r.key] || r.key, value: r.value })),
      { key: '_other', label: 'Other', value: tail },
    ]
  }, [data?.joinsBySource])

  const byType = React.useMemo(
    () => ((data?.postsByType || []) as { key: string; value: number }[])
      .map(r => ({ key: r.key, label: typeLabel(r.key), value: r.value })),
    [data?.postsByType],
  )

  /* A 403 here is a rights answer, not a failure — no retry. */
  if (stats.error?.status === 403 && !lastGood.current) {
    return (
      <Screen background="sunken">
        <Header back title="Statistics" />
        <RefusalCard error={stats.error} title="Statistics are for admins" onAction={() => router.back()} />
      </Screen>
    )
  }

  if (stats.loading && !data) {
    return (
      <Screen background="sunken">
        <Header back title="Statistics" subtitle={rights.channel?.title} />
        <View style={{ padding: gutter, gap: space.md2 }}>
          <View style={{ flexDirection: 'row', gap: space.sm2 }}>
            <Skeleton height={150} radius={18} style={{ flex: 1 }} />
            <Skeleton height={150} radius={18} style={{ flex: 1 }} />
          </View>
          <Skeleton height={200} radius={18} />
          <Skeleton height={160} radius={18} />
          <Skeleton height={200} radius={18} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Statistics" subtitle={rights.channel?.title} />

      {degraded ? (
        <TopStrip>
          {offline
            ? `${errorText(stats.error)} Showing the last update from ${clockOf(lastAt)}.`
            : `Stats are temporarily unavailable — showing the last update from ${clockOf(lastAt)}.`}
        </TopStrip>
      ) : null}

      <ScreenScroll
        refreshing={stats.refreshing}
        onRefresh={() => void stats.refresh()}
        contentContainerStyle={{ padding: gutter, gap: space.xl, paddingBottom: 60 }}
      >
        {/* ---- hero ---- */}
        <View style={styles.row}>
          <ChannelStatCard
            label="Subscribers"
            value={data?.subscriberCount ?? null}
            delta={data?.joinedLast7Days ?? null}
            deltaLabel="this week"
            sparkline={(data?.joinsByDay || []).map((d: any) => d.value)}
            width={half}
            accuracy="exact"
          />
          <ChannelStatCard
            label="Online now"
            value={data?.onlineSubscribers ?? null}
            hint="right now"
            width={half}
            accuracy="exact"
          />
        </View>

        {/* ---- KPI grid ---- */}
        <View style={styles.grid}>
          {[
            { label: 'Joined · 30 days', value: data?.joinedLast30Days ?? null, accuracy: 'exact' as const },
            { label: 'Left · 30 days', value: data?.leftLast30Days ?? null, accuracy: 'exact' as const },
            { label: 'Net · 30 days', value: data?.net30 ?? null, accuracy: 'exact' as const, signed: true },
            {
              label: 'Notifications on',
              value: data?.notificationsEnabledCount ?? null,
              accuracy: 'exact' as const,
              hint: data ? `${formatCount(data.mutedCount)} muted` : undefined,
            },
            { label: 'Posts', value: data?.postCount ?? null, accuracy: 'exact' as const },
            { label: 'Total views', value: data?.totalViews ?? null, accuracy: 'best-effort' as const },
          ].map(tile => (
            <ChannelStatCard
              key={tile.label}
              compact
              label={tile.label}
              value={tile.value}
              signed={tile.signed}
              hint={tile.hint}
              accuracy={tile.accuracy}
              /* Two columns: `flex: 1` inside a wrapping row would stretch a
                 short final row across the whole width. */
              style={{ flex: 0, width: half }}
            />
          ))}
        </View>

        {/* ---- chart 1 ---- */}
        <ChartCard
          title="Subscriber growth"
          accuracy="Exact"
          fileName="ika-subscriber-growth"
          exportable={!!data?.joinsByDay?.length}
        >
          {data?.joinsByDay?.length ? (
            <AreaChart points={data.joinsByDay} width={full - 28} height={170} />
          ) : (
            <NoData text="Not enough history yet — growth appears after a few days." />
          )}
        </ChartCard>

        {/* ---- chart 2 ---- */}
        <ChartCard
          title="Where subscribers came from"
          accuracy="Exact"
          fileName="ika-subscriber-sources"
          exportable={sources.length > 0}
        >
          {sources.length ? (
            <>
              <StackedBar segments={sources} width={full - 28} />
              <StackedLegend segments={sources} />
            </>
          ) : (
            <NoData text="No data yet." />
          )}
        </ChartCard>

        {/* ---- chart 3 ---- */}
        <ChartCard
          title="Posts by type"
          accuracy="Best-effort"
          fileName="ika-posts-by-type"
          exportable={byType.length > 0}
        >
          {byType.length ? (
            <BarChart
              rows={byType}
              width={full - 28}
              onPressBar={row => router.push(chRoute.media(id, mediaKindOf(row.key)))}
            />
          ) : (
            <NoData text="No data yet." />
          )}
        </ChartCard>

        {/* ---- reach ---- */}
        <Card variant="outlined" padding={14}>
          <ChartHead title="Reach" accuracy="Best-effort" />
          <View style={[styles.row, { marginTop: space.xs2 }]}>
            <View style={styles.flex}>
              <Text variant="title2" align="ui">{data?.totalViews == null ? '—' : formatCount(data.totalViews)}</Text>
              <Text variant="caption" tone="muted" align="ui">Total views</Text>
            </View>
            <View style={styles.flex}>
              <Text variant="title2" align="ui">{data?.totalForwards == null ? '—' : formatCount(data.totalForwards)}</Text>
              <Text variant="caption" tone="muted" align="ui">Total forwards</Text>
            </View>
          </View>
          <View style={[styles.note, { backgroundColor: c.warningSoft }]}>
            <Text variant="caption" color={c.warningText} align="ui">
              Views and forwards are best-effort aggregates. The per-post counters are the source of truth.
            </Text>
          </View>
        </Card>

        {/* ---- top posts ---- */}
        <Card variant="outlined" padding={14}>
          <ChartHead title="Most viewed" accuracy="Best-effort" />
          {data?.topPosts?.length ? (
            <View style={{ gap: space.xs, marginTop: space.xs2 }}>
              {data.topPosts.slice(0, 5).map((post: any) => (
                <Touchable
                  key={String(post.id)}
                  onPress={() => router.push(chRoute.post(id, String(post.id)))}
                  feedback="dim"
                  noAutoHitSlop
                  style={styles.topRow}
                >
                  <View style={[styles.thumb, { backgroundColor: c.surfaceSunken }]}>
                    <Text variant="caption" tone="muted" align="center">{formatCount(post.views ?? 0)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text variant="subhead" numberOfLines={2} align="auto">{post.body || '(no text)'}</Text>
                    <Text variant="caption" tone="muted" align="ui">
                      {[
                        post.views != null ? `${formatCount(post.views)} views` : null,
                        post.forwards != null ? `${formatCount(post.forwards)} forwards` : null,
                        post.time,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Touchable>
              ))}
            </View>
          ) : (
            <NoData text="No data yet." />
          )}
        </Card>

        <Text variant="caption" tone="faint" align="ui">
          Member numbers are exact. Post types, views, forwards and top posts are best-effort aggregates.
        </Text>
      </ScreenScroll>
    </Screen>
  )
}

function ChartHead({ title, accuracy, action }: { title: string; accuracy: string; action?: React.ReactNode }) {
  return (
    <View style={styles.chartHead}>
      <Text variant="headline" align="ui" style={styles.flex}>{title}</Text>
      <Text variant="micro" tone="faint">{accuracy}</Text>
      {action}
    </View>
  )
}

/* A chart card that can leave the phone as a PNG.
 *
 * What is captured is the WHOLE card, head included, because the head carries
 * the accuracy label — a best-effort aggregate that stops saying so the moment
 * it becomes an image is exactly the lie this screen is written to avoid.
 *
 * A phone has no download folder, so the file goes to the share sheet, which is
 * where "Save to Photos" and every messenger actually live. */
function ChartCard({
  title, accuracy, fileName, exportable, children,
}: {
  title: string
  accuracy: string
  fileName: string
  exportable?: boolean
  children: React.ReactNode
}) {
  const t = useTheme()
  const shot = React.useRef<View>(null)
  const [busy, setBusy] = React.useState(false)

  const share = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!(await Sharing.isAvailableAsync())) {
        toast.warn('Sharing is not available on this device.')
        return
      }
      /* `busy` hides the button so it cannot land in its own PNG. Two frames:
         one for React to paint the change, one for the native view to settle
         before view-shot reads it. */
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))
      const uri = await captureRef(shot, { format: 'png', quality: 1, result: 'tmpfile', fileName })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title })
    } catch {
      toast.error('Could not export this chart.')
    } finally {
      setBusy(false)
    }
  }

  return (
    /* collapsable={false} keeps the wrapper as a real native view on Android;
       a collapsed one has no handle for captureRef to read. */
    <View ref={shot} collapsable={false}>
      <Card variant="outlined" padding={14}>
        <ChartHead
          title={title}
          accuracy={accuracy}
          action={exportable ? (
            <Touchable
              onPress={() => { void share() }}
              disabled={busy}
              feedback="dim"
              accessibilityLabel={`Export ${title} as an image`}
              style={{ opacity: busy ? 0 : 1, alignSelf: 'center' }}
            >
              <Icon name="share" size={16} color={t.colors.textMuted} />
            </Touchable>
          ) : null}
        />
        {children}
      </Card>
    </View>
  )
}

function NoData({ text }: { text: string }) {
  return (
    <View style={{ paddingVertical: 26 }}>
      <Text variant="footnote" tone="muted" align="center">{text}</Text>
    </View>
  )
}

function typeLabel(key: string): string {
  switch (key) {
    case 'TEXT': return 'Text'
    case 'IMAGE': return 'Photos'
    case 'VIDEO': return 'Videos'
    case 'FILE': return 'Files'
    case 'VOICE': case 'AUDIO': return 'Audio'
    case 'POLL': return 'Polls'
    case 'GIF': return 'GIFs'
    default: return key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ')
  }
}

/** The gallery speaks the QUERY kinds, which are not quite the post types. */
function mediaKindOf(key: string): string {
  if (key === 'VOICE') return 'AUDIO'
  return key
}

/* Cached formatter: this runs on every tick of the live-activity chart. */
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function clockOf(ms: number): string {
  return CLOCK.format(new Date(ms))
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm2 },
  chartHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm2, marginBottom: space.sm2 },
  note: { padding: space.sm2, borderRadius: 10, marginTop: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm },
  thumb: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
})
