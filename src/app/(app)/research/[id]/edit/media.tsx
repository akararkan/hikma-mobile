/* =========================================================
   Media & cover.

   Cover and promo uploads both answer with the FULL paper, so
   the whole screen re-seeds from the response rather than
   patching a field — and their optimistic-lock conflicts are
   retried server-side, which is why there is no 409 handling
   here.

   Reordering commits one `editMedia` call per moved row: there
   is no bulk-order endpoint.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
/* downloadAsync/cacheDirectory are the LEGACY expo-file-system surface (SDK 57
   moved the root export to File/Directory/Paths — AGENTS.md). */
import * as FileSystem from 'expo-file-system/legacy'
import { adapters, api, codeOf, detailsOf, errorText, session, traceRef } from '@/api'
import { toUploadFile } from '@/platform/files'
import { compressToTier, prepareUpload } from '@/lib/mediaTier'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Field, Header, Icon, Screen, Skeleton, Spinner,
  Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ResearchCover } from '@/components/research/ResearchCover'
import { ErrorPanel, RefusalState } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { extOf, fileTint, formatBytes, formatDuration } from '@/components/research/format'
import type { MediaFile, ResearchDetail } from '@/components/research/types'

export default function EditMediaScreen() {
  const t = useTheme()
  const c = t.colors
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, error, loading, reload, patch } = useResearchDetail(id, { subscribe: false, recordView: false })

  const [busy, setBusy] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<{ tone: 'warning' | 'danger'; text: string } | null>(null)
  const [rows, setRows] = React.useState<MediaFile[]>([])
  const removeCover = useSheetState()
  const removePromo = useSheetState()
  const removeFile = useSheetState<MediaFile>()

  React.useEffect(() => {
    if (detail) setRows([...detail.mediaFiles].sort((a, b) => a.order - b.order))
  }, [detail])

  const fail = (e: any) => {
    const code = codeOf(e)
    const details = detailsOf(e)
    if (code === 'INVALID_FILE_TYPE') {
      setNotice({
        tone: 'danger',
        text: `${errorText(e)}${details?.receivedType ? ` Received ${details.receivedType}.` : ''}${
          details?.allowedTypes ? ` Allowed: ${[].concat(details.allowedTypes).join(', ')}.` : ''}`,
      })
      return
    }
    if (code === 'FILE_TOO_LARGE') {
      setNotice({ tone: 'danger', text: `${errorText(e)}${details?.maxSize ? ` Maximum ${formatBytes(Number(details.maxSize))}.` : ''}` })
      return
    }
    if (['COVER_UPLOAD_FAILED', 'VIDEO_UPLOAD_FAILED', 'THUMBNAIL_UPLOAD_FAILED', 'MEDIA_UPLOAD_FAILED', 'STORAGE_UNAVAILABLE'].includes(code)) {
      setNotice({ tone: 'warning', text: 'File storage is temporarily unavailable. Nothing was changed — try again shortly.' })
      return
    }
    const ref = traceRef(e)
    setNotice({ tone: 'danger', text: `${errorText(e)}${ref ? ` (ref ${String(ref).slice(0, 8)})` : ''}` })
  }

  const reseed = (raw: any) => {
    const fresh = adapters.researchDetailFrom(raw) as ResearchDetail
    patch(() => fresh)
    setRows([...fresh.mediaFiles].sort((a, b) => a.order - b.order))
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setNotice(null)
    try { await fn() } catch (e: any) { fail(e) } finally { setBusy(null) }
  }

  const pickCover = () => run('cover', async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    /* `quality` re-encodes but never resizes; the cover is a card image on
       every research row, so it takes the tightest tier unconditionally. */
    reseed(await api.research.uploadCover(id, toUploadFile(await compressToTier(asset, 'DATA_SAVER'))))
    toast.ok('Cover updated')
  })

  const pickPromo = (withThumb: boolean) => run('promo', async () => {
    const fd = new FormData()
    if (withThumb) {
      const thumb = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
      const asset = thumb.canceled ? null : thumb.assets?.[0]
      if (!asset || !detail?.videoPromoUrl) return
      /* The endpoint always wants the video part; sending a thumbnail alone is
         not a supported shape, so the existing video has to be re-sent. RN
         FormData only streams LOCAL file:// URIs — a remote https part uploads
         empty — so the current promo is pulled into cache first (Bearer header
         included: media can sit behind auth). */
      const local = `${FileSystem.cacheDirectory}promo-resend-${id}.mp4`
      const token = session.getToken()
      await FileSystem.downloadAsync(detail.videoPromoUrl, local, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      fd.append('video', toUploadFile({ uri: local, name: 'promo.mp4', mimeType: 'video/mp4' }) as any)
      fd.append('thumbnail', toUploadFile(await prepareUpload(asset)) as any)
    } else {
      const video = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] })
      const asset = video.canceled ? null : video.assets?.[0]
      if (!asset) return
      fd.append('video', toUploadFile(asset) as any)
    }
    reseed(await api.research.uploadVideoPromo(id, fd))
    toast.ok('Promo video updated')
  })

  const addFile = () => run('add', async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.[0]) return
    const fd = new FormData()
    fd.append('file', toUploadFile(res.assets[0]) as any)
    /* caption / altText / displayOrder travel as QUERY params here, not fields. */
    await api.research.addMedia(id, fd, { caption: '', altText: '', displayOrder: rows.length })
    await reload()
    toast.ok('File added')
  })

  const commitMeta = (file: MediaFile, patchBody: { caption?: string; altText?: string; displayOrder?: number }) =>
    run(`meta:${file.id}`, async () => { await api.research.editMedia(id, file.id, patchBody) })

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    setRows(next)
    /* One call per moved row — the two that swapped. */
    void run('reorder', async () => {
      await api.research.editMedia(id, next[index].id, { displayOrder: index })
      await api.research.editMedia(id, next[target].id, { displayOrder: target })
    })
  }

  const drop = (file: MediaFile) => run('delete', async () => {
    await api.research.deleteMedia(id, file.id)
    setRows(prev => prev.filter(r => r.id !== file.id))
    removeFile.close()
    await reload()
  })

  if (error?.status === 403) {
    return (
      <Screen><Header back title="Media & cover" /><RefusalState title="You do not own this paper." body="Only the corresponding researcher can manage its media." /></Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Media & cover" />

      {loading ? (
        <View style={{ padding: space.lg, gap: space.lg }}>
          <Skeleton height={180} radius={14} />
          <Skeleton height={180} radius={14} />
          {[0, 1, 2].map(i => <Skeleton key={i} height={64} radius={12} />)}
        </View>
      ) : error ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={styles.body} bottomOffset={40} keyboardShouldPersistTaps="handled">
          {notice ? <Callout tone={notice.tone} style={{ marginBottom: space.lg }}>{notice.text}</Callout> : null}

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text variant="title3" align="ui">Cover image</Text>
            {detail?.coverImageUrl ? (
              <View style={{ marginTop: space.md }}>
                <ResearchCover uri={detail.coverImageUrl} radius={t.radius.md} />
                {busy === 'cover' ? <View style={styles.overlay}><Spinner /></View> : null}
                <View style={styles.buttonRow}>
                  <Button label="Replace" size="sm" variant="secondary" onPress={pickCover} disabled={!!busy} />
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => removeCover.open()} disabled={!!busy} />
                </View>
              </View>
            ) : (
              <Touchable onPress={pickCover} feedback="dim" style={[styles.dropzone, { borderColor: c.borderStrong }]}>
                <Icon name="image" size={26} color={c.textFaint} />
                <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.sm }}>Add a cover</Text>
                <Text variant="caption" tone="faint" align="center">Shown on feed cards. JPG, PNG, WebP or GIF.</Text>
              </Touchable>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text variant="title3" align="ui">Promo video</Text>
            {detail?.videoPromoUrl ? (
              <View style={{ marginTop: space.md }}>
                <ResearchCover uri={detail.videoPromoThumb} irc={detail.irc} radius={t.radius.md}>
                  <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
                    <Icon name="play" size={22} color={c.overlayText} filled />
                  </View>
                  {detail.videoPromoDuration ? (
                    <View style={[styles.durationPill, { backgroundColor: c.overlayChip }]}>
                      <Text variant="micro" color={c.overlayText}>{formatDuration(detail.videoPromoDuration)}</Text>
                    </View>
                  ) : null}
                </ResearchCover>
                <View style={styles.buttonRow}>
                  <Button label="Replace video" size="sm" variant="secondary" onPress={() => pickPromo(false)} disabled={!!busy} />
                  <Button label="Set thumbnail" size="sm" variant="secondary" onPress={() => pickPromo(true)} disabled={!!busy} />
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => removePromo.open()} disabled={!!busy} />
                </View>
                <Text variant="caption" tone="warning" align="ui" style={{ marginTop: space.sm }}>
                  Uploading a video without a thumbnail clears the current one.
                </Text>
              </View>
            ) : (
              <Touchable onPress={() => pickPromo(false)} feedback="dim" style={[styles.dropzone, { borderColor: c.borderStrong }]}>
                <Icon name="video" size={26} color={c.textFaint} />
                <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.sm }}>Add a promo video</Text>
                <Text variant="caption" tone="faint" align="center">MP4, WebM or MOV. Duration is read from the file.</Text>
              </Touchable>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text variant="title3" align="ui">Media files ({rows.length})</Text>
            {!rows.length ? (
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.sm }}>
                Attach the PDF, datasets, code or figures readers should be able to download.
              </Text>
            ) : null}

            {rows.map((file, i) => {
              const tint = fileTint(c, file.type)
              return (
                <View key={file.id} style={[styles.fileRow, { borderTopColor: c.separator }]}>
                  <View style={styles.fileHead}>
                    <View style={[styles.fileTile, { backgroundColor: tint.bg }]}>
                      <Text variant="micro" color={tint.fg}>{extOf(file.name)}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text variant="subhead" align="auto" numberOfLines={2}>{file.name}</Text>
                      <Text variant="caption" tone="muted" align="ui">{formatBytes(file.fileSize)}</Text>
                    </View>
                    <Touchable onPress={() => move(i, -1)} feedback="dim" accessibilityLabel="Move up">
                      <Icon name="up" size={17} color={c.textFaint} />
                    </Touchable>
                    <Touchable onPress={() => move(i, 1)} feedback="dim" accessibilityLabel="Move down">
                      <Icon name="down" size={17} color={c.textFaint} />
                    </Touchable>
                    <Touchable onPress={() => removeFile.open(file)} feedback="dim" accessibilityLabel="Delete file">
                      <Icon name="trash" size={17} color={c.danger} />
                    </Touchable>
                  </View>
                  <Field
                    value={file.caption}
                    onChangeText={v => setRows(prev => prev.map(r => (r.id === file.id ? { ...r, caption: v } : r)))}
                    onBlur={() => commitMeta(file, { caption: file.caption })}
                    placeholder="Caption"
                    maxLength={500}
                    containerStyle={{ marginTop: space.sm2 }}
                  />
                  <Field
                    value={file.altText}
                    onChangeText={v => setRows(prev => prev.map(r => (r.id === file.id ? { ...r, altText: v } : r)))}
                    onBlur={() => commitMeta(file, { altText: file.altText })}
                    placeholder="Alt text"
                    maxLength={255}
                    containerStyle={{ marginTop: space.sm }}
                  />
                  {busy === `meta:${file.id}` ? (
                    <Text variant="caption" tone="accent" align="ui" style={{ marginTop: space.xs2 }}>Saving…</Text>
                  ) : null}
                </View>
              )
            })}

            <Button
              label="Add file"
              icon="add"
              variant="secondary"
              block
              onPress={addFile}
              loading={busy === 'add'}
              disabled={!!busy}
              style={{ marginTop: space.md2 }}
            />
          </View>
        </KeyboardAwareScrollView>
      )}

      <ConfirmSheet
        visible={removeCover.visible}
        onClose={removeCover.close}
        title="Remove the cover?"
        message="The image is deleted from storage immediately."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          removeCover.close()
          void run('cover', async () => { reseed(await api.research.removeCover(id)) })
        }}
      />

      <ConfirmSheet
        visible={removePromo.visible}
        onClose={removePromo.close}
        title="Remove the promo video?"
        message="The video and its thumbnail are deleted from storage immediately."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          removePromo.close()
          void run('promo', async () => { reseed(await api.research.removeVideoPromo(id)) })
        }}
      />

      <ConfirmSheet
        visible={removeFile.visible}
        onClose={removeFile.close}
        title="Delete this file?"
        message="It is removed from the paper and deleted from storage."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (removeFile.payload) void drop(removeFile.payload) }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 60, gap: space.md2 },
  card: { borderRadius: 16, padding: space.lg },
  dropzone: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, marginTop: space.md,
    aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', padding: space.lg,
  },
  buttonRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm2, flexWrap: 'wrap' },
  overlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  /* Icon-only round badge — a sanctioned circle; logical start/marginStart so
     the centring survives RTL. */
  playBadge: {
    position: 'absolute', top: '50%', start: '50%', marginTop: -22, marginStart: -22,
    width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  durationPill: { position: 'absolute', bottom: 8, end: 8, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 6 },
  fileRow: { paddingTop: space.md2, marginTop: space.md2, borderTopWidth: StyleSheet.hairlineWidth },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  fileTile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
})
