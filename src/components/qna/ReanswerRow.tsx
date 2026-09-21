/* =========================================================
   A depth-1 reply.

   Never an accept control and never a reply count: replyCount
   is always 0 on a reanswer, and the server answers 400
   REANSWER_NOT_ACCEPTABLE to an accept on one.

   "Replying to @X" only appears when `replyToUserId` differs
   from the thread root's author — the server hoists a reply-to-
   a-reply into a sibling and keeps the real target here, which
   is the only thing that makes a flat list readable.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, IconButton, RoleBadge, Text, Touchable } from '@/ui'
import { LikeButton } from './buttons'
import { InlineMedia, LinkChips } from './AnswerMedia'
import { VoiceNotePlayer } from './VoiceNotePlayer'
import type { AnswerView } from './types'

export interface ReanswerRowProps {
  reply: AnswerView
  rootAuthorId: string
  /** Resolved by the caller from the loaded rows: the wire carries only an id. */
  replyToHandle?: string | null
  canManage: boolean
  canReply: boolean
  likeCooldown?: number
  /** Full-bleed on the thread page; inset behind a rail inside a card. */
  variant?: 'inset' | 'page'
  highlighted?: boolean
  onLike: (next: boolean) => void
  onReply: () => void
  onOverflow: () => void
  onAuthorPress: () => void
  onOpenLink: (url: string) => void
  onReplyToPress?: () => void
}

function ReanswerRowBase({
  reply, rootAuthorId, replyToHandle, canManage, canReply, likeCooldown = 0,
  variant = 'inset', highlighted, onLike, onReply, onOverflow, onAuthorPress, onOpenLink, onReplyToPress,
}: ReanswerRowProps) {
  const t = useTheme()
  const c = t.colors
  const a = reply._author
  const page = variant === 'page'
  const showReplyTo = !!reply.replyToUserId && reply.replyToUserId !== rootAuthorId

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(180))}
      style={[
        page
          ? { paddingHorizontal: t.layout.screenPadding, paddingVertical: space.md2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator }
          : { paddingVertical: space.sm2 },
        highlighted ? { backgroundColor: c.accentSofter } : null,
      ]}
    >
      <View style={styles.row}>
        <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={page ? 32 : 26} onPress={onAuthorPress} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Touchable onPress={onAuthorPress} feedback="dim" noAutoHitSlop>
              <Text variant="footnote" weight="600" numberOfLines={1} align="ui">{a.full}</Text>
            </Touchable>
            {page ? <RoleBadge role={a.role} /> : null}
            <Text variant="caption" tone="faint" numberOfLines={1} align="ui">
              · {reply.time}{reply.edited ? ' · edited' : ''}
            </Text>
          </View>

          {showReplyTo ? (
            <Touchable onPress={onReplyToPress} disabled={!onReplyToPress} feedback="dim" noAutoHitSlop style={{ marginTop: space.xxs }}>
              <Text variant="caption" tone="accent" align="ui">
                Replying to {replyToHandle ? `@${replyToHandle}` : 'another reply'}
              </Text>
            </Touchable>
          ) : null}
        </View>
        {canManage ? (
          <IconButton name="more" onPress={onOverflow} size={15} color={c.textFaint} accessibilityLabel="Reply options" />
        ) : null}
      </View>

      <View style={{ marginStart: page ? 44 : 36 }}>
        <Text variant={page ? 'body' : 'callout'} align="auto" style={{ marginTop: space.xs }}>{reply.body}</Text>

        <InlineMedia answer={reply} />
        {reply.voiceUrl ? (
          <View style={{ marginTop: space.sm2 }}>
            <VoiceNotePlayer url={reply.voiceUrl} durationSeconds={reply.voiceDurationSeconds} compact />
          </View>
        ) : null}
        <LinkChips links={reply.links} onPress={onOpenLink} />

        <View style={[styles.footer, { marginTop: space.sm }]}>
          <LikeButton liked={reply._liked} count={reply.likes} cooldown={likeCooldown} compact onToggle={onLike} />
          {canReply ? (
            <Touchable onPress={onReply} feedback="scale" style={styles.action} accessibilityLabel="Reply">
              <Icon name="reply" size={15} color={c.textMuted} />
              <Text variant="caption" tone="muted">Reply</Text>
            </Touchable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  )
}

export const ReanswerRow = React.memo(ReanswerRowBase)

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2 },
  flex: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flexWrap: 'wrap' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
})
