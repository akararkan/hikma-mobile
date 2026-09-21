/* =========================================================
   Manage one answer's citations.

   Reordering PATCHes only the rows whose displayOrder actually
   changed, and reverts the WHOLE order if any of them fails —
   a half-applied reorder is worse than none, because the next
   read shows an order the user never chose.

   The refusal copy here is the server's own: its wording is
   narrower than the generic ownership sentence ("You can only
   add sources to your own answer"), so it is displayed
   verbatim rather than replaced.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { codeOf, detailsOf, errorText, isNotFound } from '@/api'
import { toUploadFile } from '@/platform/files'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, ConfirmSheet, Header, Screen, ScreenScroll, Text, toast, useSheetState,
} from '@/ui'
import { qna, type SourceRequest } from '@/components/qna/api'
import { DraggableRows, moveItem } from '@/components/qna/DraggableRows'
import { emitQna } from '@/components/qna/events'
import { canManageAnswer } from '@/components/qna/gate'
import { openExternal } from '@/components/qna/MediaLightbox'
import { QnaEmptyState, QnaErrorView, QnaRefusal, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { SourceEditorSheet, type SourceFields } from '@/components/qna/SourceEditorSheet'
import { SourceRow } from '@/components/qna/SourceRow'
import type { AnswerView, QuestionView, SourceView } from '@/components/qna/types'

const ROW_HEIGHT = 84
const MAX_HYDRATE_PAGES = 5

export default function SourcesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id, answerId } = useLocalSearchParams<{ id: string; answerId: string }>()

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })
  const list = useAsync<SourceView[]>(
    () => qna.listSources(id, answerId),
    { enabled: !!id && !!answerId, deps: [id, answerId] },
  )

  const [answer, setAnswer] = React.useState<AnswerView | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [sheetError, setSheetError] = React.useState<string | null>(null)
  const [titleError, setTitleError] = React.useState<string | null>(null)

  const editor = useSheetState<SourceView | null>()
  const rowMenu = useSheetState<SourceView>()
  const confirmDelete = useSheetState<SourceView>()
  const confirmTypeChange = useSheetState<SourceView>()

  /* The owning answer is only needed for the sub-header and the permission
     check, so a failure to find it degrades to a thinner header, not a wall. */
  React.useEffect(() => {
    let alive = true
    const run = async () => {
      if (!id || !answerId) return
      try {
        for (let page = 0; page < MAX_HYDRATE_PAGES; page++) {
          const rows = await qna.answers(id, { page, size: 20 })
          const hit = rows.find(r => r.id === answerId)
          if (hit) { if (alive) setAnswer(hit); return }
          if (rows.length < 20) break
        }
      } catch { /* the sources list is the point of this screen */ }
    }
    void run()
    return () => { alive = false }
  }, [id, answerId])

  const sources = list.data ?? []
  const canManage = !answer || canManageAnswer(user, question.data, answer.author)

  const handleError = (e: any) => {
    const code = codeOf(e)
    if (code === 'ACCESS_FORBIDDEN') { setRefused(true); setSheetError(errorText(e)); return }
    if (code === 'SOURCE_MISMATCH') {
      console.error('[qna] BUG: source does not belong to this answer — the screen was opened with mismatched ids.')
      void list.refresh()
      toast.error('Something went wrong. Please try again.')
      return
    }
    if (code === 'SOURCE_NOT_FOUND') { void list.refresh(); return }
    if (e?.status === 413) { setSheetError(`That file is too large — the limit is ${detailsOf(e)?.maxSize ?? 'smaller than this'}.`); return }
    setSheetError(errorText(e))
    toast.error(errorText(e))
  }

  const pushBackToAnswer = (next: SourceView[]) => {
    if (!answer) return
    emitQna('answer:updated', { questionId: id, answer: { ...answer, sources: next } })
  }

  const submitSource = async (fields: SourceFields) => {
    setBusy(true)
    setSheetError(null)
    setTitleError(null)
    const editing = editor.payload
    try {
      const req: SourceRequest = {
        sourceType: fields.sourceType,
        title: fields.title,
        citationText: fields.citationText ?? '',
        url: fields.url ?? '',
        isbn: fields.isbn ?? '',
      }
      const saved = editing
        ? await qna.editSource(id, answerId, editing.id, req)
        : await qna.addSource(id, answerId, req)
      const next = editing
        ? sources.map(s => (s.id === saved.id ? saved : s))
        : [...sources, saved]
      list.setData(next)
      pushBackToAnswer(next)
      editor.close()
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'VALIDATION_FAILED' || code === 'EMPTY_TITLE') { setTitleError(e.message); return }
      handleError(e)
    } finally { setBusy(false) }
  }

  const attachFile = async (source: SourceView) => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
    if (picked.canceled || !picked.assets?.length) { setSheetError('Pick a file to upload'); return }
    setBusy(true)
    setSheetError(null)
    try {
      const fd = new FormData()
      fd.append('file', toUploadFile(picked.assets[0]) as any)
      const saved = await qna.uploadSourceFile(id, answerId, source.id, fd)
      const next = sources.map(s => (s.id === saved.id ? saved : s))
      list.setData(next)
      pushBackToAnswer(next)
      editor.close()
      toast.ok('File attached')
    } catch (e: any) { handleError(e) } finally { setBusy(false) }
  }

  const doDelete = async () => {
    const s = confirmDelete.payload
    if (!s) return
    setBusy(true)
    try {
      await qna.deleteSource(id, answerId, s.id)
      const next = sources.filter(x => x.id !== s.id)
      list.setData(next)
      pushBackToAnswer(next)
      confirmDelete.close()
    } catch (e: any) {
      if (isNotFound(e)) { void list.refresh(); confirmDelete.close(); return }
      handleError(e)
    } finally { setBusy(false) }
  }

  const reorder = async (from: number, to: number) => {
    const before = sources
    const next = moveItem(sources, from, to)
    list.setData(next)
    /* Only the rows whose position actually moved need a PATCH. */
    const changed = next
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => before[i]?.id !== s.id)
    try {
      for (const { s, i } of changed) {
        await qna.editSource(id, answerId, s.id, { displayOrder: i })
      }
      pushBackToAnswer(next)
    } catch (e: any) {
      list.setData(before)
      handleError(e)
    }
  }

  if (question.loading || list.loading) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Sources" />
        <QnaSkeletons kind="sourceRow" count={3} />
      </Screen>
    )
  }

  if (refused || !canManage) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Sources" />
        <QnaRefusal
          title={sheetError ?? 'You can only add sources to your own answer.'}
          onBack={() => (router.canGoBack() ? router.back() : router.replace(qnaHref.question(id)))}
        />
      </Screen>
    )
  }

  if (list.error) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Sources" />
        <QnaErrorView error={list.error} onRetry={list.reload} onBack={() => router.replace(qnaHref.question(id))} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken" edges={['top']}>
      <Header
        back
        title="Sources"
        actions={[{ icon: 'add', onPress: () => { setTitleError(null); setSheetError(null); editor.open(null) }, label: 'Add a source' }]}
      />

      {answer ? (
        <View style={[styles.subHeader, { backgroundColor: c.bg, borderBottomColor: c.separator }]}>
          <Avatar uri={answer._author.profileImage} name={answer._author.full} seed={answer._author.id} size={24} />
          <Text variant="footnote" tone="muted" numberOfLines={1} align="auto" style={styles.flex}>
            {answer.body}
          </Text>
        </View>
      ) : null}

      <ScreenScroll
        refreshing={list.refreshing}
        onRefresh={list.refresh}
        contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 48 }}
      >
        {!sources.length ? (
          <QnaEmptyState
            glyph="book"
            title="No sources yet"
            body="Citations make an answer verifiable."
            actionLabel="Add a source"
            onAction={() => editor.open(null)}
          />
        ) : (
          <>
            <DraggableRows
              items={sources}
              keyOf={s => s.id}
              rowHeight={ROW_HEIGHT}
              onReorder={(from, to) => void reorder(from, to)}
              style={{ paddingHorizontal: t.layout.screenPadding }}
              renderItem={(s, i) => (
                <View style={{ height: ROW_HEIGHT, justifyContent: 'center' }}>
                  <SourceRow
                    source={s}
                    index={i}
                    editable
                    onPress={() => { setTitleError(null); setSheetError(null); editor.open(s) }}
                    onOverflow={() => rowMenu.open(s)}
                    onOpenFile={() => s.href && openExternal(s.href)}
                  />
                </View>
              )}
            />
            <Text variant="footnote" tone="faint" align="center" style={{ marginTop: space.md }}>
              Long-press a source to reorder it.
            </Text>
          </>
        )}
      </ScreenScroll>

      <SourceEditorSheet
        visible={editor.visible}
        onClose={editor.close}
        initial={editor.payload}
        allowFile
        busy={busy}
        error={sheetError}
        fieldError={titleError}
        onSubmit={fields => void submitSource(fields)}
        onAttachFile={() => {
          const s = editor.payload
          if (!s) return
          /* Uploading changes the type irreversibly without an explicit edit,
             so a non-file source asks first. */
          if (s.type !== 'MEDIA_FILE') { confirmTypeChange.open(s); return }
          void attachFile(s)
        }}
      />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.title}
        actions={[
          { label: 'Edit', icon: 'edit', onPress: () => rowMenu.payload && editor.open(rowMenu.payload) },
          {
            label: rowMenu.payload?.fileName ? 'Replace file' : 'Attach file',
            icon: 'attachment',
            onPress: () => {
              const s = rowMenu.payload
              if (!s) return
              if (s.type !== 'MEDIA_FILE') { confirmTypeChange.open(s); return }
              void attachFile(s)
            },
          },
          {
            label: 'Open',
            icon: 'external',
            hidden: !rowMenu.payload?.href,
            onPress: () => rowMenu.payload?.href && openExternal(rowMenu.payload.href),
          },
          {
            label: 'Copy citation',
            icon: 'copy',
            onPress: async () => {
              const s = rowMenu.payload
              if (!s) return
              await Clipboard.setStringAsync(s.citationText || s.sub || s.title)
              toast.ok('Copied')
            },
          },
          { label: 'Delete', icon: 'trash', destructive: true, onPress: () => rowMenu.payload && confirmDelete.open(rowMenu.payload) },
        ]}
      />

      <ConfirmSheet
        visible={confirmTypeChange.visible}
        onClose={confirmTypeChange.close}
        title="Attach a file to this source?"
        message="Uploading a file changes this source's type to File and replaces any previous file."
        confirmLabel="Choose a file"
        icon="attachment"
        onConfirm={() => {
          const s = confirmTypeChange.payload
          confirmTypeChange.close()
          if (s) void attachFile(s)
        }}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this source?"
        message="Its stored file, if any, is removed as well."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDelete}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  subHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.lg, height: 40, borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
