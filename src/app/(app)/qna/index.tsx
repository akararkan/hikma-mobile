/* =========================================================
   Q&A home — three feeds over one card.

   The three segments keep their own list, cursor and scroll
   offset: all three FlashLists stay mounted and the inactive
   ones are `display: 'none'`, which is what makes switching
   back instant instead of a refetch and a jump to the top.
   `enabled` flips false→true once per segment, so a segment
   loads the first time it is opened and never again on a
   return visit.

   NOTE: the spec files this screen under `(tabs)/qna`. The
   tab bar and its layout belong to another surface and are
   not this domain's to edit, so it lives at `/qna` — the
   canonical Q&A entry point either way, and the route every
   deep link already targets.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText, isNetworkError } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged, type PagedState } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Callout, Chip, ChipRail, ConfirmSheet, Header, Icon, ListFooter,
  Screen, SegmentedControl, Touchable, useSheetState, toast,
} from '@/ui'
import { qna, tagsApi } from '@/components/qna/api'
import { CollectionPickerSheet } from '@/components/qna/CollectionPickerSheet'
import { useQnaEvent } from '@/components/qna/events'
import { canAskRole, canManageQuestion } from '@/components/qna/gate'
import { QuestionCard } from '@/components/qna/QuestionCard'
import { IndeterminateBar, QnaEmptyState, QnaErrorView, QnaSkeletons } from '@/components/qna/QnaState'
import { ReportSheet } from '@/components/qna/ReportSheet'
import { qnaHref } from '@/components/qna/routes'
import { copyQuestionLink, sendQuestionToChat, shareQuestion } from '@/components/qna/share'
import type { QuestionView, TrendingTag } from '@/components/qna/types'
import { useQuestionSave } from '@/components/qna/useQuestionSave'

type Segment = 'all' | 'following' | 'mine'

/* Module scope: FlashList's ViewHolder memo compares renderItem by identity,
   and keyExtractor is pure data — neither belongs in a render body. */
const keyExtractor = (q: QuestionView) => q.id

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'following', label: 'Following' },
  { value: 'mine', label: 'My questions' },
]

/* Trending is decoration and changes on the hour, not the second — one call
   per session is plenty, and a failure hides the rail rather than reporting
   anything. */
let trendingCache: TrendingTag[] | null = null
let trendingTried = false

export default function QnaHomeScreen() {
  const t = useTheme()
  const router = useRouter()
  const gate = useAuthGate()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()

  const [segment, setSegment] = React.useState<Segment>('all')
  const [visited, setVisited] = React.useState<Record<Segment, boolean>>({ all: true, following: false, mine: false })
  const [collapsed, setCollapsed] = React.useState(false)
  const [trending, setTrending] = React.useState<TrendingTag[]>(() => trendingCache ?? [])

  const authed = gate === 'allow'
  const canAsk = canAskRole(user)

  const all = usePaged<QuestionView>(
    ({ cursor, pageSize, signal }) => qna.feed({ cursor: cursor ?? undefined, limit: pageSize, signal }),
    { mode: 'cursor', pageSize: 20, enabled: visited.all },
  )
  const following = usePaged<QuestionView>(
    ({ page, pageSize, signal }) => qna.following({ page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, enabled: visited.following && authed },
  )
  const mine = usePaged<QuestionView>(
    ({ page, pageSize, signal }) => qna.mine({ page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, enabled: visited.mine && authed },
  )

  React.useEffect(() => {
    if (trendingTried) return
    trendingTried = true
    tagsApi.trending({ scope: 'QUESTION', limit: 20 })
      .then(rows => { trendingCache = rows || []; setTrending(trendingCache) })
      .catch(() => { trendingCache = [] })
  }, [])

  const patchEverywhere = React.useCallback((id: string, fn: (q: QuestionView) => QuestionView) => {
    all.patch(id, fn); following.patch(id, fn); mine.patch(id, fn)
  }, [all.patch, following.patch, mine.patch]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeEverywhere = React.useCallback((id: string) => {
    all.remove(id); following.remove(id); mine.remove(id)
  }, [all.remove, following.remove, mine.remove]) // eslint-disable-line react-hooks/exhaustive-deps

  const { cooldown: saveCooldown, toggle: toggleSave, save: saveInto } = useQuestionSave(patchEverywhere)

  /* Your own writes are actor-skipped on SSE, so the composer hands the
     created row back through the module bus instead. */
  useQnaEvent('question:created', q => { all.prepend(q); mine.prepend(q) })
  useQnaEvent('question:updated', q => patchEverywhere(q.id, prev => ({ ...prev, ...q, saved: prev.saved })))
  useQnaEvent('question:deleted', ({ id }) => removeEverywhere(id))

  /* ---- sheets ---- */
  const overflow = useSheetState<QuestionView>()
  const collections = useSheetState<QuestionView>()
  const report = useSheetState<QuestionView>()
  const confirmDelete = useSheetState<QuestionView>()
  const confirmBlock = useSheetState<QuestionView>()
  const [busy, setBusy] = React.useState(false)

  const openSegment = (v: Segment) => {
    setSegment(v)
    if (!visited[v]) setVisited(prev => ({ ...prev, [v]: true }))
  }

  /* Every handler below is identity-stable. Three SegmentLists stay mounted,
     so a fresh lambda here would hand new props to all three — and through
     them a new renderItem to each list — on every parent render. */
  const onScroll = useEvent((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y
    if (y > 40 && !collapsed) setCollapsed(true)
    else if (y <= 40 && collapsed) setCollapsed(false)
  })
  const onOpen = useEvent((q: QuestionView) => router.push(qnaHref.question(q.id)))
  const onAuthor = useEvent((q: QuestionView) => router.push(qnaHref.user(q.author)))
  const onTag = useEvent((tag: string) => router.push(qnaHref.tag(tag)))
  const onToggleSaveRow = useEvent((q: QuestionView) => toggleSave(q, { undo: true }))
  const onLongPressSave = useEvent((q: QuestionView) => collections.open(q))
  const onOverflow = useEvent((q: QuestionView) => overflow.open(q))
  const onAsk = useEvent(() => router.push(qnaHref.ask()))
  const onFindScholars = useEvent(() => router.push(qnaHref.globalSearch()))
  const onSignIn = useEvent(() => router.push(qnaHref.signIn()))

  const doDelete = async () => {
    const q = confirmDelete.payload
    if (!q) return
    setBusy(true)
    try {
      await qna.remove(q.id)
      removeEverywhere(q.id)
      confirmDelete.close()
      toast.ok('Question deleted')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally { setBusy(false) }
  }

  const doBlock = async () => {
    const q = confirmBlock.payload
    if (!q) return
    setBusy(true)
    try {
      await api.users.block(q.author)
      /* The server will 404 every one of their questions on the next read;
         dropping them now keeps the list honest in the meantime. */
      const drop = (list: PagedState<QuestionView>) =>
        list.setItems(prev => prev.filter(x => x.author !== q.author))
      drop(all); drop(following); drop(mine)
      confirmBlock.close()
      toast.ok('Blocked')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally { setBusy(false) }
  }

  const active = segment === 'all' ? all : segment === 'following' ? following : mine
  const refreshing = active.refreshing

  return (
    <Screen edges={['top']}>
      <Header
        large={!collapsed}
        title="Q&A"
        actions={[
          { icon: 'search', onPress: () => router.push(qnaHref.search()), label: 'Search Q&A' },
          { icon: 'bookmark', onPress: () => router.push(qnaHref.saved()), label: 'Saved questions' },
        ]}
        border={collapsed}
        below={
          <View>
            <SegmentedControl
              options={SEGMENTS}
              value={segment}
              onChange={openSegment}
              style={{ marginHorizontal: t.layout.screenPadding, marginBottom: space.sm }}
            />
            {segment !== 'mine' && trending.length ? (
              <ChipRail style={{ paddingBottom: space.sm }}>
                {trending.map(tag => (
                  <Chip
                    key={tag.tag}
                    label={`#${tag.tag}`}
                    tone="neutral"
                    size="sm"
                    onPress={() => router.push(qnaHref.tag(tag.tag))}
                  />
                ))}
              </ChipRail>
            ) : null}
            <IndeterminateBar active={refreshing} />
          </View>
        }
      />

      <View style={styles.flex}>
        {SEGMENTS.map(s => (
          <View key={s.value} style={[styles.pane, segment === s.value ? null : styles.hidden]}>
            <SegmentList
              segment={s.value}
              state={s.value === 'all' ? all : s.value === 'following' ? following : mine}
              gate={gate}
              canAsk={canAsk}
              saveCooldown={saveCooldown}
              onScroll={onScroll}
              onOpen={onOpen}
              onAuthor={onAuthor}
              onTag={onTag}
              onToggleSave={onToggleSaveRow}
              onLongPressSave={onLongPressSave}
              onOverflow={onOverflow}
              onAsk={onAsk}
              onFindScholars={onFindScholars}
              onSignIn={onSignIn}
            />
          </View>
        ))}
      </View>

      {canAsk ? (
        <Touchable
          onPress={() => router.push(qnaHref.ask())}
          feedback="scale"
          haptic="medium"
          noAutoHitSlop
          accessibilityLabel="Ask a question"
          /* No shadow: QELAT depth is letterpress plus a drawn rule, so the
             FAB separates with a 1px accentPressed border (DESIGN.md §6). */
          style={[
            styles.fab,
            {
              bottom: insets.bottom + t.layout.tabBarHeight + 16,
              backgroundColor: t.colors.accent,
              borderColor: t.colors.accentPressed,
            },
          ]}
        >
          <Icon name="edit" size={24} color={t.colors.textOnAccent} />
        </Touchable>
      ) : null}

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title={overflow.payload?.title}
        actions={[
          {
            label: overflow.payload?.saved ? 'Remove from saved' : 'Save',
            icon: 'bookmark',
            onPress: () => overflow.payload && toggleSave(overflow.payload, { undo: true }),
          },
          { label: 'Save to collection…', icon: 'library', onPress: () => overflow.payload && collections.open(overflow.payload) },
          { label: 'Send in a message', icon: 'chat', onPress: () => { const q = overflow.payload; if (q) void sendQuestionToChat(router, q.id, q.title) } },
          { label: 'Share', icon: 'share', onPress: () => { const q = overflow.payload; if (q) void shareQuestion(q.id, q.title) } },
          { label: 'Copy link', icon: 'link', onPress: () => { const q = overflow.payload; if (q) void copyQuestionLink(q.id) } },
          { label: 'Open author profile', icon: 'person', onPress: () => overflow.payload && router.push(qnaHref.user(overflow.payload.author)) },
          {
            label: 'Edit question',
            icon: 'edit',
            hidden: !canManageQuestion(user, overflow.payload),
            onPress: () => overflow.payload && router.push(qnaHref.edit(overflow.payload.id)),
          },
          {
            label: 'Answer settings',
            icon: 'settings',
            hidden: !canManageQuestion(user, overflow.payload),
            onPress: () => overflow.payload && router.push(qnaHref.manage(overflow.payload.id)),
          },
          { label: 'Report', icon: 'flag', onPress: () => overflow.payload && report.open(overflow.payload) },
          {
            label: 'Block author',
            icon: 'block',
            destructive: true,
            hidden: overflow.payload?.author === user?.id,
            onPress: () => overflow.payload && confirmBlock.open(overflow.payload),
          },
          {
            label: 'Delete question',
            icon: 'trash',
            destructive: true,
            hidden: !canManageQuestion(user, overflow.payload),
            onPress: () => overflow.payload && confirmDelete.open(overflow.payload),
          },
        ]}
      />

      <CollectionPickerSheet
        visible={collections.visible}
        onClose={collections.close}
        onPick={name => { const q = collections.payload; if (q) void saveInto(q, name) }}
      />

      <ReportSheet
        visible={report.visible}
        onClose={report.close}
        targetType="QUESTION"
        targetId={report.payload?.id ?? null}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this question?"
        message="Every answer, reply, reaction, file and bookmark on it is deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDelete}
      />

      <ConfirmSheet
        visible={confirmBlock.visible}
        onClose={confirmBlock.close}
        title={`Block ${confirmBlock.payload?._author.full ?? 'this person'}?`}
        message="You will not see their questions or answers, and they will not see yours."
        confirmLabel="Block"
        destructive
        loading={busy}
        onConfirm={doBlock}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One segment's list.
   --------------------------------------------------------- */

function SegmentList({
  segment, state, gate, canAsk, saveCooldown, onScroll,
  onOpen, onAuthor, onTag, onToggleSave, onLongPressSave, onOverflow, onAsk, onFindScholars, onSignIn,
}: {
  segment: Segment
  state: PagedState<QuestionView>
  gate: 'loading' | 'allow' | 'deny'
  canAsk: boolean
  saveCooldown: number
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  onOpen: (q: QuestionView) => void
  onAuthor: (q: QuestionView) => void
  onTag: (tag: string) => void
  onToggleSave: (q: QuestionView) => void
  onLongPressSave: (q: QuestionView) => void
  onOverflow: (q: QuestionView) => void
  onAsk: () => void
  onFindScholars: () => void
  onSignIn: () => void
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [strip, setStrip] = React.useState(true)

  /* Every handler above is useEvent-stable and every prop the card gets is a
     scalar, so this identity only moves when the save cooldown ticks — which
     is exactly when the rows must repaint. That pairing is what makes
     QuestionCard's React.memo actually fire. */
  const renderItem = React.useCallback(({ item }: { item: QuestionView }) => (
    <QuestionCard
      question={item}
      saveCooldown={saveCooldown}
      showSavedAt={false}
      onPress={onOpen}
      onAuthorPress={onAuthor}
      onTagPress={onTag}
      onToggleSave={onToggleSave}
      onLongPressSave={onLongPressSave}
      onOverflow={onOverflow}
    />
  ), [saveCooldown, onOpen, onAuthor, onTag, onToggleSave, onLongPressSave, onOverflow])

  const needsAuth = segment !== 'all'
  if (needsAuth && gate === 'loading') return <QnaSkeletons kind="questionCard" count={6} />
  if (needsAuth && gate === 'deny') {
    return (
      <QnaEmptyState
        glyph="lock"
        title="Sign in to see this"
        body={segment === 'following' ? 'Following shows questions from the scholars you follow.' : 'Your own questions live here once you sign in.'}
        actionLabel="Sign in"
        onAction={onSignIn}
      />
    )
  }

  if (state.loading) return <QnaSkeletons kind="questionCard" count={6} />

  /* A failed page with nothing loaded is a full panel; a failed page over
     existing rows is a strip, because blowing the list away punishes the user
     for a network blink. */
  if (state.error && !state.items.length) {
    return <QnaErrorView error={state.error} onRetry={state.reload} onBack={undefined} />
  }

  const empty = !state.items.length

  return (
    <View style={styles.flex}>
      {state.error && strip ? (
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
          <Callout
            tone={isNetworkError(state.error) ? 'neutral' : 'danger'}
            icon={isNetworkError(state.error) ? 'offline' : 'error'}
            onDismiss={() => setStrip(false)}
            actionLabel="Retry"
            onAction={() => { setStrip(true); void state.refresh() }}
          >
            {errorText(state.error)}
          </Callout>
        </View>
      ) : null}

      <FlashList
        data={state.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={state.loadMore}
        onEndReachedThreshold={0.6}
        /* A question card is title + body + tags + status + metrics, 220pt and
           up. The platform default 250 prepares barely one cell ahead. */
        drawDistance={500}
        contentContainerStyle={{ paddingTop: space.xs, paddingBottom: insets.bottom + 96 }}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={state.refresh}
            tintColor={t.colors.textMuted}
            colors={[t.colors.accent]}
            progressBackgroundColor={t.colors.surface}
          />
        }
        ListEmptyComponent={
          empty ? <EmptyForSegment segment={segment} canAsk={canAsk} onAsk={onAsk} onFindScholars={onFindScholars} /> : null
        }
        ListFooterComponent={
          empty ? null : (
            <ListFooter
              loading={state.loadingMore}
              error={state.error && state.items.length ? state.error : null}
              onRetry={state.loadMore}
              done={state.done}
              doneLabel="You have reached the end"
            />
          )
        }
      />
    </View>
  )
}

function EmptyForSegment({
  segment, canAsk, onAsk, onFindScholars,
}: { segment: Segment; canAsk: boolean; onAsk: () => void; onFindScholars: () => void }) {
  if (segment === 'following') {
    return (
      <QnaEmptyState
        glyph="people"
        title="Nothing from people you follow"
        body="Follow scholars to see their questions here, plus your own."
        actionLabel="Find scholars"
        onAction={onFindScholars}
      />
    )
  }
  if (segment === 'mine') {
    return canAsk ? (
      <QnaEmptyState
        glyph="edit"
        title="You have not asked anything yet"
        body="A good question is specific: name what you have read and what is still unclear."
        actionLabel="Ask a question"
        onAction={onAsk}
      />
    ) : (
      <QnaEmptyState
        glyph="scholar"
        title="You have not asked anything yet"
        body="Only scholars can post questions. You can still answer them if you are a researcher."
      />
    )
  }
  return (
    <QnaEmptyState
      glyph="qna"
      title="No questions yet"
      body="Scholars post questions here. Check back soon."
    />
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pane: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
  hidden: { display: 'none' },
  /* ComposeFab's shape (DESIGN.md §6): a 56pt plate on the fab setback with a
     1px accentPressed border — never a circle, never a shadow. */
  fab: {
    position: 'absolute', end: 16,
    width: 56, height: 56, ...setback(shape.fab), borderCurve: 'continuous', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
})
