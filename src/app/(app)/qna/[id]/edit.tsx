/* =========================================================
   Edit a question.

   Every field is optional on the wire and an omitted key means
   "leave it alone", which makes one distinction load-bearing:
   clearing every chip sends `tags: []` (a deliberate clear),
   while never touching the chip input sends NO tags key at
   all. Conflating the two silently wipes a question's tags on
   a title-only edit.
   ========================================================= */
import React from 'react'
import { BackHandler, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { codeOf, errorText, fieldErrorMap } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, Field, Screen, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'
import { qna, type EditQuestionRequest } from '@/components/qna/api'
import { AnswerBodyEditor, type AnswerBodyEditorHandle } from '@/components/qna/AnswerBodyEditor'
import { emitQna } from '@/components/qna/events'
import { canManageQuestion } from '@/components/qna/gate'
import { MentionAutocomplete } from '@/components/qna/MentionAutocomplete'
import { QnaErrorView, QnaRefusal, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { TagChipInput } from '@/components/qna/TagChipInput'
import { toQuestion, type QuestionView } from '@/components/qna/types'

const TITLE_MAX = 500
const BODY_MAX = 10000
const KEYWORDS_MAX = 2000

export default function EditQuestionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })

  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [tags, setTags] = React.useState<string[]>([])
  const [tagsTouched, setTagsTouched] = React.useState(false)
  const [keywords, setKeywords] = React.useState('')
  const [hydrated, setHydrated] = React.useState(false)

  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [refused, setRefused] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const bodyRef = React.useRef<AnswerBodyEditorHandle>(null)
  const discard = useSheetState()
  const confirmDelete = useSheetState()

  React.useEffect(() => {
    const q = question.data
    if (!q || hydrated) return
    setTitle(q.title)
    setBody(q.body)
    setTags(q.tags)
    setKeywords(q.keywords)
    setHydrated(true)
  }, [question.data, hydrated])

  const q = question.data
  const titleChanged = !!q && title !== q.title
  const bodyChanged = !!q && body !== q.body
  const tagsChanged = !!q && tagsTouched && (tags.length !== q.tags.length || tags.some((x, i) => x !== q.tags[i]))
  const keywordsChanged = !!q && keywords !== q.keywords
  const dirty = titleChanged || bodyChanged || tagsChanged || keywordsChanged
  const canSave = dirty && !!title.trim() && !!body.trim() && !busy && cooldown === 0

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

  const save = async () => {
    if (!canSave || !q) return
    /* EMPTY_TITLE / EMPTY_BODY are 400s that only fire when a field is present
       but blank — block them here so the user never round-trips for it. */
    if (!title.trim()) { setFieldErrors(f => ({ ...f, title: 'A question needs a title.' })); return }
    if (!body.trim()) { setFieldErrors(f => ({ ...f, body: 'A question needs a body.' })); return }

    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    const req: EditQuestionRequest = {}
    if (titleChanged) req.title = title.trim()
    if (bodyChanged) req.body = body.trim()
    if (tagsChanged) req.tags = tags
    if (keywordsChanged) req.keywords = keywords.trim()

    try {
      /* RAW QuestionResponse — the module does not map this one. */
      const updated = toQuestion(await qna.edit(q.id, req))
      fireHaptic('success')
      emitQna('question:updated', updated)
      leave()
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      const code = codeOf(e)
      if (code === 'EMPTY_TITLE') { setFieldErrors({ title: e.message }); return }
      if (code === 'EMPTY_BODY') { setFieldErrors({ body: e.message }); return }
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { title: 'title', body: 'body', tags: 'tags', keywords: 'keywords' }) as Record<string, string>
        if (Object.keys(map).length) { setFieldErrors(map); return }
        setFormError(e)
        return
      }
      if (code === 'ACCESS_FORBIDDEN') { setRefused(true); return }
      startCooldown(e)
      setFormError(e)
    }
  }

  const doDelete = async () => {
    if (!q) return
    setBusy(true)
    try {
      await qna.remove(q.id)
      emitQna('question:deleted', { id: q.id })
      confirmDelete.close()
      /* replace, so neither the detail page nor this editor is left behind. */
      router.replace(qnaHref.home())
    } catch (e: any) {
      toast.error(errorText(e))
    } finally { setBusy(false) }
  }

  if (question.loading) {
    return (
      <Screen>
        <EditorHeader title="Edit question" onCancel={leave} />
        <QnaSkeletons kind="hero" count={0} />
      </Screen>
    )
  }

  if (question.error || !q) {
    return (
      <Screen>
        <EditorHeader title="Edit question" onCancel={leave} />
        <QnaErrorView error={question.error} onRetry={question.reload} onBack={leave} backLabel="Back" />
      </Screen>
    )
  }

  if (refused || !canManageQuestion(user, q)) {
    return (
      <Screen>
        <EditorHeader title="Edit question" onCancel={leave} />
        <QnaRefusal title="You can only edit your own question." onBack={leave} />
      </Screen>
    )
  }

  const blocked = isBlocked(formError)

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <EditorHeader
        title="Edit question"
        onCancel={attemptClose}
        action={
          <Button
            label={cooldown > 0 ? `Wait ${cooldown}s` : 'Save'}
            onPress={save}
            disabled={!canSave}
            loading={busy}
            size="sm"
          />
        }
      />

      <KeyboardAwareScrollView
        style={styles.fill}
        contentContainerStyle={{ padding: t.layout.screenPadding, paddingBottom: space.huge }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={72}
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <Callout tone={blocked ? 'warning' : 'danger'} icon={blocked ? 'shield' : 'error'} style={{ marginBottom: space.md2 }}>
            {/* Edits are scored exactly like creates: verbatim copy, no retry. */}
            {blocked ? moderationText(formError) : errorText(formError)}
          </Callout>
        ) : null}

        <FieldLabel label="Title" changed={titleChanged} />
        <TextInput
          value={title}
          onChangeText={v => { setTitle(v); setFieldErrors(f => ({ ...f, title: '' })) }}
          placeholder="What is your question?"
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          cursorColor={c.accent}
          multiline
          editable={!busy}
          maxLength={TITLE_MAX}
          scrollEnabled={false}
          textAlignVertical="top"
          style={[
            styles.titleInput,
            {
              color: c.text,
              fontSize: 22 * t.fontScale,
              lineHeight: 29 * t.fontScale,
              textAlign: t.isRTL ? 'right' : 'left',
              writingDirection: t.isRTL ? 'rtl' : 'ltr',
            },
          ]}
        />
        {fieldErrors.title ? <Text variant="footnote" tone="danger" align="ui">{fieldErrors.title}</Text> : null}

        <Divider style={{ marginVertical: space.md2 }} />

        <FieldLabel label="Body" changed={bodyChanged} />
        <AnswerBodyEditor
          ref={bodyRef}
          value={body}
          onChangeText={v => { setBody(v); setFieldErrors(f => ({ ...f, body: '' })) }}
          maxLength={BODY_MAX}
          minHeight={180}
          editable={!busy}
          error={fieldErrors.body || null}
          placeholder="The details of your question."
          onMentionQueryChange={setMentionQuery}
        />

        <FieldLabel label="Tags" changed={tagsChanged} style={{ marginTop: space.xxl }} />
        <TagChipInput
          tags={tags}
          onChange={next => { setTagsTouched(true); setTags(next) }}
          editable={!busy}
          error={fieldErrors.tags || null}
        />

        <FieldLabel label="Keywords" changed={keywordsChanged} style={{ marginTop: space.xxl }} />
        <Field
          value={keywords}
          onChangeText={setKeywords}
          placeholder="Search terms that do not belong in the body"
          hint="Only improves search — never shown on the card."
          error={fieldErrors.keywords || null}
          maxLength={KEYWORDS_MAX}
          editable={!busy}
        />

        <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxl, minHeight: 44 }}>
          Editing re-indexes your tags and notifies only newly mentioned people.
        </Text>

        {/* Down here rather than in the header, where a thumb reaching for
            Save would find it. */}
        <Touchable
          onPress={() => confirmDelete.open()}
          feedback="tint"
          style={[styles.deleteRow, { borderTopColor: c.separator }]}
          accessibilityLabel="Delete question"
        >
          <Text variant="body" tone="danger" align="center">Delete question</Text>
        </Touchable>
      </KeyboardAwareScrollView>

      <MentionAutocomplete query={mentionQuery} onPick={a => bodyRef.current?.pickMention(a.handle)} />

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard changes?"
        message="Your edits will not be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { discard.close(); leave() }}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this question?"
        message="Every answer, reply, reaction, file and bookmark on it is deleted too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={doDelete}
      />
    </Screen>
  )
}

function FieldLabel({ label, changed, style }: { label: string; changed: boolean; style?: any }) {
  const t = useTheme()
  return (
    <View style={[styles.labelRow, style]}>
      <Text variant="caption" tone="muted" align="ui">{label}</Text>
      {changed ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }} /> : null}
    </View>
  )
}

function EditorHeader({ title, onCancel, action }: { title: string; onCancel: () => void; action?: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={[styles.header, { borderBottomColor: t.colors.separator }]}>
      <Touchable onPress={onCancel} feedback="dim" style={styles.headerSide} accessibilityLabel="Cancel">
        <Text variant="body" tone="accent" align="ui">Cancel</Text>
      </Touchable>
      <Text variant="headline" align="center" numberOfLines={1} style={styles.fill}>{title}</Text>
      <View style={[styles.headerSide, styles.headerEnd]}>{action}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingTop: space.xs2, paddingBottom: space.sm2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 72, justifyContent: 'center' },
  headerEnd: { alignItems: 'flex-end' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginBottom: space.sm },
  titleInput: { padding: 0, margin: 0, fontWeight: '700', minHeight: 40 },
  deleteRow: { marginTop: space.xl, paddingTop: space.lg, minHeight: 52, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
})
