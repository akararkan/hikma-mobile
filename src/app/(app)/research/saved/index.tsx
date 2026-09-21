/* =========================================================
   Saved papers.

   The collection rail is decoration over the same list: it can
   fail on its own without taking the papers with it, so a
   failed savedCollections() simply hides the rail.

   Removing is optimistic with a five-second undo, because the
   undo has to re-save into the SAME collection and that name is
   only known while the row is still in memory.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Chip, ChipRail, Divider, EmptyState, Header, ListFooter, Screen, Skeleton, toast,
} from '@/ui'
import { ResearchCard, ResearchCardListSkeleton, useResearchMenu } from '@/components/research/ResearchCard'
import { ErrorPanel, SignInPrompt, useTransientRetry } from '@/components/research/states'
import { toggleSaveRemote, useResearchList } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { ResearchCardData } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares both of these by identity, and
   an inline separator arrow is a fresh component TYPE every render — every
   visible divider would remount instead of reconciling. */
const keyExtractor = (item: ResearchCardData) => String(item.id)
const Sep = () => <Divider style={styles.sep} />

export default function SavedScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const gate = useAuthGate()

  const collections = useAsync<string[]>(() => api.research.savedCollections(), { enabled: gate === 'allow' })
  const saved = useResearchList(
    ({ page, size }) => api.research.mySaved({ page, size }),
    { enabled: gate === 'allow' },
  )
  useTransientRetry(saved.error, saved.reload)

  const remove = async (card: ResearchCardData) => {
    saved.remove(card.id)
    try {
      await toggleSaveRemote(card.id, false)
      toast.ok('Removed from saved', {
        label: 'Undo',
        onPress: async () => {
          try {
            await toggleSaveRemote(card.id, true)
            saved.prepend({ ...card, saved: true })
          } catch (e: any) { toast.error(errorText(e)) }
        },
      })
    } catch (e: any) {
      saved.prepend(card)
      toast.error(errorText(e))
    }
  }

  const menu = useResearchMenu({
    onPatch: (id, patch) => saved.patch(id, row => ({ ...row, ...patch })),
    extra: card => [{ label: 'Remove from saved', icon: 'trash', destructive: true, onPress: () => void remove(card) }],
  })

  /* Item-first handlers, so one function serves the whole list and
     `renderItem` never changes identity — the thing FlashList's ViewHolder
     memo actually compares. Declared above the gate return: hooks cannot be
     conditional. */
  const openMenu = useEvent((item: ResearchCardData) => menu.open(item))
  const removeSaved = useEvent((item: ResearchCardData) => { void remove(item) })
  const renderItem = React.useCallback(({ item }: { item: ResearchCardData }) => (
    <ResearchCard
      item={item}
      savedNote={item.savedAt ? `Saved ${item.time}` : null}
      onLongPress={openMenu}
      onSaveToggle={removeSaved}
    />
  ), [openMenu, removeSaved])

  if (gate !== 'allow') {
    return (
      <Screen>
        <Header back title="Saved papers" />
        <SignInPrompt message="Sign in to keep papers and read them later." />
      </Screen>
    )
  }

  const rail = collections.error ? null : (
    <ChipRail style={styles.rail}>
      <Chip label="All" selected onPress={() => { /* already showing everything */ }} />
      {collections.loading
        /* No `radius`: the stand-in takes the skeleton setback, because the
           real Chips it stands in for are setback plates, not pills. */
        ? [0, 1, 2].map(i => <Skeleton key={i} width={92} height={32} />)
        : (collections.data || []).map(name => (
          <Chip
            key={name}
            label={name}
            icon="library"
            tone="scholar"
            onPress={() => router.push(to(`/research/saved/${encodeURIComponent(name)}`))}
          />
        ))}
    </ChipRail>
  )

  return (
    <Screen>
      <Header back title="Saved papers" below={rail} />

      <FlashList
        data={saved.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListEmptyComponent={
          saved.loading ? <ResearchCardListSkeleton />
            : saved.error ? <ErrorPanel error={saved.error} onRetry={saved.reload} />
              : (
                <EmptyState
                  icon="bookmark"
                  title="Nothing saved yet."
                  message="Tap the bookmark on any paper to keep it here."
                  actionLabel="Browse research"
                  onAction={() => router.replace(to('/research'))}
                />
              )
        }
        ListFooterComponent={saved.items.length ? <ListFooter loading={saved.loadingMore} done={saved.done} /> : null}
        onEndReached={saved.loadMore}
        onEndReachedThreshold={0.6}
        /* Full research plates are 300pt+; the platform default 250 prepares
           barely one cell ahead and a fling shows blanks. */
        drawDistance={500}
        refreshControl={
          <RefreshControl
            refreshing={saved.refreshing}
            onRefresh={() => { void saved.refresh(); void collections.refresh() }}
            tintColor={c.textMuted}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {menu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  rail: { paddingVertical: space.sm2 },
  sep: { marginHorizontal: space.lg },
})
