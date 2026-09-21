/* =========================================================
   Comments — the full depth-1 thread.

   Realtime patches the list in place through the SAME channel
   the detail screen already opened (openStream multiplexes per
   (domain, id)), so this screen costs no extra socket.

   The one non-obvious rule is COMMENT_EDITED: the embedded
   comment's `myReaction` is deliberately neutral on the wire,
   so replacing the row wholesale would silently un-like the
   viewer's own reaction. The local `liked` flag is preserved.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useLocalSearchParams } from 'expo-router'
import { adapters, api } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useRealtime } from '@/hooks/useRealtime'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Divider, EmptyState, Header, ListFooter, Screen, SkeletonRow, Text, Touchable, useSheetState,
} from '@/ui'
import { ResearchCommentMenu } from '@/components/research/CommentActions'
import { CommentComposer } from '@/components/research/CommentComposer'
import { CommentRow } from '@/components/research/CommentRow'
import { ErrorPanel } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import type { ResearchComment } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a
   fresh component TYPE each render — every visible divider would remount. */
const keyExtractor = (row: ResearchComment) => String(row.id)
const Sep = () => <Divider style={styles.sep} />

export default function CommentsScreen() {
  const t = useTheme()
  const c = t.colors
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  /* Only for `commentsEnabled` and the owner check — no second stream. */
  const { detail } = useResearchDetail(id, { subscribe: false, recordView: false })
  const isOwner = !!user?.id && detail?.author === user.id

  const [rows, setRows] = React.useState<ResearchComment[]>([])
  const [page, setPage] = React.useState(0)
  const [last, setLast] = React.useState(false)
  const [total, setTotal] = React.useState<number | null>(null)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [expanded, setExpanded] = React.useState<string[]>([])
  const [reply, setReply] = React.useState<ResearchComment | null>(null)

  const menu = useSheetState<ResearchComment>()

  const first = useAsync<{ rows: ResearchComment[]; last: boolean; total: number }>(
    async () => {
      const res: any = await api.research.comments(id, { page: 0, size: 20 })
      return {
        rows: (res?.content || []).map(adapters.researchCommentFrom) as ResearchComment[],
        last: res?.last ?? ((res?.number ?? 0) + 1 >= (res?.totalPages ?? 1)),
        total: res?.totalElements ?? 0,
      }
    },
    {
      enabled: !!id,
      deps: [id],
      onSuccess: (v: any) => { setRows(v.rows); setLast(v.last); setTotal(v.total); setPage(0) },
    },
  )

  const loadMore = async () => {
    if (last || loadingMore || first.loading) return
    setLoadingMore(true)
    try {
      const res: any = await api.research.comments(id, { page: page + 1, size: 20 })
      const mapped = (res?.content || []).map(adapters.researchCommentFrom) as ResearchComment[]
      setRows(prev => [...prev, ...mapped.filter(m => !prev.some(p => p.id === m.id))])
      setPage(p => p + 1)
      setLast(res?.last ?? true)
    } catch { /* the footer stops; the rows already fetched stay */ }
    finally { setLoadingMore(false) }
  }

  const patchRow = React.useCallback((commentId: string, patch: Partial<ResearchComment>) => {
    setRows(prev => prev.map(row => {
      if (row.id === commentId) return { ...row, ...patch }
      if (row.replies?.some(r => r.id === commentId)) {
        return { ...row, replies: row.replies.map(r => (r.id === commentId ? { ...r, ...patch } : r)) }
      }
      return row
    }))
  }, [])

  /* The stream replays its cached `connected` greeting to a late joiner, so the
     first callback would just repeat the page-0 load that is already in
     flight. Every reconnect after that is a real reconcile point. */
  const greeted = React.useRef(false)

  useRealtime('researches', id, {
    onConnected: () => {
      if (!greeted.current) { greeted.current = true; return }
      void first.refresh()
    },
    onEvent: (evt: any) => {
      switch (evt.eventType) {
        case 'COMMENT_CREATED':
          if (!evt.comment) return
          setRows(prev => {
            const mapped = adapters.researchCommentFrom(evt.comment) as ResearchComment
            return prev.some(r => r.id === mapped.id) ? prev : [mapped, ...prev]
          })
          setTotal(n => (n ?? 0) + 1)
          break
        case 'REPLY_CREATED':
          if (!evt.comment || !evt.parentCommentId) return
          setRows(prev => prev.map(row => {
            if (row.id !== evt.parentCommentId) return row
            const mapped = adapters.researchCommentFrom(evt.comment) as ResearchComment
            if (row.replies.some(r => r.id === mapped.id)) return row
            return {
              ...row,
              replies: [...row.replies, mapped],
              replyCount: evt.commentReplyCount ?? row.replyCount + 1,
            }
          }))
          break
        case 'COMMENT_EDITED': {
          if (!evt.comment) return
          const mapped = adapters.researchCommentFrom(evt.comment) as ResearchComment
          /* Keep the viewer's own reaction: the wire's myReaction is neutral. */
          patchRow(mapped.id, { body: mapped.body, edited: true, mediaUrl: mapped.mediaUrl })
          break
        }
        case 'COMMENT_DELETED':
          setRows(prev => prev
            .filter(r => r.id !== evt.commentId)
            .map(r => (evt.parentCommentId && r.id === evt.parentCommentId
              ? {
                ...r,
                replies: r.replies.filter(x => x.id !== evt.commentId),
                replyCount: evt.commentReplyCount ?? Math.max(0, r.replyCount - 1),
              }
              : r)))
          setTotal(n => Math.max(0, (n ?? 1) - 1))
          break
        case 'COMMENT_REACTION_ADDED':
        case 'COMMENT_REACTION_REMOVED':
          patchRow(evt.commentId, { likes: evt.commentReactionCount ?? evt.commentLikeCount ?? 0 })
          break
        default:
          break
      }
    },
  })

  const onSent = (comment: ResearchComment) => {
    if (reply) {
      const rootId = reply.parentId ?? reply.id
      setRows(prev => prev.map(row => (row.id === rootId
        ? { ...row, replies: [...row.replies, comment], replyCount: row.replyCount + 1 }
        : row)))
      setExpanded(e => (e.includes(rootId) ? e : [...e, rootId]))
      setReply(null)
    } else {
      setRows(prev => (prev.some(r => r.id === comment.id) ? prev : [comment, ...prev]))
      setTotal(n => (n ?? 0) + 1)
    }
  }

  /* The write already landed — this only reconciles local state. Deleting a
     REPLY must also walk its parent's `replyCount` down, or the "Show n more
     replies" label keeps promising rows that are gone. */
  const dropRow = React.useCallback((target: ResearchComment) => {
    menu.close()
    setRows(prev => prev
      .filter(r => r.id !== target.id)
      .map(r => (r.replies.some(x => x.id === target.id)
        ? { ...r, replies: r.replies.filter(x => x.id !== target.id), replyCount: Math.max(0, r.replyCount - 1) }
        : r)))
    setTotal(n => Math.max(0, (n ?? 1) - 1))
  }, [menu.close]) // eslint-disable-line react-hooks/exhaustive-deps

  /* useCallback, not a bare function: this screen re-renders on every
     realtime frame, and a fresh renderItem identity re-invokes renderItem for
     every mounted ViewHolder (FlashList's memo compares it by reference).
     `menu.open`, `setReply` and `patchRow` are all identity-stable, so the
     only thing that can move this is the expanded set. */
  const renderComment = React.useCallback(({ item }: { item: ResearchComment }) => {
    const open = expanded.includes(item.id)
    const shown = open ? item.replies : item.replies.slice(0, 3)
    const hiddenCount = item.replies.length - shown.length
    return (
      <View>
        <CommentRow
          comment={item}
          researchId={id}
          viewerId={user?.id}
          onReply={setReply}
          onMenu={menu.open}
          onPatch={patchRow}
        />
        {shown.map(r => (
          <CommentRow
            key={r.id}
            comment={r}
            researchId={id}
            viewerId={user?.id}
            indented
            onReply={setReply}
            onMenu={menu.open}
            onPatch={patchRow}
          />
        ))}
        {hiddenCount > 0 ? (
          <Touchable
            onPress={() => setExpanded(e => [...e, item.id])}
            feedback="dim"
            style={styles.moreReplies}
          >
            <Text variant="caption" tone="accent" align="ui">Show {hiddenCount} more repl{hiddenCount === 1 ? 'y' : 'ies'}</Text>
          </Touchable>
        ) : null}
      </View>
    )
  }, [expanded, id, user?.id, menu.open, patchRow])

  return (
    <Screen>
      <Header
        back
        title={`Comments${total != null ? ` · ${total}` : ''}`}
        actions={[]}
      />
      <View style={styles.orderNote}>
        <Text variant="caption" tone="faint" align="ui">Newest first</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={0}>
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderComment}
          ItemSeparatorComponent={Sep}
          ListEmptyComponent={
            first.loading ? (
              <View>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} avatarSize={36} lines={2} />)}</View>
            ) : first.error ? (
              <ErrorPanel error={first.error} onRetry={first.reload} />
            ) : (
              <EmptyState icon="comment" title="No comments yet." message="Start the discussion." />
            )
          }
          ListFooterComponent={rows.length ? <ListFooter loading={loadingMore} done={last} doneLabel="End of the discussion" /> : null}
          onEndReached={() => { void loadMore() }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={first.refreshing} onRefresh={() => { void first.refresh() }} tintColor={c.textMuted} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />

        <CommentComposer
          researchId={id}
          /* Depth is capped at 1 server-side — a reply to a reply targets the
             ROOT, which is what the server would hoist it to anyway. */
          parentId={reply ? (reply.parentId ?? reply.id) : null}
          replyToHandle={reply?._author.handle ?? null}
          onCancelReply={() => setReply(null)}
          viewer={user ? {
            id: user.id,
            full: user.displayName || user.handle || 'You',
            handle: user.handle || '',
            initials: '',
            avc: '',
            profileImage: user.profileImage ?? null,
            verified: !!user.verified,
            role: user.role || 'USER',
          } : null}
          /* Published-only rule: commenting on a non-published paper answers
             400 NOT_PUBLISHED — gate it here rather than letting the send
             discover it. */
          disabled={detail ? (!detail.commentsEnabled || detail.status !== 'PUBLISHED') : false}
          disabledReason={
            detail && detail.status !== 'PUBLISHED'
              ? 'Comments open once this paper is published.'
              : 'Comments are turned off for this paper.'
          }
          onSent={onSent}
        />
      </KeyboardAvoidingView>

      <ResearchCommentMenu
        visible={menu.visible}
        onClose={menu.close}
        comment={menu.payload}
        researchId={id}
        viewerId={user?.id}
        isResearchOwner={isOwner}
        onReply={setReply}
        onPatch={patchRow}
        onDeleted={dropRow}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  orderNote: { paddingHorizontal: space.lg, paddingBottom: space.xs2 },
  moreReplies: { paddingStart: 60, paddingVertical: space.sm },
  sep: { marginHorizontal: space.lg },
  flex: { flex: 1 },
})
