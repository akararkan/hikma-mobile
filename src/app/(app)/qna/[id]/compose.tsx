/* =========================================================
   Write an answer, or a depth-1 reply.

   MULTIPART ON REACT NATIVE is the one genuinely fragile part
   and the order of preference is deliberate:

     1. text-only  → the JSON endpoints, always
     2. documents  → post the answer, then addAttachment (a
                     single-`file` multipart with no JSON part —
                     the most robust shape on native)
     3. one inline media / one voice note → the *Upload
        endpoints, and if the `data` part fails to bind
        (400 MISSING_REQUEST_PART or a 415) write the JSON to a
        cache file and append it as a real file part

   RN's FormData appends a plain string with no content type,
   which Spring's @RequestPart may refuse — that is the whole
   reason step 3 exists.
   ========================================================= */
import React from 'react'
import { BackHandler, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { codeOf, detailsOf, errorText, fieldErrorMap, isNotFound, isTransient } from '@/api'
import { isBlocked, isNsfwBlocked, moderationText } from '@/lib/moderation'
import { prepareUpload, type PickedAsset } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Chip, ConfirmSheet, Field, Icon, IconButton, Screen, Spinner,
  Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'
import { qna, type CreateAnswerRequest } from '@/components/qna/api'
import { AnswerBodyEditor, type AnswerBodyEditorHandle } from '@/components/qna/AnswerBodyEditor'
import { emitQna } from '@/components/qna/events'
import { composerGate } from '@/components/qna/gate'
import { MentionAutocomplete } from '@/components/qna/MentionAutocomplete'
import { IndeterminateBar, QnaErrorView, QnaRefusal } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { SourceEditorSheet, type SourceFields } from '@/components/qna/SourceEditorSheet'
import { sourceGlyph } from '@/components/qna/SourceRow'
import { VoiceNotePlayer } from '@/components/qna/VoiceNotePlayer'
import { absolutise, hostOf, type QuestionView } from '@/components/qna/types'
import { VoiceRecordingSurface, useVoicePostRecorder } from '@/components/post/VoiceCapture'

const BODY_MAX = 10000

export default function AnswerComposerScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const gate = useAuthGate()
  const { user } = useAuth()
  const params = useLocalSearchParams<{
    id: string
    parentAnswerId?: string
    replyToAnswerId?: string
    replyToHandle?: string
    attach?: string
  }>()
  const id = params.id
  const [parentAnswerId, setParentAnswerId] = React.useState<string | undefined>(params.parentAnswerId)
  /* The answer this reply is AIMED at, which is not always the thread root:
     replying to a reply targets the reply. answers.md — replies are flat at
     depth 1, so the server hoists the parent to the root and captures the
     real target in replyToAnswerId/replyToUserId ("so the UI can still render
     'replying to @X'"). That capture only happens if we POST to the target's
     id — posting to the root, as this screen used to, gives the server
     nothing to hoist and the attribution is lost for good. */
  const [replyTarget, setReplyTarget] = React.useState<string | undefined>(params.replyToAnswerId)
  const replying = !!parentAnswerId
  /* Root when replying to the root itself, the reply's id when replying to a
     reply. Either way the server files the result under the root. */
  const postTarget = replyTarget || parentAnswerId

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })

  const [body, setBody] = React.useState('')
  const [media, setMedia] = React.useState<PickedAsset | null>(null)
  const [mediaError, setMediaError] = React.useState<string | null>(null)
  const [voice, setVoice] = React.useState<{ uri: string; duration: number } | null>(null)
  const [links, setLinks] = React.useState<string[]>([])
  const [linkDraft, setLinkDraft] = React.useState('')
  const [sources, setSources] = React.useState<SourceFields[]>([])
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)

  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [bodyError, setBodyError] = React.useState<string | null>(null)
  const [refusal, setRefusal] = React.useState<{ title: string; body?: string } | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const bodyRef = React.useRef<AnswerBodyEditorHandle>(null)
  const discard = useSheetState()
  const sourceSheet = useSheetState<number>()

  /* ---- voice ---- */
  /* The shared capture engine (chat's recorder language: metered bars, mono
     timer, poll caged to the recording, iOS session restore). Only ONE voice
     note per answer — a finished take REPLACES rather than appends, and
     everything else goes through attachments. */
  const rec = useVoicePostRecorder()

  /* The recorder must not outlive the screen — navigation away mid-take
     would leave the iOS session in record mode. Same guard as chat's
     Composer. */
  const recRef = React.useRef(rec)
  recRef.current = rec
  React.useEffect(() => () => {
    if (recRef.current.active) void recRef.current.cancel()
  }, [])

  const startRecording = async () => { await rec.start() }

  const stopRecording = async () => {
    const take = await rec.finish()
    if (!take) return
    setVoice({ uri: take.uri, duration: Math.round(take.durationMs / 1000) })
    fireHaptic('success')
  }

  const cancelRecording = () => { void rec.cancel() }

  /* ---- media ---- */
  const pickMedia = React.useCallback(async (fromCamera: boolean) => {
    setMediaError(null)
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, selectionLimit: 1 })
    if (res.canceled || !res.assets?.length) return
    /* prepareUpload honours the user's media tier — a data-saver user must not
       silently push a 40 MB original over a phone connection. */
    const ready = await prepareUpload(res.assets[0] as PickedAsset)
    setMedia(ready)
  }, [])

  React.useEffect(() => {
    if (params.attach === 'media') void pickMedia(false)
    if (params.attach === 'voice') bodyRef.current?.focus()
  }, [params.attach, pickMedia])

  /* ---- links ---- */
  const commitLink = () => {
    const url = absolutise(linkDraft)
    if (!url) return
    setLinks(prev => (prev.includes(url) ? prev : [...prev, url]))
    setLinkDraft('')
  }

  /* ---- gates ---- */
  const q = question.data
  const mode: 'ANSWER' | 'REPLY' = replying ? 'REPLY' : 'ANSWER'
  const entryGate = composerGate(q, user, mode, gate === 'allow')

  const dirty = !!(body.trim() || media || voice || links.length || sources.length)
  const canPost = !!body.trim() && !busy && cooldown === 0 && entryGate.open

  const leave = React.useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace(qnaHref.question(id))
  }, [router, id])

  const attemptClose = React.useCallback(() => {
    if (dirty) discard.open()
    else leave()
  }, [dirty, discard, leave])

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) return false
      discard.open()
      return true
    })
    return () => sub.remove()
  }, [dirty, discard])

  /* ---- submit ---- */
  const buildRequest = (): CreateAnswerRequest => ({
    body: body.trim(),
    /* One comma-separated string, no spaces — that is the wire contract. */
    links: links.length ? links.join(',') : undefined,
    sources: sources.length ? sources.map(s => ({ ...s })) : undefined,
    /* Rides the `data` part of the upload variants; the JSON endpoints never
       carry a voice note, so an unused field there costs nothing. voiceUrl
       stays unset — the server mints that from the file it received. */
    voiceDurationSeconds: voice ? voice.duration : undefined,
  })

  /* Holds the cache path of the JSON part after the string-part fallback. */
  const jsonUri = React.useRef<string | null>(null)

  const postWithFiles = async (req: CreateAnswerRequest, target: string | undefined) => {
    const build = (jsonAsFile: boolean) => {
      const fd = new FormData()
      if (jsonAsFile) {
        fd.append('data', { uri: jsonUri.current!, name: 'data.json', type: 'application/json' } as any)
      } else {
        fd.append('data', JSON.stringify(req))
      }
      if (media) fd.append('media', toUploadFile(media) as any)
      if (voice) fd.append('voice', toUploadFile({ uri: voice.uri, name: 'voice.m4a', mimeType: 'audio/mp4' }, 'voice.m4a') as any)
      return fd
    }

    try {
      const fd = build(false)
      return target ? await qna.postReanswerUpload(id, target, fd) : await qna.postAnswerUpload(id, fd)
    } catch (e: any) {
      const code = codeOf(e)
      /* The `data` part did not bind as a plain string. Re-send it as a real
         file part, which Spring's @RequestPart always accepts. */
      if (code !== 'MISSING_REQUEST_PART' && e?.status !== 415) throw e
      const target = `${FileSystem.cacheDirectory}qna-answer-${Date.now()}.json`
      await FileSystem.writeAsStringAsync(target, JSON.stringify(req))
      jsonUri.current = target
      const fd = build(true)
      return target ? await qna.postReanswerUpload(id, target, fd) : await qna.postAnswerUpload(id, fd)
    }
  }

  const submit = async () => {
    if (!canPost) return
    setBusy(true)
    setFormError(null)
    setBodyError(null)
    const req = buildRequest()
    const postTo = (target: string | undefined) => (media || voice
      ? postWithFiles(req, target)
      : target
        ? qna.postReanswer(id, target, req)
        : qna.postAnswer(id, req))
    try {
      let created
      try {
        created = await postTo(postTarget)
      } catch (e: any) {
        /* The reply we were aiming at was deleted while this was being
           written. The thread root is still a valid parent, so fall back to it
           rather than throwing away the draft — the only thing lost is the
           "replying to @X" attribution, which no longer has a target anyway. */
        const gone = codeOf(e) === 'PARENT_ANSWER_NOT_FOUND' || codeOf(e) === 'ANSWER_NOT_FOUND'
        if (!gone || !replyTarget || replyTarget === parentAnswerId || !parentAnswerId) throw e
        setReplyTarget(undefined)
        created = await postTo(parentAnswerId)
      }

      fireHaptic('success')
      /* Hand it back: your own write is actor-skipped on SSE, so the detail
         screen will never be told about it. */
      emitQna('answer:created', { questionId: id, answer: created })
      leave()
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      const code = codeOf(e)

      /* The body under each refusal is the server's own sentence, verbatim —
         it names the exact constraint (and, for the cap, the real number). */
      if (code === 'ANSWERS_LOCKED') {
        question.setData(prev => (prev ? { ...prev, answersLocked: true, acceptsNewAnswers: false } : prev))
        setRefusal({ title: 'Answers are locked', body: errorText(e) })
        return
      }
      if (code === 'ANSWER_LIMIT_REACHED') {
        question.setData(prev => (prev ? { ...prev, acceptsNewAnswers: false } : prev))
        setRefusal({ title: 'This question is full', body: errorText(e) })
        return
      }
      if (code === 'QUESTION_CLOSED') {
        setRefusal({ title: 'This question is closed', body: errorText(e) })
        return
      }
      if (code === 'ACCESS_FORBIDDEN') {
        setRefusal({ title: errorText(e) })
        return
      }
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { body: 'body' }) as Record<string, string>
        setBodyError(map.body || null)
        if (!map.body) setFormError(e)
        return
      }
      if (e?.status === 413) {
        setMediaError(`That file is too large — the limit is ${detailsOf(e)?.maxSize ?? 'smaller than this'}.`)
        return
      }
      if (isNsfwBlocked(e)) {
        /* Inline at the media tile — the offender is the attachment, not the
           words. Terminal: no retry; swap the image and send again. */
        setMediaError(moderationText(e))
        return
      }
      startCooldown(e)
      setFormError(e)
    }
  }

  /* ---- render ---- */
  if (question.loading) return <Screen><Spinner size="large" style={styles.fill} /></Screen>

  if (question.error && isNotFound(question.error)) {
    return (
      <Screen>
        <ComposerHeader title="Answer" onCancel={leave} />
        <QnaErrorView error={question.error} onBack={leave} backLabel="Back" />
      </Screen>
    )
  }

  if (refusal) {
    return (
      <Screen>
        <ComposerHeader title={replying ? 'Reply' : 'Answer'} onCancel={leave} />
        <QnaRefusal title={refusal.title} body={refusal.body} onBack={leave} />
        {dirty ? (
          <View style={{ padding: t.layout.screenPadding }}>
            <Callout tone="neutral" actionLabel="Copy my draft" onAction={() => { void copyDraft(body) }}>
              Your draft is still here.
            </Callout>
          </View>
        ) : null}
      </Screen>
    )
  }

  if (!entryGate.open) {
    return (
      <Screen>
        <ComposerHeader title={replying ? 'Reply' : 'Answer'} onCancel={leave} />
        <QnaRefusal
          title={entryGate.reason === 'ROLE' ? 'Only scholars and researchers can answer questions.' : 'Answering is closed'}
          body={entryGate.reason === 'ROLE' ? undefined : entryGate.copy}
          onBack={leave}
        />
      </Screen>
    )
  }

  const blocked = isBlocked(formError)
  const transient = isTransient(formError)

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <ComposerHeader
        title={replying ? 'Reply' : 'Answer'}
        subtitle={replying && params.replyToHandle ? `@${params.replyToHandle}` : undefined}
        onCancel={attemptClose}
        action={
          <Button
            label={cooldown > 0 ? `Wait ${cooldown}s` : 'Post'}
            onPress={submit}
            disabled={!canPost}
            loading={busy}
            size="sm"
          />
        }
      />

      {replying ? (
        <View style={[styles.contextStrip, { borderStartColor: c.accent, backgroundColor: c.surfaceSunken }]}>
          <View style={styles.flex}>
            <Text variant="footnote" weight="600" tone="accent" align="ui">
              Replying to @{params.replyToHandle ?? 'this answer'}
            </Text>
          </View>
          {composerGate(q, user, 'ANSWER', gate === 'allow').open ? (
            <IconButton
              name="close"
              size={16}
              color={c.textMuted}
              accessibilityLabel="Make this a top-level answer instead"
              /* Both, or postTarget would keep aiming at the reply and the
                 "top-level answer" would post as a reply to it. */
              onPress={() => { setParentAnswerId(undefined); setReplyTarget(undefined) }}
            />
          ) : null}
        </View>
      ) : null}

      {busy ? <IndeterminateBar active /> : null}

      <KeyboardAwareScrollView
        style={styles.fill}
        contentContainerStyle={{ padding: t.layout.screenPadding, paddingBottom: space.huge }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={110}
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <Callout
            tone={blocked ? 'warning' : 'danger'}
            icon={blocked ? 'shield' : 'error'}
            actionLabel={transient ? 'Try again' : undefined}
            onAction={transient ? submit : undefined}
            style={{ marginBottom: space.md2 }}
          >
            {blocked ? moderationText(formError) : errorText(formError)}
          </Callout>
        ) : null}

        <AnswerBodyEditor
          ref={bodyRef}
          value={body}
          onChangeText={v => { setBody(v); setBodyError(null) }}
          maxLength={BODY_MAX}
          minHeight={200}
          autoFocus={params.attach !== 'media'}
          editable={!busy}
          error={bodyError}
          placeholder="Share your answer. Cite your sources."
          onMentionQueryChange={setMentionQuery}
        />

        {media ? (
          <View style={{ marginTop: space.lg }}>
            <View style={[styles.mediaBox, { borderRadius: t.radius.md, backgroundColor: c.surfaceSunken }]}>
              <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} />
              {String(media.mimeType || '').startsWith('video') ? (
                <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
                  <Icon name="play" size={18} color={c.overlayText} filled />
                </View>
              ) : null}
              <View style={styles.mediaClose}>
                <IconButton name="close" onPress={() => { setMedia(null); setMediaError(null) }} size={16} surface="overlay" color={c.overlayText} accessibilityLabel="Remove media" />
              </View>
              {busy ? <View style={styles.mediaProgress}><IndeterminateBar active height={4} /></View> : null}
            </View>
            {mediaError ? <Text variant="footnote" tone="danger" align="ui" style={{ marginTop: space.xs2 }}>{mediaError}</Text> : null}
          </View>
        ) : null}

        {voice ? (
          <View style={[styles.voiceRow, { marginTop: space.lg }]}>
            <View style={styles.flex}>
              <VoiceNotePlayer url={voice.uri} durationSeconds={voice.duration} compact />
            </View>
            <IconButton name="trash" onPress={() => setVoice(null)} size={18} color={c.danger} accessibilityLabel="Delete voice note" />
          </View>
        ) : null}

        <SectionLabel>Links</SectionLabel>
        {links.length ? (
          <View style={styles.wrap}>
            {links.map(url => (
              <Chip key={url} label={hostOf(url)} icon="globe" tone="accent" size="sm" onRemove={() => setLinks(prev => prev.filter(x => x !== url))} />
            ))}
          </View>
        ) : null}
        <Field
          value={linkDraft}
          onChangeText={setLinkDraft}
          onSubmitEditing={commitLink}
          onBlur={commitLink}
          placeholder="example.org/article"
          icon="link"
          hint="Sent as one comma-separated string."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          editable={!busy}
          containerStyle={{ marginTop: links.length ? 10 : 0 }}
        />

        <View style={styles.sourcesHeader}>
          <Text variant="caption" tone="muted" align="ui">Sources</Text>
          <Touchable onPress={() => sourceSheet.open(-1)} feedback="dim" disabled={busy}>
            <Text variant="subhead" tone="accent">Add</Text>
          </Touchable>
        </View>

        {sources.map((s, i) => (
          <Touchable
            key={`${s.title}-${i}`}
            onPress={() => sourceSheet.open(i)}
            feedback="scale"
            style={[styles.sourceRow, { borderColor: c.border, borderRadius: t.radius.md }]}
          >
            <View style={[styles.sourceBadge, { backgroundColor: c.surfaceSunken }]}>
              <Icon name={sourceGlyph(s.sourceType)} size={16} color={c.textSecondary} />
            </View>
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" numberOfLines={1} align="auto">{s.title}</Text>
              <Text variant="footnote" tone="muted" numberOfLines={1} align="auto">
                {s.citationText || s.url || (s.isbn ? `ISBN ${s.isbn}` : 'Manual citation')}
              </Text>
            </View>
            <IconButton
              name="close"
              size={15}
              color={c.textFaint}
              accessibilityLabel={`Remove ${s.title}`}
              onPress={() => setSources(prev => prev.filter((_, j) => j !== i))}
            />
          </Touchable>
        ))}
        {!sources.length ? (
          <Text variant="footnote" tone="faint" align="ui">Citations make an answer checkable.</Text>
        ) : null}
      </KeyboardAwareScrollView>

      <MentionAutocomplete query={mentionQuery} onPick={a => bodyRef.current?.pickMention(a.handle)} />

      {/* The poll engine — null until a recording starts. */}
      {rec.engine}

      <View style={[styles.toolbar, { borderTopColor: c.separator, backgroundColor: c.bg }]}>
        {rec.active ? (
          /* The shared recording surface: pulsing dot, mono timer, live meter,
             trash to discard, check to keep — one language across chat,
             posts and answers. */
          <VoiceRecordingSurface
            seconds={rec.seconds}
            meter={rec.meter}
            onCancel={cancelRecording}
            onFinish={() => { void stopRecording() }}
          />
        ) : (
          <>
            <IconButton name="gallery" onPress={() => void pickMedia(false)} size={22} color={c.textSecondary} disabled={busy} accessibilityLabel="Add a photo or video" />
            <IconButton name="camera" onPress={() => void pickMedia(true)} size={22} color={c.textSecondary} disabled={busy} accessibilityLabel="Take a photo" />
            {/* One tap starts, the surface's check finishes — the same
                two-tap grammar as the chat mic. */}
            <Touchable
              onPress={() => void startRecording()}
              disabled={busy}
              feedback="scale"
              style={styles.toolBtn}
              accessibilityLabel="Record a voice answer"
              accessibilityHint="Tap to start recording, then tap the check to keep it"
            >
              <Icon name="mic" size={22} color={c.textSecondary} />
            </Touchable>
            <IconButton name="link" onPress={commitLink} size={22} color={c.textSecondary} disabled={busy || !linkDraft.trim()} accessibilityLabel="Add the typed link" />
            <View style={styles.flex} />
            <Text variant="footnote" weight="500" tone={body.length >= BODY_MAX ? 'danger' : 'muted'}>
              {body.length}/{BODY_MAX}
            </Text>
          </>
        )}
      </View>

      <SourceEditorSheet
        visible={sourceSheet.visible}
        onClose={sourceSheet.close}
        allowFile={false}
        initial={sourceSheet.payload != null && sourceSheet.payload >= 0
          ? ({ ...sources[sourceSheet.payload], id: '', sub: '', order: 0 } as any)
          : null}
        onSubmit={fields => {
          const i = sourceSheet.payload
          setSources(prev => (i != null && i >= 0 ? prev.map((s, j) => (j === i ? fields : s)) : [...prev, fields]))
          sourceSheet.close()
        }}
      />

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title={replying ? 'Discard reply?' : 'Discard answer?'}
        message="Your draft will not be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { discard.close(); leave() }}
      />
    </Screen>
  )
}

async function copyDraft(body: string) {
  const Clipboard = await import('expo-clipboard')
  await Clipboard.setStringAsync(body)
  toast.ok('Draft copied')
}

function ComposerHeader({
  title, subtitle, onCancel, action,
}: { title: string; subtitle?: string; onCancel: () => void; action?: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={[styles.header, { borderBottomColor: t.colors.separator }]}>
      <Touchable onPress={onCancel} feedback="dim" style={styles.headerSide} accessibilityLabel="Cancel">
        <Text variant="body" tone="accent" align="ui">Cancel</Text>
      </Touchable>
      <View style={styles.flex}>
        <Text variant="headline" align="center" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" align="center" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.headerSide, styles.headerEnd]}>{action}</View>
    </View>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text variant="caption" tone="muted" align="ui" style={styles.sectionLabel}>{children}</Text>
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingTop: space.xs2, paddingBottom: space.sm2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 72, justifyContent: 'center' },
  headerEnd: { alignItems: 'flex-end' },
  contextStrip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md2, paddingVertical: space.sm, minHeight: 36,
    borderStartWidth: 2,
  },
  mediaBox: { height: 200, overflow: 'hidden' },
  mediaClose: { position: 'absolute', top: 4, end: 4 },
  mediaProgress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  playBadge: {
    position: 'absolute', top: '50%', left: '50%', marginTop: -space.lg2, marginLeft: -space.lg2,
    width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* No textTransform: `caption`/`micro` uppercase LATIN ONLY inside the Text
     primitive, which is what leaves Arabic and Kurdish runs alone. A style-level
     transform would hit every script. */
  sectionLabel: { marginTop: space.xxl, marginBottom: space.sm },
  sourcesHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: space.xxl, marginBottom: space.sm,
  },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, marginBottom: space.sm, borderWidth: StyleSheet.hairlineWidth, minHeight: 60,
  },
  sourceBadge: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    paddingHorizontal: space.sm2, minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
})
