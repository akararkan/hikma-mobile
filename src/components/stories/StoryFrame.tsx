/* =========================================================
   StoryFrame — one frame, painted by kind.

   The rule that breaks stories when it is broken lives here:
   caption text renders ONLY when `textContent && !mediaUrl`.
   A designed story already has its words baked into the
   pixels, and a second centred copy doubles them.

   The second rule: a VIDEO frame owns a hardware decoder, and
   the device has about three of them to share with the feed
   and reels. `paused` does not give one back — it only stops a
   player that is already built. `active={false}` and `still`
   do, by never building it. Anything that puts more than one
   frame in the tree at a time must say so.
   ========================================================= */
import { RemoteImage } from '@/components/media/RemoteImage'
import { isHlsUrl } from '@/lib/videoSource'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Spinner, Text } from '@/ui'
import { useEvent } from 'expo'
import { LinearGradient } from 'expo-linear-gradient'
import { VideoView, useVideoPlayer } from 'expo-video'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BLACK, ink, shade } from './night'
import {
    autoTextSize, clampVideoMs, frameGradient, isLinkFrame, isTextFrame, isVideoFrame,
    linkLabel, mediaOf, posterOf, showCaption, type StoryRow,
} from './storyVisual'

export interface StoryFrameProps {
  story: StoryRow | null
  muted?: boolean
  paused?: boolean
  /** The frame the reader is actually on. A WARM NEIGHBOUR passes false and
   *  gets the poster instead of a frozen player — see the header. Defaults to
   *  true so a lone full-screen frame needs no ceremony. */
  active?: boolean
  /** Poster-only, permanently: a grid cell, a tray preview, anything that can
   *  have several of itself on screen. Same short-circuit as `active={false}`,
   *  said as an intention rather than as a transient state. */
  still?: boolean
  /** Video only: the real clip length, once the player knows it. */
  onDuration?: (ms: number) => void
  /** Video only: native playback reached the end of the source. */
  onPlaybackEnd?: () => void
  onError?: (e: any) => void
}

export function StoryFrame({
  story, muted = false, paused = false, active = true, still = false, onDuration, onPlaybackEnd, onError,
}: StoryFrameProps) {
  if (!story) return <View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }]} />

  if (isVideoFrame(story)) {
    /* No player at all, not a paused one. `paused` keeps the decoder; this
       gives it back. */
    if (still || !active) {
      return (
        <PosterFrame
          key={story.storyId}
          poster={posterOf(story)}
          caption={showCaption(story) ? story.textContent : null}
          recyclingKey={story.storyId}
        />
      )
    }
    return (
      <VideoFrame
        key={story.storyId}
        uri={mediaOf(story)}
        poster={posterOf(story)}
        caption={showCaption(story) ? story.textContent : null}
        muted={muted}
        paused={paused}
        onDuration={onDuration}
        onPlaybackEnd={onPlaybackEnd}
        onError={onError}
      />
    )
  }

  if (isTextFrame(story) || (!story.mediaUrl && !story.thumbnailUrl)) return <TextFrame story={story} />

  return <ImageFrame story={story} />
}

/* ---------------------------------------------------------
   Stills. The copy is contain-fit so a portrait photo is never
   cropped, and it letterboxes on BLACK — the one sanctioned
   place for a flat black plate (DESIGN.md §6, Screen). This
   used to be a cover-fit copy under a blur; QELAT has no blur,
   and the second full-size decode per frame was the story
   viewer's most expensive pixel.
   --------------------------------------------------------- */

function ImageFrame({ story }: { story: StoryRow }) {
  const uri = mediaOf(story) || posterOf(story)
  const poster = posterOf(story)
  const linked = isLinkFrame(story)
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }]}>
      {uri ? (
        /* A moderator rejecting a review-band story deletes the asset while
           the row lives on — the frame must say so quietly, not hold a black
           screen (image-moderation-frontend.md). */
        <RemoteImage
          source={uri}
          fallback="overlay"
          fallbackIcon="image"
          fallbackIconSize={32}
          fallbackLabel="Image unavailable"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={150}
          cachePolicy="memory-disk"
          recyclingKey={story.storyId}
          /* The tray tile the reader just tapped cached this thumbnail —
             paint it under the full-res fetch instead of a black beat (which
             was the first frame of every story open). */
          placeholder={poster && poster !== uri ? { uri: poster } : undefined}
          placeholderContentFit="contain"
        />
      ) : null}
      {linked ? <LinkCard story={story} /> : null}
      {/* The caption bar — the frame's own words over the picture. A LINKED
          frame's card already prints them, so it is excluded to avoid the
          double. */}
      {!linked && showCaption(story) ? <Caption text={story.textContent!} /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Text. The gradient is hashed from the storyId: the create
   contract has no background field, so an author-chosen colour
   could not be persisted and every viewer must derive the same
   one instead.
   --------------------------------------------------------- */

function TextFrame({ story }: { story: StoryRow }) {
  const [g0, g1] = frameGradient(story.storyId)
  const size = autoTextSize(story.textContent)
  return (
    <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.center]}>
      <Text
        weight="700"
        color={ink.full}
        align="center"
        numberOfLines={10}
        style={{ fontSize: size, lineHeight: size * 1.25, paddingHorizontal: space.xxxl }}
      >
        {story.textContent || ''}
      </Text>
      {isLinkFrame(story) ? <LinkCard story={story} /> : null}
    </LinearGradient>
  )
}

/* ---------------------------------------------------------
   A video frame with the video taken out: what `still` and an
   inactive page render. The poster is already on disk (the
   composer cuts one for every clip it uploads), so this paints
   on the first render where a player would still be buffering.

   Sibling, not a duplicate: HighlightTile is the GRID's answer
   to the same problem and stays its own component — it crops
   to fill a 3-column cell, truncates to a thumbnail's worth of
   words and draws a corner glyph. This one letterboxes a
   full-screen frame and keeps the caption bar. They look alike
   in a diff and share no measurement.
   --------------------------------------------------------- */

function PosterFrame({
  poster, caption, recyclingKey,
}: {
  poster: string | null
  caption?: string | null
  recyclingKey?: string
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }]}>
      {poster ? (
        /* A dead poster degrades to the posterless render — black plate and
           the play badge. */
        <RemoteImage
          source={poster}
          fallback="hidden"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={0}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
        />
      ) : null}
      {/* The one thing a still loses: that this frame moves. A glyph says it
          without a decoder. */}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <View style={[styles.playBadge, { backgroundColor: shade.chip }]}>
          <Icon name="play" size={20} color={ink.full} filled />
        </View>
      </View>
      {caption ? <Caption text={caption} /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Video.
   --------------------------------------------------------- */

function VideoFrame({
  uri, poster, caption, muted, paused, onDuration, onPlaybackEnd, onError,
}: {
  uri: string | null
  poster: string | null
  caption?: string | null
  muted: boolean
  paused: boolean
  onDuration?: (ms: number) => void
  onPlaybackEnd?: () => void
  onError?: (e: any) => void
}) {
  /* Progressive files opt into the OS cache — stepping back a frame or
     replaying a story then plays from disk instead of re-downloading the
     whole clip (the reels pool's rule). HLS stays uncached; the player
     manages those segments itself — and now that `mediaOf` prefers the
     variants' HLS master, the exclusion is spelled out rather than left to
     the extension allowlist alone. */
  const cacheable = !!uri && !isHlsUrl(uri) && /\.(mp4|m4v|mov|webm)(\?|$)/i.test(uri)
  const player = useVideoPlayer(uri ? { uri, useCaching: cacheable } : null, p => {
    p.loop = false
    p.muted = muted
    p.timeUpdateEventInterval = 0.1
  })

  const event = useEvent(player, 'statusChange', { status: player.status })
  const status = event?.status ?? player.status
  const error = event?.error

  /* try/caught: on a frame advance useVideoPlayer releases the outgoing
     player, and an effect landing in that window throws "already released". */
  React.useEffect(() => {
    try { player.muted = muted } catch { /* released mid-swap */ }
  }, [muted, player])

  React.useEffect(() => {
    try {
      if (paused) player.pause()
      else player.play()
    } catch { /* released mid-swap */ }
  }, [paused, player])

  /* The bar cannot be armed until the clip's length is known, so the owner
     starts on a default and re-arms here. */
  React.useEffect(() => {
    if (status !== 'readyToPlay') return
    onDuration?.(clampVideoMs(player.duration))
  }, [status, player, onDuration])

  /* A story's timer is still the fallback for media that never reports a
     duration, but a native end signal is the clock for an actual video. It
     keeps a multi-frame story moving even when a duration correction lands
     late or the JS thread is busy decoding the final frames. */
  React.useEffect(() => {
    if (!onPlaybackEnd) return
    const sub = player.addListener('playToEnd', onPlaybackEnd)
    return () => sub.remove()
  }, [player, onPlaybackEnd])

  React.useEffect(() => { if (error) onError?.(error) }, [error, onError])

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }]}>
      {poster ? (
        <RemoteImage source={poster} fallback="hidden" style={StyleSheet.absoluteFill} contentFit="contain" transition={0} cachePolicy="memory-disk" />
      ) : null}
      {/* Keyed on the source: a frame advance releases the old player while
          this native view is still mounted — re-propping it with the released
          object is the "already released" crash. The key swaps view and
          player as one unit. */}
      <VideoView
        key={uri ?? 'empty'}
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      {status !== 'readyToPlay' ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {error ? (
            <Text variant="footnote" color={ink.muted} align="center">Can’t load video</Text>
          ) : (
            /* Night plate: `accent` would be a smudge on BLACK, so the arc
               rides the frame's own ink (State.tsx documents the exception). */
            <Spinner size="large" color={ink.full} />
          )}
        </View>
      ) : null}
      {caption ? <Caption text={caption} /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Trimmings
   --------------------------------------------------------- */

function Caption({ text }: { text: string }) {
  /* Anchored ABOVE the reply bar, from the live inset — a fixed offset put
     the caption under the composer on gesture-nav phones (the safe-area bug
     this line exists to keep fixed). */
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.caption, { bottom: insets.bottom + 108 }]} pointerEvents="none">
      <View style={[styles.captionBox, { backgroundColor: shade.chip }]}>
        <Text variant="callout" color={ink.full} numberOfLines={4}>{text}</Text>
      </View>
    </View>
  )
}

/** The card under a shared post / reel / question / paper.
 *
 *  NOTE: the story row carries no target id — only mediaUrl, thumbnailUrl and
 *  textContent — so there is nothing to route to. The card names what was
 *  shared rather than pretending to be a link that goes nowhere. */
function LinkCard({ story }: { story: StoryRow }) {
  const thumb = posterOf(story)
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.linkWrap, { bottom: insets.bottom + 108 }]} pointerEvents="none">
      <View style={[styles.linkCard, { backgroundColor: shade.heavy }]}>
        <View style={[styles.linkThumb, { backgroundColor: ink.fill }]}>
          {thumb ? (
            /* A dead thumb falls back to the same link glyph a missing one
               gets. */
            <RemoteImage
              source={thumb}
              fallback="overlay"
              fallbackIcon="link"
              fallbackIconSize={18}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Icon name="link" size={18} color={ink.muted} />
          )}
        </View>
        <View style={styles.linkText}>
          <Text variant="footnote" color={ink.muted} numberOfLines={1}>{linkLabel(story)}</Text>
          <Text variant="bodyStrong" color={ink.full} numberOfLines={1}>
            {story.textContent || 'Shared to a story'}
          </Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  /* Round because it is an icon-only glyph plate, not a chip — DESIGN.md §3
     sanctions the circle for exactly that. */
  playBadge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  /* `bottom` comes from the live inset at the call sites. */
  caption: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.lg },
  captionBox: { ...setback(shape.card), borderCurve: 'continuous', paddingHorizontal: space.md2, paddingVertical: space.sm2 },
  linkWrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.lg },
  linkCard: {
    height: 64,
    ...setback(shape.card),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    padding: space.md,
  },
  linkThumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, gap: space.xxs },
})
