/* =========================================================
   StoryPoster — one frame as a 2:3 tile.

   Every grid in this domain (the hub's Recent, the manager,
   the highlight pickers) is the same cell with different
   corners bolted on, so the corners are children and the cell
   itself only knows how to paint a frame.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Text, Touchable } from '@/ui'
import { FILL, ink } from './night'
import { frameGradient, isTextFrame, posterOf } from './storyVisual'
import { space } from '@/theme/tokens'

export interface StoryPosterProps {
  story: { storyId: string; storyType?: string; textContent?: string | null; mediaUrl?: string | null; thumbnailUrl?: string | null }
  width: number
  /** 2:3 by default — the aspect every story grid uses. */
  ratio?: number
  selected?: boolean
  dimmed?: boolean
  children?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}

export function StoryPoster({
  story, width, ratio = 1.5, selected = false, dimmed = false,
  children, onPress, onLongPress, accessibilityLabel, style,
}: StoryPosterProps) {
  const height = width * ratio
  const uri = posterOf(story)
  const [g0, g1] = frameGradient(story.storyId)

  const body = (
    <View
      style={[
        styles.cell,
        {
          width,
          height,
          borderRadius: 14,
          borderColor: ink.hairline,
          opacity: dimmed ? 0.35 : selected ? 0.85 : 1,
          transform: selected ? [{ scale: 0.97 }] : undefined,
        },
        style,
      ]}
    >
      {uri && !isTextFrame(story) ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={story.storyId}
        />
      ) : (
        <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.textPlate}>
          <Text variant="caption" color={ink.full} align="center" numberOfLines={4}>
            {String(story.textContent || '').slice(0, 40)}
          </Text>
        </LinearGradient>
      )}
      {children}
    </View>
  )

  if (!onPress && !onLongPress) return body
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  cell: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  textPlate: { ...FILL, alignItems: 'center', justifyContent: 'center', padding: space.sm },
})
