/* =========================================================
   QuestionCard — a Q&A row in the mixed feed.

   No artwork: a question has no cover, and a placeholder
   image would just be furniture. One CTA, because "Answer" is
   the only thing this row can usefully do before the detail
   page loads real counters (they are zero at feed-read time
   by design).

   A FULL-BLEED PLATE (feed/plate.ts) with a warning-hue
   SELVEDGE at the start edge carrying the Q&A identity — one
   selvedge per card. The title is divided from the author row
   by the WEFT DASH.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Button, Icon, Selvedge, Text, Touchable, WeftDash } from '@/ui'
import { AuthorRow } from '@/components/post/AuthorRow'
import type { QuestionFeedView } from './types'
import { FEED_GUTTER } from './plate'

export interface QuestionCardProps {
  item: QuestionFeedView
  onPress?: (item: QuestionFeedView) => void
  onAnswer?: (item: QuestionFeedView) => void
  onPressAuthor?: (userId: string) => void
}

/* Memoized: a feed row must survive unrelated list renders untouched — the
   caller's handlers have to be identity-stable for this to hold. */
export const QuestionCard = React.memo(function QuestionCard({ item, onPress, onAnswer, onPressAuthor }: QuestionCardProps) {
  const t = useTheme()
  const c = t.colors
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
      <Selvedge color={c.warning} />

      <View style={[styles.kindChip, { backgroundColor: c.warningSoft }]}>
        <Icon name="qna" size={11} color={c.warningText} />
        <Text variant="caption" color={c.warningText}>Question</Text>
      </View>

      <Text variant="headline" numberOfLines={4} align="auto" style={styles.title}>{item.title}</Text>

      <WeftDash style={styles.dash} />

      <AuthorRow
        author={item._author}
        time={item.time}
        size={26}
        onPress={onPressAuthor ? () => onPressAuthor(item.author) : undefined}
      />

      <Button
        label="Answer"
        onPress={() => (onAnswer ? onAnswer(item) : onPress?.(item))}
        variant="secondary"
        size="sm"
        block
        style={styles.cta}
      />
    </Touchable>
  )
})

const styles = StyleSheet.create({
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  card: {
    paddingTop: space.md2,
    paddingBottom: space.md2,
    paddingHorizontal: FEED_GUTTER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',   /* keeps the selvedge inside the plate */
  },
  /* The kind marker is a CHIP (setback 8/3), never a pill. */
  kindChip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 22,
    paddingHorizontal: space.sm,
    alignSelf: 'flex-start',
  },
  title: { marginTop: space.sm2, marginBottom: space.md },
  dash: { marginBottom: space.md },
  cta: { marginTop: space.md2 },
})
