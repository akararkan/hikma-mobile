/* =========================================================
   Create or edit one citation.

   `allowFile` is false inside the answer composer: a
   MEDIA_FILE source needs an existing source row before a file
   can be uploaded to it, so the composer can only stage the
   other three types and the sheet says so rather than offering
   a control that would 404.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Callout, Field, Icon, SegmentedControl, Sheet, Text, Touchable } from '@/ui'
import { SOURCE_TYPES } from './SourceRow'
import { absolutise, type SourceKind, type SourceView } from './types'

export interface SourceFields {
  sourceType: SourceKind
  title: string
  citationText?: string
  url?: string
  isbn?: string
}

export function SourceEditorSheet({
  visible, onClose, initial, allowFile, busy, error, fieldError, onSubmit, onAttachFile,
}: {
  visible: boolean
  onClose: () => void
  initial?: SourceView | null
  allowFile: boolean
  busy?: boolean
  error?: string | null
  fieldError?: string | null
  onSubmit: (fields: SourceFields) => void
  onAttachFile?: () => void
}) {
  const t = useTheme()
  const [type, setType] = React.useState<SourceKind>('URL')
  const [title, setTitle] = React.useState('')
  const [citation, setCitation] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [isbn, setIsbn] = React.useState('')

  React.useEffect(() => {
    if (!visible) return
    setType((initial?.type as SourceKind) || 'URL')
    setTitle(initial?.title || '')
    setCitation(initial?.citationText || '')
    setUrl(initial?.url || '')
    setIsbn(initial?.isbn || '')
  }, [visible, initial])

  const options = React.useMemo(
    () => SOURCE_TYPES.filter(s => allowFile || s.value !== 'MEDIA_FILE').map(s => ({ value: s.value, label: s.label, icon: s.icon })),
    [allowFile],
  )

  const submit = () => {
    if (!title.trim()) return
    onSubmit({
      sourceType: type,
      title: title.trim(),
      citationText: citation.trim() || undefined,
      url: type === 'URL' ? absolutise(url) || undefined : undefined,
      isbn: type === 'ISBN' ? isbn.trim() || undefined : undefined,
    })
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={initial ? 'Edit source' : 'Add a source'}
      subtitle="Citations are what make an answer checkable."
      maxHeightRatio={0.86}
      footer={
        <View style={styles.row}>
          <Button label="Cancel" variant="secondary" size="lg" onPress={onClose} style={styles.flex} />
          <Button label="Save" size="lg" disabled={!title.trim()} loading={busy} onPress={submit} style={styles.flex} />
        </View>
      }
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
        <SegmentedControl options={options} value={type} onChange={v => setType(v as SourceKind)} />

        {type === 'MEDIA_FILE' && !allowFile ? (
          <Callout tone="info">
            A file source needs the source row to exist first. Save it as Manual now and attach the file from Manage sources.
          </Callout>
        ) : null}

        <Field
          label="Title"
          required
          value={title}
          onChangeText={setTitle}
          error={fieldError}
          placeholder="al-Muwatta, Book of Prayer"
          maxLength={500}
          editable={!busy}
        />

        <Field
          label="Citation text"
          value={citation}
          onChangeText={setCitation}
          placeholder="The passage as you would quote it."
          multiline
          minHeight={96}
          maxLength={5000}
          editable={!busy}
        />

        {type === 'URL' ? (
          <Field
            label="URL"
            value={url}
            onChangeText={setUrl}
            placeholder="example.org/article"
            icon="link"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
          />
        ) : null}

        {type === 'ISBN' ? (
          <Field
            label="ISBN"
            value={isbn}
            onChangeText={setIsbn}
            placeholder="9780000000000"
            icon="book"
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
        ) : null}

        {allowFile && initial && onAttachFile ? (
          <Touchable
            onPress={onAttachFile}
            feedback="tint"
            style={[styles.attach, { borderColor: t.colors.border, borderRadius: t.radius.md }]}
          >
            <Icon name="attachment" size={18} color={t.colors.textSecondary} />
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" align="ui">
                {initial.fileName ? 'Replace file' : 'Attach file'}
              </Text>
              <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
                Uploading turns this into a file source and replaces any previous file.
              </Text>
            </View>
          </Touchable>
        ) : null}

        {error ? <Text variant="footnote" tone="danger" align="ui">{error}</Text> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm2 },
  flex: { flex: 1 },
  attach: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md2, borderWidth: StyleSheet.hairlineWidth,
  },
})
