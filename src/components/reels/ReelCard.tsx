/* =========================================================
   One full-screen reel.

   Pure presentation: every write is a callback, so the same
   card drives the tab, a deep link and a sound's continuation
   list without knowing which it is in.

   Three things here are load-bearing and easy to get wrong:

   1. A feed row carries NO audio and NO overlay — those only
      arrive with GET /posts/{id}. So the sound ticker and the
      overlay layer FADE IN a beat after playback starts rather
      than popping, and neither may ever gate the frame.
   2. The double-tap is LIKE, never unlike. A mis-tap that
      silently removes a like the user meant to keep is the one
      gesture failure people never forgive.
   3. THE PAGER RECYCLES THIS COMPONENT. FlashList v2 reuses a
      cell's React subtree for a different row (that is what
      keeps the VideoView and the two audio players off the
      per-swipe mount path), so every piece of local state —
      `expanded`, the chrome opacity, the long-press latch —
      has to be reset on `post.id`. A shared value left at 0 by
      a gesture that was interrupted by a page turn would make
      the next reel's chrome invisible and still tappable.

   Layout note: everything bottom-anchored is offset by
   `bottomInset` (tab bar + safe area, or just the safe area on
   the deep link), and the bottom scrim is sized from it so the
   action rail never floats over a bright frame unprotected.
   ========================================================= */
import { isRedactedText } from '@/api'
import { MODERATION_COPY, isHeld, isRemoved } from '@/lib/moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, VerifiedMark, fireHaptic } from '@/ui'
import { type ImageLoadEventData } from 'expo-image'
import { RemoteImage } from '@/components/media/RemoteImage'
import { LinearGradient } from 'expo-linear-gradient'
import { VideoView, type VideoPlayer } from 'expo-video'
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated'
import { ModerationBadge } from './ModerationBadge'
import { ReelActionRail } from './ReelActionRail'
import { ReelOverlayLayer, type OverlayDoc } from './ReelOverlayLayer'
import { ReelProgressBar } from './ReelProgressBar'
import { SoundTicker } from './SoundTicker'
import { PLATE_GRADIENT, STAGE, TEXT_SHADOW } from './skin'
import { useStillReelDriver, videoTransport, type Transport } from './transport'
import { clipUrlOf, isStillReel, type ViewPost } from './types'
import { useReelAudioNative } from './useReelAudioNative'
import type { ClipStatus } from './useReelPlayerPool'

export interface ReelCardProps {
  post: ViewPost
  /** Index in the pager — only the retry command needs the slot identity. */
  pageIndex: number
  active: boolean
  width: number
  height: number
  player: VideoPlayer | null
  clipStatus: ClipStatus
  onRetryClip: (index: number) => void
  overlayDoc: OverlayDoc | null
  soundCover?: string | null
  muted: boolean
  /** Screen-level pause: blur, background, an open sheet, or a tap. */
  paused: boolean
  isFollowing: boolean | null
  isMine: boolean
  signedIn: boolean
  bottomInset: number
  /** The clip (or the still's synthetic clock) reached its end — the pager
   *  answers by turning the page. Auto-advance, the reel grammar. */
  onEnded: (pageIndex: number) => void
  onTogglePlay: () => void
  onLike: (postId: string) => void
  onSave: (postId: string) => void
  onShare: (postId: string) => void
  onComments: (postId: string) => void
  onMore: () => void
  onFollow: (authorId: string) => void
  onAuthor: (authorId: string) => void
  onTag: (tag: string) => void
  onMention: (handle: string) => void
  onSound: (postId: string) => void
  onCopySound: (postId: string) => void
}

const RATIO_FALLBACK = { w: 9, h: 16 }

/* The rail's own height: 46pt avatar + its follow badge, then five buttons and
   their counters at an 18pt rhythm. Measured rather than guessed because the
   bottom scrim is sized from it. */
const RAIL_EXTENT = 360

export const ReelCard = React.memo(function ReelCard(props: ReelCardProps) {
  const {
    post, pageIndex, active, width, height, player, clipStatus, onRetryClip, overlayDoc, soundCover,
    muted, paused, isFollowing, isMine, signedIn, bottomInset, onEnded,
    onTogglePlay, onLike, onSave, onShare, onComments, onMore, onFollow,
    onAuthor, onTag, onMention, onSound, onCopySound,
  } = props

  const t = useTheme()
  const still = isStillReel(post)
  const held = isMine && isHeld(post)
  const removed = isMine && isRemoved(post)
  const playing = active && !paused && !removed

  /* ---- transport ---- */
  const stillDriver = useStillReelDriver(6, active && still)
  const clipTransport = React.useMemo<Transport | null>(
    () => (player ? videoTransport(player) : null),
    [player],
  )
  const transport = still ? stillDriver : clipTransport

  /* Item-first actions let ReelPager hand every card the same stable command.
     Without this boundary, a status tick minted eight closures per mounted
     page and made React.memo on the player-facing rows ineffective. */
  const retryClip = React.useCallback(() => onRetryClip(pageIndex), [onRetryClip, pageIndex])
  const likePost = React.useCallback(() => onLike(post.id), [onLike, post.id])
  const savePost = React.useCallback(() => onSave(post.id), [onSave, post.id])
  const sharePost = React.useCallback(() => onShare(post.id), [onShare, post.id])
  const openComments = React.useCallback(() => onComments(post.id), [onComments, post.id])
  const openAuthor = React.useCallback(() => onAuthor(post.author), [onAuthor, post.author])
  const followAuthor = React.useCallback(() => onFollow(post.author), [onFollow, post.author])
  const openSound = React.useCallback(() => onSound(post.id), [onSound, post.id])
  const copySound = React.useCallback(() => onCopySound(post.id), [onCopySound, post.id])
  const tapFollow = React.useCallback(() => {
    fireHaptic('light')
    followAuthor()
  }, [followAuthor])

  React.useEffect(() => {
    if (!still) return
    if (playing) stillDriver.play()
    else stillDriver.pause()
  }, [still, playing, stillDriver])

  /* ---- auto-advance ----
     Only the ACTIVE page listens (the neighbours are paused; they cannot end),
     and a finger on the scrub line vetoes the turn — dragging to the very end
     means "show me the last frame", not "leave". A paused reel cannot fire
     either: no playback, no playToEnd. The pager itself declines the advance
     under a screen reader and on the last page (ReelPager.advanceFrom). */
  const scrubbingRef = React.useRef(false)
  /* A page turn can interrupt a scrub mid-gesture, and this card is recycled
     for another reel — a stale `true` would silently veto every auto-advance
     the recycled card ever hosts. An effect (not the render-phase reset the
     visual state uses below): a ref paints nothing, and effects run long
     before the next clip could possibly end. */
  React.useEffect(() => { scrubbingRef.current = false }, [post.id])
  React.useEffect(() => {
    if (!active || !transport) return
    return transport.onEnded(() => {
      if (!scrubbingRef.current) onEnded(pageIndex)
    })
  }, [active, transport, onEnded, pageIndex])

  const { failed: soundFailed } = useReelAudioNative({
    transport,
    videoPlayer: still ? null : player,
    /* Gated on `active`, not `playing`: the ±2 neighbours are mounted and their
       urls are already hydrated, so an ungated call would build two native
       players per off-screen page and start pulling bytes for audio nobody can
       hear. useAudioPlayer keys on the source, so a null collapses to the
       sourceless singleton and the real player is built the moment the page
       lands — which is the same beat the hydration read arrives on anyway. */
    soundUrl: active ? post.soundUrl : null,
    voiceUrl: active ? post.voiceoverUrl : null,
    srcKey: post.id,
    muted,
    playing,
  })

  /* ---- media intrinsics + caption state, keyed to the reel ----
     Derived-state reset in the RENDER phase: a recycled cell arrives carrying
     the previous reel's values, and resetting them in effects painted one
     wrong frame and double-rendered this full-screen card on every page turn
     (it is also the set-state-in-effect shape the compiler bails on). */
  const [cardState, setCardState] = React.useState(() => ({ id: post.id, intrinsic: ratioOf(post), expanded: false }))
  if (cardState.id !== post.id) setCardState({ id: post.id, intrinsic: ratioOf(post), expanded: false })
  const intrinsic = cardState.intrinsic
  const expanded = cardState.expanded
  const setExpanded = React.useCallback((v: boolean) => {
    setCardState(s => (s.expanded === v ? s : { ...s, expanded: v }))
  }, [])
  const onImageLoad = React.useCallback((e: ImageLoadEventData) => {
    const s = e?.source
    if (s?.width && s?.height) setCardState(prev => ({ ...prev, intrinsic: { w: s.width, h: s.height } }))
  }, [])

  /* ---- chrome + gestures ---- */
  const chrome = useSharedValue(1)
  const playGlyph = useSharedValue(0)
  /* The burst lives entirely on shared values — position included — so a
     double-tap never costs the card a React render mid-playback. */
  const burst = useSharedValue(0)
  const burstFade = useSharedValue(0)
  const burstX = useSharedValue(0)
  const burstY = useSharedValue(0)
  /* `onFinalize` also fires when a long press never activated (a plain tap that
     lost the race), so the hold latches on onStart and only unwinds itself. */
  const longHeld = useSharedValue(0)
  const heldPaused = React.useRef(false)

  /* A recycled cell arrives carrying the previous reel's gesture state. Chrome
     opacity first: a hold cut short by a page turn used to strand the whole
     meta block and the rail at opacity 0 — invisible, and still eating taps.
     Only the SHARED VALUES reset here (writing them during render is
     illegal); the React state resets in the keyed block above. */
  React.useEffect(() => {
    chrome.value = 1
    longHeld.value = 0
    heldPaused.current = false
    /* And the burst: a heart mid-flight when the page turned must not land
       on the next reel. */
    burst.value = 0
    burstFade.value = 0
  }, [post.id, chrome, longHeld, burst, burstFade])

  const showChrome = React.useCallback((visible: boolean) => {
    chrome.value = withTiming(visible ? 1 : 0, { duration: t.ms(200) })
  }, [chrome, t])

  const flashPlayGlyph = React.useCallback(() => {
    playGlyph.value = 1
    playGlyph.value = withDelay(t.ms(600), withTiming(0, { duration: t.ms(220) }))
  }, [playGlyph, t])

  const tapPlay = React.useCallback(() => {
    fireHaptic('light')
    flashPlayGlyph()
    onTogglePlay()
  }, [flashPlayGlyph, onTogglePlay])

  const doubleLike = React.useCallback((x: number, y: number) => {
    /* Spring in under the finger, hold a beat, float up and fade. Reduced
       motion cuts the burst — the rail's heart fill is the confirm. */
    if (!t.prefs.reducedMotion) {
      burstX.value = x - 44
      burstY.value = y - 44
      burst.value = 0
      burstFade.value = 0
      burst.value = withSpring(1, t.motion.spring)
      burstFade.value = withDelay(t.ms(300), withTiming(1, { duration: t.ms(480) }))
    }
    fireHaptic('light')
    /* LIKE only. `onLike` is a toggle at the API, so an already-liked reel is
       deliberately left alone rather than un-liked by a stray second tap. */
    if (!post.liked) likePost()
  }, [burst, burstFade, burstX, burstY, t, post.liked, likePost])

  /* Hold to clear the frame. Explicit intent, not a blind toggle on each end:
     a hold that starts on an ALREADY paused reel must not start playback, and
     a hold interrupted by a page turn (the pager clears its own pause when the
     index settles) must not pause the reel that just arrived. Both cases are
     covered by latching what this gesture actually changed. */
  const pausedRef = React.useRef(paused)
  pausedRef.current = paused

  const holdStart = React.useCallback(() => {
    heldPaused.current = !pausedRef.current
    if (heldPaused.current) onTogglePlay()
    fireHaptic('medium')
  }, [onTogglePlay])

  const holdEnd = React.useCallback(() => {
    if (!heldPaused.current) return
    heldPaused.current = false
    /* Someone else already resumed us (a page turn) — leave it alone. */
    if (pausedRef.current) onTogglePlay()
  }, [onTogglePlay])

  /* ONE composed gesture per (handler set), not one per render. GestureDetector
     diffs by handler identity and re-registers the whole config with the native
     module when it changes — rebuilding these four objects on every counter
     delta re-registers gestures for every mounted page, mid-swipe if the delta
     lands mid-flick. */
  const gesture = React.useMemo(() => {
    const singleTap = Gesture.Tap()
      .maxDuration(260)
      .onEnd((_e, ok) => { if (ok) runOnJS(tapPlay)() })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(220)
      .onEnd((e, ok) => { if (ok) runOnJS(doubleLike)(e.x, e.y) })

    const longPress = Gesture.LongPress()
      /* 400ms with a hard 8px cap: a finger that rests on the caption for a
         beat and then drags must page the list, not activate a hold — an
         activated RNGH gesture cancels the scroll view's pan outright. */
      .minDuration(400)
      .maxDistance(8)
      .onStart(() => {
        longHeld.value = 1
        runOnJS(showChrome)(false)
        runOnJS(holdStart)()
      })
      .onFinalize(() => {
        if (!longHeld.value) return
        longHeld.value = 0
        runOnJS(showChrome)(true)
        runOnJS(holdEnd)()
      })

    const sideSwipe = Gesture.Pan()
      .activeOffsetX([-38, 38])
      .failOffsetY([-16, 16])
      .onEnd(e => {
        if (e.translationX < -70) runOnJS(openAuthor)()
      })

    return Gesture.Race(sideSwipe, Gesture.Exclusive(doubleTap, longPress, singleTap))
  }, [tapPlay, doubleLike, showChrome, holdStart, holdEnd, openAuthor, longHeld])

  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }))
  const playStyle = useAnimatedStyle(() => ({
    opacity: playGlyph.value,
    transform: [{ scale: 0.82 + playGlyph.value * 0.18 }],
  }))
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value * (1 - burstFade.value),
    transform: [
      { translateX: burstX.value },
      { translateY: burstY.value - burstFade.value * 16 },
      { scale: 0.2 + burst.value * 1.05 },
    ],
  }))

  /* ---- media ---- */
  const clip = clipUrlOf(post)
  const poster = post.media?.[0]?.poster || null
  const errored = clipStatus === 'error'
  const metaBottom = bottomInset + 22
  const railBottom = bottomInset + 26
  /* The scrim has to reach the TOP of the rail, not a fixed 280: on a tall
     phone the avatar and the like button sit well above a 280pt gradient and
     the only thing between a white glyph and a white frame is its shadow. */
  const scrimHeight = Math.min(height, railBottom + RAIL_EXTENT)

  return (
    <View style={{ width, height, backgroundColor: STAGE.black }}>
      <LinearGradient
        colors={PLATE_GRADIENT}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {removed ? (
        <View style={styles.removed}>
          <Icon name="warning" size={44} color={STAGE.danger} />
          <Text variant="headline" color={STAGE.fg} align="center" style={{ marginTop: space.md }}>
            {MODERATION_COPY.removed.title}
          </Text>
          <Text variant="footnote" color={STAGE.fgMuted} align="center" style={styles.removedNote}>
            {MODERATION_COPY.removed.note}
          </Text>
        </View>
      ) : still ? (
        /* A dead still (moderation deleted the asset) shows the quiet glyph
           on the stage instead of live chrome over a bare plate. */
        <RemoteImage
          source={post.media[0].url}
          fallback="overlay"
          fallbackIcon="image"
          fallbackIconSize={32}
          fallbackLabel="Image unavailable"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={180}
          cachePolicy="memory-disk"
          recyclingKey={post.id}
          onLoad={onImageLoad}
        />
      ) : player ? (
        <>
          {/* contain, not cover: the frame shows at its own aspect on the
              plate — a reel is never crop-zoomed to fill the screen. */}
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            allowsVideoFrameAnalysis={false}
          />
          {/* The cover, over the surface, until the decoder has a frame. A
              page turn hands this card its player mid-replace — without the
              poster the wait is a bare plate, and on a recycled cell it can
              be the PREVIOUS reel's last frame. Gone on readyToPlay; the
              retry plate draws over it on error. Same caveat as below: a
              cover that IS the video url makes no poster. */}
          {poster && poster !== clip && clipStatus !== 'readyToPlay' ? (
            <RemoteImage
              source={poster}
              fallback="hidden"
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={post.id}
            />
          ) : null}
        </>
      ) : poster && poster !== clip ? (
        /* Outside the player window. The cover of a REEL feed row IS its video
           url, so it only makes a poster when the hydrated read gave us a real
           image — otherwise the gradient plate stands in. */
        <RemoteImage
          source={poster}
          fallback="hidden"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : null}

      {overlayDoc && !removed ? (
        <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
          <ReelOverlayLayer
            doc={overlayDoc}
            box={{ width, height }}
            mediaW={intrinsic.w}
            mediaH={intrinsic.h}
            paused={!playing}
          />
        </Animated.View>
      ) : null}

      {/* Gesture surface sits above the media and below the chrome. */}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>

      {/* Reader-only play/pause: the singleTap above is a raw gesture and
          never receives accessibility activations, so without this a reel
          had no reachable pause at all (StoryAuthorPage's zone pattern).
          Rendered BELOW the rail and chrome so their controls stay on top;
          sighted users keep the gesture, inert under a reader anyway. */}
      {t.a11y.screenReader ? (
        <Touchable
          feedback="none"
          noAutoHitSlop
          style={StyleSheet.absoluteFill}
          accessibilityLabel={playing ? 'Pause reel' : 'Play reel'}
          onPress={onTogglePlay}
        >
          <View style={StyleSheet.absoluteFill} />
        </Touchable>
      ) : null}

      <LinearGradient
        colors={[STAGE.scrimTop, STAGE.transparent]}
        style={[styles.scrimTop, { width }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[STAGE.transparent, STAGE.scrimBottom]}
        style={[styles.scrimBottom, { width, height: scrimHeight }]}
        pointerEvents="none"
      />

      <Animated.View style={[styles.playGlyph, playStyle]} pointerEvents="none">
        <Icon name={paused ? 'play' : 'pause'} size={38} color={STAGE.fg} filled />
      </Animated.View>

      <Animated.View style={[styles.burst, burstStyle]} pointerEvents="none">
        <Icon name="heart" size={88} color={STAGE.like} filled />
      </Animated.View>

      {errored && !still && !removed ? (
        <View style={styles.clipError} pointerEvents="box-none">
          <Text variant="footnote" color={STAGE.fg}>Couldn&rsquo;t play this reel</Text>
          <Touchable onPress={retryClip} feedback="scale" style={styles.retryButton} accessibilityLabel="Retry playback">
            <Icon name="refresh" size={13} color={STAGE.fg} />
            <Text variant="caption" weight="600" color={STAGE.fg}>Retry</Text>
          </Touchable>
        </View>
      ) : null}

      <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
        <View style={[styles.meta, { bottom: metaBottom }]} pointerEvents="box-none">
          {post.source === 'EXPLORE' ? (
            <View style={styles.suggested} pointerEvents="none">
              <Icon name="sparkle" size={11} color={STAGE.fgMuted} />
              <Text variant="caption" color={STAGE.fgMuted} style={TEXT_SHADOW}>Suggested for you</Text>
            </View>
          ) : null}

          {held ? <ModerationBadge item={post} compact /> : null}

          {/* box-none, and only as wide as its content: a plain View here spans
              the whole meta column and swallows every tap in a 30pt band —
              the gesture surface is its SIBLING, not its ancestor, so a touch
              that lands on it never reaches play/pause or double-tap-to-like. */}
          <View style={styles.identity} pointerEvents="box-none">
            <Avatar
              uri={post._author.profileImage}
              name={post._author.full}
              seed={post._author.id}
              size={30}
              onPress={openAuthor}
            />
            <Touchable onPress={openAuthor} feedback="dim" noAutoHitSlop accessibilityLabel={`${post._author.handle} profile`}>
              <Text variant="subhead" weight="600" color={STAGE.fg} style={TEXT_SHADOW}>
                @{post._author.handle}
              </Text>
            </Touchable>
            {post._author.verified ? <VerifiedMark size={12} /> : null}
            {isFollowing === false && !isMine ? (
              <Touchable
                onPress={tapFollow}
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel={`Follow ${post._author.handle}`}
                style={styles.followChip}
              >
                <Text variant="caption" weight="700" color={STAGE.fg} style={TEXT_SHADOW}>Follow</Text>
              </Touchable>
            ) : null}
          </View>

          <ReelCaption
            body={post.body}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            onTag={onTag}
            onMention={onMention}
          />

          <SoundTicker
            name={post.soundName || ''}
            coverUrl={soundCover}
            linked={!!post.soundUrl}
            playing={playing}
            failed={soundFailed}
            onPress={post.soundUrl ? openSound : undefined}
            onLongPress={post.soundUrl ? copySound : undefined}
          />
        </View>

        {/* The wrapper owns the placement and the rail is an ordinary column
            inside it — see ReelActionRail's header for why the rail may not
            position itself. */}
        <View style={[styles.railWrap, { bottom: railBottom }]} pointerEvents="box-none">
          <ReelActionRail
            likes={post.likes}
            comments={post.comments}
            shares={post.shares}
            saves={post.saves}
            liked={post.liked}
            saved={post.saved}
            author={post._author}
            isFollowing={isMine ? true : isFollowing}
            disabled={held || removed}
            onLike={likePost}
            onSave={savePost}
            onShare={sharePost}
            onComment={openComments}
            onMore={onMore}
            onAuthor={openAuthor}
            onFollow={followAuthor}
          />
        </View>

        {/* Inside the chrome layer, so a hold clears the frame COMPLETELY —
            a scrub line left burning over a hidden caption contradicts the
            whole gesture. Opacity never blocks touches, so the scrub target
            survives the fade and puts the chrome straight back up. */}
        {active && !removed ? (
          <ReelProgressBar
            transport={transport}
            width={width}
            bottom={bottomInset}
            /* Chrome stays up through a scrub: the whole point of dragging is
               to watch the frame change against the caption you were reading.
               The ref is the auto-advance veto — see the onEnded effect. */
            onScrubStart={() => { scrubbingRef.current = true; showChrome(true) }}
            onScrubEnd={() => { scrubbingRef.current = false; showChrome(true) }}
          />
        ) : null}
      </Animated.View>
    </View>
  )
})

/* ---------------------------------------------------------
   The neutral plate.

   Anything further than the pager's live window renders THIS
   instead of a ReelCard: no player, no audio objects, no
   overlay fetch. It carries just enough — the poster if we
   have one, the handle, the first line of the caption — that a
   fast flick reads as content going past rather than as the
   list breaking.

   The window is deliberately wider than the recycler's engaged
   set (ReelPager's LIVE), so a normal swipe never crosses this
   boundary — a mounted cell that changed its item type would
   be a full card built inside the gesture. What lands here is
   a JUMP: a scrollToIndex correction, or a deep link opening
   mid-list.
   --------------------------------------------------------- */

export const ReelStaticPage = React.memo(function ReelStaticPage({ post, width, height, bottomInset }: {
  post: ViewPost
  width: number
  height: number
  bottomInset: number
}) {
  const poster = post.media?.[0]?.poster
  const showPoster = !!poster && poster !== clipUrlOf(post)
  return (
    <View style={{ width, height, backgroundColor: STAGE.black }}>
      <LinearGradient
        colors={PLATE_GRADIENT}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {showPoster || isStillReel(post) ? (
        /* Dead media falls to the gradient plate underneath. */
        <RemoteImage
          source={isStillReel(post) ? post.media[0].url : poster!}
          fallback="hidden"
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : null}
      <LinearGradient
        colors={[STAGE.transparent, STAGE.scrimBottom]}
        style={[styles.scrimBottom, { width }]}
        pointerEvents="none"
      />
      <View style={[styles.meta, { bottom: bottomInset + 22 }]} pointerEvents="none">
        <View style={styles.identity}>
          <Avatar uri={post._author.profileImage} name={post._author.full} seed={post._author.id} size={30} />
          <Text variant="subhead" weight="600" color={STAGE.fg} style={TEXT_SHADOW}>@{post._author.handle}</Text>
        </View>
        {post.body ? (
          <Text variant="callout" color={STAGE.fgMuted} numberOfLines={1} style={TEXT_SHADOW}>{post.body}</Text>
        ) : null}
      </View>
    </View>
  )
})

/* ---------------------------------------------------------
   The caption.

   RichText is the app's renderer, but it paints with theme
   text colours — which are near-black in light mode and would
   vanish over a video. A reel caption is PLAIN text by
   contract, so it gets a small tokeniser instead of a themed
   block renderer.
   --------------------------------------------------------- */

/* `-` is NOT a handle character server-side, and a handle is 2–50 long —
   `@a` and `@some-name` both used to highlight here and neither pings. Kept as
   a split-and-keep pattern (the caption renderer below relies on the odd-index
   invariant) rather than importing mentionSpans, so the leading guard is
   written as a non-capturing lookahead-free bound: a `@` may not follow a word
   character or another `@`. */
const TOKEN = /(#[\p{L}\p{N}_]+|@[A-Za-z0-9._]{2,50})/u

function ReelCaption({
  body, expanded, onExpand, onTag, onMention,
}: {
  body: string
  expanded: boolean
  onExpand: () => void
  onTag: (tag: string) => void
  onMention: (handle: string) => void
}) {
  if (!body) return null

  if (isRedactedText(body)) {
    return (
      <View style={styles.redacted}>
        <Icon name="warning" size={12} color={STAGE.warn} />
        <Text variant="footnote" color={STAGE.warn}>This caption was removed by moderation.</Text>
      </View>
    )
  }

  const parts = body.split(TOKEN).filter(s => s !== '')
  const runs = parts.map((part, i) => {
    if (part.startsWith('#') && part.length > 1) {
      return (
        <Text key={i} variant="callout" weight="600" color={STAGE.fg} onPress={() => onTag(part.slice(1))}>
          {part}
        </Text>
      )
    }
    if (part.startsWith('@') && part.length > 1) {
      return (
        <Text key={i} variant="callout" weight="600" color={STAGE.fg} onPress={() => onMention(part.slice(1))}>
          {part}
        </Text>
      )
    }
    return <Text key={i} variant="callout" color={STAGE.fg}>{part}</Text>
  })

  const line = (
    <Text
      variant="callout"
      color={STAGE.fg}
      numberOfLines={expanded ? 8 : 2}
      style={[styles.caption, TEXT_SHADOW]}
    >
      {runs}
      {!expanded && body.length > 90 ? (
        <Text variant="callout" weight="600" color={STAGE.fgMuted} onPress={onExpand}>{'  more'}</Text>
      ) : null}
    </Text>
  )

  /* box-none and content-width for the same reason as the identity row: the
     collapsed caption must not turn its whole column into a tap sink. */
  if (!expanded) return <View style={styles.captionWrap} pointerEvents="box-none">{line}</View>
  return (
    <ScrollView style={styles.captionScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {line}
    </ScrollView>
  )
}

/* A reel's media ratio is declared on the row ('9/16'); the overlay rect is
   derived from it until a still's real intrinsics land. */
/* The intrinsic aspect the OVERLAY is placed against — not a display hint.
   `media[*].ratio` is a CARD hint the adapters hard-code ('16/10' from the full
   read, '9/16' from a feed row): it says how a tile should be shaped, never how
   tall the clip is. Feeding the 16/10 one to mediaRect() made the reel's rect
   1482pt wide inside a 428pt card, and since an item's size is `s × rect.width`
   every word came out three and a half times too big the moment the pager
   hydrated the full post. A clip's real intrinsics are not on the wire, so the
   honest answer is the format the composer authored against — 9:16 — and a
   STILL reel replaces it with the photo's true size at onLoad. */
function ratioOf(post: ViewPost): { w: number; h: number } {
  if (!isStillReel(post)) return RATIO_FALLBACK
  const raw = post.media?.[0]?.ratio
  const m = typeof raw === 'string' ? /^(\d+)\s*\/\s*(\d+)$/.exec(raw) : null
  if (!m) return RATIO_FALLBACK
  const w = Number(m[1]); const h = Number(m[2])
  return w > 0 && h > 0 ? { w, h } : RATIO_FALLBACK
}

const styles = StyleSheet.create({
  scrimTop: { position: 'absolute', top: 0, left: 0, height: 150 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, height: 280 },
  playGlyph: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Anchored at the origin; the tap point rides in on translate so a burst
     never triggers a layout pass. */
  burst: { position: 'absolute', left: 0, top: 0, width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  meta: { position: 'absolute', start: 14, end: 78, gap: space.sm2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' },
  /* A chip, not a pill: the only pills in the app are unread counters and the
     LIVE badge (DESIGN.md §8.9). */
  followChip: {
    height: 26,
    paddingHorizontal: space.sm2,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    /* A bare hairline over a bright frame is a white outline on white. The
       glass plate is what makes it a control rather than a suggestion. */
    backgroundColor: STAGE.glass,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: space.xxs,
  },
  captionWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  captionScroll: { maxHeight: 160 },
  caption: { lineHeight: 20 },
  redacted: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  suggested: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, alignSelf: 'flex-start' },
  /* The rail's anchor: `end` + `alignItems`, and NO `start` — a full-width box
     would blanket the frame and eat every tap meant for the video. Height comes
     from the in-flow column inside it. */
  railWrap: { position: 'absolute', end: 8, alignItems: 'center' },
  clipError: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    /* A popover-sized plate over the frame: setback, never a uniform radius. */
    ...setback(shape.popover),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 30,
    paddingHorizontal: space.md,
    ...setback(shape.buttonSm),
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  removed: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', padding: 34 },
  removedNote: { maxWidth: 300, marginTop: space.xs2 },
})
