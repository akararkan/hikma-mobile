/* =========================================================
   The shared-media gallery.

   Backed by the `media_by_conversation` index rather than a
   timeline scan, so it stays cheap on a channel with fifty
   thousand posts. Paging is a `before` message-id cursor —
   the OLDEST row already loaded, kept as a string.

   One adapter quirk to know: `mediaFrom` normalises AUDIO (and
   audio-mime FILE rows) to the client kind 'VOICE', while the
   QUERY parameter stays AUDIO. So the tab sends AUDIO and the
   rows come back saying VOICE, and that is correct.
   ========================================================= */
import React from 'react'
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { RemoteImage } from '@/components/media/RemoteImage'
import PagerView from 'react-native-pager-view'
import * as WebBrowser from 'expo-web-browser'
import { useAudioPlayer } from 'expo-audio'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, space } from '@/theme/tokens'
import {
  EmptyState, ErrorState, Header, Icon, IconButton, Screen, SegmentedControl, Skeleton,
  Spinner, Text, Touchable, toast,
} from '@/ui'
import { bytes, clock } from '@/components/channels/MediaAlbum'
import { RefusalCard } from '@/components/channels/states'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const TABS = [
  { value: 'IMAGE', label: 'Photos', grid: true, empty: 'No photos yet' },
  { value: 'VIDEO', label: 'Videos', grid: true, empty: 'No videos yet' },
  { value: 'GIF', label: 'GIFs', grid: true, empty: 'No GIFs yet' },
  { value: 'VOICE', label: 'Voice', grid: false, empty: 'No voice notes yet' },
  { value: 'AUDIO', label: 'Audio', grid: false, empty: 'No audio yet' },
  { value: 'FILE', label: 'Files', grid: false, empty: 'No files yet' },
  { value: 'VIDEO_NOTE', label: 'Round', grid: true, empty: 'No video notes yet' },
  { value: 'LINK', label: 'Links', grid: false, empty: 'No links yet' },
] as const

type Kind = (typeof TABS)[number]['value']

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (m: any) => String(m.id)

export default function ChannelMediaScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { id, kind: initialKind } = useLocalSearchParams<{ id: string; kind?: string }>()

  const [kind, setKind] = React.useState<Kind>(
    (TABS.find(x => x.value === initialKind)?.value ?? 'IMAGE') as Kind,
  )
  const [rows, setRows] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [lightbox, setLightbox] = React.useState<number | null>(null)
  const [playing, setPlaying] = React.useState<string | null>(null)

  const channel = useAsync<any>(() => api.channels.get(id), { enabled: !!id, deps: [id] })
  const tab = TABS.find(x => x.value === kind)!

  const load = React.useCallback(async (mode: 'first' | 'more') => {
    if (!id) return
    if (mode === 'more' && (loadingMore || done)) return
    mode === 'first' ? setLoading(true) : setLoadingMore(true)
    if (mode === 'first') { setError(null); setDone(false) }
    try {
      const before = mode === 'more' && rows.length ? String(rows[rows.length - 1].id) : undefined
      const batch = await api.chat.messages.media(id, args({ kind, before, limit: 60 }))
      setRows(prev => {
        if (mode === 'first') return batch
        const known = new Set(prev.map((r: any) => String(r.id)))
        return [...prev, ...batch.filter((r: any) => !known.has(String(r.id)))]
      })
      setDone(!batch.length || batch.length < 60)
    } catch (e: any) {
      setError(e)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [id, kind, rows, loadingMore, done])

  React.useEffect(() => { setRows([]); void load('first') }, [id, kind])   // eslint-disable-line react-hooks/exhaustive-deps

  const guarded = !!channel.data?.settings?.protectedContent
  const notMember = error?.status === 403

  const cell = (width - 4) / 3

  /* Identity-stable and item-first. `playing` moves on every tap in the voice
     tab, so an inline renderItem would re-render the whole tab with it — the
     row takes the derived `active` boolean instead of the playing id. */
  const openLightbox = useEvent((_m: any, index: number) => setLightbox(index))
  const openPost = useEvent((m: any) => router.push(chRoute.post(id, String(m.id))))
  const openRowTarget = useEvent((m: any) => openRow(m, kind, router, id, guarded))
  const togglePlay = useEvent((mid: string) => setPlaying(p => (p === mid ? null : mid)))
  const isGrid = tab.grid

  const renderItem = React.useCallback(({ item, index }: { item: any; index: number }) => (
    isGrid
      ? <GridCell message={item} index={index} size={cell} onPress={openLightbox} onLongPress={openPost} />
      : (
        <ListCell
          message={item}
          kind={kind}
          guarded={guarded}
          active={playing === String(item.id)}
          onPlay={togglePlay}
          onPress={openRowTarget}
          onLongPress={openPost}
        />
      )
  ), [isGrid, cell, kind, guarded, playing, openLightbox, openPost, openRowTarget, togglePlay])

  if (notMember) {
    return (
      <Screen>
        <Header back title="Media" subtitle={channel.data?.title} />
        <RefusalCard error={error} title="Subscribe to see this channel’s media" icon="lock" />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        title="Media"
        subtitle={channel.data?.title}
        below={
          <SegmentedControl
            variant="underline"
            scrollable
            options={TABS.map(x => ({ value: x.value, label: x.label }))}
            value={kind}
            onChange={v => setKind(v as Kind)}
          />
        }
      />

      {loading ? (
        tab.grid ? (
          <View style={styles.grid}>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} width={cell as any} height={cell} radius={2} style={{ margin: space.xxs }} />
            ))}
          </View>
        ) : (
          <View style={{ padding: space.lg, gap: space.sm2 }}>
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={56} radius={12} />)}
          </View>
        )
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load('first')} />
      ) : (
        <FlashList
          key={kind}
          data={rows}
          numColumns={tab.grid ? 3 : 1}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState icon="gallery" title={tab.empty} message="Media posted to this channel shows up here." />
          }
          ListFooterComponent={loadingMore ? <Spinner /> : <View style={{ height: insets.bottom + 20 }} />}
          onEndReached={() => void load('more')}
          onEndReachedThreshold={0.6}
          contentContainerStyle={tab.grid ? undefined : { paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}
        />
      )}

      <Lightbox
        visible={lightbox != null}
        index={lightbox ?? 0}
        items={rows}
        guarded={guarded}
        onClose={() => setLightbox(null)}
        onGoToPost={i => { const row = rows[i]; setLightbox(null); if (row) router.push(chRoute.post(id, String(row.id))) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Cells
   --------------------------------------------------------- */

const GridCell = React.memo(function GridCell({
  message, index, size, onPress, onLongPress,
}: {
  message: any
  index: number
  size: number
  onPress: (message: any, index: number) => void
  onLongPress: (message: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(message, index), [onPress, message, index])
  const longPress = React.useCallback(() => onLongPress(message), [onLongPress, message])
  const media = message.media?.[0]
  const src = media?.thumbnailUrl || media?.url
  const album = (message.media?.length ?? 0) > 1
  const round = media?.kind === 'VIDEO_NOTE'

  return (
    <Touchable
      onPress={press}
      onLongPress={longPress}
      feedback="dim"
      noAutoHitSlop
      style={{ width: size, height: size, margin: space.xxs, backgroundColor: c.surfaceSunken, overflow: 'hidden' }}
    >
      {/* RemoteImage keys its failure to the SOURCE — the old cell-local
          `broken` state survived FlashList recycling and blanked healthy
          tiles as the grid scrolled. */}
      <RemoteImage
        source={src}
        fallbackIcon="image"
        fallbackIconSize={20}
        placeholder={media?.blurhash ? { blurhash: media.blurhash } : undefined}
        style={[StyleSheet.absoluteFill, round ? { borderRadius: size / 2 } : null]}
        contentFit="cover"
        /* No transition on a grid tile: on a fast flick the cross-fade is
           never seen through, and it keeps a second bitmap alive for its
           duration. `recyclingKey` is what stops the previous tile's
           picture showing under the new one. */
        cachePolicy="memory-disk"
        recyclingKey={src}
      />
      {media?.kind === 'VIDEO' || round ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Icon name="play" size={22} color={c.overlayText} filled />
        </View>
      ) : null}
      {media?.durationMs ? (
        <View style={[styles.tag, { backgroundColor: c.overlayChip }]}>
          <Text variant="micro" color={c.overlayText}>{clock(media.durationMs)}</Text>
        </View>
      ) : null}
      {media?.kind === 'GIF' ? (
        <View style={[styles.tag, { backgroundColor: c.overlayChip }]}>
          <Text variant="micro" color={c.overlayText}>GIF</Text>
        </View>
      ) : null}
      {album ? (
        <View style={[styles.corner, { backgroundColor: c.overlayChip }]}>
          <Icon name="gallery" size={12} color={c.overlayText} />
        </View>
      ) : null}
    </Touchable>
  )
})

const ListCell = React.memo(function ListCell({
  message, kind, guarded, active, onPlay, onPress, onLongPress,
}: {
  message: any
  kind: Kind
  /** `settings.protectedContent` — saving is off, so the affordance is absent. */
  guarded?: boolean
  /** The derived boolean, not the playing id — a scalar is what lets the memo
   *  skip the fifty rows that did not change when one starts playing. */
  active: boolean
  onPlay: (id: string) => void
  onPress: (message: any) => void
  onLongPress: (message: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const media = message.media?.[0]
  const rowId = String(message.id)
  const press = React.useCallback(() => onPress(message), [onPress, message])
  const longPress = React.useCallback(() => onLongPress(message), [onLongPress, message])
  const toggle = React.useCallback(() => onPlay(rowId), [onPlay, rowId])

  if (kind === 'LINK') {
    const url = firstUrl(message.body)
    return (
      <Touchable onPress={press} onLongPress={longPress} feedback="dim" noAutoHitSlop style={styles.listRow}>
        <View style={[styles.tile, { backgroundColor: c.accentSoft }]}>
          <Icon name="link" size={18} color={c.accent} />
        </View>
        <View style={styles.flex}>
          <Text variant="subhead" numberOfLines={1} align="ui">{url || 'Link'}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1} align="auto">{message.body}</Text>
        </View>
        <Text variant="micro" tone="faint">{message.time}</Text>
      </Touchable>
    )
  }

  if (kind === 'FILE') {
    const ext = String(media?.fileName || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'
    return (
      <Touchable onPress={press} onLongPress={longPress} feedback="dim" noAutoHitSlop style={styles.listRow}>
        <View style={[styles.tile, { backgroundColor: c.surfaceSunken }]}>
          <Text variant="micro" tone="secondary" align="center">{ext}</Text>
        </View>
        <View style={styles.flex}>
          <Text variant="subhead" numberOfLines={1} align="auto">{media?.fileName || 'File'}</Text>
          <Text variant="caption" tone="muted" align="ui">{bytes(media?.bytes)} · {message.time}</Text>
        </View>
        {/* protectedContent disables saving — the affordance is removed, not greyed. */}
        {guarded ? null : <Icon name="download" size={17} color={c.textMuted} />}
      </Touchable>
    )
  }

  return <AudioRow message={message} active={active} onToggle={toggle} onLongPress={longPress} />
})

/** One player at a time: the row that is not active never mounts a source, so
 *  scrolling past fifty voice notes does not open fifty audio sessions. */
function AudioRow({
  message, active, onToggle, onLongPress,
}: { message: any; active: boolean; onToggle: () => void; onLongPress: () => void }) {
  const t = useTheme()
  const c = t.colors
  const media = message.media?.[0]
  const player = useAudioPlayer(active && media?.url ? { uri: media.url } : null)

  React.useEffect(() => {
    if (!active) return
    try { player.play() } catch { /* a missing codec must not crash the list */ }
    return () => { try { player.pause() } catch { /* noop */ } }
  }, [active, player])

  return (
    <Touchable onPress={onToggle} onLongPress={onLongPress} feedback="dim" noAutoHitSlop style={styles.listRow}>
      <View style={[styles.playDisc, { backgroundColor: active ? c.accent : c.surfaceSunken }]}>
        <Icon name={active ? 'pause' : 'play'} size={16} color={active ? c.textOnAccent : c.textSecondary} filled />
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" numberOfLines={1} align="auto">
          {media?.fileName || (message.authorSignature || 'Voice note')}
        </Text>
        <Text variant="caption" tone="muted" align="ui">
          {clock(media?.durationMs || 0)} · {message.time}
        </Text>
      </View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   Lightbox
   --------------------------------------------------------- */

function Lightbox({
  visible, index, items, guarded, onClose, onGoToPost,
}: {
  visible: boolean
  index: number
  items: any[]
  guarded: boolean
  onClose: () => void
  onGoToPost: (i: number) => void
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [page, setPage] = React.useState(index)
  React.useEffect(() => { setPage(index) }, [index])

  if (!visible) return null
  const current = items[page]

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A lightbox is dark in both schemes — a photo judged against a white
          frame reads differently — so this is a fixed ramp step, not a role. */}
      <View style={{ flex: 1, backgroundColor: ramp.slate[1000] }}>
        <PagerView
          style={{ flex: 1 }}
          initialPage={index}
          onPageSelected={e => setPage(e.nativeEvent.position)}
        >
          {items.map((m: any, i: number) => {
            const media = m.media?.[0]
            return (
              <View key={String(m.id)} style={styles.center}>
                {/* ±1 window — the album otherwise decoded every original on
                    open — and the grid tile's blurhash/thumb painted under
                    the full-res fetch instead of a black beat. */}
                {media?.url && Math.abs(i - page) <= 1 ? (
                  <RemoteImage
                    source={media.url}
                    /* The grid tile shows the same glyph; the full-size page
                       must not degrade to a blank pager sheet. */
                    fallback="overlay"
                    fallbackIcon="image"
                    fallbackIconSize={32}
                    fallbackLabel="Image unavailable"
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    transition={120}
                    cachePolicy="memory-disk"
                    placeholder={media.blurhash
                      ? { blurhash: media.blurhash }
                      : media.thumbnailUrl ? { uri: media.thumbnailUrl } : undefined}
                    placeholderContentFit="contain"
                  />
                ) : null}
              </View>
            )
          })}
        </PagerView>

        <View style={[styles.lightboxBar, { paddingTop: insets.top + 4 }]}>
          <IconButton name="close" onPress={onClose} accessibilityLabel="Close" color={t.colors.overlayText} surface="overlay" />
          <View style={styles.flex} />
          <IconButton
            name="external"
            onPress={() => onGoToPost(page)}
            accessibilityLabel="Go to post"
            color={t.colors.overlayText}
            surface="overlay"
          />
        </View>

        <View style={[styles.caption, { paddingBottom: insets.bottom + 16 }]}>
          {current?.body ? (
            <Text variant="footnote" color={t.colors.overlayText} align="auto" numberOfLines={3}>{current.body}</Text>
          ) : null}
          <Text variant="caption" color={t.colors.overlayTextMuted} align="ui">
            {guarded ? 'Saving is off in this channel.' : `${page + 1} of ${items.length}`}
          </Text>
        </View>
      </View>
    </Modal>
  )
}

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

function firstUrl(body?: string | null): string {
  const m = /https?:\/\/\S+/i.exec(String(body || ''))
  return m ? m[0] : ''
}

function openRow(message: any, kind: Kind, router: any, channelId: string, guarded?: boolean) {
  if (kind === 'LINK') {
    const url = firstUrl(message.body)
    if (url) { void WebBrowser.openBrowserAsync(url).catch((e: any) => toast.error(errorText(e))); return }
  }
  /* protectedContent: opening the raw file in a browser IS saving it, so a
     guarded channel routes to the post instead. */
  if (kind === 'FILE' && !guarded) {
    const url = message.media?.[0]?.url
    if (url) { void WebBrowser.openBrowserAsync(url).catch((e: any) => toast.error(errorText(e))); return }
  }
  router.push(chRoute.post(channelId, String(message.id)))
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: space.xxs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', start: 4, bottom: 4, paddingHorizontal: space.xs2, paddingVertical: space.xxs, borderRadius: 4 },
  corner: { position: 'absolute', end: 4, top: 4, padding: space.xs, borderRadius: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm2, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  playDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lightboxBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, gap: space.xs },
  flex: { flex: 1 },
})
