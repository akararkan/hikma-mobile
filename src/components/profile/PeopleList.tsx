/* =========================================================
   PeopleList — followers and following are one component with
   a different fetcher, because the row anatomy, the empty
   copy and the relationship plumbing are identical and the
   only honest difference is which endpoint fills it.

   The anatomy is the Facebook one: a 56pt face, the name and
   handle beside it, an overflow "…" on the trailing edge, and
   the controls in a full-width row UNDER the name rather than
   squeezed beside it — "Follow back" and "Remove" on your own
   followers, "Following" on your own following, plain Follow
   on anyone else's. A search well under the header filters
   what is loaded, and walks further pages while a query has
   too few matches (the list endpoints take no `q`).

   The follow control on each row is NOT driven by the list
   payload: UserResponse carries no relationship flag and the
   adapter sets `isFollowing: false` on every row. Each visible
   row therefore asks `socialStatus` once, through the shared
   cache's four-at-a-time limiter.

   "Remove" is block-then-unblock — removeFollower.ts explains
   why that is the operation and what it costs.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { usePaged } from '@/hooks/usePaged'
import { useEvent } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, ConfirmSheet, Divider, EmptyState, ErrorState, Header, IconButton, ListFooter,
  NumericText, Screen, SearchField, Skeleton, Spinner, Text, TouchableRow,
  fireHaptic, toast, useSheetState,
} from '@/ui'
import { BadgeRow } from './BadgeRow'
import { FollowButton } from './FollowButton'
import { RelationshipSheet } from './RelationshipSheet'
import { removeFollower } from './removeFollower'
import type { RowUser } from './UserRow'
import { useMuted, useSocialStatus, type SocialStatus } from './useSocialStatus'

/* Module scope, all of it. FlashList's ViewHolder memo compares renderItem
   AND ItemSeparatorComponent by identity, and an inline separator is worse
   than an inline renderItem: it is a new component TYPE at the same position,
   so React unmounts and remounts the divider of every visible row on every
   parent render instead of reconciling it. */
const AVATAR = 56
const PAGE = 30
/* A query with fewer matches than this keeps walking pages on its own … */
const MIN_MATCHES = 12
/* … up to this many pages per "Keep searching" — a name that is not there
   must not walk a five-thousand-follower list unasked. */
const SEARCH_PAGES = 8

const keyExtractor = (item: any) => String(item?.id ?? '')

/* One cached formatter. `n.toLocaleString()` builds a fresh Intl.NumberFormat
   on every call, and on Hermes that is ICU pattern resolution. */
const COUNT = new Intl.NumberFormat()

function RowSeparator() {
  const t = useTheme()
  return <Divider inset={t.layout.screenPadding + AVATAR + space.md} />
}

function matches(u: RowUser, q: string) {
  return String(u.full || '').toLowerCase().includes(q) || String(u.handle || '').toLowerCase().includes(q)
}

export interface PeopleListProps {
  title: string
  /** The list's noun for the count line and the search well — "followers". */
  noun: string
  targetId: string
  /** Whose list this is — changes the empty copy and the unfollow guard. */
  isMe: boolean
  subtitle?: string
  fetch: (args: { page: number; size: number }) => Promise<{ items: any[]; total: number | null; hasMore: boolean }>
  emptyTitle: string
  emptyMessage?: string
  /** A leading row above the list — "Find people to follow" on your own list. */
  leading?: React.ReactElement | null
  /** Own following list: never unfollow on the first tap. */
  confirmUnfollow?: boolean
  /** Own followers list: every row carries Remove. */
  manage?: boolean
  /** The not-yet-following label — "Follow back" on your own followers. */
  followLabel?: string
}

export function PeopleList({
  title, noun, targetId, isMe, subtitle, fetch, emptyTitle, emptyMessage, leading,
  confirmUnfollow, manage = false, followLabel,
}: PeopleListProps) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user: me, signedIn } = useAuth()
  const sheet = useSheetState<RowUser>()
  const removeSheet = useSheetState<RowUser>()

  const list = usePaged<any>(
    async ({ page, pageSize }) => {
      const res = await fetch({ page: page ?? 0, size: pageSize })
      return { items: res.items, hasMore: res.hasMore, extra: { total: res.total } }
    },
    { mode: 'page', pageSize: PAGE, enabled: !!targetId, deps: [targetId] },
  )

  /* The envelope's count, less what this screen removed since — the server
     would agree on a refresh, and a refresh resets the offset. */
  const [removed, setRemoved] = React.useState(0)
  const total: number | null = list.extra?.total != null ? Math.max(0, list.extra.total - removed) : null

  /* ---------- search: a local filter that fetches on its own behalf ---------- */

  const [q, setQ] = React.useState('')
  const query = q.trim().toLowerCase()
  const rows = React.useMemo(
    () => (query ? list.items.filter(u => matches(u, query)) : list.items),
    [list.items, query],
  )

  /* Where the CURRENT query started walking and how many walks the user has
     asked for. Recorded in the change handler, not an effect: the count of
     rows already loaded when the query was typed is the mark the walk is
     measured from. */
  const [walk, setWalk] = React.useState({ q: '', from: 0, budget: 1 })
  const loadedCount = list.items.length
  const onChangeQuery = useEvent((v: string) => {
    setQ(v)
    const next = v.trim().toLowerCase()
    if (next !== walk.q) setWalk({ q: next, from: loadedCount, budget: 1 })
  })
  const keepSearching = useEvent(() => setWalk(w => ({ ...w, budget: w.budget + 1 })))

  const { done, loading, loadingMore, error, loadMore } = list
  const limit = walk.from + SEARCH_PAGES * PAGE * walk.budget
  const capped = !!query && !done && rows.length < MIN_MATCHES && loadedCount >= limit
  const walking = !!query && !done && rows.length < MIN_MATCHES && !capped

  /* The walk itself: one more page whenever the query is still short of
     matches and nothing is in flight. `loadedCount` is in the deps so a page
     that landed re-arms it. */
  React.useEffect(() => {
    if (!walking || loading || loadingMore || error) return
    loadMore()
  }, [walking, loading, loadingMore, error, loadedCount, loadMore])

  /* ---------- row plumbing ----------
     Item-first and identity-stable, so one function serves every row and
     PersonRow's memo actually holds. */

  const meId = String(me?.id || '')
  const openProfile = useEvent((user: RowUser) => {
    router.push({ pathname: '/user/[id]', params: { id: String(user.id) } })
  })
  const openSheet = useEvent((user: RowUser) => sheet.open(user))
  const openRemove = useEvent((user: RowUser) => removeSheet.open(user))
  const dropRow = useEvent((user: RowUser) => list.remove(String(user.id)))

  /* Message — createDirect is documented existing-or-new, so this doubles as
     "open our conversation". Busy-latched: a double-tap must not race two
     creates. */
  const msgBusy = React.useRef(false)
  const message = useEvent(async (user: RowUser) => {
    if (msgBusy.current) return
    msgBusy.current = true
    try {
      const convo: any = await api.chat.conversations.createDirect(String(user.id))
      if (convo?.id) router.push(`/chat/${convo.id}`)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      msgBusy.current = false
    }
  })

  const [removing, setRemoving] = React.useState(false)
  const remove = useEvent(async (user: RowUser, status: SocialStatus | null) => {
    if (removing) return
    const id = String(user.id)
    const name = user.handle ? `@${user.handle}` : (user.full || 'this account')
    setRemoving(true)
    try {
      const out = await removeFollower(id, status)
      /* The edge is gone whichever half failed, so the row leaves either way. */
      list.remove(id)
      setRemoved(n => n + 1)
      if (out.unblockError) {
        fireHaptic('warning')
        toast.error(errorText(out.unblockError))
        toast.error(`${name} is still blocked. Unblock them from their profile.`)
      } else if (out.restrictError) {
        fireHaptic('warning')
        toast.error(errorText(out.restrictError))
      } else {
        fireHaptic('success')
        toast.ok(`${name} no longer follows you`)
      }
    } catch (e) {
      fireHaptic('error')
      toast.error(errorText(e))
    } finally {
      setRemoving(false)
    }
  })

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <PersonRow
      user={item}
      isSelf={String(item?.id) === meId}
      signedIn={signedIn}
      manage={manage}
      confirmUnfollow={confirmUnfollow}
      followLabel={followLabel}
      onPress={openProfile}
      onMore={openSheet}
      onRemove={openRemove}
      onGone={dropRow}
    />
  ), [meId, signedIn, manage, confirmUnfollow, followLabel, openProfile, openSheet, openRemove, dropRow])

  const listPad = React.useMemo(() => ({ paddingBottom: insets.bottom + 24 }), [insets.bottom])

  /* Held by reference so the list header is not a brand-new element on every
     keystroke — a header ViewHolder re-renders whenever its identity moves.
     The COUNT lives here rather than up in the chrome: it describes the list
     underneath it and lines up on the same gutter as the rows. */
  const countLine = query
    ? `${COUNT.format(rows.length)} ${rows.length === 1 ? 'match' : 'matches'}`
    : total != null ? `${COUNT.format(total)} ${noun}` : ''
  const header = React.useMemo(() => (
    <View>
      {query ? null : leading}
      {countLine ? (
        <View style={[styles.countRow, { paddingHorizontal: t.layout.screenPadding }]}>
          <NumericText variant="headline" align="ui">{countLine}</NumericText>
        </View>
      ) : null}
    </View>
  ), [query, leading, countLine, t.layout.screenPadding])

  const searched = COUNT.format(loadedCount)

  return (
    <Screen>
      <Header
        back
        title={title}
        subtitle={subtitle}
        below={
          <View style={[styles.chrome, { paddingHorizontal: t.layout.screenPadding }]}>
            <SearchField
              value={q}
              onChangeText={onChangeQuery}
              placeholder={`Search ${noun}`}
              accessibilityState={walking ? { busy: true } : undefined}
            />
          </View>
        }
      />

      {list.loading ? (
        <PeopleSkeleton manage={manage} />
      ) : list.error && !list.items.length ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ItemSeparatorComponent={RowSeparator}
          ListHeaderComponent={header}
          ListEmptyComponent={
            query ? (
              walking ? (
                <View style={styles.center}><Spinner /></View>
              ) : (
                <EmptyState
                  icon="search"
                  title={`No one matches “${q.trim()}”`}
                  message={list.done ? 'Check the spelling, or try their @handle.' : `Searched the first ${searched} of ${total != null ? COUNT.format(total) : 'your'} ${noun}.`}
                  actionLabel={list.done ? undefined : 'Keep searching'}
                  onAction={list.done ? undefined : keepSearching}
                />
              )
            ) : (
              <EmptyState
                icon="people"
                title={emptyTitle}
                message={emptyMessage}
                actionLabel={isMe ? 'Find people' : undefined}
                onAction={isMe ? () => router.push('/search/people') : undefined}
              />
            )
          }
          ListFooterComponent={
            !rows.length ? null
              : capped ? (
                <View style={styles.center}>
                  <Text variant="footnote" tone="faint" align="center">
                    Searched the first {searched} {noun}.
                  </Text>
                  <Button label="Keep searching" variant="ghost" size="sm" onPress={keepSearching} />
                </View>
              ) : (
                <ListFooter
                  loading={list.loadingMore}
                  error={list.error}
                  onRetry={list.loadMore}
                  done={list.done}
                  doneLabel={query ? 'That’s everyone who matches' : 'That’s everyone'}
                />
              )
          }
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={listPad}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={() => { setRemoved(0); void list.refresh() }}
              tintColor={t.colors.textMuted}
              colors={[t.colors.accent]}
            />
          }
        />
      )}

      <PersonSheet
        visible={sheet.visible}
        onClose={sheet.close}
        user={sheet.payload}
        manage={manage}
        onMessage={message}
        onRemove={openRemove}
      />
      <RemoveSheet
        visible={removeSheet.visible}
        onClose={removeSheet.close}
        user={removeSheet.payload}
        loading={removing}
        onConfirm={remove}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One person.

   A row reads its own relationship: the list endpoint cannot
   carry one, and a single batched read would be one request
   per row anyway. Memoized, and every handler takes the row as
   its argument so the caller keeps one function per action for
   the whole list.
   --------------------------------------------------------- */

const PersonRow = React.memo(function PersonRow({
  user, isSelf, signedIn, manage, confirmUnfollow, followLabel, onPress, onMore, onRemove, onGone,
}: {
  user: RowUser
  isSelf: boolean
  signedIn: boolean
  manage: boolean
  confirmUnfollow?: boolean
  followLabel?: string
  onPress: (user: RowUser) => void
  onMore: (user: RowUser) => void
  onRemove: (user: RowUser) => void
  onGone: (user: RowUser) => void
}) {
  const t = useTheme()
  const controls = signedIn && !isSelf
  const rel = useSocialStatus(controls ? user.id : null)
  const press = React.useCallback(() => onPress(user), [onPress, user])
  const more = React.useCallback(() => onMore(user), [onMore, user])
  const remove = React.useCallback(() => onRemove(user), [onRemove, user])
  const gone = React.useCallback(() => onGone(user), [onGone, user])

  /* The third line: on your own followers a mutual follow is the thing worth
     saying; otherwise the bio, flattened to one line. */
  const mutual = manage && !!rel.status?.isFollowing
  const meta = React.useMemo(
    () => (mutual ? 'You follow each other' : user.bio ? String(user.bio).replace(/\s+/g, ' ').slice(0, 90) : null),
    [mutual, user.bio],
  )
  const name = user.full || 'Member'

  return (
    <TouchableRow onPress={press} onLongPress={controls ? more : undefined} accessibilityRole="button">
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding }]}>
        <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={AVATAR} />

        <View style={styles.body}>
          <View style={styles.head}>
            <View style={styles.identity}>
              <View style={styles.nameLine}>
                <Text variant="headline" numberOfLines={1} style={styles.shrink}>{name}</Text>
                <BadgeRow badges={user.badges} role={user.role} />
              </View>
              <Text variant="subhead" tone="muted" weight="400" numberOfLines={1} align="ui">
                @{user.handle || 'member'}
              </Text>
            </View>
            {controls ? (
              <IconButton
                name="more"
                size={20}
                color={t.colors.textMuted}
                onPress={more}
                accessibilityLabel={`More options for ${name}`}
                style={styles.more}
              />
            ) : null}
          </View>

          {meta ? (
            <Text variant="footnote" tone={mutual ? 'accent' : 'faint'} numberOfLines={1} style={styles.meta}>
              {meta}
            </Text>
          ) : null}

          {controls ? (
            <View style={styles.actions}>
              <View style={styles.flex}>
                <FollowButton
                  userId={String(user.id)}
                  status={rel.status}
                  size="sm"
                  block
                  followLabel={followLabel}
                  confirmUnfollow={confirmUnfollow}
                  onGone={gone}
                />
              </View>
              {manage ? (
                <View style={styles.flex}>
                  <Button
                    label="Remove"
                    variant="secondary"
                    size="sm"
                    block
                    onPress={remove}
                    accessibilityLabel={`Remove ${name} from your followers`}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </TouchableRow>
  )
})

/* Its own component so the hooks run unconditionally — the sheet's subject
   changes, but the hook order must not. */
function PersonSheet({
  visible, onClose, user, manage, onMessage, onRemove,
}: {
  visible: boolean
  onClose: () => void
  user: RowUser | null
  manage: boolean
  onMessage: (user: RowUser) => void
  onRemove: (user: RowUser) => void
}) {
  const id = user ? String(user.id) : ''
  const rel = useSocialStatus(visible ? id : null)
  const muted = useMuted(visible ? id : null)
  if (!user) return null
  return (
    <RelationshipSheet
      visible={visible}
      onClose={onClose}
      user={{ id, full: user.full, handle: user.handle }}
      status={rel.status}
      muted={muted}
      extra={[
        /* Not while either direction blocks — createDirect refuses, and the
           refusal would be the first the user hears of the block. */
        ...(rel.status && !rel.status.isBlocking && !rel.status.isBlockedByThem
          ? [{ label: 'Message', icon: 'chat', onPress: () => onMessage(user) }]
          : []),
        ...(manage
          ? [{ label: 'Remove from followers', icon: 'personRemove', onPress: () => onRemove(user) }]
          : []),
      ]}
    />
  )
}

/* The confirm reads the relationship itself, because the copy depends on it:
   a mutual follow is the one thing Remove takes that the user might not
   expect, so it is said in so many words before the tap. */
function RemoveSheet({
  visible, onClose, user, loading, onConfirm,
}: {
  visible: boolean
  onClose: () => void
  user: RowUser | null
  loading: boolean
  onConfirm: (user: RowUser, status: SocialStatus | null) => void
}) {
  const id = user ? String(user.id) : ''
  const rel = useSocialStatus(visible ? id : null)
  if (!user) return null
  const name = user.handle ? `@${user.handle}` : (user.full || 'this account')
  const following = !!rel.status?.isFollowing
  return (
    <ConfirmSheet
      visible={visible}
      onClose={onClose}
      title={`Remove ${name} from your followers?`}
      message={
        `${name} will stop following you. They are not told, and they can follow you again later.` +
        (following ? ` Your follow of them is removed as well. You can follow them again from their profile.` : '')
      }
      confirmLabel="Remove"
      icon="personRemove"
      destructive
      loading={loading}
      onConfirm={() => { onClose(); onConfirm(user, rel.status) }}
    />
  )
}

/** The row's own skeleton — same geometry as the real thing, so the list does
 *  not reflow the moment it loads. */
function PeopleSkeleton({ manage, count = 7 }: { manage: boolean; count?: number }) {
  const t = useTheme()
  return (
    <View style={{ paddingTop: space.sm }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding }]}>
          <Skeleton circle width={AVATAR} height={AVATAR} />
          <View style={[styles.body, { gap: space.sm }]}>
            <Skeleton width="48%" height={13} />
            <Skeleton width="30%" height={10} />
            {/* No radius override: Skeleton's own default is the setback, and a
                pill here would promise a control shape the app does not use. */}
            <View style={[styles.actions, { marginTop: space.xs }]}>
              <View style={styles.flex}><Skeleton width="100%" height={32} /></View>
              {manage ? <View style={styles.flex}><Skeleton width="100%" height={32} /></View> : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  chrome: { paddingBottom: space.sm2 },
  countRow: { paddingTop: space.md, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  identity: { flex: 1, minWidth: 0, paddingTop: space.xxs },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  /* The 34pt box sits a hair above the name line so the glyph centres on it. */
  more: { marginTop: -space.xs2, marginEnd: -space.sm },
  meta: { marginTop: space.xs },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm2 },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xxxl },
})
