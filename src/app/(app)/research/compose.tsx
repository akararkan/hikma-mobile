/* =========================================================
   New paper — the five-step composer.

   Everything the wizard collects goes up in ONE multipart
   create call, and two things about that call are easy to get
   wrong and impossible to see afterwards:

     · `data.mediaFiles[i]` is matched to `files[]` BY INDEX
       POSITION, so the two arrays must stay in the same order
     · commentsEnabled and downloadsEnabled default to FALSE in
       the server's JSON, so they are always sent explicitly

   The cover and the promo video are NOT part of create — they
   need an id to attach to, so they upload after it returns, in
   sequence, with their own progress labels.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { adapters, api, codeOf, errorText, fieldErrorMap, isRateLimited, traceRef } from '@/api'
import { normalizeTags } from '@/api'
import { useRoleGate } from '@/context/AuthContext'
import { useDebounced } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { isBlocked, moderationText } from '@/lib/moderation'
import { compressToTier, prepareUpload } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { storage } from '@/platform/storage'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, Divider, Field, Header, Icon, ListRow, Screen,
  SegmentedControl, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ResearchCover } from '@/components/research/ResearchCover'
import { RichBody } from '@/components/research/RichBody'
import { TagChipInput } from '@/components/research/TagChipInput'
import { RefusalState } from '@/components/research/states'
import { useCooldown } from '@/components/research/hooks'
import { extOf, fileTint, formatBytes, formatDateTime } from '@/components/research/format'
import { CONTRIBUTOR_ROLE_LABEL } from '@/components/research/format'
import { to } from '@/components/research/nav'
import type { Author, BodyFormat, ContributorRole, ResearchDetail, Visibility } from '@/components/research/types'

const DRAFT_KEY = 'research.compose.draft'
const STEPS = ['Details', 'Body', 'Tags', 'Files', 'People'] as const

interface PickedFile { uri: string; name: string; mimeType?: string; size?: number; caption: string; altText: string }
interface PickedContributor { user: Author; role: ContributorRole; note: string }

interface WizardState {
  title: string
  abstractText: string
  visibility: Visibility
  commentsEnabled: boolean
  downloadsEnabled: boolean
  description: string
  bodyFormat: BodyFormat
  tags: string[]
  keywords: string
  citation: string
  files: PickedFile[]
  cover: { uri: string; name: string; mimeType?: string } | null
  promo: { uri: string; name: string; mimeType?: string } | null
  promoThumb: { uri: string; name: string; mimeType?: string } | null
  contributors: PickedContributor[]
  scheduledPublishAt: string | null
}

const EMPTY: WizardState = {
  title: '', abstractText: '', visibility: 'PUBLIC', commentsEnabled: true, downloadsEnabled: true,
  description: '', bodyFormat: 'MARKDOWN', tags: [], keywords: '', citation: '',
  files: [], cover: null, promo: null, promoThumb: null, contributors: [], scheduledPublishAt: null,
}

export default function ComposeScreen() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const gate = useRoleGate(['SCHOLAR', 'RESEARCHER', 'ADMIN', 'SUPER_ADMIN'])

  const [step, setStep] = React.useState(0)
  const [state, setState] = React.useState<WizardState>(EMPTY)
  const [restore, setRestore] = React.useState<WizardState | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [stage, setStage] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)
  const [moderationNote, setModerationNote] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState(false)
  const [cooldown, startCooldown] = useCooldown()
  const discard = useSheetState()

  /* Hardware back runs the same guard as the header's back chevron, which for
     this wizard always confirms — a multi-step paper draft is never cheap to
     retype, so there is no "clean" state worth popping silently. */
  useDiscardGuard(true, discard.open)

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(prev => ({ ...prev, [key]: value }))

  /* Nothing exists server-side until create() returns, so the wizard is its own
     persistence layer. */
  React.useEffect(() => {
    try {
      const raw = storage.getItem(DRAFT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.title || parsed?.description) setRestore(parsed)
      }
    } catch { /* a corrupt draft is not worth a crash */ }
  }, [])

  React.useEffect(() => {
    if (busy) return
    try { storage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state, step, busy])

  if (gate === 'deny') {
    return (
      <Screen>
        <Header closeButton title="New paper" />
        <RefusalState />
      </Screen>
    )
  }

  const jumpToFirstError = (map: Record<string, string>) => {
    const owner: Record<string, number> = {
      title: 0, abstractText: 0, visibility: 0,
      description: 1, bodyFormat: 1,
      tags: 2, keywords: 2, citation: 2,
      mediaFiles: 3,
      contributors: 4, scheduledPublishAt: 4,
    }
    const firstKey = Object.keys(map)[0]
    if (firstKey && owner[firstKey] != null) setStep(owner[firstKey])
  }

  const submit = async () => {
    if (busy || cooldown > 0) return
    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    setModerationNote(null)
    try {
      setStage('Creating draft…')
      const fd = new FormData()
      fd.append('data', JSON.stringify({
        title: state.title.trim(),
        description: state.description,
        abstractText: state.abstractText,
        bodyFormat: state.bodyFormat,
        keywords: state.keywords,
        citation: state.citation,
        visibility: state.visibility,
        scheduledPublishAt: state.scheduledPublishAt,
        /* Always explicit — the server's JSON default for both is false. */
        commentsEnabled: state.commentsEnabled,
        downloadsEnabled: state.downloadsEnabled,
        tags: normalizeTags(state.tags),
        sources: [],
        mediaFiles: state.files.map((f, i) => ({ caption: f.caption, altText: f.altText, displayOrder: i })),
        contributors: state.contributors.map((row, i) => ({
          userId: row.user.id, role: row.role, displayOrder: i, contributionNote: row.note,
        })),
      }))
      /* Same order as data.mediaFiles — the server pairs them by index. */
      state.files.forEach(f => fd.append('files[]', toUploadFile(f) as any))

      const raw = await api.research.create(fd)
      const detail = adapters.researchDetailFrom(raw) as ResearchDetail

      if (state.cover) {
        setStage('Uploading cover…')
        await api.research.uploadCover(detail.id, toUploadFile(state.cover))
      }
      if (state.promo) {
        setStage('Uploading promo video…')
        const promoForm = new FormData()
        promoForm.append('video', toUploadFile(state.promo) as any)
        if (state.promoThumb) promoForm.append('thumbnail', toUploadFile(state.promoThumb) as any)
        await api.research.uploadVideoPromo(detail.id, promoForm)
      }

      try { storage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      toast.ok('Draft created — publish when you are ready.')
      router.replace(to(`/research/${detail.id}`))
    } catch (e: any) {
      const code = codeOf(e)
      if (isBlocked(e)) { setModerationNote(moderationText(e)); return }
      if (isRateLimited(e)) { startCooldown(e); return }
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e) as Record<string, string>
        setFieldErrors(map)
        jumpToFirstError(map)
        return
      }
      if (code === 'RESEARCH_DUPLICATE') {
        setFieldErrors({ title: errorText(e) })
        setStep(0)
        return
      }
      if (['CONTRIBUTOR_IS_OWNER', 'DUPLICATE_CONTRIBUTOR', 'CONTRIBUTOR_NOT_ELIGIBLE', 'CONTRIBUTOR_DELETED'].includes(code)) {
        setFormError(e)
        setStep(4)
        return
      }
      setFormError(e)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  const canAdvance = step === 0 ? state.title.trim().length > 0 : true
  const last = step === STEPS.length - 1

  return (
    <Screen>
      <Header
        closeButton={false}
        back={() => discard.open()}
        title={`${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
      />

      <View style={styles.rail}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= step ? c.accent : c.borderFaint,
            }}
          />
        ))}
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
        bottomOffset={90}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {restore ? (
          <Callout
            tone="info"
            icon="history"
            title="Restore unsaved draft?"
            actionLabel="Restore"
            onAction={() => { setState(restore); setRestore(null) }}
            onDismiss={() => { setRestore(null); try { storage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }}
            style={{ marginBottom: space.lg2 }}
          >
            Nothing was saved to the server — this is the copy kept on your phone.
          </Callout>
        ) : null}

        {moderationNote ? (
          <Callout tone="warning" icon="shield" style={{ marginBottom: space.lg2 }}>{moderationNote}</Callout>
        ) : null}

        {formError ? (
          <Callout tone="danger" style={{ marginBottom: space.lg2 }}>
            {errorText(formError)}{traceRef(formError) ? ` (ref ${String(traceRef(formError)).slice(0, 8)})` : ''}
          </Callout>
        ) : null}

        {step === 0 ? (
          <View style={styles.stack}>
            <Field
              label="Title"
              value={state.title}
              onChangeText={v => set('title', v)}
              error={fieldErrors.title}
              maxLength={500}
              placeholder="The effect of X on Y"
              />
            <Field
              label="Abstract"
              value={state.abstractText}
              onChangeText={v => set('abstractText', v)}
              error={fieldErrors.abstractText}
              maxLength={5000}
              multiline
              minHeight={140}
              hint="Shown on cards and above the body."
            />
            <View>
              <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Visibility</Text>
              <SegmentedControl
                options={[
                  { value: 'PUBLIC', label: 'Public' },
                  { value: 'FOLLOWERS_ONLY', label: 'Followers' },
                  { value: 'PRIVATE', label: 'Private' },
                ]}
                value={state.visibility}
                onChange={v => set('visibility', v as Visibility)}
              />
            </View>
            <ListRow
              title="Allow comments"
              icon="comment"
              flush
              accessory={{ kind: 'switch', value: state.commentsEnabled, onValueChange: v => set('commentsEnabled', v) }}
            />
            <Divider />
            <ListRow
              title="Allow downloads"
              icon="download"
              flush
              accessory={{ kind: 'switch', value: state.downloadsEnabled, onValueChange: v => set('downloadsEnabled', v) }}
            />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.stack}>
            <SegmentedControl
              options={[
                { value: 'PLAIN', label: 'Plain' },
                { value: 'MARKDOWN', label: 'Markdown' },
                { value: 'HTML', label: 'HTML' },
              ]}
              value={state.bodyFormat}
              onChange={v => set('bodyFormat', v as BodyFormat)}
            />
            <Touchable onPress={() => setPreview(v => !v)} feedback="dim" style={styles.previewToggle}>
              <Icon name={preview ? 'edit' : 'eye'} size={15} color={c.accent} />
              <Text variant="subhead" tone="accent">{preview ? 'Back to editing' : 'Preview'}</Text>
            </Touchable>

            {preview ? (
              <View style={[styles.previewBox, { borderColor: c.borderFaint }]}>
                <RichBody plain={state.description} bodyFormat={state.bodyFormat} reading />
              </View>
            ) : (
              <Field
                label="Body"
                value={state.description}
                onChangeText={v => set('description', v)}
                error={fieldErrors.description}
                maxLength={50000}
                multiline
                minHeight={280}
              />
            )}
            <Text variant="footnote" tone="muted" align="ui">
              Markdown and HTML are rendered and sanitised on the server.
            </Text>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.stack}>
            <View>
              <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Tags</Text>
              <TagChipInput
                value={state.tags}
                onChange={v => set('tags', v)}
                showTrending
                error={fieldErrors.tags}
              />
            </View>
            <Field
              label="Keywords"
              value={state.keywords}
              onChangeText={v => set('keywords', v)}
              maxLength={2000}
              hint="Search boost, not tags. Comma-separated is fine."
            />
            <Field
              label="Citation"
              value={state.citation}
              onChangeText={v => set('citation', v)}
              maxLength={5000}
              multiline
              minHeight={110}
              hint="How you want to be cited. Readers see this first in the cite sheet."
            />
          </View>
        ) : null}

        {step === 3 ? (
          <FilesStep state={state} set={set} />
        ) : null}

        {step === 4 ? (
          <PeopleStep state={state} set={set} />
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.bottomBar, { borderTopColor: c.separator, backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
        {stage ? (
          <Text variant="caption" tone="accent" align="ui" style={{ paddingBottom: space.sm }}>{stage}</Text>
        ) : null}
        <View style={styles.bottomRow}>
          <Touchable
            onPress={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
            feedback="dim"
            style={styles.backBtn}
          >
            <Text variant="subhead" tone={step === 0 ? 'faint' : 'accent'}>Back</Text>
          </Touchable>

          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === step ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === step ? c.accent : c.borderStrong,
                }}
              />
            ))}
          </View>

          <Button
            label={
              cooldown > 0 ? `Wait ${cooldown}s`
                : last ? (state.scheduledPublishAt ? 'Create & schedule' : 'Create draft')
                  : 'Next'
            }
            loading={busy}
            disabled={busy || cooldown > 0 || !canAdvance}
            onPress={() => (last ? void submit() : setStep(s => Math.min(STEPS.length - 1, s + 1)))}
          />
        </View>
      </View>

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard this paper?"
        message="Nothing has been sent to the server yet. Your draft stays on this phone unless you discard it."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          try { storage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
          discard.close()
          router.back()
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Step 4 — files.

   Reordering is up/down rather than drag: there is no bulk
   order endpoint anyway, order here is just array position in
   the create payload, and a two-button move is unambiguous on
   a list that also scrolls.
   --------------------------------------------------------- */

function FilesStep({
  state, set,
}: { state: WizardState; set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void }) {
  const t = useTheme()
  const c = t.colors

  const pickImage = async (target: 'cover' | 'promoThumb') => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
    const picked = res.canceled ? null : res.assets?.[0]
    if (!picked) return
    /* `quality` re-encodes but never resizes. The cover is a card image on
       every research row, so it takes the tightest tier; the promo thumbnail
       is a full-bleed poster and follows the user's chosen tier. */
    const asset = target === 'cover'
      ? await compressToTier(picked, 'DATA_SAVER')
      : await prepareUpload(picked)
    set(target, { uri: asset.uri, name: asset.fileName || 'image.jpg', mimeType: asset.mimeType || undefined })
  }

  const pickVideo = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    set('promo', { uri: asset.uri, name: asset.fileName || 'promo.mp4', mimeType: asset.mimeType })
  }

  const pickFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (res.canceled) return
    const added: PickedFile[] = res.assets.map(a => ({
      uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size ?? undefined, caption: '', altText: '',
    }))
    set('files', [...state.files, ...added])
  }

  const move = (index: number, delta: number) => {
    const next = [...state.files]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    set('files', next)
  }

  const patchFile = (index: number, patch: Partial<PickedFile>) => {
    set('files', state.files.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  return (
    <View style={styles.stack}>
      <View>
        <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Cover</Text>
        {state.cover ? (
          <View>
            <ResearchCover uri={state.cover.uri} radius={t.radius.md} />
            <View style={styles.mediaButtons}>
              <Button label="Replace" size="sm" variant="secondary" onPress={() => void pickImage('cover')} />
              <Button label="Remove" size="sm" variant="ghost" onPress={() => set('cover', null)} />
            </View>
          </View>
        ) : (
          <Touchable
            onPress={() => void pickImage('cover')}
            feedback="dim"
            style={[styles.dropzone, { borderColor: c.borderStrong }]}
          >
            <Icon name="image" size={26} color={c.textFaint} />
            <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.sm }}>Add a cover</Text>
            <Text variant="caption" tone="faint" align="center">Shown on feed cards. JPG, PNG, WebP or GIF.</Text>
          </Touchable>
        )}
      </View>

      <View>
        <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Promo video</Text>
        {state.promo ? (
          <View>
            <View style={[styles.videoTile, { backgroundColor: c.surfaceSunken }]}>
              <Icon name="video" size={26} color={c.textSecondary} />
              <Text variant="footnote" tone="muted" align="center" numberOfLines={1}>{state.promo.name}</Text>
            </View>
            <View style={styles.mediaButtons}>
              <Button label="Replace video" size="sm" variant="secondary" onPress={() => void pickVideo()} />
              <Button label="Set thumbnail" size="sm" variant="secondary" onPress={() => void pickImage('promoThumb')} />
              <Button label="Remove" size="sm" variant="ghost" onPress={() => { set('promo', null); set('promoThumb', null) }} />
            </View>
            {state.promoThumb ? (
              <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
                Thumbnail: {state.promoThumb.name}
              </Text>
            ) : (
              <Text variant="caption" tone="warning" align="ui" style={{ marginTop: space.xs2 }}>
                Uploading without a thumbnail clears any existing one.
              </Text>
            )}
          </View>
        ) : (
          <Touchable
            onPress={() => void pickVideo()}
            feedback="dim"
            style={[styles.dropzone, { borderColor: c.borderStrong }]}
          >
            <Icon name="video" size={26} color={c.textFaint} />
            <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.sm }}>Add a promo video</Text>
            <Text variant="caption" tone="faint" align="center">MP4, WebM or MOV. Duration is read from the file.</Text>
          </Touchable>
        )}
      </View>

      <View>
        <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>
          Files{state.files.length ? ` (${state.files.length})` : ''}
        </Text>
        {state.files.map((file, i) => {
          const tint = fileTint(c, 'DOCUMENT')
          return (
            <View key={`${file.uri}:${i}`} style={[styles.fileCard, { backgroundColor: c.surfaceSunken }]}>
              <View style={styles.fileHead}>
                <View style={[styles.fileTile, { backgroundColor: tint.bg }]}>
                  <Text variant="micro" color={tint.fg}>{extOf(file.name)}</Text>
                </View>
                <View style={styles.flex}>
                  <Text variant="subhead" align="auto" numberOfLines={2}>{file.name}</Text>
                  <Text variant="caption" tone="muted" align="ui">{formatBytes(file.size)}</Text>
                </View>
                <Touchable onPress={() => move(i, -1)} feedback="dim" accessibilityLabel="Move up">
                  <Icon name="up" size={17} color={c.textFaint} />
                </Touchable>
                <Touchable onPress={() => move(i, 1)} feedback="dim" accessibilityLabel="Move down">
                  <Icon name="down" size={17} color={c.textFaint} />
                </Touchable>
                <Touchable
                  onPress={() => set('files', state.files.filter((_, j) => j !== i))}
                  feedback="dim"
                  accessibilityLabel="Remove file"
                >
                  <Icon name="trash" size={17} color={c.danger} />
                </Touchable>
              </View>
              <Field
                value={file.caption}
                onChangeText={v => patchFile(i, { caption: v })}
                placeholder="Caption"
                maxLength={500}
                containerStyle={{ marginTop: space.sm2 }}
              />
              <Field
                value={file.altText}
                onChangeText={v => patchFile(i, { altText: v })}
                placeholder="Alt text"
                maxLength={300}
                containerStyle={{ marginTop: space.sm }}
              />
            </View>
          )
        })}
        <Button label="Add file" icon="add" variant="secondary" block onPress={() => void pickFiles()} style={{ marginTop: space.sm2 }} />
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Step 5 — people and schedule.
   --------------------------------------------------------- */

function PeopleStep({
  state, set,
}: { state: WizardState; set: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void }) {
  const t = useTheme()
  const c = t.colors
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Author[]>([])
  const [searching, setSearching] = React.useState(false)
  const [showPicker, setShowPicker] = React.useState(false)
  const debounced = useDebounced(query.trim(), 250)
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    abort.current?.abort()
    if (!debounced) { setResults([]); return }
    const ctl = new AbortController()
    abort.current = ctl
    setSearching(true)
    /* eligibleContributor is the server's own eligibility rule — RESEARCHER and
       SCHOLAR only — so the picker can never offer someone who would be
       refused on save. */
    void api.users.search(debounced, { page: 0, size: 20, eligibleContributor: true, signal: ctl.signal } as any)
      .then((res: any) => setResults(res.items || []))
      .catch((e: any) => { if (e?.name !== 'AbortError') setResults([]) })
      .finally(() => setSearching(false))
    return () => ctl.abort()
  }, [debounced])

  const add = (user: Author) => {
    if (state.contributors.some(row => row.user.id === user.id)) return
    set('contributors', [...state.contributors, { user, role: 'CO_AUTHOR', note: '' }])
    setQuery('')
    setResults([])
  }

  const roles: ContributorRole[] = ['CO_AUTHOR', 'ADVISOR', 'REVIEWER', 'TRANSLATOR', 'EDITOR', 'CONTRIBUTOR']

  return (
    <View style={styles.stack}>
      <View>
        <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Contributors</Text>
        {state.contributors.map((row, i) => (
          <View key={row.user.id} style={[styles.fileCard, { backgroundColor: c.surfaceSunken }]}>
            <View style={styles.fileHead}>
              <Avatar uri={row.user.profileImage} name={row.user.full} seed={row.user.id} size={40} />
              <View style={styles.flex}>
                <Text variant="subhead" weight="600" align="auto" numberOfLines={1}>{row.user.full}</Text>
                <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>@{row.user.handle}</Text>
              </View>
              <Touchable
                onPress={() => set('contributors', state.contributors.filter((_, j) => j !== i))}
                feedback="dim"
                accessibilityLabel="Remove contributor"
              >
                <Icon name="close" size={17} color={c.textMuted} />
              </Touchable>
            </View>
            <View style={styles.roleRow}>
              {roles.map(role => (
                <Touchable
                  key={role}
                  onPress={() => set('contributors', state.contributors.map((r, j) => (j === i ? { ...r, role } : r)))}
                  feedback="scale"
                  haptic="select"
                  style={[
                    styles.rolePill,
                    {
                      backgroundColor: row.role === role ? c.accent : c.surface,
                      borderColor: row.role === role ? c.accent : c.borderFaint,
                    },
                  ]}
                >
                  <Text variant="caption" color={row.role === role ? c.textOnAccent : c.textSecondary}>
                    {CONTRIBUTOR_ROLE_LABEL[role]}
                  </Text>
                </Touchable>
              ))}
            </View>
            <Field
              value={row.note}
              onChangeText={v => set('contributors', state.contributors.map((r, j) => (j === i ? { ...r, note: v } : r)))}
              placeholder="What they contributed"
              maxLength={500}
              containerStyle={{ marginTop: space.sm }}
            />
          </View>
        ))}

        {showPicker ? (
          <View style={{ marginTop: space.sm2 }}>
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder="Search researchers and scholars"
              icon="search"
              autoFocus
              hint="Only researchers and scholars can be listed. They will be notified."
            />
            {searching ? <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.sm }}>Searching…</Text> : null}
            {results.map(user => {
              const already = state.contributors.some(row => row.user.id === user.id)
              return (
                <View key={user.id} style={styles.pickerRow}>
                  <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={34} />
                  <View style={styles.flex}>
                    <Text variant="subhead" align="auto" numberOfLines={1}>{user.full}</Text>
                    <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>@{user.handle}</Text>
                  </View>
                  <Button label={already ? 'Added' : 'Add'} size="sm" disabled={already} onPress={() => add(user)} />
                </View>
              )
            })}
            {debounced && !searching && !results.length ? (
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.sm2 }}>
                No eligible researchers match “{debounced}”.
              </Text>
            ) : null}
          </View>
        ) : (
          <Button
            label="Add contributor"
            icon="personAdd"
            variant="secondary"
            block
            onPress={() => setShowPicker(true)}
            style={{ marginTop: space.sm2 }}
          />
        )}
      </View>

      <View>
        <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Publishing</Text>
        <ListRow
          title="Save as draft"
          subtitle="Nothing is public until you publish it."
          flush
          onPress={() => set('scheduledPublishAt', null)}
          accessory={{ kind: 'radio', checked: !state.scheduledPublishAt }}
        />
        <Divider />
        <ListRow
          title="Schedule"
          subtitle="Auto-publishes within about a minute of the scheduled time."
          flush
          onPress={() => set('scheduledPublishAt', state.scheduledPublishAt ?? new Date(Date.now() + 3600_000).toISOString())}
          accessory={{ kind: 'radio', checked: !!state.scheduledPublishAt }}
        />
        {state.scheduledPublishAt ? (
          <View style={{ marginTop: space.md }}>
            <DateTimePicker
              value={new Date(state.scheduledPublishAt)}
              mode="datetime"
              /* Past times are refused server-side (400 INVALID_SCHEDULE) —
                 blocking them here means the user never meets that error. */
              minimumDate={new Date(Date.now() + 60_000)}
              onChange={(_e, date) => { if (date) set('scheduledPublishAt', date.toISOString()) }}
            />
            <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
              Publishes {formatDateTime(state.scheduledPublishAt)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: space.xs, paddingHorizontal: space.lg, paddingBottom: space.md },
  body: { paddingHorizontal: space.lg, paddingBottom: 130 },
  stack: { gap: space.lg2 },
  label: { marginBottom: space.sm },
  previewToggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, alignSelf: 'flex-start' },
  previewBox: { minHeight: 280, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: space.md2 },
  dropzone: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14,
    aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', padding: space.lg,
  },
  videoTile: { aspectRatio: 16 / 9, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  mediaButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm2, flexWrap: 'wrap' },
  fileCard: { borderRadius: 14, padding: space.md, marginTop: space.sm2 },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  fileTile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, marginTop: space.sm2 },
  /* A text-bearing role plate is a CHIP, not a pill (DESIGN.md §8.9). */
  rolePill: {
    paddingHorizontal: space.sm2, height: 28, ...setback(shape.chip), borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth,
  },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm2 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopWidth: StyleSheet.hairlineWidth, padding: space.lg,
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  backBtn: { paddingVertical: space.sm, paddingHorizontal: space.xs, minWidth: 48 },
  dots: { flexDirection: 'row', gap: space.xs2, flex: 1, justifyContent: 'center', alignItems: 'center' },
  flex: { flex: 1 },
})
