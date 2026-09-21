/* =========================================================
   StoryRing — an avatar wearing its state.

   Deliberately not `<Avatar ring="unseen">`: that ring paints
   its inner gap with the ACTIVE theme's background, which is
   correct on a feed and wrong on a screen that is black in
   both schemes. Everything else about it — the three gradient
   stops, the initials-on-a-hashed-colour fallback — is the
   same, and comes from the same tokens.

   It never computes its own state. `unseen` comes from
   isStoryUnseen / isMyStoryUnseen at the call site, because
   only the caller knows whether the ring means "you haven't
   watched this" or "nobody has watched this".

   Ring and ink colours default to the pinned night palette —
   right for the dark story hub, invisible (white-alpha on
   white) anywhere that wears the active theme. Surfaces like
   the feed rail pass the theme's own roles instead
   (storyRing / storyRingSeen — DESIGN.md §2), and passing
   `ringUnseenColor` swaps the gradient for the plain bordered
   ring DESIGN.md §5 specifies (SealRing: no SVG, list-safe).
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { Icon, Text, Touchable } from '@/ui'
import { CLOSE_GREEN, RING_STEEL, ink, night } from './night'

export type RingState = 'unseen' | 'seen' | 'own-empty' | 'close-friends' | 'none'

export interface StoryRingProps {
  uri?: string | null
  initials?: string
  /** The deterministic fallback colour adapters hands back as `avc`. */
  avc?: string | null
  size?: number
  state?: RingState
  /** The colour showing through the gap between ring and face. */
  gapColor?: string
  /** Ring colour for the 'seen' state. Defaults to night ink. */
  ringSeenColor?: string
  /** Dashed-circle colour for 'own-empty'. Defaults to night ink. */
  ringEmptyColor?: string
  /** When set, the 'unseen' ring is a plain border in this colour
   *  instead of the gradient — the DESIGN.md §5 treatment. */
  ringUnseenColor?: string
  /** Colour of the plus icon on 'own-empty'. Defaults to night ink. */
  inkColor?: string
  badge?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

export function StoryRing({
  uri, initials = '··', avc, size = 64, state = 'seen',
  gapColor = night.bg,
  ringSeenColor = ink.ghost, ringEmptyColor = ink.ghost, ringUnseenColor = RING_STEEL, inkColor = ink.full,
  badge, onPress, onLongPress, accessibilityLabel, style,
}: StoryRingProps) {
  const ringWidth = state === 'seen' ? 1.5 : 2.5
  const gap = state === 'none' ? 0 : 2
  const outer = state === 'none' ? size : size + (ringWidth + gap) * 2

  const face = (
    <View style={[styles.face, { width: size, height: size, borderRadius: size / 2, backgroundColor: avc || night.surfaceRaised }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={140}
          cachePolicy="memory-disk"
          recyclingKey={uri}
        />
      ) : (
        <Text
          weight="700"
          color={ink.full}
          align="center"
          style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}
        >
          {initials}
        </Text>
      )}
    </View>
  )

  let body: React.ReactNode
  if (state === 'own-empty') {
    body = (
      <View
        style={[
          styles.center,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: ringEmptyColor,
          },
        ]}
      >
        <Icon name="add" size={Math.round(size * 0.36)} color={inkColor} />
      </View>
    )
  } else if (state === 'unseen') {
    /* Always the plain bordered ring — the SealRing law (§5). The gradient
       fallback this branch once carried predated the law and let any call
       site that forgot the prop regress to three accents on one element. */
    body = (
      <View
        style={[
          styles.center,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: ringWidth,
            borderColor: ringUnseenColor,
            padding: gap,
          },
        ]}
      >
        {face}
      </View>
    )
  } else if (state === 'none') {
    body = face
  } else {
    body = (
      <View
        style={[
          styles.center,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: ringWidth,
            borderColor: state === 'close-friends' ? CLOSE_GREEN : ringSeenColor,
            padding: gap,
          },
        ]}
      >
        {face}
      </View>
    )
  }

  const wrapped = (
    <View style={[{ width: outer, height: outer }, styles.center, style]}>
      {body}
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </View>
  )

  if (!onPress && !onLongPress) return wrapped
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
    >
      {wrapped}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { position: 'absolute', end: -2, bottom: -2 },
})
