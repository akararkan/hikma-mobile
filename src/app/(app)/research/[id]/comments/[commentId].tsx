/* =========================================================
   One comment thread.

   There is NO per-comment endpoint. The only way to reach a
   single row is to page the list until it appears, which is
   what this screen does — capped at five pages, with a visible
   "Finding comment…" line past the second so a deep scan does
   not look frozen.

   The stream is the same (researches, id) channel the comments
   screen uses, so mounting this over it costs no extra socket.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { adapters, api } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useRealtime } from '@/hooks/useRealtime'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Card, Divider, Header, Icon, Screen, Skeleton, Spinner, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ResearchCommentMenu } from '@/components/research/CommentActions'
import { CommentComposer } from '@/components/research/CommentComposer'
import { CommentRow } from '@/components/research/CommentRow'
import { ErrorPanel, GoneState } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { ResearchComment } from '@/components/research/types'

const MAX_PAGES = 5

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a
   fresh component TYPE each render — every visible divider would remount. */
const keyExtractor = (r: ResearchComment) => String(r.id)
const Sep = () => <Divider style={styles.sep} />

export default function CommentThreadScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id, commentId } = useLocalSearchParams<{ id: string; commentId: string }>()
  const { user } = useAuth()
  const { detail } = useResearchDetail(id, { subscribe: false, recordView: false })
  const isOwner = !!user?.id && detail?.author === user.id

  const menu = useSheetState<ResearchComment>()
  const [root, setRoot] = React.useState<ResearchComment | null>(null)
  const [scanned, setScanned] = React.useState(0)
  const [state, setState] = React.useState<'scanning' | 'found' | 'missing' | 'error'>('scanning')
  const [error, setError] = React.useState<any>(null)

  const scan = React.useCallback(async () => {
    setState('scanning')
    setScanned(0)
    setError(null)
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        setScanned(page + 1)
        const res: any = await api.research.comments(id, { page, size: 20 })
        const rows = (res?.content || []).map(adapters.researchCommentFrom) as ResearchComment[]
        const hit = rows.find(r => r.id === commentId)
        if (hit) { setRoot(hit); setState('found'); return }
        const isLast = res?.last ?? ((res?.number ?? 0) + 1 >= (res?.totalPages ?? 1))
        if (isLast) break
      }
      setState('missing')
    } catch (e: any) {
      setError(e)
      setState('error')
    }
  }, [id, commentId])

  React.useEffect(() => { if (id && commentId) void scan() }, [id, commentId, scan])

  const patchRow = React.useCallback((targetId: string, patch: Partial<ResearchComment>) => {
    setRoot(prev => {
      if (!prev) return prev
      if (prev.id === targetId) return { ...prev, ...patch }
      return { ...prev, replies: prev.replies.map(r => (r.id === targetId ? { ...r, ...patch } : r)) }
    })
  }, [])

  const dropRow = React.useCallback((target: ResearchComment) => {
    menu.close()
    if (target.id === commentId) { setState('missing'); return }
    setRoot(prev => (prev
      ? {
        ...prev,
        replies: prev.replies.filter(r => r.id !== target.id),
        replyCount: Math.max(0, prev.replyCount - 1),
      }
      : prev))
  }, [commentId, menu.close]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Declared above the three state returns — hooks cannot be conditional.
     `patchRow` and `menu.open` are identity-stable, so renderItem holds one
     identity for the life of the screen. */
  const renderItem = React.useCallback(({ item }: { item: ResearchComment }) => (
    <CommentRow
      comment={item}
      researchId={id}
      viewerId={user?.id}
      onPatch={patchRow}
      onMenu={menu.open}
    />
  ), [id, user?.id, patchRow, menu.open])

  const listHeader = React.useMemo(() => (root ? (
    <View>
      <Card variant="raised" style={styles.rootCard}>
        <CommentRow
          comment={root}
          researchId={id}
          viewerId={user?.id}
          onMenu={menu.open}
          onPatch={patchRow}
        />
      </Card>
      {/* `micro` uppercases Latin INSIDE the Text primitive — that is what
          keeps an Arabic or Kurdish run untouched — so the label is written
          in sentence case and carries no tracking of its own. */}
      <Text variant="micro" tone="muted" align="ui" style={styles.repliesLabel}>
        {root.replies.length} {root.replies.length === 1 ? 'reply' : 'replies'}
      </Text>
    </View>
  ) : null), [root, id, user?.id, menu.open, patchRow])

  useRealtime('researches', id, {
    onEvent: (evt: any) => {
      switch (evt.eventType) {
        case 'REPLY_CREATED':
          if (evt.parentCommentId !== commentId || !evt.comment) return
          setRoot(prev => {
            if (!prev) return prev
            const mapped = adapters.researchCommentFrom(evt.comment) as ResearchComment
            if (prev.replies.some(r => r.id === mapped.id)) return prev
            return { ...prev, replies: [...prev.replies, mapped], replyCount: evt.commentReplyCount ?? prev.replyCount + 1 }
          })
          break
        case 'COMMENT_DELETED':
          if (evt.commentId === commentId) { setState('missing'); return }
          setRoot(prev => (prev ? { ...prev, replies: prev.replies.filter(r => r.id !== evt.commentId) } : prev))
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

  if (state === 'scanning') {
    return (
      <Screen>
        <Header back title="Thread" />
        <View style={{ padding: space.lg, gap: space.md2 }}>
          <Skeleton height={110} radius={t.radius.md} />
          {Array.from({ length: 3 }, (_, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: space.sm2 }}>
              <Skeleton circle width={32} height={32} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="44%" height={11} />
                <Skeleton width="86%" height={11} />
              </View>
            </View>
          ))}
        </View>
        {scanned > 2 ? <Spinner label={`Finding comment… (page ${scanned} of ${MAX_PAGES})`} /> : null}
      </Screen>
    )
  }

  if (state === 'error') {
    return (
      <Screen>
        <Header back title="Thread" />
        <ErrorPanel error={error} onRetry={() => void scan()} />
      </Screen>
    )
  }

  if (state === 'missing' || !root) {
    return (
      <Screen>
        <Header back title="Thread" />
        <GoneState
          title="This comment is no longer available."
          body="It may have been deleted, or hidden by the researcher."
          actionLabel="See all comments"
          onAction={() => router.replace(to(`/research/${id}/comments`))}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header back title="Thread" />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <FlashList
          data={root.replies}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            <Touchable
              onPress={() => router.replace(to(`/research/${id}/comments`))}
              feedback="tint"
              noAutoHitSlop
              style={styles.allRow}
            >
              <Icon name="comment" size={17} color={c.textSecondary} />
              <Text variant="subhead" align="ui" style={styles.flex}>View all comments</Text>
              <Icon name="forward" size={16} color={c.textFaint} />
            </Touchable>
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />

        <CommentComposer
          researchId={id}
          parentId={commentId}
          replyToHandle={root._author.handle}
          lockedReply
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
          /* Same published-only rule as the comments screen — replying to a
             non-published paper answers 400 NOT_PUBLISHED. */
          disabled={detail ? (!detail.commentsEnabled || detail.status !== 'PUBLISHED') : false}
          disabledReason={
            detail && detail.status !== 'PUBLISHED'
              ? 'Comments open once this paper is published.'
              : 'Comments are turned off for this paper.'
          }
          onSent={comment => {
            setRoot(prev => (prev ? { ...prev, replies: [...prev.replies, comment], replyCount: prev.replyCount + 1 } : prev))
            toast.ok('Reply posted')
          }}
        />
      </KeyboardAvoidingView>

      {/* One menu for the anchor and its replies. Deleting the anchor takes
          the whole screen with it — there is nothing left to thread. */}
      <ResearchCommentMenu
        visible={menu.visible}
        onClose={menu.close}
        comment={menu.payload}
        researchId={id}
        viewerId={user?.id}
        isResearchOwner={isOwner}
        onPatch={patchRow}
        onDeleted={dropRow}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  rootCard: { margin: space.lg, paddingVertical: space.xs },
  repliesLabel: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  sep: { marginHorizontal: space.lg },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 44, marginTop: space.sm },
  flex: { flex: 1 },
})
