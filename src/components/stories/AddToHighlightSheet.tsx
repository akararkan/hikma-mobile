/* =========================================================
   Add to highlight — the only way a story outlives its TTL.

   Adding SNAPSHOTS the frame, and the snapshot's `createdAt`
   is the ORIGINAL story's timestamp, not the moment of the
   copy. That value is the clustering key removeStory needs, so
   the undo action carries it rather than re-deriving it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, InlineError, Sheet, Spinner, Text, Touchable, toast } from '@/ui'
import { invalidateStories } from './trayStore'
import type { StoryRow } from './storyVisual'

export interface AddToHighlightSheetProps {
  visible: boolean
  onClose: () => void
  viewerId: string | null
  story: StoryRow | null
  onAdded?: () => void
}

export function AddToHighlightSheet({ visible, onClose, viewerId, story, onAdded }: AddToHighlightSheetProps) {
  const t = useTheme()
  const router = useRouter()
  const [rows, setRows] = React.useState<any[] | null>(null)
  const [loadErr, setLoadErr] = React.useState<any>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  /* A failure kept its own slot rather than collapsing into `[]`: "you don't
     have any highlights yet" over a dropped connection is a lie the user acts
     on — they make a second highlight beside the one they already own, and the
     only recovery is closing and reopening a sheet they have no reason to
     distrust. */
  const reload = React.useCallback(() => {
    if (!viewerId) return
    setRows(null)
    setLoadErr(null)
    api.highlights.byAuthor(viewerId)
      .then((r: any[]) => setRows(r || []))
      .catch((e: any) => { setLoadErr(e); setRows([]) })
  }, [viewerId])

  React.useEffect(() => { if (visible) reload() }, [visible, reload])

  const add = async (highlightId: string, title: string) => {
    if (!story) return
    setBusy(highlightId)
    try {
      /* Actor comes from the JWT — the legacy ?requesterId= param was removed
         server-side (highlights.md security model), so nothing extra is sent. */
      const snap = await api.highlights.addStory(highlightId, story.storyId)
      invalidateStories()
      onAdded?.()
      onClose()
      toast.ok(`Added to ${title}`, {
        label: 'Undo',
        onPress: () => {
          api.highlights.removeStory(highlightId, story.storyId, snap?.createdAt)
            .then(() => invalidateStories())
            /* The snapshot is permanent but the SOURCE is not, so an undo can
               legitimately fail once the original has expired. */
            .catch((e: any) => toast.error(errorText(e)))
        },
      })
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add to highlight">
      <View style={{ paddingBottom: space.sm2 }}>
        <Touchable
          onPress={() => { onClose(); router.push(`/highlight/new?storyId=${story?.storyId ?? ''}` as any) }}
          feedback="tint"
          noAutoHitSlop
          style={[styles.row, { borderBottomColor: t.colors.separator }]}
        >
          <View style={[styles.badge, { borderColor: t.colors.borderStrong, borderStyle: 'dashed' }]}>
            <Icon name="add" size={20} color={t.colors.text} />
          </View>
          <Text variant="bodyStrong" align="ui">New highlight</Text>
        </Touchable>

        {rows == null ? (
          <Spinner />
        ) : loadErr ? (
          <InlineError error={loadErr} onRetry={reload} />
        ) : rows.length === 0 ? (
          <Text variant="footnote" tone="muted" align="ui" style={{ padding: space.xl }}>
            You don’t have any highlights yet.
          </Text>
        ) : rows.map(h => (
          <Touchable
            key={String(h.highlightId)}
            onPress={() => add(String(h.highlightId), String(h.title || 'highlight'))}
            disabled={!!busy}
            feedback="tint"
            noAutoHitSlop
            style={[styles.row, { borderBottomColor: t.colors.separator }]}
          >
            <View style={[styles.badge, { borderColor: t.colors.border }]}>
              <Text variant="footnote" tone="muted" align="center">
                {String(h.title || '··').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text variant="body" align="ui" numberOfLines={1} style={{ flex: 1 }}>{h.title}</Text>
            {busy === String(h.highlightId) ? <Spinner style={{ padding: 0 }} /> : null}
          </Touchable>
        ))}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md2,
    paddingHorizontal: space.xl,
    height: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
})
