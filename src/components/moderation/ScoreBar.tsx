/* =========================================================
   ScoreBar — one classifier head's score against its band.

   The whole point is the RELATIONSHIP between the number and
   the two thresholds that were in force when the case was
   filed, so the ticks are drawn from `bands`, not from a
   constant: re-tuning the engine changes where the marks sit,
   and a bar whose ticks lied would make a moderator second-
   guess a correct decision.

   Four decimals because the bands themselves are three-decimal
   values — rounding to two makes 0.4996 and 0.5004 look
   identical while landing on opposite sides of a threshold.

   Never rendered for an empty score map: `{}` from the backend
   means "we could not read it", not "all zero", and a row of
   zero-length bars says the opposite. The caller renders the
   "scores could not be read" line instead.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text } from '@/ui'
import { Mono } from './parts'

export interface ScoreBarProps {
  label: string
  score: number
  band?: { low?: number; high?: number } | null
  /** Bold the row that owns `field.topLabel`. */
  emphasised?: boolean
  /** Hide the low/high captions — the probe panel has no bands to explain. */
  showTicks?: boolean
  style?: StyleProp<ViewStyle>
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))

export function ScoreBar({ label, score, band, emphasised, showTicks = true, style }: ScoreBarProps) {
  const t = useTheme()
  const c = t.colors

  const value = clamp01(Number(score))
  const low = band?.low != null ? clamp01(Number(band.low)) : null
  const high = band?.high != null ? clamp01(Number(band.high)) : null

  /* Colour by band, not by magnitude: 0.7 is green on a permissive type and
     red on a strict one, and the bar has to agree with the verdict pill. */
  const fill =
    high != null && value >= high ? c.danger
      : low != null && value >= low ? c.warning
        : c.success

  return (
    <View style={[styles.row, style]}>
      <Mono
        variant="caption"
        tone={emphasised ? 'default' : 'muted'}
        weight={emphasised ? '700' : undefined}
        align="ui"
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </Mono>

      <View style={styles.trackWrap}>
        <View style={[styles.track, { backgroundColor: c.surfaceSunken, borderRadius: 3 }]}>
          <View style={{ width: `${value * 100}%`, height: '100%', backgroundColor: fill, borderRadius: 3 }} />
          {low != null ? <View style={[styles.tick, { start: `${low * 100}%`, backgroundColor: c.textFaint }]} /> : null}
          {high != null ? <View style={[styles.tick, { start: `${high * 100}%`, backgroundColor: c.textSecondary }]} /> : null}
        </View>
        {showTicks && (low != null || high != null) ? (
          <View style={styles.tickLabels}>
            {low != null ? (
              <Text variant="micro" tone="faint" style={[styles.tickLabel, { start: `${low * 100}%` }]}>low</Text>
            ) : null}
            {high != null ? (
              <Text variant="micro" tone="faint" style={[styles.tickLabel, { start: `${high * 100}%` }]}>high</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <Mono
        variant="caption"
        tone={emphasised ? 'default' : 'secondary'}
        weight={emphasised ? '700' : undefined}
        align="right"
        style={styles.value}
      >
        {value.toFixed(4)}
      </Mono>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingVertical: space.xs2 },
  label: { width: 100 },
  trackWrap: { flex: 1, paddingTop: space.xs2 },
  track: { height: 6, overflow: 'visible' },
  tick: { position: 'absolute', top: -3, width: 1, height: 12 },
  tickLabels: { height: 12, marginTop: space.xs },
  tickLabel: { position: 'absolute', marginStart: -space.xs2 },
  value: { width: 52 },
})
