/* =========================================================
   Filter activity — types + an inclusive from/to range.

   No network at all: every option is a local constant.

   The one subtle rule is serialisation. The server parses
   INSTANTS, so a bare 'YYYY-MM-DD' is a 400 VALIDATION_FAILED;
   `from` therefore goes out as the selected day's 00:00:00.000
   UTC and `to` as 23:59:59.999 UTC. The types travel as a
   comma string in the route params and are split back into an
   ARRAY by the list screen, because api.activity.list is what
   comma-joins them into the CSV `types` param the endpoint
   wants — passing the raw string through would double-encode.
   ========================================================= */
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Button, Card, GroupLabel, Header, Icon, Screen, ScreenScroll, Sheet, Text, Touchable, fireHaptic,
} from '@/ui'
import {
  ACTIVITY_TYPE_SECTIONS, activityKindOf, activityTypeLabel, toneColors,
} from '@/components/notifications/constants'

type Preset = '7' | '30' | 'year' | 'all' | null

export default function ActivityFilterScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const params = useLocalSearchParams<{ types?: string; from?: string; to?: string }>()

  const [types, setTypes] = React.useState<string[]>(() => String(params.types || '').split(',').filter(Boolean))
  const [from, setFrom] = React.useState<string | null>(String(params.from || '') || null)
  const [to, setTo] = React.useState<string | null>(String(params.to || '') || null)
  const [preset, setPreset] = React.useState<Preset>(() => (params.from || params.to ? null : 'all'))
  const [picking, setPicking] = React.useState<'from' | 'to' | null>(null)

  const set = React.useMemo(() => new Set(types), [types])
  const invalidRange = !!from && !!to && Date.parse(from) > Date.parse(to)
  const anythingSet = types.length > 0 || !!from || !!to

  const toggle = (type: string) => {
    fireHaptic('select')
    setTypes(prev => (prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]))
  }

  const toggleGroup = (group: string[], on: boolean) => {
    fireHaptic('select')
    setTypes(prev => (on ? [...prev, ...group.filter(x => !prev.includes(x))] : prev.filter(x => !group.includes(x))))
  }

  const applyPreset = (p: Preset) => {
    fireHaptic('select')
    setPreset(p)
    const now = new Date()
    if (p === 'all' || p === null) { setFrom(null); setTo(null); return }
    if (p === 'year') {
      setFrom(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString())
      setTo(endOfUtcDay(now))
      return
    }
    const days = p === '7' ? 6 : 29
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() - days)
    setFrom(startOfUtcDay(start))
    setTo(endOfUtcDay(now))
  }

  const pickDate = (which: 'from' | 'to') => {
    const current = new Date((which === 'from' ? from : to) ?? Date.now())
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        maximumDate: new Date(),
        onChange: (_e, date) => { if (date) commitDate(which, date) },
      })
      return
    }
    setPicking(which)
  }

  const commitDate = (which: 'from' | 'to', date: Date) => {
    /* Editing either bound by hand means the preset no longer describes the
       range — leaving a chip lit would claim otherwise. */
    setPreset(null)
    if (which === 'from') setFrom(startOfUtcDay(date))
    else setTo(endOfUtcDay(date))
  }

  const reset = () => { setTypes([]); setFrom(null); setTo(null); setPreset('all') }

  const apply = () => {
    router.navigate({
      pathname: '/(app)/activity',
      params: { types: types.join(','), from: from ?? '', to: to ?? '' },
    } as any)
  }

  return (
    <Screen background="sunken">
      <Header
        closeButton
        title="Filter activity"
        actions={[{ icon: 'refresh', onPress: reset, label: 'Reset', tone: anythingSet ? 'danger' : 'default' }]}
      />

      <ScreenScroll contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}>
        <GroupLabel>Date range</GroupLabel>
        <Card variant="outlined" style={styles.card} padding={0}>
          <View style={styles.presetRow}>
            {([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['year', 'This year'], ['all', 'All time']] as const).map(([key, label]) => {
              const active = preset === key
              return (
                <Touchable
                  key={key}
                  onPress={() => applyPreset(key)}
                  feedback="scale"
                  noAutoHitSlop
                  accessibilityState={{ selected: active }}
                  style={[styles.preset, { backgroundColor: active ? c.accent : 'transparent', borderColor: active ? c.accent : c.border }]}
                >
                  <Text variant="footnote" weight="600" align="ui" color={active ? c.textOnAccent : c.textSecondary}>
                    {label}
                  </Text>
                </Touchable>
              )
            })}
          </View>

          <View style={[styles.hairline, { backgroundColor: c.separator }]} />

          <DateRow label="From" value={from} onPress={() => pickDate('from')} />
          <View style={[styles.hairline, { backgroundColor: c.separator, marginStart: space.lg }]} />
          <DateRow label="To" value={to} onPress={() => pickDate('to')} />
        </Card>

        {invalidRange ? (
          <View style={styles.validation}>
            <Icon name="error" size={14} color={c.danger} />
            <Text variant="footnote" tone="danger" align="ui">The start date must be before the end date.</Text>
          </View>
        ) : (
          <Text variant="footnote" tone="faint" align="ui" style={styles.footnote}>Both bounds are inclusive.</Text>
        )}

        <GroupLabel>Types</GroupLabel>
        {ACTIVITY_TYPE_SECTIONS.map(section => {
          const all = section.types.every(x => set.has(x))
          return (
            <View key={section.key}>
              <View style={styles.sectionHeader}>
                {/* No .toUpperCase() and no letterSpacing here: the `caption`
                    variant owns both, and it skips them on Arabic script —
                    a transform applied at the call site mutates the string
                    itself and the primitive's clamp cannot undo it. */}
                <Text variant="caption" tone="faint" align="ui">
                  {section.label}
                </Text>
                <Touchable
                  onPress={() => toggleGroup(section.types, !all)}
                  feedback="dim"
                  style={styles.sectionAction}
                  accessibilityLabel={all ? `Deselect ${section.label}` : `Select all ${section.label}`}
                >
                  <Text variant="subhead" tone="accent" align="ui">{all ? 'None' : 'All'}</Text>
                </Touchable>
              </View>

              <Card variant="outlined" style={styles.card} padding={0}>
                {section.types.map((type, i) => {
                  const on = set.has(type)
                  const kind = activityKindOf(type)
                  const tint = toneColors(c, kind.tone)
                  return (
                    <View key={type}>
                      {i > 0 ? <View style={[styles.hairline, { backgroundColor: c.separator, marginStart: space.giant }]} /> : null}
                      <Touchable
                        onPress={() => toggle(type)}
                        feedback="tint"
                        noAutoHitSlop
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        style={styles.typeRow}
                      >
                        <View style={[styles.glyph, { backgroundColor: tint.soft }]}>
                          <Icon name={kind.icon} size={16} color={tint.fg} />
                        </View>
                        <Text variant="body" align="ui" numberOfLines={1} style={styles.flex}>
                          {activityTypeLabel(type)}
                        </Text>
                        {on
                          ? <Icon name="checkCircle" size={22} filled color={c.accent} />
                          : <View style={[styles.emptyCheck, { borderColor: c.borderStrong }]} />}
                      </Touchable>
                    </View>
                  )
                })}
              </Card>
            </View>
          )
        })}
      </ScreenScroll>

      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: c.bgElevated, borderTopColor: c.separator },
        ]}
      >
        <Button label="Clear types" variant="ghost" size="md" disabled={!types.length} onPress={() => setTypes([])} />
        <Button
          label={types.length ? `Show results (${types.length})` : 'Show results'}
          variant="primary"
          size="md"
          style={styles.flex}
          disabled={invalidRange}
          onPress={apply}
        />
      </View>

      {/* iOS gets the inline spinner in a sheet; Android opens its own dialog. */}
      <Sheet visible={picking !== null} onClose={() => setPicking(null)} title={picking === 'to' ? 'To' : 'From'} scrollable={false}>
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={new Date((picking === 'to' ? to : from) ?? Date.now())}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onChange={(_e, date) => { if (date && picking) commitDate(picking, date) }}
          />
          <Button label="Done" variant="primary" size="md" block onPress={() => setPicking(null)} />
        </View>
      </Sheet>
    </Screen>
  )
}

function DateRow({ label, value, onPress }: { label: string; value: string | null; onPress: () => void }) {
  const t = useTheme()
  return (
    <Touchable onPress={onPress} feedback="tint" noAutoHitSlop style={styles.dateRow} accessibilityLabel={`${label} date`}>
      <Text variant="body" align="ui" style={styles.flex}>{label}</Text>
      <Text variant="body" tone={value ? 'default' : 'faint'} align="ui">
        {value ? longDate(value) : 'Any'}
      </Text>
      <Icon name="forward" size={16} color={t.colors.textFaint} />
    </Touchable>
  )
}

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString()

const endOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString()

function longDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Any' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginHorizontal: space.lg, overflow: 'hidden' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, padding: space.md },
  /* Setback, not a capsule — these carry labels (DESIGN.md §8.9). */
  preset: {
    height: 32, paddingHorizontal: space.md, justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, ...setback(shape.chip), borderCurve: 'continuous',
  },
  hairline: { height: StyleSheet.hairlineWidth },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 52, paddingHorizontal: space.lg },
  validation: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.xl, paddingTop: space.sm, minHeight: 32 },
  footnote: { paddingHorizontal: space.xl, paddingTop: space.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
    paddingHorizontal: space.xl,
    marginTop: space.md2,
  },
  sectionAction: { paddingVertical: space.xs },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 52, paddingHorizontal: space.lg },
  glyph: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  emptyCheck: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerWrap: { padding: space.lg, gap: space.md },
})
