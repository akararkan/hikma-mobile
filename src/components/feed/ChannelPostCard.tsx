/* =========================================================
   ChannelPostCard — a broadcast, not a post.

   Three contract traps, all of them silent if you get them
   wrong:

   · `author` is NULL. The CHANNEL signs a broadcast, so nothing
     here may fall back to an author plate — a fallback renders
     every channel card as "Member".
   · `id` is a synthetic uuid for list keys only. The real
     message id is `channelPostId`, a snowflake that does not
     survive a JS double: it stays a STRING through router
     params, Sets and api.channels.markViews.
   · The counters are re-pointed — shareCount means FORWARDS,
     commentCount means discussion-group comments, and there are
     no likes or saves at all.

   Visually a STELE (DESIGN.md §6): surface plate, setback
   corners, one course border, and a lapis SELVEDGE at the
   start edge carrying the broadcast identity (one selvedge
   per card, never more). The channel row is divided from the
   body by the WEFT DASH.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Selvedge, Text, Touchable, VerifiedMark, WeftDash } from '@/ui'
import { PostBody } from '@/components/post/PostBody'
import { PostMedia } from '@/components/post/PostMedia'
import { PostActions } from '@/components/post/PostActions'
import type { ChannelPostView } from './types'
import { FEED_GUTTER } from './plate'

export interface ChannelPostCardProps {
  item: ChannelPostView
  onPress?: (item: ChannelPostView) => void
  onPressChannel?: (channelId: string) => void
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  isActiveVideo?: boolean
  muted?: boolean
  onToggleMute?: () => void
}

/* Memoized: a feed row must survive unrelated list renders untouched — the
   caller's handlers have to be identity-stable for this to hold. */
export const ChannelPostCard = React.memo(function ChannelPostCard({
  item, onPress, onPressChannel, onPressTag, onPressMention,
  isActiveVideo, muted = true, onToggleMute,
}: ChannelPostCardProps) {
  const t = useTheme()
  const c = t.colors
  const ch = item.channel

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <Selvedge color={c.accent} />

      <View style={styles.head}>
        <Avatar
          uri={ch?.avatarUrl}
          name={ch?.title}
          seed={ch?.id}
          size={40}
          square
          onPress={onPressChannel && ch ? () => onPressChannel(ch.id) : undefined}
        />
        <Touchable
          onPress={onPressChannel && ch ? () => onPressChannel(ch.id) : undefined}
          disabled={!onPressChannel || !ch}
          feedback="dim"
          noAutoHitSlop
          style={styles.flex}
        >
          <View style={styles.nameLine}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{ch?.title || 'Channel'}</Text>
            {ch?.verified ? <VerifiedMark size={14} /> : null}
          </View>
          <View style={styles.subLine}>
            <Icon name="broadcast" size={11} color={c.textMuted} />
            <Text variant="footnote" tone="muted" numberOfLines={1}>
              Channel{ch?.handle ? ` · @${ch.handle}` : ''} · {item.time}
            </Text>
          </View>
        </Touchable>
      </View>

      <WeftDash style={styles.dash} />

      <PostBody
        text={item.body}
        numberOfLines={8}
        onPress={() => onPress?.(item)}
        onPressTag={onPressTag}
        onPressMention={onPressMention}
        style={styles.body}
      />

      {item.media?.length ? (
        <PostMedia
          media={item.media}
          autoplay={!!isActiveVideo}
          muted={muted}
          onToggleMute={onToggleMute}
          onPress={() => onPress?.(item)}
          radius={0}
          style={styles.media}
        />
      ) : null}

      <PostActions
        variant="channel"
        views={item.views}
        shares={item.shares}
        comments={item.comments}
        style={styles.actions}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  card: {
    paddingTop: space.md,
    paddingBottom: space.xxs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',   /* keeps the selvedge inside the plate */
  },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: FEED_GUTTER },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
  dash: { marginTop: space.sm2, marginHorizontal: FEED_GUTTER },
  body: { paddingHorizontal: FEED_GUTTER, marginTop: space.sm2 },
  media: { marginTop: space.md },
  actions: { marginTop: space.sm, marginHorizontal: FEED_GUTTER },
})
