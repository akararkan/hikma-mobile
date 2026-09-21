/* =========================================================
   Edit paper — metadata only.

   The single most dangerous field in this module: PATCH applies
   only non-null fields, BUT `sources` and `contributors`
   REPLACE their entire list when present. So this screen never
   includes them in its body, not even as an empty array, and
   the two lists get their own editors.

   `tags` diff-merges and, on a published paper, rebuilds the
   Cassandra trending rows — so it is only sent when the chip
   set actually changed.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { adapters, api, codeOf, errorText, fieldErrorMap, isConflict, isDuplicate, isNotFound } from '@/api'
import { normalizeTags } from '@/api'
import { MODERATION_COPY, heldEdit, isBlocked, moderationText } from '@/lib/moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, Field, Header, Icon, ListRow, Screen, SegmentedControl,
  Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { RichBody } from '@/components/research/RichBody'
import { TagChipInput } from '@/components/research/TagChipInput'
import { ErrorPanel, GoneState, RefusalState } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { statusLabel } from '@/components/research/StatusPill'
import { to } from '@/components/research/nav'
import type { BodyFormat, ResearchDetail, Visibility } from '@/components/research/types'

interface Form {
  title: string
  abstractText: string
  description: string
  bodyFormat: BodyFormat
  keywords: string
  citation: string
  visibility: Visibility
  commentsEnabled: boolean
  downloadsEnabled: boolean
  tags: string[]
}

/* Prefill from the AUTHOR-SUPPLIED fields: `abstract` is stripHtml'd for card
   previews and `descriptionHtml` is the server's render — editing either would
   silently rewrite the paper into the renderer's output. */
function formOf(d: ResearchDetail): Form {
  return {
    title: d.title,
    abstractText: d.abstractSource,
    description: d.description,
    bodyFormat: d.bodyFormat,
    keywords: d.keywords,
    citation: d.citation,
    visibility: d.visibility,
    commentsEnabled: d.commentsEnabled,
    downloadsEnabled: d.downloadsEnabled,
    tags: d.tags || [],
  }
}

export default function EditPaperScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, error, loading, reload, patch } = useResearchDetail(id, { subscribe: false, recordView: false })

  const [form, setForm] = React.useState<Form | null>(null)
  const [base, setBase] = React.useState<Form | null>(null)
  const [preview, setPreview] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [moderationNote, setModerationNote] = React.useState<string | null>(null)
  const [titleWarned, setTitleWarned] = React.useState(false)
  const conflict = useSheetState()
  const leaving = useSheetState()

  React.useEffect(() => {
    if (detail && !form) { setForm(formOf(detail)); setBase(formOf(detail)) }
  }, [detail, form])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev))
    setFieldErrors(prev => ({ ...prev, [key]: '' }))
  }

  const dirtyKeys = React.useMemo<(keyof Form)[]>(() => {
    if (!form || !base) return []
    return (Object.keys(form) as (keyof Form)[]).filter(k => {
      if (k === 'tags') return normalizeTags(form.tags).join(',') !== normalizeTags(base.tags).join(',')
      return form[k] !== base[k]
    })
  }, [form, base])

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirtyKeys.length > 0, leaving.open)

  const save = async () => {
    if (!form || !dirtyKeys.length || busy) return
    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    setModerationNote(null)
    const body: Record<string, unknown> = {}
    for (const key of dirtyKeys) {
      body[key === 'abstractText' ? 'abstractText' : key] = key === 'tags' ? normalizeTags(form.tags) : form[key]
    }
    /* Read BEFORE the await: `patch` below replaces the detail, and the whole
       question is what the paper was a moment ago. */
    const wasPublished = String(detail?.status || '').toUpperCase() === 'PUBLISHED'
    try {
      const raw = await api.research.update(id, body)
      const fresh = adapters.researchDetailFrom(raw) as ResearchDetail
      patch(() => fresh)
      setBase(formOf(fresh))
      setForm(formOf(fresh))
      /* A held edit answers 200 and hands back a DRAFT — the save worked, but
         readers cannot see the paper until the new wording clears. "Saved" on
         its own would leave the author with no idea their paper had gone
         quiet. The guard matters: editing a genuine draft also returns DRAFT. */
      if (wasPublished && heldEdit(fresh)) {
        setModerationNote(MODERATION_COPY.checking.note)
      } else {
        toast.ok('Saved')
      }
    } catch (e: any) {
      const code = codeOf(e)
      if (isBlocked(e)) { setModerationNote(moderationText(e)); return }
      /* The 409 title/slug collision arrives as RESEARCH_DUPLICATE — the
         uniqueness family, NOT the concurrent-edit family isConflict matches —
         so it must be caught first: mark the title inline, don't offer a
         reload that cannot help. */
      if (isDuplicate(e)) { setFieldErrors({ title: errorText(e) }); return }
      if (isConflict(e)) {
        conflict.open()
        return
      }
      if (code === 'VALIDATION_FAILED') { setFieldErrors(fieldErrorMap(e) as Record<string, string>); return }
      setFormError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && isNotFound(error)) {
    return (
      <Screen>
        <Header closeButton title="Edit paper" />
        <GoneState onAction={() => router.replace(to('/research'))} />
      </Screen>
    )
  }
  if (error && error?.status === 403) {
    return (
      <Screen>
        <Header closeButton title="Edit paper" />
        <RefusalState title="You do not own this paper." body="Only the corresponding researcher can edit it." />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        title="Edit paper"
        back={() => (dirtyKeys.length ? leaving.open() : router.back())}
        actions={[{
          icon: 'check',
          onPress: save,
          label: 'Save',
          tone: dirtyKeys.length ? 'accent' : 'default',
        }]}
      />

      {loading || !form ? (
        <View style={{ padding: space.lg, gap: space.lg2 }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ gap: space.sm }}>
              <Skeleton width="30%" height={12} />
              <Skeleton height={i === 1 ? 120 : 48} radius={12} />
            </View>
          ))}
        </View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.body}
          bottomOffset={40}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {moderationNote ? <Callout tone="warning" icon="shield" style={styles.note}>{moderationNote}</Callout> : null}
          {formError ? <Callout tone="danger" style={styles.note}>{formError}</Callout> : null}

          <Field
            label="Title"
            value={form.title}
            onChangeText={v => { set('title', v); if (!titleWarned) setTitleWarned(true) }}
            error={fieldErrors.title}
            maxLength={500}
            hint={titleWarned && form.title !== base?.title ? 'Changing the title regenerates the public link.' : undefined}
          />

          <Field
            label="Abstract"
            value={form.abstractText}
            onChangeText={v => set('abstractText', v)}
            error={fieldErrors.abstractText}
            maxLength={5000}
            multiline
            minHeight={140}
          />

          <View>
            <View style={styles.bodyHead}>
              <Text variant="subhead" tone="secondary" align="ui" style={styles.flex}>Body</Text>
              <Touchable onPress={() => setPreview(v => !v)} feedback="dim">
                <Text variant="subhead" tone="accent">{preview ? 'Edit' : 'Preview'}</Text>
              </Touchable>
            </View>
            <SegmentedControl
              options={[
                { value: 'PLAIN', label: 'Plain' },
                { value: 'MARKDOWN', label: 'Markdown' },
                { value: 'HTML', label: 'HTML' },
              ]}
              value={form.bodyFormat}
              onChange={v => set('bodyFormat', v as BodyFormat)}
              style={{ marginBottom: space.sm2 }}
            />
            {preview ? (
              <View style={[styles.previewBox, { borderColor: c.borderFaint }]}>
                <RichBody plain={form.description} bodyFormat={form.bodyFormat} reading />
              </View>
            ) : (
              <Field
                value={form.description}
                onChangeText={v => set('description', v)}
                error={fieldErrors.description}
                maxLength={50000}
                multiline
                minHeight={240}
              />
            )}
          </View>

          <View>
            <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Tags</Text>
            <TagChipInput value={form.tags} onChange={v => set('tags', v)} error={fieldErrors.tags} />
          </View>

          <Field label="Keywords" value={form.keywords} onChangeText={v => set('keywords', v)} maxLength={2000} />
          <Field
            label="Citation"
            value={form.citation}
            onChangeText={v => set('citation', v)}
            maxLength={5000}
            multiline
            minHeight={110}
          />

          <View>
            <Text variant="subhead" tone="secondary" align="ui" style={styles.label}>Visibility</Text>
            <SegmentedControl
              options={[
                { value: 'PUBLIC', label: 'Public' },
                { value: 'FOLLOWERS_ONLY', label: 'Followers' },
                { value: 'PRIVATE', label: 'Private' },
              ]}
              value={form.visibility}
              onChange={v => set('visibility', v as Visibility)}
            />
          </View>

          <View>
            <ListRow
              title="Allow comments"
              icon="comment"
              flush
              accessory={{ kind: 'switch', value: form.commentsEnabled, onValueChange: v => set('commentsEnabled', v) }}
            />
            <Divider />
            <ListRow
              title="Allow downloads"
              icon="download"
              flush
              accessory={{ kind: 'switch', value: form.downloadsEnabled, onValueChange: v => set('downloadsEnabled', v) }}
            />
          </View>

          <View style={[styles.identity, { backgroundColor: c.surfaceSunken }]}>
            {/* `micro` uppercases Latin INSIDE the Text primitive — which is what
    leaves an Arabic or Kurdish run alone — so the eyebrow is written in
    sentence case and takes the variant's own tracking. */}
            <Text variant="micro" tone="muted" align="ui" style={styles.identityLabel}>Identity</Text>
            <Touchable
              onPress={async () => {
                if (!detail?.irc) return
                await Clipboard.setStringAsync(detail.irc)
                toast.ok('Identifier copied')
              }}
              feedback="dim"
              style={styles.identityRow}
            >
              <Text variant="subhead" mono style={styles.flex}>{detail?.irc || '—'}</Text>
              <Icon name="copy" size={16} color={c.textMuted} />
            </Touchable>
            <Text variant="caption" tone="muted" align="ui" numberOfLines={2}>
              Slug: {detail?.slug || '—'}
            </Text>
            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
              Changing the title regenerates the link.
            </Text>
          </View>

          <View style={styles.navGroup}>
            <ListRow
              title="Media & cover"
              subtitle={`${detail?.mediaFiles.length ?? 0} files${detail?.coverImageUrl ? ', cover set' : ''}`}
              icon="image"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push(to(`/research/${id}/edit/media`))}
            />
            <Divider inset={58} />
            <ListRow
              title="Sources"
              subtitle={String(detail?.sources.length ?? 0)}
              icon="quote"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push(to(`/research/${id}/edit/sources`))}
            />
            <Divider inset={58} />
            <ListRow
              title="Contributors"
              subtitle={String(detail?.contributors.length ?? 0)}
              icon="people"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push(to(`/research/${id}/edit/contributors`))}
            />
            <Divider inset={58} />
            <ListRow
              title="Publishing"
              subtitle={detail ? statusLabel(detail.status) : ''}
              icon="upload"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push(to(`/research/${id}/edit/publish`))}
            />
          </View>

          <Button
            label={dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` : 'Saved'}
            block
            size="lg"
            loading={busy}
            disabled={!dirtyKeys.length || busy}
            onPress={save}
            style={{ marginTop: space.sm }}
          />

          {error ? <ErrorPanel error={error} onRetry={reload} compact style={styles.note} /> : null}
        </KeyboardAwareScrollView>
      )}

      <ConfirmSheet
        visible={conflict.visible}
        onClose={conflict.close}
        title="Someone else changed this paper"
        message="Reload to take their version, or keep editing and save over it."
        confirmLabel="Reload"
        cancelLabel="Keep editing"
        icon="refresh"
        onConfirm={() => { conflict.close(); setForm(null); void reload() }}
      />

      <ConfirmSheet
        visible={leaving.visible}
        onClose={leaving.close}
        title="Discard your changes?"
        message="Nothing has been saved yet."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { leaving.close(); router.back() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 60, gap: space.xl },
  label: { marginBottom: space.sm },
  note: { marginBottom: space.xs },
  bodyHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  previewBox: { minHeight: 240, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: space.md2 },
  identity: { borderRadius: 14, padding: space.md2, gap: space.xs },
  identityLabel: { marginBottom: space.xs },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.xs },
  navGroup: { marginHorizontal: -space.lg },
  flex: { flex: 1 },
})
