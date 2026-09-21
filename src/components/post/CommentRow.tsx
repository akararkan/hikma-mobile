/* =========================================================
   CommentRow — one comment or reply.

   Bubble-less on purpose: threads here are two levels deep by
   contract (a reply to a reply is hoisted to a sibling), so the
   indent alone carries the structure and a bubble would just
   add noise at 32px.

   Swipe-right is the reply shortcut. It fires its haptic at the
   threshold rather than on release, so the gesture confirms
   itself before the finger lifts.

   Edit / delete / report live behind the '⋯' in the action
   line. Long-press summons the same menu as an accelerator,
   with a `medium` buzz — but a gesture is not an affordance,
   so the button is always drawn when a menu exists.

   Memoized, and the pan is built ONCE per row rather than per
   render: GestureDetector diffs its gesture by identity, so a
   fresh object every render re-registers the handler config with
   the native module for every visible comment. The worklets read
   the live comment through a stable `useEvent` callback instead
   of closing over it, which is what keeps the memo deps down to
   two scalars. Callers must pass identity-stable, item-taking
   handlers or the React.memo is decoration.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, NumericText, Spinner, Text, Touchable, fireHaptic, formatCount } from '@/ui'
import { PostBody } from './PostBody'
import type { CommentView } from '@/components/feed/types'

const SWIPE_THRESHOLD = 64

export interface CommentRowProps {
  comment: CommentView
  isReply?: boolean
  /** Expanded state of this comment's reply list — drives the affordance copy. */
  repliesOpen?: boolean
  repliesLoading?: boolean
  onLike?: (c: CommentView) => void
  onReply?: (c: CommentView) => void
  onMenu?: (c: CommentView) => void
  onPressAuthor?: (userId: string) => void
  onExpandReplies?: (c: CommentView) => void
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  onRetry?: (c: CommentView) => void
  onDiscard?: (c: CommentView) => void
  /** Opens the comment's inline image or clip full-screen. */
  onOpenMedia?: (uri: string) => void
}

export const CommentRow = React.memo(function CommentRow({
  comment, isReply, repliesOpen, repliesLoading,
  onLike, onReply, onMenu, onPressAuthor, onExpandReplies,
  onPressTag, onPressMention, onRetry, onDiscard, onOpenMedia,
}: CommentRowProps) {
  const t = useTheme()
  const c = t.colors
  const x = useSharedValue(0)
  const armed = React.useRef(false)
  /* UI-thread mirror of `armed`. The ref below already swallowed the repeat
     haptics, but it did so on the JS side — which meant a runOnJS hop on every
     frame past the threshold just to be told "already armed". The check now
     happens where the frame is, so the bridge is crossed once per swipe.
     Same arrangement as chat/MessageBubble's reply arm. */
  const armedSV = useSharedValue(false)

  /* Once per gesture: the pan fires on every frame past the threshold, and a
     haptic on each of those is a buzz, not a confirmation. */
  const buzz = React.useCallback(() => {
    if (armed.current) return
    armed.current = true
    fireHaptic('light')
  }, [])
  const disarm = React.useCallback(() => { armed.current = false }, [])

  /* Stable, always fresh — the worklet must not close over `comment`, or the
     gesture is rebuilt on every like. */
  const fireReply = useEvent(() => { onReply?.(comment) })
  const swipeEnabled = !!onReply && !comment.pending && !comment.failed

  const spring = t.motion.spring
  const swipe = React.useMemo(() => Gesture.Pan()
    .activeOffsetX([-1000, 12])
    .failOffsetY([-14, 14])
    .enabled(swipeEnabled)
    .onUpdate(e => {
      x.value = Math.max(0, Math.min(96, e.translationX))
      if (e.translationX > SWIPE_THRESHOLD && !armedSV.value) { armedSV.value = true; runOnJS(buzz)() }
    })
    .onEnd(e => {
      const hit = e.translationX > SWIPE_THRESHOLD
      x.value = withSpring(0, spring)
      if (hit) runOnJS(fireReply)()
      armedSV.value = false
      runOnJS(disarm)()
    }), [swipeEnabled, spring, x, armedSV, buzz, disarm, fireReply])

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const hint = useAnimatedStyle(() => ({ opacity: Math.min(1, x.value / SWIPE_THRESHOLD) }))

  const body = (
    <Animated.View style={[styles.row, slide]}>
      <Avatar
        uri={comment._author?.profileImage}
        name={comment._author?.full}
        seed={comment._author?.id}
        size={isReply ? 28 : 32}
        onPress={onPressAuthor ? () => onPressAuthor(comment.author) : undefined}
      />

      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Touchable
            onPress={onPressAuthor ? () => onPressAuthor(comment.author) : undefined}
            disabled={!onPressAuthor}
            feedback="dim"
            noAutoHitSlop
          >
            <Text variant="subhead" weight="600" numberOfLines={1}>{comment._author?.full || 'Member'}</Text>
          </Touchable>
          <Text variant="caption" tone="faint">· {comment.time}</Text>
          {comment.edited ? <Text variant="caption" tone="faint">· edited</Text> : null}
          {comment.pending ? <Spinner size="small" style={styles.tinySpinner} /> : null}
        </View>

        {comment._replyToHandle ? (
          <Text variant="callout" serif style={styles.bodyGap}>
            <Text variant="callout" tone="accent" weight="600">@{comment._replyToHandle} </Text>
            {comment.body}
          </Text>
        ) : (
          <PostBody
            text={comment.body}
            variant="callout"
            numberOfLines={0}
            onPressTag={onPressTag}
            onPressMention={onPressMention}
            style={styles.bodyGap}
          />
        )}

        {/* One inline image or clip per comment (engagement.md §3.1). A REPLY
            comes back with a mediaUrl and NO mediaType, so an absent type
            means IMAGE rather than "hide it". The thumbnail only ever arrives
            on an SSE frame, hence the fallback to the full url. */}
        {comment.mediaUrl ? (
          <Touchable
            onPress={() => onOpenMedia?.(comment.mediaUrl as string)}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel={comment.mediaType === 'VIDEO' ? 'Open video' : 'Open image'}
            style={[styles.media, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}
          >
            {/* recyclingKey is not optional in a recycled row: without it
                expo-image keeps painting the PREVIOUS comment's decoded bitmap
                until the new source resolves, so a fast flick shows the wrong
                picture under the right words. */}
            <Image
              source={{ uri: comment.mediaThumbnailUrl || comment.mediaUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={0}
              /* expo-image defaults to disk-only, and a 100-comment thread
                 recycles these constantly — without the memory tier every
                 return trip blanks then pops instead of painting on frame 1. */
              cachePolicy="memory-disk"
              recyclingKey={comment.mediaThumbnailUrl || comment.mediaUrl}
            />
            {comment.mediaType === 'VIDEO' ? (
              <View style={[styles.playOverlay, { backgroundColor: c.overlayChip }]}>
                <Icon name="play" size={16} color={c.overlayText} filled />
              </View>
            ) : null}
          </Touchable>
        ) : null}

        {comment.failed ? (
          <View style={styles.failRow}>
            <Icon name="error" size={14} color={c.danger} />
            <Text variant="footnote" tone="danger" style={styles.flex}>Not sent</Text>
            <Touchable onPress={() => onRetry?.(comment)} feedback="dim" style={styles.link}>
              <Text variant="footnote" tone="accent">Retry</Text>
            </Touchable>
            <Touchable onPress={() => onDiscard?.(comment)} feedback="dim" style={styles.link}>
              <Text variant="footnote" tone="muted">Discard</Text>
            </Touchable>
          </View>
        ) : (
          <View style={styles.actionLine}>
            {/* One like control per row: the trailing heart. A text 'Like'
                beside it was a second button firing the same handler — the
                reel and research rows never had one. */}
            {onReply ? (
              <Touchable onPress={() => onReply(comment)} feedback="dim" noAutoHitSlop style={styles.link}>
                <Text variant="footnote" weight="600" tone="muted">Reply</Text>
              </Touchable>
            ) : null}
            {/* The menu was long-press-only, which is to say invisible. The
                gesture stays as an accelerator; this is the affordance. */}
            {onMenu ? (
              <Touchable
                onPress={() => onMenu(comment)}
                feedback="dim"
                noAutoHitSlop
                accessibilityLabel="Comment actions"
                style={styles.link}
              >
                <Icon name="more" size={15} color={c.textFaint} />
              </Touchable>
            ) : null}
            <View style={styles.flex} />
            <Touchable
              onPress={() => onLike?.(comment)}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={comment.liked ? 'Unlike comment' : 'Like comment'}
              style={styles.heart}
            >
              <Icon name="heart" size={14} filled={comment.liked} color={comment.liked ? c.like : c.textFaint} />
              {comment.likes ? (
                <NumericText variant="caption" color={comment.liked ? c.like : c.textFaint}>
                  {formatCount(comment.likes)}
                </NumericText>
              ) : null}
            </Touchable>
          </View>
        )}

        {!isReply && comment.replyCount > 0 && onExpandReplies ? (
          <Touchable
            onPress={() => onExpandReplies(comment)}
            feedback="dim"
            noAutoHitSlop
            style={styles.repliesToggle}
          >
            <View style={[styles.rule, { backgroundColor: c.borderStrong }]} />
            <Text variant="footnote" weight="600" tone="accent">
              {repliesLoading ? 'Loading…'
                : repliesOpen ? 'Hide replies'
                  : `View ${comment.replyCount} ${comment.replyCount === 1 ? 'reply' : 'replies'}`}
            </Text>
          </Touchable>
        ) : null}
      </View>
    </Animated.View>
  )

  return (
    <Touchable
      /* Touchable's `haptic` prop rides onPress only, so the long-press fires
         its own — a menu that arrives with no tactile warning reads as a
         mis-tap. Same buzz on the reel row, deliberately. */
      onLongPress={onMenu ? () => { fireHaptic('medium'); onMenu(comment) } : undefined}
      feedback="none"
      noAutoHitSlop
      style={[styles.wrap, comment.pending ? styles.pending : null]}
    >
      <Animated.View style={[styles.swipeHint, hint]}>
        <Icon name="reply" size={16} color={c.accent} />
      </Animated.View>
      <GestureDetector gesture={swipe}>{body}</GestureDetector>
    </Touchable>
  )
})

/** The 1px guide that runs down an expanded reply list. Each reply is its own
 *  list cell — never one partition in one cell — so a cell draws one SEGMENT
 *  of the rule: `first` caps the top, `last` caps the bottom and keeps the 8px
 *  setoff, `middle` runs edge to edge, and the stacked cells read as one
 *  continuous line. */
export type GuideSegment = 'first' | 'middle' | 'last' | 'only'

export function ReplyGuide({ children, inset = 44, segment = 'only' }: {
  children: React.ReactNode
  inset?: number
  segment?: GuideSegment
}) {
  const t = useTheme()
  const capTop = segment === 'first' || segment === 'only'
  const capBottom = segment === 'last' || segment === 'only'
  return (
    <View style={{ paddingStart: inset }}>
      <View
        style={[
          styles.guide,
          {
            start: inset / 2 - 6,
            backgroundColor: t.colors.separator,
            bottom: capBottom ? 8 : 0,
            borderTopStartRadius: capTop ? 1 : 0,
            borderTopEndRadius: capTop ? 1 : 0,
            borderBottomStartRadius: capBottom ? 1 : 0,
            borderBottomEndRadius: capBottom ? 1 : 0,
          },
        ]}
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  pending: { opacity: 0.6 },
  swipeHint: { position: 'absolute', start: 14, top: 0, bottom: 0, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  flex: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  media: { width: 220, height: 140, marginTop: space.sm, overflow: 'hidden' },
  /* An icon-only circle is a sanctioned round; logical start/marginStart so
     the centring survives RTL. */
  playOverlay: {
    position: 'absolute', top: '50%', start: '50%', marginTop: -space.lg2, marginStart: -space.lg2,
    width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  bodyGap: { marginTop: space.xxs },
  actionLine: { flexDirection: 'row', alignItems: 'center', gap: space.lg, height: 28 },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, height: 28 },
  link: { paddingVertical: space.xs },
  heart: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs },
  repliesToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs2 },
  rule: { width: 24, height: StyleSheet.hairlineWidth },
  guide: { position: 'absolute', top: 0, width: StyleSheet.hairlineWidth },
  tinySpinner: { padding: 0 },
})
