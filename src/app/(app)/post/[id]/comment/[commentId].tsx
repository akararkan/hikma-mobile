/* =========================================================
   Comment thread — one top-level comment and its replies.

   The deep-link target for POST_COMMENT_REPLIED and
   POST_COMMENT_REACTED, and the escape hatch from a long detail
   page.

   Two API shapes force the layout:

   · there is no GET-one-comment endpoint, so the anchor is
     located by scanning page 1 of the post's comments. If it is
     not in the first 100 the replies still render alone — a
     thread that exists is worth more than a header that does.
   · `replies` has no cursor on the wire; 100 is the server
     clamp AND the whole thread, so there is nothing to page.

   Everything here is depth 1 by contract (the server hoists a
   reply-to-a-reply to a sibling), so no row is ever indented
   twice.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, errorText, isRateLimited } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useRealtime } from '@/hooks/useRealtime'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, ErrorState, Header, Screen, Skeleton, Text, toast } from '@/ui'
import { CommentRow } from '@/components/post/CommentRow'
import { MediaLightbox, type LightboxItem } from '@/components/qna/MediaLightbox'
import { CommentComposer } from '@/components/post/CommentComposer'
import { EditCommentSheet } from '@/components/post/EditCommentSheet'
import { PostMenuSheet, type PostMenuTarget } from '@/components/post/PostMenuSheet'
import { isBlocked, moderationText } from '@/lib/moderation'
import type { CommentView } from '@/components/feed/types'

const keyExtractor = (r: CommentView) => String(r.id)

export default function CommentThreadScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, commentId } = useLocalSearchParams<{ id: string; commentId: string }>()
  const { user } = useAuth()

  const listRef = React.useRef<FlashListRef<CommentView>>(null)
  const inputRef = React.useRef<TextInput | null>(null)

  const replies = useAsync<CommentView[]>(
    () => api.posts.replies(commentId, { pageSize: 100 }),
    { enabled: !!commentId, deps: [commentId] },
  )
  const thread = useAsync<CommentView[]>(
    () => api.posts.comments(id, { pageSize: 100 }),
    { enabled: !!id, deps: [id] },
  )

  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [menuTarget, setMenuTarget] = React.useState<PostMenuTarget | null>(null)
  const [editTarget, setEditTarget] = React.useState<PostMenuTarget | null>(null)

  const parent = React.useMemo(
    () => (thread.data || []).find(cm => String(cm.id) === String(commentId)) || null,
    [thread.data, commentId],
  )

  useRealtime('posts', id, {
    onConnected: () => { void replies.reload(); void thread.reload() },
    onEvent: (evt: any) => {
      /* The thread listens on the POST's stream — there is no per-comment
         channel — so every frame is filtered down to this subtree. */
      const mine = String(evt?.parentCommentId ?? '') === String(commentId)
        || String(evt?.commentId ?? '') === String(commentId)
      if (!mine) return

      switch (evt.eventType) {
        case 'REPLY_CREATED':
          replies.setData(list => (
            (list || []).some(r => r.id === String(evt.commentId))
              ? list
              : [...(list || []), {
                id: String(evt.commentId),
                author: String(evt.actorId || ''),
                _author: {
                  id: String(evt.actorId || ''),
                  full: evt.actorUsername || 'Member',
                  handle: evt.actorUsername || '',
                  initials: '', avc: '',
                  profileImage: evt.actorAvatarUrl || null,
                  verified: false, role: 'MEMBER',
                },
                body: evt.textContent || '',
                time: 'now',
                likes: 0, liked: false, replyCount: 0,
                parentCommentId: String(commentId),
                replyToCommentId: null, replyToUserId: null, _replyToHandle: null,
                /* Raw wire values — the REST reconcile replaces them with
                   adapted urls a moment later (post/realtime.md §2). */
                mediaUrl: evt.mediaUrl || null,
                mediaType: evt.mediaType || null,
                mediaThumbnailUrl: evt.mediaThumbnailUrl || null,
              }]
          ))
          /* Symmetric with COMMENT_DELETED below — a create that bumps a
             counter its matching delete does not restore is how 'View N
             replies' drifts. */
          thread.setData(list => (list || []).map(r => (
            r.id === String(commentId) ? { ...r, replyCount: r.replyCount + 1 } : r
          )))
          break
        case 'COMMENT_EDITED':
          replies.setData(list => (list || []).map(r => (r.id === String(evt.commentId) ? { ...r, body: evt.textContent ?? r.body, edited: true } : r)))
          break
        case 'COMMENT_DELETED':
          replies.setData(list => (list || []).filter(r => r.id !== String(evt.commentId)))
          /* The anchor's own replyCount feeds the 'View N replies' label on the
             detail screen this row came from — keep it honest here too. */
          if (String(evt.commentId) !== String(commentId)) {
            thread.setData(list => (list || []).map(r => (
              r.id === String(commentId) ? { ...r, replyCount: Math.max(0, r.replyCount - 1) } : r
            )))
          }
          break
        case 'COMMENT_REACTION_ADDED':
          replies.setData(list => (list || []).map(r => (r.id === String(evt.commentId) ? { ...r, likes: r.likes + 1 } : r)))
          break
        case 'COMMENT_REACTION_REMOVED':
          replies.setData(list => (list || []).map(r => (r.id === String(evt.commentId) ? { ...r, likes: Math.max(0, r.likes - 1) } : r)))
          break
        default: break
      }
    },
  })

  const like = async (cm: CommentView) => {
    const was = cm.liked
    const isParent = String(cm.id) === String(commentId)
    const flip = (r: CommentView) => ({ ...r, liked: !was, likes: Math.max(0, r.likes + (was ? -1 : 1)) })
    if (isParent) thread.setData(list => (list || []).map(r => (r.id === cm.id ? flip(r) : r)))
    else replies.setData(list => (list || []).map(r => (r.id === cm.id ? flip(r) : r)))

    try {
      const res: any = await api.posts.toggleCommentReaction(id, cm.id)
      const liked = !!res?.liked
      const settle = (r: CommentView) => (r.liked === liked ? r : { ...r, liked, likes: Math.max(0, r.likes + (liked ? 1 : -1)) })
      if (isParent) thread.setData(list => (list || []).map(r => (r.id === cm.id ? settle(r) : r)))
      else replies.setData(list => (list || []).map(r => (r.id === cm.id ? settle(r) : r)))
    } catch (e) {
      const revert = (r: CommentView) => ({ ...r, liked: was, likes: Math.max(0, r.likes + (was ? 1 : -1)) })
      if (isParent) thread.setData(list => (list || []).map(r => (r.id === cm.id ? revert(r) : r)))
      else replies.setData(list => (list || []).map(r => (r.id === cm.id ? revert(r) : r)))
      toast.error(errorText(e))
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending || cooldown > 0) return
    setSending(true)
    setSendError(null)
    setDraft('')
    try {
      const row: any = await api.posts.addReply(commentId, { text })
      replies.setData(list => [...(list || []), row])
      thread.setData(list => (list || []).map(r => (
        r.id === String(commentId) ? { ...r, replyCount: r.replyCount + 1 } : r
      )))
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)
    } catch (e: any) {
      setDraft(text)
      if (isRateLimited(e)) { startCooldown(e); setSendError(errorText(e)) }
      else if (isBlocked(e) || codeOf(e) === 'CONTENT_UNDER_REVIEW') setSendError(moderationText(e))
      else setSendError(errorText(e))
    } finally {
      setSending(false)
    }
  }

  const rows = replies.data || []

  /* Identical shape to the detail screen's, so the same long-press yields the
     same menu wherever a comment is drawn. */
  const menuFor = React.useCallback((cm: CommentView): PostMenuTarget => ({
    id: cm.id,
    author: cm.author,
    _author: cm._author,
    targetType: 'COMMENT',
    postId: id,
    body: cm.body,
    parentCommentId: cm.parentCommentId ?? null,
    replyCount: cm.replyCount || 0,
  }), [id])

  /* One function per action for every row on the screen — the anchor and the
     replies both — so FlashList's cell memo (which compares renderItem by
     identity) has something stable to hold on to. */
  const onLikeRow = useEvent((cm: CommentView) => { void like(cm) })
  const onPressUser = useEvent((uid: string) => router.push(`/u/${uid}`))
  const onPressTag = useEvent((tag: string) => router.push(`/tags/${tag}`))
  const onPressMention = useEvent((h: string) => router.push(`/u/${h}`))
  const onMenuRow = useEvent((cm: CommentView) => setMenuTarget(menuFor(cm)))
  const focusComposer = useEvent(() => inputRef.current?.focus())
  /* Comment media opens in the shared lightbox — the post's /media route pages
     the POST's album, which a comment's picture is not part of. */
  const [lightbox, setLightbox] = React.useState<LightboxItem | null>(null)
  const onOpenMedia = useEvent((uri: string) => {
    const row = [parent, ...(thread.data || [])].find(cm => cm?.mediaUrl === uri)
    setLightbox({ url: uri, kind: row?.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE' })
  })

  const renderItem = React.useCallback(({ item }: { item: CommentView }) => (
    <CommentRow
      comment={item}
      isReply
      onLike={onLikeRow}
      onPressAuthor={onPressUser}
      onPressTag={onPressTag}
      onPressMention={onPressMention}
      onMenu={onMenuRow}
      onReply={focusComposer}
      onOpenMedia={onOpenMedia}
    />
  ), [onLikeRow, onPressUser, onPressTag, onPressMention, onMenuRow, focusComposer, onOpenMedia])

  return (
    <Screen>
      <Header
        back
        title="Thread"
        actions={parent ? [{ icon: 'more', label: 'More', onPress: () => setMenuTarget(menuFor(parent)) }] : []}
      />

      {/* The anchor is pinned: it is the subject of the screen, not a row in
          the list, and scrolling it away would leave the replies unattributed. */}
      <View style={[styles.anchor, { borderBottomColor: c.separator, borderStartColor: c.accent }]}>
        {thread.loading ? (
          <View style={styles.skelRow}>
            <Skeleton circle width={40} height={40} />
            <View style={styles.flex}>
              <Skeleton width="42%" height={12} />
              <Skeleton width="88%" height={12} style={{ marginTop: space.sm }} />
            </View>
          </View>
        ) : parent ? (
          <CommentRow
            comment={parent}
            onLike={onLikeRow}
            onOpenMedia={onOpenMedia}
            onPressAuthor={onPressUser}
            onPressTag={onPressTag}
            onPressMention={onPressMention}
            onMenu={onMenuRow}
            onReply={focusComposer}
          />
        ) : (
          <View style={styles.gone}>
            {/* Replies outlive their parent only until the range-delete lands,
                so an empty anchor is a real state, not a loading one. */}
            <Text variant="callout" tone="muted">This comment was deleted</Text>
            <Button label="Go to post" onPress={() => router.replace(`/post/${id}`)} variant="ghost" size="sm" />
          </View>
        )}
      </View>

      <View style={styles.repliesLabel}>
        <Text variant="footnote" weight="700" tone="muted">
          Replies{rows.length ? ` · ${rows.length}` : ''}
        </Text>
      </View>

      {replies.loading ? (
        <View style={styles.skelList}>
          {[0, 1, 2].map(i => (
            <View key={i} style={styles.skelRow}>
              <Skeleton circle width={28} height={28} />
              <View style={styles.flex}>
                <Skeleton width="34%" height={11} />
                <Skeleton width="76%" height={11} style={{ marginTop: space.sm }} />
              </View>
            </View>
          ))}
        </View>
      ) : replies.error ? (
        <ErrorState error={replies.error} onRetry={() => { void replies.reload() }} />
      ) : (
        <View style={styles.flex}>
          <View style={[styles.guide, { backgroundColor: c.separator }]} pointerEvents="none" />
          <FlashList
            ref={listRef}
            data={rows}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listPad}
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
            ListEmptyComponent={
              <Text variant="callout" tone="muted" align="center" style={styles.empty}>No replies yet</Text>
            }
          />
        </View>
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={{ paddingBottom: insets.bottom }}>
          {/* Permanently in reply mode — there is nothing else this screen can
              post to, so the context strip has no ✕. */}
          <CommentComposer
            value={draft}
            onChange={v => { setDraft(v); if (sendError) setSendError(null) }}
            onSubmit={() => { void send() }}
            me={user as any}
            replyingTo={{ handle: parent?._author?.handle || 'member' }}
            busy={sending}
            cooldown={cooldown}
            error={sendError}
            placeholder="Write a reply…"
            inputRef={inputRef}
          />
        </View>
      </KeyboardStickyView>

      <PostMenuSheet
        visible={!!menuTarget}
        onClose={() => setMenuTarget(null)}
        post={menuTarget}
        viewerId={user?.id}
        onReply={() => inputRef.current?.focus()}
        onEdit={target => { if (target.targetType === 'COMMENT') setEditTarget(target) }}
        onDeleted={deletedId => {
          /* The anchor going means the screen has no subject left. */
          if (String(deletedId) === String(commentId)) { router.back(); return }
          replies.setData(list => (list || []).filter(r => r.id !== String(deletedId)))
          thread.setData(list => (list || []).map(r => (
            r.id === String(commentId) ? { ...r, replyCount: Math.max(0, r.replyCount - 1) } : r
          )))
        }}
      />

      <EditCommentSheet
        visible={!!editTarget}
        onClose={() => setEditTarget(null)}
        comment={editTarget ? { id: editTarget.id, body: editTarget.body || '' } : null}
        onSaved={(cid, text) => {
          /* The anchor lives in `thread`, its replies in `replies` — patch both;
             only one will match. */
          thread.setData(list => (list || []).map(r => (r.id === cid ? { ...r, body: text, edited: true } : r)))
          replies.setData(list => (list || []).map(r => (r.id === cid ? { ...r, body: text, edited: true } : r)))
        }}
        onGone={cid => {
          replies.setData(list => (list || []).filter(r => r.id !== cid))
          /* A vanished anchor becomes the 'This comment was deleted' state. */
          if (String(cid) === String(commentId)) void thread.reload()
          else {
            thread.setData(list => (list || []).map(r => (
              r.id === String(commentId) ? { ...r, replyCount: Math.max(0, r.replyCount - 1) } : r
            )))
          }
        }}
      />

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  anchor: { borderBottomWidth: StyleSheet.hairlineWidth, borderStartWidth: 4, paddingVertical: space.xs },
  gone: { padding: space.lg, gap: space.sm, alignItems: 'flex-start', opacity: 0.6 },
  repliesLabel: { paddingHorizontal: space.lg, paddingTop: space.md2, paddingBottom: space.xs },
  guide: { position: 'absolute', top: 0, bottom: 0, start: 27, width: StyleSheet.hairlineWidth },
  listPad: { paddingBottom: space.lg },
  skelList: { padding: space.lg, gap: space.lg2 },
  skelRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm },
  empty: { paddingVertical: 28 },
})
