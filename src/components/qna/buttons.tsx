/* =========================================================
   The three toggles this domain repeats everywhere.

   LikeButton coalesces taps on a 700ms window. There is one
   reaction type in Q&A (no LOVE/HAHA variants exist on the
   wire), the limiter is 30 reactions per 10 seconds, and a
   double-tap on a heart is a reflex — without the coalescer a
   user can spend a third of their budget on one card.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable, fireHaptic, formatCount, type IconName } from '@/ui'

export function LikeButton({
  liked, count, disabled, cooldown = 0, compact, onToggle,
}: {
  liked: boolean
  count: number
  disabled?: boolean
  cooldown?: number
  compact?: boolean
  onToggle: (next: boolean) => void
}) {
  const t = useTheme()
  const off = !!disabled || cooldown > 0
  const size = compact ? 16 : 18
  return (
    <Touchable
      onPress={() => { fireHaptic('light'); onToggle(!liked) }}
      disabled={off}
      feedback="scale"
      style={[styles.action, { gap: compact ? 5 : 6 }]}
      accessibilityLabel={liked ? 'Remove like' : 'Like'}
      accessibilityState={{ selected: liked, disabled: off }}
    >
      <Icon name="heart" size={size} filled={liked} color={liked ? t.colors.like : t.colors.textMuted} />
      {cooldown > 0 ? (
        <Text variant="footnote" tone="muted">Wait {cooldown}s</Text>
      ) : count > 0 ? (
        <NumericText variant="footnote" weight="600" color={liked ? t.colors.like : t.colors.textSecondary}>
          {formatCount(count)}
        </NumericText>
      ) : null}
    </Touchable>
  )
}

export function AcceptButton({
  accepted, visible, busy, onToggle,
}: { accepted: boolean; visible: boolean; busy?: boolean; onToggle: (next: boolean) => void }) {
  const t = useTheme()
  if (!visible) return null
  return (
    <Touchable
      onPress={() => { fireHaptic(accepted ? 'light' : 'success'); onToggle(!accepted) }}
      disabled={busy}
      feedback="scale"
      style={[
        styles.action,
        {
          gap: space.xs2,
          paddingHorizontal: space.sm2,
          height: 30,
          /* A labelled control is a BUTTON plate, not a pill. */
          ...setback(shape.buttonSm),
          borderCurve: 'continuous',
          backgroundColor: accepted ? t.colors.scholarSoft : 'transparent',
          borderWidth: accepted ? 0 : StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
        },
      ]}
      accessibilityLabel={accepted ? 'Remove acceptance' : 'Accept this answer'}
      accessibilityState={{ selected: accepted }}
    >
      <Icon name="checkCircle" size={16} filled={accepted} color={accepted ? t.colors.scholar : t.colors.textMuted} />
      <Text variant="footnote" weight="600" color={accepted ? t.colors.scholarText : t.colors.textSecondary}>
        {accepted ? 'Accepted' : 'Accept'}
      </Text>
    </Touchable>
  )
}

export function SaveButton({
  saved, count, cooldown = 0, disabled, size = 22, onToggle, onLongPress,
}: {
  saved: boolean
  count?: number
  cooldown?: number
  disabled?: boolean
  size?: number
  onToggle: () => void
  onLongPress?: () => void
}) {
  const t = useTheme()
  const off = !!disabled || cooldown > 0
  return (
    <Touchable
      onPress={onToggle}
      onLongPress={onLongPress}
      disabled={off}
      feedback="scale"
      haptic="select"
      style={[styles.action, { gap: space.xs2 }]}
      accessibilityLabel={saved ? 'Remove from saved' : 'Save question'}
      accessibilityState={{ selected: saved, disabled: off }}
    >
      <Icon name="bookmark" size={size} filled={saved} color={saved ? t.colors.accent : t.colors.textMuted} />
      {cooldown > 0 ? (
        <Text variant="footnote" tone="muted">Wait {cooldown}s</Text>
      ) : count != null && count > 0 ? (
        <NumericText variant="footnote" weight="600" tone={saved ? 'accent' : 'secondary'}>{formatCount(count)}</NumericText>
      ) : null}
    </Touchable>
  )
}

/** The 48pt four-up bar under the hero, and the compact footer row on an
 *  answer card — same geometry, different contents. */
export function BarAction({
  icon, label, active, tone, onPress, onLongPress, disabled,
}: {
  icon: IconName
  label: string
  active?: boolean
  tone?: 'accent' | 'default'
  onPress: () => void
  onLongPress?: () => void
  disabled?: boolean
}) {
  const t = useTheme()
  const color = active ? t.colors.accent : tone === 'accent' ? t.colors.accentText : t.colors.textSecondary
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      feedback="tint"
      noAutoHitSlop
      style={styles.barAction}
      accessibilityLabel={label}
    >
      <Icon name={icon} size={20} filled={active} color={color} />
      <Text variant="caption" color={color} align="center" style={{ marginTop: space.xs }}>{label}</Text>
    </Touchable>
  )
}

export function MetricStat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  const t = useTheme()
  return (
    <View style={[styles.action, { gap: space.xs2 }]} accessible accessibilityLabel={`${value} ${label}`}>
      <Icon name={icon} size={15} color={t.colors.textFaint} />
      <NumericText variant="footnote" tone="muted">{formatCount(value)}</NumericText>
    </View>
  )
}

const styles = StyleSheet.create({
  action: { flexDirection: 'row', alignItems: 'center' },
  barAction: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs2, minHeight: 48 },
})
