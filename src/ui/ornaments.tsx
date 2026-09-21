/* =========================================================
   Ornaments — OXFORD edition.

   QELAT's drawn ornament layer (brick courses, seal bands,
   gilt knots, crenellations) is retired. Oxford is a printed
   folio: white paper, stone hairlines, slate ink. What
   remains here are the QUIET descendants of each ornament —
   same component names and props so the ~19 importing files
   keep compiling — and almost none of them draw SVG anymore,
   which is a real scroll-performance win: the story tray's
   per-avatar ring used to mount a react-native-svg tree per
   item; it is now a plain bordered View that costs nothing
   to recycle.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '@/theme/ThemeProvider'

/* ---------------------------------------------------------
   BRICK COURSE — retired. The Oxford ground is plain white
   (or a navy plate); no texture. Renders nothing so the
   header/auth call sites need no edits.
   --------------------------------------------------------- */
export const BrickCourse = React.memo(function BrickCourse(_props: {
  opacity?: number
  style?: ViewStyle
}) {
  return null
})

/* ---------------------------------------------------------
   SEAL BAND — retired texture; now a single stone hairline,
   the folio's printed rule under a header.
   --------------------------------------------------------- */
export const SealBand = React.memo(function SealBand({ style }: { style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View pointerEvents="none" style={style}>
      <View style={{ height: t.rule.course, backgroundColor: t.colors.separator }} />
    </View>
  )
})

/* ---------------------------------------------------------
   GUL MEDALLION — the empty-state mark: two concentric
   circles, stone outside, steel inside. Quiet, symmetrical,
   direction-neutral. Only ever on empty/error states — never
   in list items.
   --------------------------------------------------------- */
export const GulMedallion = React.memo(function GulMedallion({
  size = 120,
  tone = 'scholar',
  style,
}: { size?: number; tone?: 'scholar' | 'danger'; style?: ViewStyle }) {
  const t = useTheme()
  const c = size / 2
  const mid = tone === 'danger' ? t.colors.danger : t.colors.storyRing
  return (
    <View pointerEvents="none" style={style}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={c - 2} stroke={t.colors.border} strokeWidth={1.5} fill="none" />
        <Circle cx={c} cy={c} r={(c - 2) * 0.62} stroke={mid} strokeWidth={1.5} fill="none" />
      </Svg>
    </View>
  )
})

/* ---------------------------------------------------------
   WARP RULE — the section-title underline is now a plain
   stone hairline, full width. The gilt knot is retired.
   --------------------------------------------------------- */
export const WarpRule = React.memo(function WarpRule({ style }: { style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View
      pointerEvents="none"
      style={[{ height: t.rule.course, backgroundColor: t.colors.separator }, style]}
    />
  )
})

/* ---------------------------------------------------------
   WEFT DASH — intra-card division: a stone-soft hairline.
   Plain View; free inside list items.
   --------------------------------------------------------- */
export const WeftDash = React.memo(function WeftDash({ style }: { style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View
      pointerEvents="none"
      style={[{ height: t.rule.course, backgroundColor: t.colors.separator }, style]}
    />
  )
})

/* ---------------------------------------------------------
   SELECTION DIAMOND — now a selection DOT: a small filled
   circle that fades in when selected. Still a plain View, so
   it stays safe inside list rows (chat reaction chips mount
   one per confirmed reaction). API unchanged.
   --------------------------------------------------------- */
export const SelectionDiamond = React.memo(function SelectionDiamond({
  selected = true,
  size = 4,
  color,
}: { selected?: boolean; size?: number; color: string }) {
  const t = useTheme()
  const fade = useSharedValue(0)

  React.useEffect(() => {
    /* Reduce Motion cuts rather than fades — t.ms() returns 0 and a timing of
       0 is still a mapper to spin up and tear down, which matters here: these
       mount by the dozen inside the recycled message list. */
    const d = t.ms(t.motion.fast)
    fade.value = d === 0 ? (selected ? 1 : 0) : withTiming(selected ? 1 : 0, { duration: d })
  }, [selected, fade, t])

  const anim = useAnimatedStyle(() => ({ opacity: fade.value }))
  /* This LOOKS like an animated width/height/borderRadius sitting on an
     Animated.View and it is not — it is a memoized constant, recomputed only
     when the props change, and the only thing crossing a frame here is
     `opacity`, which is compositor work already. A layout-prop audit will flag
     it a second time; the answer is still no conversion. Scaling a `size`
     circle up from a smaller box would cost the same frames and lose the
     crisp edge these get at 4pt. */
  const box = React.useMemo(
    () => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: color }),
    [size, color],
  )

  return <Animated.View pointerEvents="none" style={[box, anim]} />
})

/* ---------------------------------------------------------
   CRENELLATION — the active-tab marker: one rounded bar in
   the accent, the web's tab underline. Plain View, no SVG.
   --------------------------------------------------------- */
export const Crenellation = React.memo(function Crenellation({ color }: { color?: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        width: 22,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: color ?? t.colors.accent,
      }}
    />
  )
})

/* ---------------------------------------------------------
   SEAL RING — the unseen-story ring: a plain circular border
   in steel (`storyRing`); stone-strong when seen is handled
   by the caller passing `seen`. No SVG — this mounts once per
   story-tray avatar and now recycles for free.
   --------------------------------------------------------- */
export const SealRing = React.memo(function SealRing({
  size,
  seen = false,
  style,
}: { size: number; seen?: boolean; style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: seen ? t.colors.storyRingSeen : t.colors.storyRing,
        },
        style,
      ]}
    />
  )
})

/* ---------------------------------------------------------
   ZIGGURAT CROWN — the sheet grabber: one rounded stone bar.
   --------------------------------------------------------- */
export const ZigguratCrown = React.memo(function ZigguratCrown({ style }: { style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View style={[styles.crown, style]}>
      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: t.colors.borderStrong,
        }}
      />
    </View>
  )
})

/* ---------------------------------------------------------
   DOUBLE RULE — the chrome edge is a single stone hairline
   now; headers and sheets rest on it (plus their soft shadow).
   --------------------------------------------------------- */
export const DoubleRule = React.memo(function DoubleRule({ style }: { style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View pointerEvents="none" style={style}>
      <View style={{ height: t.rule.course, backgroundColor: t.colors.separator }} />
    </View>
  )
})

/* ---------------------------------------------------------
   SELVEDGE — the role-marker strip on a card's start edge.
   ALIVE AND WELL: this is the research card's 3px discipline
   spine (hadith madder, tafsir navy, aqidah plum, fiqh steel,
   science teal, history olive) and the callout tone strip.
   Absolute-positioned; parent needs overflow: 'hidden'.
   Never more than one selvedge per card.
   --------------------------------------------------------- */
export const Selvedge = React.memo(function Selvedge({
  color,
  width,
  style,
}: { color: string; width?: number; style?: ViewStyle }) {
  const t = useTheme()
  return (
    <View
      pointerEvents="none"
      style={[
        styles.selvedge,
        { width: width ?? t.rule.selvedge, backgroundColor: color },
        style,
      ]}
    />
  )
})

const styles = StyleSheet.create({
  crown: { alignItems: 'center' },
  selvedge: { position: 'absolute', top: 0, bottom: 0, start: 0 },
})
