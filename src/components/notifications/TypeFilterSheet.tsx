/* =========================================================
   "Filter by type" — the multi-select over NotificationType,
   including the six uncategorized kinds no category chip can
   reach.

   NOTE: the spec routes this at /(app)/notifications/filter.
   It ships as a sheet instead because this agent owns the leaf
   file `(app)/notifications.tsx` and adding a sibling
   `notifications/` directory would claim a route another agent
   may already be laying out. Nothing else changes: the applied
   value is still an ARRAY of enum names handed to
   api.notifications.list, which serialises it as the repeatable
   ?type=A&type=B Spring expects.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Callout, Icon, Sheet, Text, Touchable, fireHaptic } from '@/ui'
import { NOTIF_TYPE_SECTIONS, kindOf, toneColors, typeLabel } from './constants'

export interface TypeFilterSheetProps {
  visible: boolean
  onClose: () => void
  /** The set the inbox is currently filtering by. */
  value: string[]
  onApply: (types: string[]) => void
  /** Drives the warning strip — applying types forces the chip back to All. */
  categoryActive?: boolean
}

export function TypeFilterSheet({ visible, onClose, value, onApply, categoryActive }: TypeFilterSheetProps) {
  const t = useTheme()
  const c = t.colors
  const [picked, setPicked] = React.useState<string[]>(value)

  /* Re-seed on every open: the sheet stays mounted between openings, so a
     dismissed edit must not survive into the next one. */
  React.useEffect(() => { if (visible) setPicked(value) }, [visible, value])

  const set = React.useMemo(() => new Set(picked), [picked])
  const dirty = picked.length !== value.length || picked.some(x => !value.includes(x))

  const toggle = (type: string) => {
    fireHaptic('select')
    setPicked(prev => (prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]))
  }

  const toggleSection = (types: string[], on: boolean) => {
    fireHaptic('select')
    setPicked(prev => (on
      ? [...prev, ...types.filter(x => !prev.includes(x))]
      : prev.filter(x => !types.includes(x))))
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter by type"
      subtitle={picked.length ? `${picked.length} selected` : 'Everything'}
      maxHeightRatio={0.92}
      footer={
        <View style={styles.footer}>
          <Button
            label="Clear all"
            onPress={() => setPicked([])}
            variant="ghost"
            size="md"
            disabled={!picked.length}
          />
          <Button
            label={picked.length ? `Show results (${picked.length})` : 'Show results'}
            onPress={() => { onApply(picked); onClose() }}
            variant="primary"
            size="md"
            disabled={!dirty && !picked.length}
            style={styles.flex}
          />
        </View>
      }
    >
      <View style={styles.body}>
        <Callout tone="info" icon="info">
          Type filters search your 200 most recent notifications only.
        </Callout>
        {categoryActive ? (
          <Callout tone="warning" icon="warning" style={styles.gap}>
            A category filter is active. Applying a type filter switches the inbox back to All —
            the server ignores types while a category is set.
          </Callout>
        ) : null}
      </View>

      {NOTIF_TYPE_SECTIONS.map(section => {
        const all = section.types.every(x => set.has(x))
        return (
          <View key={section.key}>
            <View style={styles.sectionHeader}>
              {/* `caption` already uppercases and tracks Latin inside the Text
                  primitive, and only Latin — a call-site transform would also
                  hit Arabic and Kurdish, which have no case. */}
              <Text variant="caption" tone="faint" align="ui">
                {section.title}
              </Text>
              <Touchable
                onPress={() => toggleSection(section.types, !all)}
                feedback="dim"
                style={styles.sectionAction}
                accessibilityLabel={all ? `Deselect ${section.title}` : `Select all ${section.title}`}
              >
                <Text variant="subhead" tone="accent" align="ui">{all ? 'None' : 'All'}</Text>
              </Touchable>
            </View>

            {section.types.map(type => {
              const on = set.has(type)
              const kind = kindOf(type)
              const tint = toneColors(c, kind.tone)
              return (
                <Touchable
                  key={type}
                  onPress={() => toggle(type)}
                  feedback="tint"
                  noAutoHitSlop
                  accessibilityState={{ checked: on }}
                  accessibilityRole="checkbox"
                  style={styles.row}
                >
                  <View style={[styles.glyph, { backgroundColor: tint.soft }]}>
                    <Icon name={kind.icon} size={16} color={tint.fg} />
                  </View>
                  <Text variant="body" align="ui" numberOfLines={1} style={styles.flex}>{typeLabel(type)}</Text>
                  {on
                    ? <Icon name="checkCircle" size={22} filled color={c.accent} />
                    : <View style={[styles.emptyCheck, { borderColor: c.borderStrong }]} />}
                </Touchable>
              )
            })}

            {section.footer ? (
              <Text variant="footnote" tone="faint" align="ui" style={styles.sectionFooter}>
                {section.footer}
              </Text>
            ) : null}
          </View>
        )
      })}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.lg, paddingTop: space.md2 },
  gap: { marginTop: space.sm2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
    paddingHorizontal: space.lg,
    marginTop: space.sm2,
  },
  sectionAction: { paddingVertical: space.xs, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 52, paddingHorizontal: space.lg },
  glyph: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  emptyCheck: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5 },
  sectionFooter: { paddingHorizontal: space.lg, paddingTop: space.xs2, paddingBottom: space.xs },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  flex: { flex: 1 },
})
