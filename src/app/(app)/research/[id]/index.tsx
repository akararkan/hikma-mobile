/* =========================================================
   Paper detail — the canonical page.

   Everything that can change while the screen is open comes
   through `useResearchDetail`: the shared SSE channel, the
   counter deltas, the lifecycle patches and the
   reconcile-on-reconnect re-fetch. Nothing here hand-rolls a
   ±1 on a counter, because half the events carry absolutes and
   half carry deltas and `applyResearchDelta` is the only place
   that knows which is which.
   ========================================================= */
import React from 'react'
import { Linking, Share, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { adapters, api, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { recheckDelays } from '@/lib/moderation'
import { reportHref } from '@/components/system/Moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, Card, Chip, ConfirmSheet, Header, Icon,
  Screen, ScreenScroll, Sheet, Skeleton, Text, Touchable, VerifiedMark, formatCount, toast, useSheetState,
} from '@/ui'
import { MetricStrip } from '@/components/research/MetricStrip'
import { ResearchActionBar } from '@/components/research/ResearchActionBar'
import { ResearchCover } from '@/components/research/ResearchCover'
import { RichBody } from '@/components/research/RichBody'
import { StatusBanner } from '@/components/research/StatusBanner'
import { ResearchCommentMenu } from '@/components/research/CommentActions'
import { CommentRow } from '@/components/research/CommentRow'
import { SourceRow } from '@/components/research/SourceRow'
import { ErrorPanel, GoneState, useTransientRetry } from '@/components/research/states'
import { heldEdit } from '@/lib/moderation'
import { useHoldRecheck, useResearchDetail } from '@/components/research/hooks'
import { formatDate } from '@/components/research/format'
import { to } from '@/components/research/nav'
import type { ResearchComment } from '@/components/research/types'

export default function ResearchDetailScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, signedIn } = useAuth()

  const { detail, error, loading, refreshing, refresh, reload, patch, held, setHeld } = useResearchDetail(id)
  const overflow = useSheetState()
  const commentMenu = useSheetState<ResearchComment>()
  const deleteSheet = useSheetState()
  const reactionSheet = useSheetState()
  const [abstractOpen, setAbstractOpen] = React.useState(false)

  useTransientRetry(error, reload)

  /* The comment preview is its own load so a slow comments table never holds
     the paper back. */
  const preview = useAsync<ResearchComment[]>(
    async () => {
      const page: any = await api.research.comments(id, { page: 0, size: 3 })
      return (page?.content || []).map(adapters.researchCommentFrom) as ResearchComment[]
    },
    { enabled: !!id, deps: [id] },
  )

  /* The preview is three real rows, so it carries the real menu. A row you
     can like but cannot report is half an affordance. */
  const patchPreview = React.useCallback((commentId: string, p: Partial<ResearchComment>) => {
    preview.setData(list => (list || []).map(row => (row.id === commentId ? { ...row, ...p } : row)))
  }, [preview.setData]) // eslint-disable-line react-hooks/exhaustive-deps

  const dropPreview = React.useCallback((target: ResearchComment) => {
    commentMenu.close()
    preview.setData(list => (list || []).filter(row => row.id !== target.id))
    patch(d => ({ ...d, metrics: { ...d.metrics, comments: Math.max(0, d.metrics.comments - 1) } }))
  }, [preview.setData, commentMenu.close, patch]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Loaded only while the popover is open — the breakdown is a curiosity, not
     part of the page. */
  const breakdown = useAsync<Record<string, number>>(
    () => api.research.reactionBreakdown(id),
    { enabled: reactionSheet.visible && !!id, deps: [id, reactionSheet.visible] },
  )

  /* A held EDIT is a hold too, even though this hook's own `held` flag knows
     nothing about it — that state belongs to whichever screen made the change,
     and the author may well have arrived here from somewhere else entirely.
     Derived from the paper itself, so it re-checks either way. */
  useHoldRecheck(
    !!held || heldEdit(detail),
    recheckDelays('RESEARCH'),
    () => { void reload() },
    () => setHeld('review'),
  )

  /* A held publish clears itself the moment get() reports PUBLISHED. */
  React.useEffect(() => {
    if (held && detail?.status === 'PUBLISHED') setHeld(null)
  }, [held, detail?.status, setHeld])

  const burst = useSharedValue(0)
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ scale: 0.6 + burst.value * 0.8 }],
  }))

  const isOwner = !!user?.id && !!detail && user.id === detail.author
  const contributors = detail?.contributors || []

  /* One screen-level gesture, not one per row, so it stays in the body: the
     react-hooks/immutability rule (React Compiler) will not let a memo body
     write the shared value this worklet sets, and a single Tap rebuild is
     nothing beside the per-row gestures the audit was actually about. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (!detail || detail.liked || detail.status !== 'PUBLISHED') return
      burst.value = withSequence(
        withTiming(1, { duration: t.ms(120) }),
        withSpring(0, t.motion.spring),
      )
      void like()
    })

  const like = async () => {
    if (!detail || !signedIn) return
    patch(d => ({ ...d, liked: true, metrics: { ...d.metrics, reactions: d.metrics.reactions + 1 } }))
    try {
      await api.research.react(id)
    } catch (e: any) {
      patch(d => ({ ...d, liked: false, metrics: { ...d.metrics, reactions: Math.max(0, d.metrics.reactions - 1) } }))
      toast.error(errorText(e))
    }
  }

  const remove = async () => {
    try {
      await api.research.remove(id)
      deleteSheet.close()
      toast.ok('Paper deleted.')
      router.dismissAll()
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  const download = async () => {
    const doc = detail?.mediaFiles.find(m => m.type === 'DOCUMENT')
    if (!doc) return
    try {
      const res: any = await api.research.download(id, doc.id)
      if (res?.url) await Linking.openURL(res.url)
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  if (loading) return <DetailSkeleton />
  if (error && isNotFound(error)) {
    return (
      <Screen>
        <Header back title="" border={false} />
        <GoneState onAction={() => router.replace(to('/research'))} />
      </Screen>
    )
  }
  if (error || !detail) {
    return (
      <Screen>
        <Header back title="Paper" />
        <ErrorPanel error={error} onRetry={reload} />
      </Screen>
    )
  }

  const figures = detail.mediaFiles.filter(m => m.type === 'IMAGE').sort((a, b) => a.order - b.order)
  const documents = detail.mediaFiles.filter(m => m.type === 'DOCUMENT')
  const dateLine = formatDate(detail.publishedAt || detail.createdAt)

  return (
    <Screen>
      <Header
        back
        title=""
        border={false}
        actions={[
          { icon: 'share', onPress: () => router.push(to(`/research/${id}/share`)), label: 'Share' },
          { icon: 'more', onPress: () => overflow.open(), label: 'More' },
        ]}
      />

      <ScreenScroll
        refreshing={refreshing}
        onRefresh={() => { void refresh(); void preview.refresh() }}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <GestureDetector gesture={doubleTap}>
          <View>
            <ResearchCover
              cover={detail.cover}
              uri={detail.coverImageUrl || detail.videoPromoThumb}
              irc={detail.irc}
              radius={0}
              scrim
            >
              {detail.hasVideo ? (
                <Touchable
                  onPress={() => router.push(to(`/research/${id}/promo`))}
                  feedback="scale"
                  accessibilityLabel="Play promo video"
                  style={[styles.playHero, { backgroundColor: c.overlayChip }]}
                >
                  <Icon name="play" size={28} color={c.overlayText} filled />
                </Touchable>
              ) : null}
              <Animated.View style={[styles.burst, burstStyle]} pointerEvents="none">
                <Icon name="heart" size={92} color={c.overlayText} filled />
              </Animated.View>
            </ResearchCover>
          </View>
        </GestureDetector>

        <StatusBanner
          status={detail.status}
          scheduledPublishAt={detail.scheduledPublishAt}
          publishedAt={detail.publishedAt}
          isOwner={isOwner}
          heldState={held}
          onPublish={() => router.push(to(`/research/${id}/edit/publish`))}
          onEditSchedule={() => router.push(to(`/research/${id}/edit/publish`))}
        />

        <View style={styles.block}>
          <Text variant="title2" serif align="auto" numberOfLines={5} style={{ lineHeight: 32 }}>
            {detail.title}
          </Text>
          <View style={styles.identity}>
            {detail.irc ? (
              <Touchable
                onLongPress={async () => { await Clipboard.setStringAsync(detail.irc); toast.ok('Identifier copied') }}
                feedback="dim"
                style={[styles.ircChip, { backgroundColor: c.surfaceSunken }]}
              >
                <Text variant="caption" mono tone="muted">{detail.irc}</Text>
              </Touchable>
            ) : null}
            {dateLine ? <Text variant="caption" tone="faint">· {dateLine}</Text> : null}
          </View>
        </View>

        <Touchable
          onPress={() => router.push(to(`/u/${detail.author}`))}
          feedback="tint"
          noAutoHitSlop
          style={styles.authorRow}
        >
          <Avatar uri={detail._author.profileImage} name={detail._author.full} seed={detail._author.id} size={44} />
          <View style={styles.flex}>
            <View style={styles.nameLine}>
              <Text variant="subhead" weight="600" align="auto" numberOfLines={1} style={styles.shrink}>
                {detail._author.full}
              </Text>
              {detail._author.verified ? <VerifiedMark size={14} /> : null}
            </View>
            <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>
              @{detail._author.handle}{detail._author.role ? ` · ${detail._author.role}` : ''}
            </Text>
          </View>
          <Button
            label="View papers"
            variant="tinted"
            size="sm"
            onPress={() => router.push(to(`/research/by/${detail.author}`))}
          />
        </Touchable>

        {contributors.length ? (
          <Touchable
            onPress={() => router.push(to(`/research/${id}/contributors`))}
            feedback="dim"
            noAutoHitSlop
            style={styles.contribRail}
          >
            <View style={styles.avatarStack}>
              {contributors.slice(0, 5).map((row, i) => (
                <View key={row._user.id || i} style={{ marginStart: i ? -10 : 0 }}>
                  <Avatar uri={row._user.profileImage} name={row._user.full} seed={row._user.id} size={28} />
                </View>
              ))}
            </View>
            <View style={styles.flex}>
              <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>
                {contributors.length > 5 ? `+${contributors.length - 5} more · ` : ''}
                {contributors.slice(0, 2).map(r => r.role.replace(/_/g, ' ').toLowerCase()).join(', ')}
              </Text>
            </View>
            <Icon name="forward" size={14} color={c.textFaint} />
          </Touchable>
        ) : null}

        <MetricStrip
          metrics={detail.metrics}
          style={styles.metrics}
          onPressComments={() => router.push(to(`/research/${id}/comments`))}
          onPressCitations={() => router.push(to(`/research/${id}/share`))}
          onPressReactions={() => reactionSheet.open()}
        />

        {detail.abstract || detail.abstractHtml ? (
          <Card variant="sunken" style={styles.abstract} padding={14}>
            {/* `micro` uppercases Latin INSIDE the Text primitive — which is what
    leaves an Arabic or Kurdish run alone — so the eyebrow is written in
    sentence case and takes the variant's own tracking. */}
            <Text variant="micro" tone="muted" align="ui" style={styles.label}>Abstract</Text>
            <View style={{ maxHeight: abstractOpen ? undefined : 200, overflow: 'hidden' }}>
              <RichBody
                html={detail.abstractHtml}
                plain={detail.abstractSource || detail.abstract}
                bodyFormat={detail.bodyFormat}
                style={{ marginTop: space.xs2 }}
              />
            </View>
            <Touchable onPress={() => setAbstractOpen(v => !v)} feedback="dim" style={{ marginTop: space.sm }}>
              <Text variant="subhead" tone="accent" align="ui">
                {abstractOpen ? 'Show less' : 'Read full abstract'}
              </Text>
            </Touchable>
          </Card>
        ) : null}

        {detail.keywords ? (
          <Text variant="footnote" tone="muted" italic align="auto" style={styles.keywords}>
            Keywords: {detail.keywords}
          </Text>
        ) : null}

        {detail.tags?.length ? (
          <View style={styles.tagWrap}>
            {detail.tags.map(tag => (
              <Chip
                key={tag}
                label={`#${tag}`}
                tone="scholar"
                size="sm"
                onPress={() => router.push(to(`/research/tag/${encodeURIComponent(tag)}`))}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.cta}>
          <Button label="Read paper" icon="book" block size="lg" onPress={() => router.push(to(`/research/${id}/read`))} />
          {detail.downloadsEnabled && documents.length ? (
            <Button label="Download PDF" icon="download" variant="secondary" block size="lg" onPress={download} />
          ) : null}
          {detail.mediaFiles.length ? (
            <Touchable onPress={() => router.push(to(`/research/${id}/files`))} feedback="dim" style={styles.centerLink}>
              <Text variant="subhead" tone="accent" align="center">All files ({detail.mediaFiles.length})</Text>
            </Touchable>
          ) : null}
        </View>

        {figures.length ? (
          <View style={styles.section}>
            <SectionHead
              title={`Figures (${figures.length})`}
              actionLabel="See all"
              onAction={() => router.push(to(`/research/${id}/figures`))}
            />
            <ScreenScrollRow>
              {figures.slice(0, 6).map((fig, i) => (
                <Touchable
                  key={fig.id}
                  onPress={() => router.push(to(`/research/${id}/figures`))}
                  feedback="scale"
                  noAutoHitSlop
                  style={styles.figure}
                >
                  <ResearchCover uri={fig.url} ratio={140 / 100} radius={t.radius.sm} style={styles.figureImg} />
                  <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: space.xs2 }}>
                    {fig.caption || `Fig. ${i + 1}`}
                  </Text>
                </Touchable>
              ))}
            </ScreenScrollRow>
          </View>
        ) : null}

        {detail.sources.length ? (
          <View style={styles.section}>
            <SectionHead
              title={`Sources (${detail.sources.length})`}
              actionLabel="View all"
              onAction={() => router.push(to(`/research/${id}/sources`))}
            />
            {detail.sources.slice(0, 3).map((s, i) => (
              <SourceRow
                key={s.id}
                source={s}
                index={i + 1}
                onPress={src => { if (src.href) void Linking.openURL(src.href) }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHead
            title={`Comments (${formatCount(detail.metrics.comments)})`}
            actionLabel={detail.commentsEnabled ? 'See all' : undefined}
            onAction={() => router.push(to(`/research/${id}/comments`))}
          />
          {!detail.commentsEnabled ? (
            <Card variant="sunken" padding={14} style={{ marginHorizontal: space.lg }}>
              <Text variant="footnote" tone="muted" align="center">Comments are turned off for this paper.</Text>
            </Card>
          ) : (
            <>
              <Touchable
                onPress={() => router.push(to(`/research/${id}/comments`))}
                feedback="tint"
                noAutoHitSlop
                style={styles.composerStub}
              >
                <Avatar uri={user?.profileImage} name={user?.displayName || user?.handle} seed={user?.id} size={30} />
                <Text variant="footnote" tone="faint" align="ui" style={styles.flex}>Add a comment…</Text>
              </Touchable>
              {preview.loading ? (
                <View style={{ padding: space.lg, gap: space.sm2 }}>
                  <Skeleton width="70%" height={12} />
                  <Skeleton width="88%" height={12} />
                </View>
              ) : (preview.data || []).map(row => (
                <CommentRow
                  key={row.id}
                  comment={row}
                  researchId={id}
                  viewerId={user?.id}
                  onMenu={commentMenu.open}
                  onPatch={patchPreview}
                />
              ))}
              {detail.metrics.comments > 3 ? (
                <Touchable
                  onPress={() => router.push(to(`/research/${id}/comments`))}
                  feedback="dim"
                  style={styles.centerLink}
                >
                  <Text variant="subhead" tone="accent" align="center">
                    See all {formatCount(detail.metrics.comments)} comments
                  </Text>
                </Touchable>
              ) : null}
            </>
          )}
        </View>
      </ScreenScroll>

      <ResearchActionBar
        researchId={id}
        liked={detail.liked}
        saved={detail.saved}
        metrics={detail.metrics}
        status={detail.status}
        commentsEnabled={detail.commentsEnabled}
        isOwner={isOwner}
        signedIn={signedIn}
        onChange={p => patch(d => ({ ...d, ...p }))}
        onOpenShare={() => router.push(to(`/research/${id}/share`))}
        onOpenSave={() => router.push(to(`/research/${id}/save`))}
        onOpenComments={() => router.push(to(`/research/${id}/comments`))}
        onOpenCite={() => router.push(to(`/research/${id}/share?tab=cite`))}
      />

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title={detail.title}
        actions={isOwner ? [
          { label: 'Edit paper', icon: 'edit', onPress: () => router.push(to(`/research/${id}/edit`)) },
          { label: 'Media & cover', icon: 'image', onPress: () => router.push(to(`/research/${id}/edit/media`)) },
          { label: 'Sources', icon: 'quote', onPress: () => router.push(to(`/research/${id}/edit/sources`)) },
          { label: 'Contributors', icon: 'people', onPress: () => router.push(to(`/research/${id}/edit/contributors`)) },
          { label: 'Publishing', icon: 'upload', onPress: () => router.push(to(`/research/${id}/edit/publish`)) },
          { label: 'Delete permanently', icon: 'trash', destructive: true, onPress: () => deleteSheet.open() },
        ] : [
          {
            label: 'Copy link',
            icon: 'link',
            onPress: async () => {
              await Clipboard.setStringAsync(detail.shareUrl || `/research/${id}`)
              toast.ok('Link copied')
              /* recordShare bumps the counter only when the link was actually
                 copied — which is exactly now. */
              if (detail.shareUrl) void Promise.resolve(api.research.recordShare(id)).catch(() => {})
            },
          },
          {
            label: 'Open in browser',
            icon: 'external',
            hidden: !detail.shareUrl,
            onPress: () => { if (detail.shareUrl) void Linking.openURL(detail.shareUrl) },
          },
          {
            label: 'Share',
            icon: 'share',
            onPress: async () => {
              const res = await Share.share({ message: detail.shareUrl || detail.title, title: detail.title })
              /* Count only a completed share, not a dismissed sheet. */
              if (detail.shareUrl && res.action === Share.sharedAction) {
                void Promise.resolve(api.research.recordShare(id)).catch(() => {})
              }
            },
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            onPress: () => router.push(reportHref({
              targetType: 'RESEARCH',
              targetId: id,
              authorId: detail.author,
              name: detail._author.full || undefined,
              avatar: detail._author.profileImage || undefined,
              snippet: detail.title || undefined,
            })),
          },
          {
            label: 'Block researcher',
            icon: 'block',
            destructive: true,
            onPress: async () => {
              try { await api.users.block(detail.author); toast.ok('Researcher blocked') }
              catch (e: any) { toast.error(errorText(e)) }
            },
          },
        ]}
      />

      <ConfirmSheet
        visible={deleteSheet.visible}
        onClose={deleteSheet.close}
        title="Delete permanently?"
        message="This removes the paper, its files, comments, reactions and citation record. Retract it instead if you only want to withdraw it."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />

      <Sheet visible={reactionSheet.visible} onClose={reactionSheet.close} title="Reactions">
        <View style={{ padding: space.lg, gap: space.sm }}>
          {breakdown.loading ? <Skeleton width="50%" height={14} /> : null}
          {breakdown.error ? <ErrorPanel error={breakdown.error} onRetry={breakdown.reload} compact /> : null}
          {Object.entries(breakdown.data || {}).map(([kind, n]) => (
            <View key={kind} style={styles.breakdownRow}>
              <Icon name="heart" size={16} color={c.danger} filled />
              <Text variant="subhead" align="ui" style={styles.flex}>{kind.toLowerCase()}</Text>
              <Text variant="subhead" weight="600">{formatCount(n as number)}</Text>
            </View>
          ))}
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
            The API exposes totals only — there is no list of who reacted.
          </Text>
        </View>
      </Sheet>

      <ResearchCommentMenu
        visible={commentMenu.visible}
        onClose={commentMenu.close}
        comment={commentMenu.payload}
        researchId={id}
        viewerId={user?.id}
        isResearchOwner={isOwner}
        /* No Reply here: this page has no composer, only a stub that pushes
           the comments screen. An entry that cannot reply is not offered. */
        onPatch={patchPreview}
        onDeleted={dropPreview}
      />
    </Screen>
  )
}

function SectionHead({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text variant="title3" align="ui" style={styles.flex}>{title}</Text>
      {actionLabel ? (
        <Touchable onPress={onAction} feedback="dim">
          <Text variant="subhead" tone="accent" align="ui">{actionLabel}</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

/** A horizontal rail that does not fight the parent ScrollView. */
function ScreenScrollRow({ children }: { children: React.ReactNode }) {
  return (
    <ScreenScroll
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      style={styles.railWrap}
    >
      {children}
    </ScreenScroll>
  )
}

function DetailSkeleton() {
  const t = useTheme()
  return (
    <Screen>
      <Header back title="" border={false} />
      <View>
        <Skeleton height={210} radius={0} />
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          <Skeleton width="90%" height={20} />
          <Skeleton width="70%" height={20} />
          <Skeleton width="40%" height={20} />
          <View style={{ flexDirection: 'row', gap: space.sm2, alignItems: 'center', marginTop: space.md }}>
            <Skeleton circle width={44} height={44} />
            <View style={{ gap: space.xs2, flex: 1 }}>
              <Skeleton width="46%" height={12} />
              <Skeleton width="30%" height={10} />
            </View>
          </View>
          <Skeleton height={44} radius={t.radius.md} style={{ marginTop: space.md2 }} />
          <Skeleton height={130} radius={t.radius.md} style={{ marginTop: space.sm2 }} />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ircChip: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 7 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  contribRail: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingBottom: space.md },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  metrics: { paddingHorizontal: space.sm, paddingVertical: space.sm2 },
  abstract: { marginHorizontal: space.lg, marginTop: space.xs2 },
  label: {},
  keywords: { paddingHorizontal: space.lg, marginTop: space.md },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, paddingHorizontal: space.lg, marginTop: space.md },
  cta: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.sm2 },
  section: { marginTop: space.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  figure: { width: 140 },
  figureImg: { width: 140, height: 100 },
  rail: { paddingHorizontal: space.lg, gap: space.sm2 },
  railWrap: { flexGrow: 0 },
  composerStub: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  centerLink: { paddingVertical: space.md },
  /* Icon-only round plate — a sanctioned circle. Logical start/marginStart
     so the centring holds in RTL. */
  playHero: {
    position: 'absolute', top: '50%', start: '50%', marginTop: -space.xxxl, marginStart: -space.xxxl,
    width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  burst: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
