/* =========================================================
   ResearchCard — a research paper in the mixed feed.

   No counters. Research rows come back with every engagement
   number zeroed at feed-read time by design, so printing
   "0 likes" here would be a lie the detail page immediately
   contradicts.

   `item.cover` is a CSS background shorthand
   (`center/cover no-repeat url("…")` or a radial-gradient),
   which is meaningless to a RN style — the URL is extracted,
   and a coverless paper gets a flat gilt-wash plate (QELAT
   has no decorative gradients).

   The card is a STELE (DESIGN.md §6) wearing the discipline
   SELVEDGE at the start edge — never the seal band,
   which is banned inside lists. Title set in the serif voice:
   research titles are Lora 700.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { disciplineSpine } from '@/theme/colors'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Selvedge, Text, Touchable, WeftDash } from '@/ui'
import { AuthorRow } from '@/components/post/AuthorRow'
import { coverUrlOf, type ResearchFeedView } from './types'
import { FEED_GUTTER } from './plate'

export interface ResearchCardProps {
  item: ResearchFeedView
  onPress?: (item: ResearchFeedView) => void
  onPressAuthor?: (userId: string) => void
}

/* Memoized: a feed row must survive unrelated list renders untouched — the
   caller's handlers have to be identity-stable for this to hold. */
export const ResearchCard = React.memo(function ResearchCard({ item, onPress, onPressAuthor }: ResearchCardProps) {
  const t = useTheme()
  const c = t.colors
  const cover = item.hasCover ? coverUrlOf(item.cover) : null
  /* Letterpress: the Touchable seats the plate 1pt; the border swap to
     borderStrong is the colour half of the effect and lives here. */
  const [pressed, setPressed] = React.useState(false)

  return (
    <Touchable
      onPress={() => onPress?.(item)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      feedback="scale"
      noAutoHitSlop
      style={[styles.card, { backgroundColor: c.surface, borderColor: pressed ? c.border : c.separator }]}
    >
      <Selvedge color={disciplineSpine(item.id)} />

      <View style={styles.coverWrap}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={[styles.cover, { borderRadius: t.radius.xs, backgroundColor: c.surfaceSunken }]}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={cover}
          />
        ) : (
          <View style={[styles.cover, { borderRadius: t.radius.xs, backgroundColor: c.scholarSoft }]}>
            <Icon name="research" size={26} color={c.scholar} />
          </View>
        )}

        <View style={[styles.kindChip, { backgroundColor: c.scholarSoft, borderColor: c.surface }]}>
          <Icon name="research" size={11} color={c.scholarText} />
          <Text variant="caption" color={c.scholarText}>Research</Text>
        </View>
      </View>

      <Text variant="headline" serif weight="700" numberOfLines={3} align="auto" style={styles.title}>{item.title}</Text>

      <WeftDash />

      <AuthorRow
        author={item._author}
        time={item.time}
        size={26}
        onPress={onPressAuthor ? () => onPressAuthor(item.author) : undefined}
        style={styles.author}
      />
    </Touchable>
  )
})

const styles = StyleSheet.create({
  /* The stele frame shared across the feed column: setback corners, one
     course border, no shadow — depth is letterpress + drawn rules. */
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  card: {
    paddingTop: space.md,
    paddingBottom: space.md2,
    paddingHorizontal: FEED_GUTTER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',   /* keeps the selvedge inside the plate */
  },
  coverWrap: { marginBottom: space.md2 },
  cover: { width: '100%', height: 96, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  /* The kind marker is a CHIP (setback 8/3, never a pill); the 2px surface
     ring keeps the punch-out where it overlaps the cover's bottom edge. */
  kindChip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    position: 'absolute',
    bottom: -11,
    start: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 22,
    paddingHorizontal: space.sm,
    borderWidth: 2,
  },
  title: { marginBottom: space.sm2 },
  author: { marginTop: space.sm2 },
})
