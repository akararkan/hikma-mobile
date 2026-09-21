/* =========================================================
   Surfaces, separators and the small structural pieces —
   OXFORD (DESIGN.md §6). A Card is white paper with a stone
   hairline and soft slate depth: resting cards sit flat on
   their border; `raised` surfaces (menus, popovers) lift on
   the soft slate shadow. Section titles rest on a printed
   hairline; callouts wear a 3px strip in their tone hue.
   ========================================================= */
import React from 'react'
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { setback, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { Text } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable } from './Touchable'
import { Selvedge, WarpRule } from './ornaments'

/* ---------------------------------------------------------
   Card — a bounded surface. All variants are steles now:
   setback card corners + a 1px course border. `flat` and
   `outlined` share the standard plate; `raised` (menus,
   popovers) takes the popover setback and a strong border —
   depth by border weight, never shadow; `sunken` is a quiet
   well with a faint border. A caller-supplied `radius`
   (legacy sites: media frames) opts back into uniform
   corners.
   --------------------------------------------------------- */

export interface CardProps {
  children?: React.ReactNode
  variant?: 'flat' | 'outlined' | 'raised' | 'sunken'
  padding?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

export function Card({ children, variant = 'flat', padding, radius, style }: CardProps) {
  const t = useTheme()
  const c = t.colors
  const raised = variant === 'raised'
  return (
    <View
      style={[
        radius != null
          ? { borderRadius: radius }
          : setback(raised ? t.shape.popover : t.shape.card),
        {
          borderCurve: 'continuous',
          backgroundColor: variant === 'sunken' ? c.surfaceSunken : raised ? c.surfaceRaised : c.surface,
          padding: padding ?? undefined,
          borderWidth: t.rule.course,
          borderColor: variant === 'sunken' ? c.borderFaint : c.border,
        },
        /* Raised surfaces (menus, popovers) lift on the soft slate shadow. */
        raised ? t.shadow(2) : null,
        style,
      ]}
    >
      {children}
    </View>
  )
}

/* ---------------------------------------------------------
   Divider — a 1px course in `separator`. `inset` skips the
   leading gutter so it lines up under a list row's text
   rather than its avatar. Inside a card, use the WEFT DASH
   from ornaments instead; between list rows, the hairline
   belongs to ListRow.
   --------------------------------------------------------- */

export function Divider({ inset = 0, style, strong }: { inset?: number; style?: StyleProp<ViewStyle>; strong?: boolean }) {
  const t = useTheme()
  return (
    <View
      style={[
        {
          height: t.rule.course,
          backgroundColor: strong ? t.colors.border : t.colors.separator,
          marginStart: inset,
        },
        style,
      ]}
    />
  )
}

/** A thick band between sections — the settings screens use it instead of a
 *  hairline so groups read as separate cards without drawing eight borders. */
export function SectionGap({ height = 12 }: { height?: number }) {
  const t = useTheme()
  return <View style={{ height, backgroundColor: t.colors.bgSunken }} />
}

/* ---------------------------------------------------------
   Section — a titled group. The title carries the WARP RULE
   beneath it (the QELAT signature underline); `action` is
   the trailing "See all" affordance every rail needs.
   --------------------------------------------------------- */

export interface SectionProps {
  title?: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
  children?: React.ReactNode
  /** Screen-edge padding on the header only; the body stays full-bleed so
   *  horizontal rails can run to the edge. */
  headerPadding?: number
  style?: StyleProp<ViewStyle>
}

export function Section({
  title, subtitle, actionLabel, onAction, children, headerPadding, style,
}: SectionProps) {
  const t = useTheme()
  const px = headerPadding ?? t.layout.screenPadding
  return (
    <View style={style}>
      {title || actionLabel ? (
        <View style={{ paddingHorizontal: px, paddingTop: space.md2, paddingBottom: space.sm }}>
          <View style={styles.sectionHeader}>
            <View style={styles.flex}>
              {title ? <Text variant="title3" align="ui">{title}</Text> : null}
              {subtitle ? <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{subtitle}</Text> : null}
            </View>
            {actionLabel ? (
              <Touchable onPress={onAction} feedback="dim" style={styles.sectionAction}>
                <Text variant="subhead" tone="accent" align="ui">{actionLabel}</Text>
              </Touchable>
            ) : null}
          </View>
          {title ? <WarpRule style={{ marginTop: subtitle ? 8 : 6 }} /> : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/** The caps label above a settings group. Caps come from the caption
 *  variant itself — Latin-only, never Arabic script — so no transform here. */
export function GroupLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.xl, paddingBottom: space.sm }, style]}>
      <Text variant="caption" tone="muted" align="ui">
        {children}
      </Text>
    </View>
  )
}

/** Explanatory copy under a settings group — the "why this setting exists"
 *  line. Muted, small, generous line height. */
export function GroupFooter({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm, paddingBottom: space.xs }}>
      <Text variant="footnote" tone="muted" align="ui">{children}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Callout — an inline notice inside a screen. Not a toast:
   this one stays until the condition clears. Soft tone wash,
   setback 10/3, and a 2.5pt selvedge strip at the start edge
   in the tone's full hue. Copy stays in the tone's *Text
   role; error strings come from errorText(e) verbatim.
   --------------------------------------------------------- */

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'scholar'

export interface CalloutProps {
  tone?: CalloutTone
  icon?: IconName
  title?: string
  children?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  style?: StyleProp<ViewStyle>
}

export function Callout({
  tone = 'info', icon, title, children, actionLabel, onAction, onDismiss, style,
}: CalloutProps) {
  const t = useTheme()
  const c = t.colors
  const skin = {
    info: { bg: c.infoSoft, fg: c.infoText, bar: c.info, icon: 'info' as IconName },
    success: { bg: c.successSoft, fg: c.successText, bar: c.success, icon: 'success' as IconName },
    warning: { bg: c.warningSoft, fg: c.warningText, bar: c.warning, icon: 'warning' as IconName },
    danger: { bg: c.dangerSoft, fg: c.dangerText, bar: c.danger, icon: 'error' as IconName },
    scholar: { bg: c.scholarSoft, fg: c.scholarText, bar: c.scholar, icon: 'research' as IconName },
    neutral: { bg: c.surfaceSunken, fg: c.textSecondary, bar: c.borderStrong, icon: 'info' as IconName },
  }[tone]

  return (
    <View
      style={[
        /* buttonMd tier = the "popover-ish" 10/3 the spec names */
        setback(t.shape.buttonMd),
        {
          borderCurve: 'continuous',
          overflow: 'hidden', /* clips the selvedge to the setback corners */
          flexDirection: 'row',
          gap: space.sm2,
          padding: space.md,
          paddingStart: space.md2, /* breathing room past the selvedge */
          backgroundColor: skin.bg,
          alignItems: 'flex-start',
        },
        style,
      ]}
    >
      <Selvedge color={skin.bar} />
      <Icon name={icon ?? skin.icon} size={18} color={skin.fg} style={{ marginTop: space.xxs }} />
      <View style={styles.flex}>
        {title ? <Text variant="subhead" weight="700" color={skin.fg} align="ui">{title}</Text> : null}
        {typeof children === 'string'
          ? <Text variant="footnote" color={skin.fg} align="ui" style={title ? { marginTop: space.xxs } : undefined}>{children}</Text>
          : children}
        {actionLabel ? (
          <Touchable onPress={onAction} feedback="dim" style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
            <Text variant="subhead" weight="700" color={skin.fg} align="ui" underline>{actionLabel}</Text>
          </Touchable>
        ) : null}
      </View>
      {onDismiss ? (
        <Touchable onPress={onDismiss} feedback="dim" accessibilityLabel="Dismiss">
          <Icon name="close" size={16} color={skin.fg} />
        </Touchable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  sectionAction: { paddingVertical: space.xxs },
})
