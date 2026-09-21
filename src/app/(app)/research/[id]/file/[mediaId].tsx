/* =========================================================
   File preview.

   The single `download` call on mount does two jobs: it records
   the (deduped) download and it yields the URL the preview
   renders. The URL is presigned for thirty minutes and is
   viewer-scoped, which is why Share always composes the
   paper's public link and never this one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, Share, Linking } from 'react-native'
import { Image } from 'expo-image'
import { WebView } from 'react-native-webview'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { withAlpha } from '@/theme/colors'
import { Button, Icon, IconButton, Spinner, Text, Touchable, toast } from '@/ui'
import { GoneState } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { extOf, fileTint, formatBytes, formatDuration } from '@/components/research/format'
import type { MediaFile } from '@/components/research/types'

/* The presigned window is 30 minutes; refresh a little before it lapses. */
const REFRESH_AFTER_MS = 28 * 60 * 1000

export default function FilePreviewScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  /* The viewer is a bare full-bleed View, not a <Screen edges>, so the bar
     owns the status-bar clearance itself — a fixed 48 buried the back button
     under a 59pt island and floated it on a 20pt one. */
  const insets = useSafeAreaInsets()
  const { id, mediaId } = useLocalSearchParams<{ id: string; mediaId: string }>()
  const { detail } = useResearchDetail(id, { subscribe: false, recordView: false })

  const [url, setUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [expired, setExpired] = React.useState(false)
  const [webFailed, setWebFailed] = React.useState(false)
  const issuedAt = React.useRef(0)

  const file: MediaFile | undefined = detail?.mediaFiles.find(m => m.id === mediaId)

  const fetchUrl = React.useCallback(async () => {
    if (!id || !mediaId) return
    setLoading(true)
    setError(null)
    try {
      const res: any = await api.research.download(id, mediaId)
      setUrl(res?.url || null)
      issuedAt.current = Date.now()
      setExpired(false)
    } catch (e: any) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [id, mediaId])

  React.useEffect(() => { void fetchUrl() }, [fetchUrl])

  /* A stall past the presign window is almost always the link, not the file. */
  React.useEffect(() => {
    if (!url) return
    const timer = setTimeout(() => setExpired(true), REFRESH_AFTER_MS)
    return () => clearTimeout(timer)
  }, [url])

  const share = async () => {
    if (!detail) return
    const res = await Share.share({
      message: [detail.title, file?.name, detail.shareUrl].filter(Boolean).join(' — '),
    })
    /* Only a COMPLETED share moves the counter — recordShare is the documented
       "user actually sent the link" call. */
    if (detail.shareUrl && res.action === Share.sharedAction) {
      void Promise.resolve(api.research.recordShare(id)).catch(() => {})
    }
  }

  const saveToDevice = async () => {
    if (!url) return
    /* The OS sheet is where "Save to Files" lives; it must be awaited because
       only one sheet can be open at a time. */
    try { await Linking.openURL(url) } catch { toast.error('Could not open the file.') }
  }

  const kind = String(file?.type || '').toUpperCase()

  const body = () => {
    if (loading && !url) {
      return (
        <View style={styles.center}>
          <Spinner size="large" />
          <Text variant="footnote" color={c.overlayTextMuted} align="center" style={{ marginTop: space.md }}>
            {file?.name || 'Preparing file…'}
          </Text>
        </View>
      )
    }

    if (error) {
      const code = codeOf(error)
      const dead = code === 'FILE_NOT_AVAILABLE' || error?.status === 403 || error?.status === 404
      if (dead) {
        return <GoneState title="This file is not available." body="It may have been removed from the paper." actionLabel={null} />
      }
      return (
        <View style={styles.center}>
          <Icon name="error" size={30} color={c.overlayText} />
          <Text variant="callout" color={c.overlayText} align="center" style={{ marginTop: space.sm2, maxWidth: 300 }}>
            {errorText(error)}
          </Text>
          <Button label="Try again" variant="tinted" onPress={() => void fetchUrl()} style={{ marginTop: space.lg }} />
        </View>
      )
    }

    if (expired) {
      return (
        <View style={styles.center}>
          <Icon name="clock" size={30} color={c.overlayText} />
          <Text variant="title3" color={c.overlayText} align="center" style={{ marginTop: space.sm2 }}>This link expired</Text>
          <Text variant="footnote" color={c.overlayTextMuted} align="center" style={{ marginTop: space.xs, maxWidth: 280 }}>
            Download links last thirty minutes. Reload to get a fresh one.
          </Text>
          <Button label="Reload" variant="tinted" icon="refresh" onPress={() => void fetchUrl()} style={{ marginTop: space.lg }} />
        </View>
      )
    }

    if (!url) return null

    if (kind === 'DOCUMENT' && !webFailed) {
      return (
        <WebView
          source={{ uri: url }}
          style={styles.fill}
          startInLoadingState
          renderLoading={() => <View style={[styles.center, { backgroundColor: c.overlayBg }]}><Spinner size="large" /></View>}
          onError={() => setWebFailed(true)}
          onHttpError={() => setWebFailed(true)}
        />
      )
    }

    if (kind === 'VIDEO') return <VideoPreview url={url} duration={file?.duration ?? null} />
    if (kind === 'AUDIO') return <AudioPreview url={url} name={file?.name || 'Audio'} cover={detail?.coverImageUrl ?? null} />

    return (
      <View style={styles.center}>
        <View style={[styles.bigTile, { backgroundColor: fileTint(c, kind).bg }]}>
          <Text variant="title3" color={fileTint(c, kind).fg}>{extOf(file?.name)}</Text>
        </View>
        <Text variant="headline" color={c.overlayText} align="center" style={{ marginTop: space.lg }} numberOfLines={2}>
          {file?.name || 'File'}
        </Text>
        <Text variant="footnote" color={c.overlayTextMuted} align="center" style={{ marginTop: space.xs }}>
          {[formatBytes(file?.fileSize), kind].filter(Boolean).join(' · ')}
        </Text>
        <Button label="Open with…" variant="primary" block size="lg" onPress={saveToDevice} style={styles.openBtn} />
      </View>
    )
  }

  return (
    <View style={[styles.fill, { backgroundColor: c.overlayBg }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton name="back" onPress={() => router.back()} accessibilityLabel="Back" color={c.overlayText} size={22} />
        <Text variant="subhead" color={c.overlayText} align="center" numberOfLines={1} style={styles.flex}>
          {file?.name || 'File'}
        </Text>
        <IconButton name="share" onPress={share} accessibilityLabel="Share" color={c.overlayText} size={20} />
        <IconButton name="download" onPress={saveToDevice} accessibilityLabel="Download" color={c.overlayText} size={20} />
      </View>
      <View style={styles.fill}>{body()}</View>
    </View>
  )
}

function VideoPreview({ url, duration }: { url: string; duration: number | null }) {
  const t = useTheme()
  const player = useVideoPlayer({ uri: url }, p => { p.loop = false })
  return (
    <View style={styles.fill}>
      <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls />
      {duration ? (
        <View style={[styles.durationPill, { backgroundColor: t.colors.overlayChip }]}>
          <Text variant="micro" color={t.colors.overlayText}>{formatDuration(duration)}</Text>
        </View>
      ) : null}
    </View>
  )
}

function AudioPreview({ url, name, cover }: { url: string; name: string; cover: string | null }) {
  const t = useTheme()
  const c = t.colors
  const player = useAudioPlayer({ uri: url })
  const status = useAudioPlayerStatus(player)
  const total = status.duration || 0
  const progress = total > 0 ? Math.min(1, (status.currentTime || 0) / total) : 0

  return (
    <View style={styles.center}>
      <View style={[styles.artwork, { backgroundColor: withAlpha(c.accent, 0.25) }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
        ) : (
          <Icon name="music" size={54} color={c.overlayText} />
        )}
      </View>
      <Text variant="headline" color={c.overlayText} align="center" numberOfLines={2} style={{ marginTop: space.lg2 }}>{name}</Text>

      <View style={styles.scrubber}>
        <View style={[styles.track, { backgroundColor: withAlpha(c.overlayText, 0.25) }]}>
          <View style={{ width: `${progress * 100}%`, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
        <View style={styles.timeRow}>
          <Text variant="caption" color={c.overlayTextMuted}>{formatDuration(status.currentTime)}</Text>
          <Text variant="caption" color={c.overlayTextMuted}>{formatDuration(total)}</Text>
        </View>
      </View>

      <Touchable
        onPress={() => (status.playing ? player.pause() : player.play())}
        feedback="scale"
        accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        style={[styles.playBtn, { backgroundColor: c.accent }]}
      >
        <Icon name={status.playing ? 'pause' : 'play'} size={26} color={c.textOnAccent} filled />
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /* `paddingTop` is supplied per-render from insets.top. */
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2, paddingBottom: space.xs2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  bigTile: { width: 96, height: 96, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  openBtn: { marginTop: 26, alignSelf: 'stretch' },
  artwork: { width: 200, height: 200, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scrubber: { alignSelf: 'stretch', marginTop: space.xxl, gap: space.xs2 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  playBtn: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  durationPill: { position: 'absolute', bottom: 20, end: 16, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 6 },
  flex: { flex: 1 },
})
