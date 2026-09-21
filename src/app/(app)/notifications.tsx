/* =========================================================
   The notification inbox.

   Three server truths shape every line of this screen:

   1. THE SCAN WINDOW. Filtering, category counts and bulk
      marking all run over the newest 200 rows. A filtered page
      past that comes back EMPTY even though older matches
      exist — so an empty page is "the end", never an error, and
      the note under the list says so out loud.
   2. AGGREGATION KEEPS THE ID. A coalesced re-delivery reuses
      the row's id, rewrites its body and resets it to unread.
      So the list UPSERTS BY ID and floats the row to the top;
      appending would show the same notification twice.
   3. THE BADGE HAS ONE OWNER. An aggregation bump resurfaces a
      row without moving the counter, so any local ±1 drifts
      immediately. RealtimeProvider SETS it from the
      authoritative `unread-count` event and from the O(1)
      counter endpoint; this screen only re-seeds it.

   The stream itself is not opened here — RealtimeProvider fans
   the one shared socket out, and the server evicts the oldest
   emitter at five per user.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { api, errorText, isNetworkError, isNotFound, isTransient } from '@/api'
import { useNotificationEvents, useNotificationUnread, useRealtimeApi, useReconcile } from '@/context/RealtimeContext'
import { useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, Chip, ConfirmSheet, EmptyState, ErrorState, Header,
  Icon, ListFooter, Screen, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { FilterChipRail } from '@/components/notifications/FilterChipRail'
import {
  DateSectionHeader, NewItemsPill, NotificationSkeleton, ScanWindowNote,
} from '@/components/notifications/ListParts'
import { NotificationRow } from '@/components/notifications/NotificationRow'
import { SwipeableRow } from '@/components/notifications/SwipeableRow'
import { TypeFilterSheet } from '@/components/notifications/TypeFilterSheet'
import { INBOX_TABS, SERVER_CATEGORIES, dateBucket } from '@/components/notifications/constants'
import type { NotifRow } from '@/components/notifications/types'

type ListItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; row: NotifRow }

interface Confirm {
  title: string
  message: string
  label: string
  destructive?: boolean
  run: () => Promise<void>
}

interface NotifPage { items: NotifRow[]; total: number; hasMore: boolean; page: number }

/* The api modules are JS. TypeScript infers their option bags from the
   destructuring defaults alone, so the filter keys (which have no default)
   vanish from the inferred signature — these two aliases restore the real
   contract documented in api/notifications.js. */
const listNotifications = api.notifications.list as (
  args: { category?: string; type?: string[]; unread?: true | undefined; page?: number; size?: number; signal?: AbortSignal },
) => Promise<NotifPage>
const listUnread = api.notifications.unreadList as (
  args: { page?: number; size?: number; signal?: AbortSignal },
) => Promise<NotifPage>

const PAGE_SIZE = 30
/** The client slices bulk mark-read at 200 ids, silently. Say so instead. */
const BULK_CAP = 200
/** Below this scroll offset a new row just appears; above it, the pill counts. */
const PILL_OFFSET = 200

/* Session-scoped, not persisted: dismissing the push card should last until
   the app is killed, and a stored flag would silently outlive a reinstall of
   the user's mind about notifications. */
let pushCardDismissed = false

/* Module scope, both of them. FlashList's ViewHolder memo compares these by
   identity (and pools recycled cells by itemType), so a fresh arrow per render
   re-renders every mounted cell and collapses the header and row pools into
   one — a date header's React key then gets handed to a full notification row,
   which tears the subtree down instead of swapping props. */
const keyExtractor = (item: ListItem) => item.key
const getItemType = (item: ListItem) => item.kind

export default function NotificationsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const notificationUnread = useNotificationUnread()
  const { refreshBadges } = useRealtimeApi()

  const [tab, setTab] = React.useState('all')
  const [types, setTypes] = React.useState<string[]>([])
  const [unreadOnly, setUnreadOnly] = React.useState(false)

  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [catCounts, setCatCounts] = React.useState<Record<string, number>>({})
  const [newCount, setNewCount] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [showPushCard, setShowPushCard] = React.useState(false)

  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  const listRef = React.useRef<FlashListRef<ListItem>>(null)
  const offset = React.useRef(0)
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)
  /* Measured rather than derived: the header's height depends on whether the
     chip rail, the filter row and the large title are showing. */
  const [chromeHeight, setChromeHeight] = React.useState(0)

  const overflow = useSheetState()
  const rowMenu = useSheetState<NotifRow>()
  const typeSheet = useSheetState()
  const confirm = useSheetState<Confirm>()

  const activeTab = INBOX_TABS.find(x => x.key === tab) ?? INBOX_TABS[0]
  const filtersActive = tab !== 'all' || types.length > 0 || unreadOnly
  const typesKey = types.join(',')

  /* buildUrl drops undefined but KEEPS false, so `unread: false` would filter
     the inbox down to READ rows. It is either `true` or absent. */
  const query = React.useMemo(() => {
    if (types.length) return { type: types }
    if (activeTab.category) return { category: activeTab.category }
    if (activeTab.types) return { type: activeTab.types }
    return {}
  }, [types, activeTab])

  const plainAll = !('type' in query) && !('category' in query)

  const fetchPage = React.useCallback(async ({ page, pageSize, signal }: { page?: number; pageSize: number; signal?: AbortSignal }) => {
    /* The dedicated unread endpoint is the server's own shorthand — but it
       takes no filters, so any other combination has to go through list(). */
    if (unreadOnly && plainAll) return listUnread({ page, size: pageSize, signal })
    return listNotifications({
      ...query,
      unread: unreadOnly ? true : undefined,
      page,
      size: pageSize,
      signal,
    })
  }, [query, plainAll, unreadOnly])

  const {
    items, error, loading, refreshing, loadingMore, done,
    loadMore, refresh, reload, setItems, patch, remove,
  } = usePaged<NotifRow>(fetchPage, {
    mode: 'page',
    pageSize: PAGE_SIZE,
    deps: [tab, typesKey, unreadOnly],
  })

  /* ---------- counts ---------- */

  const loadCategoryCounts = React.useCallback(async () => {
    const pairs = await Promise.all(SERVER_CATEGORIES.map(async cat => {
      try { return [cat, await api.notifications.unreadCount(cat)] as const } catch { return [cat, 0] as const }
    }))
    setCatCounts(Object.fromEntries(pairs))
  }, [])

  React.useEffect(() => { void loadCategoryCounts() }, [loadCategoryCounts])

  /* One reseed is EIGHT requests: two badge counts plus one unread-count per
     server category. Every row tap runs markRead, which reseeds, so tapping
     through ten unread notifications used to fire eighty — and twice that when
     the server echoes the actor's own read frame back over SSE. The chip dots
     are decoration, not a live number, so they coalesce on a trailing timer
     the way scheduleUpsert above does. */
  const reseedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (!reseedTimer.current) return
    clearTimeout(reseedTimer.current)
    /* A pending reseed at unmount still owes the app-wide badge its update —
       tapping a row marks it read and then leaves, and the tab-bar dot must
       not be left counting it. The category chips die with the screen. */
    void refreshBadges()
  }, [refreshBadges])

  /** No wait: a socket that just (re)connected is exactly when staleness is
   *  the point of the read. */
  const reseedNow = React.useCallback(() => {
    if (reseedTimer.current) { clearTimeout(reseedTimer.current); reseedTimer.current = null }
    void refreshBadges()
    void loadCategoryCounts()
  }, [refreshBadges, loadCategoryCounts])

  const reseed = React.useCallback(() => {
    if (reseedTimer.current) clearTimeout(reseedTimer.current)
    reseedTimer.current = setTimeout(() => { reseedTimer.current = null; reseedNow() }, 700)
  }, [reseedNow])

  /* ---------- push soft-ask ---------- */

  React.useEffect(() => {
    if (pushCardDismissed) return
    let alive = true
    Notifications.getPermissionsAsync()
      .then(p => { if (alive && !p.granted && p.canAskAgain) setShowPushCard(true) })
      .catch(() => { /* a simulator without the module must not break the inbox */ })
    return () => { alive = false }
  }, [])

  /* ---------- realtime ---------- */

  const upsertTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const upsertSeq = React.useRef(0)

  /* The SSE row is the RAW persisted record: no `id` (it is `notificationId`),
     no `isRead`, no category, no actor, no deepLink. So it is never rendered —
     it is only a signal that the inbox changed, and the enriched rows come
     back from REST. */
  const scheduleUpsert = React.useCallback(() => {
    if (upsertTimer.current) clearTimeout(upsertTimer.current)
    upsertTimer.current = setTimeout(async () => {
      const mine = ++upsertSeq.current
      try {
        const res = await fetchPage({ page: 0, pageSize: PAGE_SIZE })
        if (mine !== upsertSeq.current) return
        const fresh = res.items || []
        const freshIds = new Set(fresh.map(r => r.id))
        /* Float to top and replace: a coalesced re-delivery reuses the id. */
        setItems(prev => [...fresh, ...prev.filter(r => !freshIds.has(r.id))])
      } catch { /* the next event or a pull-to-refresh will catch this up */ }
      reseed()
    }, 600)
  }, [fetchPage, setItems, reseed])

  React.useEffect(() => () => { if (upsertTimer.current) clearTimeout(upsertTimer.current) }, [])

  useNotificationEvents(e => {
    /* The notification socket's OWN (re)connect — distinct from useReconcile
       below, which keys off the CHAT stream's epoch. Anything pushed while
       THIS stream was down is gone; every connect is the re-read-via-REST
       signal (realtime overview §7). */
    if (e.type === 'connected') { void reload(); reseedNow(); return }

    /* FEED_NEW_POST rides the same socket for the home feed's pill. A separate
       POST_NEW row is delivered for the same post, so counting both here would
       double-count every new post. */
    if (e.type === 'feed-new-post') return

    if (e.type === 'notification') {
      if (offset.current > PILL_OFFSET) setNewCount(n => n + 1)
      scheduleUpsert()
      return
    }

    if (e.type === 'read') {
      const ids = new Set((e.ids || []).map(String))
      setItems(prev => prev.map(r => (e.allRead || ids.has(r.id) ? { ...r, unread: false } : r)))
      reseed()
      return
    }

    if (e.type === 'deleted') {
      const ids = (e.ids || []).map(String)
      /* { ids: [], allRead: true } is the purge-read ECHO — "drop every read
         row", not "nothing was deleted". */
      if (!ids.length && e.allRead) setItems(prev => prev.filter(r => r.unread))
      else setItems(prev => prev.filter(r => !ids.includes(r.id)))
      reseed()
    }
  })

  /* Every (re)connect is a reconcile signal: anything pushed while the socket
     was down is gone, and REST is the only way back. */
  useReconcile(() => { void reload(); reseedNow() })

  /* ---------- one silent retry for a documented-transient read ---------- */

  const autoRetried = React.useRef(false)
  React.useEffect(() => {
    if (!error) { autoRetried.current = false; return }
    if (!isTransient(error) || autoRetried.current || items.length) return
    autoRetried.current = true
    const id = setTimeout(() => { void reload() }, 3000)
    return () => clearTimeout(id)
  }, [error, items.length, reload])

  /* ---------- navigation ---------- */

  const navigate = React.useCallback((link: string | null) => {
    if (!link) return
    const [pathname, fragment] = link.split('#')
    /* expo-router cannot route a fragment; moderation rows resolve to
       /settings/safety#moderation, so the hash becomes a param. */
    if (fragment) router.push({ pathname, params: { section: fragment } } as any)
    else router.push(link as any)
  }, [router])

  /* ---------- mutations ---------- */

  const markRead = React.useCallback(async (row: NotifRow) => {
    if (!row.unread) return
    patch(row.id, r => ({ ...r, unread: false }))
    try {
      await api.notifications.markRead(row.id)
    } catch (e: any) {
      /* 404 = unknown id or someone else's row. Either way it is gone: drop it
         quietly rather than accusing the user of an error. */
      if (isNotFound(e)) remove(row.id)
      else { patch(row.id, r => ({ ...r, unread: true })); toast.error(errorText(e)) }
    }
    reseed()
  }, [patch, remove, reseed])

  const deleteRow = React.useCallback(async (row: NotifRow) => {
    const index = items.findIndex(r => r.id === row.id)
    remove(row.id)
    try {
      await api.notifications.remove(row.id)
      /* No Undo anywhere in this domain: there is no restore endpoint, and an
         Undo that cannot be honoured is a lie. */
      toast.info('Notification deleted')
    } catch (e: any) {
      setItems(prev => {
        const at = index < 0 ? prev.length : Math.min(index, prev.length)
        return [...prev.slice(0, at), row, ...prev.slice(at)]
      })
      toast.error(errorText(e))
    }
    reseed()
  }, [items, remove, setItems, reseed])

  const runBulk = React.useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e: any) {
      startCooldown(e)
      toast.error(errorText(e))
    } finally {
      setBusy(false)
      reseed()
    }
  }, [startCooldown, reseed])

  const markAllRead = () => runBulk(async () => {
    await api.notifications.markAllRead()
    setItems(prev => prev.map(r => ({ ...r, unread: false })))
    toast.ok('All caught up')
  })

  const markCategoryRead = (category: string) => runBulk(async () => {
    const updated: number = await api.notifications.markCategoryRead(category)
    setItems(prev => prev.map(r => (r.category === category ? { ...r, unread: false } : r)))
    toast.ok(`${updated} marked as read`)
    void reload()
  })

  const clearRead = () => runBulk(async () => {
    const deleted: number = await api.notifications.deleteRead()
    setItems(prev => prev.filter(r => r.unread))
    toast.ok(`${deleted} notification${deleted === 1 ? '' : 's'} cleared`)
  })

  const markSelectedRead = () => runBulk(async () => {
    const ids = [...selected]
    const updated: number = await api.notifications.markReadBulk(ids)
    const set = new Set(ids)
    setItems(prev => prev.map(r => (set.has(r.id) ? { ...r, unread: false } : r)))
    /* Foreign and unknown ids are skipped silently, so `updated` legitimately
       comes back smaller than the selection. That is not a failure. */
    toast.ok(`${updated} marked as read`)
    exitSelection()
  })

  const deleteSelected = () => runBulk(async () => {
    const ids = [...selected]
    const set = new Set(ids)
    setItems(prev => prev.filter(r => !set.has(r.id)))
    await pool(ids, 5, id => api.notifications.remove(id))
    toast.info(`${ids.length} deleted`)
    exitSelection()
  })

  /* ---------- selection ---------- */

  const exitSelection = () => { setSelectionMode(false); setSelected(new Set()) }

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const selectAll = () => setSelected(new Set(items.map(r => r.id)))

  /* ---------- row plumbing ----------
     Item-first and identity-stable (useEvent), so ONE function serves every
     row and renderItem's identity survives a list mutation — `deleteRow`
     alone is re-created on every page append because it closes over `items`,
     and a renderItem that listed it would re-render the whole viewport. */

  const onRowPress = useEvent((row: NotifRow) => {
    if (selectionMode) { toggleSelect(row.id); return }
    void markRead(row)
    navigate(row.deepLink)
  })
  const onRowLongPress = useEvent((row: NotifRow) => { if (!selectionMode) rowMenu.open(row) })
  const onRowModerationPress = useEvent((row: NotifRow) => navigate(row.deepLink))
  const onRowMarkRead = useEvent((row: NotifRow) => { void markRead(row) })
  const onRowDelete = useEvent((row: NotifRow) => { void deleteRow(row) })

  /* ---------- filters ---------- */

  const scrollTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: true })

  const changeTab = (key: string) => {
    setTab(key)
    /* The server lets `category` win when both are sent, so picking a chip has
       to drop the type filter — otherwise the user's types are silently
       ignored and the list looks broken. */
    setTypes([])
    setNewCount(0)
    scrollTop()
  }

  const applyTypes = (next: string[]) => {
    setTypes(next)
    if (next.length) setTab('all')
    setNewCount(0)
    scrollTop()
  }

  const clearFilters = () => { setTab('all'); setTypes([]); setUnreadOnly(false); scrollTop() }

  const onRefresh = React.useCallback(() => {
    setNewCount(0)
    void refresh()
    reseed()
  }, [refresh, reseed])

  /* ---------- list assembly ---------- */

  const data = React.useMemo<ListItem[]>(() => {
    const out: ListItem[] = []
    const seen = new Set<string>()
    let bucket = ''
    for (const row of items) {
      /* An SSE-driven head upsert and a page append can both carry the same
         id; a duplicate key is a hard crash in FlashList. */
      if (!row?.id || seen.has(row.id)) continue
      seen.add(row.id)
      const b = dateBucket(row.createdAt)
      /* The index keeps the key unique even if a floated row re-opens a bucket
         that already appeared — a duplicate key is a hard crash in FlashList. */
      if (b !== bucket) { bucket = b; out.push({ kind: 'header', key: `h:${b}:${out.length}`, title: b }) }
      out.push({ kind: 'row', key: row.id, row })
    }
    /* The push banner is deliberately NOT in this array. Every in-list home
       tried for it lost to list machinery: as ListHeaderComponent its height
       became firstItemOffset and the sticky overlay pinned a phantom date
       header over it; as a data item at index 0, FlashList v2's default
       maintainVisibleContentPosition absorbed its appearance as a content-
       offset jump that shoved it above the viewport. It renders as plain
       chrome between the header and the list instead — nothing in the list
       can cover, anchor away, or clip what is not in the list. */
    return out
  }, [items])

  const stickyIndices = React.useMemo(
    () => data.reduce<number[]>((acc, it, i) => { if (it.kind === 'header') acc.push(i); return acc }, []),
    [data],
  )

  const offlineStrip = isNetworkError(error) && items.length > 0
  const destructiveDisabled = busy || offlineStrip || cooldown > 0

  /* The offset ref is written on every frame, but React is told only when the
     collapse boolean actually flips — the functional update bails out on an
     unchanged value, so a scroll no longer re-renders the screen (and with it
     every mounted cell) sixty times a second. */
  const onScroll = React.useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y
    offset.current = y
    const next = y > 8
    setCollapsed(prev => (prev === next ? prev : next))
  }, [])

  /* Stable identities for the list's furniture: a freshly-built object or
     element here re-renders the header/footer ViewHolder on every tick. */
  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + (selectionMode ? 96 : 32) }),
    [insets.bottom, selectionMode],
  )

  const listFooter = React.useMemo(() => (
    <>
      <ListFooter
        loading={loadingMore}
        error={items.length ? error : null}
        onRetry={loadMore}
        done={done && items.length > 0 && !filtersActive}
        doneLabel="You're all caught up."
      />
      {done && items.length > 0 && filtersActive ? (
        <ScanWindowNote text="Filters only search your 200 most recent notifications. Older matches exist but aren't reachable from here." />
      ) : null}
    </>
  ), [loadingMore, error, items.length, loadMore, done, filtersActive])

  /* Rendered as chrome ABOVE the list (never inside it — see the data memo's
     note), so it is visible in every list state: loading, error, empty, full. */
  const pushBanner = React.useMemo(() => (showPushCard && !selectionMode ? (
    <View style={styles.pushCard}>
      <Callout
        tone="info"
        icon="bell"
        title="Turn on push notifications"
        actionLabel="Open settings"
        onAction={() => router.push('/settings/notifications' as any)}
        onDismiss={() => { pushCardDismissed = true; setShowPushCard(false) }}
      >
        Get followed, mentioned and replied-to alerts on your lock screen.
      </Callout>
    </View>
  ) : null), [showPushCard, selectionMode, router])

  /* Re-created only when something a row actually renders moves: the selection
     mode, the selection itself, the offline lock and the two action tints.
     NotificationRow's memo then absorbs every row whose `selected` boolean did
     not flip, so toggling one checkbox repaints one row, not the viewport. */
  const renderItem = React.useCallback(({ item }: { item: ListItem }) => {
    if (item.kind === 'header') return <DateSectionHeader title={item.title} />
    const row = item.row
    return (
      <SwipeableRow
        resetKey={String(row.id)}
        enabled={!selectionMode && !offlineStrip}
        leading={row.unread ? { label: 'Read', icon: 'checkCircle', tint: c.accent, onTrigger: () => onRowMarkRead(row) } : null}
        trailing={[
          ...(row.unread ? [{ label: 'Read', icon: 'checkCircle' as const, tint: c.accent, onTrigger: () => onRowMarkRead(row) }] : []),
          { label: 'Delete', icon: 'trash' as const, tint: c.danger, onTrigger: () => onRowDelete(row) },
        ]}
      >
        <NotificationRow
          row={row}
          selectionMode={selectionMode}
          selected={selected.has(row.id)}
          onPress={onRowPress}
          onLongPress={onRowLongPress}
          onModerationPress={onRowModerationPress}
        />
      </SwipeableRow>
    )
  }, [
    selectionMode, offlineStrip, selected, c.accent, c.danger,
    onRowMarkRead, onRowDelete, onRowPress, onRowLongPress, onRowModerationPress,
  ])

  const empty = (
    <>
      {filtersActive
        ? (
          <EmptyState
            icon="filter"
            title={unreadOnly && tab === 'all' && !types.length ? 'No unread notifications' : `Nothing in ${types.length ? 'this type filter' : activeTab.label}`}
            message="Nothing here matches the filters you picked."
            actionLabel="Clear filters"
            onAction={clearFilters}
          />
        )
        : (
          <EmptyState
            icon="bell"
            title="No notifications yet"
            message="When people react to your posts, follow you, or mention you, it shows up here."
          />
        )}
    </>
  )

  return (
    <Screen>
      <View onLayout={e => setChromeHeight(e.nativeEvent.layout.height)}>
        <Header
          back={selectionMode ? () => exitSelection() : true}
          closeButton={selectionMode}
          title={selectionMode ? `${selected.size} selected` : 'Notifications'}
          large={!selectionMode}
          collapsed={collapsed}
          actions={selectionMode
            ? [{ icon: 'checkCircle', onPress: selectAll, label: 'Select all' }]
            : [
              /* The mentions FEED is not this inbox: /mentions/me is browsable
                 history across posts, comments, research and Q&A, while a
                 USER_MENTIONED row here is one delivery that aggregation can
                 rewrite. The @ button is the entry point to that history. */
              { icon: 'at', onPress: () => router.push('/mentions' as any), label: 'Mentions' },
              { icon: 'more', onPress: () => overflow.open(), label: 'More' },
            ]}
          below={selectionMode ? null : (
            <>
              <FilterChipRail
                options={INBOX_TABS}
                value={types.length ? '' : tab}
                onChange={changeTab}
                dotFor={key => (catCounts[key] ?? 0) > 0}
              />
              <View style={styles.filterRow}>
                <Chip
                  label="Unread only"
                  icon={unreadOnly ? 'checkCircle' : 'bell'}
                  tone="accent"
                  selected={unreadOnly}
                  size="sm"
                  onPress={() => { setUnreadOnly(v => !v); scrollTop() }}
                />
                {types.length ? (
                  <Chip
                    label={`${types.length} type${types.length === 1 ? '' : 's'}`}
                    icon="filter"
                    tone="accent"
                    selected
                    size="sm"
                    onPress={() => typeSheet.open()}
                    onRemove={() => applyTypes([])}
                  />
                ) : null}
                <View style={styles.flex} />
                {filtersActive ? (
                  <Touchable onPress={clearFilters} feedback="dim" style={styles.textBtn}>
                    <Text variant="subhead" tone="accent" align="ui">Clear filters</Text>
                  </Touchable>
                ) : notificationUnread > 0 ? (
                  <Text variant="footnote" tone="muted" align="ui">{notificationUnread} unread</Text>
                ) : null}
              </View>
            </>
          )}
        />
      </View>

      {offlineStrip ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn}
          style={[styles.offline, { backgroundColor: c.warningSoft }]}
        >
          <Icon name="offline" size={14} color={c.warningText} />
          <Text variant="footnote" tone="warning" align="ui">
            You&apos;re offline — showing your last loaded notifications.
          </Text>
        </Animated.View>
      ) : null}

      {/* Pinned between chrome and list — the one place no list machinery
          (sticky overlays, content anchoring) can ever hide it. */}
      {pushBanner}

      {/* Skeleton only on an EMPTY load: `loading` also goes true for the
          reload() every SSE reconnect fires, and unmounting a populated list
          for it would trash scroll position and sticky state on every
          network blip. */}
      {loading && !items.length ? <NotificationSkeleton /> : error && !items.length ? (
        <ErrorState error={error} onRetry={reload} title="Couldn't load notifications" />
      ) : (
        <FlashList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          extraData={`${selectionMode}:${selected.size}`}
          stickyHeaderIndices={stickyIndices}
          ListEmptyComponent={empty}
          onScroll={onScroll}
          scrollEventThrottle={32}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={contentStyle}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          ListFooterComponent={listFooter}
        />
      )}

      <NewItemsPill
        count={newCount}
        top={chromeHeight + 8}
        onPress={() => { setNewCount(0); scrollTop(); void refresh() }}
      />

      {selectionMode ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn}
          style={[
            styles.selectionBar,
            { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: c.bgElevated, borderTopColor: c.separator },
          ]}
        >
          <Button
            label={selected.size > BULK_CAP ? `Up to ${BULK_CAP} at a time` : 'Mark read'}
            icon="checkCircle"
            variant="secondary"
            size="md"
            style={styles.flex}
            disabled={!selected.size || selected.size > BULK_CAP || destructiveDisabled}
            onPress={markSelectedRead}
          />
          <Button
            label="Delete"
            icon="trash"
            variant="danger"
            size="md"
            style={styles.flex}
            disabled={!selected.size || destructiveDisabled}
            onPress={() => confirm.open({
              title: `Delete ${selected.size} notification${selected.size === 1 ? '' : 's'}?`,
              message: 'This cannot be undone — deleted notifications cannot be restored.',
              label: 'Delete',
              destructive: true,
              run: deleteSelected,
            })}
          />
        </Animated.View>
      ) : null}

      {/* ---------- overflow ---------- */}
      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title="Notifications"
        actions={[
          {
            label: cooldown > 0 ? `Wait ${cooldown}s` : 'Mark all as read',
            icon: 'checkCircle',
            disabled: notificationUnread === 0 || destructiveDisabled,
            onPress: () => confirm.open({
              title: 'Mark all as read?',
              message: 'This covers your 200 most recent notifications.',
              label: 'Mark all read',
              run: markAllRead,
            }),
          },
          activeTab.category ? {
            label: `Mark ${activeTab.label} as read`,
            icon: 'check',
            disabled: destructiveDisabled,
            onPress: () => markCategoryRead(activeTab.category!),
          } : null,
          { label: 'Filter by type…', icon: 'filter', onPress: () => typeSheet.open() },
          { label: 'Select', icon: 'list', onPress: () => setSelectionMode(true) },
          {
            label: 'Clear read notifications',
            icon: 'trash',
            destructive: true,
            disabled: destructiveDisabled,
            onPress: () => confirm.open({
              title: 'Clear read notifications?',
              message: "This permanently removes every notification you've already read. Unread ones are kept.",
              label: 'Clear',
              destructive: true,
              run: clearRead,
            }),
          },
          { label: 'Notification settings', icon: 'settings', onPress: () => router.push('/settings/notifications' as any) },
          { label: 'Email preferences', icon: 'mail', onPress: () => router.push('/settings/notifications/email' as any) },
        ]}
      />

      {/* ---------- one row's long-press menu ---------- */}
      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.title}
        subtitle={rowMenu.payload?.time}
        actions={rowMenu.payload ? [
          rowMenu.payload.deepLink
            ? { label: 'Open', icon: 'external', onPress: () => navigate(rowMenu.payload!.deepLink) }
            : null,
          /* There is no mark-as-UNREAD endpoint, so that option must not exist. */
          rowMenu.payload.unread
            ? { label: 'Mark as read', icon: 'checkCircle', onPress: () => void markRead(rowMenu.payload!) }
            : null,
          rowMenu.payload.type ? {
            label: 'Turn off notifications like this',
            icon: 'mutedBell',
            onPress: () => router.push({ pathname: '/settings/notifications', params: { highlight: rowMenu.payload!.type! } } as any),
          } : null,
          {
            label: 'Select',
            icon: 'list',
            onPress: () => { setSelectionMode(true); setSelected(new Set([rowMenu.payload!.id])) },
          },
          {
            label: 'Delete',
            icon: 'trash',
            destructive: true,
            onPress: () => void deleteRow(rowMenu.payload!),
          },
        ] : []}
      />

      <TypeFilterSheet
        visible={typeSheet.visible}
        onClose={typeSheet.close}
        value={types}
        onApply={applyTypes}
        categoryActive={!!activeTab.category}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={confirm.payload?.title ?? ''}
        message={confirm.payload?.message}
        confirmLabel={confirm.payload?.label ?? 'Confirm'}
        destructive={confirm.payload?.destructive}
        loading={busy}
        onConfirm={() => { const spec = confirm.payload; confirm.close(); void spec?.run() }}
      />
    </Screen>
  )
}

/** Bounded-concurrency map. The delete endpoint is per-id and a selection of
 *  200 fired at once would trip the gateway before the server. */
async function pool<T>(list: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  const queue = [...list]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift()!
      try { await fn(next) } catch { /* 204 for foreign ids; a real failure surfaces on the next refresh */ }
    }
  })
  await Promise.all(workers)
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm2, minHeight: 36 },
  flex: { flex: 1 },
  textBtn: { paddingVertical: space.xs },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, height: 32 },
  pushCard: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md },
  /* The banner cell when hidden: zero height, zero shift. */
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
