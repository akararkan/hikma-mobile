/* =========================================================
   PostCard — the POST / REEL / VOICE_POST row.

   THE FULL-BLEED PLATE (feed/plate.ts). The card owns the
   whole width: white ground, stone hairline at crown and root,
   an 8pt sunken seam to the next row, and NO shadow. The
   reading order is the one every social timeline has settled
   on because it survives a thumb-scroll:

     who said it  →  what they said  →  the picture  →
     what it earned  →  what you can do about it.

   Two consequences worth stating, because both were once the
   other way round here:

   1. MEDIA BLEEDS TO THE PLATE EDGE at radius 0. A photograph
      inset in a rounded frame is a photograph shown smaller
      than it was taken; the plate edge is the frame.
   2. THE ACTION BAR CARRIES WORDS. Four bare glyphs are a
      guessing game — "Like / Comment / Share / Save" is what
      makes the row operable without learning it first. The
      counts left the bar for the ledger above it, which is
      where a reader looks for a total.

   `source` drives chrome and nothing else. The server has
   already ranked and diversified this list, so the card never
   re-sorts, never re-weights, and never hides a row it dislikes.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, NumericText, Text, Touchable, fireHaptic, formatCount } from '@/ui'
import { AuthorRow } from '@/components/post/AuthorRow'
import { PostBody } from '@/components/post/PostBody'
import { PostMedia } from '@/components/post/PostMedia'
import { Count, PostActions } from '@/components/post/PostActions'
import { ModerationBadge } from '@/components/post/ModerationBadge'
import { moderationState } from '@/lib/moderation'
import { FEED_GUTTER, feedPlate, feedRule } from './plate'
import type { PostView } from './types'

export interface PostCardProps {
  post: PostView
  /** Render the 'Suggested for you' provenance row for EXPLORE rows. */
  showSourceLabel?: boolean
  followed?: boolean
  onFollow?: (authorId: string) => void
  onLike?: (post: PostView) => void
  onSave?: (post: PostView) => void
  onSaveLongPress?: (post: PostView) => void
  onShare?: (post: PostView) => void
  onComment?: (post: PostView) => void
  onMenu?: (post: PostView) => void
  onPress?: (post: PostView) => void
  onPressAuthor?: (userId: string) => void
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  /** True for the single most-visible row — the only one allowed to play. */
  isActiveVideo?: boolean
  muted?: boolean
  onToggleMute?: () => void
  /** Replaces the media in `saved`'s list mode with a "Saved 3d" line. */
  footnote?: string | null
  compact?: boolean
  /** Re-read this row after a moderation hold clears. */
  onModerationCleared?: (fresh: any) => void
  refetch?: () => Promise<any>
}

/* Memoized: the feed re-invokes renderItem for every visible row on any list
   render, and this card carries reanimated values, AuthorRow and media —
   handlers passed in must be identity-stable for the memo to hold. */
export const PostCard = React.memo(function PostCard({
  post, showSourceLabel = true, followed, onFollow,
  onLike, onSave, onSaveLongPress, onShare, onComment, onMenu, onPress,
  onPressAuthor, onPressTag, onPressMention,
  isActiveVideo, muted = true, onToggleMute, footnote, compact,
  onModerationCleared, refetch,
}: PostCardProps) {
  const t = useTheme()
  const c = t.colors
  const held = moderationState(post) !== 'live'

  /* The double-tap burst. It only ever LIKES — a double tap that could unlike
     turns a mis-tap into a silent destructive action. One-shot on two shared
     values: the heart springs in (`burst`), holds a beat, then floats up and
     fades (`burstFade`) — no React state involved. Reduced motion cuts the
     burst entirely; the heart chip's fill is the confirm. */
  const burst = useSharedValue(0)
  const burstFade = useSharedValue(0)
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value * (1 - burstFade.value),
    transform: [
      { translateY: burstFade.value * -14 },
      { scale: 0.4 + burst.value * 0.8 },
    ],
  }))

  const lastTap = React.useRef(0)
  const onMediaPress = () => {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      if (held) return
      if (!post.liked) {
        fireHaptic('light')
        onLike?.(post)
      }
      if (!t.prefs.reducedMotion) {
        burst.value = 0
        burstFade.value = 0
        burst.value = withSpring(1, t.motion.spring)
        burstFade.value = withDelay(t.ms(360), withTiming(1, { duration: t.ms(t.motion.slow) }))
      }
      return
    }
    lastTap.current = now
    onPress?.(post)
  }

  const isExplore = showSourceLabel && post.source === 'EXPLORE'
  /* Pictures and video bleed to the plate edge at radius 0; the voice
     transport draws its own surface and keeps the text gutter. Gated on the
     first url so a mislabeled row can never full-bleed an unavailable-media
     box. */
  const framed = post.type !== 'VOICE_POST' && !!post.media?.[0]?.url

  /* The ledger's end group. Zeroes are never printed — "0 comments · 0 shares"
     is noise, not a stat — so the string is empty when nothing has happened
     and the whole row stands down. */
  const tally = [
    post.comments > 0 ? `${formatCount(post.comments)} ${post.comments === 1 ? 'comment' : 'comments'}` : null,
    post.shares > 0 ? `${formatCount(post.shares)} ${post.shares === 1 ? 'share' : 'shares'}` : null,
    post.views > 0 ? `${formatCount(post.views)} ${post.views === 1 ? 'view' : 'views'}` : null,
  ].filter(Boolean).join(' · ')
  const hasLedger = post.likes > 0 || !!tally

  return (
    <View style={[feedPlate, styles.card, { backgroundColor: c.surface, borderColor: c.separator }]}>
      {isExplore ? (
        <View style={styles.provenance}>
          <Icon name="sparkle" size={13} color={c.textMuted} />
          <Text variant="footnote" tone="muted" style={styles.flex}>Suggested for you</Text>
          {onFollow ? (
            <Button
              label={followed ? 'Following' : 'Follow'}
              onPress={() => onFollow(post.author)}
              variant={followed ? 'secondary' : 'tinted'}
              size="sm"
            />
          ) : null}
        </View>
      ) : null}

      <AuthorRow
        author={post._author}
        time={post.time}
        visibility={post.visibility}
        size={40}
        onPress={onPressAuthor ? () => onPressAuthor(post.author) : undefined}
        onMenu={onMenu ? () => onMenu(post) : undefined}
        style={styles.author}
      />

      <PostBody
        text={post.body}
        numberOfLines={compact ? 4 : 8}
        onPress={() => onPress?.(post)}
        onLongPress={onMenu ? () => onMenu(post) : undefined}
        onPressTag={onPressTag}
        onPressMention={onPressMention}
        style={styles.body}
      />

      {/* A VOICE_POST always shows its transport — a feed row can arrive with
          the audio url missing, and the player resolves it on the first tap
          (a voice post reduced to its caption reads as data loss). */}
      {post.media?.length || post.audioUrl || post.type === 'VOICE_POST' ? (
        <View style={[styles.mediaWrap, framed ? null : styles.mediaInset]}>
          {/* PostMedia letterboxes and clips itself. Framed media takes the
              plate's own edge (radius 0); the voice transport keeps the
              in-card uniform radius because it sits inside the gutter. */}
          <PostMedia
            media={post.media}
            postType={post.type}
            audioUrl={post.audioUrl}
            postId={String(post.id)}
            overlayUrl={post.overlayUrl}
            soundName={post.soundName}
            radius={framed ? 0 : t.radius.xs}
            autoplay={!!isActiveVideo && !held}
            muted={muted}
            onToggleMute={onToggleMute}
            onPress={onMediaPress}
            onLongPress={onMenu ? () => onMenu(post) : undefined}
          />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.burst, burstStyle]}>
            <Icon name="heart" size={96} color={c.overlayText} filled />
          </Animated.View>
          {held ? <ModerationBadge item={post} kind="POST" refetch={refetch} onCleared={onModerationCleared} style={styles.badgeOverMedia} /> : null}
        </View>
      ) : held ? (
        <ModerationBadge item={post} kind="POST" refetch={refetch} onCleared={onModerationCleared} style={styles.badgeInline} />
      ) : null}

      {footnote ? (
        <Text variant="caption" caps={false} tone="muted" align="ui" style={styles.footnote}>{footnote}</Text>
      ) : null}

      {/* THE LEDGER: what the post earned, on one line — the reaction bubble
          and its total on the start edge, the readable tally on the end edge.
          Tapping the tally opens the comments, which is where a reader who
          reads a number goes next. Absent entirely at zero engagement. */}
      {hasLedger ? (
        <View style={styles.ledger}>
          {post.likes > 0 ? (
            <View style={styles.reactions}>
              {/* A round badge at avatar scale, not a pill chip: the heart is
                  a face-sized mark on its own ground, which is the one round
                  thing the system sanctions. */}
              <View style={[styles.bubble, { backgroundColor: c.like }]}>
                <Icon name="heart" size={10} color={c.overlayText} filled />
              </View>
              {/* The chip bar's ±1 tick, in the ledger's own 400 voice — a
                  like used to snap here while every other surface animated. */}
              <Count value={post.likes} color={c.textSecondary} weight="400" />
            </View>
          ) : null}
          {tally ? (
            <Touchable
              onPress={onComment ? () => onComment(post) : () => onPress?.(post)}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel={tally}
              style={styles.tally}
            >
              <NumericText variant="footnote" caps={false} tone="muted" numberOfLines={1}>{tally}</NumericText>
            </Touchable>
          ) : null}
        </View>
      ) : null}

      {/* The rule stands whether or not the ledger did: it is what separates
          reading from acting, and a bar that floats free of the body reads as
          part of the next card. */}
      <View style={[feedRule, hasLedger ? null : styles.ruleTop, { backgroundColor: c.separator }]} />

      <PostActions
        labels
        liked={post.liked}
        saved={post.saved}
        disabled={held}
        onLike={() => onLike?.(post)}
        onComment={() => (onComment ? onComment(post) : onPress?.(post))}
        onShare={() => onShare?.(post)}
        onSave={() => onSave?.(post)}
        onSaveLongPress={onSaveLongPress ? () => onSaveLongPress(post) : undefined}
        style={styles.actions}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  /* The plate's own padding. `shadowColor`/elevation in new code is a bug
     (DON'T #6) — the hairlines and the sunken seam do the separating. */
  card: { paddingTop: space.md, paddingBottom: space.xxs },
  flex: { flex: 1 },
  provenance: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: FEED_GUTTER, paddingBottom: space.sm2 },
  author: { paddingHorizontal: FEED_GUTTER },
  body: { paddingHorizontal: FEED_GUTTER, marginTop: space.sm2 },
  mediaWrap: { marginTop: space.md },
  /* Only the voice transport keeps the gutter — see `framed`. */
  mediaInset: { paddingHorizontal: FEED_GUTTER },
  burst: { alignItems: 'center', justifyContent: 'center' },
  badgeOverMedia: { position: 'absolute', top: 10, end: 10 },
  badgeInline: { marginTop: space.sm2, marginHorizontal: FEED_GUTTER },
  footnote: { paddingHorizontal: FEED_GUTTER, marginTop: space.sm },
  ledger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: FEED_GUTTER,
    paddingTop: space.md,
    paddingBottom: space.sm2,
  },
  reactions: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  bubble: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  /* The tally takes the rest of the line and closes it on the end edge. */
  tally: { flex: 1, alignItems: 'flex-end' },
  /* No ledger: the rule needs the breathing room the ledger would have given. */
  ruleTop: { marginTop: space.md },
  actions: { paddingHorizontal: space.xs },
})
