/* =========================================================
   FeedCard — the dispatcher, and the course that settles.

   Branches on `item.kind`, which the adapter has already
   resolved from `entityType` (a null/unknown type reads as
   POST for pre-migration rows). Nothing here re-reads
   entityType, and nothing here re-sorts: ranking and diversity
   are server decisions and a client that second-guesses them
   fights the re-ranker and breaks pagination.

   The one visual thing this file owns is the COURSE SETTLE
   entrance (DESIGN.md §7.2): the first screenful of rows —
   eight, ever — drops 6pt onto the brick spring, 24ms apart,
   like courses tapped into a wall. The budget is module-scoped
   and never refunded, and the claimed slot lives in a ref
   (§7.2's hasAnimated gate): FlashList recycling swaps props
   on a mounted instance and never remounts it, so `entering`
   cannot replay, and rows mounted after the budget is spent
   arrive already settled.

   Memoized, and the contract cuts both ways: the home list
   re-invokes renderItem for every visible row on any screen
   render, so the caller must pass identity-stable handlers and
   per-row scalars (`followed` is a boolean, not the Set) or
   the memo is decoration.
   ========================================================= */
import React from 'react'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { motion } from '@/theme/tokens'
import { PostCard } from './PostCard'
import { ResearchCard } from './ResearchCard'
import { QuestionCard } from './QuestionCard'
import { ChannelPostCard } from './ChannelPostCard'
import type {
  ChannelPostView, FeedItem, PostView, QuestionFeedView, ResearchFeedView,
} from './types'

/* COURSE SETTLE budget: only the first screenful of feed rows the app ever
   mounts animates in. Never reset, so returning to the feed is a cut, not a
   replay. -1 = the budget is spent; render settled. */
let settleNext = 0
function takeSettleSlot(): number {
  return settleNext < 8 ? settleNext++ : -1
}

export interface FeedCardProps {
  item: FeedItem
  onLike?: (post: PostView) => void
  onSave?: (post: PostView) => void
  onSaveLongPress?: (post: PostView) => void
  onShare?: (post: PostView) => void
  onComment?: (post: PostView) => void
  onMenu?: (post: PostView) => void
  onFollow?: (authorId: string) => void
  /** Whether the viewer follows this row's author. A boolean computed by the
   *  caller — handing every row the whole Set would re-render the entire feed
   *  on any follow. */
  followed?: boolean
  /** One handler for every kind — the caller owns the routing table. */
  onPress?: (item: FeedItem) => void
  onPressAuthor?: (userId: string) => void
  onPressChannel?: (channelId: string) => void
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  isActiveVideo?: boolean
  muted?: boolean
  onToggleMute?: () => void
  onModerationCleared?: (fresh: any) => void
  /** Re-read one post after a moderation hold clears. Takes the id so the
   *  list can hand every row the same stable function. */
  refetch?: (id: string) => Promise<any>
}

export const FeedCard = React.memo(function FeedCard({
  item, onLike, onSave, onSaveLongPress, onShare, onComment, onMenu, onFollow, followed,
  onPress, onPressAuthor, onPressChannel, onPressTag, onPressMention,
  isActiveVideo, muted, onToggleMute, onModerationCleared, refetch,
}: FeedCardProps) {
  const t = useTheme()

  /* Hooks stay above the switch (React's rule); only the default branch uses
     this. Memoized so PostCard's own memo survives a FeedCard re-render. */
  const refetchRow = React.useMemo(
    () => (refetch ? () => refetch(String(item.id)) : undefined),
    [refetch, item.id],
  )

  /* Claimed once per mounted instance, on first render — the ref is the
     recycle gate. `entering` only ever fires at mount, so a recycled row that
     changes item can never replay the settle. */
  const slotRef = React.useRef<number | null>(null)
  if (slotRef.current === null) slotRef.current = takeSettleSlot()
  const slot = slotRef.current

  const entering =
    slot < 0 ? undefined
      /* Reduced motion: every entrance degrades to a 120ms fade (§7). */
      : t.prefs.reducedMotion ? FadeIn.duration(120)
        : FadeInDown.springify()
            .damping(motion.spring.damping)
            .stiffness(motion.spring.stiffness)
            .mass(motion.spring.mass)
            .withInitialValues({ transform: [{ translateY: 6 }] })
            .delay(slot * 24)

  let card: React.ReactElement
  switch (item.kind) {
    case 'RESEARCH':
      card = (
        <ResearchCard
          item={item as ResearchFeedView}
          onPress={onPress as ((i: ResearchFeedView) => void) | undefined}
          onPressAuthor={onPressAuthor}
        />
      )
      break

    case 'QUESTION':
      card = (
        <QuestionCard
          item={item as QuestionFeedView}
          onPress={onPress as ((i: QuestionFeedView) => void) | undefined}
          onPressAuthor={onPressAuthor}
        />
      )
      break

    case 'CHANNEL_POST':
      card = (
        <ChannelPostCard
          item={item as ChannelPostView}
          onPress={onPress as ((i: ChannelPostView) => void) | undefined}
          onPressChannel={onPressChannel}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
          isActiveVideo={isActiveVideo}
          muted={muted}
          onToggleMute={onToggleMute}
        />
      )
      break

    default: {
      const post = item as PostView
      card = (
        <PostCard
          post={post}
          followed={followed}
          onFollow={onFollow}
          onLike={onLike}
          onSave={onSave}
          onSaveLongPress={onSaveLongPress}
          onShare={onShare}
          onComment={onComment}
          onMenu={onMenu}
          onPress={onPress as ((i: PostView) => void) | undefined}
          onPressAuthor={onPressAuthor}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
          isActiveVideo={isActiveVideo}
          muted={muted}
          onToggleMute={onToggleMute}
          onModerationCleared={onModerationCleared}
          refetch={refetchRow}
        />
      )
    }
  }

  return <Animated.View entering={entering}>{card}</Animated.View>
})
