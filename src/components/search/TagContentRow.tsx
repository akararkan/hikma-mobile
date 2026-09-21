/* =========================================================
   TagContentRow — one row of a tag's Cassandra feed.

   The wire carries `contentId`, `contentType`, `authorId`,
   `titlePreview` and `createdAt` and NOTHING else — no author
   name, no counts, no media. That is deliberate on the server
   side, and the matching client rule is: do not fan out N
   author lookups to decorate a list. A row never blocks on
   hydration it was not given.

   `tagContentRowFrom` emits the same field names as
   `searchHit`, which is why the type→route dispatch is shared
   with SearchResultRow instead of forked.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { DisclosureIcon, Icon, Text, TouchableRow } from '@/ui'
import { TYPE_ICON, TYPE_LABEL, typeSkin, type TagContentItem } from './searchTypes'

export interface TagContentRowProps {
  row: TagContentItem
  /** Item-first, so one handler serves every row of a paginated list. */
  onPress?: (row: TagContentItem) => void
  onLongPress?: (row: TagContentItem) => void
}

/* Memoized like its siblings in this folder: the tag feed auto-pages while a
   filter is on, so the parent re-renders in bursts precisely while the user is
   scrolling, and `row` is identity-stable across those renders. */
export const TagContentRow = React.memo(function TagContentRow({ row, onPress, onLongPress }: TagContentRowProps) {
  const t = useTheme()
  const skin = typeSkin(t.colors, row.contentType)
  const label = TYPE_LABEL[row.contentType] ?? 'Item'

  return (
    <TouchableRow
      onPress={onPress ? () => onPress(row) : undefined}
      onLongPress={onLongPress ? () => onLongPress(row) : undefined}
    >
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, gap: space.md }]}>
        <View style={[styles.badge, { backgroundColor: skin.bg }]}>
          <Icon name={TYPE_ICON[row.contentType] ?? 'file'} size={20} color={skin.fg} filled />
        </View>
        <View style={styles.flex}>
          <Text variant="callout" numberOfLines={2}>
            {row.titlePreview || `Untitled ${label.toLowerCase()}`}
          </Text>
          <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }} numberOfLines={1}>
            {[label, row.time].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <DisclosureIcon />
      </View>
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 80, paddingVertical: space.md },
  flex: { flex: 1 },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
