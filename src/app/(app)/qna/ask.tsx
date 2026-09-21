/* =========================================================
   Ask a question.

   Role-gated to SCHOLAR and ADMIN. The gate is computed from
   the local user AND re-checked against a 403 from the server,
   because a de-promotion between load and submit is real and
   an ownership/role refusal is final — it gets a wall, not a
   retry button.

   Client-side caps mirror the server's (500 / 10000 / 30 tags
   / 2000) so the common mistake never costs a round trip; the
   server still owns the verdict.
   ========================================================= */
import React from 'react'
import { BackHandler, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Redirect, Stack, useRouter } from 'expo-router'
import { codeOf, errorText, fieldErrorMap } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, Field, Icon, ListRow, Screen,
  SegmentedControl, Spinner, Text, Touchable, fireHaptic, useSheetState,
} from '@/ui'
import { qna } from '@/components/qna/api'
import { AnswerBodyEditor, type AnswerBodyEditorHandle } from '@/components/qna/AnswerBodyEditor'
import { emitQna } from '@/components/qna/events'
import { canAskRole } from '@/components/qna/gate'
import { MentionAutocomplete } from '@/components/qna/MentionAutocomplete'
import { QnaRefusal } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import { TagChipInput } from '@/components/qna/TagChipInput'

const TITLE_MAX = 500
const BODY_MAX = 10000
const KEYWORDS_MAX = 2000
const LIMITS = [
  { value: 'none', label: 'Unlimited' },
  { value: '1', label: '1' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: 'custom', label: 'Custom' },
]

export default function AskQuestionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const gate = useAuthGate()
  const { user } = useAuth()

  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [tags, setTags] = React.useState<string[]>([])
  const [keywords, setKeywords] = React.useState('')
  const [answersLocked, setAnswersLocked] = React.useState(false)
  const [limitMode, setLimitMode] = React.useState('none')
  const [customLimit, setCustomLimit] = React.useState(10)
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [roleRefused, setRoleRefused] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const bodyRef = React.useRef<AnswerBodyEditorHandle>(null)
  const discard = useSheetState()

  const dirty = !!(title.trim() || body.trim() || tags.length || keywords.trim() || answersLocked || limitMode !== 'none')
  const canPost = !!title.trim() && !!body.trim() && !busy && cooldown === 0

  const leave = React.useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace(qnaHref.home())
  }, [router])

  const attemptClose = React.useCallback(() => {
    if (dirty) discard.open()
    else leave()
  }, [dirty, discard, leave])

  /* Android hardware back has to go through the same guard as Cancel, or the
     draft dies to a reflex. */
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) return false
      discard.open()
      return true
    })
    return () => sub.remove()
  }, [dirty, discard])

  const submit = async () => {
    if (!canPost) return
    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    const maxAnswers =
      limitMode === 'none' ? null
        : limitMode === 'custom' ? Math.max(1, customLimit)
          : Number(limitMode)
    try {
      const created = await qna.create({
        title: title.trim(),
        body: body.trim(),
        tags: tags.length ? tags : undefined,
        keywords: keywords.trim() || undefined,
        answersLocked,
        maxAnswers,
      })
      fireHaptic('success')
      /* Hand it to the feed screens directly — your own create is actor-
         skipped on SSE, so nothing will arrive to tell them about it. */
      emitQna('question:created', created)
      /* replace, not push: Back must not land on a composer holding a draft
         that has already been published. */
      router.replace(qnaHref.question(created.id))
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      const code = codeOf(e)
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { title: 'title', body: 'body', tags: 'tags', keywords: 'keywords' }) as Record<string, string>
        if (Object.keys(map).length) { setFieldErrors(map); return }
        setFormError(e)
        return
      }
      if (code === 'ACCESS_FORBIDDEN') { setRoleRefused(true); return }
      startCooldown(e)
      setFormError(e)
    }
  }

  if (gate === 'loading') return <Screen><Spinner size="large" style={styles.fill} /></Screen>
  if (gate === 'deny') return <Redirect href={qnaHref.signIn()} />

  if (roleRefused || !canAskRole(user)) {
    return (
      <Screen>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <ComposerHeader title="Ask a question" onCancel={leave} />
        <QnaRefusal
          title="Only scholars can post questions."
          body="Researchers can answer questions instead."
          onBack={leave}
        />
      </Screen>
    )
  }

  const blocked = isBlocked(formError)

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <ComposerHeader
        title="Ask a question"
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

      <KeyboardAwareScrollView
        style={styles.fill}
        contentContainerStyle={{ padding: t.layout.screenPadding, paddingBottom: space.xxxl }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={72}
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <Callout
            tone={blocked ? 'warning' : 'danger'}
            icon={blocked ? 'shield' : 'error'}
            style={{ marginBottom: space.lg }}
          >
            {/* A moderation refusal shows the server's sentence verbatim, with
                no retry button and no hint at which rule fired. */}
            {blocked ? moderationText(formError) : errorText(formError)}
          </Callout>
        ) : null}

        <TextInput
          value={title}
          onChangeText={v => { setTitle(v); setFieldErrors(f => ({ ...f, title: '' })) }}
          placeholder="What is your question?"
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          cursorColor={c.accent}
          multiline
          autoFocus
          editable={!busy}
          maxLength={TITLE_MAX}
          scrollEnabled={false}
          textAlignVertical="top"
          returnKeyType="next"
          onSubmitEditing={() => bodyRef.current?.focus()}
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
        {title.length > TITLE_MAX - 50 ? (
          <Text variant="footnote" weight="500" tone={title.length >= TITLE_MAX ? 'danger' : 'muted'} align={t.isRTL ? 'left' : 'right'}>
            {title.length}/{TITLE_MAX}
          </Text>
        ) : null}
        {fieldErrors.title ? <Text variant="footnote" tone="danger" align="ui">{fieldErrors.title}</Text> : null}

        <Divider style={{ marginVertical: space.md2 }} />

        <AnswerBodyEditor
          ref={bodyRef}
          value={body}
          onChangeText={v => { setBody(v); setFieldErrors(f => ({ ...f, body: '' })) }}
          maxLength={BODY_MAX}
          minHeight={180}
          placeholder="Add the details — what you have read, which opinions you are comparing, and exactly what is unclear."
          editable={!busy}
          error={fieldErrors.body || null}
          onMentionQueryChange={setMentionQuery}
        />

        <SectionLabel>Tags</SectionLabel>
        <TagChipInput tags={tags} onChange={setTags} editable={!busy} error={fieldErrors.tags || null} />

        <SectionLabel>Keywords (optional)</SectionLabel>
        <Field
          value={keywords}
          onChangeText={setKeywords}
          placeholder="Search terms that do not belong in the body"
          hint="Only improves search — never shown on the card."
          error={fieldErrors.keywords || null}
          maxLength={KEYWORDS_MAX}
          editable={!busy}
        />

        <Touchable
          onPress={() => setSettingsOpen(o => !o)}
          feedback="dim"
          noAutoHitSlop
          style={[styles.collapseHeader, { borderTopColor: c.separator }]}
        >
          <Text variant="subhead" weight="600" align="ui" style={styles.flex}>Answer settings</Text>
          <Icon name={settingsOpen ? 'up' : 'down'} size={16} color={c.textMuted} />
        </Touchable>

        {settingsOpen ? (
          <View style={{ gap: space.md2 }}>
            {/* The ui row's own switch accessory — themed by @/ui, no colour
                literals here. `flush` drops the row padding the composer's
                container already pays. */}
            <ListRow
              flush
              title="Lock answers from the start"
              subtitle="Nobody can answer until you unlock it"
              disabled={busy}
              minHeight={52}
              accessory={{
                kind: 'switch',
                value: answersLocked,
                onValueChange: v => { fireHaptic('select'); setAnswersLocked(v) },
                disabled: busy,
              }}
            />

            <View>
              <Text variant="subhead" weight="600" align="ui" style={{ marginBottom: space.sm }}>Answer limit</Text>
              <SegmentedControl options={LIMITS} value={limitMode} onChange={setLimitMode} />
              {limitMode === 'custom' ? (
                <View style={[styles.stepper, { borderColor: c.border, borderRadius: t.radius.md }]}>
                  <Touchable
                    onPress={() => setCustomLimit(n => Math.max(1, n - 1))}
                    feedback="scale"
                    haptic="select"
                    style={styles.stepBtn}
                    accessibilityLabel="Fewer answers"
                  >
                    <View style={[styles.minus, { backgroundColor: c.textSecondary }]} />
                  </Touchable>
                  <Text variant="title3" align="center" style={styles.flex}>{customLimit}</Text>
                  <Touchable
                    onPress={() => setCustomLimit(n => Math.min(999, n + 1))}
                    feedback="scale"
                    haptic="select"
                    style={styles.stepBtn}
                    accessibilityLabel="More answers"
                  >
                    <Icon name="add" size={18} color={c.textSecondary} />
                  </Touchable>
                </View>
              ) : null}
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.sm }}>
                Caps top-level answers only. Replies never count.
              </Text>
            </View>
          </View>
        ) : null}

        <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxl }}>
          Questions are visible to everyone. Only scholars can post questions.
        </Text>
      </KeyboardAwareScrollView>

      <MentionAutocomplete
        query={mentionQuery}
        onPick={a => bodyRef.current?.pickMention(a.handle)}
      />

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard question?"
        message="Your draft will not be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { discard.close(); leave() }}
      />
    </Screen>
  )
}

function ComposerHeader({ title, onCancel, action }: { title: string; onCancel: () => void; action?: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={[styles.header, { borderBottomColor: t.colors.separator, paddingTop: space.xs2 }]}>
      <Touchable onPress={onCancel} feedback="dim" style={styles.headerSide} accessibilityLabel="Cancel">
        <Text variant="body" tone="accent" align="ui">Cancel</Text>
      </Touchable>
      <Text variant="headline" align="center" numberOfLines={1} style={styles.flex}>{title}</Text>
      <View style={[styles.headerSide, styles.headerEnd]}>{action}</View>
    </View>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="caption" tone="muted" align="ui" style={styles.sectionLabel}>{children}</Text>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingBottom: space.sm2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 72, justifyContent: 'center' },
  headerEnd: { alignItems: 'flex-end' },
  titleInput: { padding: 0, margin: 0, fontWeight: '700', minHeight: 40 },
  /* No textTransform: `caption`/`micro` uppercase LATIN ONLY inside the Text
     primitive, which is what leaves Arabic and Kurdish runs alone. A style-level
     transform would hit every script. */
  sectionLabel: { marginTop: 26, marginBottom: space.sm },
  collapseHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginTop: 26, paddingTop: space.lg, paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepper: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: space.sm2, borderWidth: StyleSheet.hairlineWidth, height: 48,
  },
  stepBtn: { width: 52, height: '100%', alignItems: 'center', justifyContent: 'center' },
  /* The icon set has no minus concept, and adding one for a single stepper
     is worse than a 2pt rule that matches the plus's stroke. */
  minus: { width: 15, height: 2, borderRadius: 1 },
})
