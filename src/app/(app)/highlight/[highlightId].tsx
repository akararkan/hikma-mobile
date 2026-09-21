/* =========================================================
   A highlight.

   A highlight is a set of SNAPSHOTS, not references. The
   original stories expire after their TTL and the snapshots do
   not, which is the whole feature — so nothing here re-reads a
   story, and a snapshot whose media the CDN has since dropped
   shows its own placeholder rather than an empty frame.

   Removal needs the snapshot's `createdAt` as well as the
   story id: it is the clustering key, and without it the
   DELETE addresses nothing.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { HighlightTile } from '@/components/stories/HighlightTile'
import { StoryFrame } from '@/components/stories/StoryFrame'
import { useTheme } from '@/theme/ThemeProvider'
import {
  ActionSheet, ConfirmSheet, EmptyState, ErrorState, Header, Screen, Skeleton,
  Touchable, useSheetState, toast,
} from '@/ui'

/* Module scope so FlashList never sees a new identity for it. */
const keyOf = (s: any, i: number) => String(s.storyId ?? s.id ?? i)

export default function HighlightScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { highlightId, title } = useLocalSearchParams<{ highlightId: string; title?: string }>()
  const { width } = useWindowDimensions()

  const [viewing, setViewing] = React.useState<number | null>(null)
  const menu = useSheetState<any>()
  const confirmRemove = useSheetState<any>()
  const [removing, setRemoving] = React.useState(false)

  const snapshots = useAsync<any[]>(
    async () => (await api.highlights.stories(highlightId)) || [],
    { enabled: !!highlightId, deps: [highlightId] },
  )

  const rows = snapshots.data ?? []
  const mine = rows.length > 0 && user?.id
    && String(rows[0]?.authorId ?? rows[0]?.ownerId ?? '') === String(user.id)

  const gap = 2
  const cell = Math.floor((width - gap * 2) / 3)

  /* `menu` itself is a fresh object every render; `menu.open` is not. */
  const openMenu = menu.open

  /* Hoisted: FlashList re-renders every visible cell whenever renderItem's
     identity changes, and this screen re-renders on every sheet toggle. */
  const renderTile = React.useCallback(({ item, index }: { item: any; index: number }) => (
    <Touchable
      onPress={() => setViewing(index)}
      onLongPress={mine ? () => openMenu(item) : undefined}
      feedback="dim"
      noAutoHitSlop
      style={{ width: cell, height: cell * 1.6, margin: gap / 2, backgroundColor: t.colors.surfaceSunken }}
    >
      {/* A still, not a StoryFrame: a screenful of video snapshots would be a
          screenful of hardware decoders. See HighlightTile's header. */}
      <HighlightTile story={item} />
    </Touchable>
  ), [cell, gap, mine, openMenu, t.colors.surfaceSunken])

  const remove = async () => {
    const snap = confirmRemove.payload
    if (!snap) return
    setRemoving(true)
    try {
      /* `createdAt` is the snapshot's clustering key — the DELETE needs both. */
      await api.highlights.removeStory(highlightId, snap.storyId ?? snap.id, snap.createdAt)
      snapshots.setData(prev => (prev ?? []).filter(s => (s.storyId ?? s.id) !== (snap.storyId ?? snap.id)))
      toast.ok('Removed from this highlight')
    } catch (e) {
      toast.error(errorText(e, 'Could not remove that.'))
    } finally {
      setRemoving(false)
      confirmRemove.close()
    }
  }

  /* The full-screen frame reader. Deliberately simple next to the story
     viewer: a highlight has no progress clock, no expiry and no reply bar —
     it is an archive, and pretending otherwise would put a "replying to a
     story" composer on content from last year. */
  if (viewing !== null && rows[viewing]) {
    return (
      <Screen background="transparent">
        <View style={StyleSheet.absoluteFill}>
          <StoryFrame story={rows[viewing]} muted={false} />
        </View>
        <Header
          back={() => setViewing(null)}
          closeButton
          title={String(title || '')}
          subtitle={`${viewing + 1} of ${rows.length}`}
          overlay
          border={false}
          floating
        />
        {/* Tap zones: left goes back a frame, right goes forward, and past the
            last frame the reader closes rather than looping. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.zones} pointerEvents="box-none">
            <Touchable
              feedback="none"
              noAutoHitSlop
              style={styles.zone}
              accessibilityLabel="Previous"
              onPress={() => setViewing(v => (v === null ? null : Math.max(0, v - 1)))}
            >
              <View style={StyleSheet.absoluteFill} />
            </Touchable>
            <Touchable
              feedback="none"
              noAutoHitSlop
              style={[styles.zone, { flex: 2 }]}
              accessibilityLabel="Next"
              onPress={() => setViewing(v => (v === null ? null : v + 1 >= rows.length ? null : v + 1))}
            >
              <View style={StyleSheet.absoluteFill} />
            </Touchable>
          </View>
        </View>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title={String(title || 'Highlight')}
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'story' : 'stories'}` : undefined}
        actions={mine ? [{
          icon: 'edit',
          label: 'Edit highlight',
          onPress: () => router.push(`/highlight/edit/${highlightId}`),
        }] : []}
      />

      {snapshots.loading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} width={cell} height={cell * 1.6} radius={0} />
          ))}
        </View>
      ) : snapshots.error ? (
        <ErrorState error={snapshots.error} onRetry={snapshots.reload} />
      ) : (
        <FlashList
          data={rows}
          numColumns={3}
          keyExtractor={keyOf}
          refreshing={snapshots.refreshing}
          onRefresh={snapshots.refresh}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark"
              title="Nothing in this highlight"
              message={mine
                ? 'Add stories to it from your archive and they stay here after they expire.'
                : 'This highlight is empty.'}
              actionLabel={mine ? 'Add stories' : undefined}
              onAction={mine ? () => router.push(`/highlight/edit/${highlightId}`) : undefined}
            />
          }
          renderItem={renderTile}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Remove from highlight',
            icon: 'trash',
            destructive: true,
            onPress: () => confirmRemove.open(menu.payload),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmRemove.visible}
        onClose={confirmRemove.close}
        title="Remove this story?"
        message="It comes out of this highlight. The original story is not affected."
        confirmLabel="Remove"
        destructive
        loading={removing}
        onConfirm={() => void remove()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  zones: { flex: 1, flexDirection: 'row' },
  zone: { flex: 1 },
})
