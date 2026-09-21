/* =========================================================
   HighlightTile — a snapshot as a grid thumbnail.

   Deliberately NOT StoryFrame. StoryFrame sends a VIDEO frame
   to a real `useVideoPlayer` + `<VideoView>`, and `paused` only
   pauses the player it already built. A 3-column grid puts nine
   to fifteen of those on screen at once and recycles them
   through every fling — past the device's MediaCodec decoder
   pool, which is shared with the feed and reels, so the surplus
   tiles never leave their spinner and video elsewhere in the
   app stops starting. A thumbnail is a poster and a play glyph;
   the player mounts on activation, not on row mount
   (DESIGN.md §9).

   StoryFrame now has `still`, which fixes the decoder half of
   that on its side — and this file stays anyway, because the
   decoder was only half the reason. A tile CROPS to fill its
   cell, truncates to sixty characters and parks a 24pt glyph
   in the corner; a still StoryFrame letterboxes a full-screen
   frame, prints a TEXT frame at 34pt and keeps the caption bar.
   Reach for `still` when the thing is frame-shaped and for this
   when it is cell-shaped.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Icon, Text } from '@/ui'
import { ink, shade } from './night'
import { frameGradient, isTextFrame, isVideoFrame, posterOf, type StoryRow } from './storyVisual'
import { space } from '@/theme/tokens'

export function HighlightTile({ story }: { story: StoryRow }) {
  const uri = posterOf(story)
  const [g0, g1] = frameGradient(story.storyId)

  /* No poster is the CDN having dropped the snapshot's media — the frame's own
     words on its own derived gradient is the honest stand-in, and it is what
     every other story grid draws for a TEXT frame anyway. */
  if (!uri || isTextFrame(story)) {
    return (
      <LinearGradient
        colors={[g0, g1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.center]}
      >
        <Text variant="caption" color={ink.full} align="center" numberOfLines={5}>
          {String(story.textContent || '').slice(0, 60)}
        </Text>
      </LinearGradient>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={story.storyId}
      />
      {/* The one thing a still loses against a mounted player: that this frame
          moves. A glyph says it without a decoder. */}
      {isVideoFrame(story) ? (
        <View style={[styles.play, { backgroundColor: shade.chip }]} pointerEvents="none">
          <Icon name="play" size={13} color={ink.full} filled />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.sm2 },
  play: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
