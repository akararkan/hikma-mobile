/* =========================================================
   One saved collection.

   A collection has no identity of its own on the server: it is
   just the name on a save row. So removing the last paper makes
   the collection itself vanish, and this screen pops back
   rather than sitting on a name that no longer resolves.

   Renaming merges into an existing name rather than failing —
   the helper line says so instead of the UI pretending to
   validate it.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Divider, EmptyState, Field, Header, ListFooter, Screen, Sheet,
  Text, toast, useSheetState,
} from '@/ui'
import { ResearchCard, ResearchCardListSkeleton, useResearchMenu } from '@/components/research/ResearchCard'
import { ErrorPanel, SignInPrompt } from '@/components/research/states'
import { toggleSaveRemote, useResearchList } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { ResearchCardData } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a
   fresh component TYPE each render — every visible divider would remount. */
const keyExtractor = (item: ResearchCardData) => String(item.id)
const Sep = () => <Divider style={styles.sep} />

export default function CollectionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const params = useLocalSearchParams<{ name: string }>()
  const name = decodeURIComponent(String(params.name || ''))
  const gate = useAuthGate()

  const menuSheet = useSheetState()
  const renameSheet = useSheetState()
  const [renameTo, setRenameTo] = React.useState(name)
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState(false)

  const list = useResearchList(
    ({ page, size }) => api.research.mySavedCollection(name, { page, size }),
    { enabled: gate === 'allow' && !!name, deps: [name] },
  )

  /* A blank param cannot address anything — the API would answer 400. */
  React.useEffect(() => {
    if (!name) router.replace(to('/research/saved'))
  }, [name, router])

  const remove = async (card: ResearchCardData) => {
    list.remove(card.id)
    try {
      await toggleSaveRemote(card.id, false)
      if (list.items.length <= 1) {
        toast.info('That was the last paper — the collection is gone.')
        router.replace(to('/research/saved'))
        return
      }
      toast.ok('Removed from saved', {
        label: 'Undo',
        onPress: async () => {
          try { await toggleSaveRemote(card.id, true, name); list.prepend(card) }
          catch (e: any) { toast.error(errorText(e)) }
        },
      })
    } catch (e: any) {
      list.prepend(card)
      toast.error(errorText(e))
    }
  }

  const cardMenu = useResearchMenu({
    onPatch: (id, patch) => list.patch(id, row => ({ ...row, ...patch })),
    extra: card => [{ label: 'Remove from saved', icon: 'trash', destructive: true, onPress: () => void remove(card) }],
  })

  const commitRename = async () => {
    const next = renameTo.trim()
    if (!next || next === name) { renameSheet.close(); return }
    setRenaming(true)
    setRenameError(null)
    try {
      await api.research.renameCollection(name, next)
      /* Re-read the canonical list before navigating: a rename onto an existing
         name merges the two, so the name we land on must be the server's. */
      const names: string[] = await api.research.savedCollections()
      const landing = names.find(n => n.toLowerCase() === next.toLowerCase()) || next
      renameSheet.close()
      router.replace(to(`/research/saved/${encodeURIComponent(landing)}`))
    } catch (e: any) {
      setRenameError(errorText(e))
    } finally {
      setRenaming(false)
    }
  }

  /* One item-first handler per action serves every row, so `renderItem` holds
     a single identity for the life of the screen. Above the gate return
     because hooks cannot be conditional. */
  const openMenu = useEvent((item: ResearchCardData) => cardMenu.open(item))
  const removeSaved = useEvent((item: ResearchCardData) => { void remove(item) })
  const renderItem = React.useCallback(({ item }: { item: ResearchCardData }) => (
    <ResearchCard
      item={item}
      savedNote={item.savedAt ? `Saved ${item.time}` : null}
      onLongPress={openMenu}
      onSaveToggle={removeSaved}
    />
  ), [openMenu, removeSaved])

  const listHeader = React.useMemo(() => (
    <Text variant="footnote" tone="muted" align="ui" style={styles.count}>
      {list.items.length}{list.done ? '' : '+'} paper{list.items.length === 1 ? '' : 's'}
    </Text>
  ), [list.items.length, list.done])

  if (gate !== 'allow') {
    return (
      <Screen>
        <Header back title="Collection" />
        <SignInPrompt message="Sign in to see your collections." />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        titleNode={
          <Text variant="title3" serif align="auto" numberOfLines={1}>{name}</Text>
        }
        actions={[{ icon: 'more', onPress: () => menuSheet.open(), label: 'Collection actions' }]}
      />

      <FlashList
        data={list.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          list.loading ? <ResearchCardListSkeleton />
            : list.error ? <ErrorPanel error={list.error} onRetry={list.reload} />
              : (
                <EmptyState
                  icon="library"
                  title="This collection is empty."
                  actionLabel="Browse research"
                  onAction={() => router.replace(to('/research'))}
                />
              )
        }
        ListFooterComponent={list.items.length ? <ListFooter loading={list.loadingMore} done={list.done} /> : null}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        /* Full research plates are 300pt+ — the platform default 250 prepares
           barely one cell ahead of the viewport. */
        drawDistance={500}
        refreshControl={
          <RefreshControl refreshing={list.refreshing} onRefresh={() => { void list.refresh() }} tintColor={c.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={menuSheet.visible}
        onClose={menuSheet.close}
        title={name}
        actions={[
          { label: 'Rename', icon: 'edit', onPress: () => { setRenameTo(name); renameSheet.open() } },
        ]}
      />

      <Sheet
        visible={renameSheet.visible}
        onClose={renameSheet.close}
        title="Rename collection"
        footer={<Button label="Save" block size="lg" loading={renaming} onPress={commitRename} />}
      >
        <View style={{ padding: space.lg }}>
          <Field
            value={renameTo}
            onChangeText={setRenameTo}
            maxLength={40}
            autoFocus
            error={renameError}
            hint="Renaming updates every paper saved in this collection. Renaming onto an existing name merges the two."
          />
        </View>
      </Sheet>

      {cardMenu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  count: { paddingHorizontal: space.lg, paddingTop: space.sm2, paddingBottom: space.xs },
  sep: { marginHorizontal: space.lg },
})
