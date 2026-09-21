/* =========================================================
   The tag editor.

   Every commit goes through `tags.normalizeTags` — the same
   rule the server applies (lowercase, strip a leading '#',
   trim, dedupe, cap 30). Normalising client-side is what stops
   '#Usul ' and 'usul' both appearing as chips and then
   collapsing into one on save.

   Arabic and Kurdish tags stay distinct from their Latin
   transliterations by design; nothing here transliterates.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { normalizeTag, normalizeTags } from '@/api'
import { tagsApi } from './api'
import { useDebounced } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Chip, Icon, Text, Touchable } from '@/ui'
import type { TagSuggestion } from './types'

const MAX_TAGS = 30

export function TagChipInput({
  tags, onChange, scope = 'QUESTION', editable = true, error,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  scope?: 'QUESTION' | 'ALL'
  editable?: boolean
  error?: string | null
}) {
  const t = useTheme()
  const c = t.colors
  const [draft, setDraft] = React.useState('')
  const [focused, setFocused] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([])
  const prefix = useDebounced(draft.trim(), 250)
  const seq = React.useRef(0)

  React.useEffect(() => {
    if (!prefix) { setSuggestions([]); return }
    const mine = ++seq.current
    let alive = true
    /* Prefix autocomplete over the WHOLE catalogue — trending only knows the
       top-N and would hide every specialist tag. */
    tagsApi.search({ prefix, scope, limit: 8 })
      .then((rows: TagSuggestion[]) => { if (alive && mine === seq.current) setSuggestions(rows || []) })
      .catch(() => { if (alive && mine === seq.current) setSuggestions([]) })
    return () => { alive = false }
  }, [prefix, scope])

  const commit = (raw: string) => {
    /* A pasted "usul, fiqh hadith" is three chips, not one. */
    const parts = String(raw).split(/[,\s]+/).filter(Boolean)
    if (!parts.length) return
    const next = normalizeTags([...tags, ...parts])
    onChange(next)
    setDraft('')
    setSuggestions([])
  }

  const remove = (tag: string) => onChange(tags.filter(x => x !== tag))

  const editChip = (tag: string) => {
    onChange(tags.filter(x => x !== tag))
    setDraft(tag)
  }

  const onChangeText = (v: string) => {
    if (/[,\s]$/.test(v)) { commit(v); return }
    setDraft(v)
  }

  const atCap = tags.length >= MAX_TAGS
  const shown = suggestions.filter(s => !tags.includes(normalizeTag(s.tag))).slice(0, 8)

  return (
    <View>
      <View
        style={[
          styles.box,
          {
            borderColor: error ? c.danger : focused ? c.accent : c.border,
            borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
            backgroundColor: c.surfaceSunken,
            borderRadius: t.radius.field,
          },
        ]}
      >
        {tags.map(tag => (
          <Chip
            key={tag}
            label={`#${tag}`}
            tone="accent"
            size="sm"
            onPress={editable ? () => editChip(tag) : undefined}
            onRemove={editable ? () => remove(tag) : undefined}
          />
        ))}
        {editable && !atCap ? (
          <TextInput
            value={draft}
            onChangeText={onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (draft.trim()) commit(draft) }}
            onSubmitEditing={() => commit(draft)}
            placeholder={tags.length ? 'Add another' : 'usul, hadith'}
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            returnKeyType="done"
            style={[styles.input, { color: c.text, fontSize: t.type.callout.fontSize }]}
          />
        ) : null}
      </View>

      {error ? (
        <Text variant="footnote" tone="danger" align="ui" style={{ marginTop: space.xs2 }}>{error}</Text>
      ) : (
        <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          {atCap ? 'That is the 30-tag maximum.' : 'Up to 30 tags. Tags power trending and tag feeds.'}
        </Text>
      )}

      {focused && shown.length ? (
        <View style={[styles.suggest, { backgroundColor: c.surface, borderColor: c.border, borderRadius: t.radius.md }]}>
          {shown.map(s => (
            <Touchable key={s.tag} onPress={() => commit(s.tag)} feedback="tint" noAutoHitSlop style={styles.suggestRow}>
              <Icon name="hash" size={13} color={c.textMuted} />
              <Text variant="subhead" align="ui" style={styles.flex}>{s.tag}</Text>
              <Text variant="caption" tone="faint">{s.usageCount}</Text>
            </Touchable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs2, padding: space.sm2, minHeight: 48 },
  input: { flexGrow: 1, minWidth: 110, padding: 0, margin: 0, height: 26 },
  suggest: { marginTop: space.sm, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 40 },
  flex: { flex: 1 },
})
