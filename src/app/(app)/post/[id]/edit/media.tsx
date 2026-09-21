/* =========================================================
   Album editor.

   The carousel rows behind api.posts.media (post/media.md) —
   listing is public, every mutation is author-only, and the
   contract's four verbs shape everything here:

     add       POST appends ONE row — and it takes a URL, not
               bytes, so the file goes through the media
               pipeline first (upload-intent → presigned PUT →
               complete) and only its finished address lands in
               the album.
     remove    DELETE addresses the full Cassandra primary key
               (postId, sortOrder, mediaId). sortOrder is not
               decoration — the row cannot be found without it.
     reorder   ONE PUT replaceAll with the full desired list.
               sortOrder is a clustering key, so the server
               bulk-deletes and re-inserts, numbering from the
               ARRAY INDEX; the response is the fresh read and
               reseeds local state.
     alt text  also replaceAll — the contract has no per-row
               PATCH, and the PUT explicitly wants the whole
               desired state rather than a diff.

   Rows stay RAW (api/posts.js explains why): replaceAll
   round-trips them verbatim, so URLs are absolutized with
   assetUrl at render time only, never in state.

   Posts published with four or fewer attachments usually carry
   them inline on the post itself and have NO carousel rows —
   the inline callout below is that case, not a bug.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { api, assetUrl, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { prepareUploads, type PickedAsset } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, ConfirmSheet, EmptyState, ErrorState, Field, Header,
  Icon, Screen, Sheet, Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { DraggableRows, moveItem } from '@/components/qna/DraggableRows'
import type { PostView } from '@/components/feed/types'

/* Not a server contract — media.md sets no hard cap; its replaceAll cost note
   ("carousels rarely exceed 20 items") is the number the client honours. */
const MAX_ALBUM = 20
const ROW_HEIGHT = 72

/** One raw `media_by_post` row, exactly as the list endpoint returns it. */
interface AlbumRow {
  postId: string
  sortOrder: number
  mediaId: string
  mediaType: string
  url: string
  thumbnailUrl: string | null
  s3Key: string | null
  durationSeconds: number | null
  fileSizeBytes: number | null
  mimeType: string | null
  altText: string | null
}

const mmss = (s: number) => {
  const sec = Math.max(0, Math.round(s))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function rowLabel(row: AlbumRow): string {
  const kind = row.mediaType === 'VIDEO' ? 'Video' : row.mediaType === 'AUDIO' ? 'Audio' : 'Photo'
  return row.durationSeconds ? `${kind} · ${mmss(row.durationSeconds)}` : kind
}

export default function EditAlbumScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  /* The post row is here for the ownership belt; the album is its own read —
     inline attachments on the post and carousel rows are different tables. */
  const post = useAsync<PostView>(() => api.posts.get(id), { enabled: !!id, deps: [id] })
  const album = useAsync<AlbumRow[]>(() => api.posts.media.list(id), { enabled: !!id, deps: [id] })

  const [rows, setRows] = React.useState<AlbumRow[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  /* "2 of 5 · 43%" while the add loop runs — api.media.upload's real byte
     counter, previously thrown away. */
  const [addProg, setAddProg] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [altDraft, setAltDraft] = React.useState('')
  const rowMenu = useSheetState<AlbumRow>()
  const altSheet = useSheetState<AlbumRow>()
  const confirmRemove = useSheetState<AlbumRow>()

  React.useEffect(() => { if (album.data) setRows(album.data) }, [album.data])

  /* api.media.upload's failures carry a STRING .status (FAILED_* / TIMEOUT),
     MEDIA_TOO_LARGE a .code, and the refusal below neither — no HTTP envelope
     any of them, which errorText can only misread as the offline copy while
     the server is perfectly reachable (platform/files.js documents the same
     trap). Their .message IS the user-facing copy, so it wins; real API
     errors keep errorText's display policy. */
  const noticeOf = (e: any): string =>
    (typeof e?.status === 'string' || e?.code === 'MEDIA_TOO_LARGE') && e?.message ? e.message : errorText(e)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setNotice(null)
    try { await fn() } catch (e: any) { setNotice(noticeOf(e)) } finally { setBusy(null) }
  }

  /** replaceAll answers with the fresh ordered read — it IS the new state. */
  const reseed = (fresh: AlbumRow[]) => {
    setRows(fresh)
    album.setData(fresh)
  }

  const add = () => run('add', async () => {
    const remaining = MAX_ALBUM - rows.length
    if (remaining <= 0) return
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    })
    if (res.canceled || !res.assets?.length) return

    /* prepareUploads honours the user's media tier — downscaling before the
       bytes leave, not after the server has paid for them. */
    const ready = await prepareUploads(res.assets as unknown as PickedAsset[])
    let placed = 0
    const batch = ready.slice(0, remaining)
    try {
    for (let bi = 0; bi < batch.length; bi++) {
      const asset = batch[bi]
      const file = toUploadFile(asset)
      const kind = String(file.type || '').startsWith('video') ? 'VIDEO' : 'IMAGE'
      setAddProg(`${bi + 1} of ${batch.length}`)
      const uploaded: any = await api.media.upload(file, {
        type: kind,
        onProgress: (f: number) => setAddProg(`${bi + 1} of ${batch.length} · ${Math.round(f * 100)}%`),
      })

      /* MediaStatusResponse does not document which of its keys carries the
         public URL (the composer's header explains why it refuses to guess at
         create time). The rendition rows DO carry `url` in the data model, so
         it is read defensively here — and when nothing URL-shaped comes back
         the add REFUSES loudly instead of writing a row that renders blank. */
      const renditions: any[] = uploaded?.renditions || []
      const main = renditions.find(r => r?.label === 'original') || renditions[0]
      const url = main?.url || uploaded?.url
      if (!url) {
        const refusal: any = new Error(placed
          ? `${placed} added — then an upload finished without a usable URL, so the rest were not written.`
          : 'The upload finished, but the server did not name a public URL for it — nothing was added to the album.')
        refusal.status = 'NO_PUBLIC_URL'   // string status → noticeOf shows this message verbatim
        throw refusal
      }

      const durationMs = uploaded?.durationMs ?? (typeof (asset as any).duration === 'number' ? (asset as any).duration : null)
      /* The row endpoint wants the file's address, not its bytes — url is the
         only required storage field; s3Key merely enables later cleanup. */
      const created: AlbumRow = await api.posts.media.add(id, {
        sortOrder: rows.length + placed,
        mediaType: kind,
        url,
        thumbnailUrl: kind === 'VIDEO'
          ? renditions.find(r => String(r?.mime || '').startsWith('image/'))?.url || undefined
          : undefined,
        s3Key: main?.objectKey || main?.object_key || main?.key || undefined,
        durationSeconds: durationMs ? Math.round(durationMs / 1000) : undefined,
        fileSizeBytes: uploaded?.storedBytes || (asset as any).fileSize || undefined,
        mimeType: file.type || undefined,
      })
      /* The server generated the mediaId — append its row, not our guess. */
      setRows(prev => [...prev, created])
      album.setData(prev => [...(prev || []), created])
      placed++
    }
    } finally { setAddProg(null) }
    if (placed) toast.ok(placed === 1 ? 'Added to the album' : `${placed} added to the album`)
  })

  const remove = (row: AlbumRow) => run('remove', async () => {
    /* sortOrder rides along because (postId, sortOrder, mediaId) is the full
       primary key — and it is server-truthful here: every reorder reseeds from
       the PUT response, every add appends the created row. */
    await api.posts.media.remove(id, row.mediaId, row.sortOrder)
    const next = rows.filter(r => r.mediaId !== row.mediaId)
    setRows(next)
    album.setData(next)
    confirmRemove.close()
  })

  const reorder = (from: number, to: number) => {
    const before = rows
    const next = moveItem(rows, from, to)
    setRows(next)
    void run('reorder', async () => {
      try {
        /* One PUT for the whole move — the server renumbers from array index. */
        reseed(await api.posts.media.replaceAll(id, next))
      } catch (e) {
        setRows(before)
        throw e
      }
    })
  }

  const saveAlt = () => {
    const target = altSheet.payload
    if (!target) return
    void run('alt', async () => {
      /* No per-row PATCH exists — alt text commits through replaceAll, which
         wants the full desired state, not a diff. */
      const next = rows.map(r => (r.mediaId === target.mediaId ? { ...r, altText: altDraft.trim() || null } : r))
      reseed(await api.posts.media.replaceAll(id, next))
      altSheet.close()
    })
  }

  if (post.error && isNotFound(post.error)) {
    return (
      <Screen>
        <Header back title="Album" />
        <EmptyState
          icon="search"
          title="This post is no longer available"
          message="It may have been deleted."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  /* The entry point already gates on ownership; this is the belt for the deep
     link that slipped through — every mutation is author-only (media.md). */
  const notAuthor = !!post.data && !!user?.id && String(post.data.author) !== String(user.id)
  if (notAuthor) {
    return (
      <Screen>
        <Header back title="Album" />
        <EmptyState
          icon="lock"
          title="You can’t edit this album"
          message="Only the post’s author can manage its media."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  const loading = post.loading || album.loading
  const inlineOnly = !loading && !album.error && !rows.length && !!post.data?.media?.length
  const full = rows.length >= MAX_ALBUM

  return (
    <Screen>
      <Header back title="Album" />

      {loading ? (
        <View style={styles.skeleton}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={ROW_HEIGHT - 12} radius={12} />)}
        </View>
      ) : album.error ? (
        <ErrorState error={album.error} onRetry={() => { void album.reload() }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {notice ? <Callout tone="danger" style={styles.note}>{notice}</Callout> : null}

          {inlineOnly ? (
            <Callout tone="warning" style={styles.note}>
              This post’s attachments were published inline — four or fewer ride on the post itself
              and are not album rows, so they can’t be reordered or removed here. Anything you add
              below starts the post’s album.
            </Callout>
          ) : null}

          {rows.length ? (
            <>
              <DraggableRows
                items={rows}
                keyOf={r => r.mediaId}
                rowHeight={ROW_HEIGHT}
                onReorder={reorder}
                disabled={!!busy}
                renderItem={(row, i) => (
                  <View style={{ height: ROW_HEIGHT, justifyContent: 'center', backgroundColor: c.bg }}>
                    <View style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }]}>
                      <RowThumb row={row} />
                      <View style={styles.flex}>
                        <Text variant="subhead" weight="600" numberOfLines={1}>{rowLabel(row)}</Text>
                        <Text variant="footnote" tone={row.altText ? 'muted' : 'faint'} numberOfLines={1} align="ui">
                          {row.altText || 'No alt text'}
                        </Text>
                      </View>
                      <Touchable
                        onPress={() => rowMenu.open(row)}
                        feedback="dim"
                        accessibilityLabel="More"
                        style={styles.moreBtn}
                      >
                        <Icon name="more" size={18} color={c.textMuted} />
                      </Touchable>
                    </View>
                  </View>
                )}
              />
              <Text variant="footnote" tone="faint" align="center" style={styles.hint}>
                Long-press an item to reorder it.
              </Text>
            </>
          ) : (
            <Touchable onPress={add} feedback="dim" disabled={!!busy} style={[styles.dropzone, { borderColor: c.borderStrong }]}>
              <Icon name="gallery" size={26} color={c.textFaint} />
              <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.sm }}>Add photos or videos</Text>
              <Text variant="caption" tone="faint" align="center">They appear on the post in the order below.</Text>
            </Touchable>
          )}

          {busy === 'add' && addProg ? (
            <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.sm2 }}>
              Uploading {addProg}
            </Text>
          ) : null}
          <Button
            label={full ? `Album is full (${MAX_ALBUM})` : 'Add media'}
            icon="add"
            variant="secondary"
            block
            onPress={add}
            loading={busy === 'add'}
            disabled={!!busy || full}
            style={{ marginTop: space.md2 }}
          />
        </ScrollView>
      )}

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        actions={[
          {
            label: 'Edit alt text',
            icon: 'edit',
            onPress: () => {
              const row = rowMenu.payload
              if (!row) return
              setAltDraft(row.altText || '')
              altSheet.open(row)
            },
          },
          {
            label: 'Remove from album',
            icon: 'trash',
            destructive: true,
            onPress: () => { if (rowMenu.payload) confirmRemove.open(rowMenu.payload) },
          },
        ]}
      />

      <Sheet visible={altSheet.visible} onClose={altSheet.close} title="Alt text">
        <View style={styles.altBody}>
          <Field
            value={altDraft}
            onChangeText={setAltDraft}
            placeholder="Describe this for people using a screen reader"
            maxLength={255}
            multiline
            minHeight={80}
          />
          <Button label="Save" block loading={busy === 'alt'} disabled={!!busy} onPress={saveAlt} />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmRemove.visible}
        onClose={confirmRemove.close}
        title="Remove this from the album?"
        message="The post loses it immediately, for everyone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (confirmRemove.payload) void remove(confirmRemove.payload) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One thumbnail. Videos prefer their poster; a video with no
   poster and audio get an icon tile — never a broken <Image>.
   URLs absolutize HERE, at render, so state stays raw.
   --------------------------------------------------------- */

function RowThumb({ row }: { row: AlbumRow }) {
  const t = useTheme()
  const c = t.colors
  const uri = row.mediaType === 'VIDEO'
    ? (row.thumbnailUrl ? assetUrl(row.thumbnailUrl) : null)
    : assetUrl(row.thumbnailUrl || row.url)

  return (
    <View style={[styles.thumb, { borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : null}
      {row.mediaType !== 'IMAGE' ? (
        <View style={[styles.playChip, { backgroundColor: c.overlayChip }]}>
          <Icon name="play" size={12} color={c.overlayText} filled />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeleton: { padding: space.lg, gap: space.md },
  body: { padding: space.lg, paddingBottom: 60 },
  note: { marginBottom: space.md2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: ROW_HEIGHT, paddingEnd: space.xxs },
  thumb: { width: 52, height: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playChip: {
    position: 'absolute', bottom: 4, end: 4, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  moreBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: space.md },
  dropzone: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14,
    aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', padding: space.lg,
  },
  altBody: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md },
})
