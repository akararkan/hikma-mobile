/* =========================================================
   Save to collection.

   There is no create-collection endpoint and no delete-
   collection endpoint. A collection exists BECAUSE something
   was saved into it, so "＋ New collection" only sets a pending
   name and the Save button performs the create. Renaming is the
   only collection-level write the API has.

   Saving into a different collection while already saved is a
   MOVE — `save` is idempotent and re-points the row.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isRateLimited } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useAsync } from '@/hooks/useAsync'
import {
  Button, Divider, Field, Header, Icon, ListRow, Screen, ScreenScroll, Skeleton,
  Text, Touchable, toast,
} from '@/ui'
import { ErrorPanel } from '@/components/research/states'
import { toggleSaveRemote, useCooldown, useResearchDetail } from '@/components/research/hooks'
import { isBlockedInteraction } from '@/components/research/ResearchCard'

const DEFAULT = 'Default'

export default function SaveScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, patch } = useResearchDetail(id, { subscribe: false, recordView: false })

  const collections = useAsync<string[]>(() => api.research.savedCollections(), { enabled: !!id, deps: [id] })
  const [selected, setSelected] = React.useState<string>(DEFAULT)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [renameTo, setRenameTo] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [cooldown, startCooldown] = useCooldown()

  /* Default is always offered, even when the API list comes back empty — it is
     the collection `save(id)` writes into when no name is given. */
  const names = React.useMemo(() => {
    const rest = (collections.data || []).filter(n => n && n !== DEFAULT)
    return [DEFAULT, ...rest]
  }, [collections.data])

  const notPublished = detail ? detail.status !== 'PUBLISHED' : false
  const pending = creating && newName.trim() ? newName.trim() : selected

  const save = async () => {
    if (busy || cooldown > 0 || notPublished) return
    setBusy(true)
    setFormError(null)
    try {
      const res = await toggleSaveRemote(id, true, pending)
      patch(d => ({ ...d, saved: res.saved, metrics: { ...d.metrics, saves: res.saves } }))
      toast.ok(detail?.saved && pending !== selected ? `Moved to ${pending}` : `Saved to ${pending}`)
      router.back()
    } catch (e: any) {
      if (isRateLimited(e)) { startCooldown(e); setBusy(false); return }
      if (isBlockedInteraction(e)) { toast.error(errorText(e)); router.back(); return }
      setFormError(e)
      setBusy(false)
    }
  }

  const unsave = async () => {
    setBusy(true)
    try {
      const res = await toggleSaveRemote(id, false)
      patch(d => ({ ...d, saved: res.saved, metrics: { ...d.metrics, saves: res.saves } }))
      toast.ok('Removed from saved')
      router.back()
    } catch (e: any) {
      setFormError(e)
      setBusy(false)
    }
  }

  const commitRename = async (oldName: string) => {
    const next = renameTo.trim()
    if (!next || next === oldName) { setRenaming(null); return }
    setRenameError(null)
    try {
      await api.research.renameCollection(oldName, next)
      setRenaming(null)
      if (selected === oldName) setSelected(next)
      await collections.reload()
      toast.ok('Collection renamed')
    } catch (e: any) {
      setRenameError(errorText(e))
    }
  }

  return (
    <Screen background="elevated">
      <Header closeButton title="Save to" border={false} />

      <ScreenScroll contentContainerStyle={{ paddingBottom: space.xxl }}>
        {notPublished ? (
          <Text variant="footnote" tone="warning" align="ui" style={styles.note}>
            You can only save published papers.
          </Text>
        ) : null}

        {formError ? <ErrorPanel error={formError} onRetry={save} compact style={styles.note} /> : null}

        {collections.loading ? (
          <View style={{ padding: space.lg, gap: space.md2 }}>
            {[0, 1, 2].map(i => <Skeleton key={i} height={22} />)}
          </View>
        ) : (
          names.map((name, i) => (
            <View key={name}>
              {i ? <Divider inset={58} /> : null}
              {renaming === name ? (
                <View style={styles.renameRow}>
                  <Field
                    value={renameTo}
                    onChangeText={setRenameTo}
                    autoFocus
                    maxLength={40}
                    error={renameError}
                    hint="Renaming updates every paper saved in this collection."
                    containerStyle={styles.flex}
                  />
                  <Button label="Save" size="sm" onPress={() => void commitRename(name)} />
                </View>
              ) : (
                <ListRow
                  title={name}
                  leading={
                    <View style={[styles.folder, { backgroundColor: c.scholarSoft }]}>
                      <Icon name="library" size={17} color={c.scholarText} />
                    </View>
                  }
                  onPress={() => { setSelected(name); setCreating(false) }}
                  accessory={{
                    kind: 'custom',
                    node: (
                      <View style={styles.rowEnd}>
                        <View
                          style={{
                            width: 21,
                            height: 21,
                            borderRadius: 11,
                            borderWidth: selected === name && !creating ? 6.5 : 1.5,
                            borderColor: selected === name && !creating ? c.accent : c.borderStrong,
                          }}
                        />
                        <Touchable
                          onPress={() => { setRenaming(name); setRenameTo(name); setRenameError(null) }}
                          feedback="dim"
                          accessibilityLabel={`Rename ${name}`}
                        >
                          <Icon name="more" size={17} color={c.textFaint} />
                        </Touchable>
                      </View>
                    ),
                  }}
                />
              )}
            </View>
          ))
        )}

        <Divider inset={58} />

        {creating ? (
          <View style={styles.renameRow}>
            <Field
              value={newName}
              onChangeText={setNewName}
              placeholder="Collection name"
              autoFocus
              maxLength={40}
              hint="It is created the moment you save into it."
              containerStyle={styles.flex}
            />
          </View>
        ) : (
          <ListRow
            title="New collection"
            icon="add"
            iconTone="accent"
            onPress={() => { setCreating(true); setNewName('') }}
          />
        )}

        {collections.error ? (
          <ErrorPanel error={collections.error} onRetry={collections.reload} compact style={styles.note} />
        ) : null}
      </ScreenScroll>

      <View style={[styles.footer, { borderTopColor: c.separator }]}>
        <Button
          label={cooldown > 0 ? `Wait ${cooldown}s` : detail?.saved && pending !== DEFAULT ? `Move to ${pending}` : 'Save'}
          block
          size="lg"
          loading={busy}
          disabled={busy || cooldown > 0 || notPublished}
          onPress={save}
        />
        {detail?.saved ? (
          <Touchable onPress={unsave} feedback="dim" style={styles.removeBtn}>
            <Text variant="subhead" tone="danger" align="center">Remove from saved</Text>
          </Touchable>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  folder: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  renameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  footer: { padding: space.lg, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth },
  removeBtn: { paddingVertical: space.md2 },
  flex: { flex: 1 },
})
