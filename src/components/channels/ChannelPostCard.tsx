/* =========================================================
   The broadcast card — the most reused component in the domain.

   Four things it has to get right, all of them silent failures:

   · a channel post has NO author plate. The channel signs it,
     and only when `settings.signMessages` is on and the server
     stamped an `authorSignature`.
   · `views` / `forwards` / `comments` are NULL outside a channel,
     and `comments` is additionally null with no discussion group
     linked. They are tested with `!= null`, never truthiness, or
     every zero-view post silently loses its counter.
   · `settings.reactionsEnabled === false` means the reaction bar
     is OMITTED, not disabled — the server answers 403 there.
     A non-empty `allowedReactions` whitelists the tray.
   · `settings.protectedContent` REMOVES copy/forward/save rather
     than greying them, because the wall behind them is a 403.

   It is React.memo'd because it is the channel feed's row: a
   realtime frame patches ONE post, and without the memo every
   mounted card would re-render its media grid and poll with it.
   The screens keep their `renderItem` identity-stable so the
   memo is actually reachable.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { isRedactedText } from '@/api'
import { RichText, toPlainText } from '@/lib/richtext'
import {
  Avatar, Callout, Chip, Icon, Text, Touchable, fireHaptic, formatCount,
} from '@/ui'
import { ContactCard, LocationCard } from '@/components/chat/Payloads'
import { MediaAlbum } from './MediaAlbum'
import { PollCard } from './PollCard'

/** The tray offered when the channel has not whitelisted a set. */
export const DEFAULT_REACTIONS = ['👍', '❤️', '🔥', '👏', '😂', '😮', '😢', '🙏']

export interface ChannelPostCardProps {
  post: any
  channel: any
  myAdminRow?: any
  variant?: 'feed' | 'compact' | 'detail'
  onPress?: () => void
  onPressComments?: () => void
  onReact?: (emoji: string) => void
  onUnreact?: () => void
  onVote?: (indexes: number[]) => void | Promise<void>
  onRetractVote?: () => void | Promise<void>
  onClosePoll?: () => void | Promise<void>
  onMenu?: () => void
  onTagPress?: (tag: string) => void
  onMentionPress?: (handle: string) => void
  onOpenMedia?: (index: number) => void
  canClosePoll?: boolean
  /** A just-sent post whose echo has not arrived — see the moderation note. */
  pending?: boolean
}

export const ChannelPostCard = React.memo(function ChannelPostCard(props: ChannelPostCardProps) {
  const {
    post, channel, variant = 'feed', onPress, onPressComments, onReact, onUnreact,
    onVote, onRetractVote, onClosePoll, onMenu, onTagPress, onMentionPress,
    onOpenMedia, canClosePoll, pending,
  } = props
  const t = useTheme()
  const c = t.colors
  /* LocationCard sizes its static map to a fixed width; the card is full-bleed
     inside the screen's own padding, so that is the width to hand it. */
  const { width: winW } = useWindowDimensions()
  const cardWidth = Math.max(200, winW - t.layout.screenPadding * 2)
  const [expanded, setExpanded] = React.useState(variant === 'detail')
  const [trayOpen, setTrayOpen] = React.useState(false)

  const settings = channel?.settings || {}
  const reactionsOff = settings.reactionsEnabled === false
  const clamp = variant === 'detail' ? undefined : variant === 'compact' ? 6 : 3
  const held = isRedactedText(post?.body)

  const plain = React.useMemo(() => toPlainText(post?.body), [post?.body])
  const long = plain.length > 320
  const showToggle = !!clamp && long && !expanded

  const tray = React.useMemo(() => {
    const allowed = settings.allowedReactions
    return Array.isArray(allowed) && allowed.length ? allowed.slice(0, 12) : DEFAULT_REACTIONS
  }, [settings.allowedReactions])

  /* One tap shows the reactions, two hearts the post — the Instagram grammar
     the app owner asked for. The split is a manual timer because Touchable is
     a Pressable, not a gesture detector: the first tap arms a short window;
     a second tap inside it reacts with the default (❤️ unless the channel's
     whitelist drops it → its first allowed emoji), toggling off when that is
     already your reaction. Reactions off / compact rows keep the plain
     open-the-post tap. */
  const lastTap = React.useRef(0)
  const singleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (singleTimer.current) clearTimeout(singleTimer.current) }, [])

  const defaultEmoji = tray.includes('❤️') ? '❤️' : tray[0]
  const myEmoji = (post?.reactions || []).find((r: any) => r.reactedByMe)?.emoji

  const handleCardPress = () => {
    if (reactionsOff || variant === 'compact' || !onReact) { onPress?.(); return }
    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      if (singleTimer.current) { clearTimeout(singleTimer.current); singleTimer.current = null }
      fireHaptic('light')
      if (myEmoji === defaultEmoji) onUnreact?.()
      else onReact(defaultEmoji)
      return
    }
    lastTap.current = now
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null
      setTrayOpen(o => !o)
    }, 280)
  }

  return (
    <Touchable
      onPress={handleCardPress}
      onLongPress={onMenu}
      disabled={!onPress && !onMenu && !onReact}
      feedback="none"
      noAutoHitSlop
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          paddingHorizontal: t.layout.screenPadding,
          opacity: pending ? 0.6 : 1,
        },
      ]}
    >
      {/* Signature: the posting admin, only when the channel signs. */}
      {settings.signMessages && post?.authorSignature ? (
        <View style={styles.sigRow}>
          <Avatar name={post.authorSignature} seed={post.senderId} size={20} />
          <Text variant="caption" tone="muted" align="ui">{post.authorSignature}</Text>
        </View>
      ) : null}

      {post?.replyTo ? (
        <View style={[styles.quote, { borderStartColor: c.accent, backgroundColor: c.accentSofter }]}>
          <Text variant="footnote" tone="muted" numberOfLines={2} align="auto">
            {post.replyTo.deleted ? 'Deleted message' : post.replyTo.snippet}
          </Text>
        </View>
      ) : null}

      {held ? (
        <Callout tone="warning" icon="warning">
          This post is being reviewed and is hidden until that finishes.
        </Callout>
      ) : post?.body ? (
        <>
          <RichText
            body={post.body}
            maxBlocks={expanded ? undefined : clamp}
            onPressTag={onTagPress}
            onPressMention={onMentionPress}
            selectable={variant === 'detail'}
          />
          {showToggle ? (
            <Touchable onPress={() => setExpanded(true)} feedback="dim" style={{ marginTop: space.xs }}>
              <Text variant="subhead" tone="accent" align="ui">Read more</Text>
            </Touchable>
          ) : null}
        </>
      ) : null}

      {post?.media?.length ? (
        <MediaAlbum
          media={post.media}
          protectedContent={!!settings.protectedContent}
          onOpen={onOpenMedia}
          maxHeight={variant === 'compact' ? 180 : undefined}
        />
      ) : null}

      {/* LOCATION and CONTACT are first-class channel post types (channels/
          posts.md), and the payloads round-trip on MessageResponse exactly as
          they do in a DM — so the same two cards render them. Without this a
          shared pin or contact posted to a channel arrived as an empty card.
          Reused, not re-drawn: two implementations of the same payload drift. */}
      {post?.location ? (
        <LocationCard location={post.location} fg={c.text} fgMuted={c.textMuted} width={cardWidth} />
      ) : null}

      {post?.contact ? (
        <ContactCard contact={post.contact} fg={c.text} fgMuted={c.textMuted} />
      ) : null}

      {post?.poll ? (
        <PollCard
          poll={post.poll}
          canClose={canClosePoll}
          onVote={onVote}
          onRetract={onRetractVote}
          onClose={onClosePoll}
        />
      ) : null}

      {post?.tags?.length ? (
        <View style={styles.tags}>
          {post.tags.slice(0, 8).map((tag: string) => (
            <Chip key={tag} label={`#${tag}`} tone="accent" size="sm" onPress={() => onTagPress?.(tag)} />
          ))}
        </View>
      ) : null}

      {!reactionsOff && variant !== 'compact' ? (
        <ReactionBar
          reactions={post?.reactions || []}
          tray={tray}
          trayOpen={trayOpen}
          onToggleTray={() => setTrayOpen(o => !o)}
          onReact={emoji => { setTrayOpen(false); onReact?.(emoji) }}
          onUnreact={onUnreact}
        />
      ) : null}

      <View style={styles.meta}>
        {pending ? (
          <View style={[styles.pill, setback(t.shape.chip), { backgroundColor: c.surfaceSunken }]}>
            <Text variant="micro" tone="muted">Checking…</Text>
          </View>
        ) : null}
        {post?.views != null ? <Counter icon="eye" value={post.views} label="views" /> : null}
        {post?.forwards != null ? <Counter icon="forwardMsg" value={post.forwards} label="forwards" /> : null}
        {post?.comments != null ? (
          <Touchable onPress={onPressComments} feedback="dim" style={styles.counter}>
            <Icon name="comment" size={13} color={c.textMuted} />
            <Text variant="caption" tone="muted">
              {post.comments === 0 ? 'Comment' : `${formatCount(post.comments)}`}
            </Text>
          </Touchable>
        ) : null}
        <View style={styles.flex} />
        {post?.starred ? <Icon name="bookmark" size={13} color={c.accent} filled /> : null}
        {post?.editedAt ? <Text variant="caption" tone="faint">edited</Text> : null}
        <Text variant="caption" tone="faint">{post?.time}</Text>
      </View>
    </Touchable>
  )
})

/* ---------------------------------------------------------
   Reactions
   --------------------------------------------------------- */

function ReactionBar({
  reactions, tray, trayOpen, onToggleTray, onReact, onUnreact,
}: {
  reactions: any[]
  tray: string[]
  trayOpen: boolean
  onToggleTray: () => void
  onReact: (emoji: string) => void
  onUnreact?: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const live = reactions.filter(r => r.count > 0)
  return (
    <View style={{ gap: space.xs2 }}>
      <View style={styles.reactions}>
        {live.map(r => (
          <Touchable
            key={r.emoji}
            onPress={() => (r.reactedByMe ? onUnreact?.() : onReact(r.emoji))}
            feedback="scale"
            haptic="light"
            noAutoHitSlop
            style={[
              styles.reaction,
              setback(t.shape.chip),
              {
                backgroundColor: r.reactedByMe ? c.accentSoft : c.surfaceSunken,
                borderColor: r.reactedByMe ? c.accent : 'transparent',
              },
            ]}
          >
            <Text variant="footnote">{r.emoji}</Text>
            <Text variant="caption" tone={r.reactedByMe ? 'accent' : 'muted'}>{formatCount(r.count)}</Text>
          </Touchable>
        ))}
        <Touchable
          onPress={onToggleTray}
          feedback="scale"
          haptic="light"
          noAutoHitSlop
          accessibilityLabel="Add a reaction"
          style={[styles.reaction, setback(t.shape.chip), { backgroundColor: c.surfaceSunken, borderColor: 'transparent' }]}
        >
          <Icon name="emoji" size={14} color={c.textMuted} />
        </Touchable>
      </View>

      {trayOpen ? (
        <View style={[styles.tray, setback(t.shape.chip), { backgroundColor: c.surfaceSunken }]}>
          {tray.map(e => (
            <Touchable key={e} onPress={() => onReact(e)} feedback="scale" haptic="light" noAutoHitSlop style={styles.trayItem}>
              <Text variant="title3">{e}</Text>
            </Touchable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Counter({ icon, value, label }: { icon: 'eye' | 'forwardMsg'; value: number; label: string }) {
  const t = useTheme()
  return (
    <View style={styles.counter} accessible accessibilityLabel={`${value} ${label}`}>
      <Icon name={icon} size={13} color={t.colors.textMuted} />
      <Text variant="caption" tone="muted">{formatCount(value)}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Delta folding — the frames carry ±1, never a total.
   --------------------------------------------------------- */

/** Apply a `message.reaction` frame to one post's reaction array.
 *  `reactedByMe` only moves when the frame is about ME; a pill is created on
 *  the first reaction and dropped when it hits zero. */
export function applyReactionDelta(
  reactions: any[],
  { emoji, added, mine }: { emoji: string; added: boolean; mine: boolean },
) {
  const list = [...(reactions || [])]
  const i = list.findIndex(r => r.emoji === emoji)
  if (i < 0) {
    if (!added) return list
    return [...list, { emoji, count: 1, reactedByMe: mine }]
  }
  const count = Math.max(0, list[i].count + (added ? 1 : -1))
  if (!count) return list.filter((_, k) => k !== i)
  list[i] = { ...list[i], count, reactedByMe: mine ? added : list[i].reactedByMe }
  return list
}

const styles = StyleSheet.create({
  card: { paddingVertical: space.md2, gap: space.sm2 },
  sigRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  quote: { borderStartWidth: 3, paddingStart: space.sm2, paddingVertical: space.xs2, paddingEnd: space.sm, borderRadius: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  /* Reaction plates, the emoji tray and the "Checking…" plate all carry text,
     so they take the chip setback (DESIGN §3), never a pill — the only pills
     in the app are unread counters and LIVE badges. */
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.sm2,
    height: 28,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, padding: space.xs2, alignSelf: 'flex-start', borderCurve: 'continuous' },
  trayItem: { paddingHorizontal: space.xs2, paddingVertical: space.xxs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md2 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pill: { paddingHorizontal: space.sm, paddingVertical: space.xxs, borderCurve: 'continuous' },
  flex: { flex: 1 },
})
