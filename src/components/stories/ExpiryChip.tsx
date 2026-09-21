/* =========================================================
   ExpiryChip — how much life a frame has left.

   Always driven off the row's `expiresAt`, never off the
   lifetimeHours we sent: the server accepts only 8, 16 and 24
   and silently coerces anything else to 24 with no error, so
   the request is not evidence of what happened.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { Text } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { URGENT, ink, shade } from './night'
import { fmtLeft, msLeft, tickFor } from './storyVisual'

export interface ExpiryChipProps {
  expiresAt?: string | null
  /** Drop the word "left" — grid overlays have no room for it. */
  compact?: boolean
  /** Bare text instead of a plate, for a line that already has a background. */
  plain?: boolean
  style?: StyleProp<ViewStyle>
}

export function ExpiryChip({ expiresAt, compact = false, plain = false, style }: ExpiryChipProps) {
  const label = useCountdown(expiresAt, compact)
  if (!expiresAt) return null

  const urgent = msLeft(expiresAt) < 60 * 60 * 1000
  const color = urgent ? URGENT : ink.muted

  if (plain) {
    return <Text variant="caption" color={color} align="ui" style={style as StyleProp<TextStyle>}>{label}</Text>
  }

  return (
    <View style={[styles.chip, { backgroundColor: shade.chip }, style]}>
      <Text variant="micro" color={urgent ? URGENT : ink.full} align="center">{label}</Text>
    </View>
  )
}

/** Re-renders on a 60s beat, tightening to 10s inside the last ten minutes —
 *  a countdown that only moves every minute reads as frozen at "2m". */
export function useCountdown(expiresAt?: string | number | null, compact = true): string {
  const [, force] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    if (!expiresAt) return undefined
    let id: ReturnType<typeof setTimeout>
    const beat = () => {
      force()
      id = setTimeout(beat, tickFor(expiresAt))
    }
    id = setTimeout(beat, tickFor(expiresAt))
    return () => clearTimeout(id)
  }, [expiresAt])

  return fmtLeft(expiresAt, !compact)
}

const styles = StyleSheet.create({
  chip: {
    height: 18,
    paddingHorizontal: space.xs2,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
})
