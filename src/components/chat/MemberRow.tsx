/* =========================================================
   The roster row.

   The role chips carry real weight in a group: an admin badge
   is the difference between "why can't I remove this person"
   and "of course I can't". Owner gets the scholar gold because
   it is the app's one other "this is structural" colour;
   admins get the brand.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { usePresence } from '@/context/RealtimeContext'
import { Avatar, Chip, Text, TouchableRow, VerifiedMark } from '@/ui'
import type { UserCard } from './userDirectory'
import { space } from '@/theme/tokens'

export interface MemberRowProps {
  member: any
  card?: UserCard | null
  presenceVisible?: boolean
  isMe?: boolean
  actionable?: boolean
  trailing?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
}

function MemberRowInner({
  member, card, presenceVisible = true, isMe, trailing, onPress, onLongPress,
}: MemberRowProps) {
  /* Per-key: a presence flip repaints this one row, not the whole roster. */
  const presence = usePresence(member.userId)
  const role = String(member.role || 'MEMBER').toUpperCase()
  const restricted = String(member.status || '') === 'RESTRICTED'

  return (
    <TouchableRow onPress={onPress} onLongPress={onLongPress} style={styles.row}>
      <Avatar
        uri={card?.profileImage ?? member._author?.profileImage ?? null}
        name={member.fullName}
        seed={member.userId}
        size={44}
        presence={presenceVisible && presence ? (presence.status === 'online' ? 'online' : 'offline') : undefined}
      />
      <View style={[styles.body, restricted ? { opacity: 0.6 } : null]}>
        <View style={styles.nameRow}>
          <Text variant="subhead" weight="600" numberOfLines={1} style={styles.shrink}>{member.fullName}</Text>
          {card?.verified ? <VerifiedMark size={12} /> : null}
          {isMe ? <Chip label="You" size="sm" tone="neutral" /> : null}
        </View>
        {member.handle ? (
          <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{member.handle}</Text>
        ) : null}
      </View>

      {restricted ? <Chip label="Restricted" size="sm" tone="neutral" /> : null}
      {role === 'OWNER' ? <Chip label="Owner" size="sm" tone="scholar" />
        : role === 'ADMIN' ? <Chip label="Admin" size="sm" tone="accent" /> : null}
      {trailing}
    </TouchableRow>
  )
}

export const MemberRow = React.memo(MemberRowInner)

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 64 },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
})
