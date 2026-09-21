/* =========================================================
   ModerationBadge — a hold, rendered honestly.

   Stories are one of only three surfaces that expose a hold on
   the wire (`moderationStatus: PENDING | IN_REVIEW | null`), so
   this is one of the few places a badge is possible at all. It
   is never decorated with a category or the offending phrase:
   a precise moderation error is a working oracle for probing
   the classifier until something gets through.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { MODERATION_COPY, moderationState } from '@/lib/moderation'
import { Text } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { URGENT, ink, shade } from './night'

export interface ModerationBadgeProps {
  item: any
  /** `overlay` veils the whole cell; `chip` is an inline setback chip. */
  size?: 'chip' | 'overlay'
  style?: StyleProp<ViewStyle>
}

export function ModerationBadge({ item, size = 'chip', style }: ModerationBadgeProps) {
  const state = moderationState(item) as 'live' | 'checking' | 'review' | 'removed'
  if (state === 'live') return null

  const copy = MODERATION_COPY[state as 'checking' | 'review' | 'removed']
  const removed = state === 'removed'

  const chip = (
    <View style={[styles.chip, { backgroundColor: shade.heavy, borderColor: removed ? URGENT : ink.hairline }]}>
      <Text variant="micro" color={removed ? URGENT : ink.full} align="center">{copy.badge}</Text>
    </View>
  )

  if (size === 'chip') return <View style={style}>{chip}</View>

  return (
    <View style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: shade.veil }, style]} pointerEvents="none">
      {chip}
    </View>
  )
}

/** The one-line explanation that sits under the badge in the viewer. */
export const HELD_NOTE = 'Only you can see this until it clears.'

const styles = StyleSheet.create({
  chip: {
    height: 20,
    paddingHorizontal: space.sm,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  veil: { alignItems: 'center', justifyContent: 'center' },
})
