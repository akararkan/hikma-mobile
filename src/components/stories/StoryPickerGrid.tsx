/* =========================================================
   StoryPickerGrid — the selectable 2:3 grid.

   Shared by the two highlight editors: "which of your live
   frames go in?" is the same question in both, and a snapshot
   can only ever be taken from a story that is still alive.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Icon, Text, fireHaptic } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { ModerationBadge } from './ModerationBadge'
import { StoryPoster } from './StoryPoster'
import { ink, shade } from './night'
import type { StoryRow } from './storyVisual'

export interface StoryPickerGridProps {
  stories: StoryRow[]
  selectedIds: Set<string>
  /** Already in the target highlight — shown, dimmed, and not tappable. */
  disabledIds?: Set<string>
  onToggle: (storyId: string) => void
  numColumns?: number
  gutter?: number
  pad?: number
}

export function StoryPickerGrid({
  stories, selectedIds, disabledIds, onToggle, numColumns = 3, gutter = 8, pad = 16,
}: StoryPickerGridProps) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const cell = (width - pad * 2 - gutter * (numColumns - 1)) / numColumns
  const order = React.useMemo(() => [...selectedIds], [selectedIds])

  return (
    <View style={[styles.grid, { paddingHorizontal: pad, gap: gutter }]}>
      {stories.map(s => {
        const id = String(s.storyId)
        const disabled = !!disabledIds?.has(id)
        const selected = selectedIds.has(id)
        const index = order.indexOf(id)
        return (
          <StoryPoster
            key={id}
            story={s}
            width={cell}
            selected={selected}
            dimmed={disabled}
            onPress={disabled ? undefined : () => { fireHaptic('light'); onToggle(id) }}
            accessibilityLabel={selected ? 'Selected story' : 'Select story'}
          >
            <ModerationBadge item={s} size="chip" style={styles.held} />
            <View
              style={[
                styles.check,
                {
                  backgroundColor: disabled || selected ? t.colors.accent : shade.chip,
                  borderColor: ink.full,
                },
              ]}
            >
              {disabled ? (
                <Icon name="check" size={13} color={ink.full} />
              ) : selected ? (
                <Text variant="micro" color={ink.full} align="center">{index + 1}</Text>
              ) : null}
            </View>
          </StoryPoster>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  check: {
    position: 'absolute',
    top: 6,
    end: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: { position: 'absolute', top: 6, start: 6 },
})
