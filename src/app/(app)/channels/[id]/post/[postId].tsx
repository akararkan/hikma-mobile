/* =========================================================
   One post, and its comments.

   A comment is NOT a channel message: it lives in the linked
   discussion GROUP, its `conversationId` is the group's, and its
   `replyToId` is the post. So the thread is read through
   `channels.discussion.*`, and a live comment is an `onMessage`
   frame for the GROUP that has to be matched on replyToId — the
   `message.comment` frame only carries the ±1 for the counter.

   With no group linked, `post.comments` is null (not 0) and the
   composer is absent rather than disabled: there is nowhere for
   a comment to go.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, TextInput, View } from 'react-native'
/* The controller's KAV, never RN's: the window is edge-to-edge, so it never
   resizes for the IME and RN's KAV with no Android `behavior` is a plain View. */
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, codeOf, errorText, isNetworkError, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useTyping } from '@/context/RealtimeContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useDockInset } from '@/hooks/useDockInset'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, Callout, ConfirmSheet, EmptyState, ErrorState, Header,
  Icon, Screen, SkeletonCard, SkeletonRow, Spinner, Text, Touchable, fireHaptic, toast,
  useSheetState,
} from '@/ui'
import { ChannelPostCard, applyReactionDelta } from '@/components/channels/ChannelPostCard'
import { MediaAlbum } from '@/components/channels/MediaAlbum'
import { PostMenuSheet } from '@/components/channels/PostMenuSheet'
import { ReportSheet } from '@/components/channels/ReportSheet'
import { mergePollFrame } from '@/components/channels/PollCard'
import { GoneCard, TopStrip } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const TYPING_THROTTLE_MS = 4000

/* Module scope — FlashList compares this prop by identity. */
const keyExtractor = (x: any) => String(x.id)

export default function ChannelPostScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  /* The composer docks INSIDE the KAV above, which already pads by the full
     keyboard overlap — so the safe-area edge is only ours to pay for while
     the keyboard is closed. useDockInset returns 0 once it is up. */
  const dock = useDockInset()
  const { user } = useAuth()
  const { id, postId } = useLocalSearchParams<{ id: string; postId: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel
  const groupId = channel?.linkedGroupId || null
  const typingHere = useTyping(groupId)

  const post = useAsync<any>(() => api.chat.messages.get(postId), { enabled: !!postId, deps: [postId] })

  const [comments, setComments] = React.useState<any[]>([])
  const [loadingComments, setLoadingComments] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [commentsDone, setCommentsDone] = React.useState(false)
  const [commentsError, setCommentsError] = React.useState<any>(null)

  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [composerBlock, setComposerBlock] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown()
  const [editing, setEditing] = React.useState<any>(null)
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set())

  const menu = useSheetState<any>()
  const commentMenu = useSheetState<any>()
  const confirmDelete = useSheetState<any>()
  const confirmHide = useSheetState<any>()
  const confirmDeleteComment = useSheetState<any>()
  const [deletingComment, setDeletingComment] = React.useState(false)
  const report = useSheetState<any>()

  const lastTypingAt = React.useRef(0)

  /* ---- comments ---- */

  const loadComments = React.useCallback(async (mode: 'first' | 'more') => {
    if (!id || !postId || !groupId) { setLoadingComments(false); return }
    if (mode === 'more' && (loadingMore || commentsDone)) return
    mode === 'first' ? setLoadingComments(true) : setLoadingMore(true)
    try {
      const before = mode === 'more' && comments.length ? String(comments[comments.length - 1].id) : undefined
      const batch = await api.channels.discussion.list(id, postId, args({ before, limit: 30 }))
      setComments(prev => {
        if (mode === 'first') return batch
        const known = new Set(prev.map((x: any) => String(x.id)))
        return [...prev, ...batch.filter((x: any) => !known.has(String(x.id)))]
      })
      setCommentsDone(!batch.length || batch.length < 30)
      setCommentsError(null)
    } catch (e: any) {
      setCommentsError(e)
    } finally {
      setLoadingComments(false)
      setLoadingMore(false)
    }
  }, [id, postId, groupId, comments, loadingMore, commentsDone])

  React.useEffect(() => { setComments([]); setCommentsDone(false); void loadComments('first') }, [id, postId, groupId])   // eslint-disable-line react-hooks/exhaustive-deps

  /* One view marker, once. The server dedupes each (post, viewer) pair, so
     this is free to re-send and nothing needs to survive a reload. */
  React.useEffect(() => {
    if (!id || !postId) return
    void api.channels.markViews(id, [postId]).catch(() => {})
  }, [id, postId])

  /* ---- realtime ---- */

  useChannelStream(id, {
    onComment: e => {
      if (String(e.messageId) !== String(postId)) return
      post.setData((prev: any) => (prev ? { ...prev, comments: Math.max(0, (prev.comments ?? 0) + (e.added ? 1 : -1)) } : prev))
    },
    onPoll: e => {
      if (String(e.messageId) !== String(postId)) return
      post.setData((prev: any) => (prev?.poll ? { ...prev, poll: mergePollFrame(prev.poll, e.poll) } : prev))
    },
    onAny: e => {
      /* Comments arrive as ordinary messages in the GROUP. */
      if (e.type === 'message.new' && groupId && e.conversationId === groupId) {
        const msg = e.message
        if (!msg || String(msg.replyToId) !== String(postId)) return
        setComments(prev => (prev.some(x => String(x.id) === String(msg.id)) ? prev : [msg, ...prev]))
        return
      }
      if (e.type === 'message.edited' && groupId && e.conversationId === groupId) {
        setComments(prev => prev.map(x => (String(x.id) === String(e.messageId) ? { ...x, body: e.body, editedAt: e.editedAt } : x)))
        return
      }
      if (e.type === 'message.deleted' && groupId && e.conversationId === groupId) {
        setComments(prev => prev.map(x => (String(x.id) === String(e.messageId) ? { ...x, deleted: true } : x)))
        return
      }
      if (e.type === 'message.reaction' && String(e.messageId) === String(postId)) {
        post.setData((prev: any) => (prev
          ? { ...prev, reactions: applyReactionDelta(prev.reactions, { emoji: e.emoji, added: !!e.added, mine: e.userId === user?.id }) }
          : prev))
      }
    },
    onReconcile: () => { void post.refresh(); void loadComments('first') },
  })

  /* ---- actions ---- */

  const react = async (emoji: string) => {
    try {
      const fresh = await api.chat.messages.react(postId, emoji)
      post.setData((prev: any) => (prev ? { ...prev, reactions: fresh } : prev))
    } catch (e: any) { toast.error(errorText(e)) }
  }
  const unreact = async () => {
    try {
      const fresh = await api.chat.messages.unreact(postId)
      post.setData((prev: any) => (prev ? { ...prev, reactions: fresh } : prev))
    } catch (e: any) { toast.error(errorText(e)) }
  }
  const vote = async (indexes: number[]) => {
    try {
      const poll = await api.chat.messages.vote(postId, indexes)
      post.setData((prev: any) => (prev ? { ...prev, poll } : prev))
    } catch (e: any) { toast.error(errorText(e)) }
  }

  const sendTyping = () => {
    if (!groupId) return
    const now = Date.now()
    if (now - lastTypingAt.current < TYPING_THROTTLE_MS) return
    lastTypingAt.current = now
    void api.chat.typing(groupId, true, 'TYPING').catch(() => {})
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || sending || cooldown > 0) return
    setSending(true)
    try {
      if (editing) {
        const fresh = await api.chat.messages.edit(editing.id, body)
        setComments(prev => prev.map(x => (String(x.id) === String(editing.id) ? fresh : x)))
        setEditing(null)
      } else {
        const created = await api.channels.discussion.add(id, postId, args({
          clientNonce: api.chat.newNonce(),
          type: 'TEXT',
          body,
        }))
        if (created) {
          setComments(prev => (prev.some(x => String(x.id) === String(created.id)) ? prev : [created, ...prev]))
          /* A held comment does not echo to anyone else. It stays visibly
             provisional until the thread is re-read. */
          setPendingIds(s => new Set(s).add(String(created.id)))
          setTimeout(() => {
            setPendingIds(s => { const n = new Set(s); n.delete(String(created.id)); return n })
            void loadComments('first')
          }, 10000)
          post.setData((prev: any) => (prev ? { ...prev, comments: (prev.comments ?? 0) + 1 } : prev))
        }
      }
      setDraft('')
      if (groupId) void api.chat.typing(groupId, false).catch(() => {})
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'RATE_LIMIT_EXCEEDED' || e?.status === 429) { startCooldown(e); toast.warn(errorText(e)); return }
      if (e?.status === 403) { setComposerBlock(errorText(e)); return }
      if (e?.status === 400) { setComposerBlock(errorText(e)); return }
      toast.error(errorText(e))
    } finally {
      setSending(false)
    }
  }

  /* Deleting for EVERYONE has no undo, so the write goes first and the list
     follows it — a failed delete must leave the thread exactly as it was.
     The local row is marked `deleted`, not filtered, because that is what the
     `message.deleted` frame does: the same delete must not look different
     before and after a refresh. */
  const removeComment = async (comment: any) => {
    if (!comment || deletingComment) return
    setDeletingComment(true)
    try {
      await api.chat.messages.remove(comment.id, 'everyone')
      setComments(prev => prev.map(x => (String(x.id) === String(comment.id) ? { ...x, deleted: true } : x)))
      post.setData((prev: any) => (prev ? { ...prev, comments: Math.max(0, (prev.comments ?? 1) - 1) } : prev))
      confirmDeleteComment.close()
      commentMenu.close()
      toast.ok('Comment deleted')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setDeletingComment(false)
    }
  }

  /* ---- row plumbing ----
     Item-first and identity-stable, so `renderItem` survives a typing frame
     and FlashList's cell memo can actually skip the comments it did not
     touch. The per-comment closures live inside CommentRow's memo. */

  const openAuthor = useEvent((comment: any) => {
    if (comment?.senderId) router.push(chRoute.user(comment.senderId))
  })
  const openCommentMenu = useEvent((comment: any) => commentMenu.open(comment))
  const longPressComment = useEvent((comment: any) => { fireHaptic('medium'); commentMenu.open(comment) })

  const meId = user?.id
  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <CommentRow
      comment={item}
      pending={pendingIds.has(String(item.id))}
      mine={item.senderId === meId}
      onPressAuthor={openAuthor}
      onMenu={openCommentMenu}
      onLongPress={longPressComment}
    />
  ), [pendingIds, meId, openAuthor, openCommentMenu, longPressComment])

  /* The header is the whole post card — passed by reference so it is not
     rebuilt (and its ViewHolder re-rendered) on every keystroke below. */
  const listHeader = React.useMemo(() => (
    <View>
      {post.loading && !post.data ? (
        <SkeletonCard />
      ) : post.error ? (
        <ErrorState error={post.error} onRetry={post.reload} />
      ) : (
        <ChannelPostCard
          post={post.data}
          channel={channel}
          myAdminRow={rights.myAdminRow}
          variant="detail"
          canClosePoll={rights.can('canEditMessages')}
          onOpenMedia={index => router.push(chRoute.viewer(id, postId, {
            index, title: channel?.title, protected: !!channel?.settings?.protectedContent,
          }))}
          onReact={react}
          onUnreact={unreact}
          onVote={vote}
          onRetractVote={async () => {
            try {
              const poll = await api.chat.messages.retractVote(postId)
              post.setData((prev: any) => (prev ? { ...prev, poll } : prev))
            } catch (e: any) { toast.error(errorText(e)) }
          }}
          onClosePoll={async () => {
            try {
              const poll = await api.chat.messages.closePoll(postId)
              post.setData((prev: any) => (prev ? { ...prev, poll } : prev))
            } catch (e: any) { toast.error(errorText(e)) }
          }}
          onMenu={() => menu.open(post.data)}
          onTagPress={tag => router.push(chRoute.tag(id, tag))}
          onMentionPress={handle => router.push(chRoute.user(handle))}
        />
      )}

      {groupId ? (
        <View style={[styles.divider, { borderTopColor: c.separator, borderBottomColor: c.separator }]}>
          <Text variant="bodyStrong" align="ui" style={styles.flex}>
            {post.data?.comments != null
              ? `${post.data.comments} ${post.data.comments === 1 ? 'comment' : 'comments'}`
              : 'Comments'}
          </Text>
          <Text variant="footnote" tone="muted">Newest first</Text>
        </View>
      ) : (
        <View style={{ padding: t.layout.screenPadding }}>
          <Callout tone="neutral" icon="chat" title="Comments are off">
            {rights.can('canChangeInfo')
              ? 'Link a discussion group to let subscribers comment.'
              : 'This channel has no discussion group.'}
          </Callout>
          {rights.can('canChangeInfo') ? (
            <Button
              label="Link a discussion group"
              variant="tinted"
              onPress={() => router.push(chRoute.discussion(id))}
              style={styles.linkGroupBtn}
            />
          ) : null}
        </View>
      )}
    </View>
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  ), [post.data, post.loading, post.error, channel, rights.myAdminRow, groupId, c, t, id, postId])

  /* ---- terminal states ---- */

  if (post.error && isNotFound(post.error)) {
    return (
      <Screen>
        <Header back title="Post" />
        <GoneCard
          title="This post is no longer available"
          message="It may have been deleted by an admin."
          onBrowse={() => router.replace(chRoute.channel(id))}
        />
      </Screen>
    )
  }

  const canDeleteAny = rights.can('canDeleteMessages')
  /* One expression of the rule, read by both the row and the menu. */
  const canDeleteComment = (m: any) => !!m && (canDeleteAny || m.senderId === user?.id)
  const offline = isNetworkError(post.error) || isNetworkError(commentsError)

  return (
    <Screen>
      <Header
        back
        title="Post"
        subtitle={channel?.title}
        actions={[{ icon: 'more', onPress: () => menu.open(post.data), label: 'More' }]}
      />
      {offline ? <TopStrip tone="neutral">You’re offline — showing what was already loaded.</TopStrip> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlashList
          data={comments}
          keyExtractor={keyExtractor}
          extraData={`${pendingIds.size}:${editing?.id}`}
          ListHeaderComponent={listHeader}
          renderItem={renderItem}
          ListEmptyComponent={
            !groupId ? null : loadingComments ? (
              <View><SkeletonRow /><SkeletonRow /><SkeletonRow /></View>
            ) : commentsError && !isNetworkError(commentsError) ? (
              <ErrorState compact error={commentsError} onRetry={() => void loadComments('first')} />
            ) : (
              <EmptyState compact icon="comment" title="No comments yet" message="Be the first to comment." />
            )
          }
          ListFooterComponent={loadingMore ? <Spinner /> : <View style={{ height: 16 }} />}
          onEndReached={() => void loadComments('more')}
          onEndReachedThreshold={0.6}
          refreshing={post.refreshing}
          onRefresh={() => { void post.refresh(); void loadComments('first') }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.md }}
        />

        {groupId ? (
          <View style={[styles.composerWrap, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: dock + 8 }]}>
            {typingHere.length ? (
              <Text variant="caption" tone="muted" align="ui" style={{ paddingHorizontal: space.md2, paddingBottom: space.xs }}>
                {typingHere.length === 1 ? 'Someone is typing…' : `${typingHere.length} people are typing…`}
              </Text>
            ) : null}

            {composerBlock ? (
              <View style={{ paddingHorizontal: space.md2, paddingBottom: space.sm }}>
                <Callout tone="warning">{composerBlock}</Callout>
              </View>
            ) : null}

            {editing ? (
              <View style={[styles.editStrip, { backgroundColor: c.accentSofter }]}>
                <Icon name="edit" size={14} color={c.accent} />
                <Text variant="caption" tone="accent" align="ui" style={styles.flex} numberOfLines={1}>
                  Editing your comment
                </Text>
                <Touchable onPress={() => { setEditing(null); setDraft('') }} feedback="dim" accessibilityLabel="Stop editing">
                  <Icon name="close" size={14} color={c.accent} />
                </Touchable>
              </View>
            ) : null}

            <Composer
              value={draft}
              onChangeText={v => { setDraft(v); sendTyping() }}
              onSend={send}
              sending={sending}
              disabled={!!composerBlock || offline}
              cooldown={cooldown}
              me={user}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <PostMenuSheet
        visible={menu.visible}
        onClose={menu.close}
        target={{ post: post.data, channel, myAdminRow: rights.myAdminRow, meId: user?.id }}
        onCopy={async () => { await Clipboard.setStringAsync(post.data?.body || ''); toast.ok('Copied') }}
        onShareLink={() => channel?.shareUrl && void Share.share({ message: channel.shareUrl }).catch(() => {})}
        onToggleStar={async () => {
          const starred = !!post.data?.starred
          post.setData((prev: any) => (prev ? { ...prev, starred: !starred } : prev))
          try { starred ? await api.chat.messages.unstar(postId) : await api.chat.messages.star(postId) }
          catch (e: any) { post.setData((prev: any) => (prev ? { ...prev, starred } : prev)); toast.error(errorText(e)) }
        }}
        onTogglePin={async () => {
          try { await api.chat.messages.pin(id, postId); toast.ok('Pinned') }
          catch (e: any) { toast.error(errorText(e)) }
        }}
        onEdit={() => router.push(chRoute.compose(id, { editId: String(postId) }))}
        onDelete={() => confirmDelete.open(post.data)}
        onHide={() => confirmHide.open(post.data)}
        onReport={() => report.open(post.data)}
      />

      <ActionSheet
        visible={commentMenu.visible}
        onClose={commentMenu.close}
        title="Comment"
        actions={[
          { label: 'Copy text', icon: 'copy', onPress: async () => { await Clipboard.setStringAsync(commentMenu.payload?.body || ''); toast.ok('Copied') } },
          {
            label: 'Edit comment',
            icon: 'edit',
            hidden: commentMenu.payload?.senderId !== user?.id,
            onPress: () => { setEditing(commentMenu.payload); setDraft(commentMenu.payload?.body || '') },
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            /* Hidden on your own comment and while signed out. */
            hidden: !user || commentMenu.payload?.senderId === user.id,
            onPress: () => report.open(commentMenu.payload),
          },
          {
            label: 'Delete comment',
            icon: 'trash',
            destructive: true,
            hidden: !canDeleteComment(commentMenu.payload),
            onPress: () => confirmDeleteComment.open(commentMenu.payload),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmDeleteComment.visible}
        onClose={confirmDeleteComment.close}
        title="Delete this comment?"
        message="It disappears for every subscriber. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deletingComment}
        onConfirm={() => { void removeComment(confirmDeleteComment.payload) }}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this post?"
        message="It disappears for every subscriber. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          confirmDelete.close()
          try { await api.chat.messages.remove(postId, 'everyone'); router.back() }
          catch (e: any) { toast.error(errorText(e)) }
        }}
      />

      {/* One post on screen and nothing to splice, so a success just leaves. */}
      <ConfirmSheet
        visible={confirmHide.visible}
        onClose={confirmHide.close}
        title="Hide this post?"
        message="It disappears from your view of this channel. Everyone else keeps it."
        confirmLabel="Hide"
        destructive
        onConfirm={async () => {
          confirmHide.close()
          try { await api.chat.messages.remove(postId, 'me'); router.back() }
          catch (e: any) { toast.error(errorText(e)) }
        }}
      />

      <ReportSheet
        visible={report.visible}
        onClose={report.close}
        targetType="MESSAGE"
        targetId={report.payload ? String(report.payload.id) : postId}
        subject={report.payload?.id === post.data?.id ? 'This post' : 'This comment'}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   A comment
   --------------------------------------------------------- */

const CommentRow = React.memo(function CommentRow({
  comment, pending, mine, onPressAuthor, onMenu, onLongPress,
}: {
  comment: any
  pending: boolean
  /** Marks the row as yours. The permission rules live in the menu. */
  mine: boolean
  /* Item-first: one function serves every row, and the closure that binds it
     to THIS comment is built here, behind the memo. */
  onPressAuthor: (comment: any) => void
  onMenu: (comment: any) => void
  onLongPress: (comment: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const pressAuthor = React.useCallback(() => onPressAuthor(comment), [onPressAuthor, comment])
  const openMenu = React.useCallback(() => onMenu(comment), [onMenu, comment])
  const longPress = React.useCallback(() => onLongPress(comment), [onLongPress, comment])

  if (comment.deleted) {
    return (
      <View style={styles.deleted}>
        <Text variant="footnote" tone="faint" italic align="ui">This comment was deleted</Text>
      </View>
    )
  }

  const author = comment._author || {}
  const name = author.full || comment.senderName || 'Member'

  return (
    <Touchable
      onLongPress={longPress}
      feedback="none"
      noAutoHitSlop
      style={[styles.comment, { paddingHorizontal: t.layout.screenPadding, opacity: pending ? 0.6 : 1 }]}
    >
      <Touchable onPress={pressAuthor} feedback="dim" noAutoHitSlop>
        <Avatar name={name} seed={comment.senderId} size={36} />
      </Touchable>
      <View style={styles.flex}>
        <View style={styles.commentHead}>
          <Text variant="subhead" weight="600" numberOfLines={1}>{name}</Text>
          {author.handle ? <Text variant="caption" tone="muted">@{author.handle}</Text> : null}
          <Text variant="caption" tone="faint">· {comment.time}</Text>
          {mine ? <Text variant="caption" tone="faint">· you</Text> : null}
          {comment.editedAt ? <Text variant="caption" tone="faint">· edited</Text> : null}
          {pending ? (
            <View style={[styles.pill, setback(t.shape.chip), { backgroundColor: c.surfaceSunken }]}>
              <Text variant="micro" tone="muted">Checking…</Text>
            </View>
          ) : null}
        </View>
        <Text variant="body" align="auto" style={{ marginTop: space.xxs }}>{comment.body}</Text>
        {comment.media?.length ? (
          <View style={{ marginTop: space.sm }}>
            <MediaAlbum media={comment.media} maxHeight={200} />
          </View>
        ) : null}
      </View>

      {/* The long-press is the accelerator; this is the control you can see. */}
      <Touchable
        onPress={openMenu}
        feedback="dim"
        accessibilityLabel="Comment actions"
        style={styles.commentMenu}
      >
        <Icon name="more" size={15} color={c.textFaint} />
      </Touchable>
    </Touchable>
  )
})

/* ---------------------------------------------------------
   Composer
   --------------------------------------------------------- */

function Composer({
  value, onChangeText, onSend, sending, disabled, cooldown, me,
}: {
  value: string
  onChangeText: (v: string) => void
  onSend: () => void
  sending: boolean
  disabled: boolean
  cooldown: number
  me: any
}) {
  const t = useTheme()
  const c = t.colors
  const ready = !!value.trim() && !sending && !disabled && cooldown === 0

  return (
    <View style={styles.composer}>
      <Avatar uri={me?.avatarUrl} name={me?.displayName} seed={me?.id} size={32} />
      {/* A composer well carries text, so it takes the setback, not a pill. */}
      <View style={[styles.input, setback(t.shape.buttonMd), { backgroundColor: c.surfaceSunken }]}>
        <CommentInput value={value} onChangeText={onChangeText} disabled={disabled} />
      </View>
      <Touchable
        onPress={onSend}
        disabled={!ready}
        feedback="scale"
        haptic="light"
        accessibilityLabel="Send comment"
        style={[styles.send, { backgroundColor: ready ? c.accent : c.surfaceSunken }]}
      >
        {cooldown > 0 ? (
          <Text variant="caption" tone="muted">{cooldown}</Text>
        ) : (
          <Icon name="send" size={17} color={ready ? c.textOnAccent : c.textFaint} />
        )}
      </Touchable>
    </View>
  )
}

/** Split out so the growing TextInput does not re-render the whole thread. */
const CommentInput = React.memo(function CommentInput({
  value, onChangeText, disabled,
}: { value: string; onChangeText: (v: string) => void; disabled: boolean }) {
  const t = useTheme()
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      editable={!disabled}
      placeholder="Add a comment…"
      placeholderTextColor={t.colors.textFaint}
      selectionColor={t.colors.accent}
      multiline
      style={{
        flex: 1,
        color: t.colors.text,
        fontSize: t.type.callout.fontSize,
        maxHeight: 110,
        paddingVertical: 0,
        textAlign: t.isRTL ? 'right' : 'left',
      }}
    />
  )
})

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    height: 44,
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  comment: { flexDirection: 'row', gap: space.sm2, paddingVertical: space.md },
  commentMenu: { paddingHorizontal: space.xs, paddingTop: space.xxs },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flexWrap: 'wrap' },
  deleted: { paddingHorizontal: 62, paddingVertical: space.sm, minHeight: 32, justifyContent: 'center' },
  pill: { paddingHorizontal: space.sm, paddingVertical: space.xxs, borderCurve: 'continuous' },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md },
  input: { flex: 1, minHeight: 38, justifyContent: 'center', paddingHorizontal: space.md2, paddingVertical: space.sm2, borderCurve: 'continuous' },
  linkGroupBtn: { marginTop: space.sm2, alignSelf: 'flex-start' },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  editStrip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.md, marginBottom: space.sm, padding: space.sm, borderRadius: 10 },
  flex: { flex: 1 },
})
