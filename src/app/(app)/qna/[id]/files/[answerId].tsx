/* =========================================================
   Manage one answer's attachments.

   Uploads run one at a time even for a multi-select, so a
   failure is attributable to a file instead of to "the batch".
   A failed row stays on screen as a retryable error row rather
   than vanishing — the user picked that file for a reason.

   `mediaType` is derived SERVER-side from the MIME type, so the
   optimistic row guesses only for its own icon and is replaced
   by the authoritative row the moment the call returns.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { codeOf, detailsOf, errorText, isNotFound } from '@/api'
import { isNsfwBlocked } from '@/lib/moderation'
import { prepareUpload, type PickedAsset } from '@/lib/mediaTier'
import { toLocalFile } from '@/lib/localFile'
import { toUploadFile } from '@/platform/files'
import { checkAssets } from '@/lib/fileMeta'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, ConfirmSheet, Field, Header, Icon, Screen,
  ScreenScroll, Sheet, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { AttachmentRow, AttachmentTile, isVisual } from '@/components/qna/AttachmentViews'
import { DraggableRows, moveItem } from '@/components/qna/DraggableRows'
import { emitQna } from '@/components/qna/events'
import { canManageAnswer } from '@/components/qna/gate'
import { MediaLightbox, openExternal, type LightboxItem } from '@/components/qna/MediaLightbox'
import { IndeterminateBar, QnaEmptyState, QnaErrorView, QnaRefusal, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { formatBytes, type AnswerView, type AttachmentView, type QuestionView } from '@/components/qna/types'

const ROW_HEIGHT = 80
const MAX_HYDRATE_PAGES = 5

interface PendingUpload {
  key: string
  name: string
  size: number
  asset: any
  failed: boolean
  /** The image gate refused this file — the same bytes score the same, so
   *  the row keeps Remove but loses Retry (image-moderation-frontend.md). */
  terminal?: boolean
  message?: string
  /** Live byte fraction 0..1 while this row uploads. */
  pct?: number | null
  /** Abort handle for this row's in-flight request. */
  ctrl?: AbortController | null
}

export default function AttachmentsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id, answerId } = useLocalSearchParams<{ id: string; answerId: string }>()

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })
  const list = useAsync<AttachmentView[]>(
    () => qna.listAttachments(id, answerId),
    { enabled: !!id && !!answerId, deps: [id, answerId] },
  )

  const [answer, setAnswer] = React.useState<AnswerView | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [pending, setPending] = React.useState<PendingUpload[]>([])
  const [lightbox, setLightbox] = React.useState<LightboxItem | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [captionDraft, setCaptionDraft] = React.useState('')

  const addMenu = useSheetState()
  const rowMenu = useSheetState<AttachmentView>()
  const captionSheet = useSheetState<AttachmentView>()
  const confirmDelete = useSheetState<AttachmentView>()

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
      } catch { /* the attachment list is the point of this screen */ }
    }
    void run()
    return () => { alive = false }
  }, [id, answerId])

  const files = list.data ?? []
  const visual = files.filter(isVisual)
  const others = files.filter(f => !isVisual(f))
  const canManage = !answer || canManageAnswer(user, question.data, answer.author)

  const pushBackToAnswer = (next: AttachmentView[]) => {
    if (!answer) return
    emitQna('answer:updated', { questionId: id, answer: { ...answer, attachments: next } })
  }

  const handleError = (e: any): string => {
    const code = codeOf(e)
    if (code === 'ACCESS_FORBIDDEN') { setRefused(true); return errorText(e) }
    if (code === 'ATTACHMENT_MISMATCH') {
      console.error('[qna] BUG: attachment belongs to another answer — the screen was opened with mismatched ids.')
      void list.refresh()
      toast.error('Something went wrong. Please try again.')
      return 'Something went wrong.'
    }
    if (isNotFound(e)) { void list.refresh(); return errorText(e) }
    if (e?.status === 413) return `That file is too large — the limit is ${detailsOf(e)?.maxSize ?? 'smaller than this'}.`
    return errorText(e)
  }

  const uploadOne = React.useCallback(async (item: PendingUpload) => {
    const ctrl = new AbortController()
    setPending(p => p.map(x => (x.key === item.key ? { ...x, failed: false, message: undefined, pct: 0, ctrl } : x)))
    try {
      const fd = new FormData()
      fd.append('file', toUploadFile(item.asset) as any)
      /* caption/displayOrder travel as QUERY params in this client, which
         Spring's @RequestParam binding accepts. */
      const saved = await qna.addAttachment(id, answerId, fd, { displayOrder: (list.data?.length ?? 0) }, {
        signal: ctrl.signal,
        onProgress: (f: number) => setPending(p => p.map(x => (x.key === item.key ? { ...x, pct: f } : x))),
      })
      list.setData(prev => {
        const next = [...(prev ?? []), saved]
        pushBackToAnswer(next)
        return next
      })
      setPending(p => p.filter(x => x.key !== item.key))
    } catch (e: any) {
      /* A deliberate cancel just removes the row — no failed state to dismiss. */
      if (e?.name === 'AbortError') { setPending(p => p.filter(x => x.key !== item.key)); return }
      const message = handleError(e)
      setPending(p => p.map(x => (x.key === item.key
        ? { ...x, failed: true, terminal: isNsfwBlocked(e), message, pct: null, ctrl: null }
        : x)))
    }
  }, [id, answerId, list.data]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Sequential on purpose: one progress row at a time is attributable, and a
     phone uplink gains nothing from three parallel multiparts. */
  const enqueue = React.useCallback(async (rawAssets: any[]) => {
    /* Fail fast (size caps / blocked types) before any bytes move — the
       server re-checks everything authoritatively. */
    const { ok: assets, rejected } = checkAssets(rawAssets, 'qna')
    rejected.forEach(v => toast.warn(`${v.asset.fileName || v.asset.name || 'File'}: ${v.reason}`))
    for (const asset of assets) {
      const item: PendingUpload = {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: asset.fileName || asset.name || 'file',
        size: asset.fileSize ?? asset.size ?? 0,
        asset,
        failed: false,
      }
      setPending(p => [...p, item])
      await uploadOne(item)
    }
  }, [uploadOne])

  const pickMedia = async (fromCamera: boolean) => {
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, selectionLimit: 0 })
    if (res.canceled || !res.assets?.length) return
    const prepared = []
    for (const a of res.assets) prepared.push(await prepareUpload(a as PickedAsset))
    void enqueue(prepared)
  }

  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true })
    if (res.canceled || !res.assets?.length) return
    void enqueue(res.assets)
  }

  const saveCaption = async () => {
    const a = captionSheet.payload
    if (!a) return
    setBusy(true)
    try {
      const saved = await qna.editAttachment(id, answerId, a.id, { caption: captionDraft })
      list.setData(prev => {
        const next = (prev ?? []).map(x => (x.id === saved.id ? saved : x))
        pushBackToAnswer(next)
        return next
      })
      captionSheet.close()
    } catch (e: any) { toast.error(handleError(e)) } finally { setBusy(false) }
  }

  const doDelete = async () => {
    const a = confirmDelete.payload
    if (!a) return
    setBusy(true)
    try {
      await qna.deleteAttachment(id, answerId, a.id)
      list.setData(prev => {
        const next = (prev ?? []).filter(x => x.id !== a.id)
        pushBackToAnswer(next)
        return next
      })
      confirmDelete.close()
    } catch (e: any) {
      if (isNotFound(e)) { void list.refresh(); confirmDelete.close(); return }
      toast.error(handleError(e))
    } finally { setBusy(false) }
  }

  const applyOrder = async (next: AttachmentView[], before: AttachmentView[]) => {
    list.setData(next)
    const changed = next.map((a, i) => ({ a, i })).filter(({ a, i }) => before[i]?.id !== a.id)
    try {
      for (const { a, i } of changed) await qna.editAttachment(id, answerId, a.id, { displayOrder: i })
      pushBackToAnswer(next)
    } catch (e: any) {
      list.setData(before)
      toast.error(handleError(e))
    }
  }

  const reorderOthers = (from: number, to: number) => {
    const moved = moveItem(others, from, to)
    void applyOrder([...visual, ...moved], files)
  }

  const moveToFront = (a: AttachmentView) => {
    const rest = files.filter(x => x.id !== a.id)
    void applyOrder([a, ...rest], files)
  }

  const openAttachment = (a: AttachmentView) => {
    if (isVisual(a) && a.url) setLightbox({ url: a.url, kind: a.mediaType as 'IMAGE' | 'VIDEO', caption: a.caption })
    else if (a.url) openExternal(a.url)
  }

  if (question.loading || list.loading) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Attachments" />
        <QnaSkeletons kind="attachmentGrid" count={2} />
      </Screen>
    )
  }

  if (refused || !canManage) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Attachments" />
        <QnaRefusal
          title="You can only manage files on your own answer."
          onBack={() => (router.canGoBack() ? router.back() : router.replace(qnaHref.question(id)))}
        />
      </Screen>
    )
  }

  if (list.error) {
    return (
      <Screen background="sunken" edges={['top']}>
        <Header back title="Attachments" />
        <QnaErrorView error={list.error} onRetry={list.reload} onBack={() => router.replace(qnaHref.question(id))} />
      </Screen>
    )
  }

  const empty = !files.length && !pending.length

  return (
    <Screen background="sunken" edges={['top']}>
      <Header
        back
        title="Attachments"
        actions={[{ icon: 'add', onPress: () => addMenu.open(), label: 'Add a file' }]}
      />

      {answer ? (
        <View style={[styles.subHeader, { backgroundColor: c.bg, borderBottomColor: c.separator }]}>
          <Avatar uri={answer._author.profileImage} name={answer._author.full} seed={answer._author.id} size={24} />
          <Text variant="footnote" tone="muted" numberOfLines={1} align="auto" style={styles.flex}>{answer.body}</Text>
        </View>
      ) : null}

      <ScreenScroll
        contentContainerStyle={{ paddingTop: space.md, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
      >
        {empty ? (
          <QnaEmptyState
            glyph="attachment"
            title="No files attached"
            body="Add a PDF, an image, or a recording to support this answer."
            actionLabel="Add a file"
            onAction={() => addMenu.open()}
          />
        ) : null}

        {visual.length ? (
          <View style={[styles.grid, { paddingHorizontal: t.layout.screenPadding }]}>
            {visual.map((a, i) => (
              <AttachmentTile
                key={a.id}
                attachment={a}
                index={i}
                editable
                size={104}
                onPress={() => openAttachment(a)}
                onOverflow={() => rowMenu.open(a)}
              />
            ))}
          </View>
        ) : null}

        {others.length ? (
          <View style={{ marginTop: visual.length ? 14 : 0 }}>
            <DraggableRows
              items={others}
              keyOf={a => a.id}
              rowHeight={ROW_HEIGHT}
              onReorder={reorderOthers}
              renderItem={(a, i) => (
                <View style={{ height: ROW_HEIGHT, justifyContent: 'center', backgroundColor: c.bg }}>
                  <AttachmentRow
                    attachment={a}
                    index={visual.length + i}
                    editable
                    onPress={() => openAttachment(a)}
                    onOverflow={() => rowMenu.open(a)}
                  />
                </View>
              )}
            />
            <Text variant="footnote" tone="faint" align="center" style={{ marginTop: space.md }}>
              Long-press a file to reorder it.
            </Text>
          </View>
        ) : null}

        {pending.map(p => (
          <View key={p.key} style={[styles.pendingRow, { backgroundColor: c.bg, borderTopColor: c.separator }]}>
            <View style={[styles.pendingBadge, { backgroundColor: c.surfaceSunken }]}>
              <Icon name={p.failed ? 'error' : 'upload'} size={18} color={p.failed ? c.danger : c.textMuted} />
            </View>
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" numberOfLines={1} align="auto">{p.name}</Text>
              <Text variant="footnote" tone={p.failed ? 'danger' : 'muted'} numberOfLines={2} align="ui">
                {p.failed ? p.message ?? 'Upload failed'
                  : `Uploading · ${formatBytes(p.size)}${p.pct != null ? ` · ${Math.round(p.pct * 100)}%` : ''}`}
              </Text>
              {p.failed ? (
                <View style={styles.pendingActions}>
                  {/* A gate refusal is terminal — offering Retry would just
                      re-fail with the identical message. */}
                  {p.terminal ? null : (
                    <Touchable onPress={() => void uploadOne(p)} feedback="dim">
                      <Text variant="footnote" tone="accent">Retry</Text>
                    </Touchable>
                  )}
                  <Touchable onPress={() => setPending(prev => prev.filter(x => x.key !== p.key))} feedback="dim">
                    <Text variant="footnote" tone="muted">Remove</Text>
                  </Touchable>
                </View>
              ) : (
                /* uploadX carries a real abort handle now, so Cancel is honest:
                   it stops the request mid-flight and the row disappears. */
                <View style={styles.pendingActions}>
                  <View style={styles.flex}><IndeterminateBar active height={3} /></View>
                  <Touchable onPress={() => p.ctrl?.abort()} feedback="dim" accessibilityLabel={`Cancel uploading ${p.name}`}>
                    <Text variant="footnote" tone="muted">Cancel</Text>
                  </Touchable>
                </View>
              )}
            </View>
          </View>
        ))}
      </ScreenScroll>

      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />

      <ActionSheet
        visible={addMenu.visible}
        onClose={addMenu.close}
        title="Add a file"
        actions={[
          { label: 'Photo or video', icon: 'gallery', onPress: () => void pickMedia(false) },
          { label: 'Document', icon: 'file', onPress: () => void pickDocument() },
          { label: 'Camera', icon: 'camera', onPress: () => void pickMedia(true) },
        ]}
      />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.name}
        actions={[
          {
            label: 'Edit caption',
            icon: 'edit',
            onPress: () => {
              const a = rowMenu.payload
              if (!a) return
              setCaptionDraft(a.caption)
              captionSheet.open(a)
            },
          },
          { label: 'Move to front', icon: 'up', onPress: () => rowMenu.payload && moveToFront(rowMenu.payload) },
          {
            label: 'Share',
            icon: 'share',
            onPress: async () => {
              const a = rowMenu.payload
              if (!a?.url) return
              try {
                /* shareAsync takes a FILE uri — the remote url never opens a sheet. */
                if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(await toLocalFile(a.url, a.name))
                else openExternal(a.url)
              } catch { toast.warn('Could not share this file.') }
            },
          },
          { label: 'Delete', icon: 'trash', destructive: true, onPress: () => rowMenu.payload && confirmDelete.open(rowMenu.payload) },
        ]}
      />

      <Sheet
        visible={captionSheet.visible}
        onClose={captionSheet.close}
        title="Caption"
        scrollable={false}
        footer={
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="secondary" size="lg" onPress={captionSheet.close} style={styles.flex} />
            <Button label="Save" size="lg" loading={busy} onPress={() => void saveCaption()} style={styles.flex} />
          </View>
        }
      >
        <View style={{ padding: t.layout.screenPadding }}>
          <Field
            value={captionDraft}
            onChangeText={setCaptionDraft}
            placeholder="What this file shows"
            hint="Leave blank to remove the caption."
            multiline
            minHeight={96}
            maxLength={500}
            autoFocus
            editable={!busy}
          />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this file?"
        message="The file is removed from storage as well."
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 72,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingBadge: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pendingActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs2 },
  sheetActions: { flexDirection: 'row', gap: space.sm2 },
})
