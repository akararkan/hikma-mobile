/* =========================================================
   Where a bookmark goes.

   Omitting the collection files the save under "Default" —
   http.buildUrl drops undefined query values, so `save(id)`
   and `save(id, undefined)` are the same request. Saving an
   already-saved question is idempotent AND re-files it, which
   is what "Move to collection…" relies on.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { errorText } from '@/api'
import { qna } from './api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Field, Icon, ListRow, Sheet, Spinner, Text } from '@/ui'

export function CollectionPickerSheet({
  visible, onClose, current, onPick,
}: {
  visible: boolean
  onClose: () => void
  current?: string | null
  onPick: (name: string | undefined) => void
}) {
  const t = useTheme()
  const [names, setNames] = React.useState<string[] | null>(null)
  const [error, setError] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState('')

  React.useEffect(() => {
    if (!visible) { setCreating(false); setDraft(''); return }
    let alive = true
    setError(null)
    qna.savedCollections()
      .then((rows: string[]) => { if (alive) setNames(Array.isArray(rows) ? rows : []) })
      .catch((e: any) => { if (alive) { setError(e); setNames([]) } })
    return () => { alive = false }
  }, [visible])

  const pick = (name: string | undefined) => { onClose(); setTimeout(() => onPick(name), 90) }

  const list = names ?? []
  const hasDefault = list.some(n => n.toLowerCase() === 'default')

  return (
    <Sheet visible={visible} onClose={onClose} title="Save to" subtitle="Collections keep long reading lists apart.">
      {names === null ? (
        <Spinner label="Loading collections…" />
      ) : creating ? (
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Field
            label="New collection"
            value={draft}
            onChangeText={setDraft}
            placeholder="Fiqh"
            autoFocus
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={() => draft.trim() && pick(draft.trim())}
          />
          <View style={styles.row}>
            <Button label="Cancel" variant="secondary" size="md" onPress={() => setCreating(false)} style={styles.flex} />
            <Button label="Save here" size="md" disabled={!draft.trim()} onPress={() => pick(draft.trim())} style={styles.flex} />
          </View>
        </View>
      ) : (
        <View>
          {error ? (
            <Text variant="footnote" tone="danger" align="ui" style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
              {errorText(error)}
            </Text>
          ) : null}

          {!hasDefault ? (
            <ListRow
              title="Default"
              subtitle="Where saves land when you do not choose"
              icon="bookmark"
              iconTone="accent"
              accessory={current == null || current === 'Default' ? { kind: 'check', checked: true } : { kind: 'none' }}
              onPress={() => pick(undefined)}
            />
          ) : null}

          {list.map(name => (
            <ListRow
              key={name}
              title={name}
              icon="bookmark"
              iconTone={name.toLowerCase() === 'default' ? 'accent' : 'neutral'}
              accessory={current === name ? { kind: 'check', checked: true } : { kind: 'none' }}
              onPress={() => pick(name.toLowerCase() === 'default' ? undefined : name)}
            />
          ))}

          <ListRow
            title="New collection…"
            icon="add"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => setCreating(true)}
          />
        </View>
      )}
    </Sheet>
  )
}

/** The rename flow used by the saved shelf and the collection header. */
export function RenameCollectionSheet({
  visible, onClose, name, onDone,
}: { visible: boolean; onClose: () => void; name: string; onDone: (next: string) => void }) {
  const t = useTheme()
  const [value, setValue] = React.useState(name)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => { if (visible) { setValue(name); setError(null); setBusy(false) } }, [visible, name])

  const submit = async () => {
    const next = value.trim()
    /* MISSING_NEW_NAME is a 400 — block the blank case before the round trip. */
    if (!next) { setError('Enter a name for this collection.'); return }
    if (next === name) { onClose(); return }
    setBusy(true)
    try {
      await qna.renameCollection(name, next)
      setBusy(false)
      onClose()
      setTimeout(() => onDone(next), 90)
    } catch (e: any) {
      setBusy(false)
      setError(errorText(e))
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Rename collection" scrollable={false}>
      <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
        <View style={[styles.row, { gap: space.sm, alignItems: 'center' }]}>
          <Icon name="bookmark" size={16} color={t.colors.textMuted} />
          <Text variant="footnote" tone="muted" align="ui">Renames it everywhere you saved to it.</Text>
        </View>
        <Field
          label="New name"
          value={value}
          onChangeText={v => { setValue(v); setError(null) }}
          error={error}
          autoFocus
          maxLength={80}
          returnKeyType="done"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <View style={styles.row}>
          <Button label="Cancel" variant="secondary" size="lg" onPress={onClose} style={styles.flex} />
          <Button label="Rename" size="lg" loading={busy} onPress={submit} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm2 },
  flex: { flex: 1 },
})
