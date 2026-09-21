/* =========================================================
   SourceRow — one bibliographic entry.

   The adapter already resolved `sub` (citationText → url →
   "ISBN …" → the original filename) and already ran `href`
   through assetUrl, so this row never re-derives either. A row
   with no href is not tappable and shows no chevron: a
   disclosure arrow that leads nowhere is a lie.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { DisclosureIcon, Icon, Text, Touchable, type IconName } from '@/ui'
import type { SourceItem, SourceType } from './types'

const TYPE_ICON: Record<SourceType, IconName> = {
  URL: 'link',
  ISBN: 'book',
  MEDIA_FILE: 'file',
  MANUAL: 'quote',
}

export function sourceTint(type: SourceType | string) {
  return String(type || 'MANUAL').toUpperCase() as SourceType
}

/* Both callbacks take the SOURCE back. A list that writes
   `onPress={() => open(item)}` mints a fresh renderItem every render, and
   FlashList's ViewHolder memo compares renderItem by identity — so one
   item-first function serving every row is what keeps a list still. */
function SourceRowBase({
  source, index, onPress, onLongPress,
}: {
  source: SourceItem
  /** 1-based position, shown as the bibliography numeral. */
  index?: number
  onPress?: (source: SourceItem) => void
  onLongPress?: (source: SourceItem) => void
}) {
  const t = useTheme()
  const c = t.colors
  const type = sourceTint(source.type)

  const tint =
    type === 'URL' ? { bg: c.accentSoft, fg: c.accentText }
      : type === 'ISBN' ? { bg: c.scholarSoft, fg: c.scholarText }
        : type === 'MEDIA_FILE' ? { bg: c.surfaceSunken, fg: c.textSecondary }
          : { bg: c.surfaceSunken, fg: c.textMuted }

  const body = (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: tint.bg }]}>
        <Icon name={TYPE_ICON[type] ?? 'quote'} size={16} color={tint.fg} />
      </View>
      <View style={styles.flex}>
        <View style={styles.titleLine}>
          {index != null ? <Text variant="footnote" tone="faint">{index}.</Text> : null}
          <Text variant="subhead" weight="600" align="auto" numberOfLines={2} style={styles.flex}>
            {source.title || source.sub || 'Untitled source'}
          </Text>
        </View>
        {source.sub ? (
          <Text variant="caption" tone="muted" align="auto" numberOfLines={2} style={{ marginTop: space.xxs }}>
            {source.sub}
          </Text>
        ) : null}
      </View>
      {source.href ? <DisclosureIcon /> : null}
    </View>
  )

  if (!source.href && !onLongPress) return body
  return (
    <Touchable
      onPress={source.href && onPress ? () => onPress(source) : undefined}
      onLongPress={onLongPress ? () => onLongPress(source) : undefined}
      disabled={!source.href && !onLongPress}
      feedback="tint"
      noAutoHitSlop
    >
      {body}
    </Touchable>
  )
}

export const SourceRow = React.memo(SourceRowBase)

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2 },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  titleLine: { flexDirection: 'row', gap: space.xs2, alignItems: 'flex-start' },
  flex: { flex: 1 },
})
