/* =========================================================
   Post detail.

   The post block is the list's header, so it scrolls away
   under the comments instead of pinning a screenful of media
   above a thread nobody can reach.

   Realtime is the interesting part. The per-post SSE channel
   carries DELTAS, never counter values, and the server skips
   the actor's own subscription — so your own like never comes
   back and there is no echo to filter. Everything counter-
   shaped routes through `applyPostDelta`, and `connected` is a
   RECONCILE signal (it fires on every reconnect, and anything
   emitted while we were down is simply gone), which is why it
   re-reads the post and page 1 of comments rather than just
   logging a handshake.

   Comments page on the raw `createdAt` cursor — the adapter
   carries it since the one-field fix the spec called for.

   Row plumbing follows the home feed's rule: FlashList compares
   `renderItem` BY IDENTITY inside its cell memo, so every
   handler a row gets is `useEvent`-stable and item-taking (one
   function serves the whole thread instead of eight closures per
   comment), and the header block is a memoized element rather
   than a freshly-built one. Expanded replies flatten into the
   list as their own rows — the reply endpoint returns up to 100
   at once (the server clamp), and 100 CommentRows nested in the
   parent's cell is one commit and a hole recycling can't reach.
   The expand state rides the row objects, never `renderItem`.
   ========================================================= */
import React from 'react'
import { AppState, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import {
  api, applyPostDelta, codeOf, errorText, isNotFound, isRateLimited,
} from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAfterInteractions } from '@/hooks/useAfterInteractions'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useRealtime } from '@/hooks/useRealtime'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Divider, EmptyState, ErrorState, Header, Icon, InlineError,
  ListFooter, NumericText, Screen, Skeleton, Text, Touchable, formatCount, toast,
} from '@/ui'
import { putReelOpen } from '@/components/reels/reelInbox'
import { AuthorRow } from '@/components/post/AuthorRow'
import { PostBody } from '@/components/post/PostBody'
import { PostMedia, VoicePlayer } from '@/components/post/PostMedia'
import { PostActions } from '@/components/post/PostActions'
import { CommentRow, ReplyGuide, type GuideSegment } from '@/components/post/CommentRow'
import { CommentComposer } from '@/components/post/CommentComposer'
import { EditCommentSheet } from '@/components/post/EditCommentSheet'
import { ModerationBadge } from '@/components/post/ModerationBadge'
import { PostMenuSheet, type PostMenuTarget } from '@/components/post/PostMenuSheet'
import { FollowButton } from '@/components/profile/FollowButton'
import { useSocialStatus, type SocialStatus } from '@/components/profile/useSocialStatus'
import { useEngagement } from '@/components/post/useEngagement'
import { isBlocked, moderationText } from '@/lib/moderation'
import { takeEditedPost } from '@/components/feed/feedInbox'
import { albumToMedia, mmss } from '@/components/post/albumMedia'
import { MediaLightbox, type LightboxItem } from '@/components/qna/MediaLightbox'
import type { CommentView, FeedMedia, PostView } from '@/components/feed/types'

/* The list's row unit. A reply is a ROW, not a child of the parent's cell —
   expand state and guide geometry are baked in here so the cells depend on
   nothing but their item. */
type ThreadRow =
  | { kind: 'comment'; comment: CommentView; repliesOpen: boolean; repliesLoading: boolean }
  | { kind: 'reply'; comment: CommentView; guide: GuideSegment }

/* Snowflakes (and tmp: ids) are globally unique across both depths, so the
   comment's own id keys either row kind. */
const keyExtractor = (row: ThreadRow) => String(row.comment.id)

/* Comment and reply cells differ in layout — separate recycling pools, or a
   vacated parent cell gets rebound into the indented shape. */
const getItemType = (row: ThreadRow) => row.kind

export default function PostDetailScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>()
  const { user } = useAuth()

  const listRef = React.useRef<FlashListRef<ThreadRow>>(null)
  const inputRef = React.useRef<TextInput | null>(null)

  /* The transition gate. It covers the COMMENTS only. The post read and the
     album read both draw the block the user came here to look at, and a
     detail screen whose subject is a skeleton for an extra 240ms has traded
     jank for looking broken. This screen is pushed, so it pays the full
     slide_from_right every time — the thread is the one thing on it that can
     honestly wait for the end of that. */
  const ready = useAfterInteractions()

  const post = useAsync<PostView>(() => api.posts.get(id), { enabled: !!id, deps: [id] })

  /* The album is its own table and its own authority: media.md §2 says
     posts_by_id.mediaUrls is NOT rewritten when a carousel is edited, so the
     inline list can be stale, and only this read carries alt text and clip
     durations. A post with no album answers 200 + [] — that is not a failure,
     it just means the inline list is the whole truth, so any empty or failed
     result falls back to it silently. */
  const album = useAsync<any[]>(() => api.posts.media.list(id), { enabled: !!id, deps: [id] })

  /* `commentFrom` now carries `createdAt`, which is the wire's cursor — so the
     thread pages instead of truncating at the first response. */
  const commentCursor = React.useRef<string | null>(null)
  const [commentsDone, setCommentsDone] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const comments = useAsync<CommentView[]>(() => api.posts.comments(id, { pageSize: 50 }), {
    enabled: !!id && ready,
    deps: [id],
    onSuccess: (rows: CommentView[]) => {
      commentCursor.current = rows?.length ? rows[rows.length - 1]?.createdAt ?? null : null
      setCommentsDone(!rows?.length || !commentCursor.current)
    },
  })

  const loadMoreComments = async () => {
    if (commentsDone || loadingMore || comments.loading || !commentCursor.current) return
    setLoadingMore(true)
    try {
      const rows: CommentView[] = await api.posts.comments(id, { cursor: commentCursor.current, pageSize: 50 })
      comments.setData(list => {
        const seen = new Set((list || []).map(r => r.id))
        return [...(list || []), ...(rows || []).filter(r => !seen.has(r.id))]
      })
      commentCursor.current = rows?.length ? rows[rows.length - 1]?.createdAt ?? null : null
      setCommentsDone(!rows?.length || !commentCursor.current)
    } catch { /* the loaded rows stay; the footer simply stops */ }
    finally { setLoadingMore(false) }
  }

  const [draft, setDraft] = React.useState('')
  const [replyTo, setReplyTo] = React.useState<CommentView | null>(null)
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [openReplies, setOpenReplies] = React.useState<Record<string, CommentView[] | 'loading'>>({})
  const [scrolled, setScrolled] = React.useState(false)
  const [menuTarget, setMenuTarget] = React.useState<PostMenuTarget | null>(null)
  const [editTarget, setEditTarget] = React.useState<PostMenuTarget | null>(null)

  const data = post.data

  /* A reel is never read here. Liked rows, saved grids, notifications, search
     hits, push taps and share links all address a post by id without knowing
     its type, so this screen is where a reel is discovered — and a reel
     belongs in the immersive viewer, which back-fills the for-you feed
     behind it so the user keeps swiping (the way /reels/[id] hands a
     NON-reel back to us). `replace`, not push: Back must return to where the
     tap happened, never to a detail page that was only ever a doorway. */
  const isReel = String(data?.type ?? '').toUpperCase() === 'REEL'
  React.useEffect(() => {
    if (isReel && data) {
      /* The reel is already in hand — the viewer opens on it without a second
         GET and without a frame of its own skeleton. */
      putReelOpen({ id: String(data.id), items: [data as any], index: 0 })
      router.replace({
        pathname: '/reels/[id]',
        params: { id: data.id, src: 'for-you', ...(focus === 'comment' ? { focus } : {}) },
      } as any)
    }
  }, [isReel, data, focus, router])

  /* Album wins when there is one; an empty album or a failed read means the
     inline `mediaUrls` list is all there is. Same precedence in the fullscreen
     viewer, or tapping page 3 would open a different list at index 3. */
  const mediaItems = React.useMemo<FeedMedia[]>(
    () => (album.data?.length ? albumToMedia(album.data) : (data?.media || [])),
    [album.data, data?.media],
  )
  const commentsError = comments.error
  const isAuthor = !!data && !!user?.id && String(data.author) === String(user.id)
  const held = !!data && data.status === 'PENDING_REVIEW'

  /* The relationship is NOT on the post payload — social-status is the only
     source, and it is shared with the profile this screen pushes to, so the
     two never disagree and neither refetches. */
  const rel = useSocialStatus(isAuthor ? null : data?.author)

  /* ---------- realtime ---------- */

  const reconcile = useEvent(() => {
    void post.reload()
    void comments.reload()
  })

  useRealtime('posts', id, {
    onConnected: reconcile,
    onEvent: (evt: any) => {
      /* COMMENT_DELETED on a TOP-LEVEL comment takes its replies with it —
         the client delta is −(1 + its replyCount) (realtime.md §3). The frame
         carries no reply count, so the extra decrement comes from the local
         row, read BEFORE applyCommentEvent removes it; applyPostDelta covers
         the −1. A reply target is not in `comments` and matches nothing. */
      if (evt?.eventType === 'COMMENT_DELETED' && evt.commentId) {
        const removed = (comments.data || []).find(cm => cm.id === String(evt.commentId))
        if (removed?.replyCount) {
          post.setData(p => (p ? { ...p, comments: Math.max(0, (p.comments || 0) - removed.replyCount) } : p))
        }
      }
      post.setData(p => (p ? applyPostDelta(p, evt) : p))
      applyCommentEvent(evt, comments.setData, setOpenReplies)
      if (evt?.eventType === 'POST_UPDATED') void post.reload()
    },
  })

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') reconcile() })
    return () => sub.remove()
  }, [reconcile])

  /* One view per visit, after a beat so a back-swipe out of a mis-tap does not
     count. Fire-and-forget: `counted` is informational and deduped server-side
     over a 7-day window. */
  React.useEffect(() => {
    if (!id) return
    const timer = setTimeout(() => { api.posts.recordView(id).catch(() => {}) }, 600)
    return () => clearTimeout(timer)
  }, [id])

  React.useEffect(() => {
    const edited = takeEditedPost()
    if (edited && String(edited.id) === String(id)) post.setData(p => ({ ...(p as PostView), ...edited }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  React.useEffect(() => {
    if (focus === 'comment') setTimeout(() => inputRef.current?.focus(), 350)
  }, [focus])

  /* ---------- engagement ---------- */

  const patch = React.useCallback((_id: string, fn: (p: any) => any) => {
    post.setData(p => (p ? fn(p) : p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { toggleLike, toggleSave } = useEngagement<any>(patch)

  /* ---------- comments ---------- */

  const send = async () => {
    const text = draft.trim()
    if (!text || sending || cooldown > 0) return
    setSending(true)
    setSendError(null)
    const tempId = `tmp:${Date.now()}`
    const optimistic: CommentView = {
      id: tempId,
      author: String(user?.id || ''),
      _author: {
        id: String(user?.id || ''),
        full: user?.displayName || user?.full || 'You',
        handle: user?.handle || '',
        initials: '',
        avc: '',
        profileImage: user?.profileImage ?? null,
        verified: !!user?.verified,
        role: user?.role || 'MEMBER',
      },
      body: text,
      time: 'now',
      likes: 0,
      liked: false,
      replyCount: 0,
      parentCommentId: replyTo ? (replyTo.parentCommentId || replyTo.id) : null,
      replyToCommentId: replyTo?.id ?? null,
      replyToUserId: replyTo?.author ?? null,
      _replyToHandle: replyTo?._author?.handle ?? null,
      pending: true,
    }

    const target = replyTo
    setDraft('')
    setReplyTo(null)
    if (target) {
      /* A reply is hoisted server-side to a sibling of the TOP-LEVEL ancestor,
         so it belongs under that ancestor, not under the row that was tapped. */
      const anchor = target.parentCommentId || target.id
      setOpenReplies(prev => {
        const list = prev[anchor]
        return Array.isArray(list) ? { ...prev, [anchor]: [...list, optimistic] } : prev
      })
    } else {
      comments.setData(list => [...(list || []), optimistic])
    }

    try {
      const row: any = target
        ? await api.posts.addReply(target.id, { text })
        : await api.posts.addComment(id, { text })

      if (target) {
        const anchor = row.parentCommentId || target.parentCommentId || target.id
        setOpenReplies(prev => {
          const list = prev[anchor]
          if (!Array.isArray(list)) return prev
          return { ...prev, [anchor]: list.map(r => (r.id === tempId ? row : r)) }
        })
        comments.setData(list => (list || []).map(cm => (cm.id === anchor ? { ...cm, replyCount: cm.replyCount + 1 } : cm)))
      } else {
        comments.setData(list => (list || []).map(cm => (cm.id === tempId ? row : cm)))
      }
      post.setData(p => (p ? { ...p, comments: (p.comments || 0) + 1 } : p))
    } catch (e: any) {
      /* Keep the draft verbatim in every failure mode — a blocked comment that
         also eats what you typed is two punishments for one refusal. */
      setDraft(text)
      setReplyTo(target)
      removeRow(tempId, comments.setData, setOpenReplies)
      if (isRateLimited(e)) {
        startCooldown(e)
        setSendError(errorText(e))
      } else if (isBlocked(e) || codeOf(e) === 'CONTENT_UNDER_REVIEW') {
        /* Verbatim, no retry button, and never a hint about what tripped. */
        setSendError(moderationText(e))
      } else {
        setSendError(errorText(e))
      }
    } finally {
      setSending(false)
    }
  }

  const likeComment = async (cm: CommentView) => {
    const was = cm.liked
    patchComment(cm.id, r => ({ ...r, liked: !was, likes: Math.max(0, r.likes + (was ? -1 : 1)) }), comments.setData, setOpenReplies)
    try {
      const res: any = await api.posts.toggleCommentReaction(id, cm.id)
      const liked = !!res?.liked
      patchComment(cm.id, r => (r.liked === liked ? r : { ...r, liked, likes: Math.max(0, r.likes + (liked ? 1 : -1)) }), comments.setData, setOpenReplies)
    } catch (e) {
      patchComment(cm.id, r => ({ ...r, liked: was, likes: Math.max(0, r.likes + (was ? 1 : -1)) }), comments.setData, setOpenReplies)
      toast.error(errorText(e))
    }
  }

  const expandReplies = async (cm: CommentView) => {
    if (openReplies[cm.id]) {
      setOpenReplies(prev => { const { [cm.id]: _drop, ...rest } = prev; return rest })
      return
    }
    setOpenReplies(prev => ({ ...prev, [cm.id]: 'loading' }))
    try {
      /* No cursor exists on this endpoint — 100 is the server clamp and the
         whole thread. */
      const rows: any = await api.posts.replies(cm.id, { pageSize: 100 })
      setOpenReplies(prev => ({ ...prev, [cm.id]: rows || [] }))
    } catch (e) {
      setOpenReplies(prev => { const { [cm.id]: _drop, ...rest } = prev; return rest })
      toast.error(errorText(e))
    }
  }

  const startReply = (cm: CommentView) => {
    setReplyTo(cm)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  /* One shape for the top-level rows and the reply rows, so the menu can never
     offer a different vocabulary at the two depths. `parentCommentId` and
     `replyCount` are what let onDeleted settle both counters without hunting
     for a row it is about to drop. */
  const commentMenuTarget = (cm: CommentView): PostMenuTarget => ({
    id: cm.id,
    author: cm.author,
    _author: cm._author,
    targetType: 'COMMENT',
    postId: id,
    body: cm.body,
    parentCommentId: cm.parentCommentId ?? null,
    replyCount: cm.replyCount || 0,
  })

  /* ---------- row plumbing ----------
     One function per action for the WHOLE thread, item-taking and
     identity-stable, so renderItem survives a keystroke in the composer and
     CommentRow's memo can skip the rows nothing touched. */

  const onLikeComment = useEvent((cm: CommentView) => { void likeComment(cm) })
  const onReplyComment = useEvent((cm: CommentView) => startReply(cm))
  const onMenuComment = useEvent((cm: CommentView) => setMenuTarget(commentMenuTarget(cm)))
  const onExpandReplies = useEvent((cm: CommentView) => { void expandReplies(cm) })
  const onPressUser = useEvent((uid: string) => router.push(`/u/${uid}`))
  const onPressTag = useEvent((tag: string) => router.push(`/tags/${tag}`))
  const onPressMention = useEvent((h: string) => router.push(`/u/${h}`))

  const onLikePost = useEvent(() => { if (data) void toggleLike(data) })
  const onSavePost = useEvent(() => { if (data) void toggleSave(data) })
  const onSaveLongPress = useEvent(() => { if (data) router.push(`/post/${data.id}/save`) })
  const onSharePost = useEvent(() => { if (data) router.push(`/post/${data.id}/share`) })
  const onCommentPress = useEvent(() => inputRef.current?.focus())
  const onPressPostAuthor = useEvent(() => { if (data) router.push(`/u/${data.author}`) })
  const onPressMedia = useEvent((i: number) => {
    if (data) router.push({ pathname: '/post/[id]/media', params: { id: data.id, index: String(i) } })
  })
  const onPressShares = useEvent(() => { if (data) router.push(`/post/${data.id}/shares`) })
  const onModerationCleared = useEvent((fresh: any) => post.setData(p => ({ ...(p as PostView), ...fresh })))
  const refetchPost = useEvent(() => api.posts.get(id))
  const retryComments = useEvent(() => { void comments.reload() })

  /* The flattening. Everything `renderItem` would otherwise read from state —
     which partition is open, which is loading, where a reply sits in its run
     of the guide — is decided HERE and baked into the row objects, so the
     cells re-render only when a row they hold actually changed. */
  const rows = React.useMemo<ThreadRow[]>(() => {
    const out: ThreadRow[] = []
    for (const cm of comments.data || []) {
      const open = openReplies[cm.id]
      out.push({
        kind: 'comment',
        comment: cm,
        repliesOpen: Array.isArray(open),
        repliesLoading: open === 'loading',
      })
      if (Array.isArray(open)) {
        for (let i = 0; i < open.length; i++) {
          out.push({
            kind: 'reply',
            comment: open[i],
            guide: open.length === 1 ? 'only' : i === 0 ? 'first' : i === open.length - 1 ? 'last' : 'middle',
          })
        }
      }
    }
    return out
  }, [comments.data, openReplies])

  /* A comment's inline media opens in the shared lightbox rather than the
     post's own /media route: that route pages the POST's album by index, and a
     comment's picture is not in it. */
  const [lightbox, setLightbox] = React.useState<LightboxItem | null>(null)
  const onOpenCommentMedia = useEvent((uri: string) => {
    const row = (comments.data || []).find(cm => cm.mediaUrl === uri)
    setLightbox({ url: uri, kind: row?.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE' })
  })

  const renderItem = React.useCallback(({ item }: { item: ThreadRow }) => (
    item.kind === 'reply' ? (
      <ReplyGuide segment={item.guide}>
        <CommentRow
          comment={item.comment}
          isReply
          onLike={onLikeComment}
          onReply={onReplyComment}
          onMenu={onMenuComment}
          onPressAuthor={onPressUser}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
          onOpenMedia={onOpenCommentMedia}
        />
      </ReplyGuide>
    ) : (
      <CommentRow
        comment={item.comment}
        repliesOpen={item.repliesOpen}
        repliesLoading={item.repliesLoading}
        onLike={onLikeComment}
        onReply={onReplyComment}
        onMenu={onMenuComment}
        onPressAuthor={onPressUser}
        onExpandReplies={onExpandReplies}
        onPressTag={onPressTag}
        onPressMention={onPressMention}
        onOpenMedia={onOpenCommentMedia}
      />
    )
  ), [
    onLikeComment, onReplyComment, onMenuComment, onPressUser,
    onExpandReplies, onPressTag, onPressMention, onOpenCommentMedia,
  ])

  /* The header is the heaviest thing on the screen (media, actions, counters).
     Built once per post rather than once per render, or every keystroke in the
     composer would repaint the carousel. */
  const headerBlock = React.useMemo(() => (
    data ? (
      <View>
        <PostBlock
          post={data}
          mediaItems={mediaItems}
          held={held}
          isAuthor={isAuthor}
          followStatus={rel.status}
          onLike={onLikePost}
          onSave={onSavePost}
          onSaveLongPress={onSaveLongPress}
          onShare={onSharePost}
          onComment={onCommentPress}
          onPressAuthor={onPressPostAuthor}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
          onPressMedia={onPressMedia}
          onPressShares={onPressShares}
          onModerationCleared={onModerationCleared}
          refetch={refetchPost}
        />

        <View style={styles.sectionHead}>
          <Text variant="headline" style={styles.flex}>Comments</Text>
          {data.comments > 0 ? (
            <View style={[styles.countPlate, { backgroundColor: c.surfaceSunken }]}>
              <NumericText variant="caption" tone="muted">{formatCount(data.comments)}</NumericText>
            </View>
          ) : null}
          {/* The wire order is oldest-first and there is no sort parameter,
              so this is a label rather than a control. */}
          <Text variant="caption" tone="faint">Oldest first</Text>
        </View>

        {commentsError ? <InlineError error={commentsError} onRetry={retryComments} /> : null}
      </View>
    ) : null
  ), [
    data, held, isAuthor, rel.status, commentsError, c.surfaceSunken,
    onLikePost, onSavePost, onSaveLongPress, onSharePost,
    onCommentPress, onPressPostAuthor, onPressTag, onPressMention, onPressMedia,
    onPressShares, onModerationCleared, refetchPost, retryComments,
  ])

  /* ---------- render ---------- */

  /* The reel redirect above fires after this render — hold the skeleton so not
     a single frame of post-detail chrome is painted around a reel. */
  if (post.loading || isReel) {
    return (
      <Screen>
        <Header back title="Post" />
        <DetailSkeleton />
      </Screen>
    )
  }

  if (post.error && isNotFound(post.error)) {
    return (
      <Screen>
        <Header back title="Post" />
        <EmptyState
          icon="search"
          title="This post is no longer available"
          message="It may have been deleted by its author."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  if (post.error || !data) {
    return (
      <Screen>
        <Header back title="Post" />
        <ErrorState error={post.error} onRetry={() => { void post.reload() }} />
      </Screen>
    )
  }

  const list = comments.data || []

  return (
    <Screen>
      <Header
        back
        title="Post"
        border={scrolled}
        actions={[{
          icon: 'more',
          label: 'More',
          onPress: () => setMenuTarget({
            id: data.id, author: data.author, saved: data.saved, _author: data._author, targetType: 'POST',
          }),
        }]}
      />

      <FlashList
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        ListHeaderComponent={headerBlock}
        onScroll={e => {
          const y = e.nativeEvent.contentOffset.y
          if ((y > 8) !== scrolled) setScrolled(y > 8)
        }}
        scrollEventThrottle={32}
        contentContainerStyle={styles.listPad}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onEndReachedThreshold={0.5}
        onEndReached={() => { void loadMoreComments() }}
        ListFooterComponent={
          list.length && (!commentsDone || loadingMore) ? (
            <ListFooter loading={loadingMore} done={commentsDone} />
          ) : null
        }
        ListEmptyComponent={
          /* `!ready` counts as loading here on purpose: with the read gated,
             useAsync reports loading:false until it fires, and without this the
             thread would flash "No comments yet" for the length of the slide on
             a post that has fifty. */
          !ready || comments.loading ? (
            <View style={styles.commentSkeleton}>
              {[0, 1, 2].map(i => (
                <View key={i} style={styles.skelRow}>
                  <Skeleton circle width={32} height={32} />
                  <View style={styles.flex}>
                    <Skeleton width="38%" height={11} />
                    <Skeleton width="82%" height={11} style={{ marginTop: space.sm }} />
                  </View>
                </View>
              ))}
            </View>
          ) : comments.error ? null : (
            <Text variant="callout" tone="muted" align="center" style={styles.noComments}>
              No comments yet — be the first.
            </Text>
          )
        }
      />

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={{ paddingBottom: insets.bottom }}>
          <CommentComposer
            value={draft}
            onChange={v => { setDraft(v); if (sendError) setSendError(null) }}
            onSubmit={() => { void send() }}
            me={user as any}
            replyingTo={replyTo ? { handle: replyTo._author?.handle, id: replyTo.id } : null}
            onCancelReply={() => setReplyTo(null)}
            busy={sending}
            cooldown={cooldown}
            error={sendError}
            inputRef={inputRef}
          />
        </View>
      </KeyboardStickyView>

      <PostMenuSheet
        visible={!!menuTarget}
        onClose={() => setMenuTarget(null)}
        post={menuTarget}
        viewerId={user?.id}
        onSave={() => { void toggleSave(data) }}
        onReply={target => {
          /* A reply row is not in the top-level list — look through the open
             partitions too, or the menu's Reply is a no-op at depth 1. */
          const cm = list.find(x => x.id === target.id)
            ?? Object.values(openReplies).flatMap(v => (Array.isArray(v) ? v : [])).find(x => x.id === target.id)
          if (cm) startReply(cm)
        }}
        onEdit={target => {
          if (target.targetType === 'COMMENT') setEditTarget(target)
          else router.push(`/post/${target.id}/edit`)
        }}
        onDeleted={(deletedId, kind, target) => {
          if (kind === 'COMMENT') {
            const parentId = target?.parentCommentId ? String(target.parentCommentId) : null
            /* A top-level delete takes its replies with it — the counter comes
               down by the whole subtree. A REPLY is −1, but it also owes its
               ancestor a replyCount, or 'View 3 replies' outlives the third. */
            const drop = parentId ? 1 : 1 + (target?.replyCount ?? list.find(x => x.id === deletedId)?.replyCount ?? 0)
            removeRow(String(deletedId), comments.setData, setOpenReplies)
            if (parentId) decrementReplyCount(parentId, comments.setData, setOpenReplies)
            else dropReplyPartition(String(deletedId), setOpenReplies)
            post.setData(p => (p ? { ...p, comments: Math.max(0, (p.comments || 0) - drop) } : p))
          } else {
            router.back()
          }
        }}
      />

      <EditCommentSheet
        visible={!!editTarget}
        onClose={() => setEditTarget(null)}
        comment={editTarget ? { id: editTarget.id, body: editTarget.body || '' } : null}
        onSaved={(commentId, text) => {
          patchComment(commentId, r => ({ ...r, body: text, edited: true }), comments.setData, setOpenReplies)
        }}
        onGone={commentId => removeRow(commentId, comments.setData, setOpenReplies)}
      />

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The post block — the list's header.
   --------------------------------------------------------- */

function PostBlock({
  post, mediaItems, held, isAuthor, followStatus, onLike, onSave, onSaveLongPress, onShare, onComment,
  onPressAuthor, onPressTag, onPressMention, onPressMedia, onPressShares, onModerationCleared, refetch,
}: {
  post: PostView
  /** The album when the post has one, else the inline list. */
  mediaItems: FeedMedia[]
  held: boolean
  isAuthor: boolean
  /** Null until social-status lands — FollowButton draws a stand-in, never a
   *  hopeful "Follow" on someone already followed. */
  followStatus: SocialStatus | null
  onLike: () => void
  onSave: () => void
  onSaveLongPress: () => void
  onShare: () => void
  onComment: () => void
  onPressAuthor: () => void
  onPressTag: (tag: string) => void
  onPressMention: (handle: string) => void
  onPressMedia: (index: number) => void
  onPressShares: () => void
  onModerationCleared: (fresh: any) => void
  refetch: () => Promise<any>
}) {
  const t = useTheme()
  const c = t.colors

  return (
    <View style={styles.block}>
      <AuthorRow
        author={post._author}
        time={post.time}
        size={44}
        onPress={onPressAuthor}
        trailing={!isAuthor ? (
          <FollowButton userId={String(post.author)} status={followStatus} size="sm" />
        ) : undefined}
        style={styles.gutter}
      />

      {held ? (
        <ModerationBadge
          item={post}
          kind="POST"
          variant="strip"
          refetch={refetch}
          onCleared={onModerationCleared}
          style={[styles.gutter, { marginTop: space.md2 }]}
        />
      ) : null}

      <PostBody
        text={post.body}
        numberOfLines={0}
        selectable
        onPressTag={onPressTag}
        onPressMention={onPressMention}
        style={[styles.gutter, styles.bodyGap]}
      />

      {post.type === 'VOICE_POST' ? (
        /* Always the transport, even before a url is known — the player
           resolves the audio itself rather than degrading to caption-only. */
        <VoicePlayer url={post.audioUrl ?? null} postId={String(post.id)} style={[styles.gutter, styles.mediaGap]} />
      ) : mediaItems.length ? (
        <Carousel
          post={post}
          media={mediaItems}
          onPressPage={onPressMedia}
          style={styles.mediaGap}
        />
      ) : null}

      {post.sharedPostId ? <RepostEmbed id={post.sharedPostId} style={[styles.gutter, styles.mediaGap]} /> : null}

      <MetaRow post={post} style={[styles.gutter, styles.mediaGap]} />

      <View style={[styles.gutter, styles.counters]}>
        <Counter label="views" value={post.views} />
        <Counter label="likes" value={post.likes} />
        <Counter label="saves" value={post.saves} />
        <Counter label="shares" value={post.shares} onPress={post.shares ? onPressShares : undefined} />
      </View>

      {/* The rule above the bar as well as below it: the counters are the last
          thing to READ and the bar is the first thing to DO, and the same
          grammar governs the feed plate this screen was opened from. */}
      <Divider style={[styles.gutter, { marginTop: space.md, backgroundColor: c.separator }]} />
      <PostActions
        labels
        size="lg"
        liked={post.liked}
        saved={post.saved}
        disabled={held}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
        onSaveLongPress={onSaveLongPress}
        style={styles.actions}
      />
      <Divider style={{ backgroundColor: c.separator }} />
    </View>
  )
}

function Counter({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  if (!value) return null
  const body = (
    <Text variant="footnote" tone="muted">
      <NumericText variant="footnote" tone="secondary">{formatCount(value)}</NumericText> {label}
    </Text>
  )
  if (!onPress) return body
  return <Touchable onPress={onPress} feedback="dim" noAutoHitSlop>{body}</Touchable>
}

/* One formatter for the life of the app. `toLocaleString` with an options bag
   builds a fresh Intl.DateTimeFormat on every call — ICU pattern resolution
   on Hermes — and this line re-renders with the header. */
const STAMP = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
})

function MetaRow({ post, style }: { post: PostView; style?: any }) {
  const t = useTheme()
  const c = t.colors
  const absolute = post.createdAt ? STAMP.format(new Date(post.createdAt)) : ''
  const visLabel = post.visibility === 'FOLLOWERS' ? 'Followers' : post.visibility === 'ONLY_ME' ? 'Only me' : null

  return (
    <View style={[styles.meta, style]}>
      {absolute ? <Text variant="footnote" tone="faint">{absolute}</Text> : null}
      {post.location ? (
        <View style={styles.metaItem}>
          <Icon name="location" size={12} color={c.textFaint} />
          <Text variant="footnote" tone="faint">{post.location}</Text>
        </View>
      ) : null}
      {visLabel ? (
        <View style={[styles.visChip, { backgroundColor: c.surfaceSunken }]}>
          <Icon name={post.visibility === 'ONLY_ME' ? 'lock' : 'people'} size={11} color={c.textMuted} />
          <Text variant="micro" tone="muted">{visLabel}</Text>
        </View>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Media carousel. A feed row carries one slot; the detail read
   carries the whole album.
   --------------------------------------------------------- */

function Carousel({
  post, media, onPressPage, style,
}: { post: PostView; media: FeedMedia[]; onPressPage: (i: number) => void; style?: any }) {
  const t = useTheme()
  const c = t.colors
  const { width } = useWindowDimensions()
  const [page, setPage] = React.useState(0)
  /* Muted like everywhere else in the app: sound is something the reader asks
     for with the speaker chip, never something a screen starts on its own. */
  const [muted, setMuted] = React.useState(true)
  /* `autoplay` gates the PLAYER's existence, so tying it to focus is what
     releases the decoder — and stops the clip sounding behind the profile or
     comments route this screen pushes. */
  const focused = useIsFocused()
  const single = media.length === 1

  if (single) {
    return (
      <View style={[styles.gutter, style]}>
        <PostMedia
          media={media}
          postType={post.type}
          overlayUrl={post.overlayUrl}
          soundName={post.soundName}
          autoplay={focused}
          muted={muted}
          onToggleMute={() => setMuted(m => !m)}
          onPress={() => onPressPage(0)}
          maxHeightRatio={0.7}
        />
      </View>
    )
  }

  /* Mixed albums are letterboxed into one 4:5 box so the pager does not jump
     height between pages. */
  const boxH = Math.round((width - 32) * (5 / 4))

  return (
    <View style={style}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {media.map((m, i) => (
          <Touchable
            key={`${m.url}:${i}`}
            onPress={() => onPressPage(i)}
            feedback="none"
            noAutoHitSlop
            style={{ width, paddingHorizontal: space.lg }}
          >
            <View style={{ height: boxH, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: c.surfaceSunken }}>
              <Image
                source={{ uri: m.type === 'VIDEO' ? (m.poster || m.url) : m.url }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={150}
                cachePolicy="memory-disk"
                /* The author's own alt text when the album carries one —
                   the only place it exists. */
                accessibilityLabel={m.alt || undefined}
                accessible={!!m.alt}
              />
              {m.type === 'VIDEO' ? (
                <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
                  <Icon name="play" size={22} color={c.overlayText} filled />
                </View>
              ) : null}
              {m.type === 'VIDEO' && m.durationSeconds ? (
                <View style={[styles.durationChip, { backgroundColor: c.overlayChip }]}>
                  <NumericText variant="micro" color={c.overlayText}>{mmss(m.durationSeconds)}</NumericText>
                </View>
              ) : null}
            </View>
          </Touchable>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {media.map((_, i) => (
          <View
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === page ? c.accent : c.borderStrong,
            }}
          />
        ))}
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Repost embed.
   --------------------------------------------------------- */

function RepostEmbed({ id, style }: { id: string; style?: any }) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { data, error, loading } = useAsync<PostView>(() => api.posts.get(id), { deps: [id] })

  if (loading) {
    return (
      <View style={[styles.embed, { borderColor: c.border, borderRadius: t.radius.sm }, style]}>
        <Skeleton width="46%" height={11} />
        <Skeleton width="86%" height={11} style={{ marginTop: space.sm }} />
      </View>
    )
  }
  if (error || !data) {
    return (
      <View style={[styles.embed, { borderColor: c.border, borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }, style]}>
        <Text variant="footnote" tone="muted">This post is no longer available</Text>
      </View>
    )
  }

  const thumb = data.media?.[0]
  return (
    <Touchable
      onPress={() => router.push(`/post/${data.id}`)}
      feedback="dim"
      noAutoHitSlop
      style={[styles.embed, { borderColor: c.border, borderRadius: t.radius.sm }, style]}
    >
      <AuthorRow author={data._author} time={data.time} size={24} />
      <View style={styles.embedBody}>
        <View style={styles.flex}>
          <Text variant="footnote" numberOfLines={3} style={{ marginTop: space.sm }}>{data.body}</Text>
        </View>
        {thumb?.url ? (
          <Image
            source={{ uri: thumb.type === 'VIDEO' ? (thumb.poster || thumb.url) : thumb.url }}
            style={[styles.embedThumb, { borderRadius: t.radius.xs, backgroundColor: c.surfaceSunken }]}
            contentFit="cover"
            transition={120}
          />
        ) : null}
      </View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   Comment mutation helpers — shared by the SSE handler and the
   local writes so the two can never disagree about shape.
   --------------------------------------------------------- */

type SetComments = React.Dispatch<React.SetStateAction<CommentView[] | null>>
type SetReplies = React.Dispatch<React.SetStateAction<Record<string, CommentView[] | 'loading'>>>

function patchComment(
  commentId: string,
  fn: (c: CommentView) => CommentView,
  setComments: SetComments,
  setReplies: SetReplies,
) {
  setComments(list => (list || []).map(cm => (cm.id === commentId ? fn(cm) : cm)))
  setReplies(prev => {
    let touched = false
    const next: Record<string, CommentView[] | 'loading'> = {}
    for (const [k, v] of Object.entries(prev)) {
      if (!Array.isArray(v)) { next[k] = v; continue }
      const mapped = v.map(r => (r.id === commentId ? (touched = true, fn(r)) : r))
      next[k] = mapped
    }
    return touched ? next : prev
  })
}

function removeRow(commentId: string, setComments: SetComments, setReplies: SetReplies) {
  setComments(list => (list || []).filter(cm => cm.id !== commentId))
  setReplies(prev => {
    const next: Record<string, CommentView[] | 'loading'> = {}
    for (const [k, v] of Object.entries(prev)) {
      next[k] = Array.isArray(v) ? v.filter(r => r.id !== commentId) : v
    }
    return next
  })
}

/** A deleted reply owes its ancestor a −1, or the 'View N replies' label
 *  outlives the Nth reply and re-expanding shows an honest list against a
 *  stale count. REPLY_CREATED already does the +1; this is its inverse. */
function decrementReplyCount(parentId: string, setComments: SetComments, setReplies: SetReplies) {
  patchComment(parentId, cm => ({ ...cm, replyCount: Math.max(0, cm.replyCount - 1) }), setComments, setReplies)
}

/** Deleting a top-level comment range-deletes its whole reply partition
 *  server-side, so the expanded list has to go with it rather than linger
 *  under a row that no longer exists. */
function dropReplyPartition(commentId: string, setReplies: SetReplies) {
  setReplies(prev => {
    if (!(commentId in prev)) return prev
    const { [commentId]: _drop, ...rest } = prev
    return rest
  })
}

function applyCommentEvent(evt: any, setComments: SetComments, setReplies: SetReplies) {
  const provisional = (): CommentView => ({
    id: String(evt.commentId),
    author: String(evt.actorId || ''),
    _author: {
      id: String(evt.actorId || ''),
      full: evt.actorUsername || 'Member',
      handle: evt.actorUsername || '',
      initials: '',
      avc: '',
      profileImage: evt.actorAvatarUrl || null,
      verified: false,
      role: 'MEMBER',
    },
    body: evt.textContent || '',
    time: 'now',
    likes: 0,
    liked: false,
    replyCount: 0,
    parentCommentId: evt.parentCommentId ? String(evt.parentCommentId) : null,
    replyToCommentId: null,
    replyToUserId: null,
    _replyToHandle: null,
    /* post/realtime.md §2: comment events carry the media too, so a live
       arrival shows its picture instead of an empty bubble. Raw wire values,
       matching how actorAvatarUrl is treated a few lines up — the REST
       reconcile replaces the row with adapted urls shortly after. */
    mediaUrl: evt.mediaUrl || null,
    mediaType: evt.mediaType || null,
    mediaThumbnailUrl: evt.mediaThumbnailUrl || null,
  })

  switch (evt?.eventType) {
    case 'COMMENT_CREATED':
      if (!evt.commentId) return
      setComments(list => ((list || []).some(cm => cm.id === String(evt.commentId)) ? list : [...(list || []), provisional()]))
      break

    case 'REPLY_CREATED': {
      if (!evt.commentId || !evt.parentCommentId) return
      const anchor = String(evt.parentCommentId)
      setComments(list => (list || []).map(cm => (cm.id === anchor ? { ...cm, replyCount: cm.replyCount + 1 } : cm)))
      setReplies(prev => {
        const open = prev[anchor]
        if (!Array.isArray(open)) return prev
        if (open.some(r => r.id === String(evt.commentId))) return prev
        return { ...prev, [anchor]: [...open, provisional()] }
      })
      break
    }

    case 'COMMENT_EDITED':
      if (!evt.commentId) return
      patchComment(String(evt.commentId), r => ({ ...r, body: evt.textContent ?? r.body, edited: true }), setComments, setReplies)
      break

    case 'COMMENT_DELETED': {
      if (!evt.commentId) return
      /* The frame carries parentCommentId for a reply — prefer it over
         guessing, and settle the ancestor before the row is gone. */
      const parentId = evt.parentCommentId ? String(evt.parentCommentId) : null
      removeRow(String(evt.commentId), setComments, setReplies)
      if (parentId) decrementReplyCount(parentId, setComments, setReplies)
      else dropReplyPartition(String(evt.commentId), setReplies)
      break
    }

    case 'COMMENT_REACTION_ADDED':
      if (!evt.commentId) return
      patchComment(String(evt.commentId), r => ({ ...r, likes: r.likes + 1 }), setComments, setReplies)
      break

    case 'COMMENT_REACTION_REMOVED':
      if (!evt.commentId) return
      patchComment(String(evt.commentId), r => ({ ...r, likes: Math.max(0, r.likes - 1) }), setComments, setReplies)
      break

    default:
      /* POST_DELETED and the two *_CHANGED enums are reserved and never
         emitted. Ignore them rather than crash on them. */
      break
  }
}

function DetailSkeleton() {
  const t = useTheme()
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      <View style={styles.skelRow}>
        <Skeleton circle width={44} height={44} />
        <View style={styles.flex}>
          <Skeleton width="44%" height={12} />
          <Skeleton width="28%" height={10} style={{ marginTop: space.sm }} />
        </View>
      </View>
      <Skeleton width="94%" height={13} style={{ marginTop: space.xs2 }} />
      <Skeleton width="82%" height={13} />
      <Skeleton height={300} radius={t.radius.md} style={{ marginTop: space.xs2 }} />
      <Skeleton height={44} radius={t.radius.sm} style={{ marginTop: space.xs2 }} />
      {[0, 1, 2].map(i => (
        <View key={i} style={[styles.skelRow, { marginTop: space.sm }]}>
          <Skeleton circle width={32} height={32} />
          <View style={styles.flex}>
            <Skeleton width="36%" height={11} />
            <Skeleton width="78%" height={11} style={{ marginTop: space.sm }} />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { paddingBottom: space.xxl },
  block: { paddingTop: space.md },
  gutter: { paddingHorizontal: space.lg },
  bodyGap: { marginTop: space.md2 },
  mediaGap: { marginTop: space.md2 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  visChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 5 },
  /* The labelled bar takes the plate's edge minus the cell's own centring
     room — the text gutter would leave "Like" floating inside its quarter. */
  actions: { marginHorizontal: space.xs2, marginTop: space.xxs, marginBottom: space.xs },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md2, marginTop: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.xs, marginTop: space.sm2 },
  /* Bottom-end corner, clear of the centred play glyph. A text-bearing plate,
     so it takes the chip setback rather than a lozenge (DESIGN.md §8.9). */
  durationChip: {
    position: 'absolute',
    end: 8,
    bottom: 8,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  playBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  embed: { borderWidth: StyleSheet.hairlineWidth, padding: space.md },
  embedBody: { flexDirection: 'row', gap: space.sm2, alignItems: 'flex-start' },
  embedThumb: { width: 88, height: 88, marginTop: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg2, paddingBottom: space.xs2 },
  /* A count plate is a CHIP (setback 8/3). The sanctioned pills are unread
     counters and LIVE badges only (DON'T #9). */
  countPlate: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  commentSkeleton: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.lg },
  skelRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  noComments: { paddingVertical: space.xxxl },
})
