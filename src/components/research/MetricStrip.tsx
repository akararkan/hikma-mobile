/* =========================================================
   MetricStrip — the six numbers a paper carries.

   Shares are the seventh counter and are deliberately NOT a cell
   here: the strip measures how the work was received (read,
   downloaded, cited, discussed), and a share tally belongs with
   the act of sharing. metrics.shares does exist — the adapter
   fills it and SHARE_COUNT_UPDATED keeps it live — and the share
   sheet is what prints it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable, formatCount, type IconName } from '@/ui'
import type { Metrics } from './types'

type Cell = { key: keyof Metrics; icon: IconName; label: string }

/* Fixed order — a metric that moves between two screens reads as a different
   metric. */
const CELLS: Cell[] = [
  { key: 'views', icon: 'eye', label: 'Views' },
  { key: 'reactions', icon: 'heart', label: 'Likes' },
  { key: 'comments', icon: 'comment', label: 'Comments' },
  { key: 'saves', icon: 'bookmark', label: 'Saves' },
  { key: 'downloads', icon: 'download', label: 'Downloads' },
  { key: 'citations', icon: 'cite', label: 'Citations' },
]

function MetricStripBase({
  metrics, compact = false, onPressComments, onPressCitations, onPressReactions, style,
}: {
  metrics: Metrics
  compact?: boolean
  onPressComments?: () => void
  onPressCitations?: () => void
  onPressReactions?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors

  const press: Partial<Record<keyof Metrics, (() => void) | undefined>> = {
    comments: onPressComments,
    citations: onPressCitations,
    reactions: onPressReactions,
  }

  if (compact) {
    return (
      <View style={[styles.row, { gap: space.md2 }, style]}>
        {CELLS.map(cell => (
          <View key={cell.key} style={styles.pair}>
            <Icon name={cell.icon} size={13} color={c.textFaint} />
            <NumericText variant="caption" tone="muted">{formatCount(metrics?.[cell.key])}</NumericText>
          </View>
        ))}
      </View>
    )
  }

  return (
    <View style={[styles.row, style]}>
      {CELLS.map(cell => {
        const onPress = press[cell.key]
        const body = (
          <View style={styles.cell}>
            <NumericText variant="title3" align="center">{formatCount(metrics?.[cell.key])}</NumericText>
            {/* No .toUpperCase() here: `micro` uppercases LATIN ONLY inside
                the Text primitive, which is what leaves an Arabic or Kurdish
                label alone. A call-site transform would hit every script. */}
            <Text variant="micro" tone="faint" align="center" style={styles.label}>
              {cell.label}
            </Text>
          </View>
        )
        if (!onPress) return <View key={cell.key} style={styles.flex}>{body}</View>
        return (
          <Touchable key={cell.key} onPress={onPress} feedback="dim" noAutoHitSlop style={styles.flex}>
            {body}
          </Touchable>
        )
      })}
    </View>
  )
}

/* Memoized: one strip rides every research card in a list, and its props are
   the row's own metrics object plus scalars. */
export const MetricStrip = React.memo(MetricStripBase)

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  pair: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  cell: { alignItems: 'center', gap: space.xxs, paddingVertical: space.xs },
  flex: { flex: 1 },
  label: { marginTop: space.xxs },
})
