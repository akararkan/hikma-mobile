/* =========================================================
   Everything that can hang off an answer's body: the single
   inline image or video, the link chips, the sources block and
   the attachments block.

   NOTE: the web measured this by decoding with `new Image()`,
   which does not exist on native. expo-image's
   onLoad hands back the decoded source's dimensions, so the
   ratio comes from there instead and the picture keeps its own
   shape rather than being cropped into a fixed strip.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image, type ImageLoadEventData } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useIsFocused } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { AttachmentRow, AttachmentTile, isVisual } from './AttachmentViews'
import { SourceRow } from './SourceRow'
import { hostOf, splitLinks, type AnswerView, type AttachmentView, type SourceView } from './types'

const DEFAULT_RATIO = 4 / 3

export function InlineMedia({
  answer, onPress,
}: { answer: AnswerView; onPress?: () => void }) {
  const t = useTheme()
  const [ratio, setRatio] = React.useState<number | null>(null)

  /* `ratio` is useState, and FlashList hands a recycled row's mounted instance
     to the NEXT answer — so without this the new photo would be laid out at
     the previous one's aspect ratio until onLoad fires. Reset in the render
     phase (an effect would paint one wrong frame first). */
  const [seenUrl, setSeenUrl] = React.useState(answer.mediaUrl)
  if (seenUrl !== answer.mediaUrl) { setSeenUrl(answer.mediaUrl); setRatio(null) }

  if (!answer.mediaUrl || !answer.mediaType) return null

  if (answer.mediaType === 'VIDEO') {
    /* Keyed on the url: a recycled row swapping video answers releases the
       old player under a still-mounted SurfaceVideoView otherwise ("Cannot
       use shared object that was already released") — the key replaces view
       and player atomically, same as PostMedia's ActiveVideo. It is also what
       resets the tapped-to-play state, so a recycled row never inherits the
       previous answer's activation. */
    return <InlineVideo key={answer.mediaUrl} url={answer.mediaUrl} poster={answer.mediaThumbnailUrl} onPress={onPress} />
  }

  const onLoad = (e: ImageLoadEventData) => {
    const w = e?.source?.width, h = e?.source?.height
    if (w && h) setRatio(w / h)
  }

  return (
    <Touchable onPress={onPress} feedback="scale" noAutoHitSlop style={{ marginTop: space.md }} accessibilityLabel="Open image">
      <Image
        source={{ uri: answer.mediaUrl }}
        style={{
          width: '100%',
          /* Very tall photos are clamped: a 9:21 screenshot otherwise pushes
             every following answer off the screen. */
          aspectRatio: Math.max(0.6, ratio ?? DEFAULT_RATIO),
          borderRadius: t.radius.md,
          backgroundColor: t.colors.surfaceSunken,
        }}
        contentFit="cover"
        transition={160}
        cachePolicy="memory-disk"
        recyclingKey={answer.mediaUrl}
        onLoad={onLoad}
      />
    </Touchable>
  )
}

/* A question can carry several video answers, and all of them sit in the
   list's draw window at once. Every mounted player holds a hardware decoder
   and a phone caps those at a handful, so the decoder is bought on the tap,
   not on the scroll — PostMedia's ActiveVideo rule, applied to answers. Until
   then the row is the thumbnail the API already returned. */
function InlineVideo({ url, poster, onPress }: { url: string; poster: string | null; onPress?: () => void }) {
  const t = useTheme()
  const [active, setActive] = React.useState(false)

  /* A pushed route leaves the thread mounted under it, so blur — not unmount —
     is the navigation boundary. Retiring the leaf both silences the answer and
     releases its decoder (VoicePlayer's rule, PostMedia.tsx). */
  const focused = useIsFocused()
  React.useEffect(() => {
    if (!focused) setActive(false)
  }, [focused])
  return (
    /* surfaceInverse, not a black literal — the same letterbox token
       PostMedia's video container uses. The 16:9 box lives on the container
       so the poster and the video occupy exactly the same frame and the tap
       does not resize the row. */
    <View
      style={{
        marginTop: space.md,
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.colors.surfaceInverse,
      }}
    >
      {active ? (
        <ActiveInlineVideo url={url} />
      ) : (
        <Touchable
          onPress={() => setActive(true)}
          feedback="none"
          noAutoHitSlop
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Play video answer"
        >
          {poster ? (
            /* contain, not cover: the player letterboxes, and a cropped
               poster would jump to a smaller frame on the first decode. */
            <Image
              source={{ uri: poster }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={120}
              cachePolicy="memory-disk"
              recyclingKey={poster}
            />
          ) : null}
          <View style={styles.playWrap} pointerEvents="none">
            <View style={[styles.playBadge, { backgroundColor: t.colors.overlayChip }]}>
              <Icon name="play" size={20} color={t.colors.overlayText} filled />
            </View>
          </View>
        </Touchable>
      )}
      {onPress ? (
        <Touchable
          onPress={onPress}
          feedback="dim"
          style={[styles.fullscreenBtn, { backgroundColor: t.colors.overlayChip }]}
          accessibilityLabel="Open video full screen"
        >
          <Icon name="external" size={14} color={t.colors.overlayText} />
        </Touchable>
      ) : null}
    </View>
  )
}

/* The decoder-holding leaf. Mounting IS the play tap, so it starts itself —
   otherwise the reader taps the badge and then has to find the native play
   button underneath it. */
function ActiveInlineVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, p => { p.loop = false })

  React.useEffect(() => {
    try { player.play() } catch { /* a recycled player can be released mid-effect */ }
  }, [player])

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
      accessibilityLabel="Video answer"
    />
  )
}

export function LinkChips({ links, onPress }: { links: string | null; onPress: (url: string) => void }) {
  const t = useTheme()
  const list = splitLinks(links)
  if (!list.length) return null
  return (
    <View style={[styles.wrap, { marginTop: space.sm2 }]}>
      {list.map(url => (
        <Touchable
          key={url}
          onPress={() => onPress(url)}
          feedback="scale"
          style={[styles.linkChip, { backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.borderFaint }]}
        >
          <Icon name="globe" size={12} color={t.colors.accent} />
          <Text variant="caption" tone="accent" numberOfLines={1}>{hostOf(url)}</Text>
        </Touchable>
      ))}
    </View>
  )
}

export function SourcesBlock({
  sources, onPress, expanded,
}: { sources: SourceView[]; onPress: (s: SourceView) => void; expanded?: boolean }) {
  const t = useTheme()
  const [open, setOpen] = React.useState(!!expanded)
  if (!sources.length) return null
  const shown = open ? sources : sources.slice(0, 2)

  return (
    <View style={[styles.block, { borderTopColor: t.colors.separator }]}>
      <View style={styles.blockHeader}>
        <Icon name="cite" size={13} color={t.colors.scholar} />
        <Text variant="micro" tone="scholar" align="ui">Sources · {sources.length}</Text>
      </View>
      {shown.map(s => (
        <SourceRow key={s.id} source={s} onPress={s.href ? () => onPress(s) : undefined} />
      ))}
      {sources.length > 2 && !open ? (
        <Touchable onPress={() => setOpen(true)} feedback="dim" style={{ paddingVertical: space.xs2 }}>
          <Text variant="footnote" tone="accent" align="ui">Show {sources.length - 2} more</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

export function AttachmentsBlock({
  attachments, onPress,
}: { attachments: AttachmentView[]; onPress: (a: AttachmentView) => void }) {
  const t = useTheme()
  if (!attachments.length) return null
  const visual = attachments.filter(isVisual)
  const files = attachments.filter(a => !isVisual(a))

  return (
    <View style={[styles.block, { borderTopColor: t.colors.separator }]}>
      <View style={styles.blockHeader}>
        <Icon name="attachment" size={13} color={t.colors.textMuted} />
        <Text variant="micro" tone="muted" align="ui">Files · {attachments.length}</Text>
      </View>

      {visual.length ? (
        <View style={[styles.wrap, { marginBottom: files.length ? 8 : 0 }]}>
          {visual.map(a => (
            <AttachmentTile key={a.id} attachment={a} onPress={() => onPress(a)} />
          ))}
        </View>
      ) : null}

      {files.map(a => (
        <View key={a.id} style={styles.flushRow}>
          <AttachmentRow attachment={a} onPress={() => onPress(a)} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  /* A text-bearing chip takes the chip setback — the only pills in QELAT are
     unread counters and LIVE badges (DESIGN.md §8.9). */
  linkChip: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    height: 28, paddingHorizontal: space.sm2, borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%',
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  block: { marginTop: space.md, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginBottom: space.xs },
  /* AttachmentRow pays its own screen padding; inside a card that would
     double the inset, so it is cancelled here. */
  flushRow: { marginHorizontal: -space.lg },
  /* Icon-only round button — a sanctioned circle; `end` so it mirrors. */
  fullscreenBtn: { position: 'absolute', top: 8, end: 8, padding: space.sm, borderRadius: 999 },
  /* Centring wrapper for the resting play badge. Spelled out — SDK 57 removed
     StyleSheet.absoluteFillObject. */
  playWrap: {
    position: 'absolute', top: 0, bottom: 0, start: 0, end: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  playBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
