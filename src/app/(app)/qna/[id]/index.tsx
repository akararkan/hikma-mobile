/* =========================================================
   The question.

   Three things here are easy to get wrong and are therefore
   explicit:

   1. The composer gate reads `acceptsNewAnswers`. Reaching
      maxAnswers does not move the status, so a status-derived
      gate leaves a composer that accepts text and then 400s.
      Replies are gated on lock/closed ONLY — a reanswer never
      counts toward the cap.
   2. Accepted answers are rendered first by deriving a render
      order, never by sorting the paginated array: the list is
      keyset-free offset paging on createdAt ASC, and re-sorting
      the source array desynchronises the page counter.
   3. `question.answers` is trusted over `answers.length`.
      Answers whose authors the question author has restricted
      are hidden from other viewers, so the two legitimately
      disagree.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText, isNotFound } from '@/api'
import { isPlatformAdmin, useAuth, useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, ConfirmSheet, Header, ListFooter, Screen, Text, Touchable,
  useSheetState, toast,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { AnswerCard } from '@/components/qna/AnswerCard'
import { AnswerComposerBar } from '@/components/qna/AnswerComposerBar'
import { CollectionPickerSheet } from '@/components/qna/CollectionPickerSheet'
import { useQnaEvent } from '@/components/qna/events'
import { canManageAnswer, canManageQuestion, composerGate } from '@/components/qna/gate'
import { MediaLightbox, openExternal, type LightboxItem } from '@/components/qna/MediaLightbox'
import { QuestionHero } from '@/components/qna/QuestionHero'
import {
  ConnectionDot, GateBanner, QnaEmptyState, QnaErrorView, QnaSkeletons,
} from '@/components/qna/QnaState'
import { ReportSheet } from '@/components/qna/ReportSheet'
import { qnaHref } from '@/components/qna/routes'
import { sendQuestionToChat, useQuestionShare } from '@/components/qna/share'
import { toQuestion, type AnswerView, type QuestionView } from '@/components/qna/types'
import { useAnswerActions } from '@/components/qna/useAnswerActions'
import { useQuestionRealtime } from '@/components/qna/useQuestionRealtime'
import { useQuestionSave } from '@/components/qna/useQuestionSave'

const REPLY_PAGE = 50
const MAX_DEEPLINK_PAGES = 5

type Row =
  | { key: string; kind: 'answersHeader' }
  | { key: string; kind: 'acceptedHeader' }
  | { key: string; kind: 'answer'; answer: AnswerView }
  | { key: string; kind: 'empty' }

/* FlashList's recycle pools are keyed by item type (RenderStackManager holds
   `recycleKeyPools` per type and recycles a key when the type changes). With
   four row shapes and no getItemType they all share one pool, so scrolling
   past a group header hands its React key to an AnswerCard and React tears
   the whole subtree down — gestures, media, reply list — instead of swapping
   props. Both live at module scope; renderItem is compared by identity too. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function QuestionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const { user } = useAuth()
  const params = useLocalSearchParams<{ id: string; answer?: string; focus?: string }>()
  const id = params.id

  const listRef = React.useRef<FlashListRef<Row>>(null)
  const [scrolled, setScrolled] = React.useState(false)
  const [lightbox, setLightbox] = React.useState<LightboxItem | null>(null)
  const [deleted, setDeleted] = React.useState(false)
  const [pulseId, setPulseId] = React.useState<string | null>(null)
  const [newAnswers, setNewAnswers] = React.useState(0)

  /* An unhydrated path param produces 400 TYPE_MISMATCH with
     details.hint 'frontend_path_param_unhydrated' — a client bug, so guard
     rather than let it become a user-facing error. */
  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })
  const answers = usePaged<AnswerView>(
    ({ page, pageSize, signal }) => qna.answers(id, { page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, enabled: !!id, deps: [id] },
  )

  const q = question.data
  const share = useQuestionShare(id, q?.title)

  /* ---- replies (lazy, per thread root) ---- */
  const [replies, setReplies] = React.useState<Record<string, AnswerView[]>>({})
  const [replyPage, setReplyPage] = React.useState<Record<string, number>>({})
  const [replyDone, setReplyDone] = React.useState<Record<string, boolean>>({})
  const [replyLoading, setReplyLoading] = React.useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const expandedRef = React.useRef(expanded)
  expandedRef.current = expanded

  const loadReplies = React.useCallback(async (rootId: string, reset = false) => {
    if (!id) return
    const page = reset ? 0 : (replyPage[rootId] ?? 0)
    setReplyLoading(p => ({ ...p, [rootId]: true }))
    try {
      const rows = await qna.reanswers(id, rootId, { page, size: REPLY_PAGE })
      setReplies(p => {
        const prev = reset ? [] : (p[rootId] ?? [])
        const seen = new Set(prev.map(r => r.id))
        return { ...p, [rootId]: [...prev, ...rows.filter(r => !seen.has(r.id))] }
      })
      setReplyPage(p => ({ ...p, [rootId]: page + 1 }))
      setReplyDone(p => ({ ...p, [rootId]: rows.length < REPLY_PAGE }))
    } catch (e: any) {
      toast.error(errorText(e))
      setReplyDone(p => ({ ...p, [rootId]: true }))
    } finally {
      setReplyLoading(p => ({ ...p, [rootId]: false }))
    }
  }, [id, replyPage])

  const expandReplies = (rootId: string) => {
    setExpanded(prev => new Set(prev).add(rootId))
    if (!replies[rootId]) void loadReplies(rootId, true)
  }

  /* ---- realtime ---- */
  const connection = useQuestionRealtime(id, {
    setQuestion: question.setData,
    setAnswers: answers.setItems,
    setReplies,
    setShares: share.setShares,
    expandedRoots: expandedRef,
    onQuestionDeleted: () => setDeleted(true),
    onNewAnswer: () => setNewAnswers(n => n + 1),
    onReconcile: () => {
      void question.refresh()
      void answers.refresh()
      for (const rootId of expandedRef.current) void loadReplies(rootId, true)
    },
  })

  /* ---- actions ---- */
  const patchAnswer = React.useCallback((answerId: string, parentAnswerId: string | null, fn: (a: AnswerView) => AnswerView) => {
    if (parentAnswerId) {
      setReplies(p => {
        const list = p[parentAnswerId]
        if (!list) return p
        return { ...p, [parentAnswerId]: list.map(r => (r.id === answerId ? fn(r) : r)) }
      })
      return
    }
    answers.setItems(prev => prev.map(a => (a.id === answerId ? fn(a) : a)))
  }, [answers.setItems]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeAnswerLocal = React.useCallback((answerId: string, parentAnswerId: string | null) => {
    if (parentAnswerId) {
      setReplies(p => {
        const list = p[parentAnswerId]
        if (!list) return p
        return { ...p, [parentAnswerId]: list.filter(r => r.id !== answerId) }
      })
      return
    }
    answers.remove(answerId)
    setReplies(p => {
      if (!(answerId in p)) return p
      const { [answerId]: _gone, ...rest } = p
      return rest
    })
  }, [answers.remove]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchQuestion = React.useCallback((fn: (v: QuestionView) => QuestionView) => {
    question.setData(prev => (prev ? fn(prev) : prev))
  }, [question.setData]) // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useAnswerActions(id, { patchAnswer, removeAnswer: removeAnswerLocal, patchQuestion })
  const { cooldown: saveCooldown, toggle: toggleSave, save: saveInto } = useQuestionSave(
    (_id, fn) => patchQuestion(fn),
  )

  /* ---- the composer hands its result back; SSE never will ---- */
  useQnaEvent('answer:created', ({ questionId, answer }) => {
    if (questionId !== id) return
    if (answer.parentAnswerId) {
      const root = answer.parentAnswerId
      setReplies(p => (p[root] ? { ...p, [root]: [...p[root], answer] } : p))
      answers.setItems(prev => prev.map(a => (a.id === root ? { ...a, replyCount: a.replyCount + 1 } : a)))
      return
    }
    answers.setItems(prev => (prev.some(a => a.id === answer.id) ? prev : [...prev, answer]))
    patchQuestion(prev => {
      const count = prev.answers + 1
      return {
        ...prev,
        answers: count,
        status: prev.status === 'OPEN' ? 'ANSWERED' : prev.status,
        acceptsNewAnswers: prev.answersLocked ? false : prev.maxAnswers == null || count < prev.maxAnswers,
      }
    })
  })

  useQnaEvent('answer:updated', ({ questionId, answer }) => {
    if (questionId !== id) return
    patchAnswer(answer.id, answer.parentAnswerId, prev => ({ ...answer, myReaction: prev.myReaction, _liked: prev._liked }))
  })

  useQnaEvent('question:updated', updated => {
    if (updated.id !== id) return
    question.setData(prev => (prev ? { ...prev, ...updated, saved: prev.saved } : updated))
  })

  /* ---- ?focus=1 opens the composer straight away ---- */
  const focusDone = React.useRef(false)
  React.useEffect(() => {
    if (params.focus !== '1' || focusDone.current || !q) return
    focusDone.current = true
    if (composerGate(q, user, 'ANSWER', gate === 'allow').open) router.push(qnaHref.compose(id))
  }, [params.focus, q, user, gate, id, router])

  /* ---- sheets ---- */
  const headerMenu = useSheetState()
  const answerMenu = useSheetState<AnswerView>()
  const collections = useSheetState()
  const reportQuestion = useSheetState()
  const reportAnswer = useSheetState<AnswerView>()
  const confirmDeleteQuestion = useSheetState()
  const confirmDeleteAnswer = useSheetState<AnswerView>()
  const confirmBlock = useSheetState<AnswerView>()
  const [busy, setBusy] = React.useState(false)

  const isAuthor = !!q && q.author === user?.id
  const isAdmin = isPlatformAdmin(user)
  const canManage = canManageQuestion(user, q)
  const answerGate = composerGate(q, user, 'ANSWER', gate === 'allow')
  const replyGate = composerGate(q, user, 'REPLY', gate === 'allow')

  const toggleLock = async () => {
    if (!q) return
    try {
      const raw = q.answersLocked ? await qna.unlockAnswers(q.id) : await qna.lockAnswers(q.id)
      question.setData(toQuestion(raw))
      toast.ok(q.answersLocked ? 'Answers unlocked' : 'Answers locked')
    } catch (e: any) { toast.error(errorText(e)) }
  }

  const doDeleteQuestion = async () => {
    if (!q) return
    setBusy(true)
    try {
      await qna.remove(q.id)
      confirmDeleteQuestion.close()
      router.replace(qnaHref.home())
    } catch (e: any) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  const doDeleteAnswer = async () => {
    const a = confirmDeleteAnswer.payload
    if (!a) return
    setBusy(true)
    const ok = await actions.removeAnswerRow(a)
    setBusy(false)
    if (ok) confirmDeleteAnswer.close()
  }

  const doBlock = async () => {
    const a = confirmBlock.payload
    if (!a) return
    setBusy(true)
    try {
      await api.users.block(a.author)
      answers.setItems(prev => prev.filter(x => x.author !== a.author))
      setReplies(p => {
        const out: Record<string, AnswerView[]> = {}
        for (const k of Object.keys(p)) out[k] = p[k].filter(r => r.author !== a.author)
        return out
      })
      confirmBlock.close()
      toast.ok('Blocked')
    } catch (e: any) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  /* ---- render rows ---- */
  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    /* usePaged's dedupe only covers rows IT loaded. An answer inserted via
       setItems (SSE, composer hand-back) is legitimately re-delivered by a
       later page, and a duplicate key is a hard crash in FlashList. */
    const seen = new Set<string>()
    const uniq = answers.items.filter(a => !seen.has(a.id) && (seen.add(a.id), true))
    const accepted = uniq.filter(a => a.accepted)
    const rest = uniq.filter(a => !a.accepted)
    out.push({ key: 'answers-header', kind: 'answersHeader' })
    if (accepted.length) {
      out.push({ key: 'accepted-header', kind: 'acceptedHeader' })
      for (const a of accepted) out.push({ key: a.id, kind: 'answer', answer: a })
    }
    for (const a of rest) out.push({ key: a.id, kind: 'answer', answer: a })
    if (!answers.items.length && !answers.loading) out.push({ key: 'empty', kind: 'empty' })
    return out
  }, [answers.items, answers.loading])

  /* ---- deep link to one answer ----
     The index has to come from the RENDER order, not from `answers.items`:
     accepted answers are hoisted into their own group, so the two disagree
     the moment anything is accepted. */
  const deepLinkDone = React.useRef(false)
  const deepLinkPages = React.useRef(0)
  React.useEffect(() => {
    const target = params.answer
    if (!target || deepLinkDone.current || answers.loading) return
    const idx = rows.findIndex(r => r.kind === 'answer' && r.answer.id === target)
    if (idx >= 0) {
      deepLinkDone.current = true
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 }), 260)
      setPulseId(target)
      setTimeout(() => setPulseId(null), 1200)
      return
    }
    /* Not on this page. Keep paging a bounded number of times, then give up
       silently — the id may belong to a reanswer, which never appears here. */
    if (answers.done || deepLinkPages.current >= MAX_DEEPLINK_PAGES) { deepLinkDone.current = true; return }
    deepLinkPages.current += 1
    answers.loadMore()
  }, [params.answer, rows, answers.loading, answers.done]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- row plumbing ----
     FlashList's ViewHolder memo compares renderItem AND extraData by
     identity (ViewHolder.js: children are memoized on
     [item, extraData, target, renderItem]). A renderItem arrow or a freshly
     built extraData object therefore re-renders EVERY mounted cell on every
     screen render — and this screen re-renders on every realtime frame. Both
     are memoized here, over scalars: `actions` and the gates are rebuilt each
     render, so their stable members are destructured out first. */
  const { toggleLike, toggleAccept, canAcceptRow, likeCooldown } = actions
  const answerOpen = answerGate.open
  const answerCopy = answerGate.copy
  const replyOpen = replyGate.open
  const expand = useEvent((rootId: string) => expandReplies(rootId))
  const fetchMoreReplies = useEvent((rootId: string) => { void loadReplies(rootId) })

  const extraData = React.useMemo(
    () => ({ pulseId, expanded, replies, replyLoading, replyDone, cooldown: likeCooldown }),
    [pulseId, expanded, replies, replyLoading, replyDone, likeCooldown],
  )

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'answersHeader') {
      return (
        <View style={[styles.sectionHeader, { borderBottomColor: c.separator, backgroundColor: c.bg }]}>
          <Text variant="subhead" weight="700" align="ui" style={styles.flex}>Answers · {q?.answers ?? 0}</Text>
          <Text variant="footnote" tone="muted" align="ui">Oldest first</Text>
        </View>
      )
    }
    if (item.kind === 'acceptedHeader') {
      return (
        <View style={styles.groupHeader}>
          <Text variant="caption" tone="success" align="ui">Accepted by the author</Text>
        </View>
      )
    }
    if (item.kind === 'empty') {
      return (
        <QnaEmptyState
          compact
          glyph="comment"
          title="No answers yet"
          body={answerOpen ? 'Be the first to answer.' : answerCopy}
          actionLabel={answerOpen ? 'Write an answer' : undefined}
          onAction={() => router.push(qnaHref.compose(id))}
        />
      )
    }

    const a = item.answer
    return (
      <AnswerCard
        answer={a}
        canManage={canManageAnswer(user, q, a.author)}
        canAccept={canManage && canAcceptRow(a)}
        canReply={replyOpen}
        expandedReplies={expanded.has(a.id)}
        replies={replies[a.id] ?? []}
        repliesLoading={!!replyLoading[a.id]}
        repliesDone={!!replyDone[a.id]}
        likeCooldown={likeCooldown}
        highlighted={pulseId === a.id}
        highlightedReplyId={pulseId}
        canManageReply={r => canManageAnswer(user, q, r.author)}
        onLike={next => toggleLike(a, next)}
        onAccept={next => void toggleAccept(a, next)}
        onReply={() => router.push(qnaHref.compose(id, { parentAnswerId: a.id, replyToHandle: a._author.handle }))}
        onOverflow={() => answerMenu.open(a)}
        onExpandReplies={() => expand(a.id)}
        onLoadMoreReplies={() => fetchMoreReplies(a.id)}
        onAuthorPress={userId => router.push(qnaHref.user(userId))}
        onOpenLink={openExternal}
        onMediaPress={() => a.mediaUrl && a.mediaType && setLightbox({ url: a.mediaUrl, kind: a.mediaType })}
        onSourcePress={s => s.href && openExternal(s.href)}
        onAttachmentPress={att => {
          if ((att.mediaType === 'IMAGE' || att.mediaType === 'VIDEO') && att.url) {
            setLightbox({ url: att.url, kind: att.mediaType, caption: att.caption })
          } else if (att.url) openExternal(att.url)
        }}
        onReplyLike={(r, next) => toggleLike(r, next)}
        onReplyTo={r => router.push(qnaHref.compose(id, {
          /* parentAnswerId stays the THREAD ROOT: the server hoists a
             reply-to-a-reply to a sibling anyway and records the real
             target in replyToAnswerId. */
          parentAnswerId: a.id,
          replyToAnswerId: r.id,
          replyToHandle: r._author.handle,
        }))}
        onReplyOverflow={r => answerMenu.open(r)}
      />
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    c, q, id, router, user, canManage, answerOpen, answerCopy, replyOpen,
    toggleLike, toggleAccept, canAcceptRow, likeCooldown,
    expanded, replies, replyLoading, replyDone, pulseId,
    /* `answerMenu.open`, not `answerMenu`: useSheetState returns a fresh
       object literal every render, and depending on it would move renderItem
       on every render — the exact thing this useCallback exists to stop. */
    answerMenu.open, setLightbox, expand, fetchMoreReplies,
  ])

  /* The header is a ViewHolder too, and it is the heaviest thing on the
     screen — hero plate, avatar, tags, metric row. A freshly-built element
     re-renders all of it on every realtime frame, so it is memoized over the
     values it actually reads. */
  const listHeader = React.useMemo(() => (q ? (
    <View>
      <QuestionHero
        question={q}
        isAuthor={isAuthor}
        isAdmin={isAdmin}
        shares={share.shares}
        saveCooldown={saveCooldown}
        canAnswer={answerOpen}
        onSave={() => toggleSave(q, { undo: true })}
        onLongPressSave={collections.open}
        onShare={share.shareNow}
        onAnswer={() => router.push(qnaHref.compose(id))}
        onMore={headerMenu.open}
        onEdit={() => router.push(qnaHref.edit(id))}
        onManage={() => router.push(qnaHref.manage(id))}
        onAuthorPress={() => router.push(qnaHref.user(q.author))}
        onTagPress={tag => router.push(qnaHref.tag(tag))}
        onMentionPress={handle => router.push(qnaHref.userByHandle(handle))}
      />
      {!answerOpen && answerGate.reason ? (
        <GateBanner reason={answerGate.reason} copy={answerCopy} maxAnswers={q.maxAnswers} />
      ) : null}
      {answers.error && !answers.items.length ? (
        <QnaErrorView error={answers.error} variant="inline" onRetry={answers.reload} />
      ) : null}
    </View>
  ) : null), [
    q, isAuthor, isAdmin, share.shares, share.shareNow, saveCooldown, answerOpen, answerCopy,
    answerGate.reason, toggleSave, collections.open, headerMenu.open, router, id,
    answers.error, answers.items.length, answers.reload,
  ])

  /* Two states, sixty frames a second: the ref guard keeps the setState to
     the two moments the boolean actually flips. */
  const scrolledRef = React.useRef(false)
  const onScroll = useEvent((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > 60
    if (next === scrolledRef.current) return
    scrolledRef.current = next
    setScrolled(next)
  })

  if (deleted) {
    return (
      <Screen edges={['top']}>
        <Header back title="Question" />
        <QnaErrorView
          error={{ status: 404, code: 'QUESTION_NOT_FOUND' }}
          onBack={() => router.replace(qnaHref.home())}
        />
      </Screen>
    )
  }

  if (question.loading) {
    return (
      <Screen edges={['top']}>
        <Header back title="Question" />
        <QnaSkeletons kind="hero" count={3} />
      </Screen>
    )
  }

  if (question.error || !q) {
    return (
      <Screen edges={['top']}>
        <Header back title="Question" />
        <QnaErrorView
          error={question.error ?? { status: 404, code: 'QUESTION_NOT_FOUND' }}
          onRetry={isNotFound(question.error) ? undefined : question.reload}
          onBack={() => router.replace(qnaHref.home())}
        />
      </Screen>
    )
  }


  return (
    <Screen edges={['top']}>
      <Header
        back
        title={scrolled ? q.title : undefined}
        border={scrolled}
        actions={[
          { icon: 'share', onPress: share.shareNow, label: 'Share question' },
          { icon: 'more', onPress: headerMenu.open, label: 'More options' },
        ]}
      />
      {/* The dot rides the header's trailing edge: it is status, not an
          action, so it must not be a tappable slot. */}
      <View style={[styles.dotDock, { top: insets.top + 23, end: 92 }]} pointerEvents="none">
        <ConnectionDot state={connection} />
      </View>

      <FlashList
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        extraData={extraData}
        /* AnswerCard is the tallest cell in QnA (body + media + vote rail +
           inline replies) — the platform's 250 default is under ONE cell, so a
           fling showed blanks the question list (500) never does. */
        drawDistance={600}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={answers.loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={question.refreshing || answers.refreshing}
            onRefresh={() => {
              /* Collapse threads we can no longer verify; the reply pages are
                 refetched only for the ones still open. */
              setExpanded(new Set())
              setReplies({})
              setReplyPage({})
              setReplyDone({})
              void question.refresh()
              void answers.refresh()
            }}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={listHeader}
        ListFooterComponent={
          answers.items.length ? (
            <ListFooter
              loading={answers.loadingMore}
              error={answers.error && answers.items.length ? answers.error : null}
              onRetry={answers.loadMore}
              done={answers.done}
              doneLabel="That is every answer"
            />
          ) : null
        }
        renderItem={renderItem}
      />

      {newAnswers > 0 ? (
        <Touchable
          onPress={() => { setNewAnswers(0); listRef.current?.scrollToEnd({ animated: true }) }}
          feedback="scale"
          haptic="light"
          /* No shadow — QELAT separates with a drawn rule, never a drop
             shadow (DESIGN.md §8.2). */
          style={[styles.newPill, { top: 8, backgroundColor: c.accent, borderColor: c.accentPressed, borderWidth: 1 }]}
        >
          <Text variant="footnote" weight="600" color={c.textOnAccent}>
            {newAnswers} new {newAnswers === 1 ? 'answer' : 'answers'}
          </Text>
        </Touchable>
      ) : null}

      <AnswerComposerBar
        avatarUri={user?.profileImage}
        avatarName={user?.displayName}
        avatarSeed={user?.id}
        placeholder="Write an answer…"
        gate={answerGate}
        onPress={() => router.push(qnaHref.compose(id))}
        onAttachMedia={() => router.push(qnaHref.compose(id, { attach: 'media' }))}
        onAttachVoice={() => router.push(qnaHref.compose(id, { attach: 'voice' }))}
        onSignIn={() => router.push(qnaHref.signIn())}
      />

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />

      <ActionSheet
        visible={headerMenu.visible}
        onClose={headerMenu.close}
        actions={[
          { label: 'Edit question', icon: 'edit', hidden: !canManage, onPress: () => router.push(qnaHref.edit(id)) },
          { label: 'Answer settings', icon: 'settings', hidden: !canManage, onPress: () => router.push(qnaHref.manage(id)) },
          {
            label: q.answersLocked ? 'Unlock answers' : 'Lock answers',
            icon: q.answersLocked ? 'unlock' : 'lock',
            hidden: !canManage,
            onPress: () => void toggleLock(),
          },
          { label: 'Copy link', icon: 'link', onPress: () => void share.copyLink() },
          { label: 'Send in a message', icon: 'chat', onPress: () => void sendQuestionToChat(router, id, q.title) },
          { label: 'Share', icon: 'share', onPress: () => void share.shareNow() },
          {
            label: 'Share to story',
            icon: 'add',
            /* A question has no media of its own, so the frame is the card the
               composer draws from the title — LinkCard falls back to the link
               glyph when there is no thumb. */
            onPress: () => {
              headerMenu.close()
              setTimeout(() => router.push({
                pathname: '/story/compose',
                params: { linkType: 'LINKED_QNA', mediaUrl: '', thumbnailUrl: '', title: q.title || 'A question' },
              } as any), 90)
            },
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            /* Hidden on your own question and while signed out — an action the
               server would refuse is absent, not disabled. */
            hidden: !user || q.author === user.id,
            onPress: reportQuestion.open,
          },
          {
            label: 'Delete question',
            icon: 'trash',
            destructive: true,
            hidden: !canManage,
            onPress: confirmDeleteQuestion.open,
          },
        ]}
      />

      <ActionSheet
        visible={answerMenu.visible}
        onClose={answerMenu.close}
        actions={[
          {
            label: 'Reply',
            icon: 'reply',
            hidden: !replyGate.open,
            onPress: () => {
              const a = answerMenu.payload
              if (!a) return
              /* parentAnswerId stays the THREAD ROOT — the server hoists a
                 reply-to-a-reply to a sibling anyway. */
              router.push(qnaHref.compose(id, {
                parentAnswerId: a.parentAnswerId ?? a.id,
                replyToAnswerId: a.parentAnswerId ? a.id : undefined,
                replyToHandle: a._author.handle,
              }))
            },
          },
          /* Second entry on every menu in the app — post, reel, research and
             here — so the always-available action sits in one place. */
          {
            label: 'Copy text',
            icon: 'copy',
            onPress: async () => {
              if (!answerMenu.payload) return
              await Clipboard.setStringAsync(answerMenu.payload.body)
              toast.ok('Copied')
            },
          },
          {
            label: answerMenu.payload?.parentAnswerId ? 'Edit reply' : 'Edit answer',
            icon: 'edit',
            hidden: !canManageAnswer(user, q, answerMenu.payload?.author),
            onPress: () => answerMenu.payload && router.push(
              qnaHref.editAnswer(id, answerMenu.payload.id, answerMenu.payload.parentAnswerId),
            ),
          },
          {
            label: 'Manage sources',
            icon: 'cite',
            hidden: !canManageAnswer(user, q, answerMenu.payload?.author) || !!answerMenu.payload?.parentAnswerId,
            onPress: () => answerMenu.payload && router.push(qnaHref.sources(id, answerMenu.payload.id)),
          },
          {
            label: 'Manage files',
            icon: 'attachment',
            hidden: !canManageAnswer(user, q, answerMenu.payload?.author) || !!answerMenu.payload?.parentAnswerId,
            onPress: () => answerMenu.payload && router.push(qnaHref.files(id, answerMenu.payload.id)),
          },
          {
            label: 'Open thread',
            icon: 'comment',
            hidden: !!answerMenu.payload?.parentAnswerId,
            onPress: () => answerMenu.payload && router.push(qnaHref.thread(id, answerMenu.payload.id)),
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            hidden: !user || answerMenu.payload?.author === user.id,
            onPress: () => answerMenu.payload && reportAnswer.open(answerMenu.payload),
          },
          {
            label: 'Block this user',
            icon: 'block',
            destructive: true,
            hidden: answerMenu.payload?.author === user?.id,
            onPress: () => answerMenu.payload && confirmBlock.open(answerMenu.payload),
          },
          {
            label: answerMenu.payload?.parentAnswerId ? 'Delete reply' : 'Delete answer',
            icon: 'trash',
            destructive: true,
            hidden: !canManageAnswer(user, q, answerMenu.payload?.author),
            onPress: () => answerMenu.payload && confirmDeleteAnswer.open(answerMenu.payload),
          },
        ]}
      />

      <CollectionPickerSheet
        visible={collections.visible}
        onClose={collections.close}
        onPick={name => void saveInto(q, name)}
      />

      <ReportSheet visible={reportQuestion.visible} onClose={reportQuestion.close} targetType="QUESTION" targetId={id} />
      <ReportSheet
        visible={reportAnswer.visible}
        onClose={reportAnswer.close}
        targetType="ANSWER"
        targetId={reportAnswer.payload?.id ?? null}
      />

      <ConfirmSheet
        visible={confirmDeleteQuestion.visible}
        onClose={confirmDeleteQuestion.close}
        title="Delete this question?"
        message="Every answer, reply, reaction, file and bookmark on it is deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDeleteQuestion}
      />

      <ConfirmSheet
        visible={confirmDeleteAnswer.visible}
        onClose={confirmDeleteAnswer.close}
        title={confirmDeleteAnswer.payload?.parentAnswerId ? 'Delete this reply?' : 'Delete this answer?'}
        message="Its reactions are purged and the counters adjust. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDeleteAnswer}
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
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupHeader: { paddingHorizontal: space.lg, paddingTop: space.md2, height: 28, justifyContent: 'flex-end' },
  /* "N new answers" — a text-bearing plate, so it takes the chip setback.
     Pills are only unread counters and LIVE badges (DESIGN.md §8.9). */
  newPill: {
    position: 'absolute', alignSelf: 'center',
    paddingHorizontal: space.md2, height: 32, ...setback(shape.chip), borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
})
