/* =========================================================
   ListRow — the settings row, the menu item, the picker
   option and the action-sheet line, all one component.

   There are roughly two hundred of these in the app. Making
   them one component is the difference between a settings
   tree that reads as one product and one that reads as
   fourteen screens written by fourteen people.

   The `accessory` prop is the variable part: a chevron, a
   switch, a value, a checkmark, a badge, or nothing.

   QELAT (DESIGN.md §6): rows are flat clay — no plates, no
   shadows. Press is the ripple, separators are hairlines
   inset to the text start, and a chosen row carries a 2.5pt
   lapis SELVEDGE at its start edge. The radio is the DIAMOND
   TURN (§7.1), not a circle.
   ========================================================= */
import React from 'react'
import {
  StyleSheet, Switch, View,
  type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle,
} from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Text } from './Text'
import { Icon, DisclosureIcon, type IconName } from './Icon'
import { Touchable, TouchableRow, fireHaptic } from './Touchable'
import { Badge } from './Chip'
import { Selvedge } from './ornaments'

export type RowAccessory =
  | { kind: 'chevron' }
  | { kind: 'value'; text: string; chevron?: boolean }
  | { kind: 'switch'; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }
  | { kind: 'check'; checked: boolean }
  | { kind: 'radio'; checked: boolean }
  | { kind: 'badge'; count: number }
  | { kind: 'custom'; node: React.ReactNode }
  | { kind: 'none' }

export interface ListRowProps {
  title: string
  subtitle?: string
  /** A third line for the long "what this does" copy on privacy screens. */
  description?: string
  icon?: IconName
  /** Tint the icon and give it a soft square backing — the settings root. */
  iconTone?: 'accent' | 'scholar' | 'success' | 'warning' | 'danger' | 'neutral' | 'plain'
  leading?: React.ReactNode
  accessory?: RowAccessory
  onPress?: () => void
  onLongPress?: () => void
  destructive?: boolean
  disabled?: boolean
  /** Drop the row's own horizontal padding — for rows inside a padded card. */
  flush?: boolean
  style?: StyleProp<ViewStyle>
  minHeight?: number
}

export function ListRow({
  title, subtitle, description, icon, iconTone = 'neutral', leading,
  accessory = { kind: 'none' }, onPress, onLongPress, destructive, disabled,
  flush, style, minHeight,
}: ListRowProps) {
  const t = useTheme()
  const c = t.colors

  /* Icons on the soft washes take the *Text roles — the pairs that were
     contrast-verified in DESIGN.md §2 (plain `accent` disappears on the dark
     scheme's accentSoft). */
  const tint =
    destructive ? c.dangerText
      : iconTone === 'accent' ? c.accentText
        : iconTone === 'scholar' ? c.scholarText
          : iconTone === 'success' ? c.successText
            : iconTone === 'warning' ? c.warningText
              : iconTone === 'danger' ? c.dangerText
                : c.textSecondary

  const iconBg =
    iconTone === 'plain' ? 'transparent'
      : destructive || iconTone === 'danger' ? c.dangerSoft
        : iconTone === 'accent' ? c.accentSoft
          : iconTone === 'scholar' ? c.scholarSoft
            : iconTone === 'success' ? c.successSoft
              : iconTone === 'warning' ? c.warningSoft
                : c.surfaceSunken

  /* A switch row is tappable everywhere except the switch itself, and the tap
     should flip it — otherwise the 44pt target is only the switch. */
  const isSwitch = accessory.kind === 'switch'
  const press = onPress ?? (isSwitch && !accessory.disabled
    ? () => { fireHaptic('select'); accessory.onValueChange(!accessory.value) }
    : undefined)

  /* A checked pick row is a SELECTED row: the accent selvedge at the start
     edge carries the state; the accessory mark is only the click. */
  const selected =
    (accessory.kind === 'check' || accessory.kind === 'radio') && accessory.checked

  /* THE ROW IS THE CONTROL, so the row — not the accessory — must carry the
     role and the state. Without this a settings tree of eighty toggles reads
     as "Push notifications, button" with no on/off, and a radio list loses
     its pick entirely: the selection is drawn by the Selvedge alone, which
     assistive tech cannot see. `checked` is set ONLY on the three kinds that
     have a checked state — a stray `checked: false` makes TalkBack announce
     "not checked" on every chevron row in the app. */
  const rowOwnsA11y = !!(press || onLongPress)
  const a11yRole: AccessibilityRole =
    accessory.kind === 'switch' ? 'switch'
      : accessory.kind === 'check' ? 'checkbox'
        : accessory.kind === 'radio' ? 'radio'
          : 'button'
  const a11yDisabled = disabled || (accessory.kind === 'switch' && !!accessory.disabled)
  const a11yState: AccessibilityState =
    accessory.kind === 'switch' ? { checked: accessory.value, disabled: a11yDisabled }
      : accessory.kind === 'check' || accessory.kind === 'radio'
        ? { checked: accessory.checked, selected: accessory.checked, disabled: a11yDisabled }
        : { disabled: a11yDisabled }
  /* An explicit name REPLACES the children Pressable would otherwise merge,
     so everything that was in that merge has to be put back by hand — the
     subtitle, the long "what this does" copy on the privacy screens, and the
     accessory's own text (the "English" on a Language row). A `custom`
     accessory is an unknown subtree we cannot put back, so those rows keep
     the merge and only gain the role. */
  const a11yLabel = accessory.kind === 'custom' ? undefined : [
    title,
    subtitle,
    description,
    accessory.kind === 'value' ? accessory.text : null,
    accessory.kind === 'badge' && accessory.count ? String(accessory.count) : null,
  ].filter(Boolean).join('. ')

  const body = (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: flush ? 0 : t.layout.screenPadding,
          paddingVertical: Math.round(11 * t.densityScale),
          minHeight: minHeight ?? Math.round(52 * t.densityScale),
          backgroundColor: 'transparent',
          gap: space.md,
        },
        style,
      ]}
    >
      {selected ? <Selvedge color={c.accent} /> : null}
      {leading ?? (icon ? (
        <View
          style={[
            styles.iconBox,
            iconTone === 'plain'
              ? { width: 26, height: 26 }
              : {
                  width: 30, height: 30, backgroundColor: iconBg,
                  ...setback(t.shape.chip), borderCurve: 'continuous' as const,
                },
          ]}
        >
          <Icon name={icon} size={iconTone === 'plain' ? 21 : 17} color={tint} />
        </View>
      ) : null)}

      <View style={styles.flex}>
        <Text
          variant="body"
          align="ui"
          tone={destructive ? 'danger' : 'default'}
          numberOfLines={description ? 2 : 1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="muted" align="ui" numberOfLines={2} style={{ marginTop: space.xxs }}>{subtitle}</Text>
        ) : null}
        {description ? (
          <Text variant="footnote" tone="faint" align="ui" style={{ marginTop: space.xs }}>{description}</Text>
        ) : null}
      </View>

      <Accessory accessory={accessory} disabled={disabled} rowOwnsA11y={rowOwnsA11y} title={title} />
    </View>
  )

  if (!rowOwnsA11y) return body
  return (
    <TouchableRow
      onPress={press}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole={a11yRole}
      accessibilityState={a11yState}
      accessibilityLabel={a11yLabel}
    >
      {body}
    </TouchableRow>
  )
}

function Accessory({
  accessory, disabled, rowOwnsA11y, title,
}: { accessory: RowAccessory; disabled?: boolean; rowOwnsA11y: boolean; title: string }) {
  const t = useTheme()
  const c = t.colors

  switch (accessory.kind) {
    case 'chevron':
      return <DisclosureIcon />
    case 'value':
      return (
        <View style={[styles.row, { gap: space.xs2, maxWidth: '48%' }]}>
          <Text variant="callout" tone="faint" numberOfLines={1} align="ui">{accessory.text}</Text>
          {accessory.chevron !== false ? <DisclosureIcon /> : null}
        </View>
      )
    case 'switch': {
      /* QELAT dark inversion: ON = sky track + lapis knob (by day: lapis
         track + warm-white knob). The knob is warm white, never pure — pure
         white ink belongs to liveDot plates alone (DESIGN.md §2). */
      const dark = c.scheme === 'dark'
      const on = !!accessory.value
      return (
        <Switch
          /* When the row is tappable it IS the switch (see `press` above), so
             the control must not be a second, nameless focus stop announcing
             a bare "on". A row that only holds a disabled switch has no
             Touchable to speak for it, so there the switch names itself. */
          accessible={!rowOwnsA11y}
          accessibilityLabel={rowOwnsA11y ? undefined : title}
          value={accessory.value}
          onValueChange={v => { fireHaptic('select'); accessory.onValueChange(v) }}
          disabled={disabled || accessory.disabled}
          trackColor={{ false: c.borderStrong, true: dark ? c.sky : c.accent }}
          thumbColor={dark && on ? c.accent : c.textOnAccent}
          ios_backgroundColor={c.borderStrong}
        />
      )
    }
    case 'check':
      return accessory.checked ? <Icon name="check" size={20} color={c.accent} /> : <View style={{ width: 20 }} />
    case 'radio':
      return <RadioMark checked={accessory.checked} />
    case 'badge':
      return (
        <View style={[styles.row, { gap: space.sm }]}>
          <Badge count={accessory.count} />
          <DisclosureIcon />
        </View>
      )
    case 'custom':
      return <>{accessory.node}</>
    default:
      return null
  }
}

/* ---------------------------------------------------------
   THE DIAMOND TURN (DESIGN.md §7.1) — the radio is a small
   square that stands as a diamond while idle and turns flat
   when chosen. The row's selvedge carries the selected state;
   this mark is only the click. Reduced motion cuts (t.ms→0).
   --------------------------------------------------------- */
function RadioMark({ checked }: { checked: boolean }) {
  const t = useTheme()
  const turn = useSharedValue(checked ? 0 : 45)
  React.useEffect(() => {
    turn.value = withTiming(checked ? 0 : 45, {
      duration: t.ms(200),
      easing: Easing.bezier(...t.motion.out),
    })
  }, [checked, t, turn])
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }))
  return (
    <View style={styles.radioBox}>
      <Animated.View
        style={[
          anim,
          checked
            ? { width: 6, height: 6, backgroundColor: t.colors.accent }
            : { width: 6, height: 6, borderWidth: t.rule.baseline, borderColor: t.colors.borderStrong },
        ]}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   RowGroup — rows in a setback card (crowned 14 / rooted 4,
   1px course border) with hairlines between, inset to the
   text start. The grouped-table look, which is what a
   settings tree of this size needs — reshaped as a stele.
   --------------------------------------------------------- */

export function RowGroup({
  children, style, inset = 56, card = true,
}: { children: React.ReactNode; style?: StyleProp<ViewStyle>; inset?: number; card?: boolean }) {
  const t = useTheme()
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <View
      style={[
        card ? {
          marginHorizontal: t.layout.screenPadding,
          ...setback(t.shape.card),
          borderCurve: 'continuous' as const,
          backgroundColor: t.colors.surface,
          borderWidth: t.rule.course,
          borderColor: t.colors.border,
          overflow: 'hidden' as const,
        } : { backgroundColor: t.colors.surface },
        style,
      ]}
    >
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? (
            <View
              style={{
                height: t.rule.hairline,
                backgroundColor: t.colors.separator,
                marginStart: inset,
              }}
            />
          ) : null}
          {child}
        </View>
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   ActionRow — the line in a bottom sheet menu. Bigger icon,
   no card chrome, destructive variant in red.
   --------------------------------------------------------- */

export function ActionRow({
  label, icon, onPress, destructive, disabled, subtitle, trailing,
}: {
  label: string
  icon?: IconName
  onPress?: () => void
  destructive?: boolean
  disabled?: boolean
  subtitle?: string
  trailing?: React.ReactNode
}) {
  const t = useTheme()
  const color = destructive ? t.colors.dangerText : t.colors.text
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="tint"
      noAutoHitSlop
      haptic="light"
      style={[styles.row, { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.lg, minHeight: 54 }]}
    >
      {icon ? <Icon name={icon} size={21} color={color} /> : null}
      <View style={styles.flex}>
        <Text variant="body" color={color} align="ui">{label}</Text>
        {subtitle ? <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  /* Same 21pt footprint the old circle had, so picker layouts hold. */
  radioBox: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center' },
})
