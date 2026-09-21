/* =========================================================
   ScopeTagRail — a horizontal shelf of per-scope trending
   tags (the RESEARCH / QUESTION leaderboards Explore's
   editorial sections are built on).

   Same survival contract as TrendingTagRail: every /tags/*
   read can answer 503 DATASTORE_UNAVAILABLE, so a dead rail
   renders nothing rather than an error block in the middle of
   an otherwise healthy Browse page. The parent owns the fetch
   (it wires the rows into pull-to-refresh); this only renders.
   ========================================================= */
import React from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback } from '@/theme/tokens'
import { Icon, NumericText, Skeleton, Text, Touchable, formatCount, toast } from '@/ui'
import { href } from './pushHit'
import { TYPE_ICON, typeSkin } from './searchTypes'
import type { TrendingTag } from './searchTypes'

const keyExtractor = (item: TrendingTag) => item.tag

export interface ScopeTagRailProps {
  /** The leaderboard this shelf renders — also picks the card's type skin. */
  scope: 'RESEARCH' | 'QUESTION'
  rows?: TrendingTag[] | null
  loading?: boolean
}

const CARD_WIDTH = 168

export function ScopeTagRail({ scope, rows, loading }: ScopeTagRailProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const skin = typeSkin(c, scope)

  const go = useEvent((tag: string) => router.push(href(`/tags/${encodeURIComponent(tag)}`)))
  const copy = useEvent(async (tag: string) => {
    await Clipboard.setStringAsync(`#${tag}`)
    toast.ok('Tag copied')
  })

  const renderItem = React.useCallback(({ item }: { item: TrendingTag }) => (
    <ScopeCard tag={item} icon={TYPE_ICON[scope]} skinBg={skin.bg} skinFg={skin.fg} onPress={go} onCopy={copy} />
  ), [scope, skin.bg, skin.fg, go, copy])

  if (loading && !rows?.length) {
    return (
      <View style={[styles.rail, { gap: t.space.sm, paddingHorizontal: t.layout.screenPadding }]}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} width={CARD_WIDTH} height={84} />
        ))}
      </View>
    )
  }
  if (!rows?.length) return null

  return (
    <FlatList
      horizontal
      data={rows}
      showsHorizontalScrollIndicator={false}
      keyExtractor={keyExtractor}
      contentContainerStyle={{ gap: t.space.sm, paddingHorizontal: t.layout.screenPadding }}
      /* Pre-ranked by the server — render in array order, never re-sort. */
      renderItem={renderItem}
    />
  )
}

/* One shelf card. Setback 14/4 (the stele crown), not a uniform radius. */
const ScopeCard = React.memo(function ScopeCard({
  tag, icon, skinBg, skinFg, onPress, onCopy,
}: {
  tag: TrendingTag
  icon: any
  skinBg: string
  skinFg: string
  onPress: (tag: string) => void
  onCopy: (tag: string) => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(tag.tag), [onPress, tag.tag])
  const longPress = React.useCallback(() => { void onCopy(tag.tag) }, [onCopy, tag.tag])

  return (
    <Touchable
      onPress={press}
      onLongPress={longPress}
      feedback="scale"
      haptic="select"
      accessibilityLabel={`Tag ${tag.tag}, ${formatCount(tag.usageCount)} items`}
      accessibilityHint="Double tap to open. Long press to copy."
      style={[
        styles.card,
        {
          ...setback(t.shape.card),
          backgroundColor: c.surfaceSunken,
          borderColor: c.borderFaint,
          padding: t.space.md,
        },
      ]}
    >
      <View style={[styles.disc, { backgroundColor: skinBg }]}>
        <Icon name={icon} size={14} color={skinFg} filled />
      </View>
      <Text variant="headline" numberOfLines={1}>#{tag.tag}</Text>
      <NumericText variant="caption" tone="muted" align="ui">
        {formatCount(tag.usageCount)} items
      </NumericText>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', alignItems: 'center' },
  card: {
    width: CARD_WIDTH,
    minHeight: 84,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    justifyContent: 'space-between',
  },
  disc: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
})
