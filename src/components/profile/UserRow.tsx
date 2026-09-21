/* =========================================================
   UserRow — the person row shared by followers, following,
   suggestions, search and the relationship lists.

   One component so a person looks the same everywhere: 48pt
   avatar, name with its badges inline, a handle-plus-meta
   second line, and a right slot the caller fills with whatever
   control that surface needs.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Skeleton, Text, TouchableRow } from '@/ui'
import { BadgeRow, type UserBadge } from './BadgeRow'

export interface RowUser {
  id: string
  full?: string
  handle?: string
  profileImage?: string | null
  badges?: UserBadge[] | null
  role?: string | null
  bio?: string | null
  [k: string]: any
}

export interface UserRowProps {
  user: RowUser
  /** Replaces the '@handle' line entirely. */
  subtitle?: string | null
  /** A third line — a suggestion reason, a mutual-follows count. */
  meta?: string | null
  right?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  avatarSize?: number
  style?: StyleProp<ViewStyle>
}

/* Memoized: the row is cheap on its own, but it is the cell every people list
   recycles, and the callers that pass no `right` control (suggestions,
   pickers, mention lists) then skip the whole subtree on a parent render. */
export const UserRow = React.memo(function UserRow({
  user, subtitle, meta, right, onPress, onLongPress, avatarSize = 48, style,
}: UserRowProps) {
  const t = useTheme()

  const body = (
    <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, paddingVertical: space.sm2, gap: space.md }, style]}>
      <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={avatarSize} />

      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{user.full || 'Member'}</Text>
          <BadgeRow badges={user.badges} role={user.role} />
        </View>
        {subtitle !== null ? (
          <Text variant="subhead" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
            {subtitle ?? `@${user.handle || 'member'}`}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="footnote" tone="faint" numberOfLines={1} style={{ marginTop: space.xxs }}>{meta}</Text>
        ) : null}
      </View>

      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )

  if (!onPress && !onLongPress) return body
  return <TouchableRow onPress={onPress} onLongPress={onLongPress} accessibilityRole="button">{body}</TouchableRow>
})

/** The row's own skeleton — same geometry as the real thing, so the list does
 *  not reflow the moment it loads. */
export function UserRowSkeletonList({ count = 8 }: { count?: number }) {
  const t = useTheme()
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding, paddingVertical: space.sm2, gap: space.md }]}>
          <Skeleton circle width={48} height={48} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="44%" height={12} />
            <Skeleton width="28%" height={10} />
          </View>
          {/* No radius override: Skeleton's own default is the setback, and a
              pill here would promise a control shape the app does not use. */}
          <Skeleton width={92} height={32} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  right: { minWidth: 0 },
})
