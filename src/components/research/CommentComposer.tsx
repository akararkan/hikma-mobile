/* =========================================================
   CommentComposer — the docked input.

   Three contracts it has to honour exactly:

   1. Reply depth is 1. Replying to a reply must target the
      ROOT (`reply.parentId ?? reply.id`) — the server hoists it
      anyway, and pre-empting that keeps the local tree honest
      instead of showing a nesting level that will not survive
      a refresh.
   2. A moderation refusal (CONTENT_REJECTED) shows
      `moderationText(err)` verbatim, keeps the draft, and gets
      NO retry button. A precise error plus a retry is a working
      oracle for probing the classifier.
   3. A 429 keeps the draft and counts down. The limit is ten
      comments per thirty seconds.
   ========================================================= */
import React from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio'
import { adapters, api, codeOf, errorText, isRateLimited } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { prepareUpload } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { useDockInset } from '@/hooks/useDockInset'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, Spinner, Text, Touchable, toast } from '@/ui'
import { useCooldown } from './hooks'
import type { Author, ResearchComment } from './types'

const MAX = 5000
const COUNTER_FROM = 4500

export interface CommentComposerProps {
  researchId: string
  /** The ROOT comment id when replying; null for a top-level comment. */
  parentId?: string | null
  replyToHandle?: string | null
  onCancelReply?: () => void
  /** Fixed reply target (the thread screen) — no dismiss affordance. */
  lockedReply?: boolean
  viewer?: Author | null
  disabled?: boolean
  disabledReason?: string | null
  onSent: (comment: ResearchComment) => void
}

export function CommentComposer({
  researchId, parentId, replyToHandle, onCancelReply, lockedReply,
  viewer, disabled, disabledReason, onSent,
}: CommentComposerProps) {
  const t = useTheme()
  const c = t.colors
  const [text, setText] = React.useState('')
  const [asset, setAsset] = React.useState<ImagePicker.ImagePickerAsset | null>(null)
  /* The length is captured at STOP, not derived later: the file is the only
     other place it lives and nothing on this screen decodes it. Without it
     every voice comment renders a 0:00 clock (social.md, AddCommentRequest). */
  const [voice, setVoice] = React.useState<{ uri: string; seconds: number | null } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [moderation, setModeration] = React.useState<string | null>(null)
  const [mentions, setMentions] = React.useState<Author[]>([])
  const [cooldown, startCooldown] = useCooldown()

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [recording, setRecording] = React.useState(false)

  const inputRef = React.useRef<TextInput>(null)

  React.useEffect(() => {
    if (replyToHandle) {
      /* A REAL @mention, not a bare word: handles are stored without the '@'
         (adapters.handleOf), so writing the raw handle produced replies that
         opened with "soran " — no link, no mention notification. The at-sign
         is what makes the server parse it as a mention and the row render it
         as one. */
      setText(prev => (prev.startsWith(`@${replyToHandle} `) ? prev : `@${replyToHandle} `))
      inputRef.current?.focus()
    }
  }, [replyToHandle])

  /* The composer's own mention autocomplete. `mentions.suggest` is the right
     source rather than user search: it is block-aware and excludes you. */
  React.useEffect(() => {
    const m = /@(\w{1,})$/.exec(text)
    if (!m) { setMentions([]); return }
    let alive = true
    const id = setTimeout(() => {
      void api.mentions.suggest(m[1], 6)
        .then((rows: Author[]) => { if (alive) setMentions(rows || []) })
        .catch(() => { if (alive) setMentions([]) })
    }, 220)
    return () => { alive = false; clearTimeout(id) }
  }, [text])

  const pickMention = (u: Author) => {
    /* `handle` is bare (no '@') — the replacement has to put the at-sign back
       or picking a suggestion DELETED the '@' the user had just typed and the
       mention never became one. Same convention as qna's applyMention. */
    setText(prev => prev.replace(/@(\w{1,})$/, `@${u.handle} `))
    setMentions([])
    void Promise.resolve(api.mentions.click(u.handle, u.id)).catch(() => {})
  }

  const pickMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      selectionLimit: 1,
    })
    if (!res.canceled && res.assets?.[0]) { setAsset(res.assets[0]); setVoice(null) }
  }

  const toggleRecord = async () => {
    if (recording) {
      /* Read the clock BEFORE stopping — stop() resets currentTime. */
      const seconds = Math.max(1, Math.round(recorder.currentTime || 0))
      await recorder.stop()
      setRecording(false)
      if (recorder.uri) { setVoice({ uri: recorder.uri, seconds }); setAsset(null) }
      return
    }
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) { toast.warn('Microphone access is needed to record a voice note.'); return }
    await recorder.prepareToRecordAsync()
    recorder.record()
    setRecording(true)
  }

  const canSend = !busy && !disabled && cooldown === 0 && (text.trim().length > 0 || !!asset || !!voice)

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setError(null)
    setModeration(null)
    const body = text.trim()
    try {
      let raw: any
      if (asset || voice) {
        const fd = new FormData()
        fd.append('data', JSON.stringify({
          content: body,
          parentId: parentId ?? null,
          /* voiceUrl/voiceS3Key are the server's to mint from the part it
             received; the duration is the one thing only this client knows. */
          ...(voice?.seconds ? { voiceDurationSeconds: voice.seconds } : {}),
        }))
        /* `quality: 0.9` on the picker re-encodes but never resizes, so the
           tier pass has to happen here or a camera original goes on the wire
           at full sensor size. Videos pass straight through. */
        if (asset) fd.append('media', toUploadFile(await prepareUpload(asset)) as any)
        if (voice) fd.append('voice', toUploadFile({ uri: voice.uri, name: 'voice.m4a', mimeType: 'audio/mp4' }) as any)
        raw = await api.research.addCommentUpload(researchId, fd)
      } else {
        /* The JS module's `parentId = null` default types the param as `null`. */
        raw = await api.research.addComment(researchId, body, (parentId ?? null) as any)
      }
      /* A double send is absorbed by the server's dedup window and comes back
         as the EXISTING row, so a retry can never duplicate. */
      onSent(adapters.researchCommentFrom(raw) as ResearchComment)
      setText('')
      setAsset(null)
      setVoice(null)
      onCancelReply?.()
    } catch (e: any) {
      if (isBlocked(e)) { setModeration(moderationText(e)); return }
      if (isRateLimited(e)) { startCooldown(e); return }
      setError(errorText(e))
      if (codeOf(e) === 'INVALID_PARENT' || codeOf(e) === 'PARENT_DELETED') onCancelReply?.()
    } finally {
      setBusy(false)
    }
  }

  /* DESIGN.md §8: a bottom-anchored bar owns its own safe-area edge — Android
     is edge-to-edge, and without this the input sits UNDER the gesture bar /
     navigation buttons (a fixed padding is a bug on every gesture-nav device).
     But only while the keyboard is CLOSED, which is what useDockInset encodes:
     the host screens' KeyboardAvoidingView already pads by the full overlap
     with the keyboard, so keeping the inset while it is open stacks a ~34pt
     dead band above the keys on home-indicator devices. The hook returns 0 the
     moment the keyboard is up, and Math.max floors us at the base 8. */
  const dock = useDockInset()
  const dockPad = { paddingBottom: Math.max(dock, 8) }

  if (disabled) {
    return (
      <View style={[styles.dock, dockPad, { borderTopColor: c.separator, backgroundColor: c.bg }]}>
        <Text variant="footnote" tone="muted" align="center" style={{ paddingVertical: space.md }}>
          {disabledReason || 'Comments are turned off for this paper.'}
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.dock, dockPad, { borderTopColor: c.separator, backgroundColor: c.bg }]}>
      {mentions.length ? (
        <View style={[styles.mentionRail, { borderBottomColor: c.separator }]}>
          {mentions.map(u => (
            <Touchable key={u.id} onPress={() => pickMention(u)} feedback="tint" noAutoHitSlop style={styles.mentionRow}>
              <Avatar uri={u.profileImage} name={u.full} seed={u.id} size={24} />
              <Text variant="footnote" weight="600" align="ui" numberOfLines={1}>{u.full}</Text>
              <Text variant="caption" tone="faint" numberOfLines={1}>@{u.handle}</Text>
            </Touchable>
          ))}
        </View>
      ) : null}

      {moderation ? (
        <Text variant="footnote" tone="warning" align="ui" style={styles.notice}>{moderation}</Text>
      ) : error ? (
        <Text variant="footnote" tone="danger" align="ui" style={styles.notice}>{error}</Text>
      ) : null}

      {replyToHandle ? (
        <View style={[styles.replyBar, { backgroundColor: c.surfaceSunken }]}>
          <Icon name="reply" size={14} color={c.textMuted} />
          {/* The '@' is added here — handles are stored bare, and every other
              surface (post composer, qna rows) shows the prefixed form. */}
          <Text variant="caption" tone="muted" align="ui" style={styles.flex}>Replying to @{replyToHandle}</Text>
          {!lockedReply ? (
            <Touchable onPress={onCancelReply} feedback="dim" accessibilityLabel="Cancel reply">
              <Icon name="close" size={14} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>
      ) : null}

      {asset ? (
        <View style={styles.attachRow}>
          <Image source={{ uri: asset.uri }} style={[styles.attachThumb, { borderRadius: t.radius.xs }]} contentFit="cover" />
          <Text variant="caption" tone="muted" style={styles.flex} numberOfLines={1}>
            {asset.fileName || 'Attachment ready'}
          </Text>
          <Touchable onPress={() => setAsset(null)} feedback="dim" accessibilityLabel="Remove attachment">
            <Icon name="close" size={15} color={c.textMuted} />
          </Touchable>
        </View>
      ) : null}

      {voice ? (
        <View style={styles.attachRow}>
          <Icon name="mic" size={16} color={c.accent} />
          <Text variant="caption" tone="muted" style={styles.flex}>Voice note ready</Text>
          <Touchable onPress={() => setVoice(null)} feedback="dim" accessibilityLabel="Remove voice note">
            <Icon name="close" size={15} color={c.textMuted} />
          </Touchable>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        {viewer ? <Avatar uri={viewer.profileImage} name={viewer.full} seed={viewer.id} size={30} /> : null}

        <View style={[styles.inputBox, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.lg }]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            multiline
            maxLength={MAX}
            style={[
              styles.input,
              {
                color: c.text,
                fontSize: t.type.body.fontSize,
                lineHeight: t.type.body.lineHeight,
                textAlign: t.isRTL ? 'right' : 'left',
                maxHeight: t.type.body.lineHeight * 6 + 16,
              },
            ]}
          />
          {text.length > COUNTER_FROM ? (
            <Text variant="micro" tone={text.length >= MAX ? 'danger' : 'muted'} align="ui">
              {MAX - text.length}
            </Text>
          ) : null}
        </View>

        <Touchable onPress={pickMedia} feedback="scale" accessibilityLabel="Attach media" style={styles.iconBtn}>
          <Icon name="attachment" size={20} color={c.textMuted} />
        </Touchable>
        <Touchable onPress={toggleRecord} feedback="scale" accessibilityLabel="Record voice note" style={styles.iconBtn}>
          <Icon name={recording ? 'pause' : 'mic'} size={20} color={recording ? c.danger : c.textMuted} />
        </Touchable>

        <Touchable
          onPress={send}
          disabled={!canSend}
          feedback="scale"
          haptic="light"
          accessibilityLabel="Send comment"
          style={[styles.send, { backgroundColor: canSend ? c.accent : c.surfaceSunken }]}
        >
          {busy ? (
            <Spinner style={styles.tight} />
          ) : cooldown > 0 ? (
            <Text variant="caption" tone="muted">{cooldown}s</Text>
          ) : (
            <Icon name="send" size={17} color={canSend ? c.textOnAccent : c.textFaint} />
          )}
        </Touchable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.xs2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  inputBox: { flex: 1, paddingHorizontal: space.md, paddingVertical: Platform.OS === 'ios' ? 8 : 2, minHeight: 40, justifyContent: 'center' },
  input: { padding: 0, margin: 0 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  send: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  /* Carries the "Replying to @…" line, so it is a text-bearing chip plate
     and takes the chip setback rather than a pill radius. */
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.md, marginBottom: space.xs2,
    paddingHorizontal: space.sm2, height: 32, ...setback(shape.chip), borderCurve: 'continuous',
  },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md2, paddingBottom: space.sm },
  attachThumb: { width: 38, height: 38 },
  mentionRail: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: space.xs },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md2, paddingVertical: space.sm },
  notice: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  tight: { padding: 0 },
  flex: { flex: 1 },
})
