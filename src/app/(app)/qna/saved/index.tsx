/* =========================================================
   Saved questions.

   `savedAt` is populated ONLY by the saved-list endpoints, so
   the "Saved {relative}" line on the card is unique to this
   screen and its sibling — the feed's rows never carry it.

   Un-saving removes the row immediately and offers an undo
   that re-files it into the collection it came from. Without
   the collection, an undo would quietly move a question out of
   "Fiqh" and into "Default".
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { avatarGradient } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Callout, Header, Icon, ListFooter, ListRow, Screen, Sheet,
  Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { CollectionPickerSheet, RenameCollectionSheet } from '@/components/qna/CollectionPickerSheet'
import { useQnaEvent } from '@/components/qna/events'
import { QuestionCard } from '@/components/qna/QuestionCard'
import { QnaEmptyState, QnaErrorView, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { copyQuestionLink, sendQuestionToChat, shareQuestion } from '@/components/qna/share'
import type { QuestionView } from '@/components/qna/types'

/* Module scope — FlashList compares renderItem by identity and keyExtractor
   is pure data; neither belongs in a render body. */
const keyExtractor = (q: QuestionView) => q.id
import { useQuestionSave } from '@/components/qna/useQuestionSave'

export default function SavedQuestionsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()

  const saved = usePaged<QuestionView>(
    ({ page, pageSize, signal }) => qna.mySaved({ page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, enabled: gate === 'allow' },
  )

  const [collections, setCollections] = React.useState<string[]>([])
  const [collectionsLoading, setCollectionsLoading] = React.useState(true)
  /* A failed read used to land in the same empty array as a genuinely empty
     account, so a 500 rendered as "you have no collections" — the one answer
     that is certainly wrong. Keep the error and say it. */
  const [collectionsError, setCollectionsError] = React.useState<unknown>(null)

  const loadCollections = React.useCallback(() => {
    setCollectionsLoading(true)
    qna.savedCollections()
      .then(rows => { setCollections(Array.isArray(rows) ? rows : []); setCollectionsError(null) })
      .catch(e => { setCollections([]); setCollectionsError(e) })
      .finally(() => setCollectionsLoading(false))
  }, [])

  React.useEffect(() => { if (gate === 'allow') loadCollections() }, [gate, loadCollections])

  const patch = React.useCallback((id: string, fn: (q: QuestionView) => QuestionView) => {
    saved.patch(id, fn)
  }, [saved.patch]) // eslint-disable-line react-hooks/exhaustive-deps

  const { cooldown, unsave, save } = useQuestionSave(patch)

  useQnaEvent('question:deleted', ({ id }) => saved.remove(id))

  const overflow = useSheetState<QuestionView>()
  const manage = useSheetState()
  const move = useSheetState<QuestionView>()
  const rename = useSheetState<string>()

  const removeRow = async (q: QuestionView) => {
    if (cooldown > 0) return
    saved.remove(q.id)
    await unsave(q, { undo: false })
    loadCollections()
    /* QuestionView carries no collection name, so an undo from the "all"
       list re-files under Default. The per-collection screen knows its own
       name and passes it, which is where the distinction actually matters. */
    toast.info('Removed from saved', {
      label: 'Undo',
      onPress: () => {
        void save({ ...q, saved: false }).then(() => { saved.prepend({ ...q, saved: true }); loadCollections() })
      },
    })
  }

  /* One item-first handler per action, all identity-stable, so `renderItem`
     holds a single identity and QuestionCard's React.memo actually fires.
     Declared above the loading/error returns — hooks cannot be conditional. */
  const openQuestion = useEvent((q: QuestionView) => router.push(qnaHref.question(q.id)))
  const openAuthor = useEvent((q: QuestionView) => router.push(qnaHref.user(q.author)))
  const openTag = useEvent((tag: string) => router.push(qnaHref.tag(tag)))
  const removeSaved = useEvent((q: QuestionView) => { void removeRow(q) })
  const openMove = useEvent((q: QuestionView) => move.open(q))
  const openOverflow = useEvent((q: QuestionView) => overflow.open(q))
  const renderItem = React.useCallback(({ item }: { item: QuestionView }) => (
    <QuestionCard
      question={item}
      showSavedAt
      saveCooldown={cooldown}
      onPress={openQuestion}
      onAuthorPress={openAuthor}
      onTagPress={openTag}
      onToggleSave={removeSaved}
      onLongPressSave={openMove}
      onOverflow={openOverflow}
    />
  ), [cooldown, openQuestion, openAuthor, openTag, removeSaved, openMove, openOverflow])

  if (gate === 'loading') {
    return (
      <Screen edges={['top']}>
        <Header back title="Saved questions" />
        <ShelfSkeleton />
        <QnaSkeletons kind="questionCard" count={4} />
      </Screen>
    )
  }

  if (gate === 'deny') {
    return (
      <Screen edges={['top']}>
        <Header back title="Saved questions" />
        <QnaEmptyState
          glyph="lock"
          title="Sign in to see your saved questions"
          body="Bookmarks live with your account, so they follow you between devices."
          actionLabel="Sign in"
          onAction={() => router.push(qnaHref.signIn())}
        />
      </Screen>
    )
  }

  if (saved.loading) {
    return (
      <Screen edges={['top']}>
        <Header back title="Saved questions" />
        <ShelfSkeleton />
        <QnaSkeletons kind="questionCard" count={4} />
      </Screen>
    )
  }

  if (saved.error && !saved.items.length) {
    return (
      <Screen edges={['top']}>
        <Header back title="Saved questions" />
        <QnaErrorView error={saved.error} onRetry={saved.reload} onBack={() => router.replace(qnaHref.home())} backLabel="Browse Q&A" />
      </Screen>
    )
  }

  /* Below two names the shelf is noise: "All saved" plus one collection tells
     the user nothing they cannot see in the list. A failed read is NOT a
     reason to go quiet, though — the strip takes the shelf's place. */
  const showShelf = collections.length >= 2
  const shelfFailed = !collectionsLoading && !!collectionsError && !collections.length

  return (
    <Screen edges={['top']}>
      <Header
        back
        title="Saved questions"
        actions={[{ icon: 'more', onPress: () => manage.open(), label: 'Manage collections' }]}
      />

      <FlashList
        data={saved.items}
        keyExtractor={keyExtractor}
        onEndReached={saved.loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={saved.refreshing}
            onRefresh={() => { loadCollections(); void saved.refresh() }}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={
          <View>
            {saved.error && saved.items.length ? (
              <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
                <Callout tone="danger" actionLabel="Retry" onAction={() => void saved.refresh()}>
                  {errorText(saved.error)}
                </Callout>
              </View>
            ) : null}

            {shelfFailed ? (
              <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
                <Callout tone="warning" actionLabel="Retry" onAction={loadCollections}>
                  {errorText(collectionsError, 'Could not load your collections.')}
                </Callout>
              </View>
            ) : null}

            {showShelf ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.shelf}
                style={{ height: 96 }}
              >
                <ShelfCard
                  name="All saved"
                  glyph="bookmark"
                  onPress={() => {}}
                  active
                />
                {collections.map(name => (
                  <ShelfCard
                    key={name}
                    name={name}
                    onPress={() => router.push(qnaHref.collection(name))}
                    onLongPress={() => rename.open(name)}
                  />
                ))}
              </ScrollView>
            ) : null}

            <View style={[styles.sectionHeader, { borderBottomColor: c.separator, backgroundColor: c.bg }]}>
              <Text variant="subhead" weight="700" align="ui">All saved · {saved.items.length}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <QnaEmptyState
            glyph="bookmark"
            title="Nothing saved yet"
            body="Tap the bookmark on any question to keep it here."
            actionLabel="Browse Q&A"
            onAction={() => router.replace(qnaHref.home())}
          />
        }
        ListFooterComponent={
          saved.items.length ? (
            <ListFooter
              loading={saved.loadingMore}
              error={saved.error && saved.items.length ? saved.error : null}
              onRetry={saved.loadMore}
              done={saved.done}
              doneLabel="That is everything you saved"
            />
          ) : null
        }
        renderItem={renderItem}
      />

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title={overflow.payload?.title}
        actions={[
          { label: 'Open', icon: 'external', onPress: () => overflow.payload && router.push(qnaHref.question(overflow.payload.id)) },
          { label: 'Move to collection…', icon: 'library', onPress: () => overflow.payload && move.open(overflow.payload) },
          { label: 'Send in a message', icon: 'chat', onPress: () => { const q = overflow.payload; if (q) void sendQuestionToChat(router, q.id, q.title) } },
          { label: 'Share', icon: 'share', onPress: () => { const q = overflow.payload; if (q) void shareQuestion(q.id, q.title) } },
          { label: 'Copy link', icon: 'link', onPress: () => overflow.payload && void copyQuestionLink(overflow.payload.id) },
          {
            label: 'Remove from saved',
            icon: 'bookmark',
            destructive: true,
            onPress: () => overflow.payload && void removeRow(overflow.payload),
          },
        ]}
      />

      <CollectionPickerSheet
        visible={move.visible}
        onClose={move.close}
        onPick={name => {
          const q = move.payload
          if (!q) return
          /* Saving again with a different name re-files it — idempotent. */
          void save(q, name).then(loadCollections)
        }}
      />

      <Sheet visible={manage.visible} onClose={manage.close} title="Collections" subtitle="Long-press a name to rename it.">
        {collectionsLoading ? (
          <View style={{ padding: space.xl, gap: space.sm2 }}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={16} width="40%" />
          </View>
        ) : collections.length ? (
          collections.map(name => (
            <ListRow
              key={name}
              title={name}
              icon="bookmark"
              accessory={{ kind: 'chevron' }}
              onPress={() => { manage.close(); setTimeout(() => router.push(qnaHref.collection(name)), 90) }}
              onLongPress={() => { manage.close(); setTimeout(() => rename.open(name), 90) }}
            />
          ))
        ) : collectionsError ? (
          <View style={{ padding: space.xl }}>
            <Callout tone="danger" actionLabel="Retry" onAction={loadCollections}>
              {errorText(collectionsError, 'Could not load your collections.')}
            </Callout>
          </View>
        ) : (
          <View style={{ padding: space.xxl }}>
            <Text variant="callout" tone="muted" align="center">
              You have not filed anything into a named collection yet.
            </Text>
          </View>
        )}
      </Sheet>

      <RenameCollectionSheet
        visible={rename.visible}
        onClose={rename.close}
        name={rename.payload ?? ''}
        onDone={() => { loadCollections(); void saved.refresh() }}
      />
    </Screen>
  )
}

function ShelfCard({
  name, glyph, active, onPress, onLongPress,
}: { name: string; glyph?: 'bookmark'; active?: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme()
  const [g0, g1] = avatarGradient(name)
  return (
    <Touchable onPress={onPress} onLongPress={onLongPress} feedback="scale" noAutoHitSlop style={styles.shelfCard}>
      <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.shelfFill}>
        {glyph ? <Icon name={glyph} size={16} color={t.colors.overlayText} filled /> : null}
        <View style={styles.flex} />
        <Text variant="subhead" weight="700" color={t.colors.overlayText} numberOfLines={2} align="auto">{name}</Text>
        <Text variant="caption" color={t.colors.overlayTextMuted} align="ui">
          {active ? 'Everything you saved' : 'Tap to open'}
        </Text>
      </LinearGradient>
    </Touchable>
  )
}

function ShelfSkeleton() {
  return (
    <View style={[styles.shelf, { height: 96 }]}>
      {[0, 1, 2].map(i => <Skeleton key={i} width={132} height={88} radius={14} />)}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shelf: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.xs, alignItems: 'center' },
  shelfCard: { width: 132, height: 88, borderRadius: 14, overflow: 'hidden' },
  shelfFill: { flex: 1, padding: space.sm2 },
  sectionHeader: {
    paddingHorizontal: space.lg, height: 36, justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
