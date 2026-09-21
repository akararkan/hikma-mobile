/* =========================================================
   HighlightPill — a permanent archive, as a circle.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { assetUrl } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { FILL, ink } from './night'
import { frameGradient } from './storyVisual'

export interface HighlightRow {
  highlightId: string
  authorId?: string
  title: string
  coverUrl?: string | null
  displayOrder?: number
  createdAt?: string
}

export interface HighlightPillProps {
  highlight: HighlightRow
  size?: number
  onPress?: () => void
  onLongPress?: () => void
  /** Reorder mode's ±1.2° loop. */
  wiggle?: boolean
}

export function HighlightPill({ highlight, size = 64, onPress, onLongPress, wiggle = false }: HighlightPillProps) {
  const t = useTheme()
  const tilt = useSharedValue(0)
  const cover = highlight.coverUrl ? assetUrl(highlight.coverUrl) : null
  const [g0, g1] = frameGradient(highlight.highlightId)

  React.useEffect(() => {
    if (!wiggle || t.prefs.reducedMotion) { cancelAnimation(tilt); tilt.value = 0; return undefined }
    tilt.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(tilt)
  }, [wiggle, t.prefs.reducedMotion, tilt])

  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${-1.2 + tilt.value * 2.4}deg` }] }))

  const initials = highlight.title.trim().slice(0, 2).toUpperCase() || '··'

  return (
    <Touchable onPress={onPress} onLongPress={onLongPress} feedback="scale" noAutoHitSlop accessibilityLabel={highlight.title}>
      <Animated.View style={[{ width: size + 4, alignItems: 'center', gap: space.xs2 }, anim]}>
        <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, borderColor: ink.ghost }]}>
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={140}
              cachePolicy="memory-disk"
              recyclingKey={highlight.highlightId}
            />
          ) : (
            <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fillCenter}>
              <Text weight="700" color={ink.full} align="center" style={{ fontSize: size * 0.4 }}>{initials}</Text>
            </LinearGradient>
          )}
        </View>
        <Text variant="caption" color={ink.full} align="center" numberOfLines={2} style={{ width: size + 4 }}>
          {highlight.title}
        </Text>
      </Animated.View>
    </Touchable>
  )
}

/** The leading "New" affordance on your own rail. */
export function NewHighlightPill({ size = 64, onPress }: { size?: number; onPress: () => void }) {
  return (
    <Touchable onPress={onPress} feedback="scale" noAutoHitSlop accessibilityLabel="New highlight">
      <View style={{ width: size + 4, alignItems: 'center', gap: space.xs2 }}>
        <View
          style={[
            styles.circle,
            styles.fillCenter,
            { width: size, height: size, borderRadius: size / 2, borderStyle: 'dashed', borderColor: ink.ghost, position: 'relative' },
          ]}
        >
          <Icon name="add" size={Math.round(size * 0.36)} color={ink.full} />
        </View>
        <Text variant="caption" color={ink.muted} align="center" numberOfLines={1} style={{ width: size + 4 }}>New</Text>
      </View>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  circle: { overflow: 'hidden', borderWidth: 1.5 },
  fillCenter: { ...FILL, alignItems: 'center', justifyContent: 'center' },
})
