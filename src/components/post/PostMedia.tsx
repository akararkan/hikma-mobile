/* =========================================================
   PostMedia — one renderer for the three things a post's media
   slot can be.

   IMAGE   expo-image, sized from the picture's own proportions
           so a portrait photo is not letterboxed into a strip.
   VIDEO   expo-video behind the poster, muted + looping. The
           PLAYER only exists while the card is the most-visible
           row (`autoplay`): every mounted player holds a
           hardware decoder, the list's draw window keeps
           several video cards mounted at once, and a phone caps
           decoders at a handful — past the cap playback fails
           silently on the oldest. Same rule the reels pool
           enforces (useReelPlayerPool). Everything else shows
           its poster.
   VOICE   expo-audio behind a compact transport. VOICE_POST
           puts the playable audio in `audioUrl`, not `media`.

   The player hooks live in the leaf components, so a text-only
   card never constructs one.
   ========================================================= */
import { api } from '@/api'
import { ratioOf, type FeedMedia } from '@/components/feed/types'
import { RemoteImage } from '@/components/media/RemoteImage'
import { VoiceTransport } from '@/components/media/VoiceTransport'
import { mayAutoPlayVideos } from '@/lib/mediaPrefs'
import { bestPlayableUrl } from '@/lib/videoSource'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, toast } from '@/ui'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useIsFocused } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { VideoView, useVideoPlayer } from 'expo-video'
import React from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'

/* The band a feed picture is allowed to occupy. Outside it a photo is
   cropped rather than allowed to push the next card off the screen. */
const MIN_RATIO = 4 / 5
const MAX_RATIO = 16 / 9

/* FeedCard media recipe (DESIGN.md §6): in-card media is the sanctioned
   uniform-radius exception — 8 on all four corners, no setback. It
   letterboxes on true black, never a clay ground — clay casts photos. */
const MEDIA_RADIUS = 8
const LETTERBOX = '#000'

export interface PostMediaProps {
  media?: FeedMedia[] | null
  /** TEXT | EMBEDDED | REEL | VOICE_POST — drives the reel chrome. */
  postType?: string
  /** VOICE_POST's playable audio; the adapter puts it outside `media`. */
  audioUrl?: string | null
  /** The owning post — lets a voice row whose feed shape carried no audio
   *  resolve it from GET /posts/{id} on the first tap. */
  postId?: string
  /** A reel's sticker layer, drawn over the video at full size. */
  overlayUrl?: string | null
  /** Attached Sound (§19) — a marquee-ish label under the media. */
  soundName?: string
  /** True only for the single most-visible card in the list. */
  autoplay?: boolean
  muted?: boolean
  onToggleMute?: () => void
  onPress?: () => void
  onLongPress?: () => void
  /** Cap the media height as a fraction of the window. */
  maxHeightRatio?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

export function PostMedia({
  media, postType, audioUrl, postId, overlayUrl, soundName,
  autoplay = false, muted = true, onToggleMute, onPress, onLongPress,
  maxHeightRatio = 0.6, radius, style,
}: PostMediaProps) {
  if (postType === 'VOICE_POST') {
    /* With or without a url: a feed row can arrive with the audio missing
       (the hydrator omits it), and the transport then resolves the detail on
       the first tap — the web player's resolveSrc, ported. A dead card that
       renders only the caption is the failure this branch exists to prevent. */
    return <VoicePlayer url={audioUrl ?? null} postId={postId} style={style} />
  }
  /* Generic file attachments (the backend types them OTHER — POST_MEDIA
     accepts any non-executable file now) render as tappable rows under the
     visual media, never as broken picture tiles. */
  const docs = (media || []).filter(m => m.type === 'OTHER' && m.url)
  const visuals = (media || []).filter(m => m.type !== 'OTHER')
  const url = visuals[0]?.url
  if (!url && !docs.length) return null

  const r = radius ?? MEDIA_RADIUS
  const isReel = postType === 'REEL'

  if (!url) {
    return (
      <View style={style}>
        {docs.map((d, i) => <PostFileRow key={i} url={d.url!} />)}
        {soundName ? <SoundLine name={soundName} /> : null}
      </View>
    )
  }

  /* Multi-image posts page IN the card — the full album used to be invisible
     until the detail screen (only media[0] rendered, no hint more existed). */
  if (!isReel && visuals.length > 1) {
    return (
      <View style={style}>
        <FeedMediaCarousel
          media={visuals}
          carouselKey={String(postId ?? url)}
          maxHeightRatio={maxHeightRatio}
          onPress={onPress}
          onLongPress={onLongPress}
          radius={r}
        />
        {docs.map((d, i) => <PostFileRow key={i} url={d.url!} />)}
        {soundName ? <SoundLine name={soundName} /> : null}
      </View>
    )
  }

  const lead = visuals[0]!
  const inner =
    lead.type === 'VIDEO' ? (
      <VideoMedia
        /* HLS-first: the adaptive master from `variants` when the pipeline made
           one, else the progressive url as before. VideoMedia keys its player
           on this prop, so the recycle key follows whatever url is PLAYED. */
        url={bestPlayableUrl(lead) || url}
        poster={lead.poster ?? null}
        blurhash={lead.blurhash ?? null}
        overlayUrl={overlayUrl}
        isReel={isReel}
        autoplay={autoplay}
        muted={muted}
        onToggleMute={onToggleMute}
        maxHeightRatio={maxHeightRatio}
        radius={r}
      />
    ) : (
      <ImageMedia url={url} blurhash={lead.blurhash ?? null} ratioHint={lead.ratio} radius={r} maxHeightRatio={maxHeightRatio} />
    )

  return (
    <View style={style}>
      {/* `alt` IS the accessibility label (feed/types.ts) — without it every
          media card in every feed is announced as an unnamed button, and the
          alt text the author typed is fetched and then thrown away. */}
      <Touchable
        onPress={onPress}
        onLongPress={onLongPress}
        feedback="none"
        noAutoHitSlop
        disabled={!onPress && !onLongPress}
        accessibilityLabel={lead.alt || (lead.type === 'VIDEO' ? 'Video' : 'Photo')}
        accessibilityHint={onPress ? 'Opens the media viewer' : undefined}
      >
        {inner}
      </Touchable>
      {docs.map((d, i) => <PostFileRow key={i} url={d.url!} />)}
      {soundName ? <SoundLine name={soundName} /> : null}
    </View>
  )
}

/* A generic file attachment row: attachment glyph + decoded storage basename
   + extension chip. Tapping opens the proxy URL in the system browser, where
   PDFs preview inline and everything else downloads. Posts persist only
   mediaUrls, so the basename is the best display name available. */
function PostFileRow({ url }: { url: string }) {
  const t = useTheme()
  const c = t.colors
  let name = 'Attachment'
  try {
    const seg = url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || ''
    name = decodeURIComponent(seg) || 'Attachment'
  } catch { /* keep the fallback */ }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : 'FILE'
  return (
    <Touchable
      onPress={() => { WebBrowser.openBrowserAsync(url).catch(() => toast.warn('Could not open this file')) }}
      feedback="dim"
      accessibilityLabel={`Open attachment ${name}`}
      style={[styles.fileRow, { borderColor: c.separator, borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}
    >
      <Icon name="attachment" size={18} color={c.textMuted} />
      <Text variant="footnote" caps={false} numberOfLines={1} style={styles.fileName}>{name}</Text>
      <Text variant="micro" color={c.textMuted}>{ext}</Text>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   The in-card album pager. Discipline for a recycled row:
   · ONE fixed 4:5 box — mixed ratios must not change the cell
     height mid-swipe, or FlashList re-measures and the feed
     jumps under the finger;
   · ±1 decode window — an eight-photo album must not pay
     eight decodes for one visible page;
   · page state is keyed to the POST, so a recycled cell never
     opens on the previous album's page (and the pager is
     scrolled home imperatively — no wrong first frame).
   Videos page as posters; the detail carousel owns playback.
   --------------------------------------------------------- */
function FeedMediaCarousel({
  media, carouselKey, maxHeightRatio, onPress, onLongPress, radius,
}: {
  media: any[]
  carouselKey: string
  maxHeightRatio: number
  onPress?: () => void
  onLongPress?: () => void
  radius: number
}) {
  const t = useTheme()
  const c = t.colors
  const winH = useWindowDimensions().height
  const scroller = React.useRef<ScrollView>(null)
  const [w, setW] = React.useState(0)

  const [pageState, setPageState] = React.useState({ key: carouselKey, page: 0 })
  if (pageState.key !== carouselKey) setPageState({ key: carouselKey, page: 0 })
  const page = pageState.page

  React.useEffect(() => {
    /* The derived reset above changed the STATE; the native scroller still
       sits wherever the previous album left it. */
    scroller.current?.scrollTo({ x: 0, animated: false })
  }, [carouselKey])

  const h = w ? Math.min(Math.round(w * (5 / 4)), Math.round(winH * maxHeightRatio)) : 0

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => {
            const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, w))
            setPageState(s => (s.page === next ? s : { ...s, page: next }))
          }}
        >
          {media.map((m: any, i: number) => (
            <Touchable
              key={`${m.url}:${i}`}
              onPress={onPress}
              onLongPress={onLongPress}
              feedback="none"
              noAutoHitSlop
              disabled={!onPress && !onLongPress}
              accessibilityLabel={m.alt || `${m.type === 'VIDEO' ? 'Video' : 'Photo'} ${i + 1} of ${media.length}`}
              accessibilityHint={onPress ? 'Opens the post' : undefined}
              style={{ width: w, height: h, backgroundColor: LETTERBOX, borderRadius: radius, overflow: 'hidden' }}
            >
              {Math.abs(i - page) <= 1 ? (
                /* Moderation can delete an asset after publish — the overlay
                   glyph on the letterbox ground beats a blurhash that never
                   resolves (image-moderation-frontend.md). */
                <RemoteImage
                  source={m.type === 'VIDEO' ? (m.poster || m.url) : m.url}
                  fallback="overlay"
                  placeholder={m.blurhash ? { blurhash: m.blurhash } : undefined}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={`${carouselKey}:${i}`}
                />
              ) : null}
              {m.type === 'VIDEO' ? (
                <View style={styles.carouselPlayWrap} pointerEvents="none">
                  <View style={[styles.carouselPlay, { backgroundColor: c.overlayChip }]}>
                    <Icon name="play" size={20} color={c.overlayText} filled />
                  </View>
                </View>
              ) : null}
            </Touchable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.carouselDots} accessible accessibilityLabel={`Page ${page + 1} of ${media.length}`}>
        {media.map((_: any, i: number) => (
          <View
            key={i}
            style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: i === page ? c.accent : c.borderStrong,
            }}
          />
        ))}
      </View>
    </View>
  )
}

/* The attributed sound under a post that carries one. A caption line, not a
   control: tapping a sound belongs to the reels surface, where a sound has a
   page to open. */
function SoundLine({ name }: { name: string }) {
  const t = useTheme()
  return (
    <View style={[styles.soundRow, { paddingHorizontal: t.layout.screenPadding }]}>
      <Icon name="music" size={14} color={t.colors.textMuted} />
      <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>{name}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Image.
   --------------------------------------------------------- */

function ImageMedia({
  url, blurhash, ratioHint, radius, maxHeightRatio,
}: { url: string; blurhash?: string | null; ratioHint?: string; radius: number; maxHeightRatio: number }) {
  const { height: winH } = useWindowDimensions()
  /* The wire hint is a web '16/10' string and is often just the adapter's
     default, so the decoded size wins the moment it arrives. The decoded
     ratio is keyed to the url it came from: FlashList recycles these
     instances, and a recycled row must fall back to its OWN hint immediately
     instead of framing the new photo in the previous item's proportions
     until onLoad lands. */
  const [decoded, setDecoded] = React.useState<{ url: string; natural: number | null }>({ url, natural: null })
  /* Render-phase reset on source change — React's derived-state idiom. */
  if (decoded.url !== url) setDecoded({ url, natural: null })
  const ratio = clamp((decoded.url === url ? decoded.natural : null) ?? ratioOf(ratioHint, 16 / 10))

  return (
    <View
      style={{
        width: '100%',
        aspectRatio: ratio,
        maxHeight: winH * maxHeightRatio,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: LETTERBOX,
      }}
    >
      <RemoteImage
        source={url}
        /* Paint-before-bytes: the pipeline's BlurHash, when the row carries
           one. Legacy media has none and keeps today's blank-then-fade.
           On a dead URL (moderation deleted the asset) RemoteImage drops the
           blurhash for the overlay glyph — otherwise the frame looks like it
           is loading forever. */
        placeholder={blurhash ? { blurhash } : undefined}
        fallback="overlay"
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={url}
        onLoad={e => {
          const { width, height } = e.source ?? {}
          /* Guarded by url: a late onLoad from a recycled-away source must not
             stamp its ratio onto the row's new image. */
          if (width && height) setDecoded(prev => (prev.url === url ? { url, natural: width / height } : prev))
        }}
      />
    </View>
  )
}

function clamp(r: number) {
  if (!Number.isFinite(r) || r <= 0) return 16 / 10
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))
}

/* ---------------------------------------------------------
   Video / reel.
   --------------------------------------------------------- */

function VideoMedia({
  url, poster, blurhash, overlayUrl, isReel, autoplay, muted, onToggleMute, maxHeightRatio, radius,
}: {
  url: string
  poster: string | null
  blurhash?: string | null
  overlayUrl?: string | null
  isReel: boolean
  autoplay: boolean
  muted: boolean
  onToggleMute?: () => void
  maxHeightRatio: number
  radius: number
}) {
  const t = useTheme()
  const c = t.colors
  const { height: winH } = useWindowDimensions()

  /* The poster stays underneath: expo-video paints nothing until the first
     frame decodes, and a black hole in a feed reads as broken. It is also the
     WHOLE frame for a non-active row — see ActiveVideo. recyclingKey, like
     ImageMedia's: without it expo-video's poster keeps painting the PREVIOUS
     row's decoded bitmap after a recycle, so video posts ghost. */
  const frame = (
    <>
      {poster ? (
        /* A dead poster degrades to the posterless case — black frame plus
           the play chrome — rather than a stuck blurhash. */
        <RemoteImage
          source={poster}
          fallback="hidden"
          placeholder={blurhash ? { blurhash } : undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
          recyclingKey={poster}
        />
      ) : null}

      {/* Keyed on the source: when a recycled row swaps urls, useVideoPlayer
          RELEASES the old player while the native view is still mounted, and
          re-propping that view with the released object is the
          "Cannot set prop 'player' … already released" crash. The key makes
          React replace view and player together, atomically. */}
      {/* The row's own "is this the active card" decision is necessary but not
          sufficient — a reader who set auto-download to Never, or to wi-fi
          only while on mobile data, gets the poster and a play button rather
          than a clip that started itself. Tapping still plays it. */}
      {autoplay && mayAutoPlayVideos() ? <ActiveVideo key={url} url={url} muted={muted} /> : null}

      {overlayUrl ? (
        /* Decorative layer — absence IS the quiet dead-media state. */
        <RemoteImage
          source={overlayUrl}
          fallback="hidden"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          pointerEvents="none"
          /* The biggest bitmap in the card — a full-frame transparent PNG.
             expo-image defaults to disk-only, which re-decodes it on every
             recycle as the reader scrolls past reel posts. */
          cachePolicy="memory-disk"
          recyclingKey={overlayUrl}
        />
      ) : null}
    </>
  )

  const chrome = (
    <>
      {/* A row that is not the feed's active video is a still poster — the
          badge says "this plays" without it, a reel reads as a photo. */}
      {!autoplay ? (
        <View style={styles.playWrap} pointerEvents="none">
          <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
            <Icon name="play" size={22} color={c.overlayText} filled />
          </View>
        </View>
      ) : null}

      {isReel ? (
        <View style={[styles.chip, { top: 10, start: 10, backgroundColor: c.overlayChip }]}>
          <Icon name="reels" size={12} color={c.overlayText} filled />
          <Text variant="micro" color={c.overlayText}>REEL</Text>
        </View>
      ) : null}

      {onToggleMute ? (
        <Touchable
          onPress={onToggleMute}
          feedback="scale"
          accessibilityLabel={muted ? 'Unmute' : 'Mute'}
          style={[styles.speaker, { backgroundColor: c.overlayChip }]}
        >
          <Icon name={muted ? 'mute' : 'volume'} size={16} color={c.overlayText} />
        </Touchable>
      ) : null}
    </>
  )

  if (isReel) {
    /* A reel is portrait 9:16 while the card is landscape-ish, so `width:100%
       + aspectRatio + maxHeight` cannot work: when the height cap binds, Yoga
       re-derives the width from the ratio and the shrunken video parks at the
       start edge — the off-centre reel the card used to show. Instead the
       CARD gets a full-width letterbox plate (media letterboxes on #000,
       DESIGN.md §6) and the 9:16 frame centres inside it; the chrome pins to
       the plate's corners, not the video's. */
    return (
      <View
        style={{
          width: '100%',
          height: winH * maxHeightRatio,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: LETTERBOX,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ height: '100%', aspectRatio: 9 / 16 }}>{frame}</View>
        {chrome}
      </View>
    )
  }

  return (
    <View
      style={{
        width: '100%',
        aspectRatio: 16 / 9,
        maxHeight: winH * maxHeightRatio,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: LETTERBOX,
      }}
    >
      {frame}
      {chrome}
    </View>
  )
}

/* The decoder-holding leaf, mounted ONLY while its row is the feed's single
   active video. `autoplay` therefore gates the player's existence, not just
   play(): unmounting releases the decoder, and the poster underneath keeps
   the frame painted so the swap is invisible. Losing the paused position on
   deactivation is the accepted cost — these are muted loops. */
function ActiveVideo({ url, muted }: { url: string; muted: boolean }) {
  const player = useVideoPlayer(url, p => {
    p.loop = true
    p.muted = true
  })

  /* Two separate effects: the mute flag changes far more often than the
     mount, and re-running play() on a mute tap restarts the clip. */
  React.useEffect(() => {
    try { player.play() } catch { /* a recycled player can be released mid-effect */ }
  }, [player])

  React.useEffect(() => {
    try { player.muted = muted } catch { /* released */ }
  }, [muted, player])

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  )
}

/* ---------------------------------------------------------
   Voice post — the web's .vnp card, ported: a dark navy
   gradient plate, the cerulean play disc carrying navy ink
   (the ox.ac.uk on-dark pattern), and a Sky waveform whose
   played bars light up as the note advances.
   --------------------------------------------------------- */


/* Like ActiveVideo, the audio player's existence is gated on demand: every
   voice row the list draws would otherwise allocate a native player just by
   scrolling past. Until the first tap this is a dead transport painted at
   rest; the tap mounts ActiveVoice, which owns the hooks and starts playing.
   A row with NO url resolves one from the detail read on that first tap —
   the web player's resolveSrc, ported. */
export function VoicePlayer({ url, postId, style }: { url: string | null; postId?: string; style?: StyleProp<ViewStyle> }) {
  const focused = useIsFocused()
  const focusedRef = React.useRef(focused)
  focusedRef.current = focused
  /* Derived-state reset: a recycled cell hands this component a NEW url (or
     post) with the old state still mounted, and an activation that survived
     recycling would auto-play a row the user never tapped. Keyed on BOTH:
     two urlless voice rows differ only by postId. */
  const key = url ?? postId ?? ''
  const [state, setState] = React.useState({ key, active: false, lazy: null as string | null, busy: false })
  if (state.key !== key) setState({ key, active: false, lazy: null, busy: false })

  const playable = url || state.lazy

  /* A pushed route remains mounted under its successor, so unmount alone is
     not a navigation boundary. Retiring the active leaf on blur pauses and
     releases its native player instead of letting a voice post continue off
     screen. */
  React.useEffect(() => {
    if (!focused) setState(s => (s.active ? { ...s, active: false } : s))
  }, [focused])

  const onToggle = () => {
    if (!focused) return
    if (playable) { setState(s => ({ ...s, active: true })); return }
    if (!postId || state.busy) return
    setState(s => ({ ...s, busy: true }))
    api.posts.get(postId)
      .then((full: any) => {
        const resolved = full?.audioUrl || null
        setState(s => (s.key === key
          ? { ...s, lazy: resolved, active: !!resolved && focusedRef.current, busy: false }
          : s))
        if (!resolved) toast.warn('This voice post has no audio yet.')
      })
      .catch(() => {
        /* A blip stays retryable — the next tap runs the resolve again. */
        setState(s => (s.key === key ? { ...s, busy: false } : s))
      })
  }

  if (state.active && playable) return <ActiveVoice url={playable} focused={focused} style={style} />
  return (
    <VoiceTransport
      seed={playable || key || 'voice'}
      playing={false}
      position={0}
      duration={0}
      busy={state.busy}
      onToggle={onToggle}
      style={style}
    />
  )
}

function ActiveVoice({ url, focused, style }: { url: string; focused: boolean; style?: StyleProp<ViewStyle> }) {
  /* 250ms ticks (default 500): the trace glides between them on the UI
     thread, and these are the drift corrections — at 4Hz a correction lands
     before it can grow visible. */
  const player = useAudioPlayer({ uri: url }, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)

  /* Mounting is the play tap, and blur is a hard stop: a post-detail route
     can stay mounted behind the next screen in the stack. */
  React.useEffect(() => {
    try {
      if (focused) player.play()
      else player.pause()
    } catch { /* released */ }
  }, [focused, player])

  React.useEffect(() => () => {
    try { player.pause() } catch { /* released */ }
  }, [player])

  const duration = status.duration || 0
  const position = status.currentTime || 0

  const onSeek = React.useCallback((sec: number) => {
    try { void player.seekTo(sec) } catch { /* released */ }
  }, [player])

  return (
    <VoiceTransport
      seed={url}
      playing={status.playing}
      position={position}
      duration={duration}
      onToggle={() => { if (status.playing) player.pause(); else player.play() }}
      onSeek={onSeek}
      style={style}
    />
  )
}

/** Module-scope so the a11y props stay reference-stable across ticks. */

/* The transport borrows the CHAT player's trace wholesale (VoiceNote.tsx),
   because it is the proven-smooth one: the played colouring is NOT per-bar
   state but a second, pre-coloured copy of the bars inside an overflow-hidden
   overlay whose animated WIDTH is the playhead. Status ticks glide the width
   through a shared value, and a finger scrubbing at 60fps re-renders nothing. */
const styles = StyleSheet.create({
  flex: { flex: 1 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.sm },
  /* Album pager chrome. Spelled-out absolute fill — SDK 57 removed
     StyleSheet.absoluteFillObject. */
  carouselPlayWrap: {
    position: 'absolute', top: 0, bottom: 0, start: 0, end: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  carouselPlay: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  carouselDots: { flexDirection: 'row', justifyContent: 'center', gap: space.xs, paddingTop: space.sm },
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 20,
    paddingHorizontal: space.sm,
    borderRadius: 5,
  },
  speaker: {
    position: 'absolute',
    bottom: 10,
    end: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Centering wrapper so the badge lands mid-frame in both the letterboxed
     reel plate and the plain 16:9 container. Spelled out — SDK 57 removed
     StyleSheet.absoluteFillObject. */
  playWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm2,
    paddingVertical: space.sm,
    marginTop: space.xs2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileName: { flex: 1 },
})
