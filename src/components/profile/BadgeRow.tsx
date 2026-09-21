/* =========================================================
   BadgeRow — the trust marks beside a name.

   `user.badges` arrives PRE-COMPUTED and priority-sorted from
   the server, derived from the role (SCHOLAR → VERIFIED_SCHOLAR,
   RESEARCHER → VERIFIED_RESEARCHER, nothing otherwise). There is
   no verification workflow and there are no tiers, so nothing
   here derives, invents or reorders anything — it renders the
   array in the order it came.

   Two shapes for two places: inline glyphs next to a name in a
   dense row, labelled chips in a profile header.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Chip, Icon, RoleBadge, type ChipTone, type IconName } from '@/ui'

export interface UserBadge {
  type?: string
  label?: string
  colorKey?: string
  icon?: string
  priority?: number
}

export interface BadgeRowProps {
  badges?: UserBadge[] | null
  role?: string | null
  size?: 'sm' | 'md'
  /** Show the badge labels as chips instead of bare glyphs. */
  labels?: boolean
  max?: number
  style?: StyleProp<ViewStyle>
}

/* The server's colour keys are words, not roles, so they map here rather than
   at every call site. Anything unrecognised falls through to the brand blue —
   a badge with an unknown colour is still a badge. */
function toneOf(badge: UserBadge): ChipTone {
  const key = String(badge.colorKey || '').toUpperCase()
  if (key.includes('GOLD') || key.includes('AMBER') || key.includes('SCHOLAR')) return 'scholar'
  if (key.includes('GREEN') || key.includes('SUCCESS')) return 'success'
  if (key.includes('RED') || key.includes('DANGER')) return 'danger'
  if (key.includes('ORANGE') || key.includes('WARN')) return 'warning'
  if (String(badge.type || '').toUpperCase().includes('SCHOLAR')) return 'scholar'
  return 'accent'
}

const ICONS: Record<string, IconName> = {
  scholar: 'scholar', school: 'scholar', graduation: 'scholar',
  verified: 'verified', check: 'verified', badge: 'verified',
  research: 'research', document: 'research', book: 'book',
  shield: 'shield', star: 'star', crown: 'crown',
}

function iconOf(badge: UserBadge): IconName {
  const raw = String(badge.icon || '').toLowerCase()
  for (const key of Object.keys(ICONS)) if (raw.includes(key)) return ICONS[key]
  return String(badge.type || '').toUpperCase().includes('SCHOLAR') ? 'scholar' : 'verified'
}

export function BadgeRow({ badges, role, size = 'sm', labels = false, max = 3, style }: BadgeRowProps) {
  const t = useTheme()
  const list = (badges || []).slice(0, max)

  /* No badges is the ordinary case — only an admin gets a pill instead, so the
     row does not silently claim a member is unmarked-but-special. */
  if (!list.length) {
    const r = String(role || '').toUpperCase()
    if (r !== 'ADMIN' && r !== 'SUPER_ADMIN') return null
    return <View style={style}><RoleBadge role={r} /></View>
  }

  if (labels) {
    return (
      <View style={[styles.row, { gap: space.xs2 }, style]}>
        {list.map((b, i) => (
          <Chip key={b.type ?? i} label={b.label || 'Verified'} icon={iconOf(b)} tone={toneOf(b)} size="sm" />
        ))}
      </View>
    )
  }

  const px = size === 'md' ? 16 : 14
  return (
    <View style={[styles.row, { gap: space.xs }, style]}>
      {list.map((b, i) => {
        const tone = toneOf(b)
        const color =
          tone === 'scholar' ? t.colors.scholar
            : tone === 'success' ? t.colors.success
              : tone === 'danger' ? t.colors.danger
                : tone === 'warning' ? t.colors.warning
                  : t.colors.accent
        return (
          <View key={b.type ?? i} accessibilityLabel={b.label} accessible>
            <Icon name={iconOf(b)} size={px} color={color} filled />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
})
