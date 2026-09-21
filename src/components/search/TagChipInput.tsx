/* =========================================================
   TagChipInput — the inline tag editor for composers.

   The normalization rules are a SERVER CONTRACT mirrored here so
   the author sees what will actually be stored: lowercase, trim,
   strip a leading `#`, dedupe, 100 chars per tag, 30 tags per
   item. `normalizeTag` / `normalizeTags` come from the '@/api'
   barrel like every other api import.

   Unicode is preserved and NEVER transliterated: `رمضان` and
   `ramadan` are two intentionally distinct tags, so there is no
   "did you mean the Latin one?" affordance and there must not be.

   Autocomplete is `tags.search` (a full-catalogue prefix scan),
   not `tags.trending` (a top-100 snapshot) — converging authors
   onto a tag that exists but is not popular is the entire point.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native'
import { api } from '@/api'
import { normalizeTag, normalizeTags } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Divider, Icon, NumericText, Skeleton, Text, Touchable, TouchableRow, formatCount,
} from '@/ui'
import { searchTags, type TagScope, type TagSuggestion, type TrendingTag } from './searchTypes'

export interface TagChipInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  scope?: TagScope
  max?: number
  placeholder?: string
  autoFocus?: boolean
}

export function TagChipInput({
  value, onChange, scope = 'ALL', max = 30, placeholder = 'Add a tag', autoFocus,
}: TagChipInputProps) {
  const t = useTheme()
  const c = t.colors
  const [text, setText] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([])
  const [popular, setPopular] = React.useState<TrendingTag[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [suggestionsDown, setSuggestionsDown] = React.useState(false)
  const seq = React.useRef(0)

  const atLimit = value.length >= max
  const typed = normalizeTag(text)
  const tooLong = text.trim().replace(/^#+/, '').length > 100

  /* "Popular now" is the empty-input state, refetched per scope so the counts
     are the ones that matter for the thing being written. */
  React.useEffect(() => {
    let live = true
    void (async () => {
      try {
        const rows = await api.tags.trending({ scope, limit: 20 }) as TrendingTag[]
        if (live) setPopular(rows)
      } catch {
        if (live) setPopular([])
      }
    })()
    return () => { live = false }
  }, [scope])

  React.useEffect(() => {
    if (!typed) { seq.current++; setSuggestions([]); setLoading(false); return }
    setLoading(true)
    const id = setTimeout(async () => {
      const mine = ++seq.current
      try {
        const rows = await searchTags({ prefix: typed, scope, limit: 8 })
        /* No AbortSignal on this call — a stale reply has to be dropped by hand. */
        if (mine !== seq.current) return
        setSuggestions(rows)
        setSuggestionsDown(false)
      } catch {
        if (mine !== seq.current) return
        /* 503 DATASTORE_UNAVAILABLE is transient by contract. Typing a tag must
           never depend on autocomplete being up, so the input stays live. */
        setSuggestions([])
        setSuggestionsDown(true)
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(id)
  }, [typed, scope])

  const commit = (raw: string) => {
    const next = normalizeTags([...value, raw]) as string[]
    if (next.length !== value.length) onChange(next.slice(0, max))
    setText('')
  }

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace' || text.length) return
    if (value.length) onChange(value.slice(0, -1))
  }

  const onChangeText = (v: string) => {
    /* Space and comma are commit keys, not characters — a tag cannot contain
       either, so typing one always means "next tag". */
    if (/[\s,]/.test(v)) {
      const parts = v.split(/[\s,]+/)
      const tail = parts.pop() ?? ''
      const merged = normalizeTags([...value, ...parts]) as string[]
      if (merged.length !== value.length) onChange(merged.slice(0, max))
      setText(tail)
      return
    }
    setText(v)
  }

  const exact = suggestions.some(s => s.tag === typed)

  return (
    <View>
      <View
        style={[
          styles.area,
          { backgroundColor: c.surfaceSunken, borderRadius: t.radius.field, borderColor: c.borderFaint },
        ]}
      >
        {value.map(tag => (
          /* Setback 8/3 — a tag chip carries text, and text-bearing plates are
             never pills (DESIGN.md §8.9). */
          <View key={tag} style={[styles.chip, { backgroundColor: c.accentSoft, ...setback(t.shape.chip) }]}>
            <Text variant="footnote" weight="600" color={c.accentText} numberOfLines={1}>#{tag}</Text>
            <Touchable
              onPress={() => onChange(value.filter(v => v !== tag))}
              feedback="dim"
              accessibilityLabel={`Remove #${tag}`}
            >
              <Icon name="close" size={14} color={c.accentText} />
            </Touchable>
          </View>
        ))}

        <TextInput
          value={text}
          onChangeText={onChangeText}
          onKeyPress={onKeyPress}
          onSubmitEditing={() => typed && commit(typed)}
          editable={!atLimit}
          placeholder={atLimit ? '' : placeholder}
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="done"
          submitBehavior="submit"
          style={[styles.input, { color: c.text, fontSize: t.type.callout.fontSize }]}
        />
      </View>

      <View style={styles.counterRow}>
        <Text variant="caption" tone={tooLong ? 'danger' : 'faint'} align="ui" style={styles.flex}>
          {atLimit ? `Maximum ${max} tags.` : tooLong ? 'Tags are capped at 100 characters.' : ' '}
        </Text>
        <NumericText variant="caption" tone={atLimit ? 'danger' : 'faint'}>{value.length}/{max}</NumericText>
      </View>

      {suggestionsDown ? (
        <Text variant="caption" tone="faint" align="ui" style={{ paddingHorizontal: space.xs, paddingTop: space.xs2 }}>
          Suggestions are unavailable.
        </Text>
      ) : null}

      {typed ? (
        <View style={{ marginTop: space.xs2 }}>
          {!exact ? (
            <TouchableRow onPress={() => commit(typed)}>
              <View style={styles.row}>
                <Icon name="add" size={18} color={c.accent} />
                <Text variant="callout" tone="accent" align="ui" numberOfLines={1} style={styles.flex}>
                  Create #{typed}
                </Text>
              </View>
            </TouchableRow>
          ) : null}
          {loading && !suggestions.length ? (
            <View style={{ gap: space.sm2, padding: space.md2 }}>
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width="52%" height={13} />)}
            </View>
          ) : null}
          {suggestions.map(s => (
            <View key={s.tag}>
              <Divider inset={16} />
              <TouchableRow onPress={() => commit(s.tag)}>
                <View style={styles.row}>
                  <Text variant="callout" numberOfLines={1} style={styles.flex}>#{s.tag}</Text>
                  <NumericText variant="footnote" tone="faint">{formatCount(s.usageCount)}</NumericText>
                </View>
              </TouchableRow>
            </View>
          ))}
        </View>
      ) : (
        <View style={{ marginTop: space.xs2 }}>
          {/* `caption` uppercases LATIN ONLY inside the Text primitive, which
              is what protects an Arabic or Kurdish translation of this label
              from a transform connected script cannot take. */}
          <Text variant="caption" tone="muted" align="ui" style={styles.groupLabel}>Popular now</Text>
          {(popular ?? []).map(p => (
            <TouchableRow key={p.tag} onPress={() => commit(p.tag)}>
              <View style={styles.row}>
                <Text variant="callout" numberOfLines={1} style={styles.flex}>#{p.tag}</Text>
                <NumericText variant="footnote" tone="faint">{formatCount(p.usageCount)}</NumericText>
              </View>
            </TouchableRow>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  area: {
    minHeight: 88,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 32,
    paddingHorizontal: space.md, borderCurve: 'continuous',
  },
  input: { minWidth: 80, flexGrow: 1, height: 32, padding: 0, margin: 0 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs, paddingTop: space.xs2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, height: 48, paddingHorizontal: space.lg },
  /* No letterSpacing here — `caption` already carries its own tracking, and a
     call-site override would survive into an Arabic run. */
  groupLabel: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  flex: { flex: 1 },
})
