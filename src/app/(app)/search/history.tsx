/* =========================================================
   Search history.

   Two stores, and the screen has to be honest that they are
   two: the MMKV list on this device (the only place a search is
   ever WRITTEN — there is no endpoint for that) and the
   account's own activity trail, which the server records by
   itself and the client can only read or delete.

   "Clear all" therefore runs three different erasures in order
   — local wipe, per-type activity clear, then the privacy
   endpoint's harder server-side wipe — and reports what
   actually succeeded. A partial failure that claims success is
   the worst possible outcome on a privacy screen, which is also
   why every destructive control is disabled while offline.

   This is the one surface in the domain with a live stream:
   `api.activity.stream` is a real per-user SSE, so a search
   made on another device shows up here without a refresh.
   ========================================================= */
import React from 'react'
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useAuthGate } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, EmptyState, ErrorState, Header, Icon, Screen,
  Skeleton, Text, Touchable, TouchableRow, fireHaptic, toast, useSheetState,
} from '@/ui'
import {
  href, listActivity, recentSearches, streamActivity,
  type ActivityRow, type Recent,
} from '@/components/search'

type Row =
  | { kind: 'local'; recent: Recent }
  | { kind: 'server'; row: ActivityRow }

interface Section { key: string; title: string; clear?: () => void; data: Row[] }

const SEARCH_TYPES_ON_SCREEN = ['GLOBAL_SEARCH', 'HASHTAG_SEARCH', 'MENTION_LOOKUP']
const PAGE = 30

/* Module scope. An inline `ItemSeparatorComponent={() => …}` is a new
   component TYPE at the same position on every parent render, so React tears
   the divider down and rebuilds it for every visible row rather than
   reconciling it — and this screen re-renders on every streamed activity row.
   keyExtractor is hoisted for the same identity reason. */
const keyExtractor = (item: Row) => (item.kind === 'local' ? `l:${item.recent.q}` : `s:${item.row.id}`)

function RowSeparator() {
  return <Divider inset={56} />
}

export default function SearchHistoryScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const gate = useAuthGate()
  const signedIn = gate === 'allow'

  const [recents, setRecents] = React.useState<Recent[]>(() => recentSearches.list())
  const [rows, setRows] = React.useState<ActivityRow[]>([])
  const [loading, setLoading] = React.useState(signedIn)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [done, setDone] = React.useState(false)
  const [wiping, setWiping] = React.useState(false)

  const busy = React.useRef(false)
  /* Read (not closed over) by `load` so paging always anchors on the list as
     rendered, streamed prepends included. */
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows
  const confirmAll = useSheetState()
  const confirmServer = useSheetState()

  const offline = isNetworkError(error)

  const load = React.useCallback(async (kind: 'first' | 'more' | 'refresh') => {
    if (!signedIn || busy.current) return
    if (kind === 'more' && done) return
    busy.current = true
    if (kind === 'first') setLoading(true)
    if (kind === 'refresh') setRefreshing(true)
    try {
      /* The server IGNORES `page` — any value returns the same newest window
         (activity.md §1). Walking back means passing the last row's createdAt
         as the INCLUSIVE `to` bound of the next request. */
      const anchor = kind === 'more' ? rowsRef.current[rowsRef.current.length - 1]?.createdAt : null
      if (kind === 'more' && !anchor) { setDone(true); return }
      const res = await listActivity({
        types: SEARCH_TYPES_ON_SCREEN,
        to: anchor ?? undefined,
        size: PAGE,
      })
      /* `to` is inclusive, so the anchor row always comes back — a page that
         carries nothing new is how the end of history announces itself. */
      const known = new Set(rowsRef.current.map(r => r.id))
      const fresh = kind === 'more' ? res.filter(r => !known.has(r.id)) : res
      setRows(prev => {
        const merged = kind === 'more' ? [...prev, ...fresh] : fresh
        const seen = new Set<string>()
        return merged.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      })
      setDone(res.length < PAGE || (kind === 'more' && !fresh.length))
      setError(null)
    } catch (e: any) {
      setError(e)
    } finally {
      busy.current = false
      setLoading(false); setRefreshing(false)
    }
  }, [signedIn, done])

  React.useEffect(() => { void load('first') }, [signedIn])   // eslint-disable-line react-hooks/exhaustive-deps

  /* A search made on another device lands here live. The stream is a no-op in
     mock mode. Focus-scoped, not mount-scoped: the backend caps a user at
     FIVE SSE emitters (LRU eviction), three of which are already held
     app-wide — a stream left open while this screen sits buried in the nav
     stack would burn a fourth for nothing. */
  useFocusEffect(React.useCallback(() => {
    if (!signedIn) return
    return streamActivity({
      onActivity: row => {
        if (!SEARCH_TYPES_ON_SCREEN.includes(row.type)) return
        setRows(prev => (prev.some(r => r.id === row.id) ? prev : [row, ...prev]))
      },
    })
  }, [signedIn]))

  /* ---- deletes ---- */

  const removeRecent = useEvent((r: Recent) => { fireHaptic('light'); setRecents(recentSearches.remove(r.q)) })

  const removeRow = async (row: ActivityRow) => {
    const at = rows.findIndex(r => r.id === row.id)
    setRows(prev => prev.filter(r => r.id !== row.id))
    try {
      await api.activity.remove(row.id)
    } catch (e: any) {
      /* Put it back where it was — a row that jumps to the top on failure
         reads as a second, different search. */
      setRows(prev => { const next = [...prev]; next.splice(Math.max(0, at), 0, row); return next })
      toast.error(errorText(e))
    }
  }

  const clearTypes = async (types: string[]) => {
    let deleted = 0
    for (const type of types) {
      /* The endpoint takes ONE type at a time. */
      const res: any = await api.activity.clear(type)
      deleted += Number(res?.deleted ?? 0)
    }
    setRows(prev => prev.filter(r => !types.includes(r.type)))
    return deleted
  }

  const clearSection = async (types: string[]) => {
    try {
      const n = await clearTypes(types)
      toast.ok(`${n} removed`)
    } catch (e: any) {
      toast.error(errorText(e))
      void load('first')
    }
  }

  const clearEverything = async () => {
    confirmAll.close()
    setWiping(true)
    const won: string[] = []
    setRecents(recentSearches.clear())
    won.push('this device')
    try {
      if (signedIn) { await clearTypes(SEARCH_TYPES_ON_SCREEN); won.push('your account') }
      if (signedIn) { await api.settings.data.clearHistory('search'); won.push('the server') }
      toast.ok(`Cleared from ${won.join(', ')}.`)
    } catch (e: any) {
      /* Report what actually landed; there is no restore on the server side. */
      toast.error(`Cleared from ${won.join(', ')}. ${errorText(e)}`)
    } finally {
      setWiping(false)
      void load('first')
    }
  }

  const wipeServer = async () => {
    confirmServer.close()
    setWiping(true)
    try {
      await api.settings.data.clearHistory('search')
      toast.ok('Server search history deleted')
      await load('first')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setWiping(false)
    }
  }

  /* ---- sections ---- */

  /* The three "Clear" actions are hoisted out of the sections literal so the
     memo below has nothing unstable to close over — a fresh arrow per render
     would rebuild `sections` on every frame and hand SectionList a new array
     to re-diff. */
  const clearLocal = useEvent(() => setRecents(recentSearches.clear()))
  const clearSearches = useEvent(() => void clearSection(['GLOBAL_SEARCH']))
  const clearTags = useEvent(() => void clearSection(['HASHTAG_SEARCH', 'MENTION_LOOKUP']))

  const sections = React.useMemo<Section[]>(() => {
    const searches = rows.filter(r => r.type === 'GLOBAL_SEARCH')
    const tagsAndMentions = rows.filter(r => r.type === 'HASHTAG_SEARCH' || r.type === 'MENTION_LOOKUP')
    return [
      {
        key: 'local',
        title: 'On this device',
        clear: recents.length ? clearLocal : undefined,
        data: recents.map((recent): Row => ({ kind: 'local', recent })),
      },
      ...(signedIn ? [
        {
          key: 'searches',
          title: 'Searches',
          clear: searches.length && !offline ? clearSearches : undefined,
          data: searches.map(row => ({ kind: 'server' as const, row })),
        },
        {
          key: 'tags',
          title: 'Tags & mentions',
          clear: tagsAndMentions.length && !offline ? clearTags : undefined,
          data: tagsAndMentions.map(row => ({ kind: 'server' as const, row })),
        },
      ] : []),
    ].filter(s => s.data.length || s.key === 'local')
  }, [rows, recents, signedIn, offline, clearLocal, clearSearches, clearTags])

  const empty = !recents.length && !rows.length && !loading

  /* ---- row plumbing ----
     Item-first and identity-stable, so the two row components below can be
     memoized and the separator/renderItem pair stops re-rendering every
     visible cell whenever a streamed row lands. */
  const openRecent = useEvent((r: Recent) => {
    router.push(href(`/explore?q=${encodeURIComponent(r.q)}`))
  })
  const openRow = useEvent((row: ActivityRow) => {
    if (row.deepLink) router.push(href(row.deepLink))
  })
  const dropRow = useEvent((row: ActivityRow) => { void removeRow(row) })

  const deleteLocked = offline || wiping

  const renderItem = React.useCallback(({ item }: { item: Row }) => (item.kind === 'local' ? (
    <LocalRow recent={item.recent} onOpen={openRecent} onRemove={removeRecent} />
  ) : (
    <ServerRow row={item.row} onOpen={openRow} onRemove={dropRow} locked={deleteLocked} />
  )), [openRecent, removeRecent, openRow, dropRow, deleteLocked])

  const renderSectionHeader = React.useCallback(({ section }: { section: any }) => (
    <SectionHead
      title={(section as Section).title}
      onClear={(section as Section).clear}
      disabled={wiping}
    />
  ), [wiping])

  return (
    <Screen background="sunken">
      <Header
        back
        title="Search history"
        actions={[{
          icon: 'trash',
          onPress: () => confirmAll.open(),
          label: 'Clear all',
          tone: 'danger',
        }]}
      />

      {offline ? (
        <Callout tone="warning" icon="offline" style={styles.banner}>
          You’re offline. Deleting is disabled until the connection is back — a half-applied wipe is worse than a deferred one.
        </Callout>
      ) : null}

      {!signedIn ? (
        <Callout tone="info" style={styles.banner} actionLabel="Sign in" onAction={() => router.push(href('/sign-in'))}>
          Sign in to manage the search history saved to your account. Searches on this device are listed below.
        </Callout>
      ) : null}

      {loading && !rows.length && !recents.length ? (
        <View style={{ paddingTop: space.md }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 56, gap: space.md }]}>
              <Skeleton circle width={32} height={32} />
              <Skeleton width="58%" height={13} />
            </View>
          ))}
        </View>
      ) : error && !rows.length && !recents.length ? (
        <ErrorState error={error} onRetry={() => void load('first')} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={keyExtractor}
          stickySectionHeadersEnabled
          onEndReachedThreshold={0.5}
          onEndReached={() => void load('more')}
          contentContainerStyle={{ paddingBottom: space.xxxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          renderSectionHeader={renderSectionHeader}
          ItemSeparatorComponent={RowSeparator}
          ListEmptyComponent={
            empty ? (
              <EmptyState
                icon="history"
                title="No search history"
                message="Searches you make while signed in show up here."
              />
            ) : null
          }
          renderItem={renderItem}
          ListFooterComponent={
            <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
              <Text variant="footnote" tone="muted" align="ui">
                Searches are used to rank what you see. Clearing them here also asks the server to forget them.
              </Text>
              <Button
                label="Delete server search history"
                variant="secondary"
                size="lg"
                block
                loading={wiping}
                disabled={!signedIn || offline || wiping}
                onPress={() => confirmServer.open()}
              />
            </View>
          }
        />
      )}

      <ConfirmSheet
        visible={confirmAll.visible}
        onClose={confirmAll.close}
        title="Clear search history?"
        message="This removes searches from this device and from your account. This can’t be undone."
        confirmLabel="Clear all"
        destructive
        loading={wiping}
        onConfirm={() => void clearEverything()}
      />

      <ConfirmSheet
        visible={confirmServer.visible}
        onClose={confirmServer.close}
        title="Delete server search history?"
        message="The server forgets every search tied to your account. This is separate from clearing the list above, and it can’t be undone."
        confirmLabel="Delete"
        destructive
        loading={wiping}
        onConfirm={() => void wipeServer()}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The three cells, memoized and fed item-first handlers. The
   screen re-renders on every streamed activity row; without
   these the whole visible list repaints for a row that landed
   off screen.
   --------------------------------------------------------- */

const SectionHead = React.memo(function SectionHead({
  title, onClear, disabled,
}: { title: string; onClear?: () => void; disabled: boolean }) {
  const t = useTheme()
  return (
    <View style={[styles.sectionHead, { backgroundColor: t.colors.bgSunken, paddingHorizontal: t.layout.screenPadding }]}>
      <Text variant="caption" tone="muted" align="ui" style={styles.flex}>{title}</Text>
      {onClear ? (
        <Touchable onPress={onClear} feedback="dim" disabled={disabled}>
          <Text variant="subhead" tone="danger">Clear</Text>
        </Touchable>
      ) : null}
    </View>
  )
})

const LocalRow = React.memo(function LocalRow({
  recent, onOpen, onRemove,
}: { recent: Recent; onOpen: (r: Recent) => void; onRemove: (r: Recent) => void }) {
  const t = useTheme()
  const c = t.colors
  const open = React.useCallback(() => onOpen(recent), [onOpen, recent])
  const remove = React.useCallback(() => onRemove(recent), [onRemove, recent])

  return (
    <TouchableRow onPress={open}>
      <View style={[styles.row, { backgroundColor: c.surface, paddingHorizontal: t.layout.screenPadding, height: 48, gap: space.md }]}>
        <Icon name={recent.kind === 'tag' ? 'hash' : 'history'} size={20} color={c.textMuted} />
        <Text variant="body" numberOfLines={1} style={styles.flex}>{recent.q}</Text>
        <Touchable onPress={remove} feedback="dim" accessibilityLabel="Remove">
          <Icon name="close" size={18} color={c.textFaint} />
        </Touchable>
      </View>
    </TouchableRow>
  )
})

const ServerRow = React.memo(function ServerRow({
  row, onOpen, onRemove, locked,
}: {
  row: ActivityRow
  onOpen: (row: ActivityRow) => void
  onRemove: (row: ActivityRow) => void
  locked: boolean
}) {
  const t = useTheme()
  const c = t.colors
  const open = React.useCallback(() => onOpen(row), [onOpen, row])
  const remove = React.useCallback(() => onRemove(row), [onRemove, row])

  return (
    <TouchableRow onPress={open} disabled={!row.deepLink}>
      <View style={[styles.row, { backgroundColor: c.surface, paddingHorizontal: t.layout.screenPadding, height: 56, gap: space.md }]}>
        <View style={[styles.glyph, { backgroundColor: c.accentSoft }]}>
          <Icon
            name={row.type === 'HASHTAG_SEARCH' ? 'hash' : row.type === 'MENTION_LOOKUP' ? 'at' : 'search'}
            size={16}
            color={c.accent}
          />
        </View>
        <View style={styles.flex}>
          {/* Server-rendered copy. Shown verbatim — never re-worded. */}
          <Text variant="callout" numberOfLines={1}>{row.subtitle || row.label}</Text>
          <Text variant="caption" tone="faint" align="ui">{row.time}</Text>
        </View>
        <Touchable onPress={remove} feedback="dim" disabled={locked} accessibilityLabel="Remove">
          <Icon name="close" size={18} color={c.textFaint} />
        </Touchable>
      </View>
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 34 },
  glyph: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  banner: { margin: space.lg, marginBottom: 0 },
})
