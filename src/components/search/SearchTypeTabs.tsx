/* =========================================================
   SearchTypeTabs — the sticky strip over All + the eight types.

   Auto-scrolls the selected tab into view from a measured
   layout rather than a guessed offset: the labels are
   translated and their widths are not knowable ahead of time,
   so "Sounds" at the far end has to be found, not computed.

   No counts. The endpoint runs with `track_total_hits: false`,
   so there is no total to render and chrome that implies one
   would be a lie.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { SEARCH_TYPES } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text, Touchable } from '@/ui'
import { TAB_LABEL, type TabKey } from './searchTypes'

export const SEARCH_TABS: TabKey[] = ['ALL', ...(SEARCH_TYPES as TabKey[])]

export interface SearchTypeTabsProps {
  value: TabKey
  onChange: (v: TabKey) => void
}

export function SearchTypeTabs({ value, onChange }: SearchTypeTabsProps) {
  const t = useTheme()
  const c = t.colors
  const ref = React.useRef<ScrollView>(null)
  const spans = React.useRef(new Map<TabKey, { x: number; w: number }>())
  const viewport = React.useRef(0)

  React.useEffect(() => {
    const span = spans.current.get(value)
    if (!span || !viewport.current) return
    const target = span.x + span.w / 2 - viewport.current / 2
    ref.current?.scrollTo({ x: Math.max(0, target), animated: !t.prefs.reducedMotion })
  }, [value, t.prefs.reducedMotion])

  /* Stable, so the nine tabs below stay memoized while Explore re-renders on
     every keystroke of the query above them. */
  const measure = useEvent((key: TabKey, x: number, w: number) => { spans.current.set(key, { x, w }) })

  return (
    <View style={[styles.strip, { borderBottomColor: c.separator, backgroundColor: c.bg }]}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={e => { viewport.current = e.nativeEvent.layout.width }}
        contentContainerStyle={{ alignItems: 'stretch' }}
        accessibilityRole="tablist"
      >
        {SEARCH_TABS.map(key => (
          <Tab key={key} tabKey={key} active={key === value} onPress={onChange} onMeasure={measure} />
        ))}
      </ScrollView>
    </View>
  )
}

/* One tab, memoized on three scalars plus two stable functions — only the two
   tabs whose `active` actually flipped repaint on a selection change. */
const Tab = React.memo(function Tab({
  tabKey, active, onPress, onMeasure,
}: {
  tabKey: TabKey
  active: boolean
  onPress: (key: TabKey) => void
  onMeasure: (key: TabKey, x: number, w: number) => void
}) {
  const c = useTheme().colors
  const press = React.useCallback(() => onPress(tabKey), [onPress, tabKey])
  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    onMeasure(tabKey, e.nativeEvent.layout.x, e.nativeEvent.layout.width)
  }, [onMeasure, tabKey])

  return (
    <Touchable
      onPress={press}
      onLayout={onLayout}
      feedback="dim"
      haptic="select"
      noAutoHitSlop
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${TAB_LABEL[tabKey]} results`}
      style={styles.tab}
    >
      <Text
        variant="subhead"
        weight={active ? '700' : '500'}
        tone={active ? 'default' : 'muted'}
        align="center"
        numberOfLines={1}
      >
        {TAB_LABEL[tabKey]}
      </Text>
      {/* Inset to the label width, not the tap target — a full-width
          underline reads as a divider rather than a selection. */}
      <View style={[styles.underline, { backgroundColor: active ? c.accent : 'transparent' }]} />
    </Touchable>
  )
})

const styles = StyleSheet.create({
  strip: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { height: 44, paddingHorizontal: space.lg, justifyContent: 'center', alignItems: 'center' },
  underline: { position: 'absolute', bottom: 0, left: 16, right: 16, height: 2, borderRadius: 2 },
})
