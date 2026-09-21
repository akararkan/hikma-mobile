/* =========================================================
   Media, links and docs.

   Backed by the `media_by_conversation` index rather than a
   timeline scan, so this stays cheap on a channel with fifty
   thousand posts. Its cursor is `before` — the oldest loaded
   message id — and it answers a BARE ARRAY, so an empty page is
   the only end-of-list signal there is.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, cmpId } from '@/api'
import { useConversation } from '@/context/ChatContext'
import { toLocalFile } from '@/lib/localFile'
import { usePaged } from '@/hooks/usePaged'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, EmptyState, Header, Icon, ListFooter, Screen, SegmentedControl,
  Text, Touchable, toast, useSheetState,
} from '@/ui'
import { FileTile, LinkRow } from '@/components/chat/Payloads'
import { VoiceNote } from '@/components/chat/VoiceNote'
import { durationLabel, rowTime } from '@/components/chat/format'
import { ChatErrorState, MediaGridSkeleton } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

type Tab = 'MEDIA' | 'FILE' | 'LINK' | 'VOICE'

const TABS: { value: Tab; label: string }[] = [
  { value: 'MEDIA', label: 'Media' },
  { value: 'FILE', label: 'Docs' },
  { value: 'LINK', label: 'Links' },
  { value: 'VOICE', label: 'Voice' },
]

const URL_RE = /https?:\/\/\S+/i

const keyExtractor = (item: any) => String(item.id)

export default function MediaGalleryScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  /* The live row, subscribed per-key — the header title reads it, and a
     render-time getConvo() would go permanently stale now that this screen no
     longer re-renders on inbox churn. */
  const convo = useConversation(convId)
  const dir = useUserDirectory()
  const menu = useSheetState<any>()
  const [tab, setTab] = React.useState<Tab>('MEDIA')

  const list = usePaged<any>(
    async ({ cursor }) => {
      /* `kind` is REQUIRED by the gallery route (@RequestParam String kind —
         omitting it answers 400 MISSING_PARAMETER, live-verified), and it takes
         exactly one value. The Media tab therefore merges the IMAGE and VIDEO
         indexes: one request per kind, each with its OWN before-cursor (encoded
         "img|vid"; 'done' marks an exhausted kind), rows merged newest-first by
         snowflake id. An album carrying both kinds returns the same message
         from both queries — deduped by id below. */
      if (tab === 'MEDIA') {
        const [imgCur, vidCur] = cursor ? String(cursor).split('|') : ['', '']
        const [imgs, vids]: any[][] = await Promise.all([
          imgCur === 'done' ? Promise.resolve([]) : api.chat.messages.media(convId, { kind: 'IMAGE', before: imgCur || undefined, limit: 40 } as any),
          vidCur === 'done' ? Promise.resolve([]) : api.chat.messages.media(convId, { kind: 'VIDEO', before: vidCur || undefined, limit: 40 } as any),
        ])
        const seen = new Set<string>()
        const merged = [...imgs, ...vids]
          .filter(m => { const k = String(m.id); if (seen.has(k)) return false; seen.add(k); return true })
          .sort((a, b) => cmpId(String(b.id), String(a.id)))
        const nextImg = imgs.length ? String(imgs[imgs.length - 1].id) : 'done'
        const nextVid = vids.length ? String(vids[vids.length - 1].id) : 'done'
        return {
          items: merged,
          /* Both kinds empty = end of list (bare-array contract: an empty page
             is the only end signal). */
          nextCursor: imgs.length || vids.length ? `${nextImg}|${nextVid}` : null,
        }
      }
      const rows: any[] = await api.chat.messages.media(convId, {
        kind: tab,
        before: cursor || undefined,
        limit: 40,
      } as any)
      return {
        items: rows,
        /* The cursor IS the oldest row's id; an empty page ends the list. */
        nextCursor: rows.length ? String(rows[rows.length - 1].id) : null,
      }
    },
    { mode: 'cursor', pageSize: 40, deps: [convId, tab] },
  )

  const rows = React.useMemo(() => {
    if (tab === 'MEDIA') {
      return list.items.filter(m => (m.media || []).some((x: any) => x.kind === 'IMAGE' || x.kind === 'VIDEO'))
    }
    return list.items
  }, [list.items, tab])

  React.useEffect(() => { dir.watchUsers(rows.map(m => m.senderId)) }, [rows, dir])

  const cell = Math.floor((width - 4) / 3)

  /* Identity-stable, item-first handlers, so renderItem below survives a page
     landing — FlashList compares it by reference and re-invokes every mounted
     cell when it moves. */
  const openMessage = useEvent((message: any) => router.replace(`/chat/${convId}?jump=${message.id}`))
  const openViewer = useEvent((message: any) => router.push(`/chat/${convId}/viewer?messageId=${message.id}&index=0`))
  const openMenu = useEvent((message: any) => menu.open(message))
  const openFile = useEvent(async (file: any) => {
    if (!file?.url) return
    try {
      if (!(await Sharing.isAvailableAsync())) { toast.warn('Sharing is not available on this device.'); return }
      /* shareAsync takes a FILE uri — the remote url never opens a sheet. */
      await Sharing.shareAsync(await toLocalFile(file.url, file.name))
    } catch { toast.warn('Could not open this file.') }
  })

  const renderItem = React.useCallback(({ item }: { item: any }) => {
    if (tab === 'MEDIA') {
      const first = (item.media || []).find((m: any) => m.kind === 'IMAGE' || m.kind === 'VIDEO')
      const album = (item.media || []).length > 1
      return (
        <Touchable
          onPress={() => openViewer(item)}
          onLongPress={() => openMenu(item)}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel={first?.altText || 'Attachment'}
          style={[styles.cell, { width: cell, height: cell, backgroundColor: c.surfaceSunken }]}
        >
          {first?.thumbnailUrl || first?.url ? (
            <Image
              source={{ uri: first.thumbnailUrl || first.url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={String(item.id)}
            />
          ) : (
            /* A 404 MEDIA_NOT_FOUND is a broken tile, never a page error. */
            <View style={styles.center}><Icon name="image" size={18} color={c.textFaint} /></View>
          )}
          {first?.kind === 'VIDEO' ? (
            <>
              <View style={styles.playBadge}><Icon name="play" size={14} color={c.overlayText} filled /></View>
              {first.durationMs ? (
                <View style={[styles.durationChip, { backgroundColor: c.overlayChip }]}>
                  <Text variant="micro" color={c.overlayText}>{durationLabel(first.durationMs)}</Text>
                </View>
              ) : null}
            </>
          ) : null}
          {album ? (
            <View style={[styles.albumMark, { backgroundColor: c.overlayChip }]}>
              <Icon name="gallery" size={11} color={c.overlayText} />
            </View>
          ) : null}
        </Touchable>
      )
    }

    if (tab === 'FILE') {
      const file = (item.media || [])[0]
      return (
        <Touchable
          onPress={() => { void openFile(file) }}
          onLongPress={() => openMenu(item)}
          feedback="tint"
          noAutoHitSlop
          style={[styles.row, { borderBottomColor: c.separator }]}
        >
          <FileTile media={file} fg={c.text} fgMuted={c.textMuted} />
        </Touchable>
      )
    }

    if (tab === 'LINK') {
      const url = URL_RE.exec(item.body || '')?.[0] || ''
      if (!url) return null
      return (
        <LinkRow
          url={url}
          body={item.body}
          time={item.time}
          onPress={() => { void WebBrowser.openBrowserAsync(url) }}
        />
      )
    }

    const voice = (item.media || []).find((m: any) => m.kind === 'VOICE')
    if (!voice) return null
    const card = dir.userOf(item.senderId)
    return (
      <Touchable
        onLongPress={() => openMenu(item)}
        feedback="none"
        noAutoHitSlop
        style={[styles.voiceRow, { borderBottomColor: c.separator }]}
      >
        <Avatar uri={card?.profileImage} name={item.sender?.full} seed={item.senderId} size={32} />
        <View style={styles.flex}>
          <VoiceNote media={voice} messageId={String(item.id)} compact />
          <Text variant="micro" tone="faint" align="ui" style={{ marginTop: space.xxs }}>
            {item.sender?.full || 'Member'} · {rowTime(item.createdAt)}
          </Text>
        </View>
      </Touchable>
    )
  }, [tab, cell, c, dir, openViewer, openMenu, openFile])

  return (
    <Screen>
      <Header
        back
        title={convo?.displayTitle ?? 'Media'}
        subtitle="Media, links and docs"
        below={<SegmentedControl options={TABS} value={tab} onChange={setTab} variant="underline" />}
      />

      {list.loading ? (
        tab === 'MEDIA' ? <MediaGridSkeleton /> : <MediaGridSkeleton count={6} />
      ) : list.error ? (
        <ChatErrorState error={list.error} title="Could not load media" onRetry={list.reload} />
      ) : (
        <FlashList
          key={tab}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={tab === 'MEDIA' ? 3 : 1}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          /* The grid's cells are square thirds of the screen — roughly 130pt
             each — so the platform's 250px default prepares under two rows.
             600 keeps a fling ahead of the render stack without decoding an
             unreasonable number of thumbnails up front. */
          drawDistance={tab === 'MEDIA' ? 600 : undefined}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <EmptyState
              icon={tab === 'MEDIA' ? 'gallery' : tab === 'FILE' ? 'file' : tab === 'LINK' ? 'link' : 'mic'}
              title={
                tab === 'MEDIA' ? 'No media yet'
                  : tab === 'FILE' ? 'No documents yet'
                    : tab === 'LINK' ? 'No links yet' : 'No voice messages yet'
              }
              message="Attachments shared in this chat will appear here."
            />
          }
          ListFooterComponent={rows.length ? <ListFooter loading={list.loadingMore} done={list.done} doneLabel="" /> : null}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          { label: 'Jump to message', icon: 'forward', onPress: () => { if (menu.payload) openMessage(menu.payload) } },
          {
            label: 'Forward',
            icon: 'forwardMsg',
            onPress: () => { if (menu.payload) router.push(`/chat/forward?messageId=${menu.payload.id}`) },
          },
          {
            label: 'Delete for me',
            icon: 'trash',
            destructive: true,
            onPress: () => {
              const m = menu.payload
              if (!m) return
              list.remove(String(m.id))
              api.chat.messages.remove(m.id, 'me').catch(() => { void list.reload() })
            },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  cell: { margin: space.xxs, overflow: 'hidden' },
  center: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', top: 6, start: 6 },
  /* Text-bearing overlay chip — chip setback on a solid overlayChip plate. */
  durationChip: {
    position: 'absolute', bottom: 5, start: 5, paddingHorizontal: space.xs2, paddingVertical: space.xxs,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  albumMark: {
    position: 'absolute', top: 5, end: 5, padding: space.xs,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  row: { paddingHorizontal: space.lg, paddingVertical: space.md2, borderBottomWidth: StyleSheet.hairlineWidth },
  voiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
})
