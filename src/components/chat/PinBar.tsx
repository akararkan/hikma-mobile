/* =========================================================
   The pinned-message bar under the header.

   Tapping cycles through the pins rather than jumping straight
   to the newest: a group with three pins usually has three
   different reasons for them, and a bar that always shows the
   same one hides the other two.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, shape, space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable } from '@/ui'
import { snippetOf } from './format'

export function PinBar({
  pinned, index, onCycle, onOpenList,
}: {
  pinned: any[]
  index: number
  onCycle: (next: number, message: any) => void
  onOpenList: () => void
}) {
  const t = useTheme()
  const c = t.colors
  if (!pinned.length) return null

  const safe = index % pinned.length
  const current = pinned[safe]

  return (
    <Touchable
      onPress={() => onCycle((safe + 1) % pinned.length, current)}
      onLongPress={onOpenList}
      feedback="tint"
      noAutoHitSlop
      accessibilityLabel="Pinned message"
      /* An announcement CARD, not a hairline bar (web .ch-pinbar under §14):
         the scholar wash under a Sky course, floated off the header on the
         card radius. The wash marks state — this is the one highlighted
         strip in the thread. */
      style={[styles.bar, { backgroundColor: c.scholarSoft, borderColor: c.sky }]}
    >
      <Icon name="pin" size={15} color={c.scholarText} filled />
      <View style={styles.body}>
        <Text variant="micro" color={c.scholarText} align="ui">Pinned message</Text>
        <Text variant="footnote" tone="secondary" align="auto" numberOfLines={1}>{snippetOf(current)}</Text>
      </View>
      {pinned.length > 1 ? (
        <NumericText variant="caption" color={c.scholarText}>{safe + 1}/{pinned.length}</NumericText>
      ) : null}
      <Touchable onPress={onOpenList} feedback="dim" accessibilityLabel="All pinned messages" style={styles.more}>
        <Icon name="list" size={16} color={c.scholarText} />
      </Touchable>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    height: 44, paddingHorizontal: space.md,
    marginTop: space.sm, marginHorizontal: space.md,
    borderWidth: rule.course,
    ...setback(shape.card), borderCurve: 'continuous',
  },
  body: { flex: 1 },
  more: { padding: space.xs },
})
