/* =========================================================
   Edit sources.

   There is NO create-source and NO delete-source endpoint. The
   only way a source comes into existence or disappears is
   `update(id, { sources: [...] })`, which REPLACES the whole
   list — so deleting a card here is local until Save, and the
   card says so rather than pretending a destructive call
   happened.

   SAVE THEREFORE HAS TWO PATHS, and the difference matters
   because the replace is lossy: it mints new source rows, and a
   document uploaded against the old row does not follow it.

     · nothing added, nothing removed → PATCH only the rows whose
       fields or order changed. Attachments are untouched. This
       is the ordinary edit.
     · a row was added or removed → the whole-list replace, the
       only call that can express it. If any surviving row holds
       a document, the user is told it will be detached BEFORE
       the call goes out.

   `uploadSourceFile` can only address a row that already has a
   server id, which is why a freshly added card's attach tile is
   disabled until the first Save round-trip returns.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import { adapters, api, codeOf, detailsOf, errorText, traceRef } from '@/api'
import { toUploadFile } from '@/platform/files'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Field, Header, Icon, Screen, SegmentedControl, Skeleton,
  Text, Touchable, toast, useSheetState,
} from '@/ui'
import { MODERATION_COPY, heldEdit } from '@/lib/moderation'
import { ErrorPanel, RefusalState } from '@/components/research/states'
import { useCooldown } from '@/components/research/hooks'
import { useAsync } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { formatBytes } from '@/components/research/format'
import type { ResearchDetail, SourceItem, SourceType } from '@/components/research/types'

interface Row {
  key: string
  id: string | null
  type: SourceType
  title: string
  citationText: string
  url: string
  isbn: string
  fileName: string | null
  fileSize: number | null
  removed: boolean
  error?: string | null
}

const blank = (): Row => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  id: null, type: 'MANUAL', title: '', citationText: '', url: '', isbn: '',
  fileName: null, fileSize: null, removed: false,
})

const rowOf = (s: SourceItem): Row => ({
  key: s.id,
  id: s.id,
  type: s.type,
  title: s.title || '',
  citationText: s.citationText || '',
  url: s.url || '',
  isbn: s.isbn || '',
  fileName: s.fileName,
  fileSize: s.fileSize,
  removed: false,
})

export default function EditSourcesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const load = useAsync<SourceItem[]>(() => api.research.sources(id), { enabled: !!id, deps: [id] })
  const [rows, setRows] = React.useState<Row[]>([])
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<{ tone: 'warning' | 'danger'; text: string } | null>(null)
  const [cooldown, startCooldown] = useCooldown()
  const leaving = useSheetState()

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirty, leaving.open)

  /* What the server last told us each row contained, keyed by id — the
     reference the targeted-PATCH path diffs against. Re-stamped wherever rows
     are re-seeded, so a save never leaves it describing a previous version. */
  const baseline = React.useRef(new Map<string, SourceItem>())
  const seed = React.useCallback((list: SourceItem[]) => {
    baseline.current = new Map(list.map(s => [s.id, s]))
    const mapped = [...list].sort((a, b) => a.order - b.order).map(rowOf)
    setRows(mapped.length ? mapped : [blank()])
    setDirty(false)
  }, [])

  React.useEffect(() => {
    if (!load.data) return
    seed(load.data)
  }, [load.data, seed])

  const set = (key: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch, error: null } : r)))
    setDirty(true)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    setRows(next)
    setDirty(true)
  }

  const attach = async (row: Row) => {
    if (!row.id) return
    const res = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
    })
    if (res.canceled || !res.assets?.[0]) return
    try {
      const fd = new FormData()
      fd.append('file', toUploadFile(res.assets[0]) as any)
      const raw = await api.research.uploadSourceFile(id, row.id, fd)
      const mapped = adapters.sourceFrom(raw) as SourceItem
      set(row.key, { type: 'MEDIA_FILE', fileName: mapped.fileName, fileSize: mapped.fileSize })
      toast.ok('Document attached')
    } catch (e: any) {
      const details = detailsOf(e)
      set(row.key, {
        error: `${errorText(e)}${details?.allowedTypes ? ` Allowed: ${[].concat(details.allowedTypes).join(', ')}.` : ''}`,
      })
    }
  }

  /* Rows only the whole-list replace can express: a source has no create and
     no delete endpoint, so adding or removing one means rewriting the list. */
  const structural = React.useMemo(
    () => rows.some(r => r.removed || !r.id),
    [rows],
  )
  /* Replacing the list mints NEW source rows, and an attached document belongs
     to the row it was uploaded against — so the replace silently detaches
     every file. Worth saying out loud before it happens. */
  const filesAtRisk = React.useMemo(
    () => (structural ? rows.filter(r => !r.removed && r.fileName).length : 0),
    [rows, structural],
  )
  const replaceWarning = useSheetState()

  /* The targeted path: PATCH the rows that actually changed and leave every
     other row — and every attachment — exactly where it is. Only reachable
     when nothing was added or removed, which is the common edit. */
  const patchChanged = async () => {
    const changed = rows.filter((r, i) => {
      const was = r.id ? baseline.current.get(r.id) : null
      if (!was) return false
      return was.type !== r.type
        || (was.title || '') !== r.title
        || (was.citationText || '') !== r.citationText
        || (was.url || '') !== r.url
        || (was.isbn || '') !== r.isbn
        || was.order !== i
    })
    for (const r of changed) {
      const i = rows.indexOf(r)
      /* Non-null values overwrite and null is a no-op, so a cleared url or
         isbn goes as '' — the field the user emptied must not silently keep
         its old value. */
      await api.research.editSource(id, r.id as string, {
        sourceType: r.type,
        title: r.title,
        citationText: r.citationText,
        url: r.url,
        isbn: r.isbn,
        displayOrder: i,
      })
    }
    await load.reload()
    setDirty(false)
    toast.ok(changed.length ? 'Sources saved' : 'Nothing to save')
  }

  const save = async () => {
    if (busy || cooldown > 0) return
    /* Ask once, then run the replace through the same path. */
    if (structural && filesAtRisk > 0 && !replaceWarning.visible) { replaceWarning.open(); return }
    replaceWarning.close()
    setBusy(true)
    setNotice(null)
    const keep = rows.filter(r => !r.removed)
    try {
      if (!structural) { await patchChanged(); return }
      const raw = await api.research.update(id, {
        /* The array replaces the whole list; an empty one clears it. */
        sources: keep.map((r, i) => ({
          sourceType: r.type,
          title: r.title,
          citationText: r.citationText,
          url: r.url || null,
          isbn: r.isbn || null,
          displayOrder: i,
        })),
      })
      const fresh = adapters.researchDetailFrom(raw) as ResearchDetail
      /* New rows come back with server ids — re-seed so their attach tiles
         become usable without a reload. */
      seed(fresh.sources)
      toast.ok('Sources saved')
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'RATE_LIMITED' || e?.status === 429) { startCooldown(e); return }
      if (code === 'SOURCE_MISMATCH' || code === 'SOURCE_NOT_FOUND') {
        setNotice({ tone: 'warning', text: `${errorText(e)} Reloading the list.` })
        void load.reload()
        return
      }
      const ref = traceRef(e)
      setNotice({ tone: 'danger', text: `${errorText(e)}${ref ? ` (ref ${String(ref).slice(0, 8)})` : ''}` })
    } finally {
      setBusy(false)
    }
  }

  if (load.error?.status === 403) {
    return (
      <Screen>
        <Header back title="Sources" />
        <RefusalState title="You do not own this paper." body="Only the corresponding researcher can edit its bibliography." />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        title="Sources"
        back={() => (dirty ? leaving.open() : router.back())}
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: dirty ? 'accent' : 'default' }]}
      />

      {load.loading ? (
        <View style={{ padding: space.lg, gap: space.md2 }}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={190} radius={14} />)}
        </View>
      ) : load.error ? (
        <ErrorPanel error={load.error} onRetry={load.reload} />
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={styles.body} bottomOffset={40} keyboardShouldPersistTaps="handled">
          {notice ? <Callout tone={notice.tone} style={{ marginBottom: space.md2 }}>{notice.text}</Callout> : null}

          {rows.map((row, i) => (
            <View
              key={row.key}
              style={[
                styles.card,
                { backgroundColor: c.surface, opacity: row.removed ? 0.55 : 1 },
              ]}
            >
              <View style={styles.cardHead}>
                <Touchable onPress={() => move(i, -1)} feedback="dim" accessibilityLabel="Move up">
                  <Icon name="up" size={17} color={c.textFaint} />
                </Touchable>
                <Touchable onPress={() => move(i, 1)} feedback="dim" accessibilityLabel="Move down">
                  <Icon name="down" size={17} color={c.textFaint} />
                </Touchable>
                <View style={styles.flex}>
                  {row.removed ? (
                    <Text variant="caption" tone="danger" align="ui">Will be removed on save</Text>
                  ) : null}
                </View>
                <Touchable
                  onPress={() => set(row.key, { removed: !row.removed })}
                  feedback="dim"
                  accessibilityLabel={row.removed ? 'Keep source' : 'Remove source'}
                >
                  <Icon name={row.removed ? 'refresh' : 'trash'} size={17} color={row.removed ? c.textMuted : c.danger} />
                </Touchable>
              </View>

              <SegmentedControl
                options={[
                  { value: 'URL', label: 'URL' },
                  { value: 'ISBN', label: 'ISBN' },
                  { value: 'MEDIA_FILE', label: 'File' },
                  { value: 'MANUAL', label: 'Manual' },
                ]}
                value={row.type}
                onChange={v => set(row.key, { type: v as SourceType })}
                style={{ marginTop: space.sm2 }}
              />

              <Field
                label="Title"
                value={row.title}
                onChangeText={v => set(row.key, { title: v })}
                maxLength={500}
                error={row.error}
                containerStyle={{ marginTop: space.md }}
              />
              <Field
                label="Citation text"
                value={row.citationText}
                onChangeText={v => set(row.key, { citationText: v })}
                maxLength={10000}
                multiline
                minHeight={92}
                containerStyle={{ marginTop: space.sm2 }}
              />

              {row.type === 'URL' ? (
                <Field
                  label="Link"
                  value={row.url}
                  onChangeText={v => set(row.key, { url: v })}
                  icon="link"
                  autoCapitalize="none"
                  keyboardType="url"
                  containerStyle={{ marginTop: space.sm2 }}
                />
              ) : null}

              {row.type === 'ISBN' ? (
                <Field
                  label="ISBN"
                  value={row.isbn}
                  onChangeText={v => set(row.key, { isbn: v })}
                  maxLength={20}
                  autoCapitalize="none"
                  containerStyle={{ marginTop: space.sm2 }}
                />
              ) : null}

              {row.type === 'MEDIA_FILE' ? (
                <Touchable
                  onPress={() => void attach(row)}
                  disabled={!row.id}
                  feedback="dim"
                  style={[styles.attach, { borderColor: c.borderStrong }]}
                >
                  <Icon name="file" size={20} color={c.textFaint} />
                  <View style={styles.flex}>
                    <Text variant="subhead" tone={row.id ? 'default' : 'faint'} align="ui" numberOfLines={1}>
                      {row.fileName || (row.id ? 'Attach document' : 'Save first to attach a file')}
                    </Text>
                    {row.fileSize ? (
                      <Text variant="caption" tone="muted" align="ui">{formatBytes(row.fileSize)}</Text>
                    ) : (
                      <Text variant="caption" tone="faint" align="ui">PDF, DOC, DOCX or TXT</Text>
                    )}
                  </View>
                  {row.fileName ? <Text variant="caption" tone="accent">Replace</Text> : null}
                </Touchable>
              ) : null}
            </View>
          ))}

          <Button
            label="Add source"
            icon="add"
            variant="secondary"
            block
            onPress={() => { setRows(prev => [...prev, blank()]); setDirty(true) }}
            style={{ marginTop: space.xs2 }}
          />

          <Text variant="footnote" tone="faint" align="ui" style={{ marginTop: space.md2 }}>
            {structural
              ? 'Adding or removing a source rewrites the whole list, and attached documents do not survive the rewrite.'
              : 'Edits are saved to each source on its own, so attached documents stay put.'}
          </Text>

          <Button
            label={cooldown > 0 ? `Wait ${cooldown}s` : 'Save sources'}
            block
            size="lg"
            loading={busy}
            disabled={busy || cooldown > 0 || !dirty}
            onPress={save}
            style={{ marginTop: space.lg }}
          />
        </KeyboardAwareScrollView>
      )}

      <ConfirmSheet
        visible={leaving.visible}
        onClose={leaving.close}
        title="Discard your changes?"
        message="The bibliography has not been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { leaving.close(); router.back() }}
      />

      {/* Adding or removing a source rewrites the whole list, and the rewritten
          rows are new — the documents attached to the old ones do not follow.
          There is no endpoint that could avoid this, so the only honest move is
          to say it before it happens. */}
      <ConfirmSheet
        visible={replaceWarning.visible}
        onClose={replaceWarning.close}
        title={filesAtRisk === 1 ? 'One attached document will be detached' : `${filesAtRisk} attached documents will be detached`}
        message="Adding or removing a source rewrites the bibliography, and attached files do not survive the rewrite. You can re-attach them afterwards."
        confirmLabel="Save anyway"
        destructive
        loading={busy}
        onConfirm={() => { void save() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 60, gap: space.md2 },
  card: { borderRadius: 16, padding: space.md2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  attach: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm2, padding: space.md,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12,
  },
  flex: { flex: 1 },
})
