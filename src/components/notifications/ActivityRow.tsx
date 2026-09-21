/* =========================================================
   One row of the private activity history.

   `label` and `subtitle` are server-rendered — printed
   verbatim, never derived from `type`. The client's only job
   is the glyph, the tint and whether the row can be opened.

   Memoized. Both handlers are item-first, so a caller can hand
   the same two functions to every row and the memo holds for
   the rows a render did not touch.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'
import { activityKindOf, toneColors } from './constants'
import type { ActivityItem } from './types'

export const ACTIVITY_ROW_INSET = 64

export const ActivityRow = React.memo(function ActivityRow({
  row, onPress, onLongPress,
}: {
  row: ActivityItem
  onPress: (row: ActivityItem) => void
  onLongPress: (row: ActivityItem) => void
}) {
  const t = useTheme()
  const c = t.colors
  const kind = activityKindOf(row.type)
  const tint = toneColors(c, kind.tone)

  /* The wire's per-row preview (activity.md §1): a post/research thumbnail
     beats an avatar beats nothing. Rows with one get the taller container —
     the history should show WHAT was touched, not only the sentence. */
  const preview = row.preview
  const hasVisual = !!(preview?.thumb || preview?.avatar)

  return (
    <View style={{ backgroundColor: c.bg }}>
      <Touchable
        onPress={() => onPress(row)}
        onLongPress={() => onLongPress(row)}
        delayLongPress={450}
        feedback={row.deepLink ? 'tint' : 'scale'}
        noAutoHitSlop
        accessibilityLabel={row.subtitle ? `${row.label}. ${row.subtitle}` : row.label}
        style={[styles.row, { minHeight: (hasVisual ? 78 : 64) * t.densityScale }]}
      >
        <View style={[styles.glyph, { backgroundColor: tint.soft }]}>
          <Icon name={kind.icon} size={18} color={tint.fg} />
        </View>

        <View style={styles.middle}>
          <Text variant="body" weight="500" numberOfLines={1}>{row.label}</Text>
          {row.subtitle ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1} style={styles.subtitle}>
              {row.subtitle}
            </Text>
          ) : null}
          {preview?.text ? (
            <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.subtitle}>
              {preview.text}
            </Text>
          ) : null}
        </View>

        {preview?.thumb ? (
          <Image
            source={{ uri: preview.thumb }}
            style={[styles.previewThumb, { borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={preview.thumb}
          />
        ) : preview?.avatar || preview?.name ? (
          <Avatar uri={preview.avatar} name={preview.name || '·'} seed={row.id} size={40} />
        ) : null}

        <View style={styles.trailing}>
          {row.time ? <Text variant="footnote" tone="faint" align="ui">{row.time}</Text> : null}
          {row.deepLink ? <Icon name="forward" size={16} color={c.textFaint} style={styles.chevron} /> : null}
        </View>
      </Touchable>

      <View style={[styles.separator, { backgroundColor: c.separator, marginStart: ACTIVITY_ROW_INSET }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  glyph: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, marginStart: space.md },
  subtitle: { marginTop: space.xxs },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginStart: space.sm },
  previewThumb: { width: 56, height: 56, marginStart: space.sm2 },
  chevron: { opacity: 0.35 },
  separator: { height: StyleSheet.hairlineWidth },
})
