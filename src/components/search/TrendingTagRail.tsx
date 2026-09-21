/* =========================================================
   TrendingTagRail — the horizontal chip rail.

   Two contracts it has to honour:

   1. The leaderboard is a TEN-MINUTE SNAPSHOT (top 100 per
      scope) over exact counters, so it is refreshed on focus
      only when the cached copy is older than five minutes.
      Polling it faster changes nothing but battery.
   2. A dead rail must not take Explore down with it. Every
      /tags/* read can answer 503 DATASTORE_UNAVAILABLE, which
      is transient by contract — so this swallows the failure
      and renders nothing rather than an error block above a
      perfectly healthy discovery grid.
   ========================================================= */
import React from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { NumericText, Skeleton, Text, Touchable, formatCount, toast } from '@/ui'
import { href } from './pushHit'
import type { TagScope, TrendingTag } from './searchTypes'

const keyExtractor = (item: TrendingTag) => item.tag

/** The server rebuilds the snapshot every 10 minutes; half that is the point
 *  where a refetch can plausibly return something new. */
export const TRENDING_STALE_MS = 5 * 60 * 1000

export interface TrendingTagRailProps {
  scope?: TagScope
  limit?: number
  rows?: TrendingTag[] | null
  loading?: boolean
  onPressTag?: (tag: string) => void
}

export function TrendingTagRail({
  scope = 'ALL', limit = 20, rows, loading, onPressTag,
}: TrendingTagRailProps) {
  const t = useTheme()
  const router = useRouter()
  const [own, setOwn] = React.useState<TrendingTag[] | null>(null)
  const [ownLoading, setOwnLoading] = React.useState(rows === undefined)

  /* Self-fetch only when the parent has not already loaded the rail — Explore
     needs the same array for its discovery grid, so it owns the call there. */
  const selfFetch = rows === undefined
  React.useEffect(() => {
    if (!selfFetch) return
    let live = true
    void (async () => {
      try {
        const res = await api.tags.trending({ scope, limit }) as TrendingTag[]
        if (live) setOwn(res)
      } catch {
        if (live) setOwn([])
      } finally {
        if (live) setOwnLoading(false)
      }
    })()
    return () => { live = false }
  }, [selfFetch, scope, limit])

  const list = selfFetch ? own : rows
  const busy = selfFetch ? ownLoading : !!loading

  /* Item-first and stable, so the rail's renderItem does not mint a closure
     per chip on every parent render. */
  const go = useEvent((tag: string) => (
    onPressTag ? onPressTag(tag) : router.push(href(`/tags/${encodeURIComponent(tag)}`))
  ))
  const copy = useEvent(async (tag: string) => {
    await Clipboard.setStringAsync(`#${tag}`)
    toast.ok('Tag copied')
  })

  const renderItem = React.useCallback(({ item, index }: { item: TrendingTag; index: number }) => (
    <TagChip tag={item} index={index} onPress={go} onCopy={copy} />
  ), [go, copy])

  if (busy) {
    return (
      <View style={[styles.rail, { paddingHorizontal: t.layout.screenPadding }]}>
        {Array.from({ length: 8 }, (_, i) => (
          /* No radius override — Skeleton's default is the setback, and the
             chip it stands in for is not a pill either. */
          <Skeleton key={i} width={78 + (i % 3) * 14} height={32} />
        ))}
      </View>
    )
  }
  if (!list || !list.length) return null

  return (
    <FlatList
      horizontal
      data={list}
      showsHorizontalScrollIndicator={false}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.railContent}
      /* Pre-ranked by the server — render in array order, never re-sort. */
      renderItem={renderItem}
    />
  )
}

/* One chip. Setback 8/3, never a pill: the only pills in the app are unread
   counters and LIVE badges (DESIGN.md §8.9). */
const TagChip = React.memo(function TagChip({
  tag, index, onPress, onCopy,
}: {
  tag: TrendingTag
  index: number
  onPress: (tag: string) => void
  onCopy: (tag: string) => void
}) {
  const t = useTheme()
  const hot = index < 3
  const press = React.useCallback(() => onPress(tag.tag), [onPress, tag.tag])
  const longPress = React.useCallback(() => { void onCopy(tag.tag) }, [onCopy, tag.tag])

  return (
    /* Cascade caps at 8 steps so the tail of a 20-chip rail does not
       straggle in half a second after the head. */
    <Animated.View
      entering={t.prefs.reducedMotion
        ? undefined
        : FadeIn.duration(t.ms(220)).delay(Math.min(index, 8) * 30)}
    >
      <Touchable
        onPress={press}
        onLongPress={longPress}
        feedback="scale"
        haptic="select"
        accessibilityLabel={`Trending tag ${tag.tag}, ${formatCount(tag.usageCount)} items, rank ${index + 1}`}
        accessibilityHint="Double tap to open. Long press to copy."
        style={[
          styles.chip,
          {
            backgroundColor: hot ? t.colors.accent : t.colors.surfaceSunken,
            borderColor: hot ? 'transparent' : t.colors.borderFaint,
            borderWidth: hot ? 0 : StyleSheet.hairlineWidth,
            ...setback(t.shape.chip),
          },
        ]}
      >
        <Text
          variant="footnote"
          weight="700"
          numberOfLines={1}
          color={hot ? t.colors.textOnAccent : t.colors.text}
        >
          #{tag.tag}
        </Text>
        <NumericText
          variant="caption"
          color={hot ? t.colors.textOnAccent : t.colors.textMuted}
          style={hot ? HOT_COUNT : undefined}
        >
          {formatCount(tag.usageCount)}
        </NumericText>
      </Touchable>
    </Animated.View>
  )
})

const HOT_COUNT = { opacity: 0.75 } as const

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  railContent: { gap: space.sm, paddingHorizontal: space.md, alignItems: 'center' },
  chip: {
    height: 32, flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    paddingHorizontal: space.md, borderCurve: 'continuous',
  },
})
