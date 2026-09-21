/* =========================================================
   Edit a highlight — which is, in practice, adding stories.

   There is no rename endpoint and no delete-highlight
   endpoint. `create`, `addStory`, `removeStory` and `reorder`
   are the whole surface, so this screen offers exactly those
   and does not pretend a title field would do anything.

   The already-included set is passed to the picker as
   `disabledIds` rather than filtered out: seeing a story
   greyed with a tick answers "is this one already in?" without
   making the user remember.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { StoryPickerGrid } from '@/components/stories/StoryPickerGrid'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, EmptyState, ErrorState, Header, Screen, ScreenScroll,
  SkeletonList, Text, toast,
} from '@/ui'

export default function EditHighlightScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { highlightId, title } = useLocalSearchParams<{ highlightId: string; title?: string }>()

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())

  const existing = useAsync<any[]>(
    async () => (await api.highlights.stories(highlightId)) || [],
    { enabled: !!highlightId, deps: [highlightId] },
  )
  const mine = useAsync<any[]>(
    async () => (await api.stories.byAuthor(user?.id)) || [],
    { enabled: !!user?.id, deps: [user?.id] },
  )

  const alreadyIn = React.useMemo(
    () => new Set((existing.data ?? []).map((s: any) => String(s.storyId ?? s.id))),
    [existing.data],
  )

  const toggle = React.useCallback((storyId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(storyId)) next.delete(storyId); else next.add(storyId)
      return next
    })
  }, [])

  const add = useAction(async () => {
    if (!selected.size) return
    /* Sequential: snapshots cluster on createdAt, and a parallel burst can
       land two in the same millisecond. The actor is the JWT principal — the
       legacy ?requesterId= was removed server-side (highlights.md). */
    const failed: string[] = []
    for (const storyId of selected) {
      try { await api.highlights.addStory(highlightId, storyId) }
      catch { failed.push(storyId) }
    }
    setSelected(new Set())
    await existing.reload()
    if (failed.length) toast.warn(`${failed.length} could not be added.`)
    else toast.ok(selected.size === 1 ? 'Added' : `${selected.size} added`)
  }, { onError: e => toast.error(errorText(e, 'Could not add those stories.')) })

  const stories = mine.data ?? []
  const loading = existing.loading || mine.loading

  return (
    <Screen>
      <Header
        back
        title={String(title || 'Edit highlight')}
        subtitle={`${alreadyIn.size} in this highlight`}
      />

      <ScreenScroll refreshing={existing.refreshing} onRefresh={existing.refresh}>
        <View style={{ padding: t.layout.screenPadding }}>
          <Callout tone="neutral" icon="info">
            Removing a story is done from the highlight itself — long-press it there.
          </Callout>
        </View>

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
          <Text variant="title3" align="ui">Add from your stories</Text>
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
            {selected.size ? `${selected.size} selected` : 'Stories already here are dimmed.'}
          </Text>
        </View>

        {loading ? (
          <SkeletonList count={4} />
        ) : mine.error ? (
          <ErrorState error={mine.error} onRetry={mine.reload} compact />
        ) : !stories.length ? (
          <EmptyState
            icon="camera"
            title="No stories to add"
            message="Post a story and it will show up here."
            compact
          />
        ) : (
          <StoryPickerGrid
            stories={stories}
            selectedIds={selected}
            disabledIds={alreadyIn}
            onToggle={toggle}
            pad={t.layout.screenPadding}
          />
        )}

        <View style={{ padding: t.layout.screenPadding, paddingTop: space.xl, gap: space.sm2 }}>
          <Button
            label={selected.size ? `Add ${selected.size}` : 'Add stories'}
            onPress={() => void add.run()}
            loading={add.pending}
            disabled={!selected.size}
            variant="primary"
            size="lg"
            block
          />
          <Button
            label="Done"
            onPress={() => router.back()}
            variant="secondary"
            size="lg"
            block
          />
        </View>
      </ScreenScroll>
    </Screen>
  )
}
