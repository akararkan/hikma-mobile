/* =========================================================
   The channel composer — new post, edit, and schedule.

   `clientNonce` is generated ONCE per composer session and kept
   in a ref. That is what makes a retry idempotent: the same
   nonce means the server recognises the second attempt as the
   first one, and the feed's echo can match the optimistic bubble
   instead of duplicating it.

   NOTE: a LIVE post's attachments go out through
   `chat.messages.sendFiles` (the documented multipart path),
   which hands the files to the server and lets it build the refs
   itself — simpler, and one round trip.

   A SCHEDULED post cannot use that route: `scheduled.create`
   takes MediaRefDto[] only. So that branch uploads through the
   media pipeline first and builds the refs here, deriving each
   `storageKey` from the proxy url per media-proxy.md (see
   src/lib/mediaRef.ts). Files and voice notes are still refused
   when scheduled — the media pipeline has no FILE type.

   Sending clears the server draft server-side, so nothing here
   re-saves a draft it has just sent.
   ========================================================= */
import React from 'react'
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
/* The controller's KAV, never RN's: the window is edge-to-edge, so it never
   resizes for the IME and RN's KAV with no Android `behavior` is a plain View. */
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { api, codeOf, errorText, isNetworkError } from '@/api'
import { isNsfwBlocked } from '@/lib/moderation'
import { toUploadFile } from '@/platform/files.js'
import { mediaRefFrom, type MediaRef } from '@/lib/mediaRef'
import { prepareUploads } from '@/lib/mediaTier'
import { checkAssets } from '@/lib/fileMeta'
import { useAuth } from '@/context/AuthContext'
import { useCooldown } from '@/hooks/useCooldown'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useDockInset } from '@/hooks/useDockInset'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Callout, Chip, ChipRail, ConfirmSheet, Header, Icon,
  ListRow, RowGroup, Screen, Text, Touchable, fireHaptic, formatCount, toast,
  useSheetState,
} from '@/ui'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'
import { RecordingOverlay, useVoiceRecorder } from '@/components/chat/VoiceRecorder'
import { durationLabel } from '@/components/chat/format'

const MAX_ATTACHMENTS = 10
const MAX_BODY = 8000
const COUNTER_FROM = 7500

interface Attachment {
  key: string
  uri: string
  fileName: string
  mimeType: string
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE'
  durationMs?: number | null
  /** VOICE only — the recorder's sampled amplitudes, riding the multipart
   *  `waveform` part so receivers can draw the real shape. */
  waveform?: string
}

interface PollDraft {
  question: string
  options: string[]
  anonymous: boolean
  multiple: boolean
  quiz: boolean
  correctIndex: number
  explanation: string
}

const emptyPoll = (): PollDraft => ({
  question: '',
  options: ['', ''],
  anonymous: true,
  multiple: false,
  quiz: false,
  correctIndex: 0,
  explanation: '',
})

export default function ComposeScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  /* Now that the KAV actually pads on Android too, the toolbar's own
     insets.bottom would stack on top of the keyboard overlap and leave a
     strip of dead wallpaper above the keys. useDockInset returns 0 while
     the keyboard is up — see the hook header. */
  const dock = useDockInset()
  const { user } = useAuth()
  const { id, editId, preset, body: presetBody } =
    useLocalSearchParams<{ id: string; editId?: string; preset?: string; body?: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel

  const [body, setBody] = React.useState(presetBody || '')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [poll, setPoll] = React.useState<PollDraft | null>(preset === 'poll' ? emptyPoll() : null)
  const [silent, setSilent] = React.useState(false)
  const [scheduledAt, setScheduledAt] = React.useState<Date | null>(null)
  const [showPicker, setShowPicker] = React.useState(false)

  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [refusal, setRefusal] = React.useState<any>(null)
  const [draftRestored, setDraftRestored] = React.useState(false)
  const [draftSaved, setDraftSaved] = React.useState(false)
  const [cooldown, startCooldown] = useCooldown()

  const [mentions, setMentions] = React.useState<any[]>([])
  const [tags, setTags] = React.useState<any[]>([])
  const [token, setToken] = React.useState<{ kind: '@' | '#'; text: string; start: number } | null>(null)

  const cancelSheet = useSheetState()
  const swapConfirm = useSheetState()
  const attachMenu = useSheetState<number>()

  /* Voice notes: the same recorder the chat composer holds, driven tap-first
     here — a full-screen composer has room for explicit Send/Discard, so the
     recording opens already "locked" instead of behind a hold gesture. */
  const rec = useVoiceRecorder()
  const recRef = React.useRef(rec)
  recRef.current = rec
  React.useEffect(() => () => { if (recRef.current.active) void recRef.current.cancel() }, [])

  /* ONE nonce for the life of this composer — a retry must not double-post. */
  const nonceRef = React.useRef(api.chat.newNonce())
  /* The exact body a policy refusal was about. Re-sending it produces the same
     refusal, so the action stays disabled until the text actually changes. */
  const [rejectedBody, setRejectedBody] = React.useState<string | null>(null)
  const isEdit = !!editId

  /* ---- draft ---- */

  React.useEffect(() => {
    if (!id || isEdit || presetBody) return
    let alive = true
    api.chat.drafts.get(id)
      .then((d: any) => {
        if (!alive || !d || d.empty) return
        setBody(d.body || '')
        setDraftRestored(true)
        setTimeout(() => alive && setDraftRestored(false), 4000)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [id, isEdit, presetBody])

  React.useEffect(() => {
    if (!id || isEdit) return
    const timer = setTimeout(() => {
      if (!body.trim() && !attachments.length) return
      api.chat.drafts.save(id, args({ body }))
        .then(() => { setDraftSaved(true); setTimeout(() => setDraftSaved(false), 1600) })
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [id, isEdit, body, attachments.length])

  /* ---- edit mode seeds from the post itself ---- */

  React.useEffect(() => {
    if (!editId) return
    api.chat.messages.get(editId)
      .then((m: any) => { if (m) setBody(m.body || '') })
      .catch((e: any) => setError(e))
  }, [editId])

  /* ---- '@' and '#' autocomplete ---- */

  const onChangeBody = (value: string, selection?: number) => {
    setBody(value)
    const caret = selection ?? value.length
    const upTo = value.slice(0, caret)
    const m = /(^|\s)([@#])([\p{L}\p{N}_]*)$/u.exec(upTo)
    setToken(m ? { kind: m[2] as '@' | '#', text: m[3], start: caret - m[3].length - 1 } : null)
  }

  React.useEffect(() => {
    if (!token) { setMentions([]); setTags([]); return }
    const timer = setTimeout(() => {
      if (token.kind === '@' && token.text.length >= 1) {
        api.mentions.suggest(token.text, 6).then(setMentions).catch(() => {})
      } else if (token.kind === '#') {
        api.tags.search(args({ prefix: token.text, scope: 'ALL', limit: 8 })).then(setTags).catch(() => {})
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [token])

  const applyToken = (replacement: string, picked?: any) => {
    if (!token) return
    const before = body.slice(0, token.start)
    const after = body.slice(token.start + 1 + token.text.length)
    setBody(`${before}${replacement} ${after}`)
    setToken(null)
    setMentions([])
    setTags([])
    if (picked?.id) void api.mentions.click(token.text, picked.id).catch(() => {})
  }

  /* ---- attachments ---- */

  const addAssets = async (kind: 'library' | 'camera' | 'file') => {
    if (poll) { swapConfirm.open(); return }
    if (attachments.length >= MAX_ATTACHMENTS) return
    try {
      if (kind === 'file') {
        const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
        if (res.canceled) return
        const { ok: docs, rejected } = checkAssets(res.assets, 'chat')
        rejected.forEach(v => toast.warn(`${v.asset.name || 'File'}: ${v.reason}`))
        if (!docs.length) return
        pushAssets(docs.map((a: any) => ({
          uri: a.uri, fileName: a.name, mimeType: a.mimeType || 'application/octet-stream', kind: 'FILE' as const,
        })))
        return
      }
      const perm = kind === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { toast.warn('Permission is off — enable it in Settings.'); return }

      const res = kind === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: MAX_ATTACHMENTS - attachments.length,
          quality: 0.9,
        })
      if (res.canceled || !res.assets?.length) return
      const { ok: accepted, rejected } = checkAssets(res.assets, 'chat')
      rejected.forEach(v => toast.warn(`${v.asset.fileName || 'File'}: ${v.reason}`))
      if (!accepted.length) return
      /* prepareUploads honours the user's media tier before the bytes leave —
         `quality` re-encodes but never resizes, so without this a camera
         original goes on the wire at full sensor size. Videos pass through. */
      const ready = await prepareUploads(accepted as any)
      pushAssets(ready.map(a => ({
        uri: a.uri,
        fileName: a.fileName || 'upload',
        mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        kind: (a.type === 'video' ? 'VIDEO' : 'IMAGE') as 'VIDEO' | 'IMAGE',
        durationMs: a.duration ?? null,
      })))
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  const pushAssets = (list: Omit<Attachment, 'key'>[]) => {
    setAttachments(prev => [
      ...prev,
      ...list.slice(0, MAX_ATTACHMENTS - prev.length).map((a, i) => ({ ...a, key: `${Date.now()}-${i}` })),
    ])
  }

  const move = (index: number, delta: number) => {
    setAttachments(prev => {
      const next = [...prev]
      const to = index + delta
      if (to < 0 || to >= next.length) return prev
      const [row] = next.splice(index, 1)
      next.splice(to, 0, row)
      return next
    })
    fireHaptic('select')
  }

  /* ---- voice note ---- */

  const hasVoice = attachments.some(a => a.kind === 'VOICE')

  const startVoice = async () => {
    if (poll) { swapConfirm.open(); return }
    if (hasVoice) { toast.warn('One voice note per post — remove the current one first.'); return }
    if (attachments.length >= MAX_ATTACHMENTS) return
    const ok = await rec.start()
    if (ok) rec.setLocked(true)
  }

  const finishVoice = async () => {
    const result = await rec.finish()
    if (!result) return
    pushAssets([{
      uri: result.uri,
      fileName: result.name,
      mimeType: result.type,
      kind: 'VOICE',
      durationMs: result.durationMs,
      waveform: result.waveform,
    }])
  }

  /* ---- poll ---- */

  const openPoll = () => {
    if (attachments.length) { swapConfirm.open(); return }
    setPoll(p => p ?? emptyPoll())
  }

  const pollValid = !!poll && !!poll.question.trim() && poll.options.filter(o => o.trim()).length >= 2

  /* ---- send ---- */

  const canSend =
    !busy && cooldown === 0 &&
    (rejectedBody === null || body.trim() !== rejectedBody) &&
    (!!body.trim() || attachments.length > 0 || pollValid)

  const primaryLabel = isEdit ? 'Save' : scheduledAt ? 'Schedule' : 'Post'

  const send = async () => {
    if (!canSend) return
    /* Narrow refusal: photos and videos schedule fine now, but the media
       pipeline has no FILE type and stores audio as octet-stream, so those two
       kinds still have to go out live. */
    if (scheduledAt && attachments.some(a => a.kind === 'FILE' || a.kind === 'VOICE')) {
      toast.warn('Files and voice notes can’t be scheduled — post it now, or remove them.')
      return
    }
    if (scheduledAt && pollValid) {
      /* ScheduleMessageRequest has no `poll` field — a queued POLL would fail
         the type-payload match when it fires. Refused up front, like files. */
      toast.warn('Polls can’t be scheduled — post it now, or remove the poll.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isEdit) {
        await api.chat.messages.edit(editId!, body.trim())
        router.back()
        toast.ok('Post updated')
        return
      }

      if (scheduledAt) {
        /* Upload first, schedule second, both inside this try: a failed upload
           must leave nothing queued. The nonce is stable across retries, so a
           second attempt cannot double-post. */
        const media: MediaRef[] = []
        for (const a of attachments) {
          const file = toUploadFile({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType })
          const kind = String(file.type || '').startsWith('video') ? 'VIDEO' : 'IMAGE'
          const uploaded: any = await api.media.upload(file, { type: kind })
          const ref = mediaRefFrom(uploaded, kind, file)
          if (!ref) {
            /* Refuse loudly rather than queue a post whose media the server
               cannot resolve when it fires — hours later, with nobody
               watching. */
            const refusal: any = new Error('That upload finished without a usable address, so nothing was scheduled.')
            refusal.status = 'NO_PUBLIC_URL'
            throw refusal
          }
          media.push(ref)
        }
        await api.chat.scheduled.create(id, args({
          scheduledAt: scheduledAt.toISOString(),
          clientNonce: nonceRef.current,
          /* The type has to match the payload the way the live send's
             classifier does — a queued IMAGE post announced as TEXT fails the
             type-payload check at fire time. Polls are refused above. */
          type: media.length ? media[0].kind : 'TEXT',
          body: body.trim(),
          media: media.length ? media : undefined,
          /* The toggle means the same thing whenever the post lands, so it
             travels with the schedule row rather than being quietly dropped
             the moment a send-later time is picked. */
          silent: silent || undefined,
        }))
        router.back()
        toast.ok(`Scheduled for ${scheduledAt.toLocaleString()}`, {
          label: 'View queue',
          onPress: () => router.push(chRoute.scheduled(id)),
        })
        return
      }

      if (attachments.length) {
        /* The multipart classifier labels audio/* parts VOICE server-side;
           durationMs + waveform ride the documented single-value parts, so
           they describe the (single) voice note when one is attached. */
        const voice = attachments.find(a => a.kind === 'VOICE')
        await api.chat.messages.sendFiles(id, args({
          clientNonce: nonceRef.current,
          body: body.trim(),
          files: attachments.map(a => toUploadFile({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType })),
          durationMs: voice?.durationMs ?? undefined,
          waveform: voice?.waveform || undefined,
        }))
      } else {
        await api.chat.messages.send(id, args({
          clientNonce: nonceRef.current,
          type: pollValid ? 'POLL' : 'TEXT',
          body: body.trim(),
          silent: silent || undefined,
          poll: pollValid ? {
            question: poll!.question.trim(),
            /* PollCreateDto.options is a list of STRINGS (2–10, display
               order) — an object per option fails deserialisation. */
            options: poll!.options.map(o => o.trim()).filter(Boolean),
            anonymous: poll!.anonymous,
            allowsMultipleAnswers: poll!.multiple && !poll!.quiz,
            quiz: poll!.quiz,
            /* Index into the FILTERED list — blank options are dropped above,
               so the raw editor index would drift past them. */
            correctOptionIndex: poll!.quiz
              ? poll!.options.slice(0, poll!.correctIndex).filter(o => o.trim()).length
              : undefined,
            explanation: poll!.quiz ? poll!.explanation.trim() || undefined : undefined,
          } : undefined,
        }))
      }
      /* The feed reconciles from its own message.new frame, matching on the
         nonce — closing immediately is the fast path, not a shortcut. */
      router.back()
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'CONTENT_BLOCKED_BY_POLICY' || code === 'CONTENT_REJECTED') {
        setRejectedBody(body.trim())
        setError(e)
        return
      }
      if (e?.status === 403) { setRefusal(e); return }
      if (e?.status === 429) { startCooldown(e); setError(e); return }
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  /* ---- gates ---- */

  if (refusal || (!rights.loading && channel && !rights.can('canPostMessages'))) {
    return (
      <Screen>
        <Header closeButton title="New post" />
        <RefusalCard
          error={refusal}
          title="You can’t post in this channel"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  /* The image gate's refusal takes the same no-retry presentation as a text
     rejection — the offender is an attachment, so the draft (body, files,
     poll) stays and the user drops the flagged file and posts again. */
  const blocked = ['CONTENT_BLOCKED_BY_POLICY', 'CONTENT_REJECTED'].includes(codeOf(error)) || isNsfwBlocked(error)
  const showCounter = body.length >= COUNTER_FROM
  const dirty = !!body.trim() || attachments.length > 0 || !!poll

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirty && !isEdit, cancelSheet.open)

  return (
    <Screen>
      <Header
        closeButton
        back={() => (dirty && !isEdit ? cancelSheet.open() : router.back())}
        title={isEdit ? 'Edit post' : scheduledAt ? 'Schedule post' : 'New post'}
        subtitle={channel?.title}
        actions={[{
          icon: busy ? 'hourglass' : 'send',
          onPress: send,
          label: primaryLabel,
          tone: canSend ? 'accent' : 'default',
        }]}
      />

      {/* The controller measures this view's real on-screen frame, so the
          header above it is already accounted for — the hand-rolled
          insets.top + headerHeight offset RN's KAV needed is now double
          counting, and 0 is correct on both platforms. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={[styles.flex, { opacity: busy ? 0.6 : 1 }]}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.xxl }}
          scrollEnabled={!busy}
        >
          {draftRestored ? (
            <View style={styles.banner}>
              <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>Draft restored</Text>
              <Touchable
                onPress={() => { setBody(''); void api.chat.drafts.discard(id).catch(() => {}); setDraftRestored(false) }}
                feedback="dim"
              >
                <Text variant="footnote" tone="accent">Discard</Text>
              </Touchable>
            </View>
          ) : null}

          {blocked ? (
            <View style={{ padding: t.layout.screenPadding }}>
              {/* No retry: the same body will be refused again. The draft stays
                  exactly as typed and the action re-enables on an edit. */}
              <Callout tone="danger" title="This can’t be published">{errorText(error)}</Callout>
            </View>
          ) : error && !isNetworkError(error) ? (
            <View style={{ padding: t.layout.screenPadding }}>
              <Callout tone="danger">{errorText(error)}</Callout>
            </View>
          ) : null}

          {channel?.settings?.signMessages ? (
            <View style={[styles.signature, { borderBottomColor: c.separator }]}>
              <Avatar uri={user?.profileImage} name={user?.displayName || user?.full} seed={user?.id} size={20} />
              <Text variant="caption" tone="secondary" align="ui">@{user?.handle || user?.handle}</Text>
              <Text variant="caption" tone="muted" align="ui">will be shown on this post</Text>
            </View>
          ) : null}

          <TextInput
            value={body}
            onChangeText={v => onChangeBody(v)}
            onSelectionChange={e => onChangeBody(body, e.nativeEvent.selection.start)}
            placeholder={`Write to ${formatCount(channel?.subscriberCount)} subscribers…`}
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            multiline
            maxLength={MAX_BODY}
            autoFocus={!isEdit}
            editable={!busy}
            style={[
              styles.input,
              {
                color: c.text,
                textAlign: t.isRTL ? 'right' : 'left',
                paddingHorizontal: t.layout.screenPadding,
              },
            ]}
          />

          {showCounter ? (
            <Text variant="caption" tone={body.length >= MAX_BODY ? 'danger' : 'muted'} align="ui" style={styles.counter}>
              {body.length}/{MAX_BODY}
            </Text>
          ) : null}

          {token?.kind === '#' && tags.length ? (
            <ChipRail style={{ paddingVertical: space.sm }}>
              {tags.map((tag: any) => (
                <Chip
                  key={tag.tag}
                  label={`#${tag.tag}${tag.usageCount ? ` · ${formatCount(tag.usageCount)}` : ''}`}
                  tone="accent"
                  onPress={() => applyToken(`#${tag.tag}`)}
                />
              ))}
            </ChipRail>
          ) : null}

          {token?.kind === '@' && mentions.length ? (
            <View style={{ paddingVertical: space.xs }}>
              {mentions.slice(0, 5).map((m: any) => (
                <Touchable key={m.id} onPress={() => applyToken(`@${m.handle}`, m)} feedback="tint" noAutoHitSlop style={styles.mentionRow}>
                  <Avatar uri={m.profileImage} name={m.full} seed={m.id} size={28} />
                  <Text variant="subhead" numberOfLines={1} style={styles.flex}>{m.full}</Text>
                  <Text variant="caption" tone="muted">@{m.handle}</Text>
                </Touchable>
              ))}
            </View>
          ) : null}

          {poll ? (
            <PollEditor poll={poll} onChange={setPoll} onClose={() => setPoll(null)} />
          ) : attachments.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {attachments.map((a, i) => (
                <Touchable
                  key={a.key}
                  onLongPress={() => attachMenu.open(i)}
                  feedback="scale"
                  noAutoHitSlop
                  style={[styles.thumb, { backgroundColor: c.surfaceSunken }]}
                >
                  {a.kind === 'VOICE' ? (
                    <View style={[styles.center, { backgroundColor: c.accentSoft }]}>
                      <Icon name="mic" size={22} color={c.accentText} />
                      <Text variant="micro" color={c.accentText} align="center" numberOfLines={1}>
                        {durationLabel(a.durationMs || 0)}
                      </Text>
                    </View>
                  ) : a.kind === 'FILE' ? (
                    <View style={styles.center}>
                      <Icon name="file" size={22} color={c.textMuted} />
                      <Text variant="micro" tone="muted" align="center" numberOfLines={1}>{a.fileName}</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} />
                  )}
                  {a.kind === 'VIDEO' ? (
                    <View style={[styles.badge, { backgroundColor: c.overlayChip }]}>
                      <Icon name="play" size={10} color={c.overlayText} filled />
                    </View>
                  ) : null}
                  <Touchable
                    onPress={() => setAttachments(prev => prev.filter(x => x.key !== a.key))}
                    feedback="dim"
                    accessibilityLabel="Remove attachment"
                    style={[styles.remove, { backgroundColor: c.overlayChip }]}
                  >
                    <Icon name="close" size={11} color={c.overlayText} />
                  </Touchable>
                </Touchable>
              ))}
              {attachments.length < MAX_ATTACHMENTS ? (
                <Touchable
                  onPress={() => void addAssets('library')}
                  feedback="scale"
                  noAutoHitSlop
                  accessibilityLabel="Add photos"
                  style={[styles.thumb, styles.center, { borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}
                >
                  <Icon name="add" size={22} color={c.textMuted} />
                </Touchable>
              ) : null}
            </ScrollView>
          ) : null}

          {silent ? (
            <Text variant="footnote" tone="muted" align="ui" style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.xs2 }}>
              Subscribers won’t get a notification.
            </Text>
          ) : null}

          {scheduledAt ? (
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm2 }}>
              <Callout tone="info" icon="clock" actionLabel="Clear" onAction={() => setScheduledAt(null)}>
                {`Goes out ${scheduledAt.toLocaleString()}`}
              </Callout>
            </View>
          ) : null}
        </ScrollView>

        {/* ---- toolbar ---- */}
        {/* The recorder's poll engine — null until a recording starts. */}
        {rec.engine}
        {rec.active ? (
          /* Recording replaces the toolbar row: explicit trash / send, no
             hold gesture to keep alive (unlike the chat composer's overlay). */
          <View style={{ paddingBottom: dock + 6 }}>
            <RecordingOverlay
              seconds={rec.seconds}
              meter={rec.meter}
              locked
              onCancel={() => { void rec.cancel() }}
              onSend={() => { void finishVoice() }}
            />
          </View>
        ) : (
          <View style={[styles.toolbar, { borderTopColor: c.separator, paddingBottom: dock + 6 }]}>
            {/* The tools scroll: seven buttons overflow a narrow phone, and a
                clipped row reads as "the feature doesn't exist". */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <ToolButton icon="image" label="Photos" onPress={() => void addAssets('library')} disabled={busy || isEdit} />
              <ToolButton icon="camera" label="Camera" onPress={() => void addAssets('camera')} disabled={busy || isEdit} />
              <ToolButton icon="mic" label="Voice note" onPress={() => void startVoice()} active={hasVoice} disabled={busy || isEdit} />
              <ToolButton icon="attachment" label="File" onPress={() => void addAssets('file')} disabled={busy || isEdit} />
              <ToolButton icon="poll" label="Poll" onPress={openPoll} active={!!poll} disabled={busy || isEdit} />
              <ToolButton icon="mutedBell" label="Silent" onPress={() => setSilent(s => !s)} active={silent} disabled={busy || isEdit} />
              <ToolButton icon="clock" label="Schedule" onPress={() => setShowPicker(true)} active={!!scheduledAt} disabled={busy || isEdit} />
            </ScrollView>
            {draftSaved ? <Text variant="micro" tone="muted" style={styles.draftNote}>Draft saved</Text> : null}
          </View>
        )}
      </KeyboardAvoidingView>

      {showPicker ? (
        <DateTimePicker
          value={scheduledAt ?? new Date(Date.now() + 60_000)}
          mode="datetime"
          /* The server refuses a past instant; a minute of headroom keeps a
             slow tap from becoming a validation error. */
          minimumDate={new Date(Date.now() + 60_000)}
          onChange={(_e, date) => { setShowPicker(Platform.OS === 'ios'); if (date) setScheduledAt(date) }}
        />
      ) : null}

      <ActionSheet
        visible={attachMenu.visible}
        onClose={attachMenu.close}
        title="Attachment"
        actions={[
          { label: 'Move earlier', icon: 'up', onPress: () => move(attachMenu.payload ?? 0, -1) },
          { label: 'Move later', icon: 'down', onPress: () => move(attachMenu.payload ?? 0, 1) },
          {
            label: 'Remove',
            icon: 'trash',
            destructive: true,
            onPress: () => setAttachments(prev => prev.filter((_, i) => i !== attachMenu.payload)),
          },
        ]}
      />

      <ConfirmSheet
        visible={swapConfirm.visible}
        onClose={swapConfirm.close}
        title={poll ? 'Remove the poll to attach files?' : 'Remove attachments to add a poll?'}
        message="A post can carry a poll or attachments, not both."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          swapConfirm.close()
          if (poll) setPoll(null)
          else { setAttachments([]); setPoll(emptyPoll()) }
        }}
      />

      <ActionSheet
        visible={cancelSheet.visible}
        onClose={cancelSheet.close}
        title="Keep this post?"
        actions={[
          {
            label: 'Save draft',
            icon: 'bookmark',
            onPress: async () => { await api.chat.drafts.save(id, args({ body })).catch(() => {}); router.back() },
          },
          {
            label: 'Discard',
            icon: 'trash',
            destructive: true,
            onPress: async () => { await api.chat.drafts.discard(id).catch(() => {}); router.back() },
          },
        ]}
        cancelLabel="Keep writing"
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Toolbar
   --------------------------------------------------------- */

function ToolButton({
  icon, label, onPress, active, disabled,
}: { icon: any; label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  const t = useTheme()
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="scale"
      haptic="light"
      accessibilityLabel={label}
      /* Interactive ink + a wash behind the engaged tool — the row must read
         as buttons, not decoration (the app-wide visibility rule). */
      style={{ padding: space.sm, borderRadius: t.radius.sm, backgroundColor: active ? t.colors.accentSoft : 'transparent' }}
    >
      <Icon name={icon} size={21} color={active ? t.colors.accent : t.colors.accentText} filled={active} />
    </Touchable>
  )
}

/* ---------------------------------------------------------
   Poll editor
   --------------------------------------------------------- */

function PollEditor({
  poll, onChange, onClose,
}: { poll: PollDraft; onChange: (p: PollDraft) => void; onClose: () => void }) {
  const t = useTheme()
  const c = t.colors

  const setOption = (i: number, text: string) =>
    onChange({ ...poll, options: poll.options.map((o, k) => (k === i ? text.slice(0, 100) : o)) })

  return (
    <View style={[styles.pollCard, { backgroundColor: c.surfaceSunken, marginHorizontal: t.layout.screenPadding, borderRadius: t.radius.md }]}>
      <View style={styles.pollHead}>
        <Icon name="poll" size={16} color={c.textSecondary} />
        <Text variant="subhead" weight="600" align="ui" style={styles.flex}>Poll</Text>
        <Touchable onPress={onClose} feedback="dim" accessibilityLabel="Remove poll">
          <Icon name="close" size={16} color={c.textMuted} />
        </Touchable>
      </View>

      <TextInput
        value={poll.question}
        onChangeText={v => onChange({ ...poll, question: v.slice(0, 300) })}
        placeholder="Ask a question"
        placeholderTextColor={c.textFaint}
        selectionColor={c.accent}
        style={[styles.pollInput, { color: c.text, backgroundColor: c.surface, borderRadius: t.radius.sm }]}
      />

      {poll.options.map((option, i) => (
        <View key={i} style={styles.optionRow}>
          {poll.quiz ? (
            <Touchable
              onPress={() => onChange({ ...poll, correctIndex: i })}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={`Mark option ${i + 1} correct`}
              style={[
                styles.radio,
                { borderColor: poll.correctIndex === i ? c.success : c.borderStrong, backgroundColor: poll.correctIndex === i ? c.success : 'transparent' },
              ]}
            >
              {poll.correctIndex === i ? <Icon name="check" size={11} color={c.textOnAccent} /> : null}
            </Touchable>
          ) : (
            <View style={[styles.radio, { borderColor: c.borderStrong }]} />
          )}
          <TextInput
            value={option}
            onChangeText={v => setOption(i, v)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            style={[styles.pollInput, styles.flex, { color: c.text, backgroundColor: c.surface, borderRadius: t.radius.sm }]}
          />
          {poll.options.length > 2 ? (
            <Touchable
              onPress={() => onChange({ ...poll, options: poll.options.filter((_, k) => k !== i) })}
              feedback="dim"
              accessibilityLabel={`Remove option ${i + 1}`}
            >
              <Icon name="close" size={15} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>
      ))}

      {poll.options.length < 10 ? (
        <Touchable onPress={() => onChange({ ...poll, options: [...poll.options, ''] })} feedback="dim" style={{ paddingVertical: space.sm }}>
          <Text variant="subhead" tone="accent" align="ui">Add option</Text>
        </Touchable>
      ) : null}

      <RowGroup inset={0} style={{ marginTop: space.xs2 }}>
        <ListRow
          title="Anonymous voting"
          accessory={{ kind: 'switch', value: poll.anonymous, onValueChange: v => onChange({ ...poll, anonymous: v }) }}
        />
        <ListRow
          title="Multiple answers"
          disabled={poll.quiz}
          accessory={{
            kind: 'switch',
            value: poll.multiple && !poll.quiz,
            disabled: poll.quiz,
            onValueChange: v => onChange({ ...poll, multiple: v }),
          }}
        />
        <ListRow
          title="Quiz mode"
          subtitle="One correct answer, revealed after voting"
          accessory={{
            kind: 'switch',
            value: poll.quiz,
            onValueChange: v => onChange({ ...poll, quiz: v, multiple: v ? false : poll.multiple }),
          }}
        />
      </RowGroup>

      {poll.quiz ? (
        <TextInput
          value={poll.explanation}
          onChangeText={v => onChange({ ...poll, explanation: v.slice(0, 200) })}
          placeholder="Explanation (shown after voting)"
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          multiline
          style={[styles.pollInput, { color: c.text, backgroundColor: c.surface, borderRadius: t.radius.sm, marginTop: space.sm, minHeight: 60 }]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm },
  signature: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm2, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { fontSize: 17, lineHeight: 25, minHeight: 140, paddingTop: space.md2, textAlignVertical: 'top' },
  counter: { paddingHorizontal: space.lg2, paddingBottom: space.xs },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm },
  strip: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm2 },
  thumb: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, padding: space.xs },
  badge: { position: 'absolute', left: 5, bottom: 5, padding: space.xs, borderRadius: 4 },
  remove: { position: 'absolute', top: 4, right: 4, padding: space.xs, borderRadius: 999 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingTop: space.xs2,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  draftNote: { paddingEnd: space.xs },
  pollCard: { padding: space.md, gap: space.sm, marginTop: space.md },
  pollHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pollInput: { paddingHorizontal: space.md, paddingVertical: space.sm2, fontSize: 15 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
})
