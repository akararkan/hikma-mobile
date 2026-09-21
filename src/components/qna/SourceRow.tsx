/* =========================================================
   One citation.

   The secondary line is the adapter's derived `source.sub`
   (citationText → url → "ISBN x" → file name) rather than
   anything re-derived here, and `href` is likewise adapter-
   resolved (url → fileUrl, absolutised) — so a row is tappable
   exactly when the server gave it something to open.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { DisclosureIcon, Icon, IconButton, Text, Touchable, type IconName } from '@/ui'
import { formatBytes, type SourceKind, type SourceView } from './types'

export const SOURCE_TYPES: { value: SourceKind; label: string; icon: IconName }[] = [
  { value: 'URL', label: 'Link', icon: 'globe' },
  { value: 'ISBN', label: 'Book', icon: 'book' },
  { value: 'MEDIA_FILE', label: 'File', icon: 'attachment' },
  { value: 'MANUAL', label: 'Manual', icon: 'quote' },
]

export function sourceGlyph(type: SourceKind | string): IconName {
  return SOURCE_TYPES.find(s => s.value === type)?.icon ?? 'quote'
}

export function SourceRow({
  source, index, editable, onPress, onOverflow, onOpenFile,
}: {
  source: SourceView
  index?: number
  editable?: boolean
  onPress?: () => void
  onOverflow?: () => void
  onOpenFile?: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const tint =
    source.type === 'URL' ? c.accent
      : source.type === 'ISBN' ? c.scholar
        : source.type === 'MEDIA_FILE' ? c.success
          : c.textMuted
  const soft =
    source.type === 'URL' ? c.accentSoft
      : source.type === 'ISBN' ? c.scholarSoft
        : source.type === 'MEDIA_FILE' ? c.successSoft
          : c.surfaceSunken

  const body = (
    <View style={[styles.row, { gap: space.md, padding: editable ? 14 : 0, minHeight: editable ? 76 : 44 }]}>
      {index != null ? (
        <Text variant="caption" tone="faint" style={styles.ordinal}>{index + 1}.</Text>
      ) : null}

      <View style={[styles.badge, { width: editable ? 36 : 30, height: editable ? 36 : 30, borderRadius: 10, backgroundColor: soft }]}>
        <Icon name={sourceGlyph(source.type)} size={editable ? 18 : 16} color={tint} />
      </View>

      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={1} align="auto">{source.title || 'Untitled source'}</Text>
        {source.sub ? (
          <Text variant="footnote" tone="muted" numberOfLines={1} align="auto" style={{ marginTop: space.xxs }}>{source.sub}</Text>
        ) : null}
        {source.fileName ? (
          <Touchable
            onPress={onOpenFile}
            disabled={!onOpenFile}
            feedback="dim"
            style={[styles.fileChip, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm, marginTop: space.xs2 }]}
          >
            <Icon name="file" size={12} color={c.textMuted} />
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
              {source.fileName}{source.fileSize ? ` · ${formatBytes(source.fileSize)}` : ''}
            </Text>
          </Touchable>
        ) : null}
      </View>

      {editable && onOverflow ? (
        <IconButton name="more" onPress={onOverflow} size={18} color={c.textFaint} accessibilityLabel="Source options" />
      ) : source.href ? (
        <DisclosureIcon />
      ) : null}
    </View>
  )

  if (!onPress) {
    return editable ? (
      <View style={[styles.card, { borderColor: c.border, borderRadius: t.radius.md, backgroundColor: c.surface }]}>{body}</View>
    ) : body
  }

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onOverflow}
      feedback={editable ? 'scale' : 'dim'}
      noAutoHitSlop
      style={editable ? [styles.card, { borderColor: c.border, borderRadius: t.radius.md, backgroundColor: c.surface }] : undefined}
    >
      {body}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth },
  badge: { alignItems: 'center', justifyContent: 'center' },
  ordinal: { width: 18 },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.sm, paddingVertical: space.xs2, alignSelf: 'flex-start', maxWidth: '100%' },
})
