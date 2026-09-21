/* =========================================================
   Charts, drawn by hand with react-native-svg.

   No chart library: the four shapes this domain needs (a
   sparkline, a single-series area, a 100% stacked bar and a
   horizontal bar chart) are a few paths each, and a library
   would arrive with its own colour system to fight the theme's.

   COLOUR. Every hue here is a theme token, never a literal.
   Magnitude charts (growth, posts-by-type, sparkline) are ONE
   hue — `colors.accent` — because length already carries the
   number and a second hue would imply a second variable. The
   join-source bar is the one categorical scale, and its slot
   order is fixed so a filter that drops a source never repaints
   the survivors.

   That order — green · blue · amber · violet · red — is not
   aesthetic. Green/amber, green/red and amber/red are each
   confusable under deutan or protan vision, so the two hues
   that separate cleanly from everything (blue, violet) are
   placed BETWEEN them; every adjacent pair then clears ΔE 8 in
   both schemes. Amber on a white surface sits under 3:1, which
   is why the legend is a labelled list and never colour alone.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useSharedValue } from 'react-native-reanimated'
import Svg, {
  Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop,
} from 'react-native-svg'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, space } from '@/theme/tokens'
import { Text, Touchable, fireHaptic, formatCount } from '@/ui'

/* ---------------------------------------------------------
   The categorical scale
   --------------------------------------------------------- */

/** Fixed slot order. `dark` steps are chosen against the dark surface rather
 *  than derived by inverting the light ones — a 500 that reads on white is a
 *  different colour from a 500 that reads on near-black. */
const CATEGORICAL = [
  { light: ramp.green[500], dark: ramp.green[500] },
  { light: ramp.brand[500], dark: ramp.brand[500] },
  { light: ramp.amber[500], dark: ramp.amber[600] },
  { light: ramp.violet[500], dark: ramp.violet[500] },
  { light: ramp.red[500], dark: ramp.red[500] },
]

export function useCategorical(): string[] {
  const t = useTheme()
  return React.useMemo(
    () => CATEGORICAL.map(s => (t.scheme === 'dark' ? s.dark : s.light)),
    [t.scheme],
  )
}

/* ---------------------------------------------------------
   Path helpers
   --------------------------------------------------------- */

const round2 = (n: number) => Math.round(n * 100) / 100

function linePath(pts: { x: number; y: number }[]) {
  if (!pts.length) return ''
  return pts.map((p, i) => `${i ? 'L' : 'M'}${round2(p.x)},${round2(p.y)}`).join(' ')
}

function areaPath(pts: { x: number; y: number }[], baseline: number) {
  if (!pts.length) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${linePath(pts)} L${round2(last.x)},${round2(baseline)} L${round2(first.x)},${round2(baseline)} Z`
}

/** A bar rounded only at the value end, so every bar shares a flat baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.max(0, w), h / 2)
  if (w <= rr) return `M${round2(x)},${round2(y)} h${round2(Math.max(0, w))} v${round2(h)} h${round2(-Math.max(0, w))} Z`
  return [
    `M${round2(x)},${round2(y)}`,
    `H${round2(x + w - rr)}`,
    `A${rr},${rr} 0 0 1 ${round2(x + w)},${round2(y + rr)}`,
    `V${round2(y + h - rr)}`,
    `A${rr},${rr} 0 0 1 ${round2(x + w - rr)},${round2(y + h)}`,
    `H${round2(x)}`,
    'Z',
  ].join(' ')
}

/* ---------------------------------------------------------
   Sparkline — the 32px trend inside a stat tile. No axes, no
   dots, no labels: the tile's own figure is the number.
   --------------------------------------------------------- */

export function Sparkline({
  values, width, height = 32, color,
}: { values: number[]; width: number; height?: number; color?: string }) {
  const t = useTheme()
  const stroke = color ?? t.colors.accent
  if (!values.length || width <= 0) return <View style={{ height }} />

  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const pts = values.map((v, i) => ({
    x: values.length > 1 ? i * step : width / 2,
    y: height - 2 - (v / max) * (height - 4),
  }))

  return (
    <Svg width={width} height={height}>
      <Path d={linePath(pts)} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  )
}

/* ---------------------------------------------------------
   Area chart — one series, over time.
   --------------------------------------------------------- */

export interface AreaPoint { date: string; value: number }

export function AreaChart({
  points, width, height = 160, onScrub,
}: {
  points: AreaPoint[]
  width: number
  height?: number
  onScrub?: (p: AreaPoint | null) => void
}) {
  const t = useTheme()
  const c = t.colors
  const [active, setActive] = React.useState<number | null>(null)
  const lastTick = React.useRef<number | null>(null)
  /* UI-thread mirror of `active`, -1 standing in for "not scrubbing" so the
     comparison stays a scalar the worklet can hold. The crosshair is SVG and
     the tooltip is TEXT — neither can be driven from a shared value without
     animated props on Line, Circle and the label, which is more moving parts
     than the win — so the index still lands in React state. What changes is
     the RATE: a pan reports ~60 frames a second but a 30-day chart has 30
     buckets, so hopping the bridge only when the bucket CHANGES turns a
     re-render of the whole chart per frame into one per step, and the
     select-haptic keeps its one-per-day cadence for free. */
  const activeSV = useSharedValue(-1)

  const padTop = 10
  const padBottom = 20
  const plotH = height - padTop - padBottom
  const max = Math.max(...points.map(p => p.value), 1)
  const step = points.length > 1 ? width / (points.length - 1) : 0

  const pts = points.map((p, i) => ({
    x: points.length > 1 ? i * step : width / 2,
    y: padTop + plotH - (p.value / max) * plotH,
  }))

  const setIndex = React.useCallback((i: number | null) => {
    setActive(i)
    if (i != null && lastTick.current !== i) { lastTick.current = i; fireHaptic('select') }
    onScrub?.(i == null ? null : points[i])
  }, [onScrub, points])

  const pan = React.useMemo(
    () => Gesture.Pan()
      /* Horizontal only: the chart lives inside a ScrollView and a pan that
         claimed vertical drags would make the page feel stuck. */
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .hitSlop({ top: 24, bottom: 24, left: 0, right: 0 })
      .onBegin(e => {
        const i = nearest(e.x, step, points.length)
        if (i !== activeSV.value) { activeSV.value = i; runOnJS(setIndex)(i) }
      })
      .onUpdate(e => {
        const i = nearest(e.x, step, points.length)
        if (i !== activeSV.value) { activeSV.value = i; runOnJS(setIndex)(i) }
      })
      /* Once per gesture either way, and unconditional so a points array that
         changed under a live scrub still clears. */
      .onFinalize(() => { activeSV.value = -1; runOnJS(setIndex)(null) }),
    [setIndex, step, points.length, activeSV],
  )

  const cur = active == null ? null : points[active]

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.accent} stopOpacity={0.12} />
                <Stop offset="1" stopColor={c.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* A recessive grid: four ticks, hairline, never competing with the
                series it exists to measure. */}
            {[0, 1, 2, 3].map(i => {
              const y = padTop + (plotH / 3) * i
              return <Line key={i} x1={0} y1={y} x2={width} y2={y} stroke={c.separator} strokeWidth={1} />
            })}

            <Path d={areaPath(pts, padTop + plotH)} fill="url(#areaFill)" />
            <Path d={linePath(pts)} stroke={c.accent} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

            {active != null ? (
              <G>
                <Line x1={pts[active].x} y1={padTop} x2={pts[active].x} y2={padTop + plotH} stroke={c.borderStrong} strokeWidth={1} />
                <Circle cx={pts[active].x} cy={pts[active].y} r={5} fill={c.accent} stroke={c.surface} strokeWidth={2} />
              </G>
            ) : null}
          </Svg>
        </View>
      </GestureDetector>

      <View style={styles.axisRow}>
        <Text variant="micro" tone="faint">{shortDate(points[0]?.date)}</Text>
        <Text variant="micro" tone="faint">{shortDate(points[Math.floor(points.length / 2)]?.date)}</Text>
        <Text variant="micro" tone="faint">{shortDate(points[points.length - 1]?.date)}</Text>
      </View>

      {cur ? (
        <View style={[styles.tooltip, { backgroundColor: c.surfaceInverse, borderRadius: t.radius.sm }]}>
          <Text variant="caption" color={c.textInverse} align="center">
            {shortDate(cur.date)} · {cur.value === 1 ? '1 join' : `${cur.value} joins`}
          </Text>
        </View>
      ) : (
        <Text variant="micro" tone="faint" align="center" style={{ marginTop: space.xs }}>
          Peak {formatCount(max)} · drag for a day
        </Text>
      )}
    </View>
  )
}

function nearest(x: number, step: number, count: number) {
  if (count <= 1 || step <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(x / step)))
}

/* ---------------------------------------------------------
   100% stacked bar — composition, once. Never a donut: a
   human reads length far better than angle, and the legend
   below carries every label and count anyway.
   --------------------------------------------------------- */

export interface Segment { key: string; label: string; value: number }

export function StackedBar({
  segments, width, height = 28, onPressSegment,
}: { segments: Segment[]; width: number; height?: number; onPressSegment?: (s: Segment) => void }) {
  const t = useTheme()
  const c = t.colors
  const palette = useCategorical()
  const total = segments.reduce((n, s) => n + s.value, 0)
  if (!total || width <= 0) return null

  const GAP = 2
  let x = 0
  const boxes = segments.map((s, i) => {
    const w = Math.max(0, (s.value / total) * width - (i < segments.length - 1 ? GAP : 0))
    const box = { x, w, fill: i < palette.length ? palette[i] : c.textFaint }
    x += w + GAP
    return box
  })

  return (
    <Svg width={width} height={height}>
      <Defs>
        <ClipPath id="stackClip">
          <Rect x={0} y={0} width={width} height={height} rx={4} ry={4} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#stackClip)">
        {boxes.map((b, i) => (
          <Rect
            key={segments[i].key}
            x={b.x}
            y={0}
            width={b.w}
            height={height}
            fill={b.fill}
            onPress={onPressSegment ? () => onPressSegment(segments[i]) : undefined}
          />
        ))}
      </G>
    </Svg>
  )
}

/** The legend is a LIST, not a chip row: each line carries the swatch, the
 *  label and the raw count, so identity never rests on colour alone — which
 *  is also what discharges the amber-on-white contrast warning. */
export function StackedLegend({
  segments, onPress,
}: { segments: Segment[]; onPress?: (s: Segment) => void }) {
  const t = useTheme()
  const palette = useCategorical()
  const total = segments.reduce((n, s) => n + s.value, 0) || 1
  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      {segments.map((s, i) => (
        <Touchable
          key={s.key}
          onPress={onPress ? () => onPress(s) : undefined}
          disabled={!onPress}
          feedback="dim"
          noAutoHitSlop
          style={styles.legendRow}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: i < palette.length ? palette[i] : t.colors.textFaint,
            }}
          />
          <Text variant="footnote" align="ui" numberOfLines={1} style={styles.flex}>{s.label}</Text>
          <Text variant="footnote" tone="muted">
            {formatCount(s.value)} · {Math.round((s.value / total) * 100)}%
          </Text>
        </Touchable>
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   Horizontal bar chart — magnitude, one hue, direct labels.
   --------------------------------------------------------- */

export function BarChart({
  rows, width, onPressBar,
}: {
  rows: { key: string; label: string; value: number }[]
  width: number
  onPressBar?: (row: { key: string; label: string; value: number }) => void
}) {
  const t = useTheme()
  const c = t.colors
  const max = Math.max(...rows.map(r => r.value), 1)
  const barH = 20
  const gap = 14
  const labelW = Math.min(96, width * 0.34)
  const valueW = 46
  const trackW = Math.max(10, width - labelW - valueW - 12)
  const height = rows.length * (barH + gap)

  return (
    <View>
      <Svg width={width} height={height}>
        {rows.map((r, i) => {
          const y = i * (barH + gap)
          const w = (r.value / max) * trackW
          return (
            <G key={r.key}>
              <Rect x={labelW} y={y} width={trackW} height={barH} rx={4} fill={c.surfaceSunken} />
              <Path d={barPath(labelW, y, w, barH, 4)} fill={c.accent} />
            </G>
          )
        })}
      </Svg>

      {/* Labels ride in RN text rather than <SvgText> so they inherit the type
          ramp, the font scale and the RTL rules the rest of the app uses. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {rows.map((r, i) => (
          <Touchable
            key={r.key}
            onPress={onPressBar ? () => onPressBar(r) : undefined}
            disabled={!onPressBar}
            feedback="dim"
            noAutoHitSlop
            style={{
              position: 'absolute',
              top: i * (barH + gap),
              left: 0,
              right: 0,
              height: barH,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text variant="caption" tone="secondary" numberOfLines={1} align="ui" style={{ width: labelW - 8 }}>
              {r.label}
            </Text>
            <View style={styles.flex} />
            <Text variant="caption" tone="muted" style={{ width: valueW, textAlign: 'right' }}>
              {formatCount(r.value)}
            </Text>
          </Touchable>
        ))}
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Formatting
   --------------------------------------------------------- */

/* One cached formatter, not one per call: every `toLocale*` with an options
   bag builds a fresh Intl.DateTimeFormat internally, and on Hermes that ICU
   pattern resolution is an order of magnitude dearer than formatting through
   a cached instance. This runs once per axis label per render. */
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** joinsByDay keys are ISO dates ('2026-08-16'). */
export function shortDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return SHORT_DATE.format(d)
}

const styles = StyleSheet.create({
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xxs },
  tooltip: { alignSelf: 'center', paddingHorizontal: space.sm2, paddingVertical: space.xs, marginTop: space.xs2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  flex: { flex: 1 },
})
