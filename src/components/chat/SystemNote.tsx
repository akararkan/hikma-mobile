/* =========================================================
   The centred chips: system events, day dividers, and the
   unread rule.

   A SYSTEM message is the only row in the log with no sender
   bubble, and its text is not on the wire — the server sends an
   ENUM plus the actor's id, and the client writes the sentence.
   Names come from the resolved user directory, so a system row
   about someone whose profile has not loaded yet says
   "Someone" rather than a raw UUID.

   All three are memoized and all three are chip-setback plates,
   not lozenges (DESIGN.md §8.1): they ride in the thread's
   recycle pool beside the bubbles, so a re-render the day rows
   did not cause must not repaint them.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Text } from '@/ui'
import { dayLabel } from './format'

const EVENT_COPY: Record<string, (who: string, body: string) => string> = {
  GROUP_CREATED: who => `${who} created this group`,
  MEMBER_ADDED: (who, body) => (body ? `${who} added ${body}` : `${who} joined`),
  MEMBER_REMOVED: (who, body) => (body ? `${who} removed ${body}` : `${who} was removed`),
  MEMBER_LEFT: who => `${who} left`,
  MEMBER_JOINED: who => `${who} joined`,
  ROLE_CHANGED: (who, body) => body || `${who} changed a member's role`,
  OWNERSHIP_TRANSFERRED: (who, body) => body || `${who} transferred ownership`,
  TITLE_CHANGED: (who, body) => (body ? `${who} changed the group name to “${body}”` : `${who} changed the group name`),
  DESCRIPTION_CHANGED: who => `${who} changed the group description`,
  AVATAR_CHANGED: who => `${who} changed the group photo`,
  PINNED: who => `${who} pinned a message`,
  UNPINNED: who => `${who} unpinned a message`,
  DISAPPEARING_CHANGED: (who, body) => body || `${who} changed the disappearing timer`,
  REQUEST_ACCEPTED: () => 'Message request accepted',
}

export function systemText(message: any, nameOf: (id: string) => string, myId?: string | null): string {
  const event = String(message?.systemEvent || '')
  const actor = message?.senderId
  const who = actor && myId && String(actor) === String(myId) ? 'You' : (nameOf(actor) || 'Someone')
  const fn = EVENT_COPY[event]
  /* Unknown events are new server behaviour, not corruption: show the body the
     server sent rather than swallowing the row. */
  return fn ? fn(who, message?.body || '') : (message?.body || event.replace(/_/g, ' ').toLowerCase())
}

export const SystemNote = React.memo(function SystemNote({
  message, nameOf, myId,
}: { message: any; nameOf: (id: string) => string; myId?: string | null }) {
  const t = useTheme()
  return (
    <View style={styles.center}>
      <View style={[styles.chip, { backgroundColor: t.colors.bgSunken }]}>
        {/* Sentence case at 12.5 (web .ch-system span) — a notice is chrome
            speaking quietly, not a label to shout. */}
        <Text variant="footnote" tone="muted" align="center">{systemText(message, nameOf, myId)}</Text>
      </View>
    </View>
  )
})

export const DayDivider = React.memo(function DayDivider({ iso }: { iso: string }) {
  const t = useTheme()
  return (
    <View style={styles.center}>
      <View style={[styles.chip, styles.dayChip, { backgroundColor: t.colors.bgSunken }]}>
        {/* The web's day pill dropped its uppercase and its rules on purpose
            (ika-messages-theme §2): a quiet floating date in sentence case.
            footnote + weight, not the caps variant. */}
        <Text variant="footnote" weight="600" tone="muted" align="center">{dayLabel(iso)}</Text>
      </View>
    </View>
  )
})

export const UnreadDivider = React.memo(function UnreadDivider() {
  const t = useTheme()
  return (
    <View style={styles.unreadRow}>
      {/* The unread rule marks a POSITION, so unlike the day pill it keeps its
          lines and its wash. The lines are STONE, not Sky: §2 says lines are
          stone and §10 forbids Sky on a light ground, and the reason bites
          here — Sky on the light wallpaper is 1.3:1, so the rules did not
          render at arm's length and the marker read as a chip floating in the
          middle of nowhere instead of a line drawn across the thread. The
          scholar wash and its ink stay; they are correct. */}
      <View style={[styles.rule, { backgroundColor: t.colors.borderStrong }]} />
      <View style={[styles.chip, { backgroundColor: t.colors.scholarSoft }]}>
        <Text variant="footnote" weight="600" color={t.colors.scholarText} align="center">Unread messages</Text>
      </View>
      <View style={[styles.rule, { backgroundColor: t.colors.borderStrong }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: space.xs2, paddingHorizontal: space.xxl },
  chip: {
    paddingHorizontal: space.md, paddingVertical: space.xs, maxWidth: '90%',
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  /* Web .ch-day span: 4px 14px. */
  dayChip: { paddingHorizontal: space.md2 },
  unreadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  rule: { flex: 1, height: 1 },
})
