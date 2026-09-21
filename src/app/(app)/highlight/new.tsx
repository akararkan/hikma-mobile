/* =========================================================
   New highlight.

   Two steps in one screen because they are one decision: a
   highlight with a name and no stories is not a thing anyone
   wants, and a highlight created before its stories are chosen
   leaves an empty row behind when the user backs out.

   So `create` fires only on Save, and the snapshots go in
   immediately afterwards. A snapshot that fails is reported by
   name — partial success is the honest outcome and hiding it
   produces a highlight quietly missing a story.

   `addStory` sends no actor: the caller comes from the JWT
   (highlights.md — the legacy ?requesterId= was removed), and
   the server checks that you are both the story's author and
   the highlight's owner. You can only highlight your own
   stories.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { StoryPickerGrid } from '@/components/stories/StoryPickerGrid'
import { isTextFrame } from '@/components/stories/storyVisual'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, EmptyState, ErrorState, Field, Header, Screen, SkeletonList,
  Text, toast,
} from '@/ui'

export default function NewHighlightScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  /* AddToHighlightSheet's "New highlight" row arrives with the frame the user
     was trying to archive — dropping it would make that flow save nothing. */
  const { storyId } = useLocalSearchParams<{ storyId?: string }>()

  const [title, setTitle] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(storyId ? [String(storyId)] : []))
  const [titleError, setTitleError] = React.useState<string | null>(null)

  /* Your own stories are the only candidates — `addStory` refuses anything
     else, and offering them would be a button that always fails. */
  const mine = useAsync<any[]>(
    async () => (await api.stories.byAuthor(user?.id)) || [],
    { enabled: !!user?.id, deps: [user?.id] },
  )

  const toggle = React.useCallback((storyId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(storyId)) next.delete(storyId); else next.add(storyId)
      return next
    })
  }, [])

  const save = useAction(async () => {
    const name = title.trim()
    if (!name) { setTitleError('Give it a name.'); return }
    setTitleError(null)

    /* `displayOrder` is required by the create contract (highlights.md) and is
       part of the storage clustering key — omitting it stacks every highlight
       at slot 0 and the rail loses its order. New pills append to the end. */
    const existing: any[] = user?.id ? await api.highlights.byAuthor(user.id).catch(() => []) : []
    /* The cover can ONLY be set here: there is no update endpoint for a
       highlight, so a pill created without one wears initials for ever. The
       first selected frame that actually has a picture becomes the cover —
       Set iteration is insertion-ordered, so that is the frame the picker
       numbered "1". Text and knowledge-pill frames are skipped (they have no
       media); if nothing does, coverUrl is omitted and the initials fallback
       stands, which is the right look for a text-only highlight.
       These rows go through no adapter, so their urls are still the backend's
       own relative paths — exactly what should be persisted. */
    const cover = [...selected]
      .map(sid => (mine.data ?? []).find((s: any) => String(s.storyId) === String(sid)))
      .find((s: any) => s && !isTextFrame(s) && (s.thumbnailUrl || s.mediaUrl))
    const coverUrl = cover ? (cover.thumbnailUrl || cover.mediaUrl) : undefined
    const created: any = await api.highlights.create({
      title: name,
      coverUrl,
      displayOrder: existing?.length ?? 0,
    })
    const highlightId = created?.highlightId ?? created?.id
    if (!highlightId) throw new Error('The highlight was created but returned no id.')

    /* Sequential, not parallel: the server clusters snapshots by createdAt and
       a burst can land several in the same millisecond. */
    const failed: string[] = []
    for (const id of selected) {
      try { await api.highlights.addStory(highlightId, id) }
      catch { failed.push(id) }
    }

    if (failed.length) {
      toast.warn(`Highlight created — ${failed.length} ${failed.length === 1 ? 'story' : 'stories'} could not be added.`)
    } else {
      toast.ok('Highlight created')
    }
    router.replace({ pathname: '/highlight/[highlightId]', params: { highlightId, title: name } } as any)
  }, { onError: e => toast.error(errorText(e, 'Could not create that highlight.')) })

  const stories = mine.data ?? []

  return (
    <Screen>
      <Header
        back
        title="New highlight"
        actions={[{
          icon: 'check',
          label: 'Save',
          tone: 'accent',
          onPress: () => void save.run(),
        }]}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: space.huge }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
          <Field
            label="Name"
            value={title}
            onChangeText={v => { setTitle(v); setTitleError(null) }}
            error={titleError}
            placeholder="Ramadan, Travel, Lectures…"
            maxLength={40}
            icon="bookmark"
            autoFocus
            returnKeyType="done"
          />

          <Callout tone="neutral" icon="clock">
            Highlights keep a copy. The stories you pick stay here after the
            originals expire.
          </Callout>
        </View>

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
          <Text variant="title3" align="ui">Choose stories</Text>
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
            {selected.size ? `${selected.size} selected` : 'Tap to select. You can add more later.'}
          </Text>
        </View>

        {mine.loading ? (
          <SkeletonList count={4} />
        ) : mine.error ? (
          <ErrorState error={mine.error} onRetry={mine.reload} compact />
        ) : !stories.length ? (
          <EmptyState
            icon="camera"
            title="No stories yet"
            message="Post a story first — you can still create the highlight now and fill it later."
            compact
          />
        ) : (
          <StoryPickerGrid
            stories={stories}
            selectedIds={selected}
            onToggle={toggle}
            pad={t.layout.screenPadding}
          />
        )}

        <View style={{ padding: t.layout.screenPadding, paddingTop: space.xl }}>
          <Button
            label={selected.size ? `Create with ${selected.size}` : 'Create'}
            onPress={() => void save.run()}
            loading={save.pending}
            disabled={!title.trim()}
            variant="primary"
            size="lg"
            block
          />
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}
