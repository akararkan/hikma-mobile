/* =========================================================
   One saved collection.

   The route param is percent-encoded on the way in and decoded
   here — Arabic and Kurdish collection names are common and a
   raw name in a path segment breaks the URL, not just the
   lookup. A blank name is a 400 MISSING_COLLECTION_NAME, so it
   is caught before the call.

   When the last row is removed the screen swaps to an empty
   state instead of popping: popping mid-gesture is
   disorienting and steals the undo.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { avatarGradient } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Callout, Header, ListFooter, Screen, Text, toast, useSheetState,
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

export default function CollectionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()
  const params = useLocalSearchParams<{ collection: string }>()

  const [name, setName] = React.useState(() => safeDecode(params.collection))
  React.useEffect(() => { setName(safeDecode(params.collection)) }, [params.collection])

  const list = usePaged<QuestionView>(
    ({ page, pageSize, signal }) => qna.mySavedCollection(name, { page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, enabled: gate === 'allow' && !!name, deps: [name] },
  )

  const patch = React.useCallback((id: string, fn: (q: QuestionView) => QuestionView) => {
    list.patch(id, fn)
  }, [list.patch]) // eslint-disable-line react-hooks/exhaustive-deps

  const { cooldown, unsave, save } = useQuestionSave(patch)

  useQnaEvent('question:deleted', ({ id }) => list.remove(id))

  const overflow = useSheetState<QuestionView>()
  const move = useSheetState<QuestionView>()
  const rename = useSheetState()

  const removeRow = async (q: QuestionView) => {
    if (cooldown > 0) return
    list.remove(q.id)
    await unsave(q, { undo: false })
    toast.info('Removed from saved', {
      label: 'Undo',
      /* This screen knows its collection, so the undo puts the question back
         where it was rather than dropping it into Default. */
      onPress: () => { void save({ ...q, saved: false }, name).then(() => list.prepend({ ...q, saved: true })) },
    })
  }

  const [g0, g1] = avatarGradient(name)

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

  if (!name) {
    return (
      <Screen edges={['top']}>
        <Header back title="Collection" />
        <QnaErrorView
          error={{ status: 404, code: 'COLLECTION_NOT_FOUND' }}
          onBack={() => router.replace(qnaHref.saved())}
          backLabel="Browse saved"
        />
      </Screen>
    )
  }

  if (gate === 'loading' || list.loading) {
    return (
      <Screen edges={['top']}>
        <Header back title={name} />
        <QnaSkeletons kind="questionCard" count={4} />
      </Screen>
    )
  }

  if (gate === 'deny') {
    return (
      <Screen edges={['top']}>
        <Header back title={name} />
        <QnaEmptyState
          glyph="lock"
          title="Sign in to see your saved questions"
          actionLabel="Sign in"
          onAction={() => router.push(qnaHref.signIn())}
        />
      </Screen>
    )
  }

  if (list.error && !list.items.length) {
    return (
      <Screen edges={['top']}>
        <Header back title={name} />
        <QnaErrorView error={list.error} onRetry={list.reload} onBack={() => router.replace(qnaHref.saved())} backLabel="Browse saved" />
      </Screen>
    )
  }

  return (
    <Screen edges={['top']}>
      <Header
        back
        title={name}
        actions={[{ icon: 'more', onPress: () => rename.open(), label: 'Rename collection' }]}
      />

      <FlashList
        data={list.items}
        keyExtractor={keyExtractor}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <Text variant="title2" color={t.colors.overlayText} numberOfLines={1} align="auto">{name}</Text>
              <Text variant="footnote" color={t.colors.overlayTextMuted} align="ui" style={{ marginTop: space.xxs }}>
                {list.items.length} saved
              </Text>
            </LinearGradient>
            {list.error && list.items.length ? (
              <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
                <Callout tone="danger" actionLabel="Retry" onAction={() => void list.refresh()}>
                  {errorText(list.error)}
                </Callout>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <QnaEmptyState
            glyph="bookmark"
            title={`Nothing in ${name} yet`}
            body="Move a saved question here from its bookmark menu."
            actionLabel="Browse saved"
            onAction={() => router.replace(qnaHref.saved())}
          />
        }
        ListFooterComponent={
          list.items.length ? (
            <ListFooter
              loading={list.loadingMore}
              error={list.error && list.items.length ? list.error : null}
              onRetry={list.loadMore}
              done={list.done}
              doneLabel={`That is everything in ${name}`}
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
        current={name}
        onPick={target => {
          const q = move.payload
          if (!q) return
          void save(q, target)
          /* Re-filing moves it OUT of this collection, so the row goes. */
          if (target !== name) list.remove(q.id)
        }}
      />

      <RenameCollectionSheet
        visible={rename.visible}
        onClose={rename.close}
        name={name}
        onDone={next => {
          /* setParams keeps the header, the hero and every following page
             pointing at the new name without a remount. */
          setName(next)
          router.setParams({ collection: encodeURIComponent(next) })
        }}
      />
    </Screen>
  )
}

function safeDecode(v: string | undefined): string {
  if (!v) return ''
  try { return decodeURIComponent(v).trim() } catch { return String(v).trim() }
}

const styles = StyleSheet.create({
  hero: { height: 64, justifyContent: 'center', paddingHorizontal: space.lg },
})
