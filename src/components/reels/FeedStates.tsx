/* =========================================================
   The four plates a black feed needs.

   @/ui's EmptyState and ErrorState are scheme-aware and would
   paint a light card in the middle of a video — so the reel
   stage gets its own, with the same contract: copy for a 4xx
   comes from the server via errorText, everything else comes
   from the taxonomy, and every failure that can be retried
   offers a retry.

   The loading state is deliberately NOT a spinner on black. A
   spinner says "wait"; a shimmering plate the shape of a reel
   says "this is where it will be", which is the difference
   between a slow app and a broken one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { errorText, isNetworkError, isNotFound, isTransient } from '@/api'
import { setback, shape, space } from '@/theme/tokens'
import { Button, Icon, Text, type IconName } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { PLATE_GRADIENT, STAGE } from './skin'

/* ---------------------------------------------------------
   A skeleton reel — the dark plate plus the two blocks where
   the meta and the rail will be.

   `bottomInset` is the same number the pager hands its cards
   (tab bar + safe area, or just the safe area on a deep link),
   so the placeholders sit exactly where the real chrome will
   land. Hardcoding it used to drop the blocks ~55pt above the
   real thing on /reels/[id] and jump on arrival. The default
   is the tab's typical value, for callers that have not
   measured yet.
   --------------------------------------------------------- */

export function ReelSkeleton({ width, height, bottomInset = 98 }: {
  width: number
  height: number
  bottomInset?: number
}) {
  const t = useTheme()
  const pulse = useSharedValue(0.35)

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { pulse.value = 0.4; return }
    pulse.value = withRepeat(withTiming(0.7, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(pulse)
  }, [pulse, t.prefs.reducedMotion])

  const shimmer = useAnimatedStyle(() => ({ opacity: pulse.value }))

  return (
    <View style={{ width, height, backgroundColor: STAGE.black }}>
      <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} />
      <View style={[styles.skelMeta, { bottom: bottomInset + 22 }]} pointerEvents="none">
        <Animated.View style={[styles.bar, { width: 132, height: 15 }, shimmer]} />
        <Animated.View style={[styles.bar, { width: '72%', height: 12, marginTop: space.sm2 }, shimmer]} />
        <Animated.View style={[styles.bar, { width: '48%', height: 12, marginTop: space.sm }, shimmer]} />
        {/* The sound chip's placeholder — same setback as the chip it stands
            in for, so nothing changes shape when the real one arrives. */}
        <Animated.View style={[styles.bar, styles.skelChip, shimmer]} />
      </View>
      <View style={[styles.skelRail, { bottom: bottomInset + 26 }]} pointerEvents="none">
        {[46, 30, 30, 28, 28].map((d, i) => (
          <Animated.View key={i} style={[styles.dot, { width: d, height: d, borderRadius: d / 2 }, shimmer]} />
        ))}
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Empty / error / offline.
   --------------------------------------------------------- */

export interface FeedStateProps {
  icon?: IconName
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  style?: any
}

export function ReelPlate({
  icon = 'reels', title, body, actionLabel, onAction, secondaryLabel, onSecondary, style,
}: FeedStateProps) {
  return (
    <View style={[styles.plate, style]}>
      <View style={styles.glyphRing}>
        <Icon name={icon} size={30} color={STAGE.fgFaint} />
      </View>
      <Text variant="title3" color={STAGE.fg} align="center">{title}</Text>
      {body ? (
        <Text variant="callout" color={STAGE.fgMuted} align="center" style={styles.plateBody}>{body}</Text>
      ) : null}
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} variant="onDark" size="md" style={{ marginTop: space.lg2 }} />
      ) : null}
      {secondaryLabel ? (
        <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" size="sm" style={{ marginTop: space.xs }} />
      ) : null}
    </View>
  )
}

/** The error taxonomy, rendered. `isTransient` gets its one delayed auto-retry
 *  from the caller (usePagedReels); this only says so honestly. */
export function ReelErrorPlate({ error, onRetry }: { error: any; onRetry?: () => void }) {
  const offline = isNetworkError(error)
  const missing = isNotFound(error)
  const temporary = isTransient(error)

  return (
    <ReelPlate
      icon={offline ? 'offline' : missing ? 'search' : 'error'}
      title={
        offline ? "You're offline"
          : missing ? 'This reel is no longer available.'
            : temporary ? 'Temporary problem' : 'Something went wrong'
      }
      body={
        offline ? 'Could not reach the server — check your connection and try again.'
          : missing ? 'It may have been deleted by its author.'
            : temporary ? 'Try again in a moment.' : errorText(error)
      }
      actionLabel={missing ? undefined : 'Try again'}
      onAction={onRetry}
    />
  )
}

/** The persistent chip that sits under the top chrome while the device has no
 *  connection — the name is historical; the plate is a setback chip like every
 *  other. Paging is suspended behind it; what is cached stays playable. */
export function OfflinePill({ top }: { top: number }) {
  return (
    <View style={[styles.offline, { top }]} pointerEvents="none">
      <Icon name="offline" size={13} color={STAGE.fg} />
      <Text variant="caption" weight="600" color={STAGE.fg}>You&rsquo;re offline</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  /* start/end match ReelCard's `meta` and `railWrap` exactly — a skeleton that
     lands anywhere else animates into place, which is the tell. */
  skelMeta: { position: 'absolute', start: 14, end: 78 },
  skelRail: { position: 'absolute', end: 8, width: 64, gap: space.xl, alignItems: 'center' },
  bar: { backgroundColor: 'rgba(255,255,255,0.4)', ...setback(shape.skeleton), borderCurve: 'continuous' },
  skelChip: { width: 150, height: 28, marginTop: space.lg, ...setback(shape.chip) },
  dot: { backgroundColor: 'rgba(255,255,255,0.4)' },
  plate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 34, gap: space.xs2 },
  plateBody: { maxWidth: 320, marginTop: space.xxs },
  glyphRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  offline: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 26,
    paddingHorizontal: space.md,
    /* A chip, not a pill (DESIGN.md §8.9). */
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
    zIndex: 30,
  },
})
