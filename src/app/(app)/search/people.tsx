/* =========================================================
   Find people — the dedicated people surface.

   Deliberately NOT the People tab of Explore. That one ranks
   accounts against content on Elasticsearch; this one is
   Postgres full-text: transactionally fresh (zero indexing
   lag, so an account created a second ago is findable),
   role-filterable, and the only people endpoint that returns a
   real page envelope with `total` and `hasMore`.

   It doubles as the co-author / admin picker. A picker cannot
   hand objects back through route params and expo-router has no
   `popTo(result)`, so a selection leaves on the picker bus and
   the opener subscribes by sink name.

   `user.isFollowing` is FALSE on every row of this endpoint by
   the adapter's own warning — FollowButton reads social-status
   instead and nothing here may shortcut that.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuthGate } from '@/context/AuthContext'
import { useDebounced, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Chip, Divider, EmptyState, ErrorState, Header, Icon, ListFooter, NumericText,
  Screen, SearchField, SegmentedControl, Skeleton, Text, Touchable, TouchableRow, VerifiedMark,
  fireHaptic, formatCount,
} from '@/ui'
import {
  FollowButton, emitPick, href, looksLikeEmail, resolveEmail, searchUsers, useTransientRetry,
  type PeopleRow,
} from '@/components/search'

const SIZE = 20

/** The two audiences this screen can show. Both named, because a filter whose
 *  "off" state has no label is a filter people get stuck inside.
 *
 *  "Scholars" is the home feed's own word for this same audience (tabs/index),
 *  and it is short enough that neither cell truncates on a small phone at a
 *  large text scale — a two-cell switch splits the width evenly, so the LONGER
 *  label sets the budget for both. The precise phrase still gets said in full
 *  where there is room for it: the group label under the filter reads "All
 *  researchers & scholars". */
type Audience = 'all' | 'scholars'
const AUDIENCE: { value: Audience; label: string; icon?: any }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'scholars', label: 'Scholars', icon: 'scholar' },
]

/* Module scope: FlashList's ViewHolder memo compares renderItem and
   ItemSeparatorComponent BY IDENTITY, so an inline arrow in either re-renders
   every mounted cell on every keystroke this screen takes. */
const keyExtractor = (u: PeopleRow) => u.id

function RowSeparator() {
  return <Divider inset={72} />
}

export default function FindPeopleScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const gate = useAuthGate()
  const params = useLocalSearchParams<{ select?: string; sink?: string }>()
  const selectMode = params.select === '1'
  const sink = String(params.sink || 'people')

  const [q, setQ] = React.useState('')
  const [eligible, setEligible] = React.useState(false)
  const [selected, setSelected] = React.useState<PeopleRow[]>([])

  const [rows, setRows] = React.useState<PeopleRow[]>([])
  const [total, setTotal] = React.useState<number | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  const page = React.useRef(0)
  const abort = React.useRef<AbortController | null>(null)
  const busy = React.useRef(false)
  const debounced = useDebounced(q, 300)

  const load = React.useCallback(async (kind: 'first' | 'more' | 'refresh', term: string, contributorOnly: boolean) => {
    if (busy.current && kind === 'more') return
    busy.current = true
    /* This endpoint DOES take a signal — every keystroke cancels the last one. */
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl

    const next = kind === 'more' ? page.current + 1 : 0
    if (kind === 'first') setLoading(true)
    else if (kind === 'refresh') setRefreshing(true)
    else setLoadingMore(true)
    if (kind !== 'more') setError(null)

    try {
      /* An email typed here matches NOTHING through search — users/search.md
         keeps addresses out of the index on purpose and points at the exact
         lookup instead. Without this an email is a dead end that looks like
         "this person isn't on Hikmah Web", which is the opposite of the truth.
         Exact match only, and no paging: there is one answer or none. */
      if (looksLikeEmail(term)) {
        const found = await resolveEmail(term)
        /* getByEmail takes no signal, so staleness is checked by hand — the
           controller this call was issued under is aborted the moment a newer
           keystroke starts. */
        if (ctl.signal.aborted) return
        page.current = 0
        setRows(found ? [found] : [])
        setTotal(found ? 1 : 0)
        setHasMore(false)
        return
      }
      const res = await searchUsers(term, {
        page: next,
        size: SIZE,
        eligibleContributor: contributorOnly || undefined,
        signal: ctl.signal,
      })
      page.current = next
      setRows(prev => (kind === 'more' ? [...prev, ...res.items] : res.items))
      setTotal(res.total)
      setHasMore(!!res.hasMore)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e)
    } finally {
      busy.current = false
      setLoading(false); setLoadingMore(false); setRefreshing(false)
    }
  }, [])

  /* A blank query is not an idle state here — the endpoint lists all active
     users with plain paging, and that IS the browse state. */
  React.useEffect(() => { void load('first', debounced.trim(), eligible) }, [debounced, eligible, load])
  useTransientRetry(error, () => void load('first', debounced.trim(), eligible))
  React.useEffect(() => () => abort.current?.abort(), [])

  /* useEvent, not a bare arrow: these are the props every recycled row holds,
     and a fresh identity per render is what makes PersonRow's memo useless. */
  const toggle = useEvent((u: PeopleRow) => {
    fireHaptic('light')
    setSelected(prev => (prev.some(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]))
  })

  const finish = () => {
    if (!selected.length) return
    emitPick(sink, { sink, users: selected })
    router.back()
  }

  const blank = !debounced.trim()

  /* A Set, so a row asks one O(1) question instead of the list scanning the
     selection for every visible row on every render. */
  const selectedIds = React.useMemo(() => new Set(selected.map(s => s.id)), [selected])
  const showFollow = gate === 'allow'

  const onRowPress = useEvent((u: PeopleRow) => {
    if (selectMode) { toggle(u); return }
    router.push(href(`/u/${u.id}`))
  })

  const renderItem = React.useCallback(({ item }: { item: PeopleRow }) => (
    <PersonRow
      user={item}
      selectMode={selectMode}
      selected={selectedIds.has(item.id)}
      showFollow={showFollow}
      onPress={onRowPress}
    />
  ), [selectMode, selectedIds, showFollow, onRowPress])

  const renderToken = React.useCallback(({ item }: { item: PeopleRow }) => (
    <TokenChip user={item} onPress={toggle} />
  ), [toggle])

  /* Held by reference so the list header is not a brand-new element on every
     keystroke — a header ViewHolder re-renders whenever its identity moves.
     The COUNT lives here rather than up in the chrome: it describes the list
     underneath it, it lines up on the same gutter as the rows, and it leaves
     the filter above free to take the full width. */
  const browseLabel = React.useMemo(() => (
    (blank || total != null) ? (
      <View style={[styles.groupRow, { paddingHorizontal: t.layout.screenPadding }]}>
        <Text variant="footnote" tone="faint" align="ui" style={styles.flex} numberOfLines={1}>
          {blank ? (eligible ? 'All researchers & scholars' : 'All members') : ''}
        </Text>
        {total != null ? (
          <NumericText variant="footnote" tone="faint">
            {/* Ranked searches cap totalElements at 200 (search.md) — at the
                cap the number is a floor, not a count. Blank-query browse
                paging is uncapped and stays exact. */}
            {debounced.trim() && total >= 200 ? '200+ people' : `${formatCount(total)} people`}
          </NumericText>
        ) : null}
      </View>
    ) : null
  ), [blank, eligible, total, debounced, t.layout.screenPadding])

  return (
    <Screen>
      <Header
        back
        title="People"
        actions={selectMode ? [{
          icon: 'check',
          onPress: finish,
          label: `Done, ${selected.length} selected`,
          badge: selected.length || null,
          tone: 'accent',
        }] : []}
        below={
          <View style={[styles.chrome, { paddingHorizontal: t.layout.screenPadding }]}>
            <SearchField
              value={q}
              onChangeText={setQ}
              placeholder="Search people"
              autoFocus={selectMode}
            />
            {/* A SWITCH, not a lone toggle. This filter has two states and a
                single chip only ever named one of them — the other was an
                unlabelled "off", so the way back to everybody was a guess. The
                segmented control states both, fills the width the row was
                wasting on a half-empty line, and is the house control for a
                two-way filter (calls, research). */}
            <SegmentedControl<Audience>
              options={AUDIENCE}
              value={eligible ? 'scholars' : 'all'}
              onChange={v => setEligible(v === 'scholars')}
            />
          </View>
        }
      />

      {selectMode && selected.length ? (
        <View style={[styles.tokenStrip, { borderBottomColor: c.separator }]}>
          <FlashList
            horizontal
            data={selected}
            keyExtractor={keyExtractor}
            showsHorizontalScrollIndicator={false}
            renderItem={renderToken}
          />
        </View>
      ) : null}

      {loading && !rows.length ? (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 64, gap: space.md }]}>
              <Skeleton circle width={44} height={44} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="46%" height={12} />
                <Skeleton width="30%" height={11} />
                <Skeleton width="60%" height={10} />
              </View>
            </View>
          ))}
        </View>
      ) : error && !rows.length ? (
        <ErrorState error={error} onRetry={() => void load('first', debounced.trim(), eligible)} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (hasMore) void load('more', debounced.trim(), eligible) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh', debounced.trim(), eligible)}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          ListHeaderComponent={browseLabel}
          ItemSeparatorComponent={RowSeparator}
          ListEmptyComponent={
            blank && eligible ? (
              <EmptyState icon="scholar" title="No researchers or scholars yet." />
            ) : looksLikeEmail(debounced) ? (
              /* An email is matched exactly or not at all, so "check the
                 spelling" would be misleading advice — the address simply is
                 not on Hikmah Web. */
              <EmptyState
                icon="person"
                title="No account uses that email"
                message="An email has to match exactly. You could search their name or @handle instead."
              />
            ) : (
              <EmptyState
                icon="person"
                title={`No one matches “${debounced.trim()}”`}
                message="Check the spelling, or try their @handle."
              />
            )
          }
          ListFooterComponent={
            rows.length ? <ListFooter loading={loadingMore} done={!hasMore} doneLabel="That’s everyone" /> : null
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}

/* Memoized on scalars only — `selected` is the derived boolean, never the
   selection array, or every row would re-render on every tick of the picker. */
const PersonRow = React.memo(function PersonRow({
  user, selectMode, selected, showFollow, onPress,
}: {
  user: PeopleRow
  selectMode: boolean
  selected: boolean
  showFollow: boolean
  onPress: (user: PeopleRow) => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(user), [onPress, user])
  const affiliation = [user.academicTitle, user.institution].filter(Boolean).join(' · ')

  return (
    <TouchableRow onPress={press}>
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, minHeight: 64, gap: space.md, paddingVertical: space.sm }]}>
        <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={44} />

        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text variant="body" weight="600" numberOfLines={1} style={styles.shrink}>{user.full}</Text>
            {user.verified ? <VerifiedMark /> : null}
            <RoleTag role={user.role} />
          </View>
          <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{user.handle}</Text>
          {affiliation ? (
            <Text variant="caption" tone="faint" numberOfLines={1} style={{ marginTop: space.xxs }}>{affiliation}</Text>
          ) : null}
        </View>

        {selectMode ? (
          <View
            style={[
              styles.check,
              { borderColor: selected ? c.accent : c.borderStrong, backgroundColor: selected ? c.accent : 'transparent' },
            ]}
          >
            {selected ? <Icon name="check" size={15} color={c.textOnAccent} /> : null}
          </View>
        ) : showFollow ? (
          <FollowButton userId={user.id} name={user.full} confirmUnfollow={user.verified} />
        ) : null}
      </View>
    </TouchableRow>
  )
})

/* One selected person in the picker's token strip. */
const TokenChip = React.memo(function TokenChip({
  user, onPress,
}: { user: PeopleRow; onPress: (user: PeopleRow) => void }) {
  const c = useTheme().colors
  const press = React.useCallback(() => onPress(user), [onPress, user])
  return (
    <Touchable onPress={press} feedback="scale" style={styles.token}>
      <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={44} />
      <View style={[styles.tokenX, { backgroundColor: c.surfaceInverse }]}>
        <Icon name="close" size={10} color={c.bg} />
      </View>
      <Text variant="micro" tone="muted" align="center" numberOfLines={1} style={styles.tokenName}>
        {user.full}
      </Text>
    </Touchable>
  )
})

/* `role` arrives from the wire in whatever case the server used — the
   toUpperCase here normalizes the COMPARISON, it is not a display transform
   (the labels below are written, not derived). */
function RoleTag({ role }: { role: string }) {
  const r = String(role || '').toUpperCase()
  if (r === 'SCHOLAR') return <Chip label="Scholar" tone="scholar" size="sm" />
  if (r === 'RESEARCHER') return <Chip label="Researcher" tone="accent" size="sm" />
  if (r === 'ADMIN' || r === 'SUPER_ADMIN') return <Chip label="Admin" tone="neutral" size="sm" />
  return null
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  /* The search field and the filter are one block under the title, breathing
     on the same gutter as the rows below them. */
  chrome: { paddingBottom: space.sm2, gap: space.sm2 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingTop: space.md, paddingBottom: space.sm },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tokenStrip: { height: 84, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, justifyContent: 'center' },
  token: { width: 64, alignItems: 'center', paddingTop: space.xs2 },
  tokenX: {
    position: 'absolute', top: 2, end: 8, width: 18, height: 18,
    borderRadius: 9, alignItems: 'center', justifyContent: 'center',
  },
  tokenName: { marginTop: space.xs, width: 60 },
})
