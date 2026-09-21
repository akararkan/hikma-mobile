/* =========================================================
   The person row shared by /subscribers, /admins, /requests and
   /admins/add.

   MemberResponse, ChannelAdminResponse and JoinRequestResponse
   all carry a username and no avatar URL, so `authorFrom` fills
   `profileImage: null` and every row in this domain lands on the
   initials disc. Passing `uri` here would be a lie that renders
   as a grey box.

   React.memo'd: every one of those screens is a FlashList and
   re-renders on presence frames, filter typing and tab flips.
   Callers pass scalars (`presence`, `subtitle`, `dimmed`) rather
   than the collections they came from, which is what lets the
   comparison actually skip a row.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, Icon, Text, Touchable, TouchableRow } from '@/ui'

export interface MemberRowProps {
  /** memberFrom / adminFrom / joinRequestFrom — all carry userId + handle. */
  member: any
  /** 'online' paints the dot; anything else leaves it off. */
  presence?: string | null
  /** Second line. Defaults to '@handle'. */
  subtitle?: string
  showRolePill?: boolean
  /** A right-hand cluster: buttons, a checkbox, a status pill. */
  trailing?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  onMenu?: () => void
  disabled?: boolean
  dimmed?: boolean
}

export const MemberRow = React.memo(function MemberRow({
  member, presence, subtitle, showRolePill = true, trailing,
  onPress, onLongPress, onMenu, disabled, dimmed,
}: MemberRowProps) {
  const t = useTheme()
  const c = t.colors
  const role = String(member?.role || '').toUpperCase()
  const restricted = member?.status && member.status !== 'ACTIVE'
  const name = member?.fullName || member?._author?.full || member?.username || 'Member'
  const title = member?.customTitle || ''

  const body = (
    <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, opacity: dimmed ? 0.4 : 1 }]}>
      <Avatar
        name={name}
        seed={member?.userId}
        size={40}
        presence={presence === 'online' ? 'online' : undefined}
      />
      <View style={styles.flex}>
        <View style={styles.line}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{name}</Text>
          {showRolePill && role === 'OWNER' ? <Icon name="crown" size={13} color={c.scholar} filled /> : null}
          {showRolePill && role === 'OWNER' ? <Chip label="Owner" tone="scholar" size="sm" /> : null}
          {showRolePill && role === 'ADMIN' ? <Chip label="Admin" tone="accent" size="sm" /> : null}
          {restricted ? <Chip label="Restricted" tone="warning" size="sm" /> : null}
        </View>
        {title ? (
          <View style={{ marginTop: space.xs, alignSelf: 'flex-start' }}>
            <Chip label={title} tone="accent" size="sm" />
          </View>
        ) : (
          <Text variant="subhead" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
            {subtitle ?? (member?.handle ? `@${member.handle}` : '')}
          </Text>
        )}
      </View>
      {trailing}
      {onMenu ? (
        <Touchable onPress={onMenu} feedback="dim" accessibilityLabel="More actions" style={styles.menuBtn}>
          <Icon name="more" size={19} color={c.textMuted} />
        </Touchable>
      ) : null}
    </View>
  )

  if (!onPress && !onLongPress) return body
  return (
    <TouchableRow onPress={onPress} onLongPress={onLongPress} disabled={disabled}>
      {body}
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm2, minHeight: 60 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  menuBtn: { padding: space.xs2 },
})
