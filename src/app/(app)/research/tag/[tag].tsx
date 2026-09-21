/* =========================================================
   One tag.

   The route param is decoded and re-normalised before any
   call: a tag can be Arabic or Kurdish script and must reach
   the server byte-identical to how it was stored — the client
   normaliser mirrors the server's exactly and never
   transliterates.

   There is no follow-a-tag endpoint anywhere in the API, so
   there is no follow control here. A button that cannot work
   is worse than a missing one.
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
import { space } from '@/theme/tokens'
import {
  Chip, Divider, EmptyState, Header, Icon, ListFooter, Screen, SegmentedControl, Skeleton,
  Text, Touchable, formatCount, toast,
} from '@/ui'
import { ResearchCard, ResearchCardListSkeleton, useResearchMenu } from '@/components/research/ResearchCard'
import { ErrorPanel, useTransientRetry } from '@/components/research/states'
import { useResearchList } from '@/components/research/hooks'
import { contentHref, contentTypeTint } from '@/components/research/format'
import { to } from '@/components/research/nav'
import type { ResearchCardData } from '@/components/research/types'

interface TagRow {
  id: string
  type: string
  contentType: string
  contentId: string
  authorId: string
  titlePreview: string
  createdAt: string | null
  time: string
}

/* Module scope, all four: FlashList's ViewHolder memo compares renderItem and
   ItemSeparatorComponent BY IDENTITY, and an inline separator arrow is a new
   component TYPE each render — React remounts every visible divider instead
   of reconciling it. */
const paperKey = (item: ResearchCardData) => String(item.id)
const mixedKey = (row: TagRow, i: number) => `${row.contentType}:${row.contentId}:${i}`
const Sep = () => <Divider style={styles.sep} />

export default function TagScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const params = useLocalSearchParams<{ tag: string }>()
  const tag = normalizeTag(decodeURIComponent(String(params.tag || '')))

  const [segment, setSegment] = React.useState<'papers' | 'everything'>('papers')
  const [everything, setEverything] = React.useState<TagRow[]>([])
  const [cursor, setCursor] = React.useState('')
  const [everythingLoading, setEverythingLoading] = React.useState(false)
  const [everythingError, setEverythingError] = React.useState<any>(null)
  const [everythingLoaded, setEverythingLoaded] = React.useState(false)

  const usage = useAsync<{ tag: string; scopes: Record<string, number> }>(
    async () => (await api.tags.usage(tag, { scope: '*' })) as { tag: string; scopes: Record<string, number> },
    { enabled: !!tag, deps: [tag] },
  )

  const papers = useResearchList(
    ({ page, size }) => api.research.byTags([tag], { page, size }),
    { enabled: !!tag, deps: [tag] },
  )
  useTransientRetry(papers.error, papers.reload)
  const menu = useResearchMenu({ onPatch: (id, patch) => papers.patch(id, row => ({ ...row, ...patch })) })

  const loadEverything = React.useCallback(async (next?: string) => {
    if (everythingLoading) return
    setEverythingLoading(true)
    setEverythingError(null)
    try {
      /* The cursor is opaque — pass it straight back, never decode it. */
      const res: any = await api.tags.content(tag, { cursor: next, pageSize: 20 } as any)
      setEverything(prev => (next ? [...prev, ...(res.items || [])] : res.items || []))
      setCursor(res.nextCursor || '')
      setEverythingLoaded(true)
    } catch (e: any) {
      setEverythingError(e)
    } finally {
      setEverythingLoading(false)
    }
  }, [tag, everythingLoading])

  React.useEffect(() => {
    if (segment === 'everything' && !everythingLoaded) void loadEverything()
  }, [segment, everythingLoaded, loadEverything])

  const scopes = usage.data?.scopes
  const counts = usage.error || !scopes
    ? null
    : `${formatCount(scopes.RESEARCH ?? 0)} papers · ${formatCount(scopes.ALL ?? 0)} items across the platform`

  /* One item-first handler serves every card, so `renderItem` never changes
     identity. The mixed list's row closes over the theme and the router only,
     both stable for the life of the screen. */
  const openMenu = useEvent((item: ResearchCardData) => menu.open(item))
  const renderPaper = React.useCallback(
    ({ item }: { item: ResearchCardData }) => <ResearchCard item={item} onLongPress={openMenu} />,
    [openMenu],
  )
  const openHref = useEvent((contentType: string, contentId: string) => {
    const href = contentHref(contentType, contentId)
    if (href) router.push(to(href))
  })
  const renderMixed = React.useCallback(({ item }: { item: TagRow }) => {
    const tint = contentTypeTint(c, item.contentType)
    return (
      <Touchable
        onPress={() => openHref(item.contentType, item.contentId)}
        feedback="tint"
        noAutoHitSlop
        style={styles.mixedRow}
      >
        <Chip label={item.contentType} size="sm" style={{ backgroundColor: tint.bg }} />
        <View style={styles.flex}>
          <Text variant="callout" align="auto" numberOfLines={2}>{item.titlePreview || 'Untitled'}</Text>
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>{item.time}</Text>
        </View>
        <Icon name="forward" size={15} color={c.textFaint} />
      </Touchable>
    )
  }, [c, openHref])

  /* Both lists take the SAME header element; built once so switching segments
     — and every unrelated re-render — does not rebuild it. */
  const header = React.useMemo(() => (
    <View style={styles.head}>
      <Text variant="title1" serif align="auto" numberOfLines={2}>#{tag}</Text>
      {usage.loading ? (
        <Skeleton width={220} height={14} style={{ marginTop: space.sm }} />
      ) : counts ? (
        <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>{counts}</Text>
      ) : null}
      <SegmentedControl
        options={[{ value: 'papers', label: 'Papers' }, { value: 'everything', label: 'Everything' }]}
        value={segment}
        onChange={setSegment}
        style={{ marginTop: space.md2 }}
      />
    </View>
  ), [tag, usage.loading, counts, segment])

  return (
    <Screen>
      <Header
        back
        title={`#${tag}`}
        actions={[{
          icon: 'share',
          label: 'Copy tag link',
          onPress: async () => {
            await Clipboard.setStringAsync(`/research/tag/${encodeURIComponent(tag)}`)
            toast.ok('Tag link copied')
          },
        }]}
      />

      {segment === 'papers' ? (
        <FlashList
          data={papers.items}
          keyExtractor={paperKey}
          renderItem={renderPaper}
          ItemSeparatorComponent={Sep}
          ListHeaderComponent={header}
          ListEmptyComponent={
            papers.loading ? <ResearchCardListSkeleton />
              : papers.error ? <ErrorPanel error={papers.error} onRetry={papers.reload} />
                : <EmptyState icon="research" title={`No published papers carry #${tag} yet.`} />
          }
          ListFooterComponent={papers.items.length ? <ListFooter loading={papers.loadingMore} done={papers.done} /> : null}
          onEndReached={papers.loadMore}
          onEndReachedThreshold={0.6}
          /* Full research plates are 300pt+ — the default 250 prepares barely
             one cell ahead of the viewport. */
          drawDistance={500}
          refreshControl={
            <RefreshControl
              refreshing={papers.refreshing}
              onRefresh={() => { void papers.refresh(); void usage.refresh() }}
              tintColor={c.textMuted}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlashList
          data={everything}
          keyExtractor={mixedKey}
          renderItem={renderMixed}
          ItemSeparatorComponent={Sep}
          ListHeaderComponent={header}
          ListEmptyComponent={
            everythingLoading ? <ResearchCardListSkeleton count={2} />
              : everythingError ? <ErrorPanel error={everythingError} onRetry={() => void loadEverything()} />
                : <EmptyState icon="sparkle" title={`Nothing tagged #${tag} yet.`} />
          }
          ListFooterComponent={
            everything.length ? <ListFooter loading={everythingLoading} done={!cursor} /> : null
          }
          onEndReached={() => { if (cursor) void loadEverything(cursor) }}
          onEndReachedThreshold={0.6}
          showsVerticalScrollIndicator={false}
        />
      )}

      {menu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  mixedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 72 },
  sep: { marginHorizontal: space.lg },
  flex: { flex: 1 },
})
