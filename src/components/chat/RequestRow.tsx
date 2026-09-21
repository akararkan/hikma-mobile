/* =========================================================
   The message-request card.

   The `{n} of 3 messages` chip is the whole point of the
   screen: a stranger gets three messages before the platform
   stops them, so the number tells the recipient how much
   pressure is behind the request without opening it.

   Decline is silent by contract — the requester is never told —
   so the card must not imply a reply is being sent.

   Memoized: these are FlashList rows on a screen that repaints
   on every `request.new` frame and on every first-message
   snippet that lands.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Button, Chip, Icon, Text, Touchable, VerifiedMark } from '@/ui'
import { snippetOf } from './format'
import type { UserCard } from './userDirectory'

export interface RequestRowProps {
  request: any
  card?: UserCard | null
  firstMessage?: any
  busy?: boolean
  disabled?: boolean
  showActions?: boolean
  onPress: () => void
  onAccept: () => void
  onDecline: () => void
  onOverflow: () => void
}

export const RequestRow = React.memo(function RequestRow({
  request, card, firstMessage, busy, disabled, showActions = true,
  onPress, onAccept, onDecline, onOverflow,
}: RequestRowProps) {
  const t = useTheme()
  const c = t.colors
  const who = request.requester

  return (
    <Touchable
      onPress={onPress}
      feedback="tint"
      noAutoHitSlop
      style={[styles.card, { borderBottomColor: c.separator }]}
    >
      <View style={styles.top}>
        <Avatar uri={card?.profileImage ?? who?.profileImage ?? null} name={who?.full} seed={request.requesterId} size={48} />
        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text variant="subhead" weight="600" numberOfLines={1} style={styles.shrink}>{who?.full || 'Member'}</Text>
            {card?.verified ? <VerifiedMark size={12} /> : null}
            {who?.handle ? <Text variant="footnote" tone="muted" numberOfLines={1}>@{who.handle}</Text> : null}
          </View>
          <Text variant="footnote" tone="muted" align="auto" numberOfLines={2} style={{ marginTop: space.xs }}>
            {firstMessage ? snippetOf(firstMessage) : ' '}
          </Text>
        </View>
        <Text variant="caption" tone="faint" align="ui">{request.time}</Text>
      </View>

      {request.messageCount ? (
        <Chip
          label={`${Math.min(3, request.messageCount)} of 3 messages`}
          size="sm"
          tone="neutral"
          style={styles.countChip}
        />
      ) : null}

      {showActions ? (
        <View style={styles.actions}>
          <Button label="Accept" onPress={onAccept} size="sm" variant="primary" loading={busy} disabled={disabled} style={styles.flex} />
          <Button label="Decline" onPress={onDecline} size="sm" variant="secondary" disabled={disabled || busy} style={styles.flex} />
          <Touchable
            onPress={onOverflow}
            feedback="scale"
            disabled={disabled || busy}
            accessibilityLabel="More options"
            style={[styles.overflow, { borderColor: c.borderStrong }]}
          >
            <Icon name="moreVertical" size={16} color={c.textSecondary} />
          </Touchable>
        </View>
      ) : null}
    </Touchable>
  )
})

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.lg, paddingVertical: space.md2, gap: space.sm2, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
  countChip: { marginStart: 60 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginStart: 60 },
  flex: { flex: 1 },
  /* Icon-only, so the circle is sanctioned (DESIGN.md §8.9 exempts round
     icon buttons; the ban is on text-bearing lozenges). */
  overflow: {
    width: 34, height: 34, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
})
