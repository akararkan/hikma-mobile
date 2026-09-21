/* =========================================================
   Research search.

   The research controller has no full-text endpoint of its
   own; the unified search surface scoped to types:['RESEARCH']
   is the documented way in. Two consequences shape this screen:

     · `degraded: true` means Elasticsearch was unreachable and
       the empty list is a FAILURE, not "nothing matched" — so
       the zero-results copy must never render in that case
     · paging is by opaque cursor, and the first call already
       opens cursor mode, so the second page really advances
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Share } from 'react-native'
import { api, hitHref } from '@/api'
import { hitPath } from '@/components/search/pushHit'
import { useDebounced, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Callout, Chip, Divider, EmptyState, Icon, Screen, SearchField,
  Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ErrorPanel } from '@/components/research/states'
import { useRecentSearches } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { SearchHitRow } from '@/components/research/types'

type Scope = 'papers' | 'papersAuthors'

/* Module scope. `Sep` in particular: an inline arrow is a fresh component
   TYPE each render, so React remounts every visible divider rather than
   reconciling it, and FlashList's ViewHolder memo compares the prop by
   identity on top of that. `getItemType` splits the recycle pool because a
   USER hit leads with an Avatar and a paper hit with a scholar tile — one
   shared pool hands a tile's React key to an Avatar and tears the subtree
   down instead of swapping props. */
const keyExtractor = (h: SearchHitRow, i: number) => `${h.contentType}:${h.contentId}:${i}`
const getItemType = (h: SearchHitRow) => (h.contentType === 'USER' ? 'USER' : 'DOC')
const Sep = () => <Divider inset={64} />

export default function ResearchSearchScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { recent, push, remove, clear } = useRecentSearches()

  const [query, setQuery] = React.useState('')
  const [scope, setScope] = React.useState<Scope>('papers')
  const [hits, setHits] = React.useState<SearchHitRow[]>([])
  const [cursor, setCursor] = React.useState('')
  const [degraded, setDegraded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [more, setMore] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const menu = useSheetState<SearchHitRow>()

  const debounced = useDebounced(query.trim(), 250)
  const abort = React.useRef<AbortController | null>(null)
  const types = scope === 'papers' ? ['RESEARCH'] : ['RESEARCH', 'USER']

  const run = React.useCallback(async (q: string, activeTypes: string[]) => {
    /* Aborting is mandatory here: a stale answer landing after a newer one
       silently shows results for a query the user already replaced. */
    abort.current?.abort()
    if (!q) { setHits([]); setCursor(''); setDegraded(false); setError(null); return }
    const ctl = new AbortController()
    abort.current = ctl
    setLoading(true)
    setError(null)
    try {
      const res: any = await api.search.stream(q, { types: activeTypes, size: 20, signal: ctl.signal } as any)
      setHits(res.results || [])
      setCursor(res.nextCursor || '')
      setDegraded(!!res.degraded)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void run(debounced, types) }, [debounced, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!cursor || more || loading) return
    setMore(true)
    try {
      const res: any = await api.search.stream(debounced, { types, cursor, size: 20 } as any)
      setHits(prev => [...prev, ...(res.results || [])])
      setCursor(res.nextCursor || '')
    } catch { /* the footer simply stops; the list already has rows */ }
    finally { setMore(false) }
  }

  const open = (hit: SearchHitRow) => {
    const href = hitPath(hit as any)
    if (!href) return
    push(debounced)
    router.push(to(href))
  }

  /* Item-first and identity-stable, so `renderItem` holds one identity for
     the life of the screen instead of re-rendering every mounted cell. */
  const openHit = useEvent((hit: SearchHitRow) => open(hit))
  const openHitMenu = useEvent((hit: SearchHitRow) => menu.open(hit))
  const renderItem = React.useCallback(({ item }: { item: SearchHitRow }) => (
    <Touchable
      onPress={() => openHit(item)}
      onLongPress={() => openHitMenu(item)}
      feedback="tint"
      noAutoHitSlop
      style={styles.hit}
    >
      {item.contentType === 'USER' ? (
        <Avatar name={item.authorName} seed={item.contentId} size={40} />
      ) : (
        <View style={[styles.tile, { backgroundColor: c.scholarSoft }]}>
          <Text variant="headline" serif color={c.scholarText}>R</Text>
        </View>
      )}
      <View style={styles.flex}>
        <Text variant="subhead" align="auto" numberOfLines={2}>{item.titlePreview || 'Untitled'}</Text>
        <Text variant="caption" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xxs }}>
          {[item.authorUsername ? `@${item.authorUsername}` : '', item.authorName].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Touchable>
  ), [c, openHit, openHitMenu])

  const body = () => {
    if (error) return <ErrorPanel error={error} onRetry={() => void run(debounced, types)} />
    if (loading && !hits.length) return <HitSkeleton />
    if (!debounced) {
      if (!recent.length) {
        return (
          <EmptyState
            icon="search"
            title="Search the institute's published research"
            message="Titles, abstracts, keywords and authors."
          />
        )
      }
      return (
        <View>
          <View style={styles.recentHead}>
            <Text variant="subhead" tone="secondary" align="ui" style={styles.flex}>Recent</Text>
            <Touchable onPress={clear} feedback="dim"><Text variant="subhead" tone="accent">Clear all</Text></Touchable>
          </View>
          {recent.map(q => (
            <Touchable key={q} onPress={() => setQuery(q)} feedback="tint" noAutoHitSlop style={styles.recentRow}>
              <Icon name="clock" size={16} color={c.textFaint} />
              <Text variant="body" align="auto" numberOfLines={1} style={styles.flex}>{q}</Text>
              <Touchable onPress={() => remove(q)} feedback="dim" accessibilityLabel={`Remove ${q}`}>
                <Icon name="close" size={15} color={c.textFaint} />
              </Touchable>
            </Touchable>
          ))}
        </View>
      )
    }
    if (degraded) return null
    return (
      <EmptyState
        icon="search"
        title={`No papers match “${debounced}”.`}
        actionLabel="Browse trending tags"
        onAction={() => router.push(to('/research/tags'))}
      />
    )
  }

  return (
    /* The field autofocuses, so the header is the first thing the eye lands
       on — it takes the top inset from the Screen rather than a fixed 52 that
       pushed it into the island on tall devices. */
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Touchable onPress={() => router.back()} feedback="scale" accessibilityLabel="Back" style={styles.back}>
          <Icon name={t.isRTL ? 'forward' : 'back'} size={24} color={c.text} />
        </Touchable>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search papers, authors, keywords"
          autoFocus
          style={styles.flex}
        />
      </View>

      <View style={styles.scopeRow}>
        <Chip label="Papers" selected={scope === 'papers'} onPress={() => setScope('papers')} />
        <Chip label="Papers + authors" selected={scope === 'papersAuthors'} onPress={() => setScope('papersAuthors')} />
      </View>

      {degraded ? (
        <Callout tone="warning" icon="warning" style={styles.degraded}>
          Search is temporarily unavailable — try again shortly.
        </Callout>
      ) : null}

      <FlashList
        data={hits}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListEmptyComponent={body()}
        ListFooterComponent={more ? <HitSkeleton rows={2} /> : <View style={{ height: 24 }} />}
        onEndReached={() => { void loadMore() }}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.titlePreview}
        actions={[
          {
            label: 'Copy link',
            icon: 'link',
            onPress: async () => {
              const hit = menu.payload
              if (!hit) return
              /* RESEARCH hits get the paste-able ShareLinkInfo.shortUrl (the
                 app-relative href is not a URL anyone can open); USER hits
                 keep the app path. recordShare bumps the counter only when a
                 real link was actually copied (ResearchCard precedent). */
              const short = hit.contentType === 'RESEARCH'
                ? await api.research.shareLink(hit.contentId).then((r: any) => r?.shortUrl || null).catch(() => null)
                : null
              const href = short || hitHref(hit)
              if (!href) return
              await Clipboard.setStringAsync(href)
              toast.ok('Link copied')
              if (short) void Promise.resolve(api.research.recordShare(hit.contentId)).catch(() => { /* best-effort counter */ })
            },
          },
          {
            label: 'Share',
            icon: 'share',
            onPress: async () => {
              const hit = menu.payload
              if (!hit) return
              const short = hit.contentType === 'RESEARCH'
                ? await api.research.shareLink(hit.contentId).then((r: any) => r?.shortUrl || null).catch(() => null)
                : null
              const res = await Share.share({ message: [hit.titlePreview, short].filter(Boolean).join('\n') })
              if (short && res.action === Share.sharedAction) {
                void Promise.resolve(api.research.recordShare(hit.contentId)).catch(() => { /* a missed count must never interrupt a share */ })
              }
            },
          },
        ]}
      />
    </Screen>
  )
}

function HitSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.hit}>
          <Skeleton width={40} height={40} radius={11} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="78%" height={12} />
            <Skeleton width="42%" height={10} />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingTop: space.xs2, paddingHorizontal: space.sm2, paddingBottom: space.sm },
  back: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  scopeRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  degraded: { marginHorizontal: space.lg, marginBottom: space.sm2 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  recentHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 44 },
  flex: { flex: 1 },
})
