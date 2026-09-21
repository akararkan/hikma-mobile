/* =========================================================
   The four content cards a profile tab renders.

   Deliberately lighter than the feed's own cards: on a profile
   the author is the screen, so every row here drops the author
   plate and spends the space on the content instead.

   All four are React.memo'd and all four take an ITEM-FIRST
   `onPress` — `(item) => void`, not `() => void`. That is what
   lets ProfileView hand every row the same three functions
   instead of minting a closure per row: a fresh lambda in the
   prop makes the memo miss on every render, which is the whole
   cost the memo exists to avoid. Every expo-image also carries
   a `recyclingKey`, because FlashList hands a mounted row to the
   next item of its type and without one the previous poster
   keeps painting until the new source resolves.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { assetUrl, isRedactedText } from '@/api'
import {
  Callout, Card, Icon, Skeleton, Text, Touchable, formatCount,
} from '@/ui'

/* researchFrom / postFromFeedItem still hand back the web build's CSS
   shorthand for a cover (`center/cover no-repeat url("…")`), which means
   nothing to an <Image>. Pulling the url back out here beats changing an
   adapter that four other surfaces already read. */
export function bgUrl(css?: string | null): string | null {
  const m = /url\(["']?(.*?)["']?\)/.exec(String(css || ''))
  return m ? assetUrl(m[1]) : null
}

const HELD_STATUSES = new Set(['PENDING_REVIEW', 'HELD', 'UNDER_REVIEW'])

/* ---------------------------------------------------------
   Post
   --------------------------------------------------------- */

export const PostCard = React.memo(function PostCard({ post, onPress }: { post: any; onPress?: (post: any) => void }) {
  const t = useTheme()
  const held = HELD_STATUSES.has(String(post?.status || ''))
  const redacted = isRedactedText(post?.body)
  const thumb = post?.media?.[0]?.poster || post?.media?.[0]?.url || null
  const press = React.useCallback(() => onPress?.(post), [onPress, post])

  return (
    /* Card, not a hairline row: the profile's four tabs share one card
       language now (research always had it) — the page reads as a body of
       work instead of a bare index. */
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
      <Touchable onPress={press} feedback="scale" noAutoHitSlop disabled={held || !onPress}>
        <Card variant="outlined">
          <View style={[styles.postRow, { padding: space.md2, gap: space.md }]}>
            <View style={styles.flex}>
              {held ? (
                <Callout tone="warning" icon="hourglass" style={{ marginBottom: space.sm }}>
                  Checking this post before it goes public.
                </Callout>
              ) : null}

              {redacted ? (
                <Text variant="body" tone="muted" italic align="ui">This post was removed by moderation.</Text>
              ) : post?.body ? (
                <Text variant="body" numberOfLines={4} align="auto">{post.body}</Text>
              ) : (
                <Text variant="body" tone="faint" align="ui">Media post</Text>
              )}

              {!held ? (
                <View style={[styles.metaRow, { marginTop: space.sm }]}>
                  <Text variant="caption" tone="faint">{post?.time}</Text>
                  <Metric icon="heart" value={post?.likes} />
                  <Metric icon="comment" value={post?.comments} />
                  {post?.views ? <Metric icon="eye" value={post.views} /> : null}
                </View>
              ) : null}
            </View>

            {thumb ? (
              /* No `transition` on an 84pt thumb: the cross-fade never
                 completes on a flick and it keeps a second bitmap alive
                 while it runs. */
              <Image
                source={{ uri: assetUrl(thumb) }}
                recyclingKey={String(post?.id ?? thumb)}
                style={[styles.thumb, { borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceSunken }]}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : null}
          </View>
        </Card>
      </Touchable>
    </View>
  )
})

/* ---------------------------------------------------------
   Reel tile — the 3-column grid.
   --------------------------------------------------------- */

export const ReelTile = React.memo(function ReelTile({ reel, onPress }: { reel: any; onPress?: (reel: any) => void }) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const size = Math.floor((width - 4) / 3)
  const poster = reel?.media?.[0]?.poster || reel?.media?.[0]?.url || null
  const press = React.useCallback(() => onPress?.(reel), [onPress, reel])

  return (
    <Touchable onPress={press} feedback="dim" noAutoHitSlop style={{ padding: space.xxs }}>
      <View style={{ width: size - 2, height: Math.round((size - 2) * 1.6), backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
        {poster ? (
          /* Grid tile: recyclingKey so a flick never shows the last reel's
             poster, and no transition — three columns of cross-fade is churn
             the reader never sees finish. */
          <Image
            source={{ uri: assetUrl(poster) }}
            recyclingKey={String(reel?.id ?? poster)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.center}><Icon name="reels" size={22} color={t.colors.textFaint} /></View>
        )}
        <View style={styles.tileFoot}>
          <Icon name="play" size={12} color={t.colors.overlayText} filled />
          <Text variant="micro" color={t.colors.overlayText}>{formatCount(reel?.views ?? 0)}</Text>
        </View>
      </View>
    </Touchable>
  )
})

/* ---------------------------------------------------------
   Research
   --------------------------------------------------------- */

export const ResearchCard = React.memo(function ResearchCard({ item, onPress }: { item: any; onPress?: (item: any) => void }) {
  const t = useTheme()
  const cover = bgUrl(item?.cover)
  const press = React.useCallback(() => onPress?.(item), [onPress, item])

  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
      <Touchable onPress={press} feedback="scale" noAutoHitSlop>
        <Card variant="outlined" style={{ overflow: 'hidden' }}>
          {cover ? (
            /* The one image here big enough for the fade to read, so it keeps
               its transition — but it still needs the recycling key. */
            <Image
              source={{ uri: cover }}
              recyclingKey={String(item?.id ?? cover)}
              style={{ height: 132, backgroundColor: t.colors.surfaceSunken }}
              contentFit="cover"
              transition={160}
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={{ padding: space.md2, gap: space.xs2 }}>
            <View style={styles.metaRow}>
              <Icon name="research" size={13} color={t.colors.scholar} />
              <Text variant="micro" tone="scholar">Research</Text>
              {item?.status && item.status !== 'PUBLISHED' ? (
                <Text variant="micro" tone="muted">· {String(item.status).replace(/_/g, ' ')}</Text>
              ) : null}
            </View>
            <Text variant="title3" numberOfLines={2} align="auto">{item?.title || 'Untitled research'}</Text>
            {item?.abstract ? (
              <Text variant="subhead" tone="secondary" numberOfLines={3} align="auto">{item.abstract}</Text>
            ) : null}
            <View style={[styles.metaRow, { marginTop: space.xs }]}>
              <Text variant="caption" tone="faint">{item?.time}</Text>
              <Metric icon="eye" value={item?.metrics?.views} />
              <Metric icon="cite" value={item?.metrics?.citations} />
              <Metric icon="download" value={item?.metrics?.downloads} />
            </View>
          </View>
        </Card>
      </Touchable>
    </View>
  )
})

/* ---------------------------------------------------------
   Question
   --------------------------------------------------------- */

export const QuestionCard = React.memo(function QuestionCard({ item, onPress }: { item: any; onPress?: (item: any) => void }) {
  const t = useTheme()
  const press = React.useCallback(() => onPress?.(item), [onPress, item])
  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
      <Touchable onPress={press} feedback="scale" noAutoHitSlop>
        <Card variant="outlined">
          <View style={{ padding: space.md2, gap: space.xs2 }}>
            <View style={styles.metaRow}>
              <Icon name="qna" size={13} color={t.colors.accent} />
              <Text variant="micro" tone="accent">Question</Text>
              {item?.hasAcceptedAnswer ? (
                <>
                  <Icon name="checkCircle" size={13} color={t.colors.link} filled />
                  <Text variant="micro" tone="accent">Answered</Text>
                </>
              ) : null}
              {item?.answersLocked ? <Icon name="lock" size={12} color={t.colors.textFaint} /> : null}
            </View>
            <Text variant="bodyStrong" numberOfLines={2} align="auto">{item?.title || 'Untitled question'}</Text>
            {item?.body ? <Text variant="subhead" tone="muted" numberOfLines={2} align="auto">{item.body}</Text> : null}
            <View style={[styles.metaRow, { marginTop: space.xs }]}>
              <Text variant="caption" tone="faint">{item?.time}</Text>
              <Metric icon="comment" value={item?.answers} />
              <Metric icon="eye" value={item?.views} />
            </View>
          </View>
        </Card>
      </Touchable>
    </View>
  )
})

/* ---------------------------------------------------------
   Shared bits
   --------------------------------------------------------- */

/* Memoized on two scalars — three or four of these ride every card, and a
   recycled row that only changed its counts should repaint just the counts. */
const Metric = React.memo(function Metric({ icon, value }: { icon: any; value?: number | null }) {
  const t = useTheme()
  if (!value) return null
  return (
    <View style={styles.metric}>
      <Icon name={icon} size={12} color={t.colors.textFaint} />
      <Text variant="caption" tone="faint">{formatCount(value)}</Text>
    </View>
  )
})

/** The skeleton for whichever tab is loading, shaped like its real content. */
export function TabSkeleton({ grid }: { grid?: boolean }) {
  const t = useTheme()
  const { width } = useWindowDimensions()

  if (grid) {
    const size = Math.floor((width - 4) / 3)
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 9 }, (_, i) => (
          <View key={i} style={{ padding: space.xxs }}>
            <Skeleton width={size - 2} height={Math.round((size - 2) * 1.6)} radius={0} />
          </View>
        ))}
      </View>
    )
  }

  return (
    <View>
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} style={{ paddingHorizontal: t.layout.screenPadding, paddingVertical: space.md2, flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width="92%" height={12} />
            <Skeleton width="74%" height={12} />
            <Skeleton width="38%" height={10} />
          </View>
          <Skeleton width={76} height={76} radius={t.radius.sm} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  postRow: { flexDirection: 'row', alignItems: 'flex-start' },
  thumb: { width: 84, height: 84 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tileFoot: {
    position: 'absolute', bottom: 5, start: 6,
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
  },
})
