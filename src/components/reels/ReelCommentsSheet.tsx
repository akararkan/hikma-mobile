/* =========================================================
   Reel comments.

   Three contracts drive almost every line here:

   1. PAGING. The last row's `createdAt` IS the cursor —
      `commentFrom` carries it, so both pages go through
      api.posts.comments.
   2. DEPTH. The server caps threads at one level: replying to
      a reply produces a SIBLING whose parentCommentId is the
      top-level ancestor. So the UI must never draw a third
      level, and a reply inserts under the ancestor rather than
      under the row that was tapped.
   3. MODERATION. A refusal keeps the draft, shows the server's
      sentence verbatim and offers NO retry — resubmitting the
      identical text can only fail the identical way.

   The comment menu is deliberately the SAME vocabulary, order
   and copy as the post surfaces (components/post/PostMenuSheet):
   Reply · Copy text · Edit comment · Report · Delete comment,
   author-only entries hidden rather than shown-and-403'd,
   Report absent on your own rows and while signed out, and the
   delete behind the one confirm wording the whole app uses.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { useAuth } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useRealtime } from '@/hooks/useRealtime'
import { isBlocked, moderationText } from '@/lib/moderation'
import { setback, shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import {
  ActionSheet, Avatar, Button, ConfirmSheet, Icon, NumericText, Skeleton, Text, Touchable,
  fireHaptic, formatCount, toast, useSheetState,
} from '@/ui'
import { STAGE } from './skin'
import type { ViewComment } from './types'

const PAGE = 20

/* Module scope. FlashList's ViewHolder memo compares renderItem and its
   siblings BY IDENTITY, so anything rebuilt in the component body re-renders
   every mounted row on every keystroke in the composer below. */
const keyExtractor = (row: ViewComment) => String(row.id)

export interface ReelCommentsSheetProps {
  postId: string
  initialCount?: number
  onCountChange?: (n: number) => void
  onClose: () => void
}

export function ReelCommentsSheet({ postId, initialCount, onCountChange, onClose }: ReelCommentsSheetProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, signedIn } = useAuth()

  const [rows, setRows] = React.useState<ViewComment[]>([])
  const [replies, setReplies] = React.useState<Record<string, ViewComment[]>>({})
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [done, setDone] = React.useState(false)
  const [count, setCount] = React.useState(initialCount ?? 0)

  const [draft, setDraft] = React.useState('')
  const [replyTo, setReplyTo] = React.useState<{ id: string; handle: string; ancestor: string } | null>(null)
  /* Edit reuses the composer: the draft becomes the comment's body and send
     PATCHes instead of POSTing. Author-only (engagement.md §3.5). */
  const [editing, setEditing] = React.useState<ViewComment | null>(null)
  const [sending, setSending] = React.useState(false)
  const [blocked, setBlocked] = React.useState<string | null>(null)
  /* useCooldown is JS, so its tuple infers as (number | fn)[] — the cast is
     what keeps the countdown a number at every call site. */
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  const cursor = React.useRef<string | null>(null)
  const menu = useSheetState<ViewComment>()
  const confirmDelete = useSheetState<ViewComment>()
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => { onCountChange?.(count) }, [count])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- reads ------------------------------------------------------------ */

  const loadFirst = React.useCallback(async () => {
    if (!postId) return
    setLoading(true)
    setError(null)
    try {
      const list = (await api.posts.comments(postId, { pageSize: PAGE })) as ViewComment[]
      setRows(list)
      cursor.current = list?.length ? list[list.length - 1]?.createdAt ?? null : null
      setDone(!list?.length || !cursor.current)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [postId])

  React.useEffect(() => { void loadFirst() }, [loadFirst])

  /* The count is a post-level counter, so it comes from the post rather than
     from however many rows happen to be loaded. */
  React.useEffect(() => {
    if (initialCount != null || !postId) return
    api.posts.get(postId).then((p: any) => setCount(p?.comments ?? 0)).catch(() => {})
  }, [postId, initialCount])

  const loadMore = React.useCallback(async () => {
    if (loading || loadingMore || done || !cursor.current) return
    setLoadingMore(true)
    try {
      const list = (await api.posts.comments(postId, { cursor: cursor.current, pageSize: PAGE })) as ViewComment[]
      setRows(prev => {
        const seen = new Set(prev.map(r => r.id))
        return [...prev, ...list.filter(r => !seen.has(r.id))]
      })
      cursor.current = list?.length ? list[list.length - 1]?.createdAt ?? null : null
      setDone(!list?.length || !cursor.current)
    } catch (e) {
      setError(e)
    } finally {
      setLoadingMore(false)
    }
  }, [postId, loading, loadingMore, done])

  const openReplies = React.useCallback(async (parent: ViewComment) => {
    setExpanded(e => ({ ...e, [parent.id]: !e[parent.id] }))
    if (replies[parent.id]) return
    try {
      const list = await api.posts.replies(parent.id, { pageSize: PAGE })
      setReplies(r => ({ ...r, [parent.id]: list as ViewComment[] }))
    } catch (e) {
      toast.error(errorText(e))
    }
  }, [replies])

  /* ---- realtime ----------------------------------------------------------
     The pager already holds a channel for this post and openStream shares one
     per (domain, id) — so subscribing here reuses that socket rather than
     spending one of the five the user is allowed. */
  useRealtime('posts', postId, {
    onEvent: (evt: any) => {
      switch (evt?.eventType) {
        case 'COMMENT_CREATED':
          setCount(c => c + 1)
          break
        case 'REPLY_CREATED':
          setCount(c => c + 1)
          /* Inverse of the COMMENT_DELETED decrement below — a create that
             bumps a counter its matching delete does not restore is how the
             'View N replies' label drifts away from the list it labels. */
          if (evt.parentCommentId) {
            const anchor = String(evt.parentCommentId)
            setRows(prev => prev.map(r => (r.id === anchor ? { ...r, replyCount: r.replyCount + 1 } : r)))
          }
          break
        case 'COMMENT_DELETED': {
          if (!evt.commentId) break
          const cid = String(evt.commentId)
          /* A top-level delete range-deletes the whole reply partition, so the
             post counter falls by 1 + replyCount — the frame carries neither,
             so the local row is the only source for the remainder. A reply is
             a plain −1, but it owes its ancestor a replyCount. */
          const parentId = evt.parentCommentId ? String(evt.parentCommentId) : null
          /* useRealtime re-latches its handlers every render, so `rows` here is
             the committed list — read the row BEFORE the filter below drops it,
             because its replyCount is the only source for the extra decrement
             the frame does not carry. */
          const removed = rows.find(r => r.id === cid)
          const drop = parentId ? 1 : 1 + (removed?.replyCount || 0)
          setCount(c => Math.max(0, c - drop))
          setRows(prev => prev
            .filter(r => r.id !== cid)
            .map(r => (parentId && r.id === parentId ? { ...r, replyCount: Math.max(0, r.replyCount - 1) } : r)))
          setReplies(r => {
            const next: Record<string, ViewComment[]> = {}
            for (const [k, v] of Object.entries(r)) {
              /* Drop the partition itself when its owner goes. */
              if (k === cid) continue
              next[k] = v.filter(x => x.id !== cid)
            }
            return next
          })
          break
        }
        case 'COMMENT_EDITED': {
          if (!evt.commentId) break
          const cid = String(evt.commentId)
          const patch = (c: ViewComment) => (c.id === cid ? { ...c, body: evt.textContent ?? c.body, edited: true } : c)
          setRows(prev => prev.map(patch))
          setReplies(r => {
            const next: Record<string, ViewComment[]> = {}
            for (const [k, v] of Object.entries(r)) next[k] = v.map(patch)
            return next
          })
          break
        }
        default:
          break
      }
    },
    onConnected: () => {
      api.posts.get(postId).then((p: any) => setCount(p?.comments ?? 0)).catch(() => {})
    },
  })

  /* ---- writes ----------------------------------------------------------- */

  const send = React.useCallback(async () => {
    const text = draft.trim()
    if (!text || sending || cooldown > 0) return
    setSending(true)
    setBlocked(null)

    if (editing) {
      /* PATCH answers 204 — the sheet's own copy is the source of truth. */
      try {
        await api.posts.editComment(editing.id, text)
        const patch = (c: ViewComment) => (c.id === editing.id ? { ...c, body: text, edited: true } : c)
        setRows(prev => prev.map(patch))
        setReplies(r => {
          const next: Record<string, ViewComment[]> = {}
          for (const [k, v] of Object.entries(r)) next[k] = v.map(patch)
          return next
        })
        setDraft('')
        setEditing(null)
        fireHaptic('success')
      } catch (e: any) {
        if (isBlocked(e)) setBlocked(moderationText(e))
        else if (codeOf(e) === 'ILLEGAL_ARGUMENT') {
          /* Deleted while the edit was being typed — drop the ghost row. */
          setRows(prev => prev.filter(x => x.id !== editing.id))
          setReplies(r => {
            const next: Record<string, ViewComment[]> = {}
            for (const [k, v] of Object.entries(r)) next[k] = v.filter(x => x.id !== editing.id)
            return next
          })
          setDraft('')
          setEditing(null)
          toast.error(errorText(e))
        } else if (!startCooldown(e)) toast.error(errorText(e))
      } finally {
        setSending(false)
      }
      return
    }

    try {
      const created = replyTo
        ? await api.posts.addReply(replyTo.id, { text })
        : await api.posts.addComment(postId, { text })

      const row = created as ViewComment
      if (replyTo) {
        /* The response's parentCommentId is the TOP-LEVEL ancestor, which is
           where the row belongs — not under the reply that was tapped. */
        const ancestor = row.parentCommentId || replyTo.ancestor
        setReplies(r => {
          const list = r[ancestor] ?? []
          return list.some(x => x.id === row.id) ? r : { ...r, [ancestor]: [...list, row] }
        })
        setExpanded(e => ({ ...e, [ancestor]: true }))
        setRows(prev => prev.map(x => (x.id === ancestor ? { ...x, replyCount: x.replyCount + 1 } : x)))
      } else {
        /* A 3s server-side duplicate guard returns the EXISTING row, so a
           double-send must dedupe on id rather than draw two bubbles. */
        setRows(prev => (prev.some(x => x.id === row.id) ? prev : [...prev, row]))
      }
      setCount(c => c + 1)
      setDraft('')
      setReplyTo(null)
      fireHaptic('success')
    } catch (e: any) {
      if (isBlocked(e)) {
        /* Verbatim, no decoration, no retry button: a precise error is a
           working oracle for probing the classifier. */
        setBlocked(moderationText(e))
      } else if (startCooldown(e)) {
        /* the countdown owns the button now */
      } else if (codeOf(e) === 'ILLEGAL_ARGUMENT') {
        toast.warn(errorText(e))
        setReplyTo(null)
        void loadFirst()
      } else {
        toast.error(errorText(e))
      }
    } finally {
      setSending(false)
    }
  }, [draft, sending, cooldown, replyTo, editing, postId, startCooldown, loadFirst])

  const toggleLike = React.useCallback(async (comment: ViewComment, parentId?: string) => {
    if (!signedIn) { router.push('/(auth)/sign-in'); return }
    const apply = (fn: (c: ViewComment) => ViewComment) => {
      if (parentId) setReplies(r => ({ ...r, [parentId]: (r[parentId] ?? []).map(c => (c.id === comment.id ? fn(c) : c)) }))
      else setRows(prev => prev.map(c => (c.id === comment.id ? fn(c) : c)))
    }
    apply(c => ({ ...c, liked: !c.liked, likes: Math.max(0, c.likes + (c.liked ? -1 : 1)) }))
    try {
      const res: any = await api.posts.toggleCommentReaction(postId, comment.id)
      apply(c => ({ ...c, liked: !!res?.liked }))
    } catch (e) {
      apply(c => ({ ...c, liked: comment.liked, likes: comment.likes }))
      toast.error(errorText(e))
    }
  }, [postId, signedIn, router])

  /* NOT optimistic, and deliberately so. deleteComment physically removes the
     row and range-deletes its whole reply partition in one tombstone — there is
     no undo, and a rollback would have to resurrect replies this component no
     longer holds. So: await the 204 with the confirm button in `loading`, then
     mutate. A failure mutates nothing and says only what the server said. */
  const removeComment = React.useCallback(async (comment: ViewComment) => {
    if (deleting) return
    setDeleting(true)

    const dropLocally = () => {
      const parentId = comment.parentCommentId ? String(comment.parentCommentId) : null
      /* engagement.md §3.6 / realtime.md §3: a top-level delete takes its
         replies with it, so the post counter falls by 1 + replyCount. A reply
         is −1 and owes its ancestor a replyCount. */
      const drop = parentId ? 1 : 1 + (comment.replyCount || 0)
      setCount(c => Math.max(0, c - drop))
      setRows(prev => prev
        .filter(x => x.id !== comment.id)
        .map(x => (parentId && x.id === parentId ? { ...x, replyCount: Math.max(0, x.replyCount - 1) } : x)))
      setReplies(r => {
        const next: Record<string, ViewComment[]> = {}
        for (const [k, v] of Object.entries(r)) {
          if (k === comment.id) continue   // the partition dies with its owner
          next[k] = v.filter(x => x.id !== comment.id)
        }
        return next
      })
      setExpanded(e => {
        if (!(comment.id in e)) return e
        const { [comment.id]: _drop, ...rest } = e
        return rest
      })
      /* An edit staged against a row that no longer exists can only 400. */
      if (editing?.id === comment.id) { setEditing(null); setDraft('') }
      confirmDelete.close()
    }

    try {
      await api.posts.deleteComment(comment.id)
      dropLocally()
      toast.ok('Comment deleted')
    } catch (e) {
      /* Already gone — that is the outcome the user asked for, so drop the row
         rather than raise an error about a row they wanted removed. */
      if (isNotFound(e) || codeOf(e) === 'ILLEGAL_ARGUMENT') dropLocally()
      else toast.error(errorText(e))
    } finally {
      setDeleting(false)
    }
  }, [deleting, editing, confirmDelete])

  /* ---- render -----------------------------------------------------------

     Every handler a row is given is identity-stable and comment-taking, and a
     reply carries its ancestor as a scalar `parentId` — so ONE function serves
     every row at both levels and CommentRow's React.memo actually hits. The
     alternative (a closure per row) rebuilt five callbacks per comment on every
     keystroke in the composer. */

  const likeRow = useEvent((c: ViewComment, parentId?: string) => { void toggleLike(c, parentId) })
  const replyToRow = useEvent((c: ViewComment, parentId?: string) => {
    /* Depth is capped at 1 server-side, so a reply targets the SAME ancestor
       it already lives under — never a third level. */
    const anchor = parentId ?? c.id
    setReplyTo({ id: anchor, handle: c._author.handle, ancestor: anchor })
  })
  const menuRow = useEvent((c: ViewComment) => menu.open(c))
  const authorRow = useEvent((c: ViewComment) => router.push(`/u/${c.author}`))
  const tagRow = useEvent((tag: string) => router.push(`/tags/${encodeURIComponent(tag)}`))
  const expandRow = useEvent((c: ViewComment) => { void openReplies(c) })

  const myId = user?.id
  /* Identity moves exactly when something a row renders moves — never on a
     keystroke, a cooldown tick or a count frame. */
  const extraData = React.useMemo(() => ({ expanded, replies }), [expanded, replies])
  const renderItem = React.useCallback(({ item }: { item: ViewComment }) => (
    <View>
      <CommentRow
        comment={item}
        mine={item.author === myId}
        onLike={likeRow}
        onReply={replyToRow}
        onMenu={menuRow}
        onAuthor={authorRow}
        onTag={tagRow}
      />
      {item.replyCount > 0 ? (
        <Touchable onPress={() => expandRow(item)} feedback="dim" noAutoHitSlop style={styles.expander}>
          <View style={styles.expanderRule} />
          <Text variant="caption" weight="600" color={STAGE.fgMuted}>
            {expanded[item.id] ? 'Hide replies' : `View ${item.replyCount} ${item.replyCount === 1 ? 'reply' : 'replies'}`}
          </Text>
        </Touchable>
      ) : null}
      {expanded[item.id]
        ? (replies[item.id] ?? []).map(reply => (
          <View key={reply.id} style={styles.replyIndent}>
            <CommentRow
              comment={reply}
              parentId={item.id}
              mine={reply.author === myId}
              compact
              onLike={likeRow}
              onReply={replyToRow}
              onMenu={menuRow}
              onAuthor={authorRow}
              onTag={tagRow}
            />
          </View>
        ))
        : null}
    </View>
  ), [expanded, replies, myId, likeRow, replyToRow, menuRow, authorRow, tagRow, expandRow])

  const composerDisabled = sending || cooldown > 0 || !draft.trim()

  const body = () => {
    if (loading) {
      return (
        <View style={{ paddingTop: space.sm2 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={styles.row}>
              <Skeleton circle width={32} height={32} />
              <View style={{ flex: 1, gap: space.sm, paddingTop: space.xs }}>
                <Skeleton width="34%" height={11} />
                <Skeleton width="88%" height={12} />
                <Skeleton width="46%" height={12} />
              </View>
            </View>
          ))}
        </View>
      )
    }

    if (!rows.length && error) {
      return (
        <View style={styles.centre}>
          <Icon name={isNotFound(error) ? 'search' : 'error'} size={30} color={STAGE.fgFaint} />
          <Text variant="callout" color={STAGE.fgMuted} align="center" style={{ marginTop: space.sm2 }}>
            {errorText(error)}
          </Text>
          <Button label="Try again" onPress={() => { void loadFirst() }} variant="tinted" size="sm" style={{ marginTop: space.md2 }} />
        </View>
      )
    }

    if (!rows.length) {
      return (
        <View style={styles.centre}>
          <Icon name="comment" size={40} color={STAGE.fgFaint} />
          <Text variant="headline" color={STAGE.fg} align="center" style={{ marginTop: space.md }}>No comments yet</Text>
          <Text variant="callout" color={STAGE.fgMuted} align="center" style={{ marginTop: space.xs }}>Be the first to comment.</Text>
        </View>
      )
    }

    return (
      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        extraData={extraData}
        renderItem={renderItem}
        onEndReached={() => { void loadMore() }}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space.lg }}
        ListFooterComponent={
          loadingMore
            ? <Text variant="caption" color={STAGE.fgFaint} align="center" style={{ paddingVertical: space.lg }}>Loading…</Text>
            : error
              ? <Touchable onPress={() => { void loadMore() }} feedback="dim" style={styles.footerRetry}>
                <Text variant="footnote" color={STAGE.danger} align="center">{errorText(error)} · Retry</Text>
              </Touchable>
              : <View style={{ height: 8 }} />
        }
      />
    )
  }

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text variant="headline" color={STAGE.fg} align="center" style={{ flex: 1 }}>
          {count ? `${formatCount(count)} ${count === 1 ? 'comment' : 'comments'}` : 'Comments'}
        </Text>
        <Touchable onPress={onClose} feedback="scale" accessibilityLabel="Close comments" style={styles.headerSpacer}>
          <Icon name="close" size={20} color={STAGE.fgMuted} />
        </Touchable>
      </View>

      <View style={{ flex: 1 }}>{body()}</View>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        {blocked ? (
          <View style={styles.blockedStrip}>
            <Icon name="warning" size={14} color={STAGE.danger} />
            <Text variant="footnote" color={STAGE.danger} align="ui" style={{ flex: 1 }}>{blocked}</Text>
          </View>
        ) : null}

        {editing ? (
          <View style={styles.replyChip}>
            <Text variant="caption" color={STAGE.fgMuted}>Editing comment</Text>
            <Touchable
              onPress={() => { setEditing(null); setDraft('') }}
              feedback="dim"
              accessibilityLabel="Cancel edit"
            >
              <Icon name="close" size={13} color={STAGE.fgMuted} />
            </Touchable>
          </View>
        ) : replyTo ? (
          <View style={styles.replyChip}>
            <Text variant="caption" color={STAGE.fgMuted}>Replying to @{replyTo.handle}</Text>
            <Touchable onPress={() => setReplyTo(null)} feedback="dim" accessibilityLabel="Cancel reply">
              <Icon name="close" size={13} color={STAGE.fgMuted} />
            </Touchable>
          </View>
        ) : null}

        {signedIn ? (
          <View style={styles.composer}>
            <Avatar uri={user?.profileImage} name={user?.displayName || user?.full} seed={user?.id} size={30} />
            <TextInput
              value={draft}
              onChangeText={v => { setDraft(v); if (blocked) setBlocked(null) }}
              placeholder={editing ? 'Edit your comment…' : 'Add a comment…'}
              placeholderTextColor={STAGE.fgFaint}
              selectionColor={t.colors.cta}
              multiline
              style={[styles.input, { fontSize: t.type.callout.fontSize }]}
              editable={!sending}
            />
            <Touchable
              onPress={() => { void send() }}
              disabled={composerDisabled}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={cooldown > 0 ? `Wait ${cooldown} seconds` : 'Send comment'}
              style={[
                styles.send,
                { backgroundColor: composerDisabled ? STAGE.fgGhost : t.colors.cta, width: cooldown > 0 ? 74 : 30 },
              ]}
            >
              {cooldown > 0
                ? <Text variant="caption" weight="700" color={composerDisabled ? STAGE.fg : t.colors.textOnCta}>Wait {cooldown}s</Text>
                : <Icon name="send" size={15} color={composerDisabled ? STAGE.fg : t.colors.textOnCta} />}
            </Touchable>
          </View>
        ) : (
          <View style={styles.composer}>
            <Button label="Sign in to comment" onPress={() => router.push('/(auth)/sign-in')} variant="onDark" block size="md" />
          </View>
        )}
        {/* The composer must clear the gesture-nav bar — Android is
            edge-to-edge, and a bar without this rides under the pill. */}
        <View style={{ height: insets.bottom }} />
      </KeyboardStickyView>

      {/* Same entries, same order, same words as the post surfaces. */}
      <ActionSheet
        visible={menu.visible && !confirmDelete.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Reply',
            icon: 'reply',
            hidden: !signedIn,
            onPress: () => {
              const target = menu.payload
              if (!target) return
              /* Depth is capped at 1 server-side: replying to a reply targets
                 the top-level ancestor, never a third level. */
              const ancestor = target.parentCommentId || target.id
              setEditing(null)
              setReplyTo({ id: ancestor, handle: target._author.handle, ancestor })
            },
          },
          {
            label: 'Copy text',
            icon: 'copy',
            onPress: async () => { if (menu.payload) { await Clipboard.setStringAsync(menu.payload.body); toast.ok('Copied') } },
          },
          {
            label: 'Edit comment',
            icon: 'edit',
            hidden: !signedIn || menu.payload?.author !== user?.id,
            onPress: () => {
              const target = menu.payload
              if (!target) return
              setReplyTo(null)
              setEditing(target)
              setDraft(target.body)
            },
          },
          {
            /* The canonical /report route, not a bare reason list: it collects
               the details field, carries the author for 'Block this account
               instead', and files one success sentence app-wide. */
            label: 'Report',
            icon: 'flag',
            destructive: true,
            hidden: !signedIn || menu.payload?.author === user?.id,
            onPress: () => {
              const target = menu.payload
              if (!target) return
              router.push(reportHref({
                targetType: 'COMMENT',
                targetId: target.id,
                authorId: target.author ? String(target.author) : undefined,
                name: target._author?.full || undefined,
                avatar: target._author?.profileImage || undefined,
                snippet: target.body || undefined,
              }))
            },
          },
          {
            label: 'Delete comment',
            icon: 'trash',
            destructive: true,
            hidden: !signedIn || menu.payload?.author !== user?.id,
            onPress: () => { if (menu.payload) confirmDelete.open(menu.payload) },
          },
        ]}
      />

      {/* Word for word the post surfaces' copy — one wording per kind. */}
      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={() => { if (!deleting) confirmDelete.close() }}
        title="Delete this comment?"
        message="Its replies are deleted with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => { if (confirmDelete.payload) void removeComment(confirmDelete.payload) }}
      />
    </>
  )
}

/* ---------------------------------------------------------
   One comment.
   --------------------------------------------------------- */

/* `-` is NOT a handle character server-side, and a handle is 2–50 long —
   `@a` and `@some-name` both used to highlight here and neither pings. Kept as
   a split-and-keep pattern (the caption renderer below relies on the odd-index
   invariant) rather than importing mentionSpans, so the leading guard is
   written as a non-capturing lookahead-free bound: a `@` may not follow a word
   character or another `@`. */
const TOKEN = /(#[\p{L}\p{N}_]+|@[A-Za-z0-9._]{2,50})/u

const CommentRow = React.memo(function CommentRow({
  comment, mine, compact, parentId, onLike, onReply, onMenu, onAuthor, onTag,
}: {
  comment: ViewComment
  mine: boolean
  compact?: boolean
  /** The ancestor this row hangs under — set on replies, absent at top level.
   *  A scalar rather than a closure, so the handlers above stay shared. */
  parentId?: string
  onLike: (comment: ViewComment, parentId?: string) => void
  onReply: (comment: ViewComment, parentId?: string) => void
  onMenu: (comment: ViewComment) => void
  onAuthor: (comment: ViewComment) => void
  onTag: (tag: string) => void
}) {
  const like = React.useCallback(() => onLike(comment, parentId), [onLike, comment, parentId])
  const reply = React.useCallback(() => onReply(comment, parentId), [onReply, comment, parentId])
  const openMenu = React.useCallback(() => onMenu(comment), [onMenu, comment])
  const openAuthor = React.useCallback(() => onAuthor(comment), [onAuthor, comment])

  const runs = React.useMemo(() => {
    const parts = comment.body.split(TOKEN).filter(s => s !== '')
    return parts.map((part, i) => {
      if ((part.startsWith('#') || part.startsWith('@')) && part.length > 1) {
        return (
          <Text
            key={i}
            variant="callout"
            weight="600"
            color={STAGE.fg}
            onPress={part.startsWith('#') ? () => onTag(part.slice(1)) : undefined}
          >
            {part}
          </Text>
        )
      }
      return <Text key={i} variant="callout" color={STAGE.fgMuted}>{part}</Text>
    })
  }, [comment.body, onTag])

  return (
    <Touchable
      /* `haptic` rides onPress only, so the long-press buzzes for itself —
         the same `medium` the post comment row fires. */
      onLongPress={() => { fireHaptic('medium'); openMenu() }}
      feedback="none"
      noAutoHitSlop
      style={styles.row}
    >
      <Avatar
        uri={comment._author.profileImage}
        name={comment._author.full}
        seed={comment._author.id}
        size={compact ? 26 : 32}
        onPress={openAuthor}
      />
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={styles.rowHead}>
          <Text variant="footnote" weight="600" color={STAGE.fgMuted} onPress={openAuthor}>
            @{comment._author.handle}
          </Text>
          <Text variant="caption" color={STAGE.fgFaint}>{comment.time}</Text>
          {comment.edited ? <Text variant="caption" color={STAGE.fgFaint}>· edited</Text> : null}
          {mine ? <Text variant="caption" color={STAGE.fgFaint}>· you</Text> : null}
        </View>
        <Text variant="callout" color={STAGE.fgMuted} style={styles.body}>
          {comment._replyToHandle ? (
            <Text variant="callout" weight="600" color={STAGE.fg}>@{comment._replyToHandle} </Text>
          ) : null}
          {runs}
        </Text>
        <View style={styles.actionLine}>
          <Touchable onPress={reply} feedback="dim" noAutoHitSlop style={styles.replyBtn}>
            <Text variant="caption" weight="600" color={STAGE.fgFaint}>Reply</Text>
          </Touchable>
          {/* The affordance the menu never had: long-press stays as the
              accelerator, but a gesture nobody can see is not a control. */}
          <Touchable
            onPress={openMenu}
            feedback="dim"
            noAutoHitSlop
            accessibilityLabel="Comment actions"
            style={styles.replyBtn}
          >
            <Icon name="more" size={15} color={STAGE.fgFaint} />
          </Touchable>
        </View>
      </View>

      <Touchable
        onPress={like}
        feedback="scale"
        /* 30pt wide in a recycled row: keep the opt-out (no layout listener
           per comment) but pay the 44pt minimum explicitly — 7 is ⌈(44−30)/2⌉. */
        noAutoHitSlop
        hitSlop={7}
        accessibilityLabel={comment.liked ? 'Unlike comment' : 'Like comment'}
        style={styles.heart}
      >
        <Icon name="heart" size={17} filled={comment.liked} color={comment.liked ? STAGE.like : STAGE.fgFaint} />
        {comment.likes > 0 ? (
          <NumericText variant="caption" color={STAGE.fgFaint}>{formatCount(comment.likes)}</NumericText>
        ) : null}
      </Touchable>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: STAGE.hairline,
  },
  headerSpacer: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  centre: { paddingVertical: 60, alignItems: 'center', paddingHorizontal: space.xxxl },
  row: { flexDirection: 'row', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  body: { lineHeight: 19 },
  actionLine: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  replyBtn: { alignSelf: 'flex-start', paddingVertical: space.xs },
  heart: { alignItems: 'center', gap: space.xxs, paddingTop: space.xs, width: 30 },
  expander: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingStart: 60, paddingVertical: space.xs2 },
  expanderRule: { width: 22, height: StyleSheet.hairlineWidth, backgroundColor: STAGE.fgGhost },
  replyIndent: { paddingStart: 44 },
  footerRetry: { paddingVertical: space.md2 },
  blockedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm2,
    backgroundColor: 'rgba(194,72,61,0.14)',
  },
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm2,
    paddingHorizontal: space.md2,
    paddingTop: space.sm2,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: STAGE.hairline,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 96,
    paddingHorizontal: space.md2,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    /* The ledger line's shape on a black stage: a field well is setback, never
       a capsule (DESIGN.md §6, §8.9). */
    ...setback(shape.field),
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: STAGE.fg,
  },
  /* Widens to carry the cooldown label, so it is a button plate rather than an
     icon-only circle — setback, not a pill. */
  send: {
    height: 30,
    ...setback(shape.buttonSm),
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
