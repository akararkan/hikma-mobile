/* =========================================================
   Media viewer.

   Gesture composition, in the order that matters:

     pinch      scale 1..4, springs back to 1 on release
     pan        ENABLED ONLY WHILE ZOOMED. At scale 1 the pager
                owns horizontal movement, and a pan that fights
                it makes swiping between pages feel broken.
     double tap fit ↔ 2.5×
     swipe down at scale 1 only, drags the page with the finger
                and dims the backdrop in proportion — the
                dismissal is legible before it commits.

   Everything sits on opaque black. A broken image gets an
   honest placeholder, never an error toast over a black screen.
   ========================================================= */
import React from 'react'
import { ScrollView, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated'
import { Image } from 'expo-image'
import { RemoteImage } from '@/components/media/RemoteImage'
import { useVideoPlayer, VideoView } from 'expo-video'
import * as MediaLibrary from 'expo-media-library'
import * as Clipboard from 'expo-clipboard'
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { toLocalFile } from '@/lib/localFile'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { withAlpha } from '@/theme/colors'
import { ActionSheet, Icon, Spinner, Text, Touchable, toast } from '@/ui'
import { reportHref } from '@/components/system/Moderation'
import { PostActions } from '@/components/post/PostActions'
import { useEngagement } from '@/components/post/useEngagement'
import { albumToMedia } from '@/components/post/albumMedia'
import type { FeedMedia, PostView } from '@/components/feed/types'

const DISMISS_AT = 120

export default function MediaViewerScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>()

  const post = useAsync<PostView>(() => api.posts.get(id), { enabled: !!id, deps: [id] })
  /* This screen re-reads the post independently, so it must apply the SAME
     album-wins precedence as the detail screen — otherwise the `index` param
     handed over by a carousel tap points into a different list. */
  const album = useAsync<any[]>(() => api.posts.media.list(id), { enabled: !!id, deps: [id] })
  const [page, setPage] = React.useState(() => Math.max(0, Number(index) || 0))
  const [chrome, setChrome] = React.useState(true)
  const [menu, setMenu] = React.useState(false)
  /* While a photo is zoomed the pan belongs to the image, so the pager must
     let go of the horizontal axis. */
  const [pagerLocked, setPagerLocked] = React.useState(false)
  const pagerRef = React.useRef<ScrollView>(null)

  const media = album.data?.length ? albumToMedia(album.data) : (post.data?.media || [])
  const current = media[page]

  /* Deep-linked openings are the only ones the detail screen did not already
     report — going through it twice is harmless (the server dedups over a
     7-day window) but pointless. */
  React.useEffect(() => {
    if (!id) return
    const timer = setTimeout(() => { api.posts.recordView(id).catch(() => {}) }, 600)
    return () => clearTimeout(timer)
  }, [id])

  React.useEffect(() => {
    if (!post.data || !media.length) return
    const start = Math.min(media.length - 1, Math.max(0, Number(index) || 0))
    if (start > 0) requestAnimationFrame(() => pagerRef.current?.scrollTo({ x: start * width, animated: false }))
  }, [post.data, media.length, index, width])

  const patch = React.useCallback((_pid: string, fn: (p: any) => any) => {
    post.setData(p => (p ? fn(p) : p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { toggleLike, toggleSave } = useEngagement<any>(patch)

  const drag = useSharedValue(0)
  const backdrop = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.75, Math.abs(drag.value) / (height * 0.7)),
  }))
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }))

  const close = React.useCallback(() => { router.back() }, [router])
  /* Stable, so each Page's composed gesture survives a chrome toggle. */
  const toggleChrome = React.useCallback(() => setChrome(v => !v), [])

  const saveToDevice = async () => {
    const url = current?.url
    if (!url) return
    try {
      const perm = await MediaLibrary.requestPermissionsAsync()
      if (!perm.granted) {
        toast.warn('Allow photo access in Settings to save')
        return
      }
      await MediaLibrary.saveToLibraryAsync(await toLocalFile(url, 'ika-media'))
      toast.ok('Saved to your device')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* The one surface in the app that has to be genuinely opaque black. Derived
     from the fixed `overlay` role rather than written as a hex, so a palette
     change still reaches it. */
  const black = withAlpha(c.overlayBg, 1)

  return (
    <View style={[styles.root, { backgroundColor: black }]}>
      <StatusBar hidden />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: black }, backdrop]} />

      {post.loading ? (
        <View style={styles.center}><Spinner size="large" /></View>
      ) : !media.length ? (
        <View style={styles.center}>
          <Icon name="image" size={34} color={c.overlayTextMuted} />
          <Text variant="callout" color={c.overlayTextMuted} align="center" style={{ marginTop: space.sm2 }}>
            This file isn’t available
          </Text>
        </View>
      ) : (
        <Animated.View style={[styles.flex, pageStyle]}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            scrollEnabled={!pagerLocked}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {media.map((m, i) => (
              /* ±1 window: an album otherwise decoded every original at once
                 for one visible page. The wrapper keeps each page's slot in
                 the paging ScrollView. */
              <View key={`${m.url}:${i}`} style={{ width, height }}>
                {Math.abs(i - page) <= 1 ? (
                  <Page
                    media={m}
                    width={width}
                    height={height}
                    active={i === page}
                    drag={drag}
                    onTap={toggleChrome}
                    onDismiss={close}
                    onZoomChanged={setPagerLocked}
                  />
                ) : null}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {chrome ? (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top }]}>
            <Touchable onPress={close} feedback="scale" accessibilityLabel="Close" style={styles.iconBtn}>
              <Icon name="close" size={24} color={c.overlayText} />
            </Touchable>
            {media.length > 1 ? (
              <Text variant="subhead" weight="600" color={c.overlayText} align="center" style={styles.flex}>
                {page + 1} / {media.length}
              </Text>
            ) : <View style={styles.flex} />}
            <Touchable onPress={() => setMenu(true)} feedback="scale" accessibilityLabel="More" style={styles.iconBtn}>
              <Icon name="more" size={22} color={c.overlayText} />
            </Touchable>
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 6 }]}>
            {post.data?.body ? (
              <Text variant="callout" color={c.overlayText} numberOfLines={3} style={styles.caption}>
                {post.data.body}
              </Text>
            ) : null}
            {media.length > 1 && media.length <= 8 ? (
              <View style={styles.dots}>
                {media.map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: i === page ? c.overlayText : c.overlayTextMuted,
                      opacity: i === page ? 1 : 0.5,
                    }}
                  />
                ))}
              </View>
            ) : null}
            {post.data ? (
              <PostActions
                tone="overlay"
                liked={post.data.liked}
                saved={post.data.saved}
                likes={post.data.likes}
                comments={post.data.comments}
                shares={post.data.shares}
                onLike={() => { void toggleLike(post.data) }}
                onSave={() => { void toggleSave(post.data) }}
                onComment={() => router.push({ pathname: '/post/[id]', params: { id, focus: 'comment' } })}
                onShare={() => router.push(`/post/${id}/share`)}
                style={styles.actions}
              />
            ) : null}
          </View>
        </>
      ) : null}

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: 'Save to device', icon: 'download', onPress: () => { void saveToDevice() } },
          {
            label: 'Copy link',
            icon: 'link',
            onPress: async () => {
              try {
                const info: any = await api.posts.shareLink(id)
                await Clipboard.setStringAsync(info?.shortUrl || info?.canonicalUrl || '')
                await api.posts.recordShare(id).catch(() => {})
                toast.ok('Link copied')
              } catch (e) { toast.error(errorText(e)) }
            },
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            onPress: () => router.push(reportHref({
              targetType: 'POST',
              targetId: id,
              authorId: post.data?.author ? String(post.data.author) : undefined,
              name: post.data?._author?.full || undefined,
              avatar: post.data?._author?.profileImage || undefined,
            })),
          },
        ]}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   One page.
   --------------------------------------------------------- */

function Page({
  media, width, height, active, drag, onTap, onDismiss, onZoomChanged,
}: {
  media: FeedMedia
  width: number
  height: number
  active: boolean
  drag: SharedValue<number>
  onTap: () => void
  onDismiss: () => void
  onZoomChanged: (zoomed: boolean) => void
}) {
  const t = useTheme()
  const [broken, setBroken] = React.useState(false)
  /* Mirrored from the SETTLED scale: gesture enablement and the pager's
     scrollEnabled are JS-side config, so the worklets report zoom crossings
     up rather than branching per frame. */
  const [zoomed, setZoomed] = React.useState(false)
  const setZoom = React.useCallback((z: boolean) => {
    setZoomed(z)
    onZoomChanged(z)
  }, [onZoomChanged])

  const scale = useSharedValue(1)
  const saved = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  const spring = t.motion.spring
  const reset = React.useCallback(() => {
    scale.value = withSpring(1, spring)
    saved.value = 1
    tx.value = withSpring(0, spring)
    ty.value = withSpring(0, spring)
    setZoom(false)
  }, [scale, saved, tx, ty, spring, setZoom])

  /* Every page of the album re-renders when the pager or the chrome moves, and
     GestureDetector diffs its gesture by identity — rebuilding these four
     objects re-registers the handler config with the native module for every
     mounted page. Built once per page instead. */
  const gesture = React.useMemo(() => {
    /* Captured in JS — t.ms cannot run inside a worklet. */
    const outMs = t.ms(180)
    const pinch = Gesture.Pinch()
      .onUpdate(e => { scale.value = Math.min(4, Math.max(1, saved.value * e.scale)) })
      .onEnd(() => {
        saved.value = scale.value
        if (scale.value <= 1.02) {
          scale.value = withSpring(1, spring); saved.value = 1; tx.value = withSpring(0); ty.value = withSpring(0)
          runOnJS(setZoom)(false)
        } else {
          runOnJS(setZoom)(true)
        }
      })

    /* At fit the horizontal axis belongs to the pager, and the offsets are
       what tell gesture-handler so — an unconstrained pan claims the touch on
       the first pixel and a swipe to the next photo moves nothing. */
    const dismissPan = Gesture.Pan()
      .enabled(!zoomed)
      .activeOffsetY([-14, 14])
      .failOffsetX([-24, 24])
      .onUpdate(e => { if (e.translationY > 0) drag.value = e.translationY })
      .onEnd(e => {
        if (e.translationY > DISMISS_AT || e.velocityY > 1200) {
          drag.value = withTiming(height, { duration: outMs })
          runOnJS(onDismiss)()
        } else {
          drag.value = withSpring(0, spring)
        }
      })

    /* While zoomed a pan is a pan around the image, both axes; the parent has
       released the pager. */
    const zoomPan = Gesture.Pan()
      .enabled(zoomed)
      .averageTouches(true)
      .onBegin(() => { startX.value = tx.value; startY.value = ty.value })
      .onUpdate(e => {
        tx.value = startX.value + e.translationX
        ty.value = startY.value + e.translationY
      })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e, ok) => {
        if (!ok) return
        if (scale.value > 1.02) { runOnJS(reset)(); return }
        /* Zoom toward the tap point so the thing under the finger stays there. */
        scale.value = withSpring(2.5, spring)
        saved.value = 2.5
        tx.value = withSpring((width / 2 - e.x) * 1.5, spring)
        ty.value = withSpring((height / 2 - e.y) * 1.5, spring)
        runOnJS(setZoom)(true)
      })

    const singleTap = Gesture.Tap().numberOfTaps(1).onEnd((_e, ok) => { if (ok) runOnJS(onTap)() })

    return Gesture.Simultaneous(
      Gesture.Exclusive(doubleTap, singleTap),
      Gesture.Simultaneous(pinch, dismissPan, zoomPan),
    )
  }, [scale, saved, tx, ty, startX, startY, drag, spring, width, height, reset, onTap, onDismiss, zoomed, setZoom, t])

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  if (media.type === 'VIDEO' && media.url) {
    /* The pager renders EVERY page, and a paused expo-video player still holds
       its decoder and its buffered source — a mixed album would open one per
       video when only one can be seen. So the player exists only for the page
       you are on; the others are their poster, the same rule ActiveVideo and
       useReelPlayerPool enforce. */
    return (
      <View style={{ width, height }}>
        {active ? (
          <VideoPage url={media.url} />
        ) : (
          <>
            {media.poster ? (
              /* A dead poster degrades to the posterless page — dark ground
                 plus the play glyph. */
              <RemoteImage
                source={media.poster}
                fallback="hidden"
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={0}
                cachePolicy="memory-disk"
              />
            ) : null}
            <View style={styles.center} pointerEvents="none">
              <Icon name="play" size={34} color={t.colors.overlayText} filled />
            </View>
          </>
        )}
      </View>
    )
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        {broken || !media.url ? (
          <View style={styles.center}>
            <Icon name="image" size={34} color={t.colors.overlayTextMuted} />
            <Text variant="callout" color={t.colors.overlayTextMuted} align="center" style={{ marginTop: space.sm2 }}>
              This file isn’t available
            </Text>
          </View>
        ) : (
          <Animated.View style={[styles.flex, imageStyle]}>
            <Image
              source={{ uri: media.url }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={140}
              cachePolicy="memory-disk"
              onError={() => setBroken(true)}
              /* Album items carry the author's alt text; inline ones do not. */
              accessibilityLabel={media.alt || undefined}
              accessible={!!media.alt}
            />
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  )
}

/* Mounted only for the page in view, so mounting IS the play. */
function VideoPage({ url }: { url: string }) {
  const focused = useIsFocused()
  const player = useVideoPlayer(url, p => { p.loop = true })
  React.useEffect(() => {
    /* A pushed route (share, report) leaves this screen mounted under it —
       blur, not unmount, is the navigation boundary. */
    try { focused ? player.play() : player.pause() } catch { /* released */ }
  }, [player, focused])
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg },
  caption: { marginBottom: space.sm2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.xs, marginBottom: space.xs2 },
  actions: { borderTopWidth: 0 },
})
