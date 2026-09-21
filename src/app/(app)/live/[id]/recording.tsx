/* =========================================================
   Recording — the owner-only manifest.

   Two things here are easy to get wrong and both cost the host
   their video:

   1. MULTI-PART IS NORMAL. MediaMTX restarts its recorder
      whenever the published track set changes, and audio
      routinely registers a beat before video — so the first
      part can be a short audio-only prelude and the second is
      the one with the picture. The part-less download route
      answers a multi-part recording with the PRIMARY part —
      the largest file, the one carrying video — so it never
      hands back the prelude, but it also never hands back
      everything. Hence "Save recording" calls
      `saveWholeRecording`, which walks every named part.
   2. THE DOWNLOAD IS BEARER-AUTHED. `recordingDownloadUrl` is
      an API path, not an href, so every byte goes through the
      http client, which keeps the 401 → refresh → retry
      recovery and turns the JSON 404 envelope into a real
      ApiError.

   The preview player is explicitly BEST EFFORT: it points
   expo-video at the authed URL with a Bearer header, which
   bypasses that refresh-and-retry, and the access token
   rotates roughly hourly. When it fails, the poster and the
   "save the file to watch it" line are the answer — not a
   retry ladder against a URL that will keep expiring.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useEvent } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { API_BASE, api, codeOf, errorText, isNetworkError, isNotFound, session } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, ConfirmSheet, Divider, ErrorState, Header, Icon,
  Screen, ScreenScroll, Skeleton, Text, Touchable, fireHaptic, useSheetState, toast,
} from '@/ui'
import { PulseDot, RecordingStatusChip } from '@/components/live/RecordingStatusChip'
import { BROADCAST_PLATE, FILL, ROOM } from '@/components/live/skin'
import { humanBytes, type RecordingInfo, type RecordingPart } from '@/components/live/types'

export default function RecordingScreen() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const streamId = id ? String(id) : ''

  const info = useAsync<RecordingInfo>(
    async () => (await api.chat.streams.recording(streamId)) as RecordingInfo,
    { enabled: !!streamId, deps: [streamId] },
  )
  const menu = useSheetState()
  const del = useSheetState()
  const [saving, setSaving] = React.useState<{ done: number; total: number } | null>(null)
  const [saveErr, setSaveErr] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  useFocusEffect(React.useCallback(() => { void info.refresh() }, [streamId])) // eslint-disable-line react-hooks/exhaustive-deps

  const data = info.data
  const parts = data?.parts ?? []
  /* The biggest part is the one with the picture — MediaMTX's audio prelude is
     always the small one. */
  const primary = React.useMemo(
    () => parts.slice().sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null,
    [parts],
  )

  const saveAll = async () => {
    if (!streamId || saving) return
    setSaveErr(null)
    setSaving({ done: 0, total: Math.max(1, parts.length) })
    try {
      /* Always the walker: the part-less route answers a multi-part recording
         with only the primary (largest) part — "save my recording" means every
         byte on disk, so every named part is fetched in order. */
      const n = await api.chat.streams.saveWholeRecording(streamId)
      fireHaptic('success')
      toast.ok(`Saved ${n} file${n === 1 ? '' : 's'}`)
    } catch (e: any) {
      setSaveErr(errorText(e))
    } finally {
      setSaving(null)
    }
  }

  const savePart = async (p: RecordingPart) => {
    if (!streamId) return
    try { await api.chat.streams.saveRecording(streamId, { part: p.file }) }
    catch (e: any) {
      if (isNotFound(e)) { void info.reload(); return }
      toast.error(errorText(e))
    }
  }

  const removeRecording = async () => {
    setDeleting(true)
    try {
      await api.chat.streams.removeRecording(streamId)
      del.close()
      await info.reload()
    } catch (e: any) {
      toast.error(errorText(e))
      del.close()
    } finally { setDeleting(false) }
  }

  /* A 404 in this family means "no longer available", which is a state, not an
     error — it renders as the EMPTY panel with no retry button. */
  const quiet404 = isNotFound(info.error)
  const forbidden = codeOf(info.error) === 'ACCESS_FORBIDDEN'
  const status = quiet404 ? 'EMPTY' : (data?.status ?? null)
  const available = !!data?.available && !quiet404

  if (info.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Recording" />
        <Skeleton height={200} radius={0} />
        <View style={styles.skelRows}>
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={12} />
        </View>
      </Screen>
    )
  }

  if (info.error && !quiet404) {
    return (
      <Screen background="sunken">
        <Header back title="Recording" />
        <ErrorState
          error={info.error}
          onRetry={forbidden ? undefined : info.reload}
          title={forbidden ? 'Not your recording' : undefined}
        />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Recording"
        actions={[{ icon: 'more', onPress: () => menu.open(), label: 'More' }]}
      />

      <ScreenScroll
        refreshing={info.refreshing}
        onRefresh={info.refresh}
        contentContainerStyle={{ paddingBottom: insets.bottom + 150 }}
      >
        {available && primary ? (
          <PreviewHero streamId={streamId} part={primary} />
        ) : (
          <StatePanel status={status} />
        )}

        <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          <View style={styles.cardHead}>
            <RecordingStatusChip status={status} />
          </View>
          <Divider />
          <MetaRow label="Status" value={STATUS_COPY[String(status)] ?? 'Not recorded'} />
          <Divider inset={16} />
          <MetaRow label="Files" value={String(data?.partCount ?? 0)} />
          <Divider inset={16} />
          <MetaRow label="Size" value={humanBytes(data?.totalBytes)} />
        </View>

        {parts.length > 1 ? (
          <Callout tone="warning" icon="info" style={styles.callout}>
            This broadcast was saved as {parts.length} files. The first can be a
            short audio-only clip — “Save all” keeps them in order and includes
            the one with the picture.
          </Callout>
        ) : null}

        {parts.map(p => (
          <View key={p.file} style={[styles.partRow, { backgroundColor: c.surface }]}>
            <View style={styles.flex}>
              <View style={styles.partHead}>
                <Text variant="footnote" mono align="ui" numberOfLines={1} ellipsizeMode="middle" style={styles.flex}>
                  {p.file}
                </Text>
                {primary && p.file === primary.file && parts.length > 1 ? (
                  <View style={[styles.mainChip, { backgroundColor: c.accentSoft }]}>
                    <Text variant="micro" tone="accent" weight="700">MAIN</Text>
                  </View>
                ) : null}
              </View>
              <Text variant="caption" tone="muted" align="ui">
                {humanBytes(p.sizeBytes)}{p.modifiedAt ? ` · ${new Date(p.modifiedAt).toLocaleString()}` : ''}
              </Text>
            </View>
            <Touchable
              onLongPress={async () => { await Clipboard.setStringAsync(p.file); toast.ok('File name copied') }}
              onPress={() => savePart(p)}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={`Save ${p.file}`}
              style={[styles.partBtn, { borderColor: c.borderStrong }]}
            >
              <Text variant="subhead" tone="accent">Save</Text>
            </Touchable>
          </View>
        ))}

        {saveErr ? (
          <View style={styles.saveErr}>
            <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>{saveErr}</Text>
            <Button label="Retry" onPress={saveAll} variant="ghost" size="sm" />
          </View>
        ) : null}
      </ScreenScroll>

      {available ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, backgroundColor: c.bgSunken, borderTopColor: c.separator }]}>
          {isNetworkError(info.error) ? (
            <Text variant="footnote" tone="muted" align="center" style={styles.offline}>
              You&apos;re offline — downloads need a connection.
            </Text>
          ) : null}
          <Button
            label={saving ? `Saving ${saving.done + 1} of ${saving.total}…` : 'Save recording'}
            onPress={saveAll}
            variant="primary"
            size="lg"
            block
            loading={!!saving}
            disabled={!!saving}
          />
          <Button
            label="Delete recording"
            onPress={() => del.open()}
            variant="ghost"
            size="md"
            block
            style={styles.deleteBtn}
          />
        </View>
      ) : null}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Delete recording',
            icon: 'trash',
            destructive: true,
            hidden: status === 'DELETED' || status === 'DISABLED',
            onPress: () => del.open(),
          },
        ]}
      />

      <ConfirmSheet
        visible={del.visible}
        onClose={del.close}
        title="Delete the recording?"
        message="The stream stays in My streams. Only the video file is removed."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={removeRecording}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Hero
   --------------------------------------------------------- */

function PreviewHero({ streamId, part }: { streamId: string; part: RecordingPart }) {
  const uri = part.downloadUrl
    ? `${API_BASE}${part.downloadUrl}`
    : `${API_BASE}/api/v1/streams/${streamId}/recording/download?part=${encodeURIComponent(part.file)}`

  /* Snapshot the token ONCE for the life of the hero: useVideoPlayer keys its
     native object on the serialized source, so a per-render getToken() read
     silently RELEASES the player under the mounted view the moment the token
     rotates mid-playback ("Cannot use shared object that was already
     released"). The header is best-effort anyway — a frozen snapshot loses
     nothing. */
  const [auth] = React.useState(() => session.getToken() ?? '')

  const player = useVideoPlayer(
    {
      uri,
      /* Best effort, and marked as such: this bypasses http.js's
         401 → refresh → retry, and the access token rotates hourly. */
      headers: { Authorization: `Bearer ${auth}` },
    },
    p => { p.loop = false; p.muted = false },
  )
  const evt = useEvent(player, 'statusChange', { status: player.status })
  const failed = (evt?.status ?? player.status) === 'error'

  if (failed) {
    return (
      <View style={styles.hero}>
        {/* The navy broadcast plate — the web live surface's ground for any
            stateful pane; the playing video keeps its plain letterbox. */}
        <LinearGradient colors={BROADCAST_PLATE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />
        <Icon name="play" size={34} color={ROOM.fgGhost} filled />
        <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.heroCopy}>
          Save the file to watch it
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.hero}>
      <VideoView player={player} contentFit="contain" nativeControls style={StyleSheet.absoluteFill} />
      <View style={[styles.previewChip, { backgroundColor: ROOM.glassStrong }]}>
        <Text variant="micro" color={ROOM.fgMuted}>Preview</Text>
      </View>
    </View>
  )
}

function StatePanel({ status }: { status: string | null }) {
  const copy = PANEL[String(status)] ?? PANEL.DISABLED
  return (
    <View style={styles.hero}>
      <LinearGradient colors={BROADCAST_PLATE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />
      {status === 'RECORDING' ? <PulseDot size={16} /> : <Icon name={copy.icon} size={38} color={ROOM.fgGhost} />}
      <Text variant="headline" color={ROOM.fg} align="center" style={styles.heroTitle}>{copy.title}</Text>
      <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.heroCopy}>{copy.body}</Text>
    </View>
  )
}

const PANEL: Record<string, { icon: 'eyeOff' | 'file' | 'trash' | 'reels'; title: string; body: string }> = {
  DISABLED: {
    icon: 'eyeOff',
    title: "This broadcast wasn't recorded",
    body: "Turn on 'Record this broadcast' before going live next time.",
  },
  RECORDING: {
    icon: 'reels',
    title: 'Recording in progress',
    body: 'The file is ready to download once the stream ends.',
  },
  /* Wire states the streaming doc omits (backend RecordingStatus.java). */
  PAUSED: {
    icon: 'reels',
    title: 'Recording paused',
    body: 'The takes so far are kept. Resume recording from the console — everything is joined when the stream ends.',
  },
  PROCESSING: {
    icon: 'reels',
    title: 'Preparing your file',
    body: 'Your takes are being joined into one video. The parts below stay downloadable meanwhile.',
  },
  EMPTY: {
    icon: 'file',
    title: 'Nothing was captured',
    body: 'No video was published while recording was on.',
  },
  DELETED: {
    icon: 'trash',
    title: 'Recording deleted',
    body: 'The stream itself is still in My streams.',
  },
}

const STATUS_COPY: Record<string, string> = {
  DISABLED: 'Not recorded',
  RECORDING: 'Recording now',
  PAUSED: 'Paused',
  PROCESSING: 'Preparing the file',
  AVAILABLE: 'Ready',
  EMPTY: 'Nothing was captured',
  DELETED: 'Deleted',
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="callout" tone="muted" align="ui" style={styles.metaLabel}>{label}</Text>
      <Text variant="callout" align="ui" style={styles.flex} numberOfLines={1}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: ROOM.pane,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  heroTitle: { marginTop: space.md2 },
  heroCopy: { marginTop: space.xs, maxWidth: 300 },
  previewChip: { position: 'absolute', start: 10, top: 10, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 6 },
  card: { marginHorizontal: space.lg, marginTop: space.lg, overflow: 'hidden' },
  cardHead: { padding: space.md2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  metaLabel: { width: 80 },
  callout: { marginHorizontal: space.lg, marginTop: space.md2 },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.sm2,
    padding: space.md,
    borderRadius: 12,
    minHeight: 64,
  },
  partHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mainChip: { paddingHorizontal: space.xs2, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  /* An outlined, labelled action — setback, not a capsule (DESIGN.md §8.9). */
  partBtn: {
    height: 34, paddingHorizontal: space.md2, borderWidth: StyleSheet.hairlineWidth,
    ...setback(shape.buttonSm), borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center',
  },
  saveErr: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingTop: space.md2 },
  skelRows: { padding: space.lg, gap: space.sm2 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteBtn: { marginTop: space.xs },
  offline: { marginBottom: space.sm },
  flex: { flex: 1 },
})
