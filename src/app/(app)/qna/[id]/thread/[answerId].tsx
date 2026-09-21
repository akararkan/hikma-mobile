/* =========================================================
   One answer and its full reply list.

   The deep-link target for ANSWER_REPLIED notifications and
   ANSWER search hits. There is no GET-one-answer endpoint, so
   the root is hydrated by paging the answers list until the id
   turns up — bounded, because an answer that has been deleted
   would otherwise page forever.

   Replies are blocked ONLY by lock and closed status. The
   answer cap must never close this composer: a reanswer does
   not count toward answerCount or maxAnswers.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Chip, ConfirmSheet, DisclosureIcon, Header, ListFooter,
  RoleBadge, Screen, Spinner, Text, Touchable, VerifiedMark, useSheetState, toast,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { AnswerComposerBar } from '@/components/qna/AnswerComposerBar'
import { AttachmentsBlock, InlineMedia, LinkChips, SourcesBlock } from '@/components/qna/AnswerMedia'
import { AcceptButton, LikeButton } from '@/components/qna/buttons'
import { useQnaEvent } from '@/components/qna/events'
import { canManageAnswer, canManageQuestion, composerGate } from '@/components/qna/gate'
import { MediaLightbox, openExternal, type LightboxItem } from '@/components/qna/MediaLightbox'
import {
  ConnectionDot, QnaEmptyState, QnaErrorView, QnaSkeletons,
} from '@/components/qna/QnaState'
import { ReanswerRow } from '@/components/qna/ReanswerRow'
import { ReportSheet } from '@/components/qna/ReportSheet'
import { qnaHref } from '@/components/qna/routes'
import { VoiceNotePlayer } from '@/components/qna/VoiceNotePlayer'
import type { AnswerView, QuestionView } from '@/components/qna/types'
import { useAnswerActions } from '@/components/qna/useAnswerActions'
import { useQuestionRealtime } from '@/components/qna/useQuestionRealtime'

const REPLY_PAGE = 50
const MAX_HYDRATE_PAGES = 5

type Row =
  | { key: string; kind: 'repliesHeader' }
  | { key: string; kind: 'reply'; reply: AnswerView }
  | { key: string; kind: 'empty' }

/* FlashList recycles by item type: without getItemType the header, the empty
   state and every ReanswerRow share one pool, so scrolling past the header
   hands its React key to a reply row and React unmounts the whole subtree
   instead of swapping props. keyExtractor is pure data — module scope both. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function AnswerThreadScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  const { id, answerId } = useLocalSearchParams<{ id: string; answerId: string }>()

  const listRef = React.useRef<FlashListRef<Row>>(null)
  const [lightbox, setLightbox] = React.useState<LightboxItem | null>(null)
  const [pulseId, setPulseId] = React.useState<string | null>(null)

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })
  const q = question.data

  /* ---- the root answer ---- */
  const [root, setRoot] = React.useState<AnswerView | null>(null)
  const [rootMissing, setRootMissing] = React.useState(false)
  const [rootLoading, setRootLoading] = React.useState(true)

  const hydrateRoot = React.useCallback(async () => {
    if (!id || !answerId) return
    setRootLoading(true)
    setRootMissing(false)
    try {
      for (let page = 0; page < MAX_HYDRATE_PAGES; page++) {
        const rows = await qna.answers(id, { page, size: 20 })
        const hit = rows.find(a => a.id === answerId)
        if (hit) { setRoot(hit); return }
        if (rows.length < 20) break
      }
      setRootMissing(true)
    } catch (e: any) {
      toast.error(errorText(e))
      setRootMissing(true)
    } finally {
      setRootLoading(false)
    }
  }, [id, answerId])

  React.useEffect(() => { void hydrateRoot() }, [hydrateRoot])

  /* ---- replies ---- */
  const [replies, setReplies] = React.useState<Record<string, AnswerView[]>>({})
  const [page, setPage] = React.useState(0)
  const [done, setDone] = React.useState(false)
  const [loadingReplies, setLoadingReplies] = React.useState(true)
  const [repliesError, setRepliesError] = React.useState<any>(null)
  const rows = replies[answerId] ?? []

  const loadReplies = React.useCallback(async (reset: boolean) => {
    if (!id || !answerId) return
    const next = reset ? 0 : page
    setLoadingReplies(true)
    setRepliesError(null)
    try {
      const batch = await qna.reanswers(id, answerId, { page: next, size: REPLY_PAGE })
      setReplies(p => {
        const prev = reset ? [] : (p[answerId] ?? [])
        const seen = new Set(prev.map(r => r.id))
        return { ...p, [answerId]: [...prev, ...batch.filter(r => !seen.has(r.id))] }
      })
      setPage(next + 1)
      setDone(batch.length < REPLY_PAGE)
    } catch (e: any) {
      setRepliesError(e)
    } finally {
      setLoadingReplies(false)
    }
  }, [id, answerId, page])

  React.useEffect(() => { void loadReplies(true) }, [id, answerId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- realtime: the same channel, filtered to this thread ---- */
  const expandedRef = React.useRef(new Set<string>([answerId]))
  /* The updater runs against a ref rather than inside setRoot: a state
     reducer must stay pure, and this one has to decide whether the row
     disappeared — which is a navigation-level effect, not a value. */
  const rootRef = React.useRef<AnswerView | null>(null)
  rootRef.current = root

  const connection = useQuestionRealtime(id, {
    setQuestion: question.setData,
    setAnswers: updater => {
      /* This page holds one top-level row. Run the shared event table's
         updater over a single-element array so it needs no special case. */
      const prev = rootRef.current
      if (!prev) return
      const list = typeof updater === 'function' ? updater([prev]) : updater
      const hit = list.find(a => a.id === answerId)
      if (!hit) { setRootMissing(true); return }
      setRoot(hit)
    },
    setReplies,
    expandedRoots: expandedRef,
    onQuestionDeleted: () => setRootMissing(true),
    onReconcile: () => { void question.refresh(); void hydrateRoot(); void loadReplies(true) },
  })

  /* ---- actions ---- */
  const patchAnswer = React.useCallback((rowId: string, parentAnswerId: string | null, fn: (a: AnswerView) => AnswerView) => {
    if (parentAnswerId) {
      setReplies(p => {
        const list = p[parentAnswerId]
        if (!list) return p
        return { ...p, [parentAnswerId]: list.map(r => (r.id === rowId ? fn(r) : r)) }
      })
      return
    }
    setRoot(prev => (prev && prev.id === rowId ? fn(prev) : prev))
  }, [])

  const removeAnswerLocal = React.useCallback((rowId: string, parentAnswerId: string | null) => {
    if (parentAnswerId) {
      setReplies(p => {
        const list = p[parentAnswerId]
        if (!list) return p
        return { ...p, [parentAnswerId]: list.filter(r => r.id !== rowId) }
      })
      return
    }
    /* Deleting the root tears the page down — there is nothing left to show. */
    if (rowId === answerId) router.replace(qnaHref.question(id))
  }, [answerId, id, router])

  const patchQuestion = React.useCallback((fn: (v: QuestionView) => QuestionView) => {
    question.setData(prev => (prev ? fn(prev) : prev))
  }, [question.setData]) // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useAnswerActions(id, { patchAnswer, removeAnswer: removeAnswerLocal, patchQuestion })

  useQnaEvent('answer:created', ({ questionId, answer }) => {
    if (questionId !== id || answer.parentAnswerId !== answerId) return
    setReplies(p => ({ ...p, [answerId]: [...(p[answerId] ?? []), answer] }))
    setRoot(prev => (prev ? { ...prev, replyCount: prev.replyCount + 1 } : prev))
  })

  useQnaEvent('answer:updated', ({ questionId, answer }) => {
    if (questionId !== id) return
    patchAnswer(answer.id, answer.parentAnswerId, prev => ({ ...answer, myReaction: prev.myReaction, _liked: prev._liked }))
  })

  /* ---- sheets ---- */
  const rowMenu = useSheetState<AnswerView>()
  const reportRow = useSheetState<AnswerView>()
  const confirmDelete = useSheetState<AnswerView>()
  const confirmBlock = useSheetState<AnswerView>()
  const [busy, setBusy] = React.useState(false)

  const replyGate = composerGate(q, user, 'REPLY', gate === 'allow')
  const canAcceptRoot = canManageQuestion(user, q) && !!root && actions.canAcceptRow(root)

  const handles = React.useMemo(() => {
    const m = new Map<string, string>()
    if (root) m.set(root._author.id, root._author.handle)
    for (const r of rows) m.set(r._author.id, r._author.handle)
    return m
  }, [root, rows])

  const doDelete = async () => {
    const a = confirmDelete.payload
    if (!a) return
    setBusy(true)
    const ok = await actions.removeAnswerRow(a)
    setBusy(false)
    if (ok) confirmDelete.close()
  }

  const doBlock = async () => {
    const a = confirmBlock.payload
    if (!a) return
    setBusy(true)
    try {
      await api.users.block(a.author)
      setReplies(p => ({ ...p, [answerId]: (p[answerId] ?? []).filter(r => r.author !== a.author) }))
      confirmBlock.close()
      toast.ok('Blocked')
    } catch (e: any) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  const scrollToReply = (targetUserId: string) => {
    const idx = rows.findIndex(r => r._author.id === targetUserId)
    if (idx < 0) return
    setPulseId(rows[idx].id)
    setTimeout(() => setPulseId(null), 1200)
    void listRef.current?.scrollToIndex({ index: idx + 1, animated: true, viewPosition: 0.2 })
  }

  /* ---- row plumbing ----
     FlashList's ViewHolder memo compares renderItem AND extraData BY
     IDENTITY, so a renderItem arrow or a freshly-built extraData object
     re-renders every mounted cell on every screen render — and this screen
     re-renders on every realtime frame. `actions` and the gate are rebuilt
     each render, so their stable members come out as scalars first. */
  const { toggleLike, likeCooldown } = actions
  const replyOpen = replyGate.open
  const replyCopy = replyGate.copy
  const jumpToReply = useEvent((targetUserId: string) => scrollToReply(targetUserId))

  const extraData = React.useMemo(
    () => ({ pulseId, cooldown: likeCooldown, root }),
    [pulseId, likeCooldown, root],
  )

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'repliesHeader') {
      return (
        <View style={[styles.sectionHeader, { borderBottomColor: c.separator, backgroundColor: c.bg }]}>
          <Text variant="subhead" weight="700" align="ui">Replies · {root?.replyCount || rows.length}</Text>
        </View>
      )
    }
    if (item.kind === 'empty') {
      return (
        <QnaEmptyState
          compact
          glyph="comment"
          title="No replies yet"
          body={replyOpen ? 'Start the discussion.' : replyCopy}
        />
      )
    }
    const r = item.reply
    return (
      <ReanswerRow
        reply={r}
        rootAuthorId={root?.author ?? ''}
        replyToHandle={r.replyToUserId ? handles.get(r.replyToUserId) ?? null : null}
        canManage={canManageAnswer(user, q, r.author)}
        canReply={replyOpen}
        likeCooldown={likeCooldown}
        variant="page"
        highlighted={pulseId === r.id}
        onLike={next => toggleLike(r, next)}
        onReply={() => router.push(qnaHref.compose(id, {
          /* parentAnswerId stays the ROOT so the local insert lands
             where the server will actually put it. */
          parentAnswerId: answerId,
          replyToAnswerId: r.id,
          replyToHandle: r._author.handle,
        }))}
        onOverflow={() => rowMenu.open(r)}
        onAuthorPress={() => router.push(qnaHref.user(r._author.id))}
        onOpenLink={openExternal}
        onReplyToPress={() => r.replyToUserId && jumpToReply(r.replyToUserId)}
      />
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    c, q, user, root, rows.length, handles, replyOpen, replyCopy,
    /* `rowMenu.open`, not `rowMenu`: useSheetState hands back a fresh object
       literal every render, and depending on it would move renderItem on
       every render — exactly what this useCallback exists to prevent. */
    toggleLike, likeCooldown, pulseId, rowMenu.open, router, id, answerId, jumpToReply,
  ])

  /* ---- render ---- */
  if (question.loading || rootLoading) {
    return (
      <Screen edges={['top']}>
        <Header back title="Answer" />
        <QnaSkeletons kind="answerCard" count={4} />
      </Screen>
    )
  }

  if (question.error || !q) {
    return (
      <Screen edges={['top']}>
        <Header back title="Answer" />
        <QnaErrorView error={question.error} onRetry={question.reload} onBack={() => router.replace(qnaHref.home())} />
      </Screen>
    )
  }

  if (rootMissing || !root) {
    return (
      <Screen edges={['top']}>
        <Header back title="Answer" />
        <QnaErrorView
          error={{ status: 404, code: 'ANSWER_NOT_FOUND' }}
          onBack={() => router.replace(qnaHref.question(id))}
          backLabel="Open the question"
        />
      </Screen>
    )
  }

  const data: Row[] = [
    { key: 'replies-header', kind: 'repliesHeader' },
    ...rows.map(r => ({ key: r.id, kind: 'reply' as const, reply: r })),
    ...(!rows.length && !loadingReplies ? [{ key: 'empty', kind: 'empty' as const }] : []),
  ]

  const a = root._author

  return (
    <Screen edges={['top']}>
      <Header
        back
        title="Answer"
        actions={[{ icon: 'more', onPress: () => rowMenu.open(root), label: 'Answer options' }]}
      />
      <View style={[styles.dotDock, { top: insets.top + 23, end: 52 }]} pointerEvents="none">
        <ConnectionDot state={connection} />
      </View>

      <FlashList
        ref={listRef}
        data={data}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        extraData={extraData}
        onEndReached={() => { if (!done && !loadingReplies) void loadReplies(false) }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={question.refreshing}
            onRefresh={() => { void question.refresh(); void hydrateRoot(); void loadReplies(true) }}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <Touchable
              onPress={() => router.push(qnaHref.question(id))}
              feedback="tint"
              noAutoHitSlop
              style={[styles.miniCard, { borderStartColor: c.accent, backgroundColor: c.surfaceSunken }]}
            >
              <View style={styles.flex}>
                <Text variant="micro" tone="faint" align="ui">On this question</Text>
                <Text variant="subhead" weight="600" numberOfLines={2} align="auto" style={{ marginTop: space.xxs }}>{q.title}</Text>
              </View>
              <DisclosureIcon />
            </Touchable>

            {root.accepted ? (
              <View style={[styles.acceptedStrip, { backgroundColor: c.successSoft }]}>
                <Text variant="caption" tone="success" align="ui">Accepted by the author</Text>
              </View>
            ) : null}

            <View style={[styles.rootBlock, { borderBottomColor: c.separator }]}>
              <View style={styles.authorRow}>
                <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={40} onPress={() => router.push(qnaHref.user(a.id))} />
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text variant="headline" numberOfLines={1} align="ui">{a.full}</Text>
                    {a.verified ? <VerifiedMark size={14} /> : null}
                    <RoleBadge role={a.role} />
                  </View>
                  <Text variant="footnote" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
                    @{a.handle} · {root.time}{root.edited ? ' · edited' : ''}
                  </Text>
                </View>
              </View>

              <Text variant="body" align="auto" style={{ marginTop: space.md, fontSize: 16 * t.fontScale, lineHeight: 24 * t.fontScale }}>
                {root.body}
              </Text>

              <InlineMedia
                answer={root}
                onPress={() => root.mediaUrl && root.mediaType && setLightbox({ url: root.mediaUrl, kind: root.mediaType })}
              />
              {root.voiceUrl ? (
                <View style={{ marginTop: space.md }}>
                  <VoiceNotePlayer url={root.voiceUrl} durationSeconds={root.voiceDurationSeconds} />
                </View>
              ) : null}
              <LinkChips links={root.links} onPress={openExternal} />
              <SourcesBlock sources={root.sources} expanded onPress={s => s.href && openExternal(s.href)} />
              <AttachmentsBlock
                attachments={root.attachments}
                onPress={att => {
                  if ((att.mediaType === 'IMAGE' || att.mediaType === 'VIDEO') && att.url) {
                    setLightbox({ url: att.url, kind: att.mediaType, caption: att.caption })
                  } else if (att.url) openExternal(att.url)
                }}
              />

              <View style={[styles.rootFooter, { borderTopColor: c.separator }]}>
                <LikeButton
                  liked={root._liked}
                  count={root.likes}
                  cooldown={actions.likeCooldown}
                  onToggle={next => actions.toggleLike(root, next)}
                />
                {replyGate.open ? (
                  <Touchable
                    onPress={() => router.push(qnaHref.compose(id, { parentAnswerId: answerId, replyToHandle: a.handle }))}
                    feedback="scale"
                    style={styles.action}
                    accessibilityLabel="Reply to this answer"
                  >
                    <Chip label="Reply" icon="reply" tone="neutral" size="sm" />
                  </Touchable>
                ) : null}
                <View style={styles.flex} />
                <AcceptButton
                  accepted={root.accepted}
                  visible={canAcceptRoot}
                  busy={actions.acceptBusyId === root.id}
                  onToggle={next => void actions.toggleAccept(root, next)}
                />
              </View>
            </View>
          </View>
        }
        ListFooterComponent={
          rows.length ? (
            <ListFooter
              loading={loadingReplies}
              error={repliesError}
              onRetry={() => void loadReplies(false)}
              done={done}
              doneLabel="That is every reply"
            />
          ) : loadingReplies ? <Spinner /> : null
        }
        renderItem={renderItem}
      />

      <AnswerComposerBar
        avatarUri={user?.profileImage}
        avatarName={user?.displayName}
        avatarSeed={user?.id}
        placeholder={`Reply to @${a.handle}…`}
        gate={replyGate}
        onPress={() => router.push(qnaHref.compose(id, { parentAnswerId: answerId, replyToHandle: a.handle }))}
        onAttachMedia={() => router.push(qnaHref.compose(id, { parentAnswerId: answerId, replyToHandle: a.handle, attach: 'media' }))}
        onAttachVoice={() => router.push(qnaHref.compose(id, { parentAnswerId: answerId, replyToHandle: a.handle, attach: 'voice' }))}
        onSignIn={() => router.push(qnaHref.signIn())}
      />

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        actions={[
          {
            label: 'Reply',
            icon: 'reply',
            hidden: !replyGate.open,
            onPress: () => {
              const row = rowMenu.payload
              if (!row) return
              /* parentAnswerId stays the ROOT so the local insert lands where
                 the server will actually put it. */
              router.push(qnaHref.compose(id, {
                parentAnswerId: answerId,
                replyToAnswerId: row.parentAnswerId ? row.id : undefined,
                replyToHandle: row._author.handle,
              }))
            },
          },
          /* Second entry, matching the question screen and every other
             comment surface. */
          {
            label: 'Copy text',
            icon: 'copy',
            onPress: async () => {
              if (!rowMenu.payload) return
              await Clipboard.setStringAsync(rowMenu.payload.body)
              toast.ok('Copied')
            },
          },
          {
            label: rowMenu.payload?.parentAnswerId ? 'Edit reply' : 'Edit answer',
            icon: 'edit',
            hidden: !canManageAnswer(user, q, rowMenu.payload?.author),
            onPress: () => rowMenu.payload && router.push(
              qnaHref.editAnswer(id, rowMenu.payload.id, rowMenu.payload.parentAnswerId),
            ),
          },
          {
            label: 'Manage sources',
            icon: 'cite',
            hidden: !canManageAnswer(user, q, rowMenu.payload?.author) || !!rowMenu.payload?.parentAnswerId,
            onPress: () => rowMenu.payload && router.push(qnaHref.sources(id, rowMenu.payload.id)),
          },
          {
            label: 'Manage files',
            icon: 'attachment',
            hidden: !canManageAnswer(user, q, rowMenu.payload?.author) || !!rowMenu.payload?.parentAnswerId,
            onPress: () => rowMenu.payload && router.push(qnaHref.files(id, rowMenu.payload.id)),
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            /* Hidden on your own content and while signed out. */
            hidden: !user || rowMenu.payload?.author === user.id,
            onPress: () => rowMenu.payload && reportRow.open(rowMenu.payload),
          },
          {
            label: 'Block this user',
            icon: 'block',
            destructive: true,
            hidden: rowMenu.payload?.author === user?.id,
            onPress: () => rowMenu.payload && confirmBlock.open(rowMenu.payload),
          },
          {
            label: rowMenu.payload?.parentAnswerId ? 'Delete reply' : 'Delete answer',
            icon: 'trash',
            destructive: true,
            hidden: !canManageAnswer(user, q, rowMenu.payload?.author),
            onPress: () => rowMenu.payload && confirmDelete.open(rowMenu.payload),
          },
        ]}
      />

      <ReportSheet
        visible={reportRow.visible}
        onClose={reportRow.close}
        targetType="ANSWER"
        targetId={reportRow.payload?.id ?? null}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title={confirmDelete.payload?.parentAnswerId ? 'Delete this reply?' : 'Delete this answer?'}
        message="Its reactions are purged and the counters adjust. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDelete}
      />

      <ConfirmSheet
        visible={confirmBlock.visible}
        onClose={confirmBlock.close}
        title={`Block ${confirmBlock.payload?._author.full ?? 'this person'}?`}
        message="You will not see their questions or answers, and they will not see yours."
        confirmLabel="Block"
        destructive
        loading={busy}
        onConfirm={doBlock}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dotDock: { position: 'absolute' },
  miniCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.md2, paddingVertical: space.sm2, minHeight: 64,
    borderStartWidth: 2,
  },
  acceptedStrip: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  rootBlock: { padding: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, flexWrap: 'wrap' },
  rootFooter: {
    flexDirection: 'row', alignItems: 'center', gap: space.xl,
    marginTop: space.md2, paddingTop: space.md, minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { flexDirection: 'row', alignItems: 'center' },
  sectionHeader: {
    paddingHorizontal: space.lg, height: 36, justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
