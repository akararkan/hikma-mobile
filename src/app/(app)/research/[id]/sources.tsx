/* =========================================================
   Sources — read-only by design.

   There is no create-source and no delete-source endpoint
   anywhere in the API: the whole list is only ever written
   through `update(id, { sources: [...] })`, which REPLACES it.
   So this screen never offers an edit affordance to a
   non-owner, and the owner's "Manage" button goes to the
   editor that knows about the replace semantics.
   ========================================================= */
import React from 'react'
import { Linking, RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Divider, EmptyState, Header, Screen, SkeletonRow, Text, toast, useSheetState,
} from '@/ui'
import { SourceRow } from '@/components/research/SourceRow'
import { ErrorPanel, GoneState, useTransientRetry } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { bibliographyText } from '@/components/research/citations'
import { to } from '@/components/research/nav'
import type { SourceItem } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a
   fresh component TYPE each render — every visible divider would remount. */
const keyExtractor = (s: SourceItem) => String(s.id)
const Sep = () => <Divider inset={60} />

export default function SourcesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  const { detail } = useResearchDetail(id, { subscribe: false, recordView: false })
  const isOwner = !!user?.id && detail?.author === user.id

  const sources = useAsync<SourceItem[]>(
    () => api.research.sources(id),
    { enabled: !!id, deps: [id] },
  )
  useTransientRetry(sources.error, sources.reload)
  const menu = useSheetState<SourceItem>()

  /* When the dedicated call fails but the paper is already in memory, its
     inline `sources` array is the same sourceFrom shape. */
  const rows = sources.data ?? (sources.error ? detail?.sources ?? [] : [])
  const ordered = [...rows].sort((a, b) => a.order - b.order)

  const open = (s: SourceItem) => {
    if (!s.href) return
    if (/^https?:/i.test(s.href)) { void Linking.openURL(s.href); return }
    /* A MEDIA_FILE source points at an attached document — the in-app preview
       knows how to render it and keeps the download counter honest. */
    router.push(to(`/research/${id}/files`))
  }

  /* Item-first, identity-stable: one pair of handlers for the whole list, so
     `renderItem` never changes identity. */
  const openSource = useEvent((s: SourceItem) => open(s))
  const openSourceMenu = useEvent((s: SourceItem) => menu.open(s))
  const renderItem = React.useCallback(({ item, index }: { item: SourceItem; index: number }) => (
    <SourceRow source={item} index={index + 1} onPress={openSource} onLongPress={openSourceMenu} />
  ), [openSource, openSourceMenu])

  const copyAll = async () => {
    const text = bibliographyText(ordered)
    if (!text) return
    await Clipboard.setStringAsync(text)
    toast.ok('Bibliography copied')
  }

  if (sources.error && isNotFound(sources.error) && !detail) {
    return (
      <Screen>
        <Header back title="Sources" />
        <GoneState onAction={() => router.replace(to('/research'))} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        title={`Sources${ordered.length ? ` · ${ordered.length}` : ''}`}
        actions={[
          ordered.length ? { icon: 'copy', onPress: copyAll, label: 'Copy all' } : null,
          isOwner ? { icon: 'edit', onPress: () => router.push(to(`/research/${id}/edit/sources`)), label: 'Manage' } : null,
        ]}
      />

      <FlashList
        data={ordered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListEmptyComponent={
          sources.loading ? (
            <View>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} avatarSize={32} lines={2} />)}</View>
          ) : sources.error && !ordered.length ? (
            <ErrorPanel error={sources.error} onRetry={sources.reload} />
          ) : (
            <EmptyState icon="quote" title="No sources listed for this paper." />
          )
        }
        ListFooterComponent={
          ordered.length ? (
            <Text variant="footnote" tone="faint" align="ui" style={styles.footnote}>
              Sources are maintained by the corresponding researcher.
            </Text>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={sources.refreshing} onRefresh={() => { void sources.refresh() }} tintColor={c.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.title}
        actions={[
          {
            label: 'Copy citation',
            icon: 'copy',
            onPress: async () => {
              const s = menu.payload
              if (!s) return
              await Clipboard.setStringAsync(s.citationText || s.title || s.sub)
              toast.ok('Citation copied')
            },
          },
          {
            label: 'Open link',
            icon: 'external',
            hidden: !menu.payload?.href,
            onPress: () => { if (menu.payload) open(menu.payload) },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  footnote: { paddingHorizontal: space.lg, paddingVertical: space.xl },
})
