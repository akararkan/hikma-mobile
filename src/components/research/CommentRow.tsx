/* =========================================================
   CommentRow — one comment or reply.

   The like is optimistic and stays that way: `reactComment`
   answers 201 with an EMPTY body, so there is nothing to
   reconcile from until the next fetch or the next
   COMMENT_REACTION_* event. `unreactComment` does answer with
   the full row, so that direction reconciles.

   Replies are capped at depth 1 by the backend and always
   arrive inline on their parent — there is no load-more-replies
   endpoint, which is why "Show n more replies" expands local
   state instead of fetching.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { adapters, api, errorText, isRateLimited } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, Icon, NumericText, Text, Touchable, fireHaptic, formatCount, toast } from '@/ui'
import { VoiceTransport } from '@/components/media/VoiceTransport'
import { chatVoice, useChatVoiceFor } from '@/components/chat/chatVoicePlayer'
import { RichBody } from './RichBody'
import { useCooldown } from './hooks'
import type { ResearchComment } from './types'
import { to } from './nav'

export interface CommentRowProps {
  comment: ResearchComment
  researchId: string
  /** The signed-in user — marks your own rows, nothing more. The menu owns
   *  the permission rules (see CommentActions.tsx). */
  viewerId?: string | null
  /** Replies sit behind a rule; the thread screen renders them flat. */
  indented?: boolean
  onReply?: (c: ResearchComment) => void
  onMenu?: (c: ResearchComment) => void
  onPatch?: (commentId: string, patch: Partial<ResearchComment>) => void
  onOpenImage?: (uri: string) => void
  onRetry?: (c: ResearchComment) => void
  bodyVariant?: 'body' | 'callout'
}

function CommentRowBase({
  comment, researchId, viewerId, indented, onReply, onMenu, onPatch, onOpenImage, onRetry,
}: CommentRowProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const [cooldown, startCooldown] = useCooldown()

  const like = async () => {
    if (cooldown > 0 || comment._pending) return
    const next = !comment.liked
    onPatch?.(comment.id, { liked: next, likes: Math.max(0, comment.likes + (next ? 1 : -1)) })
    try {
      if (next) {
        await api.research.reactComment(researchId, comment.id)
        return
      }
      const row = adapters.researchCommentFrom(await api.research.unreactComment(researchId, comment.id)) as ResearchComment
      onPatch?.(comment.id, { liked: row.liked, likes: row.likes })
    } catch (e: any) {
      onPatch?.(comment.id, { liked: comment.liked, likes: comment.likes })
      if (isRateLimited(e)) { startCooldown(e); return }
      toast.error(errorText(e))
    }
  }

  const mine = !!viewerId && String(comment.author) === String(viewerId)

  return (
    <RowShell
      style={[styles.row, indented ? { paddingStart: 44 } : null]}
      /* Long-press is the accelerator, not the entry point: the '⋯' in the
         action line below is the discoverable control. */
      onLongPress={onMenu && !comment._pending ? () => { fireHaptic('medium'); onMenu(comment) } : undefined}
    >
      {indented ? <View style={[styles.rule, { backgroundColor: c.border }]} /> : null}

      <Avatar
        uri={comment._author.profileImage}
        name={comment._author.full}
        seed={comment._author.id}
        size={indented ? 30 : 36}
        onPress={() => router.push(to(`/u/${comment.author}`))}
      />

      <View style={[styles.flex, comment._pending ? { opacity: 0.6 } : null]}>
        <View style={styles.nameLine}>
          <Text variant="footnote" weight="600" align="ui" numberOfLines={1} style={styles.shrink}>
            {comment._author.full}
          </Text>
          {/* Prefixed like every other surface (qna's AnswerCard, the post
              composer) — handles are stored bare, '@' is a display concern. */}
          <Text variant="caption" tone="faint" numberOfLines={1}>@{comment._author.handle}</Text>
          <Text variant="caption" tone="faint" numberOfLines={1}>· {comment.time}</Text>
          {mine ? <Text variant="caption" tone="faint">· you</Text> : null}
          {/* Same word, same shape as the post and reel rows. */}
          {comment.edited ? <Text variant="caption" tone="faint">· edited</Text> : null}
          {comment.hidden ? <Chip label="Hidden" tone="warning" size="sm" /> : null}
        </View>

        {comment.body ? (
          <RichBody plain={comment.body} bodyFormat="PLAIN" style={{ marginTop: space.xs }} />
        ) : null}

        {comment.mediaUrl && comment.mediaType !== 'VOICE' ? (
          <Touchable
            onPress={() => onOpenImage?.(comment.mediaUrl as string)}
            feedback="scale"
            noAutoHitSlop
            /* The thumbnail is the only unlabelled control on the row — a
               bare image button announces as "button" and nothing else. */
            accessibilityLabel={comment.mediaType === 'VIDEO' ? 'Open video' : 'Open image'}
            style={[styles.media, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}
          >
            {/* recyclingKey is not optional in a recycled row: without it
                expo-image keeps painting the PREVIOUS comment's decoded
                bitmap until the new source resolves, so a fast flick shows
                the wrong picture under the right words. No transition either
                — a cross-fade nobody sees completed just keeps a second
                bitmap alive. */}
            <Image
              source={{ uri: comment.mediaThumbnailUrl || comment.mediaUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={0}
              recyclingKey={comment.mediaThumbnailUrl || comment.mediaUrl}
              /* expo-image defaults to disk-only, and a long thread recycles
                 these constantly — without the memory tier every return trip
                 blanks then pops instead of painting on frame 1. */
              cachePolicy="memory-disk"
            />
            {comment.mediaType === 'VIDEO' ? (
              <View style={[styles.playOverlay, { backgroundColor: c.overlayChip }]}>
                <Icon name="play" size={16} color={c.overlayText} filled />
              </View>
            ) : null}
          </Touchable>
        ) : null}

        {comment.voiceUrl ? (
          <VoiceBubble id={comment.id} uri={comment.voiceUrl} seconds={comment.voiceDurationSeconds} />
        ) : null}

        <View style={styles.footer}>
          {comment._failed ? (
            <Touchable onPress={() => onRetry?.(comment)} feedback="dim" style={styles.footAction}>
              <Icon name="refresh" size={14} color={c.danger} />
              <Text variant="caption" tone="danger">Not sent — retry</Text>
            </Touchable>
          ) : (
            <>
              <Touchable onPress={like} feedback="scale" haptic="light" style={styles.footAction} accessibilityLabel="Like comment">
                <Icon name="heart" size={15} color={comment.liked ? c.like : c.textFaint} filled={comment.liked} />
                {comment.likes ? <NumericText variant="caption" tone="muted">{formatCount(comment.likes)}</NumericText> : null}
              </Touchable>
              {onReply ? (
                <Touchable onPress={() => onReply(comment)} feedback="dim" style={styles.footAction}>
                  <Text variant="caption" tone="muted" weight="600">Reply</Text>
                </Touchable>
              ) : null}
              {/* An optimistic row has no server id yet — nothing in the menu
                  could address it. */}
              {onMenu && !comment._pending ? (
                <Touchable onPress={() => onMenu(comment)} feedback="dim" style={styles.footAction} accessibilityLabel="Comment actions">
                  <Icon name="more" size={15} color={c.textFaint} />
                </Touchable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </RowShell>
  )
}

/* Memoized: every prop above is a scalar or an identity-stable callback (the
   list hands down `menu.open` / `setReply` / a useCallback'd `onPatch`), so a
   screen render that moved nothing — an unrelated SSE frame, a keystroke in
   the composer — stops here instead of rebuilding every visible comment. */
export const CommentRow = React.memo(CommentRowBase)

/* A plain View until a menu exists, a long-pressable plate once it does — a
   row that looks pressable and is not is the same lie as a dead '⋯'. */
function RowShell({
  style, onLongPress, children,
}: { style: StyleProp<ViewStyle>; onLongPress?: () => void; children: React.ReactNode }) {
  if (!onLongPress) return <View style={style}>{children}</View>
  return (
    <Touchable
      onLongPress={onLongPress}
      feedback="none"
      noAutoHitSlop
      accessibilityLabel="Comment actions"
      style={style}
    >
      {children}
    </Touchable>
  )
}

/* ---------------------------------------------------------
   VoiceBubble — a dumb transport, not a player.

   There is no native player in this row. Audio belongs to the
   ONE app-level host (ChatVoiceHost, mounted in the signed-in
   layout — see chat/chatVoicePlayer.tsx), for exactly the two
   reasons that host exists. A comment lives in a FlashList, so
   a player owned by the row is killed mid-sentence the moment
   the ViewHolder recycles; and playback is app-wide exclusive,
   so tapping a second note — here, in a chat bubble, anywhere —
   silences the first instead of talking over it.

   The host key is namespaced. Its registry spans domains, and a
   research comment id and a chat message id are minted by
   different tables: `research:` keeps two unrelated rows from
   ever being mistaken for the same track.

   The face is the shared VoiceTransport, so the plate, the
   scrubbable waveform and the glide are the same object the
   voice post and the chat bubble render. No amplitude data
   comes back on a comment, so the transport falls back to its
   id-seeded synthetic envelope.
   --------------------------------------------------------- */

function VoiceBubble({ id, uri, seconds }: { id: string; uri: string; seconds: number | null }) {
  const key = `research:${id}`
  /* Row-scoped subscription: while a note plays the clock re-renders this
     comment alone, not every voice comment on screen. */
  const live = useChatVoiceFor(key)
  const mine = live.id === key
  const wireSec = seconds || 0
  const hintMs = wireSec ? wireSec * 1000 : null

  const onToggle = () => chatVoice.toggle(key, uri, hintMs)
  /* Stable identity: the waveform's gesture closes over this, and a callback
     reborn on every store tick would re-register the native gesture config
     four times a second — the churn the memoised gesture exists to avoid. */
  const onSeek = useEvent((sec: number) => chatVoice.seek(key, uri, sec, hintMs))

  return (
    <VoiceTransport
      seed={id}
      playing={mine && live.playing}
      position={mine ? live.position : 0}
      duration={mine ? (live.duration || wireSec) : wireSec}
      rate={live.rate}
      compact
      onToggle={onToggle}
      onSeek={onSeek}
      accessibilityLabel={mine && live.playing ? 'Pause voice note' : 'Play voice note'}
      style={styles.voice}
    />
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  rule: { position: 'absolute', start: 33, top: 6, bottom: 6, width: StyleSheet.hairlineWidth },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flexWrap: 'wrap' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
  footAction: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingVertical: space.xxs },
  media: { width: 220, height: 140, marginTop: space.sm, overflow: 'hidden' },
  /* Icon-only circles (play glyph, transport button) are sanctioned rounds;
     logical `start`/`marginStart` so the centring survives RTL. */
  playOverlay: {
    position: 'absolute', top: '50%', start: '50%', marginTop: -space.lg2, marginStart: -space.lg2,
    width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  /* The plate carries its own ground (navy gradient, ghost-sky hairline), so
     the row only owns the gap above it. */
  voice: { marginTop: space.sm },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
