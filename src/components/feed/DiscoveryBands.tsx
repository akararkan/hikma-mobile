/* =========================================================
   DiscoveryBands — the web feed's right-hand rail, folded
   into the mobile timeline.

   A phone has no side column, so the three discovery surfaces
   the web keeps beside the feed (FeedPage.jsx → FeedRail)
   become bands BETWEEN the cards instead:

     · ResearchRail — "from the research desk", a horizontal
       shelf of published papers (api.research.feed);
     · QnaBand — open questions waiting for answers
       (api.qna.feed, OPEN only);
     · TrendingBand — the pre-ranked tag leaderboard
       (api.tags.trending).

   Each is a STELE like the cards it sits between (DESIGN.md
   §6): white plate, stone course border, setback corners, a
   Selvedge naming its content family — and each renders
   nothing when its surface came back empty, because a rail is
   a garnish, never an error.

   FeedFolio is the web's dateline row (date + الصفحة الرئيسية),
   the one piece of print furniture the feed keeps.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, shape, space } from '@/theme/tokens'
import { FEED_GUTTER } from './plate'
import { Chip, Icon, NumericText, Selvedge, Text, Touchable, WeftDash, formatCount } from '@/ui'
import { coverUrlOf } from './types'

/* The bands render api-layer rows (researchFrom / questionFrom /
   trendingTagFrom). Only the fields actually drawn are declared. */
export interface ResearchRailItem {
  id: string
  title: string
  cover?: string | null
  hasCover?: boolean
  time?: string
  _author?: { full?: string } | null
}
export interface OpenQuestionItem {
  id: string
  title: string
  time?: string
  answers?: number
  views?: number
  _author?: { full?: string } | null
}
export interface TrendTagItem { tag: string; usageCount?: number }

const TILE_W = 190
const TILE_GAP = 10

/* ---------------------------------------------------------
   The shared band head: a caption title with its family icon
   and the accent "See all" — LiveRail's grammar, reused.
   --------------------------------------------------------- */
function BandHead({ icon, label, onSeeAll }: { icon: any; label: string; onSeeAll?: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <View style={styles.head}>
      <Icon name={icon} size={13} color={c.textMuted} />
      <Text variant="caption" tone="muted" style={styles.flex}>{label}</Text>
      {onSeeAll ? (
        <Touchable onPress={onSeeAll} feedback="dim" noAutoHitSlop style={styles.seeAll}>
          <Text variant="footnote" tone="accent">See all</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   FeedFolio — the dateline under the header, straight from
   the web's `.folio` row. Pure print furniture: serif date,
   the Arabic running title on the end edge, nothing tappable.
   --------------------------------------------------------- */
export const FeedFolio = React.memo(function FeedFolio() {
  const { dateline, hijri } = React.useMemo(() => {
    const d = new Date()
    const line = `${d.toLocaleDateString('en-US', { weekday: 'long' })} · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
    /* The Hijri running date on the end edge — the umm-al-qura civil calendar,
       the standard approximation (official sightings can differ by a day).
       Guarded: an ICU build without the islamic calendar falls back to the
       old running title rather than printing garbage. */
    let h = 'الصفحة الرئيسية'
    try {
      const f = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
      if (f && /[؀-ۿ]/.test(f)) h = f
    } catch { /* fall back */ }
    return { dateline: line, hijri: h }
  }, [])
  return (
    <View style={styles.folio}>
      <Text variant="footnote" serif tone="muted" numberOfLines={1} style={styles.flex}>{dateline}</Text>
      <Text variant="footnote" serif tone="muted" numberOfLines={1}>{hijri}</Text>
    </View>
  )
})

/* ---------------------------------------------------------
   ResearchRail — the research desk shelf.
   --------------------------------------------------------- */
export interface ResearchRailProps {
  items: ResearchRailItem[]
  onPressItem?: (item: ResearchRailItem) => void
  onSeeAll?: () => void
}

export const ResearchRail = React.memo(function ResearchRail({ items, onPressItem, onSeeAll }: ResearchRailProps) {
  const t = useTheme()
  const c = t.colors
  if (!items.length) return null

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <Selvedge color={c.scholar} />
      <BandHead icon="research" label="FROM THE RESEARCH DESK" onSeeAll={onSeeAll} />
      <WeftDash style={styles.dash} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE_W + TILE_GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.rail}
      >
        {items.map(r => {
          const cover = coverUrlOf(r.cover)
          return (
            <Touchable
              key={String(r.id)}
              onPress={() => onPressItem?.(r)}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={r.title}
              style={[styles.tile, { borderColor: c.border }]}
            >
              {cover ? (
                <Image
                  source={{ uri: cover }}
                  style={[styles.tileCover, { backgroundColor: c.surfaceSunken }]}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={cover}
                />
              ) : (
                <View style={[styles.tileCover, styles.tilePlate, { backgroundColor: c.scholarSoft }]}>
                  <Icon name="research" size={22} color={c.scholar} />
                </View>
              )}
              <View style={styles.tileBody}>
                <Text variant="subhead" serif weight="700" numberOfLines={2} align="auto">{r.title || 'Untitled research'}</Text>
                <Text variant="caption" caps={false} tone="muted" numberOfLines={1} style={styles.tileMeta}>
                  {[r._author?.full, r.time].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Touchable>
          )
        })}
      </ScrollView>
    </View>
  )
})

/* ---------------------------------------------------------
   QnaBand — open questions waiting for an answer.
   --------------------------------------------------------- */
export interface QnaBandProps {
  questions: OpenQuestionItem[]
  onPressQuestion?: (q: OpenQuestionItem) => void
  onSeeAll?: () => void
}

export const QnaBand = React.memo(function QnaBand({ questions, onPressQuestion, onSeeAll }: QnaBandProps) {
  const t = useTheme()
  const c = t.colors
  if (!questions.length) return null

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <Selvedge color={c.warning} />
      <BandHead icon="qna" label="OPEN QUESTIONS" onSeeAll={onSeeAll} />
      <WeftDash style={styles.dash} />
      {questions.map((q, i) => (
        <Touchable
          key={String(q.id)}
          onPress={() => onPressQuestion?.(q)}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel={q.title}
          style={[styles.qRow, i > 0 && { borderTopColor: c.separator, borderTopWidth: StyleSheet.hairlineWidth }]}
        >
          <Text variant="subhead" weight="600" numberOfLines={2} align="auto">{q.title}</Text>
          <View style={styles.qMeta}>
            <Text variant="caption" caps={false} tone="muted" numberOfLines={1} style={styles.flex}>
              {[q._author?.full, q.time].filter(Boolean).join(' · ')}
            </Text>
            <Icon name="qna" size={12} color={c.link} />
            <NumericText variant="caption" caps={false} color={c.link}>
              {`${formatCount(q.answers || 0)} answers`}
            </NumericText>
          </View>
        </Touchable>
      ))}
    </View>
  )
})

/* ---------------------------------------------------------
   TrendingBand — the tag leaderboard as a chip shelf.
   --------------------------------------------------------- */
export interface TrendingBandProps {
  tags: TrendTagItem[]
  onPressTag?: (tag: string) => void
  onSeeAll?: () => void
}

export const TrendingBand = React.memo(function TrendingBand({ tags, onPressTag, onSeeAll }: TrendingBandProps) {
  const t = useTheme()
  const c = t.colors
  if (!tags.length) return null

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <Selvedge color={c.accent} />
      <BandHead icon="trending" label="TRENDING IN SCHOLARSHIP" onSeeAll={onSeeAll} />
      <WeftDash style={styles.dash} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {tags.map(tag => (
          <Chip
            key={tag.tag}
            label={`#${tag.tag}`}
            onPress={onPressTag ? () => onPressTag(tag.tag) : undefined}
          />
        ))}
      </ScrollView>
    </View>
  )
})

const styles = StyleSheet.create({
  /* The stele frame shared with every feed card: setback corners, one course
     border, no shadow; overflow clips the selvedge to the corners. */
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  card: {
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: FEED_GUTTER, paddingBottom: space.sm2 },
  flex: { flex: 1 },
  seeAll: { paddingVertical: space.xxs },
  dash: { marginBottom: space.sm2, marginHorizontal: FEED_GUTTER },

  folio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: FEED_GUTTER,
    paddingTop: space.sm2,
    paddingBottom: space.xxs,
  },

  rail: { paddingHorizontal: FEED_GUTTER, gap: TILE_GAP },
  tile: {
    width: TILE_W,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    borderWidth: rule.course,
    overflow: 'hidden',
  },
  tileCover: { width: '100%', height: 84 },
  tilePlate: { alignItems: 'center', justifyContent: 'center' },
  tileBody: { paddingHorizontal: space.sm2, paddingTop: space.sm, paddingBottom: space.sm2, gap: space.xs },
  tileMeta: { marginTop: space.xxs },

  qRow: { paddingHorizontal: FEED_GUTTER, paddingVertical: space.sm2, gap: space.xs2 },
  qMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  chips: { paddingHorizontal: FEED_GUTTER, gap: space.sm, flexDirection: 'row' },
})
