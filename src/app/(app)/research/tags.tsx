/* =========================================================
   Tags & trending.

   The filter is OR semantics — `byTags` matches ANY of the
   selected tags — and the helper line says so, because a user
   who assumes AND will read an unexpectedly long list as a
   bug.

   Trending is best-effort: a 500 from the tag service collapses
   the section to one muted line and the filter keeps working.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api } from '@/api'
import { normalizeTags } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, EmptyState, Header, ListFooter, NumericText, Screen, ScreenScroll, Skeleton,
  Text, Touchable, formatCount,
} from '@/ui'
import { ResearchCard, ResearchCardListSkeleton, useResearchMenu } from '@/components/research/ResearchCard'
import { TagChipInput } from '@/components/research/TagChipInput'
import { ErrorPanel } from '@/components/research/states'
import { useResearchList } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { TrendingTag } from '@/components/research/types'

export default function ResearchTagsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [selected, setSelected] = React.useState<string[]>([])
  const trending = useAsync<TrendingTag[]>(() => api.tags.trending({ scope: 'RESEARCH', limit: 30 }))

  const results = useResearchList(
    ({ page, size }) => api.research.byTags(selected, { page, size }),
    { enabled: selected.length > 0, deps: [selected.join(',')] },
  )
  const menu = useResearchMenu({ onPatch: (id, patch) => results.patch(id, row => ({ ...row, ...patch })) })

  const toggle = (tag: string) => {
    setSelected(prev => (prev.includes(tag) ? prev.filter(v => v !== tag) : normalizeTags([...prev, tag])))
  }

  /* The wire's `rank` is ZERO-based (verified against the live endpoint) —
     rank 0 is the top tag. Displayed one-based below. */
  const rankTint = (rank: number) =>
    rank === 0 ? c.scholar : rank === 1 ? c.textMuted : rank === 2 ? c.warningText : c.textFaint

  return (
    <Screen background="plain">
      <Header back title="Tags" />

      <ScreenScroll contentContainerStyle={{ paddingBottom: 80 }}>
        <View style={styles.section}>
          <Text variant="title3" align="ui">Trending in research</Text>
          {trending.loading ? (
            <View style={styles.grid}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={64} radius={t.radius.md} style={styles.tile} />
              ))}
            </View>
          ) : trending.error ? (
            <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.md }}>Trending unavailable</Text>
          ) : (
            <View style={styles.grid}>
              {(trending.data || []).map(row => {
                const on = selected.includes(row.tag)
                return (
                  <Touchable
                    key={row.tag}
                    onPress={() => toggle(row.tag)}
                    onLongPress={() => router.push(to(`/research/tag/${encodeURIComponent(row.tag)}`))}
                    feedback="scale"
                    haptic="select"
                    style={[
                      styles.tile,
                      {
                        backgroundColor: on ? c.accentSoft : c.surfaceSunken,
                        borderRadius: t.radius.md,
                        borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
                        borderColor: on ? c.accent : c.borderFaint,
                      },
                    ]}
                  >
                    <Text variant="subhead" weight="600" align="auto" numberOfLines={1}>#{row.tag}</Text>
                    <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>
                      {formatCount(row.usageCount)} papers
                    </Text>
                    <NumericText variant="micro" color={rankTint(row.rank)} style={styles.rank}>
                      {row.rank + 1}
                    </NumericText>
                  </Touchable>
                )
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text variant="title3" align="ui" style={{ marginBottom: space.sm2 }}>Filter by tags</Text>
          <TagChipInput
            value={selected}
            onChange={setSelected}
            placeholder="Type a tag…"
          />
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
            Papers matching ANY of these tags.
          </Text>
        </View>

        {selected.length ? (
          <View style={styles.section}>
            <View style={styles.resultsHead}>
              <Text variant="title3" align="ui" style={styles.flex}>Results</Text>
              <Text variant="footnote" tone="muted">{results.items.length}{results.done ? '' : '+'}</Text>
            </View>

            {results.loading ? (
              <ResearchCardListSkeleton />
            ) : results.error ? (
              <ErrorPanel error={results.error} onRetry={results.reload} compact />
            ) : results.items.length ? (
              <View>
                {results.items.map(item => (
                  <ResearchCard key={item.id} item={item} onLongPress={menu.open} />
                ))}
                <ListFooter loading={results.loadingMore} done={results.done} />
              </View>
            ) : (
              <EmptyState
                icon="research"
                title="No published papers carry these tags."
                actionLabel="Clear tags"
                onAction={() => setSelected([])}
                compact
              />
            )}
          </View>
        ) : null}
      </ScreenScroll>

      {selected.length ? (
        <View style={[styles.stickyBar, { backgroundColor: c.surfaceRaised, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
          <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>
            {results.items.length} papers · any of these tags
          </Text>
          <Button label="Clear" variant="ghost" size="sm" onPress={() => setSelected([])} />
        </View>
      ) : null}

      {menu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: space.lg, paddingTop: space.lg2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm2, marginTop: space.md },
  tile: { width: '48%', height: 64, paddingHorizontal: space.md, justifyContent: 'center', gap: space.xxs },
  rank: { position: 'absolute', top: 8, end: 10 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: space.xs2 },
  stickyBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
})
