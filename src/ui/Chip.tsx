/* =========================================================
   Chips, badges, pills and the rest of the small labels.

   QELAT (DESIGN.md §6 "Chip/Badge/marks"): chips are SETBACK
   chips (shape.chip 8/3) — NOT pills. The only pills in the
   app are the two sanctioned ones below: the unread Badge and
   the LIVE tag. Selection is announced by the DIAMOND TURN
   (§7.1): a 4pt rotated square before the label that turns
   45°→0 on select — the shared `SelectionDiamond` ornament,
   the same mark the chat reaction chips wear — plus the
   selection haptic the Touchable already fires. Press is
   letterpress (1pt translateY), never a scale: plates do not
   shrink, and the seat comes from Touchable's own `scale`
   feedback rather than a second shared value here.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { inkOn } from '@/theme/colors'
import { Text, NumericText } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable } from './Touchable'
import { SelectionDiamond } from './ornaments'

/* The chip setback is a static token read, so it is resolved once rather
   than allocating four corner radii per chip per render — filter rails put
   a dozen of these under a list that renders constantly. */
const CHIP_SETBACK = setback(shape.chip)

export type ChipTone = 'neutral' | 'accent' | 'scholar' | 'success' | 'warning' | 'danger' | 'overlay'

export interface ChipProps {
  label: string
  icon?: IconName
  tone?: ChipTone
  selected?: boolean
  onPress?: () => void
  onRemove?: () => void
  size?: 'sm' | 'md'
  style?: StyleProp<ViewStyle>
  /** Spoken name when the drawn label is not self-explanatory ("+3"). */
  accessibilityLabel?: string
}

export function Chip({ label, icon, tone = 'neutral', selected, onPress, onRemove, size = 'md', style, accessibilityLabel }: ChipProps) {
  const t = useTheme()
  const c = t.colors
  const h = size === 'sm' ? 26 : 34

  const skin = (() => {
    if (selected) {
      /* Selected = the tone's soft wash + a control-weight border in the tone
         hue + the tone's text role. Neutral chips select into the accent
         triple; scholar filter chips take the scholar triple, which is Oxford
         blue at seniority depth (soft/hue/text), not a second hue: gold is
         retired — DESIGN.md §3 — and scholarly emphasis is DARKER BLUE. */
      switch (tone) {
        case 'scholar': return { bg: c.scholarSoft, fg: c.scholarText, border: c.scholar }
        case 'success': return { bg: c.successSoft, fg: c.successText, border: c.success }
        case 'warning': return { bg: c.warningSoft, fg: c.warningText, border: c.warning }
        case 'danger': return { bg: c.dangerSoft, fg: c.dangerText, border: c.danger }
        case 'overlay': return { bg: c.overlayChip, fg: c.overlayText, border: c.overlayText }
        default: return { bg: c.accentSoft, fg: c.accentText, border: c.accent }
      }
    }
    switch (tone) {
      case 'accent': return { bg: c.accentSoft, fg: c.accentText, border: 'transparent' }
      case 'scholar': return { bg: c.scholarSoft, fg: c.scholarText, border: 'transparent' }
      case 'success': return { bg: c.successSoft, fg: c.successText, border: 'transparent' }
      case 'warning': return { bg: c.warningSoft, fg: c.warningText, border: 'transparent' }
      case 'danger': return { bg: c.dangerSoft, fg: c.dangerText, border: 'transparent' }
      case 'overlay': return { bg: c.overlayChip, fg: c.overlayText, border: 'transparent' }
      /* Resting chip: surface + a full course border — tinted fills mark
         state, not surface. */
      default: return { bg: c.surface, fg: c.textSecondary, border: c.border }
    }
  })()

  const inner = (
    <>
      {/* THE DIAMOND TURN (§7.1) — mounted on select, so the shared ornament's
          default `selected` plays the 45°→0 entrance. 4pt is the chip's
          geometry; do not let it drift towards the 6pt radio mark. */}
      {selected ? <SelectionDiamond color={skin.border} size={4} /> : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 12 : 14} color={skin.fg} /> : null}
      <Text variant={size === 'sm' ? 'footnote' : 'subhead'} color={skin.fg} numberOfLines={1}>
        {label}
      </Text>
      {onRemove ? (
        /* BOUNDED slop. Left to auto-measure, an 11–13pt glyph asks for
           ~17pt in every direction, and iOS honours hit-slop OUTSIDE the
           parent's bounds — so the X overhung the 6pt gap these chips are
           laid out with (chat/forward.tsx, research/TagChipInput.tsx) and
           tapping the next chip, or the tag field beside the last one,
           removed the previous entry. 6pt keeps the target comfortable and
           inside the gutter; passing hitSlop at all also switches the
           auto-measure off. */
        <Touchable
          onPress={onRemove}
          feedback="dim"
          hitSlop={6}
          accessibilityLabel={`Remove ${label}`}
          style={{ marginStart: space.xxs }}
        >
          <Icon name="close" size={size === 'sm' ? 11 : 13} color={skin.fg} />
        </Touchable>
      ) : null}
    </>
  )

  const box: StyleProp<ViewStyle> = [
    styles.chip,
    CHIP_SETBACK,
    {
      height: h,
      paddingHorizontal: size === 'sm' ? 9 : 15,
      backgroundColor: skin.bg,
      /* Border is always drawn so the label never shifts between states:
         transparent course on tonal washes, control weight when selected. */
      borderWidth: selected ? t.rule.control : t.rule.course,
      borderColor: skin.border,
    },
    style,
  ]

  if (!onPress) return <View style={box}>{inner}</View>
  return (
    /* LETTERPRESS — `scale` is Touchable's plate response and it does not
       scale: it seats the chip 1pt at motion.instant on the masonry curve
       (§6 Touchable). The chip used to own a second shared value doing
       exactly that; the primitive's is the same animation for free. */
    <Touchable
      onPress={onPress}
      feedback="scale"
      haptic="select"
      style={box}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      {inner}
    </Touchable>
  )
}

/** A horizontally scrolling chip rail — filter bars, tag lists, topic pickers. */
export function ChipRail({
  children, style, contentPadding,
}: { children: React.ReactNode; style?: StyleProp<ViewStyle>; contentPadding?: number }) {
  const t = useTheme()
  /* Held stable: a fresh contentContainerStyle object every render makes the
     ScrollView re-measure its content on any parent render, and filter rails
     sit under lists that render constantly. */
  const pad = contentPadding ?? t.layout.screenPadding
  const content = React.useMemo(
    () => ({
      gap: space.sm,   // padded by the screen inset so chips glide off-screen
      paddingHorizontal: pad,
      alignItems: 'center' as const,
    }),
    [pad],
  )
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={content}
    >
      {children}
    </ScrollView>
  )
}

/* ---------------------------------------------------------
   Badge — a count. Distinct from Chip: no label, no press,
   sits on top of something else. Sanctioned pill #1 (§6):
   tone plate, micro tabular ink, 2px `bg` ring so it reads
   against whatever it overlaps.
   --------------------------------------------------------- */

export function Badge({
  count, dot = false, tone = 'danger', style,
}: { count?: number | null; dot?: boolean; tone?: 'danger' | 'accent' | 'success'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const c = t.colors
  const bg = tone === 'accent' ? c.accent : tone === 'success' ? c.success : c.danger
  /* On-plate ink: danger/accent have palette roles (recolor() recomputes
     textOnAccent — never hardcode it); success takes the luminance rule. */
  const ink = tone === 'accent' ? c.textOnAccent : tone === 'success' ? inkOn(bg) : c.textOnDanger
  if (dot) return <View style={[{ width: 9, height: 9, borderRadius: t.shape.pill, backgroundColor: bg }, style]} />
  if (!count) return null
  return (
    <View
      style={[
        {
          minWidth: 20,
          height: 20,
          borderRadius: t.shape.pill,
          paddingHorizontal: space.xs2,
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: c.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <NumericText variant="micro" color={ink} align="center">{count > 99 ? '99+' : count}</NumericText>
    </View>
  )
}

/* ---------------------------------------------------------
   VerifiedMark / RoleBadge — the trust signals beside a name.
   Kept here so a scholar badge is never rendered two ways.
   --------------------------------------------------------- */

/* The two seals (DESIGN.md §6): standard verify = circular seal in the link
   blue; scholar = the same seal in the deeper scholar blue (no gilt — §10 #3
   forbids gold anywhere). SENIORITY OUTRANKS VERIFICATION: a scholar wears
   the scholar seal and never both, and call sites render exactly one — one
   seal per name. These stay font glyphs (not SVG)
   because they sit inside list rows; the drawn octagonal scholar plate
   belongs to Avatar, outside lists. */
export function VerifiedMark({ size = 14 }: { size?: number }) {
  const t = useTheme()
  return <Icon name="verified" size={size} color={t.colors.link} filled />
}

export function ScholarMark({ size = 14 }: { size?: number }) {
  const t = useTheme()
  return <Icon name="scholar" size={size} color={t.colors.scholar} filled />
}

/** Platform role → a small chip. Only shown for elevated roles; a plain
 *  member gets nothing, which is the point. */
export function RoleBadge({ role }: { role?: string | null }) {
  const r = String(role || '').toUpperCase()
  if (!r || r === 'USER' || r === 'MEMBER') return null
  const label =
    r === 'SUPER_ADMIN' ? 'Super admin'
      : r === 'ADMIN' ? 'Admin'
        : r === 'MODERATOR' ? 'Moderator'
          : r === 'ANALYST' ? 'Analyst'
            : r === 'SCHOLAR' ? 'Scholar'
              : r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, ' ')
  const tone: ChipTone = r === 'SCHOLAR' ? 'scholar' : r === 'MODERATOR' || r === 'ANALYST' ? 'accent' : 'danger'
  return <Chip label={label} tone={tone} size="sm" />
}

/** The LIVE tag — sanctioned pill #2. `liveDot` plate with pure #FFFFFF ink:
 *  the ONE place pure white is allowed on a plate (4.90:1 — the warm whites
 *  fail there), and the count stays full-white for the same reason. */
export function LiveTag({ viewers, style }: { viewers?: number | null; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View
      style={[
        styles.chip,
        { height: 22, paddingHorizontal: space.sm, borderRadius: t.shape.pill, backgroundColor: t.colors.liveDot, gap: space.xs2 },
        style,
      ]}
    >
      <View style={{ width: 5, height: 5, borderRadius: t.shape.pill, backgroundColor: '#FFFFFF' }} />
      <Text variant="micro" color="#FFFFFF">LIVE</Text>
      {viewers != null ? <NumericText variant="micro" color="#FFFFFF">{formatCount(viewers)}</NumericText> : null}
    </View>
  )
}

/** Compact count formatting — 1.2K, 3.4M. Used by every counter in the app. */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`
  if (v < 10_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(v / 1_000_000)}M`
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    alignSelf: 'flex-start',
    /* iOS smooths the setback corners; a plain no-op elsewhere. */
    borderCurve: 'continuous',
  },
})
