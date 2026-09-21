/* =========================================================
   Search Q&A.

   Two contracts from the search module drive this file.

   1. CURSOR MODE IS ENTERED WITH A CURSOR. `api.search.stream`
      passes the head sentinel on the first page precisely so
      `nextCursor` advances; `api.search.page` never returns one
      and a "load more" built on it re-appends page 0 forever.
   2. `degraded === true` is NOT the empty state. It means
      Elasticsearch failed, so the list is empty for a reason
      that has nothing to do with the query — telling the user
      "no results" there is a lie they would act on.

   Every keystroke aborts the previous request. An AbortError
   from a superseded call is swallowed: errors.isNetworkError
   deliberately excludes it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDebounced } from '@/hooks/useAsync'
import { storage } from '@/platform/storage'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Chip, ChipRail, Icon, ListFooter, Screen, SearchField, Text, Touchable, fireHaptic,
} from '@/ui'
import { searchApi, tagsApi } from '@/components/qna/api'
import { IndeterminateBar, QnaEmptyState, QnaErrorView, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import type { SearchHitView, TrendingTag } from '@/components/qna/types'

const RECENTS_KEY = 'ika_qna_recent_searches'
const MAX_RECENTS = 8

type Filter = 'QUESTION' | 'ANSWER'

const keyExtractor = (h: SearchHitView) => `${h.contentType}:${h.contentId}`
const getItemType = (h: SearchHitView) => h.contentType

export default function QnaSearchScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [query, setQuery] = React.useState('')
  const [types, setTypes] = React.useState<Filter[]>(['QUESTION', 'ANSWER'])
  const [results, setResults] = React.useState<SearchHitView[]>([])
  const [cursor, setCursor] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [degraded, setDegraded] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [searched, setSearched] = React.useState(false)
  const [recents, setRecents] = React.useState<string[]>(() => readRecents())
  const [trending, setTrending] = React.useState<TrendingTag[]>([])

  const debounced = useDebounced(query.trim(), 300)
  const abort = React.useRef<AbortController | null>(null)
  const seq = React.useRef(0)

  React.useEffect(() => {
    tagsApi.trending({ scope: 'QUESTION', limit: 20 })
      .then(rows => setTrending(rows || []))
      .catch(() => {})
  }, [])

  const run = React.useCallback(async (q: string, selected: Filter[], more: boolean) => {
    if (!q) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const mine = ++seq.current

    if (more) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await searchApi.stream(q, {
        types: selected,
        cursor: more ? cursor : undefined,
        size: 20,
        signal: ctl.signal,
      })
      if (mine !== seq.current) return
      setDegraded(res.degraded)
      setCursor(res.nextCursor || '')
      setResults(prev => (more ? [...prev, ...res.results] : res.results))
      setSearched(true)
    } catch (e: any) {
      if (e?.name === 'AbortError' || mine !== seq.current) return
      setError(e)
    } finally {
      if (mine === seq.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [cursor])

  React.useEffect(() => {
    if (!debounced) {
      abort.current?.abort()
      setResults([]); setCursor(''); setSearched(false); setDegraded(false); setError(null)
      return
    }
    void run(debounced, types, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, types])

  React.useEffect(() => () => abort.current?.abort(), [])

  const toggleType = (v: Filter) => {
    /* At least one filter must stay on; turning the last one off is a no-op
       with a haptic so the tap is acknowledged rather than ignored. */
    if (types.length === 1 && types[0] === v) { fireHaptic('light'); return }
    setTypes(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]))
  }

  const remember = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const next = [trimmed, ...recents.filter(r => r !== trimmed)].slice(0, MAX_RECENTS)
    setRecents(next)
    writeRecents(next)
  }

  const open = (hit: SearchHitView) => {
    remember(query)
    if (hit.contentType === 'ANSWER') {
      /* An answer has no page of its own; parentId is always present on an
         answer hit and is the only way to open it. */
      if (!hit.parentId) return
      router.push(qnaHref.question(hit.parentId, { answer: hit.contentId }))
      return
    }
    router.push(qnaHref.question(hit.contentId))
  }

  /* Identity-stable, so `renderItem` never changes identity and FlashList's
     ViewHolder memo holds across every keystroke in the field. `getItemType`
     splits the recycle pool: a QUESTION hit and an ANSWER hit differ in their
     badge tint and their dead state. */
  const openHit = useEvent((hit: SearchHitView) => open(hit))
  const renderItem = React.useCallback(
    ({ item }: { item: SearchHitView }) => <HitRow hit={item} onPress={openHit} />,
    [openHit],
  )

  const idle = !query.trim()

  return (
    <Screen edges={['top']}>
      <View style={[styles.searchBar, { borderBottomColor: c.separator }]}>
        <Touchable
          onPress={() => (router.canGoBack() ? router.back() : router.replace(qnaHref.home()))}
          feedback="scale"
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <Icon name={t.isRTL ? 'forward' : 'back'} size={24} color={c.text} />
        </Touchable>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSubmit={() => { remember(query); void run(query.trim(), types, false) }}
          placeholder="Search questions and answers"
          autoFocus
          style={styles.flex}
        />
      </View>

      <View style={[styles.filterRow, { borderBottomColor: c.separator }]}>
        <Chip
          label="Questions"
          icon="qna"
          selected={types.includes('QUESTION')}
          tone="neutral"
          size="sm"
          onPress={() => toggleType('QUESTION')}
        />
        <Chip
          label="Answers"
          icon="comment"
          selected={types.includes('ANSWER')}
          tone="neutral"
          size="sm"
          onPress={() => toggleType('ANSWER')}
        />
      </View>

      <IndeterminateBar active={loading && results.length > 0} height={2} />

      {idle ? (
        <IdleState
          recents={recents}
          trending={trending}
          onPick={q => { setQuery(q) }}
          onDrop={q => { const next = recents.filter(r => r !== q); setRecents(next); writeRecents(next) }}
          onTag={tag => router.push(qnaHref.tag(tag))}
        />
      ) : loading && !results.length ? (
        <QnaSkeletons kind="searchRow" count={6} />
      ) : error ? (
        <QnaErrorView error={error} onRetry={() => void run(debounced, types, false)} />
      ) : degraded ? (
        <QnaEmptyState
          glyph="offline"
          title="Search is temporarily unavailable"
          body="Try again in a moment."
          actionLabel="Retry"
          onAction={() => void run(debounced, types, false)}
        />
      ) : searched && !results.length ? (
        <QnaEmptyState
          glyph="search"
          title={`No results for “${debounced}”`}
          body="Try a different word, or search everything."
          actionLabel="Search everything"
          onAction={() => router.push(qnaHref.globalSearch())}
        />
      ) : (
        <FlashList
          data={results}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={() => { if (cursor && !loadingMore && !loading) void run(debounced, types, true) }}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          style={{ opacity: loading ? 0.5 : 1 }}
          ListHeaderComponent={
            <View style={[styles.resultHeader, { borderBottomColor: c.separator }]}>
              <Text variant="subhead" weight="700" align="ui">
                {results.length}{cursor ? '+' : ''} {results.length === 1 ? 'result' : 'results'}
              </Text>
            </View>
          }
          ListFooterComponent={<ListFooter loading={loadingMore} done={!cursor} doneLabel="That is everything" />}
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}

/* Item-first, and memoized: one handler serves the whole list, so the
   screen's renderItem keeps a single identity — which is what FlashList's
   ViewHolder memo compares — and this row skips renders the search state did
   not touch. */
const HitRow = React.memo(function HitRow({ hit, onPress }: { hit: SearchHitView; onPress: (hit: SearchHitView) => void }) {
  const t = useTheme()
  const c = t.colors
  const isAnswer = hit.contentType === 'ANSWER'
  /* An answer hit with no parentId cannot be opened at all — grey it out
     instead of pretending it is a link. */
  const dead = isAnswer && !hit.parentId

  return (
    <Touchable
      onPress={() => onPress(hit)}
      disabled={dead}
      feedback="tint"
      noAutoHitSlop
      style={[styles.hitRow, { borderBottomColor: c.separator, opacity: dead ? 0.5 : 1 }]}
    >
      <View
        style={[
          styles.hitBadge,
          { backgroundColor: isAnswer ? c.successSoft : c.accentSoft },
        ]}
      >
        <Icon name={isAnswer ? 'comment' : 'qna'} size={16} color={isAnswer ? c.successText : c.accent} />
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={2} align="auto">{hit.titlePreview || 'Untitled'}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xs }}>
          {isAnswer ? 'Answer · ' : ''}@{hit.authorUsername || 'unknown'} · {hit.time}
        </Text>
      </View>
    </Touchable>
  )
})

function IdleState({
  recents, trending, onPick, onDrop, onTag,
}: {
  recents: string[]
  trending: TrendingTag[]
  onPick: (q: string) => void
  onDrop: (q: string) => void
  onTag: (tag: string) => void
}) {
  const t = useTheme()
  if (!recents.length && !trending.length) {
    return (
      <QnaEmptyState
        glyph="search"
        title="Search the Q&A library"
        body="Find a question by its wording, or an answer by what it cites."
      />
    )
  }
  return (
    <View style={{ paddingTop: space.sm }}>
      {recents.length ? (
        <>
          <Text variant="caption" tone="muted" align="ui" style={styles.idleLabel}>Recent searches</Text>
          {recents.map(q => (
            <View key={q} style={styles.recentRow}>
              <Touchable onPress={() => onPick(q)} feedback="dim" noAutoHitSlop style={styles.recentHit}>
                <Icon name="history" size={16} color={t.colors.textFaint} />
                <Text variant="body" numberOfLines={1} align="auto" style={styles.flex}>{q}</Text>
              </Touchable>
              <Touchable onPress={() => onDrop(q)} feedback="dim" accessibilityLabel={`Forget ${q}`}>
                <Icon name="close" size={15} color={t.colors.textFaint} />
              </Touchable>
            </View>
          ))}
        </>
      ) : null}

      {trending.length ? (
        <>
          <Text variant="caption" tone="muted" align="ui" style={styles.idleLabel}>Trending in Q&A</Text>
          <ChipRail>
            {trending.map(tag => (
              <Chip key={tag.tag} label={`#${tag.tag}`} tone="neutral" size="sm" onPress={() => onTag(tag.tag)} />
            ))}
          </ChipRail>
        </>
      ) : null}
    </View>
  )
}

/* Recents are a local convenience, not account state — there is no endpoint
   for them and syncing a search history would be a privacy decision nobody
   asked for. */
function readRecents(): string[] {
  try {
    const raw = storage.getItem(RECENTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === 'string').slice(0, MAX_RECENTS) : []
  } catch { return [] }
}

function writeRecents(list: string[]) {
  try { storage.setItem(RECENTS_KEY, JSON.stringify(list)) } catch { /* a full disk must not break search */ }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, height: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultHeader: { paddingHorizontal: space.lg, height: 36, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  hitRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 84,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hitBadge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  /* No textTransform: `caption`/`micro` uppercase LATIN ONLY inside the Text
     primitive, which is what leaves Arabic and Kurdish runs alone. A style-level
     transform would hit every script. */
  idleLabel: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 44 },
  recentHit: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, flex: 1 },
})
