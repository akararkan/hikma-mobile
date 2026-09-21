/* =========================================================
   Stream settings — the owner's control panel, and the landing
   screen after a broadcast ends.

   The one rule that governs the whole screen: `ingestUrl` and
   `whipUrl` contain the stream key. Anyone holding either can
   broadcast AS the host. So they are masked by default, a
   reveal is behind a confirm that says why, the reveal expires
   on its own after 30 seconds, a copy warns the user in red,
   and the OS share sheet only ever carries `shareUrl`.

   `whipUrl` is shown anyway, marked unusable from this build:
   the host may well be publishing from a browser on a laptop,
   and hiding a credential that works elsewhere would be
   unhelpful rather than safe.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { patchStream } from '@/lib/liveRows'
import { isBlocked, isModerationError, moderationText } from '@/lib/moderation'
import { ModerationRefusalNotice } from '@/components/moderation'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, ConfirmSheet, Divider, ErrorState, Field, GroupFooter, GroupLabel, Header,
  Icon, ListRow, Screen, ScreenScroll, SkeletonList, Text, Touchable, fireHaptic,
  useSheetState, toast,
} from '@/ui'
import { RecordingStatusChip, recordingSentence } from '@/components/live/RecordingStatusChip'
import type { LiveStream } from '@/components/live/types'

const REVEAL_MS = 30_000

export default function ManageStreamScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const streamId = id ? String(id) : ''

  const stream = useAsync<LiveStream>(
    async () => (await api.chat.streams.get(streamId)) as LiveStream,
    { enabled: !!streamId, deps: [streamId] },
  )

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [titleErr, setTitleErr] = React.useState<string | null>(null)
  const [modError, setModError] = React.useState<any>(null)
  const [recBusy, setRecBusy] = React.useState(false)
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({})
  const reveal = useSheetState<'ingest' | 'whip'>()
  const endConfirm = useSheetState()
  const deleteConfirm = useSheetState()
  const [deleting, setDeleting] = React.useState(false)
  const titleRef = React.useRef<any>(null)

  const s = stream.data
  const isOwner = !!user?.id && !!s?.hostId && String(s.hostId) === String(user.id)

  React.useEffect(() => {
    if (!s || dirty) return
    setTitle(s.title)
    setDescription(s.description)
  }, [s, dirty])

  /* A host coming back from the console must not see the state it left. */
  useFocusEffect(React.useCallback(() => { void stream.refresh() }, [streamId])) // eslint-disable-line react-hooks/exhaustive-deps

  useChatEvents(evt => {
    const type = String(evt?.type || '')
    if (!type.startsWith('stream.')) return
    if (String(evt.streamId ?? evt.stream?.id ?? '') !== streamId) return
    if (type === 'stream.updated' || type === 'stream.viewer') {
      stream.setData(prev => patchStream(prev, evt.stream))
    } else if (type === 'stream.ended') {
      stream.setData(prev => (prev ? { ...patchStream(prev, evt.stream), status: 'ENDED', isLive: false } : prev))
    }
  })

  /* A revealed key re-masks itself: a screen left open on a desk should not
     keep a broadcast credential on it indefinitely. */
  React.useEffect(() => {
    if (!Object.values(revealed).some(Boolean)) return
    const timer = setTimeout(() => setRevealed({}), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  const save = async () => {
    setModError(null)
    if (!streamId || !dirty) return
    setSaving(true)
    setTitleErr(null)
    try {
      const next = (await api.chat.streams.update(streamId, {
        title: title.trim(),
        description: description.trim(),
      })) as LiveStream
      stream.setData(prev => patchStream(prev, next))
      setDirty(false)
      fireHaptic('success')
    } catch (e: any) {
      /* A refusal is about the WORDS, not about a malformed field, so it does
         not become a field error and does not steal focus into the title —
         and a held change is "not yet", not "no". `dirty` is deliberately left
         true so Save stays live: a held edit lands on a retry once the queue
         catches up. */
      if (isModerationError(e)) setModError(e)
      else if (e?.status === 400) { setTitleErr(errorText(e)); titleRef.current?.focus() }
      else toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleRecording = async () => {
    if (!streamId || recBusy) return
    setRecBusy(true)
    try {
      const next = (s?.recordingStatus === 'RECORDING'
        ? await api.chat.streams.stopRecording(streamId)
        : await api.chat.streams.startRecording(streamId)) as LiveStream
      stream.setData(prev => patchStream(prev, next))
    } catch (e: any) {
      if (codeOf(e) === 'STREAM_NOT_LIVE') { void stream.reload(); return }
      toast.error(errorText(e))
    } finally { setRecBusy(false) }
  }

  const endStream = async () => {
    endConfirm.close()
    try {
      await api.chat.streams.end(streamId)
      /* Refetch rather than patch: ending settles recordingStatus server-side
         (RECORDING → AVAILABLE or EMPTY) and only the server knows which. */
      await stream.reload()
    } catch (e: any) {
      if (codeOf(e) === 'STREAM_NOT_LIVE') { void stream.reload(); return }
      toast.error(errorText(e))
    }
  }

  const removeStream = async () => {
    setDeleting(true)
    try {
      await api.chat.streams.remove(streamId)
      router.replace('/live/mine')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setDeleting(false)
      deleteConfirm.close()
    }
  }

  const copySecret = async (value: string | null, label: string) => {
    if (!value) return
    await Clipboard.setStringAsync(value)
    fireHaptic('light')
    toast.warn(`${label} copied — don't paste this anywhere public.`)
  }

  if (stream.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Stream settings" />
        <SkeletonList count={4} card />
      </Screen>
    )
  }

  if (stream.error && !s) {
    const forbidden = codeOf(stream.error) === 'ACCESS_FORBIDDEN'
    return (
      <Screen background="sunken">
        <Header back title="Stream settings" />
        {/* A rights refusal is FINAL — no retry, and none of the publish or
            danger sections are rendered at all. */}
        <ErrorState
          error={stream.error}
          onRetry={forbidden ? undefined : stream.reload}
          title={forbidden ? 'Not your stream' : undefined}
        />
        <View style={styles.backRow}>
          <Button label="Back to My streams" onPress={() => router.replace('/live/mine')} variant="secondary" size="md" />
        </View>
      </Screen>
    )
  }

  if (!s) return <Screen background="sunken"><Header back title="Stream settings" /></Screen>

  return (
    <Screen background="sunken">
      <Header back title={s.title} />

      <ScreenScroll refreshing={stream.refreshing} onRefresh={stream.refresh}>
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          <View style={[styles.thumb, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}>
            <Icon name={s.isLive ? 'broadcast' : 'play'} size={20} color={s.isLive ? c.liveDot : c.textMuted} filled />
          </View>
          <View style={styles.flex}>
            {/* Serif title + the solid live-red LIVE chip — the same grammar
                as the /live/mine rows and the web's `.lv-mine-state`. */}
            <Text variant="bodyStrong" serif align="ui" numberOfLines={2}>{s.title}</Text>
            <View style={styles.heroMeta}>
              <View style={[styles.statusPill, { backgroundColor: s.isLive ? c.liveDot : c.surfaceSunken }]}>
                <Text variant="micro" weight="700" color={s.isLive ? '#FFFFFF' : c.textMuted}>
                  {s.isLive ? 'LIVE' : 'ENDED'}
                </Text>
              </View>
              <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
                {s.time} · {s.viewerCount} viewers
              </Text>
            </View>
          </View>
          {s.isLive ? (
            <Button label="Open console" onPress={() => router.push(`/live/${streamId}/host`)} variant="tinted" size="sm" />
          ) : null}
        </View>

        {/* Details */}
        <GroupLabel>Details</GroupLabel>
        <View style={styles.group}>
          <ModerationRefusalNotice
            error={modError}
            onRetry={() => { setModError(null); void save() }}
            onDismiss={() => setModError(null)}
          />
          <Field
            ref={titleRef}
            label="Title"
            value={title}
            onChangeText={v => { setTitle(v); setDirty(true); setTitleErr(null) }}
            error={titleErr}
            maxLength={80}
            editable={isOwner}
          />
          <Field
            label="Description"
            value={description}
            onChangeText={v => { setDescription(v); setDirty(true) }}
            maxLength={280}
            multiline
            minHeight={96}
            editable={isOwner}
          />
          <Button
            label="Save"
            onPress={save}
            variant="primary"
            size="md"
            loading={saving}
            disabled={!dirty || !title.trim() || !isOwner}
            style={styles.saveBtn}
          />
        </View>
        {s.isLive ? <GroupFooter>Viewers see changes instantly.</GroupFooter> : null}

        {/* Share */}
        <GroupLabel>Share</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          <View style={styles.monoRow}>
            <Text variant="footnote" mono align="ui" selectable numberOfLines={2} style={styles.flex}>
              {s.shareUrl || 'No public link'}
            </Text>
            <Touchable
              onPress={async () => {
                if (!s.shareUrl) return
                await Clipboard.setStringAsync(s.shareUrl)
                toast.ok('Link copied')
              }}
              feedback="dim"
              accessibilityLabel="Copy the watch link"
            >
              <Icon name="copy" size={18} color={c.accent} />
            </Touchable>
          </View>
          <Divider />
          <Button
            label="Share"
            icon="share"
            onPress={() => {
              /* NEVER the ingest or WHIP URL — only this one is key-free. */
              if (!s.shareUrl) { toast.warn('No public link.'); return }
              void Share.share({ message: s.shareUrl, url: s.shareUrl })
            }}
            variant="secondary"
            size="md"
            block
            disabled={!s.shareUrl}
            style={styles.cardBtn}
          />
        </View>
        <GroupFooter>Safe to share — this link never exposes your stream key.</GroupFooter>

        {/* Publish — owner + live only */}
        {isOwner && s.isLive && (s.ingestUrl || s.whipUrl) ? (
          <>
            <GroupLabel>Publish</GroupLabel>
            <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
              <SecretRow
                label="RTMP (OBS / Larix)"
                value={s.ingestUrl}
                shown={!!revealed.ingest}
                onReveal={() => reveal.open('ingest')}
                onCopy={() => copySecret(s.ingestUrl, 'RTMP URL')}
              />
              <Divider />
              <SecretRow
                label="WHIP (browser camera)"
                value={s.whipUrl}
                shown={!!revealed.whip}
                note="Not usable from this app build."
                onReveal={() => reveal.open('whip')}
                onCopy={() => copySecret(s.whipUrl, 'WHIP URL')}
              />
            </View>
          </>
        ) : null}

        {/* Recording */}
        <GroupLabel>Recording</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
          <ListRow
            title={recordingSentence(s.recordingStatus)}
            leading={<View style={styles.chipSlot}><RecordingStatusChip status={s.recordingStatus} size="sm" /></View>}
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(`/live/${streamId}/recording`)}
          />
          {isOwner && s.isLive ? (
            <>
              <Divider inset={16} />
              <ListRow
                title={s.recordingStatus === 'RECORDING' ? 'Stop recording' : 'Start recording'}
                icon="reels"
                iconTone={s.recordingStatus === 'RECORDING' ? 'danger' : 'neutral'}
                disabled={recBusy}
                onPress={toggleRecording}
              />
            </>
          ) : null}
        </View>
        {isOwner && s.isLive ? (
          <GroupFooter>
            You can record in takes — they&apos;re joined into one file when the
            stream ends.
          </GroupFooter>
        ) : null}

        {/* Danger */}
        {isOwner ? (
          <>
            <GroupLabel>Danger</GroupLabel>
            <View style={[styles.card, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
              {s.isLive ? (
                <>
                  <ListRow title="End stream" icon="callEnd" destructive onPress={() => endConfirm.open()} />
                  <Divider inset={16} />
                </>
              ) : null}
              <ListRow title="Delete stream" icon="trash" destructive onPress={() => deleteConfirm.open()} />
            </View>
          </>
        ) : null}

        <View style={styles.tail} />
      </ScreenScroll>

      <ConfirmSheet
        visible={reveal.visible}
        onClose={reveal.close}
        title="Show your stream key?"
        message="This URL contains your stream key. Anyone with it can broadcast as you."
        confirmLabel="Reveal"
        icon="key"
        onConfirm={() => {
          const which = reveal.payload
          reveal.close()
          if (which) setRevealed(prev => ({ ...prev, [which]: true }))
        }}
      />

      <ConfirmSheet
        visible={endConfirm.visible}
        onClose={endConfirm.close}
        title="End this stream?"
        message="Everyone watching is disconnected and the broadcast is closed."
        confirmLabel="End stream"
        destructive
        onConfirm={endStream}
      />

      <ConfirmSheet
        visible={deleteConfirm.visible}
        onClose={deleteConfirm.close}
        title="Delete this stream?"
        message="The stream, its viewers and its recording are all removed. This can't be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={removeStream}
      />
    </Screen>
  )
}

function SecretRow({
  label, value, shown, note, onReveal, onCopy,
}: {
  label: string
  value: string | null
  shown: boolean
  note?: string
  onReveal: () => void
  onCopy: () => void
}) {
  const t = useTheme()
  const c = t.colors
  return (
    <View style={styles.secretRow}>
      <View style={styles.secretHead}>
        <Text variant="subhead" align="ui" style={styles.flex}>{label}</Text>
        {shown ? (
          <Touchable onPress={onCopy} feedback="dim" accessibilityLabel={`Copy the ${label} URL`}>
            <Icon name="copy" size={18} color={c.accent} />
          </Touchable>
        ) : (
          <Touchable onPress={onReveal} feedback="dim" accessibilityLabel={`Reveal the ${label} URL`}>
            <Text variant="subhead" tone="accent" align="ui">Reveal</Text>
          </Touchable>
        )}
      </View>
      {/* mono is not decoration: a broadcaster transcribes this into OBS by
          eye, and 0/O and l/1/I have to stay apart. The primitive resolves
          IBMPlexMono — a call-site `fontFamily: 'monospace'` only ever
          resolved on Android. */}
      <Text
        variant="footnote"
        mono
        tone={shown ? 'default' : 'faint'}
        align="ui"
        selectable={shown}
        numberOfLines={shown ? 3 : 1}
      >
        {shown ? (value || '—') : '••••••••••••••••'}
      </Text>
      {note ? <Text variant="caption" tone="muted" align="ui" style={styles.secretNote}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md, margin: space.lg, padding: space.md },
  thumb: { width: 72, height: 54, alignItems: 'center', justifyContent: 'center' },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  statusPill: { paddingHorizontal: space.xs2, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  group: { paddingHorizontal: space.lg, gap: space.md2 },
  saveBtn: { alignSelf: 'flex-end' },
  card: { marginHorizontal: space.lg, overflow: 'hidden' },
  cardBtn: { margin: space.md },
  monoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md2 },
  secretRow: { padding: space.md2, gap: space.xs2 },
  secretHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  secretNote: { marginTop: space.xxs },
  chipSlot: { width: 60 },
  backRow: { alignItems: 'center', paddingBottom: space.xxl },
  tail: { height: 20 },
  flex: { flex: 1 },
})
