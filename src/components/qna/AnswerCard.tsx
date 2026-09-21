/* =========================================================
   One top-level answer and everything hanging off it.

   `canAccept` MUST be false for any row carrying a
   parentAnswerId — the server answers 400
   REANSWER_NOT_ACCEPTABLE and the control should never have
   been rendered. The prop is asserted here rather than trusted
   so a caller's mistake degrades to a missing button instead
   of a failing request.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, Icon, IconButton, RoleBadge, Spinner, Text, Touchable, VerifiedMark, formatCount } from '@/ui'
import { AcceptButton, LikeButton } from './buttons'
import { AttachmentsBlock, InlineMedia, LinkChips, SourcesBlock } from './AnswerMedia'
import { ReanswerRow } from './ReanswerRow'
import { VoiceNotePlayer } from './VoiceNotePlayer'
import type { AnswerView, AttachmentView, SourceView } from './types'

const CLAMP_LINES = 12

export interface AnswerCardProps {
  answer: AnswerView
  canManage: boolean
  canAccept: boolean
  canReply: boolean
  expandedReplies: boolean
  replies: AnswerView[]
  repliesLoading?: boolean
  repliesDone?: boolean
  likeCooldown?: number
  highlighted?: boolean
  highlightedReplyId?: string | null
  canManageReply: (reply: AnswerView) => boolean
  onLike: (next: boolean) => void
  onAccept: (next: boolean) => void
  onReply: () => void
  onOverflow: () => void
  onExpandReplies: () => void
  onLoadMoreReplies: () => void
  onAuthorPress: (userId: string) => void
  onOpenLink: (url: string) => void
  onMediaPress: () => void
  onSourcePress: (s: SourceView) => void
  onAttachmentPress: (a: AttachmentView) => void
  onReplyLike: (reply: AnswerView, next: boolean) => void
  onReplyTo: (reply: AnswerView) => void
  onReplyOverflow: (reply: AnswerView) => void
}

function AnswerCardBase(p: AnswerCardProps) {
  const t = useTheme()
  const c = t.colors
  const { answer } = p
  const a = answer._author
  const [expandedBody, setExpandedBody] = React.useState(false)

  /* A green pulse when the author accepts — the card also moves into the
     accepted group, and without the flash the move reads as a glitch. */
  const flash = useSharedValue(0)
  const firstAccept = React.useRef(true)
  React.useEffect(() => {
    if (firstAccept.current) { firstAccept.current = false; return }
    if (!answer.accepted || t.prefs.reducedMotion) return
    flash.value = withSequence(withTiming(1, { duration: t.ms(160) }), withTiming(0, { duration: t.ms(520) }))
  }, [answer.accepted]) // eslint-disable-line react-hooks/exhaustive-deps
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }))

  const acceptable = p.canAccept && !answer.parentAnswerId
  const handles = React.useMemo(() => {
    const m = new Map<string, string>()
    m.set(answer._author.id, answer._author.handle)
    for (const r of p.replies) m.set(r._author.id, r._author.handle)
    return m
  }, [answer._author, p.replies])

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(200))}
      style={[
        styles.card,
        {
          marginHorizontal: t.layout.screenPadding,
          borderRadius: t.radius.md,
          backgroundColor: c.surface,
          borderColor: p.highlighted ? c.accent : c.border,
          borderWidth: p.highlighted ? 1 : StyleSheet.hairlineWidth,
        },
        answer.accepted ? { borderStartWidth: 3, borderStartColor: c.scholar } : null,
      ]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.scholarSoft, borderRadius: t.radius.md }, flashStyle]} />

      <View style={styles.authorRow}>
        <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={32} onPress={() => p.onAuthorPress(a.id)} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Touchable onPress={() => p.onAuthorPress(a.id)} feedback="dim" noAutoHitSlop>
              <Text variant="subhead" weight="600" numberOfLines={1} align="ui">{a.full}</Text>
            </Touchable>
            {a.verified ? <VerifiedMark size={12} /> : null}
            <RoleBadge role={a.role} />
            {answer.accepted ? <Chip label="Accepted" icon="checkCircle" tone="scholar" size="sm" /> : null}
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
            @{a.handle} · {answer.time}{answer.edited ? ' · edited' : ''}
          </Text>
        </View>
        {p.canManage ? (
          <IconButton name="more" onPress={p.onOverflow} size={17} color={c.textFaint} accessibilityLabel="Answer options" />
        ) : null}
      </View>

      <Text
        variant="body"
        align="auto"
        numberOfLines={expandedBody ? undefined : CLAMP_LINES}
        style={{ marginTop: space.sm }}
      >
        {answer.body}
      </Text>
      {!expandedBody && answer.body.length > 520 ? (
        <Touchable onPress={() => setExpandedBody(true)} feedback="dim" noAutoHitSlop accessibilityState={{ expanded: false }} style={{ paddingVertical: space.xs2 }}>
          <Text variant="footnote" tone="accent" align="ui">Show more</Text>
        </Touchable>
      ) : null}

      <InlineMedia answer={answer} onPress={p.onMediaPress} />

      {answer.voiceUrl ? (
        <View style={{ marginTop: space.md }}>
          <VoiceNotePlayer url={answer.voiceUrl} durationSeconds={answer.voiceDurationSeconds} />
        </View>
      ) : null}

      <LinkChips links={answer.links} onPress={p.onOpenLink} />
      <SourcesBlock sources={answer.sources} onPress={p.onSourcePress} />
      <AttachmentsBlock attachments={answer.attachments} onPress={p.onAttachmentPress} />

      <View style={[styles.footer, { borderTopColor: c.separator }]}>
        <LikeButton liked={answer._liked} count={answer.likes} cooldown={p.likeCooldown} onToggle={p.onLike} />
        {p.canReply ? (
          <Touchable onPress={p.onReply} feedback="scale" style={styles.action} accessibilityLabel="Reply to this answer">
            <Icon name="comment" size={17} color={c.textMuted} />
            {answer.replyCount > 0 ? (
              <Text variant="footnote" weight="600" tone="secondary">{formatCount(answer.replyCount)}</Text>
            ) : null}
          </Touchable>
        ) : null}
        <View style={styles.flex} />
        <AcceptButton accepted={answer.accepted} visible={acceptable} onToggle={p.onAccept} />
      </View>

      {answer.replyCount > 0 || p.replies.length ? (
        <View style={{ marginTop: space.xs }}>
          {!p.expandedReplies ? (
            <Touchable onPress={p.onExpandReplies} feedback="dim" noAutoHitSlop style={styles.expander}>
              <Icon name="down" size={15} color={c.accent} />
              <Text variant="footnote" weight="600" tone="accent" align="ui">
                View {answer.replyCount} {answer.replyCount === 1 ? 'reply' : 'replies'}
              </Text>
            </Touchable>
          ) : (
            <View style={[styles.thread, { borderStartColor: c.border }]}>
              {p.replies.map(r => (
                <ReanswerRow
                  key={r.id}
                  reply={r}
                  rootAuthorId={answer.author}
                  replyToHandle={r.replyToUserId ? handles.get(r.replyToUserId) ?? null : null}
                  canManage={p.canManageReply(r)}
                  canReply={p.canReply}
                  highlighted={p.highlightedReplyId === r.id}
                  onLike={next => p.onReplyLike(r, next)}
                  onReply={() => p.onReplyTo(r)}
                  onOverflow={() => p.onReplyOverflow(r)}
                  onAuthorPress={() => p.onAuthorPress(r._author.id)}
                  onOpenLink={p.onOpenLink}
                />
              ))}
              {p.repliesLoading ? <Spinner /> : null}
              {!p.repliesLoading && !p.repliesDone ? (
                <Touchable onPress={p.onLoadMoreReplies} feedback="dim" noAutoHitSlop style={{ paddingVertical: space.sm }}>
                  <Text variant="footnote" tone="accent" align="ui">Load more replies</Text>
                </Touchable>
              ) : null}
              {!p.repliesLoading && p.repliesDone && !p.replies.length ? (
                <Text variant="footnote" tone="faint" align="ui" style={{ paddingVertical: space.sm }}>No replies yet.</Text>
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </Animated.View>
  )
}

export const AnswerCard = React.memo(AnswerCardBase)

const styles = StyleSheet.create({
  card: { padding: space.md2, marginTop: space.md, overflow: 'hidden' },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flexWrap: 'wrap' },
  flex: { flex: 1 },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: space.xl,
    marginTop: space.md, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 36,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  expander: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  thread: { marginStart: space.sm, paddingStart: space.md, borderStartWidth: 2 },
})
