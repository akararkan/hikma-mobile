/* =========================================================
   TagChipInput — the tag editor, shared by the compose wizard,
   the metadata editor and the tag filter page.

   Normalisation happens on COMMIT, not on render, and it goes
   through `normalizeTags` from '@/api' (the barrel does
   not re-export it) so the client and the server agree
   character for character: lowercase, trimmed, no leading '#',
   100 chars per tag, 30 tags. Arabic and Latin tags stay
   distinct — transliterating them would merge two different
   literatures.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { api } from '@/api'
import { normalizeTag, normalizeTags } from '@/api'
import { useDebounced } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Chip, ChipRail, Icon, NumericText, Text, Touchable, formatCount } from '@/ui'
import type { TagSuggestion, TrendingTag } from './types'

export function TagChipInput({
  value, onChange, max = 30, scope = 'RESEARCH', showTrending = false, error, placeholder = 'Add a tag…',
}: {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  scope?: string
  showTrending?: boolean
  error?: string | null
  placeholder?: string
}) {
  const t = useTheme()
  const c = t.colors
  const [draft, setDraft] = React.useState('')
  const [focused, setFocused] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([])
  const [trending, setTrending] = React.useState<TrendingTag[]>([])
  const [limitHit, setLimitHit] = React.useState(false)

  const prefix = useDebounced(draft.replace(/^#+/, '').trim(), 200)

  React.useEffect(() => {
    if (!prefix) { setSuggestions([]); return }
    let alive = true
    void api.tags.search({ prefix, scope, limit: 6 } as any)
      .then((rows: TagSuggestion[]) => { if (alive) setSuggestions(rows || []) })
      .catch(() => { if (alive) setSuggestions([]) })
    return () => { alive = false }
  }, [prefix, scope])

  React.useEffect(() => {
    if (!showTrending) return
    let alive = true
    void api.tags.trending({ scope, limit: 12 })
      .then((rows: TrendingTag[]) => { if (alive) setTrending(rows || []) })
      .catch(() => { /* the shortcut row is a nicety; never block the editor */ })
    return () => { alive = false }
  }, [showTrending, scope])

  const commit = (raw: string) => {
    const one = normalizeTag(raw)
    if (!one) return
    if (value.includes(one)) { setDraft(''); return }
    if (value.length >= max) { setLimitHit(true); return }
    onChange(normalizeTags([...value, one]))
    setDraft('')
    setLimitHit(false)
  }

  const remove = (tag: string) => {
    onChange(value.filter(v => v !== tag))
    setLimitHit(false)
  }

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
        {value.map(tag => (
          <Chip key={tag} label={`#${tag}`} tone="accent" size="sm" onRemove={() => remove(tag)} />
        ))}
        <TextInput
          value={draft}
          onChangeText={v => {
            /* A space or comma is how people actually type a tag list. */
            if (/[\s,]$/.test(v)) commit(v)
            else setDraft(v)
          }}
          onKeyPress={e => {
            if (e.nativeEvent.key === 'Backspace' && !draft && value.length) remove(value[value.length - 1])
          }}
          onSubmitEditing={() => commit(draft)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (draft.trim()) commit(draft) }}
          placeholder={value.length ? '' : placeholder}
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          style={[styles.input, { color: c.text, fontSize: t.type.callout.fontSize }]}
        />
      </View>

      {error ? (
        <Text variant="footnote" tone="danger" align="ui" style={styles.foot}>{error}</Text>
      ) : limitHit ? (
        <Text variant="footnote" tone="warning" align="ui" style={styles.foot}>
          {max} tags is the maximum. Remove one to add another.
        </Text>
      ) : (
        <Text variant="footnote" tone="muted" align="ui" style={styles.foot}>
          {value.length} of {max} · space or return commits a tag
        </Text>
      )}

      {/* No shadow on the popover — a raised surface separates by BORDER
          WEIGHT in QELAT (DESIGN.md §6 "Surface raised"), never by a drop
          shadow, and it takes the popover setback rather than a uniform 14. */}
      {focused && draft.trim() ? (
        <View style={[styles.suggestCard, { backgroundColor: c.surfaceRaised, borderColor: c.borderStrong }]}>
          {suggestions.length ? suggestions.map(s => (
            <Touchable key={s.tag} onPress={() => commit(s.tag)} feedback="tint" noAutoHitSlop style={styles.suggestRow}>
              <Icon name="hash" size={14} color={c.textFaint} />
              <Text variant="subhead" align="ui" numberOfLines={1} style={styles.flex}>{s.tag}</Text>
              <NumericText variant="caption" tone="faint">{formatCount(s.usageCount)}</NumericText>
            </Touchable>
          )) : (
            <Touchable onPress={() => commit(draft)} feedback="tint" noAutoHitSlop style={styles.suggestRow}>
              <Icon name="add" size={14} color={c.textFaint} />
              <Text variant="subhead" tone="muted" align="ui" numberOfLines={1} style={styles.flex}>
                No tags start with “{draft.replace(/^#+/, '')}”
              </Text>
              <Text variant="caption" tone="accent">Add anyway</Text>
            </Touchable>
          )}
        </View>
      ) : null}

      {showTrending && trending.length ? (
        <ChipRail contentPadding={0} style={{ marginTop: space.md }}>
          {trending.map(row => (
            <Chip
              key={row.tag}
              label={`#${row.tag}`}
              tone="scholar"
              size="sm"
              onPress={() => commit(row.tag)}
            />
          ))}
        </ChipRail>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs2, padding: space.sm2, minHeight: 52 },
  input: { flexGrow: 1, minWidth: 110, paddingVertical: space.xs },
  foot: { marginTop: space.xs2 },
  suggestCard: {
    marginTop: space.sm, borderWidth: 1, overflow: 'hidden',
    ...setback(shape.popover), borderCurve: 'continuous',
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md, paddingVertical: space.md },
  flex: { flex: 1 },
})
