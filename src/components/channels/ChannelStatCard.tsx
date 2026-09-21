/* =========================================================
   The KPI tile.

   `accuracy` is the point of the component. Member numbers come
   from Postgres and are exact; post types, views, forwards and
   top posts are Redis aggregates maintained on the hot path.
   Presenting both with the same authority is the one way an
   analytics panel actively misleads, so the caption is a
   required part of the tile rather than a footnote somebody
   might forget.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Card, Skeleton, Text, formatCount } from '@/ui'
import { Sparkline } from './Charts'

export interface ChannelStatCardProps {
  label: string
  /** `null` means "the API gave nothing" — never rendered as 0. */
  value: number | string | null | undefined
  delta?: number | null
  deltaLabel?: string
  sparkline?: number[]
  accuracy?: 'exact' | 'best-effort'
  hint?: string
  /** Tint the figure by sign — net growth only. */
  signed?: boolean
  compact?: boolean
  width?: number
  style?: any
}

export function ChannelStatCard({
  label, value, delta, deltaLabel, sparkline, accuracy, hint, signed, compact, width, style,
}: ChannelStatCardProps) {
  const t = useTheme()
  const c = t.colors
  const missing = value == null
  const numeric = typeof value === 'number' ? value : null
  const figureColor = signed && numeric != null
    ? (numeric > 0 ? c.successText : numeric < 0 ? c.dangerText : c.text)
    : c.text

  return (
    <Card variant="outlined" padding={compact ? 12 : 14} style={[styles.card, style]}>
      <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>{label}</Text>

      <Text
        variant={compact ? 'title2' : 'display'}
        color={missing ? c.textFaint : figureColor}
        align="ui"
        numberOfLines={1}
        style={{ marginTop: space.xxs }}
      >
        {missing ? '—' : typeof value === 'number' ? `${signed && value > 0 ? '+' : ''}${formatCount(value)}` : value}
      </Text>

      {delta != null ? (
        <View
          style={[
            styles.delta,
            /* A delta is a text-bearing plate, so it wears the chip setback —
               the only sanctioned pills are unread counters and LIVE badges. */
            setback(t.shape.chip),
            { backgroundColor: delta > 0 ? c.successSoft : c.surfaceSunken },
          ]}
        >
          <Text variant="caption" color={delta > 0 ? c.successText : c.textMuted}>
            {delta > 0 ? '+' : ''}{formatCount(delta)}{deltaLabel ? ` ${deltaLabel}` : ''}
          </Text>
        </View>
      ) : null}

      {hint ? <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }}>{hint}</Text> : null}

      {sparkline?.length && width ? (
        <View style={{ marginTop: space.sm2 }}>
          <Sparkline values={sparkline} width={width - (compact ? 24 : 28)} />
        </View>
      ) : null}

      {accuracy ? (
        <Text variant="micro" tone="faint" align="ui" style={{ marginTop: space.sm }}>
          {accuracy === 'exact' ? 'Exact' : 'Best-effort'}
        </Text>
      ) : null}
    </Card>
  )
}

export function StatCardSkeleton({ height = 132 }: { height?: number }) {
  return <Skeleton height={height} radius={18} />
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  delta: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: space.xxs, borderCurve: 'continuous', marginTop: space.xs2 },
})
