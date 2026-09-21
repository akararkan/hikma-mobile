/* =========================================================
   Trending tags — the leaderboard, and the catalogue behind it.

   The two data sources on this screen are NOT the same thing
   and the difference is the whole reason both are here:

     trending  a 10-minute snapshot of the top 100 per scope,
               ranked by usage. Pre-sorted; render in order.
     search    a live Cassandra clustering-prefix scan over the
               WHOLE catalogue, ordered by tag NAME ascending.

   So a tag created two minutes ago is findable by typing it and
   invisible in the leaderboard, and the caption above the list
   says so rather than letting the author conclude the app ate
   their post.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api } from '@/api'
import { normalizeTag } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Divider, EmptyState, ErrorState, Header, Icon, NumericText, Screen,
  SearchField, SegmentedControl, Skeleton, Text, Touchable, TouchableRow,
  fireHaptic, formatCount, toast, useSheetState,
} from '@/ui'
import {
  href, searchTags, useTransientRetry,
  type TagScope, type TagSuggestion, type TrendingTag,
} from '@/components/search'

const SCOPES: { value: TagScope; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'QUESTION', label: 'Questions' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'POST', label: 'Posts' },
  { value: 'REEL', label: 'Reels' },
]

/* Both lists key on the tag itself — it IS the primary key of the partition. */
const keyExtractor = (item: { tag: string }) => item.tag

/* Module scope, both of them: an inline separator is a NEW component type on
   every parent render, so FlashList unmounts and remounts every hairline it
   has on screen — on the autocomplete that is once per keystroke. */
const TrendSep = () => <Divider inset={60} />
const SearchSep = () => {
  const t = useTheme()
  return <Divider inset={t.layout.screenPadding} />
}

/* Scalars, not the row object: the leaderboard rebuilds its array on every
   refresh, and a memo fed objects would never hold. */
const TrendingTagRow = React.memo(function TrendingTagRow({
  tag, rank, usageCount, onOpen, onLongPress,
}: {
  tag: string
  rank: number
  usageCount: number
  onOpen: (tag: string) => void
  onLongPress: (tag: string) => void
}) {
  const t = useTheme()
  const c = t.colors
  return (
    <TouchableRow onPress={() => onOpen(tag)} onLongPress={() => onLongPress(tag)}>
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 60, gap: space.md2 }]}>
        {rank < 3 ? (
          <View style={[styles.rankDisc, { backgroundColor: c.accent }]}>
            <NumericText variant="footnote" color={c.textOnAccent} align="center">{rank + 1}</NumericText>
          </View>
        ) : (
          <NumericText variant="subhead" tone="faint" align="center" style={styles.rankPlain}>
            {rank + 1}
          </NumericText>
        )}
        <View style={styles.flex}>
          {/* Arabic and Kurdish tags are first-class: alignment follows
              the tag's own script, not the interface direction. */}
          <Text variant="title3" numberOfLines={1}>#{tag}</Text>
          <NumericText variant="caption" tone="faint" align="ui">
            {formatCount(usageCount)} items
          </NumericText>
        </View>
        <Icon name={t.isRTL ? 'back' : 'forward'} size={16} color={c.textFaint} />
      </View>
    </TouchableRow>
  )
})

const TagSuggestionRow = React.memo(function TagSuggestionRow({
  tag, usageCount, onOpen,
}: {
  tag: string
  usageCount: number
  onOpen: (tag: string) => void
}) {
  const t = useTheme()
  return (
    <TouchableRow onPress={() => onOpen(tag)}>
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 52, gap: space.md }]}>
        <Text variant="callout" numberOfLines={1} style={styles.flex}>#{tag}</Text>
        <NumericText variant="subhead" tone="faint">{formatCount(usageCount)}</NumericText>
      </View>
    </TouchableRow>
  )
})

export default function TagsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const params = useLocalSearchParams<{ scope?: string }>()

  /* Explore's per-scope shelves deep-link here with `?scope=` — seed only, so
     the segmented control stays the owner of the state afterwards. */
  const [scope, setScope] = React.useState<TagScope>(() => {
    const seed = String(params.scope ?? '')
    return SCOPES.some(s => s.value === seed) ? seed as TagScope : 'ALL'
  })
  const [prefix, setPrefix] = React.useState('')
  const [sort, setSort] = React.useState<'az' | 'popular'>('az')
  const menu = useSheetState<string>()
  const listRef = React.useRef<any>(null)

  const trending = useAsync<TrendingTag[]>(
    () => api.tags.trending({ scope, limit: 100 }) as Promise<TrendingTag[]>,
    { deps: [scope] },
  )
  useTransientRetry(trending.error, trending.reload)

  /* ---- catalogue autocomplete: no AbortSignal, so a sequence number is the
     only thing standing between a fast typer and a stale list. ---- */
  const norm = normalizeTag(prefix)
  const [matches, setMatches] = React.useState<TagSuggestion[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<any>(null)
  const [retryNonce, setRetryNonce] = React.useState(0)
  const seq = React.useRef(0)

  React.useEffect(() => {
    if (!norm) { seq.current++; setMatches([]); setSearching(false); setSearchError(null); return }
    setSearching(true)
    const id = setTimeout(async () => {
      const mine = ++seq.current
      try {
        const rows = await searchTags({ prefix: norm, scope, limit: 50 })
        if (mine !== seq.current) return
        setMatches(rows)
        setSearchError(null)
      } catch (e: any) {
        if (mine !== seq.current) return
        setMatches([])
        setSearchError(e)
      } finally {
        if (mine === seq.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(id)
  }, [norm, scope, retryNonce])

  /* Identity-stable: both lists hand these to every row, and a fresh arrow here
     would re-render the mounted window on every keystroke and sort toggle. */
  const open = useEvent((tag: string) => router.push(href(`/tags/${encodeURIComponent(tag)}`)))
  const longPress = useEvent((tag: string) => { fireHaptic('medium'); menu.open(tag) })

  const renderTrending = React.useCallback(({ item }: { item: TrendingTag }) => (
    /* `rank` is 0-based and the array arrives pre-sorted — never re-sort. */
    <TrendingTagRow
      tag={item.tag}
      rank={item.rank}
      usageCount={item.usageCount}
      onOpen={open}
      onLongPress={longPress}
    />
  ), [open, longPress])

  const sorted = React.useMemo(() => (
    sort === 'popular' ? [...matches].sort((a, b) => b.usageCount - a.usageCount) : matches
  ), [matches, sort])

  const searchMode = !!norm

  return (
    <Screen>
      <Header
        back
        title="Tags"
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2, gap: space.sm2 }}>
            <SearchField value={prefix} onChangeText={setPrefix} placeholder="Find a tag" />
            <SegmentedControl
              options={SCOPES}
              value={scope}
              onChange={v => {
                setScope(v)
                listRef.current?.scrollToOffset?.({ offset: 0, animated: false })
              }}
              scrollable
            />
          </View>
        }
      />

      {searchMode ? (
        <SearchBody
          norm={norm}
          rows={sorted}
          loading={searching}
          error={searchError}
          sort={sort}
          onSort={setSort}
          onOpen={open}
          onRetry={() => setRetryNonce(n => n + 1)}
        />
      ) : trending.loading ? (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 10 }, (_, i) => (
            <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 60, gap: space.md2 }]}>
              <Skeleton circle width={28} height={28} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="44%" height={13} />
                <Skeleton width="24%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : trending.error ? (
        <ErrorState
          error={trending.error}
          onRetry={trending.reload}
          title="Tags are temporarily unavailable"
        />
      ) : (
        <FlashList
          ref={listRef}
          data={trending.data ?? []}
          keyExtractor={keyExtractor}
          refreshControl={
            <RefreshControl
              refreshing={trending.refreshing}
              onRefresh={trending.refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          ListHeaderComponent={
            <Text variant="footnote" tone="faint" align="ui" style={styles.caption}>
              Updated every 10 minutes. A brand-new tag can take a cycle to appear — its feed is live immediately.
            </Text>
          }
          ItemSeparatorComponent={TrendSep}
          ListEmptyComponent={
            <EmptyState icon="hash" title="No trending tags in this scope yet" message="Counters are live; the leaderboard fills on the next cycle." />
          }
          renderItem={renderTrending}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: `Copy #${menu.payload ?? ''}`,
            icon: 'copy',
            onPress: async () => {
              await Clipboard.setStringAsync(`#${menu.payload}`)
              toast.ok('Tag copied')
            },
          },
        ]}
      />
    </Screen>
  )
}

function SearchBody({
  norm, rows, loading, error, sort, onSort, onOpen, onRetry,
}: {
  norm: string
  rows: TagSuggestion[]
  loading: boolean
  error: any
  sort: 'az' | 'popular'
  onSort: (v: 'az' | 'popular') => void
  onOpen: (tag: string) => void
  onRetry: () => void
}) {
  const t = useTheme()

  const renderItem = React.useCallback(({ item }: { item: TagSuggestion }) => (
    <TagSuggestionRow tag={item.tag} usageCount={item.usageCount} onOpen={onOpen} />
  ), [onOpen])

  return (
    <FlashList
      data={rows}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View>
          {/* Always reachable, even at zero usage: the catalogue scan only
              knows tags that exist, and a brand-new one is still a valid feed. */}
          <TouchableRow onPress={() => onOpen(norm)}>
            <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, height: 52, gap: space.md }]}>
              <Icon name="hash" size={19} color={t.colors.accent} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>Go to #{norm}</Text>
              <Icon name={t.isRTL ? 'back' : 'forward'} size={16} color={t.colors.textFaint} />
            </View>
          </TouchableRow>
          <View style={[styles.sortRow, { paddingHorizontal: t.layout.screenPadding }]}>
            <Touchable
              onPress={() => onSort(sort === 'az' ? 'popular' : 'az')}
              feedback="dim"
              haptic="select"
              style={[styles.sortPill, { borderColor: t.colors.border }]}
            >
              <Icon name="sort" size={14} color={t.colors.textSecondary} />
              <Text variant="footnote" tone="secondary">Sort: {sort === 'az' ? 'A–Z' : 'Popular'}</Text>
            </Touchable>
          </View>
          {error ? <ErrorState error={error} onRetry={onRetry} compact /> : null}
        </View>
      }
      ItemSeparatorComponent={SearchSep}
      ListEmptyComponent={
        loading || error ? null : (
          <Text variant="callout" tone="muted" align="center" style={{ paddingVertical: 28 }}>
            No existing tag starts with “{norm}”.
          </Text>
        )
      }
      renderItem={renderItem}
    />
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  caption: { paddingHorizontal: space.lg, paddingVertical: space.md },
  rankDisc: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankPlain: { width: 28 },
  sortRow: { paddingVertical: space.sm2, flexDirection: 'row' },
  /* An outlined, text-bearing control — chip setback, never a capsule. */
  sortPill: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 32,
    paddingHorizontal: space.md, borderWidth: StyleSheet.hairlineWidth,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
})
