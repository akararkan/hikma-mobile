/* =========================================================
   Someone's highlights.

   A grid rather than the profile's rail, because the rail is a
   preview and this is the list — and because `reorder` only
   makes sense somewhere with room to drag.

   The owner gets a New tile first. Everyone else gets the
   highlights and nothing else: there is no per-highlight
   privacy in the API, so anything returned here is public by
   construction.

   REORDER is a mode, not a gesture on the grid. Dragging inside
   a 3-column recycling grid means fighting the recycler for the
   tile under the finger, so the owner flips into a plain
   vertical list (DraggableRows, the same one sources and
   attachments use) and flips back out. The rail's order is the
   author's editorial voice — first is what a visitor sees.

   The commit sends the COMPLETE id list: highlights.md warns
   that ids you own but omit keep their old rows, which collides
   `displayOrder`. The 200 carries the rewritten list, so the
   screen reseeds from the server rather than trusting its own
   optimistic array.
   ========================================================= */
import { api, errorText } from '@/api'
import { DraggableRows, moveItem } from '@/components/qna/DraggableRows'
import { HighlightPill, NewHighlightPill, type HighlightRow } from '@/components/stories/HighlightPill'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
    EmptyState, ErrorState, Header, Screen, Skeleton, Text, toast,
} from '@/ui'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import { View } from 'react-native'

/** The drag list's fixed row: a 56pt pill with breathing room either side. */
const ROW_HEIGHT = 76
/* Module scope: FlashList compares keyExtractor by identity, and an inline
   lambda is a new identity on every render. */
const keyExtractor = (h: HighlightRow) => String(h.highlightId)

export default function HighlightsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { authorId } = useLocalSearchParams<{ authorId: string }>()

  const mine = !!user?.id && String(user.id) === String(authorId)

  const list = useAsync<HighlightRow[]>(
    async () => (await api.highlights.byAuthor(authorId)) || [],
    { enabled: !!authorId, deps: [authorId] },
  )

  const rows = list.data ?? []

  const [reordering, setReordering] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  /* Leaving reorder mode when the list empties out (or you open someone
     else's) would otherwise strand a Done button over nothing to drag. */
  React.useEffect(() => {
    if (reordering && (!mine || rows.length < 2)) setReordering(false)
  }, [reordering, mine, rows.length])

  /* Optimistic: the row follows the finger immediately and the server is told
     after. A refusal puts the old order back — a rail that silently disagrees
     with what you just dragged is worse than a toast. */
  const commit = async (from: number, to: number) => {
    const before = rows
    const next = moveItem(before, from, to)
    list.setData(next)
    setSaving(true)
    try {
      const fresh = await api.highlights.reorder(next.map(h => String(h.highlightId)))
      if (Array.isArray(fresh) && fresh.length) list.setData(fresh as HighlightRow[])
    } catch (e: any) {
      list.setData(before)
      toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  /* Hoisted with stable handlers: an inline renderItem re-invoked every
     mounted tile on every render of this screen. */
  const openHighlight = useEvent((item: HighlightRow) => router.push({
    pathname: '/highlight/[highlightId]',
    params: { highlightId: item.highlightId, title: item.title },
  } as any))
  const beginReorder = useEvent(() => setReordering(true))
  const canReorder = mine && rows.length > 1
  const renderItem = React.useCallback(({ item }: { item: HighlightRow }) => (
    <View style={{ flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
      <HighlightPill
        highlight={item}
        size={78}
        onPress={() => openHighlight(item)}
        onLongPress={canReorder ? beginReorder : undefined}
      />
      <Text variant="caption" tone="secondary" align="center" numberOfLines={1} style={{ maxWidth: 92 }}>
        {item.title}
      </Text>
    </View>
  ), [openHighlight, beginReorder, canReorder])

  return (
    <Screen background="sunken">
      <Header
        back
        title={mine ? 'Your highlights' : 'Highlights'}
        actions={[
          mine && rows.length > 1 ? {
            icon: reordering ? 'check' : 'sort',
            label: reordering ? 'Done reordering' : 'Reorder highlights',
            tone: reordering ? 'accent' : 'default',
            onPress: () => setReordering(v => !v),
          } : null,
        ]}
      />

      {list.loading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, padding: space.xxl }}>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} circle width={78} height={78} />)}
        </View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : reordering ? (
        <ReorderList rows={rows} disabled={saving} onReorder={commit} />
      ) : (
        <FlashList
          data={rows}
          numColumns={3}
          keyExtractor={keyExtractor}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          contentContainerStyle={{ padding: space.lg }}
          ListHeaderComponent={
            mine ? (
              <View style={{ flexDirection: 'row', paddingBottom: space.lg2, paddingHorizontal: space.xs }}>
                <View style={{ alignItems: 'center', gap: space.sm }}>
                  <NewHighlightPill size={78} onPress={() => router.push('/highlight/new')} />
                  <Text variant="caption" tone="muted" align="center">New</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="bookmark"
              title={mine ? 'No highlights yet' : 'No highlights'}
              message={mine
                ? 'Highlights keep a copy of a story, so it stays on your profile after it expires.'
                : 'This account has not saved any stories to its profile.'}
              actionLabel={mine ? 'Create one' : undefined}
              onAction={mine ? () => router.push('/highlight/new') : undefined}
            />
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}

/* ---------------------------------------------------------
   Reorder mode. One column, long-press to lift, and the tiles
   wiggle so the mode is unmistakable — the pill already knows
   how (its `wiggle` prop exists for exactly this).
   --------------------------------------------------------- */

function ReorderList({
  rows, disabled, onReorder,
}: { rows: HighlightRow[]; disabled?: boolean; onReorder: (from: number, to: number) => void }) {
  const t = useTheme()
  return (
    <View style={{ paddingVertical: space.md }}>
      <Text
        variant="footnote"
        tone="muted"
        align="ui"
        style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}
      >
        Hold a highlight to lift it, then drag. The first one is what visitors see first.
      </Text>
      <DraggableRows
        items={rows}
        keyOf={h => String(h.highlightId)}
        rowHeight={ROW_HEIGHT}
        disabled={disabled}
        onReorder={onReorder}
        style={{ paddingHorizontal: t.layout.screenPadding }}
        renderItem={(h: HighlightRow, i: number) => (
          <View style={{ height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md2 }}>
            {/* The ordinal is the handle, as on the sources and attachments
                lists: a glyph inside a list row is exactly what DESIGN.md
                forbids, and the number says the one thing that matters here —
                where this highlight sits in the rail. */}
            <Text variant="caption" tone="faint" style={{ minWidth: 18 }}>{i + 1}.</Text>
            <HighlightPill highlight={h} size={56} wiggle={!disabled} />
            <Text variant="body" align="auto" numberOfLines={1} style={{ flex: 1 }}>{h.title}</Text>
          </View>
        )}
      />
    </View>
  )
}
