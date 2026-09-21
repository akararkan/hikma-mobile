/* =========================================================
   Edit one answer or one reply — body only.

   The cap here is 5000, HALF the create cap. An answer written
   under the create cap can therefore be longer than the edit
   endpoint will accept, which is why the counter can start red
   and the strip explains it instead of silently truncating
   somebody's paragraph.

   Media, voice, links and sources are not editable through
   this endpoint; the two manage screens own those.
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
  Avatar, Button, Callout, ConfirmSheet, Icon, IconButton, Screen, Spinner,
  Text, Touchable, fireHaptic, useSheetState,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { emitQna } from '@/components/qna/events'
import { canManageAnswer } from '@/components/qna/gate'
import { activeMentionQuery, applyMention, MentionAutocomplete } from '@/components/qna/MentionAutocomplete'
import { QnaErrorView, QnaRefusal } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { toAnswer, type AnswerView, type QuestionView } from '@/components/qna/types'

const EDIT_MAX = 5000
const COUNTER_FROM = 4500
const MAX_HYDRATE_PAGES = 5

export default function EditAnswerScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const params = useLocalSearchParams<{ id: string; answerId: string; parentAnswerId?: string }>()
  const { id, answerId } = params

  const question = useAsync<QuestionView>(() => qna.get(id), { enabled: !!id, deps: [id] })

  const [answer, setAnswer] = React.useState<AnswerView | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [missing, setMissing] = React.useState(false)
  const [body, setBody] = React.useState('')
  const [original, setOriginal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [bodyError, setBodyError] = React.useState<string | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const input = React.useRef<TextInput>(null)
  const caret = React.useRef<number | null>(null)
  const discard = useSheetState()

  /* There is no GET-one-answer route, so the row is found by paging whichever
     list it lives in. */
  React.useEffect(() => {
    let alive = true
    const run = async () => {
      if (!id || !answerId) return
      setLoading(true)
      try {
        if (params.parentAnswerId) {
          for (let page = 0; page < MAX_HYDRATE_PAGES; page++) {
            const rows = await qna.reanswers(id, params.parentAnswerId, { page, size: 50 })
            const hit = rows.find(r => r.id === answerId)
            if (hit) { if (alive) { setAnswer(hit); setBody(hit.body); setOriginal(hit.body) } return }
            if (rows.length < 50) break
          }
        } else {
          for (let page = 0; page < MAX_HYDRATE_PAGES; page++) {
            const rows = await qna.answers(id, { page, size: 20 })
            const hit = rows.find(r => r.id === answerId)
            if (hit) { if (alive) { setAnswer(hit); setBody(hit.body); setOriginal(hit.body) } return }
            if (rows.length < 20) break
          }
        }
        if (alive) setMissing(true)
      } catch {
        if (alive) setMissing(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [id, answerId, params.parentAnswerId])

  const overLongOriginal = original.length > EDIT_MAX
  const dirty = body !== original
  const canSave = dirty && !!body.trim() && body.length <= EDIT_MAX && !busy && cooldown === 0

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
    if (!canSave || !answer) return
    /* EMPTY_ANSWER is a 400 — never spend a round trip on it. */
    if (!body.trim()) { setBodyError('Answer body cannot be empty'); return }
    setBusy(true)
    setFormError(null)
    setBodyError(null)
    try {
      /* RAW QuestionAnswerResponse — the module does not map this one. */
      const updated = toAnswer(await qna.editAnswer(id, answer.id, body.trim()))
      fireHaptic('success')
      emitQna('answer:updated', { questionId: id, answer: updated })
      leave()
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      const code = codeOf(e)
      if (code === 'EMPTY_ANSWER') { setBodyError(e.message); return }
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { body: 'body' }) as Record<string, string>
        setBodyError(map.body || e.message || null)
        return
      }
      if (code === 'ACCESS_FORBIDDEN') { setRefused(true); return }
      if (code === 'ANSWER_NOT_FOUND' || code === 'QUESTION_NOT_FOUND') {
        emitQna('answer:deleted', { questionId: id, answerId: answer.id, parentAnswerId: answer.parentAnswerId })
        setMissing(true)
        return
      }
      startCooldown(e)
      setFormError(e)
    }
  }

  if (loading || question.loading) return <Screen><Spinner size="large" style={styles.fill} /></Screen>

  if (missing || !answer) {
    return (
      <Screen>
        <EditorHeader title="Edit answer" onCancel={leave} />
        <QnaErrorView error={{ status: 404, code: 'ANSWER_NOT_FOUND' }} onBack={leave} backLabel="Back" />
      </Screen>
    )
  }

  if (refused || !canManageAnswer(user, question.data, answer.author)) {
    return (
      <Screen>
        <EditorHeader title="Edit answer" onCancel={leave} />
        <QnaRefusal title="You can only edit your own answer or answers on your question." onBack={leave} />
      </Screen>
    )
  }

  const blocked = isBlocked(formError)
  const a = answer._author
  const overCap = body.length > EDIT_MAX

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <EditorHeader
        title={answer.parentAnswerId ? 'Edit reply' : 'Edit answer'}
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

      <View style={[styles.context, { borderStartColor: c.accent, backgroundColor: c.surfaceSunken }]}>
        <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={26} />
        <View style={styles.fill}>
          <Text variant="footnote" weight="600" numberOfLines={1} align="ui">{a.full}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1} align="ui">
            {answer.formattedDate || answer.time}
          </Text>
        </View>
      </View>

      {overLongOriginal ? (
        <View style={[styles.strip, { backgroundColor: c.warningSoft }]}>
          <Icon name="warning" size={15} color={c.warningText} />
          <Text variant="footnote" color={c.warningText} align="ui" style={styles.fill}>
            This answer is longer than the {EDIT_MAX}-character edit limit. Trim it before saving.
          </Text>
        </View>
      ) : null}

      <KeyboardAwareScrollView
        style={styles.fill}
        contentContainerStyle={{ padding: t.layout.screenPadding, paddingBottom: space.xxxl }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={90}
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <Callout tone={blocked ? 'warning' : 'danger'} icon={blocked ? 'shield' : 'error'} style={{ marginBottom: space.md }}>
            {blocked ? moderationText(formError) : errorText(formError)}
          </Callout>
        ) : null}

        <TextInput
          ref={input}
          value={body}
          onChangeText={v => {
            setBody(v)
            setBodyError(null)
            setMentionQuery(activeMentionQuery(v, caret.current ?? undefined))
          }}
          onSelectionChange={e => {
            const { start, end } = e.nativeEvent.selection
            caret.current = start === end ? end : null
            setMentionQuery(activeMentionQuery(body, caret.current ?? undefined))
          }}
          onBlur={() => setMentionQuery(null)}
          /* No maxLength when the stored body already exceeds the cap: RN
             would refuse every keystroke and the user could not trim it. */
          maxLength={overLongOriginal ? undefined : EDIT_MAX}
          multiline
          autoFocus
          editable={!busy}
          scrollEnabled={false}
          textAlignVertical="top"
          selection={undefined}
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          cursorColor={c.accent}
          style={[
            styles.input,
            {
              color: c.text,
              fontSize: 16 * t.fontScale,
              lineHeight: 24 * t.fontScale,
              textAlign: t.isRTL ? 'right' : 'left',
              writingDirection: t.isRTL ? 'rtl' : 'ltr',
            },
          ]}
        />

        {bodyError ? <Text variant="footnote" tone="danger" align="ui" style={{ marginTop: space.xs2 }}>{bodyError}</Text> : null}

        <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xl }}>
          Edited answers are marked as edited. Only people you newly mention are notified.
        </Text>
      </KeyboardAwareScrollView>

      <MentionAutocomplete
        query={mentionQuery}
        onPick={picked => {
          setBody(prev => applyMention(prev, picked.handle, caret.current ?? undefined))
          setMentionQuery(null)
        }}
      />

      <View style={[styles.toolbar, { borderTopColor: c.separator, backgroundColor: c.bg }]}>
        <IconButton
          name="at"
          size={20}
          color={c.textSecondary}
          accessibilityLabel="Mention someone"
          onPress={() => { setBody(prev => `${prev}@`); input.current?.focus() }}
        />
        <View style={styles.fill} />
        {body.length >= COUNTER_FROM || overLongOriginal ? (
          <Text variant="footnote" weight="500" tone={overCap ? 'danger' : 'muted'}>
            {body.length}/{EDIT_MAX}
          </Text>
        ) : null}
      </View>

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
    </Screen>
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
  context: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.md2, paddingVertical: space.sm, minHeight: 44, borderStartWidth: 2,
  },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md2, paddingVertical: space.sm2, minHeight: 40 },
  input: { padding: 0, margin: 0, minHeight: 240 },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    paddingHorizontal: space.sm2, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth,
  },
})
