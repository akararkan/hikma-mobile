/* =========================================================
   The horizontal filter rail shared by the inbox's category
   tabs and the activity list's group chips.

   The unread marker is a DOT, never a number: per-category
   counts are counted inside the server's newest-200-row scan
   window, so a number would be confidently wrong and read as
   a bug. A dot only ever claims "something in here".

   The chips wear the CHIP SETBACK (8/3), not a pill — DESIGN.md
   §6 keeps pills for unread counters and LIVE badges alone. The
   dot itself stays a circle; dots are sanctioned round.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Text, Touchable } from '@/ui'

export interface RailOption { key: string; label: string }

export interface FilterChipRailProps {
  options: RailOption[]
  value: string
  onChange: (key: string) => void
  /** True → a dot on that chip. */
  dotFor?: (key: string) => boolean
  /** An extra chip pinned after the scrolling set (the activity "Filter" chip). */
  trailing?: React.ReactNode
  style?: any
}

export function FilterChipRail({ options, value, onChange, dotFor, trailing, style }: FilterChipRailProps) {
  const t = useTheme()
  const c = t.colors

  return (
    <View style={[styles.wrap, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {options.map(o => {
          const active = o.key === value
          return (
            <Touchable
              key={o.key}
              onPress={() => onChange(o.key)}
              haptic="select"
              feedback="scale"
              noAutoHitSlop
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? c.accent : c.surface,
                  borderColor: active ? c.accent : c.border,
                  /* Chip.tsx's weights: control when selected, course at rest. */
                  borderWidth: active ? t.rule.control : t.rule.course,
                },
              ]}
            >
              <Text
                variant="subhead"
                weight="600"
                align="ui"
                color={active ? c.textOnAccent : c.textSecondary}
              >
                {o.label}
              </Text>
              {dotFor?.(o.key) && !active ? (
                <View style={[styles.dot, { backgroundColor: c.accent, borderColor: c.bg }]} />
              ) : null}
            </Touchable>
          )
        })}
        {trailing}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { height: 44, justifyContent: 'center' },
  /* The wider paddingEnd leaves a mid-chip peek at the trailing edge — the
     rail scrolls, and a clean cut would read as the last chip. */
  content: { paddingStart: space.lg, paddingEnd: space.xxl, gap: space.sm, alignItems: 'center' },
  chip: {
    height: 34,
    paddingHorizontal: space.md2,
    alignItems: 'center',
    justifyContent: 'center',
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  dot: {
    position: 'absolute',
    top: -1,
    end: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
})
