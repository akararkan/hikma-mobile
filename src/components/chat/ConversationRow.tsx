/* =========================================================
   The 72pt inbox row.

   Three details here are contract, not decoration:

   1. `hasUnread && !unreadCount` renders a BARE DOT, not a
      zero. unreadCount is not maintained past 256 members, and
      `markedUnread` deliberately sets the flag with a zero
      count — a row that trusted the number alone would show a
      read-looking thread the user just flagged unread.
   2. A live typing signal REPLACES the preview. A disappearing
      message's text never reaches the rail, but that substitution
      happens at the SOURCE — the server writes the placeholder
      into `lastMessagePreview` itself, and ChatContext applies
      the identical rule to live-frame-derived previews — so the
      row renders `lastMessagePreview` as given.
   3. The presence dot is hidden entirely — not greyed —
      when the viewer hid their own last-seen. That switch is
      symmetric, so promising a signal we cannot receive would
      be a lie the layout tells.
   4. A finished call OUTRANKS the last message while nobody has
      said anything since. The server writes no message for a
      call, so the stamp comes from the device call log through
      ChatContext; the comparison is made here, per row, and
      reverses the instant the next message lands.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { usePresence, useTyping } from '@/context/RealtimeContext'
import { shareSnippet, splitShareBody } from '@/lib/shareLinks'
import { useTheme } from '@/theme/ThemeProvider'
import { layout, radius, space } from '@/theme/tokens'
import { Avatar, Icon, NumericText, Text, TouchableRow, VerifiedMark } from '@/ui'
import { rowTime, rowTimeAt, typingSentence, type Typer } from './format'
import type { UserCard } from './userDirectory'

/* Component geometry — the shapes this row draws, named here rather than
   buried as bare numbers in the stylesheet. They are not spacing, so they do
   not belong in the spacing scale; they are not shared, so they do not belong
   in `layout`.

   The unread counter is one of exactly two sanctioned pills in the app
   (DESIGN.md §9, the other being the LIVE badge), so its capsule reads from
   `radius.pill` rather than from half its own height. */
const AVATAR = 52
/** Tall enough to seat `micro` type; the row reserves this whether or not a
 *  count is shown, so a thread going read cannot shift the timestamp. */
const PILL_H = 20
const DOT = 10
const MEDALLION = 16
/** The medallion's cutout ring, drawn in the row's own background so the
 *  badge reads as punched out of the avatar rather than stuck on it. Not a
 *  `rule.*`: rules divide content, this one separates two fills. */
const MEDALLION_RING = 2

export interface ConversationRowProps {
  convo: any
  /** Who is typing — an OVERRIDE for callers that still thread the map from a
   *  parent. Left out, the row subscribes to its own conversation's key and a
   *  typing frame repaints this row alone. */
  typing?: Typer[]
  /** Same contract as `typing`: an override, else a per-peer subscription. */
  presence?: { status: string; lastSeenEpochMs: number | null } | null
  /** From the user directory — chat DTOs carry no avatar. */
  peerCard?: UserCard | null
  nameOf?: (userId: string) => string
  /** False when the viewer turned last-seen off; the dot disappears with it. */
  presenceVisible?: boolean
  myId?: string | null
  onPress: () => void
  /** Fires on finger-down — the inbox uses it to router.prefetch the thread
   *  so the push lands on a screen whose reads are already in flight. */
  onPressIn?: () => void
  onLongPress?: () => void
}

function ConversationRowInner({
  convo, typing, presence, peerCard, nameOf, presenceVisible = true, myId,
  onPress, onPressIn, onLongPress,
}: ConversationRowProps) {
  const t = useTheme()
  const c = t.colors

  /* The hooks always run (rules of hooks), the props win when given. Both read
     the same shell stores the old typingIn/presenceOf surfaced, so a caller on
     either path renders identically — the hook path just re-renders one row
     per frame instead of one screen. `presence` distinguishes null (looked up,
     offline peer / group) from undefined (not threaded — subscribe). */
  const liveTyping = useTyping(convo.id)
  const livePresence = usePresence(!convo.isGroup ? convo.peer?.id : null)
  const typers: Typer[] = typing ?? liveTyping
  const presenceEntry = presence === undefined ? livePresence : presence

  const unread = Number(convo.unreadCount) || 0
  const hasUnread = !!convo.hasUnread || unread > 0 || !!convo.markedUnread
  const muted = !!convo.muted

  const typingLine = typingSentence(typers, id => nameOf?.(id) || '', !!convo.isGroup)

  /* The last thing that happened here was a CALL. `_callAtMs` and
     `lastCallPreview` are stamped by ChatContext from the device call log;
     ties go to the call, since a call that ends in the same millisecond as a
     message arrives is the later event by every practical measure. */
  const callAtMs = Number(convo._callAtMs) || 0
  const msgAtMs = Number(convo._lastAtMs) || (convo.lastMessageAt ? Date.parse(convo.lastMessageAt) : 0)
  const showCall = !!convo.lastCallPreview && callAtMs > 0 && callAtMs >= msgAtMs

  const preview = (() => {
    if (typingLine) return typingLine
    if (showCall) return convo.lastCallPreview
    /* `lastMessagePreview` is already safe for disappearing messages: the
       server writes "🕓 Disappearing message" (or the media-kind label) into
       it at send time, and ChatContext's previewOf applies the same rule to
       live frames — masking again here would also hide the (server-shown)
       previews of messages sent BEFORE the timer was turned on. */
    let body = convo.lastMessagePreview || ''
    /* The server's previewOf answers '' for LOCATION, CONTACT and system
       rows — but a row that HAS a lastMessageId is not an empty thread, and
       greeting copy on it claims exactly that. Say something neutral. */
    if (!body) {
      if (convo.lastMessageId) return 'Message'
      return convo.isGroup ? 'No messages yet' : 'Say salam 👋'
    }
    /* A body that is one of our share links reads as the share, not as a raw
       short URL. Display-time only, so a live frame and a refetched row agree
       (both carry the same raw body underneath). */
    const shared = body.includes('://') ? splitShareBody(body) : null
    if (shared) body = shared.rest ? `${shareSnippet(shared.share.kind)} · ${shared.rest}` : shareSnippet(shared.share.kind)
    /* NOTE: ConversationResponse carries no sender for its last message, so
       `lastMessageSenderId` only exists on rows a live frame has touched. The
       prefix therefore appears where it is knowable and is silently absent
       otherwise — better than guessing and labelling someone else's message
       as yours. */
    const mine = myId && convo.lastMessageSenderId && String(convo.lastMessageSenderId) === String(myId)
    return mine ? `You: ${body}` : body
  })()

  return (
    <TouchableRow
      onPress={onPress}
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      style={[
        styles.row,
        { backgroundColor: convo.pinned ? c.surfaceSunken : c.bg },
      ]}
    >
      <View>
        <Avatar
          uri={convo.isGroup ? convo.avatarUrl : (peerCard?.profileImage ?? convo.peer?.profileImage ?? null)}
          name={convo.displayTitle}
          seed={convo.isGroup ? convo.id : (convo.peer?.id || convo.id)}
          size={AVATAR}
          square={!!convo.isGroup}
          /* Presence is a DM concept: a group has no single "online". */
          presence={
            !convo.isGroup && presenceVisible && presenceEntry
              ? (presenceEntry.status === 'online' ? 'online' : 'offline')
              : undefined
          }
        />
        {convo.isChannel ? (
          <View style={[styles.medallion, { backgroundColor: c.accent, borderColor: c.bg }]}>
            <Icon name="channels" size={9} color={c.textOnAccent} filled />
          </View>
        ) : null}
      </View>

      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text
            variant="body"
            weight={hasUnread ? '700' : '600'}
            numberOfLines={1}
            style={styles.flexShrink}
          >
            {convo.displayTitle}
          </Text>
          {!convo.isGroup && (peerCard?.verified || convo.peer?.verified) ? <VerifiedMark size={13} /> : null}
          {muted ? <Icon name="mutedBell" size={13} color={c.textFaint} /> : null}
          {convo.pinned ? <Icon name="pin" size={12} color={c.textFaint} filled /> : null}
        </View>

        <Text
          variant="footnote"
          /* A missed call is the one preview that is also a problem — it reads
             in danger ink, the same word the /calls row uses for it. */
          tone={typingLine ? 'accent' : (showCall && convo.lastCallMissed) ? 'danger' : 'muted'}
          italic={!!typingLine}
          numberOfLines={1}
          style={styles.previewGap}
        >
          {preview}
        </Text>
      </View>

      <View style={styles.right}>
        <Text variant="caption" tone={hasUnread && !muted ? 'accent' : 'faint'} align="ui">
          {showCall ? rowTimeAt(callAtMs) : rowTime(convo.lastMessageAt)}
        </Text>
        {unread > 0 ? (
          <View style={[styles.pill, { backgroundColor: muted ? c.textFaint : c.accent }]}>
            <NumericText variant="micro" color={c.textOnAccent} align="center">
              {unread > 99 ? '99+' : String(unread)}
            </NumericText>
          </View>
        ) : hasUnread ? (
          /* The count is unavailable (large group, or a manual mark-unread) but
             the row IS unread — say so with the one signal that is always true. */
          <View style={[styles.dot, { backgroundColor: muted ? c.textFaint : c.accent }]} />
        ) : (
          <View style={styles.pillSpacer} />
        )}
      </View>
    </TouchableRow>
  )
}

/* The inbox re-renders on every SSE frame; without this a hundred untouched
   rows re-render for one arriving message. */
export const ConversationRow = React.memo(ConversationRowInner)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: layout.rowHeight,
  },
  middle: { flex: 1, justifyContent: 'center' },
  /* 5 → 6. The one stray in this file: an odd value on a 2pt grid, corrected
     by 1pt so the gap between the title and its status marks matches every
     other icon-to-text gap in the app. */
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  flexShrink: { flexShrink: 1 },
  previewGap: { marginTop: space.xxs },
  /* `minWidth: tapTarget` is not a hit area — the row is the target — it is
     what keeps every timestamp in the list on one vertical rule regardless of
     whether the row below it carries a two-digit count. */
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xs2,
    minWidth: layout.tapTarget,
  },
  pill: {
    minWidth: PILL_H,
    height: PILL_H,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
  /* Reserves the pill's line whether or not there is a pill. */
  pillSpacer: { height: PILL_H },
  medallion: {
    position: 'absolute',
    end: -space.xxs,
    bottom: -space.xxs,
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: radius.pill,
    borderWidth: MEDALLION_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
