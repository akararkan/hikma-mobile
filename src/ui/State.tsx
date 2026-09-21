/* =========================================================
   The four states every data surface has to render:
   loading, empty, error, offline.

   These are components rather than a convention because the
   alternative — each screen inventing its own — is how an app
   ends up with nine different "nothing here yet" screens and
   three of them missing the retry button.

   QELAT (DESIGN.md §6 "State"): loading is the WEFT SWEEP — a
   pale stone band gliding across setback skeleton blocks, so
   loading reads as weaving; empty and error centre the GUL
   MEDALLION over a Lora italic title; the spinner is a drawn
   270° arc, not the platform indicator.

   `ErrorState` takes the raw error object and derives its copy
   from the API's error module, so backend-owned messages are
   shown verbatim and only the client-owned framing lives here.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing, FadeIn, cancelAnimation, makeMutable, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, setback, space } from '@/theme/tokens'
import { errorText, isNetworkError, isNotFound, isRateLimited, cooldownSecondsFrom, traceRef } from '@/api'
import { Text } from './Text'
import { Icon, type IconName } from './Icon'
import { Button } from './Button'
import { GulMedallion } from './ornaments'

/* Masonry ease (motion.out): fast arrival, dead stop. */
const masonry = Easing.bezier(...motion.out)

/* ---------------------------------------------------------
   THE WEFT CLOCK — one module-scope animated value drives
   every skeleton on screen, so all blocks weave in unison
   instead of shimmering out of phase. Refcounted: the first
   skeleton starts the loop, the last one stops it.

   Two modes, chosen by the reduced-motion pref:
     sweep — 0→1 sawtooth, 1100ms linear, drives the band's
             translateX (reversed in RTL: the band travels in
             the writing direction).
     pulse — 0→1→0, 2s full cycle, drives a highlight overlay
             opacity (skeleton ↔ skeletonHighlight).
   --------------------------------------------------------- */
const weft = makeMutable(0)
let weftUsers = 0
let weftMode: 'sweep' | 'pulse' | null = null

function acquireWeft(reduced: boolean) {
  weftUsers++
  const mode = reduced ? 'pulse' : 'sweep'
  if (weftMode === mode) return
  weftMode = mode
  cancelAnimation(weft)
  weft.value = 0
  weft.value = mode === 'sweep'
    ? withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false)
    : withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }), -1, true)
}

function releaseWeft() {
  weftUsers--
  if (weftUsers <= 0) {
    weftUsers = 0
    weftMode = null
    cancelAnimation(weft)
    weft.value = 0
  }
}

/* ---------------------------------------------------------
   Skeleton — a setback placeholder block crossed by the sweep.
   --------------------------------------------------------- */

export interface SkeletonProps {
  width?: number | `${number}%`
  height?: number
  radius?: number
  circle?: boolean
  style?: StyleProp<ViewStyle>
}

export function Skeleton({ width = '100%', height = 14, radius, circle, style }: SkeletonProps) {
  const t = useTheme()
  const reduced = t.prefs.reducedMotion
  const rtl = t.isRTL
  /* Measured, because percent widths are the common case and the band's
     travel + its 45° pitch both need pixels. */
  const [dims, setDims] = React.useState({ w: 0, h: 0 })

  React.useEffect(() => {
    acquireWeft(reduced)
    return releaseWeft
  }, [reduced])

  const sweepStyle = useAnimatedStyle(() => {
    const w = dims.w
    /* LTR: −w → +w; RTL: +w → −w — the weft travels the writing way. */
    return { transform: [{ translateX: (rtl ? 1 : -1) * (w - weft.value * 2 * w) }] }
  })
  const pulseStyle = useAnimatedStyle(() => ({ opacity: weft.value }))

  const size = circle ? (typeof width === 'number' ? width : height) : undefined
  const corners: ViewStyle = circle
    ? { borderRadius: (size ?? height) / 2 }
    : radius != null
      ? { borderRadius: radius }
      : { ...setback(t.shape.skeleton), borderCurve: 'continuous' }

  return (
    <View
      onLayout={e => {
        const { width: lw, height: lh } = e.nativeEvent.layout
        setDims(d => (d.w === lw && d.h === lh ? d : { w: lw, h: lh }))
      }}
      style={[
        {
          width: circle ? size : width,
          height: circle ? size : height,
          backgroundColor: t.colors.skeleton,
          overflow: 'hidden',
        },
        corners,
        style,
      ]}
    >
      {reduced ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.skeletonHighlight }, pulseStyle]}
        />
      ) : dims.w > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
          {/* Hard-edged band. `end.y = w/h` pins the gradient axis to 45° in
              PIXEL space regardless of the block's aspect ratio. */}
          <LinearGradient
            colors={[t.colors.skeleton, t.colors.skeletonHighlight, t.colors.skeleton]}
            locations={[0.46, 0.5, 0.54]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: dims.h > 0 ? dims.w / dims.h : 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  )
}

/** A skeleton shaped like a list row: avatar + woven lines (100/72/88%). */
export function SkeletonRow({ avatarSize = 40, lines = 2 }: { avatarSize?: number; lines?: number }) {
  const t = useTheme()
  return (
    <View style={[styles.row, { padding: t.layout.screenPadding, gap: space.md }]}>
      <Skeleton circle width={avatarSize} height={avatarSize} />
      <View style={{ flex: 1, gap: space.sm, paddingTop: space.xs }}>
        <Skeleton width="100%" height={12} />
        {lines > 1 ? <Skeleton width="72%" height={11} /> : null}
        {lines > 2 ? <Skeleton width="88%" height={11} /> : null}
      </View>
    </View>
  )
}

/** A skeleton shaped like a feed card. */
export function SkeletonCard() {
  const t = useTheme()
  return (
    <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
      <View style={[styles.row, { gap: space.sm2 }]}>
        <Skeleton circle width={40} height={40} />
        <View style={{ flex: 1, gap: space.xs2 }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="24%" height={10} />
        </View>
      </View>
      <Skeleton width="100%" height={12} />
      <Skeleton width="72%" height={12} />
      <Skeleton height={200} />
    </View>
  )
}

export function SkeletonList({ count = 6, card = false }: { count?: number; card?: boolean }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (card ? <SkeletonCard key={i} /> : <SkeletonRow key={i} />))}
    </View>
  )
}

/* ---------------------------------------------------------
   Spinner — a drawn 270° arc, stroke 2, in accent, turning at
   900ms linear. For the in-place case (pagination footers,
   sheet bodies). Reduced motion trades the turn for a slow
   opacity pulse — the arc must still say "working".

   `color` exists for the night plates — the call/live/story
   surfaces draw on navy, where accent is nearly invisible and
   the arc has to ride their own ink instead. Everywhere else
   it stays unset and the arc is accent, as §6 says.
   --------------------------------------------------------- */

const SPINNER_PX = { small: 20, large: 32 } as const

export function Spinner({ label, style, size = 'small', color }: {
  label?: string
  style?: StyleProp<ViewStyle>
  size?: 'small' | 'large'
  color?: string
}) {
  const t = useTheme()
  const reduced = t.prefs.reducedMotion
  const turn = useSharedValue(0)

  React.useEffect(() => {
    turn.value = 0
    turn.value = reduced
      ? withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }), -1, true)
      : withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(turn)
  }, [turn, reduced])

  const anim = useAnimatedStyle(() =>
    reduced
      ? { opacity: 0.45 + turn.value * 0.55 }
      : { transform: [{ rotate: `${turn.value * 360}deg` }] })

  const px = SPINNER_PX[size]
  const c = px / 2
  const r = c - 1  /* stroke 2 stays inside the viewBox */

  return (
    <View style={[styles.center, { padding: space.xl, gap: space.sm2 }, style]}>
      <Animated.View style={anim}>
        <Svg width={px} height={px}>
          {/* 270°: from the top vertex, clockwise round to the start side. */}
          <Path
            d={`M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - r} ${c}`}
            stroke={color ?? t.colors.accent}
            strokeWidth={2}
            fill="none"
          />
        </Svg>
      </Animated.View>
      {/* The label follows the arc: a night plate that overrode the stroke
          would otherwise caption it in the light theme's muted slate, which
          on navy is a smudge. Unset, `muted` still wins. */}
      {label ? <Text variant="footnote" tone="muted" color={color} align="center">{label}</Text> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   The medallion shared by empty + error: the GUL, breathing
   once on mount (0.96→1, the `slower` settle). Reduced motion
   skips the breath — it starts settled.
   --------------------------------------------------------- */

function StateMedallion({ tone, compact }: { tone: 'scholar' | 'danger'; compact?: boolean }) {
  const t = useTheme()
  const scale = useSharedValue(t.prefs.reducedMotion ? 1 : 0.96)

  React.useEffect(() => {
    scale.value = withTiming(1, { duration: t.ms(motion.slower), easing: masonry })
  }, [scale, t])

  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <Animated.View style={[anim, { marginBottom: space.sm2 }]}>
      <GulMedallion size={compact ? 72 : 120} tone={tone} />
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   EmptyState — nothing is wrong, there is just nothing here.
   Medallion + Lora italic title + one md button. The `icon`
   prop is kept for call-site compatibility; the medallion is
   the mark now.
   --------------------------------------------------------- */

export interface EmptyStateProps {
  icon?: IconName
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

export function EmptyState({
  title, message, actionLabel, onAction, secondaryLabel, onSecondary, compact, style,
}: EmptyStateProps) {
  const t = useTheme()
  return (
    /* One gentle mount-only fade — the ground the medallion breathes on.
       Reduced motion drops the entrance entirely: the state simply is. */
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(motion.normal)}
      style={[styles.center, { padding: space.xxxl, paddingVertical: compact ? 32 : 56, gap: space.xs2 }, style]}
    >
      <StateMedallion tone="scholar" compact={compact} />
      <Text variant={compact ? 'headline' : 'title3'} serif italic align="center">{title}</Text>
      {message ? (
        <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{message}</Text>
      ) : null}
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} variant="tinted" size="md" style={{ marginTop: space.md2 }} />
      ) : null}
      {secondaryLabel ? (
        <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" size="sm" style={{ marginTop: space.xxs }} />
      ) : null}
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   ErrorState — something IS wrong. The medallion's middle
   ring goes danger (offline keeps the calm scholar blue — the
   network is absent, not broken).

   The copy comes from `errorText(err)`, which returns the
   backend's own message for a known envelope and a client
   fallback otherwise. A 404 is not retryable and says so; a
   429 counts down; a network error offers Retry and names the
   real cause instead of blaming the server.
   --------------------------------------------------------- */

export interface ErrorStateProps {
  error: any
  onRetry?: () => void
  /** Shown instead of the derived text when the screen knows better. */
  title?: string
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

export function ErrorState({ error, onRetry, title, compact, style }: ErrorStateProps) {
  const t = useTheme()
  const offline = isNetworkError(error)
  const missing = isNotFound(error)
  const limited = isRateLimited(error)
  const [cooldown, setCooldown] = React.useState(() => cooldownSecondsFrom(error))

  React.useEffect(() => {
    if (!limited) return
    setCooldown(cooldownSecondsFrom(error))
    const id = setInterval(() => setCooldown(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [error, limited])

  const heading =
    title ??
    (offline ? "You're offline"
      : missing ? 'Not found'
        : limited ? 'Slow down a moment'
          : 'Something went wrong')

  const body =
    offline ? 'Check your connection and try again.'
      : missing ? "This content isn't available. It may have been deleted."
        : limited && cooldown > 0 ? `You can try again in ${cooldown}s.`
          : errorText(error)

  const ref = traceRef(error)

  return (
    /* Same mount-only fade as EmptyState — cooldown ticks re-render, and an
       entering animation must not replay on them; mount is the only cue. */
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(motion.normal)}
      style={[styles.center, { padding: space.xxxl, paddingVertical: compact ? 28 : 52, gap: space.xs2 }, style]}
    >
      <StateMedallion tone={offline ? 'scholar' : 'danger'} compact={compact} />
      <Text variant={compact ? 'headline' : 'title3'} serif italic align="center">{heading}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{body}</Text>
      {onRetry && !missing ? (
        <Button
          label={limited && cooldown > 0 ? `Retry in ${cooldown}s` : 'Try again'}
          onPress={onRetry}
          disabled={limited && cooldown > 0}
          variant="secondary"
          icon="refresh"
          style={{ marginTop: space.md2 }}
        />
      ) : null}
      {ref ? (
        <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.sm2 }} selectable>
          Reference {String(ref).slice(0, 8)}
        </Text>
      ) : null}
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   Inline variants — for a footer or a row, not a whole screen.
   --------------------------------------------------------- */

export function InlineError({ error, onRetry }: { error: any; onRetry?: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.row, { gap: space.sm2, padding: space.md2, alignItems: 'center' }]}>
      <Icon name={isNetworkError(error) ? 'offline' : 'error'} size={16} color={t.colors.danger} />
      <Text variant="footnote" tone="danger" align="ui" style={{ flex: 1 }}>{errorText(error)}</Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="ghost" size="sm" /> : null}
    </View>
  )
}

/** The footer under an infinite list: spinner, error-with-retry, or the
 *  end-of-list rule. One component so every list ends the same way. */
export function ListFooter({
  loading, error, onRetry, done, doneLabel = "That's everything",
}: { loading?: boolean; error?: any; onRetry?: () => void; done?: boolean; doneLabel?: string }) {
  if (loading) return <Spinner />
  if (error) return <InlineError error={error} onRetry={onRetry} />
  if (done) {
    return (
      <View style={[styles.center, { paddingVertical: 26 }]}>
        <Text variant="footnote" tone="faint" align="center">{doneLabel}</Text>
      </View>
    )
  }
  return <View style={{ height: 12 }} />
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center' },
})
