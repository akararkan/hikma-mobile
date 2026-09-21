/* =========================================================
   The taxonomy chips on a profile header.

   A specialization IS a topic row, so it carries all three
   names and the reader gets the one for THEIR interface
   language — an Arabic reader must not be shown the English
   name just because the adapter flattened it. Direction comes
   from `taxonomyDir` for the cases `dir="auto"` cannot see (a
   name that starts with a digit, an empty column).

   The madhhab leads the row in the scholar tint, because it is
   one choice from a different, shorter vocabulary and reads
   wrong mixed in among ten topics.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { taxonomyName } from '@/api'
import { Chip } from '@/ui'
import { space } from '@/theme/tokens'

export interface TaxonomyRow {
  id: number | string
  nameEn?: string
  nameAr?: string
  nameCkb?: string
  order?: number
}

export interface SpecializationChipsProps {
  items?: TaxonomyRow[] | null
  lang?: string
  /** A leading chip in the scholar tint — the school of jurisprudence. */
  madhhab?: { row: TaxonomyRow | null; fallbackName?: string } | null
  /** Collapse past this many into a "+n" chip that expands in place. */
  max?: number
  onPress?: (row: TaxonomyRow) => void
  style?: StyleProp<ViewStyle>
}

export function SpecializationChips({
  items, lang = 'EN', madhhab, max = 6, onPress, style,
}: SpecializationChipsProps) {
  const [expanded, setExpanded] = React.useState(false)

  const rows = items || []
  const madhhabLabel = madhhab
    ? (madhhab.row ? taxonomyName(madhhab.row, lang) : madhhab.fallbackName || '')
    : ''

  if (!rows.length && !madhhabLabel) return null

  const shown = expanded ? rows : rows.slice(0, max)
  const hidden = rows.length - shown.length

  return (
    <View style={[styles.wrap, style]}>
      {madhhabLabel ? <Chip label={madhhabLabel} icon="scholar" tone="scholar" size="sm" /> : null}
      {shown.map(row => (
        <Chip
          key={String(row.id)}
          label={taxonomyName(row, lang)}
          tone="accent"
          size="sm"
          onPress={onPress ? () => onPress(row) : undefined}
        />
      ))}
      {hidden > 0 ? (
        <Chip
          label={`+${hidden}`}
          size="sm"
          onPress={() => setExpanded(true)}
          accessibilityLabel={`Show ${hidden} more specializations`}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
})
