/* =========================================================
   Message media viewer — shared by DMs and channels.

   A channel post IS a message (the payload round-trips on
   MessageResponse exactly as a DM does, and both screens read
   it with api.chat.messages.get), so one viewer serves both;
   what differs is only the chrome around it — who is named at
   the top, and which actions the sheet offers. Those arrive as
   props. Two copies of the gesture stack would drift.

   The media proxy is PUBLIC and honours Range, so expo-image
   and expo-video both work with no auth plumbing — the URLs the
   adapters produced are already absolute.

   Drag-to-dismiss and pinch-zoom share one page: the pan is
   only allowed to dismiss while the image is at rest (scale 1),
   because a pan during a zoom is a pan around the image, and
   conflating the two makes zoomed inspection impossible.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import PagerView from 'react-native-pager-view'
import { RemoteImage } from '@/components/media/RemoteImage'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { toLocalFile } from '@/lib/localFile'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { ActionSheet, Icon, Spinner, Text, Touchable, toast, useSheetState } from '@/ui'
import { clockTime } from '@/components/chat/format'

/* The theme's `overlay*` roles cover chrome that sits ON media, but there is no
   opaque-black SURFACE role and adding one would make every screen answer for
   it. A full-bleed viewer needs exactly one, so it lives here — the same
   arrangement the reel stage uses. */
const STAGE_BLACK = '#000000'

export type ViewerAction = {
  label: string
  icon: string
  destructive?: boolean
  onPress: () => void | Promise<void>
}

export type MessageMediaViewerProps = {
  messageId: string
  /** Page to open on; a carousel tap hands over its index. */
  index?: number
  /** The name on the top bar. Defaults to the message's sender. */
  title?: (message: any) => string
  /** A channel with `protectedContent` on REMOVES save and share — the
   *  restriction is the channel's, so the caller decides. */
  canSave?: boolean
  /** Appended after Save / Share — forward, jump, delete, whatever the
   *  surface owns. */
  extraActions?: (message: any) => ViewerAction[]
  /** Which attachments page here. MUST match the list the tapping surface
   *  indexed into, or `index` lands on the wrong tile: the DM grid counts
   *  IMAGE and VIDEO only; the channel album counts every visual kind. */
  isPageable?: (m: any) => boolean
}

const DM_PAGEABLE = (m: any) => m?.kind === 'IMAGE' || m?.kind === 'VIDEO'

export function MessageMediaViewer({
  messageId, index = 0, title, canSave = true, extraActions, isPageable = DM_PAGEABLE,
}: MessageMediaViewerProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()

  const message = useAsync<any>(() => api.chat.messages.get(messageId), { deps: [messageId] })
  const menu = useSheetState()

  const [page, setPage] = React.useState(Math.max(0, index || 0))
  const [chrome, setChrome] = React.useState(true)
  /* While a photo is zoomed the pan belongs to the image, so the pager must
     let go of the horizontal axis. */
  const [pagerLocked, setPagerLocked] = React.useState(false)

  const media: any[] = React.useMemo(
    () => (message.data?.media || []).filter((m: any) => m && isPageable(m)),
    [message.data, isPageable],
  )
  const current = media[page]

  /* Auto-hide the chrome, and re-arm the timer whenever it comes back. */
  React.useEffect(() => {
    if (!chrome) return
    const timer = setTimeout(() => setChrome(false), 3000)
    return () => clearTimeout(timer)
  }, [chrome, page])

  const save = async () => {
    if (!current?.url) return
    try {
      const perm = await MediaLibrary.requestPermissionsAsync()
      if (!perm.granted) { toast.warn('Allow photo access in Settings to save.'); return }
      /* saveToLibraryAsync takes a FILE uri — the remote url throws on iOS. */
      await MediaLibrary.saveToLibraryAsync(await toLocalFile(current.url))
      toast.ok('Saved to your photos')
    } catch (e) {
      toast.error(chatError(e, 'Could not save to your photos'))
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: STAGE_BLACK }]}>
      {message.loading && !message.data ? (
        <View style={styles.center}><Spinner size="large" /></View>
      ) : !media.length ? (
        <View style={styles.center}>
          <Icon name="image" size={32} color={c.overlayTextMuted} />
          <Text variant="footnote" color={c.overlayTextMuted} align="center" style={{ marginTop: space.sm }}>
            This file is no longer available.
          </Text>
        </View>
      ) : (
        <PagerView
          style={styles.root}
          initialPage={Math.min(page, media.length - 1)}
          onPageSelected={e => setPage(e.nativeEvent.position)}
          scrollEnabled={!pagerLocked}
        >
          {media.map((m, i) => (
            <View key={String(m.storageKey || m.url || i)} style={styles.page}>
              {/* ±1 window: a ten-attachment message otherwise decoded ten
                  full-resolution originals on open, for one visible page. */}
              {Math.abs(i - page) <= 1 ? (
                <Page
                  media={m}
                  width={width}
                  height={height}
                  active={i === page}
                  onDismiss={() => router.back()}
                  onToggleChrome={() => setChrome(v => !v)}
                  onZoomChanged={setPagerLocked}
                />
              ) : null}
            </View>
          ))}
        </PagerView>
      )}

      {chrome ? (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 6, backgroundColor: c.overlayChip }]}>
            <Touchable onPress={() => router.back()} feedback="scale" accessibilityLabel="Close" style={styles.iconBtn}>
              <Icon name="close" size={24} color={c.overlayText} />
            </Touchable>
            <View style={styles.flex}>
              <Text variant="footnote" color={c.overlayText} align="center" numberOfLines={1}>
                {title ? title(message.data) : message.data?.sender?.full || 'Member'}
              </Text>
              <Text variant="caption" color={c.overlayTextMuted} align="center">
                {clockTime(message.data?.createdAt)} · {message.data?.time}
              </Text>
            </View>
            <Touchable onPress={menu.open} feedback="scale" accessibilityLabel="More" style={styles.iconBtn}>
              <Icon name="moreVertical" size={22} color={c.overlayText} />
            </Touchable>
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10, backgroundColor: c.overlayChip }]}>
            {message.data?.body ? (
              <Text variant="footnote" color={c.overlayText} align="auto" numberOfLines={2} style={styles.caption}>
                {message.data.body}
              </Text>
            ) : null}
            {media.length > 1 ? (
              <View style={styles.filmstrip}>
                {media.map((m, i) => (
                  <View
                    key={i}
                    style={[
                      styles.thumb,
                      { borderColor: i === page ? c.overlayText : 'transparent' },
                    ]}
                  >
                    <RemoteImage
                      source={m.thumbnailUrl || m.url}
                      fallback="overlay"
                      fallbackIcon="image"
                      fallbackIconSize={14}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          ...(canSave ? [
            { label: 'Save to photos', icon: 'download', onPress: () => { void save() } },
            {
              label: 'Share',
              icon: 'share',
              onPress: async () => {
                if (!current?.url) return
                try {
                  if (!(await Sharing.isAvailableAsync())) { toast.warn('Sharing is not available on this device.'); return }
                  await Sharing.shareAsync(await toLocalFile(current.url))
                } catch { toast.warn('Could not share this file.') }
              },
            },
          ] : []),
          ...(extraActions ? extraActions(message.data) : []),
        ] as any}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   One page: pinch, pan, double-tap, drag to dismiss.
   --------------------------------------------------------- */

function Page({
  media, width, height, active, onDismiss, onToggleChrome, onZoomChanged,
}: {
  media: any
  width: number
  height: number
  active: boolean
  onDismiss: () => void
  onToggleChrome: () => void
  onZoomChanged: (zoomed: boolean) => void
}) {
  const t = useTheme()
  /* Captured in JS — t.ms cannot run inside a worklet. */
  const zoomMs = t.ms(180)
  const spring = t.motion.spring
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  /* Mirrored from the SETTLED scale: gesture enablement and the pager's
     scrollEnabled are JS-side config, so the worklets report zoom crossings
     up rather than branching per frame. */
  const [zoomed, setZoomed] = React.useState(false)
  const setZoom = React.useCallback((z: boolean) => {
    setZoomed(z)
    onZoomChanged(z)
  }, [onZoomChanged])

  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = Math.max(1, Math.min(4, savedScale.value * e.scale)) })
    .onEnd(() => {
      savedScale.value = scale.value
      if (scale.value <= 1.02) {
        scale.value = withSpring(1, spring)
        savedScale.value = 1
        tx.value = withSpring(0, spring); ty.value = withSpring(0, spring)
        savedX.value = 0; savedY.value = 0
        runOnJS(setZoom)(false)
      } else {
        runOnJS(setZoom)(true)
      }
    })

  /* At rest the horizontal axis belongs to the pager, and the offsets are
     what tell gesture-handler so — an unconstrained pan claims the touch on
     the first pixel, writes only Y, and a swipe to the next photo moves
     nothing. */
  const dismissPan = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-14, 14])
    .failOffsetX([-24, 24])
    .onUpdate(e => { ty.value = e.translationY })
    .onEnd(e => {
      if (Math.abs(e.translationY) > 120) { runOnJS(onDismiss)(); return }
      ty.value = withSpring(0, spring)
    })

  /* While zoomed a pan is a pan around the image, both axes; the parent has
     released the pager. */
  const zoomPan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate(e => {
      tx.value = savedX.value + e.translationX
      ty.value = savedY.value + e.translationY
    })
    .onEnd(() => { savedX.value = tx.value; savedY.value = ty.value })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (!ok) return
      const next = scale.value > 1 ? 1 : 2
      scale.value = withTiming(next, { duration: zoomMs })
      savedScale.value = next
      if (next === 1) { tx.value = withTiming(0); ty.value = withTiming(0); savedX.value = 0; savedY.value = 0 }
      runOnJS(setZoom)(next > 1)
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_e, ok) => { if (ok) runOnJS(onToggleChrome)() })

  const gesture = Gesture.Simultaneous(pinch, dismissPan, zoomPan, Gesture.Exclusive(doubleTap, singleTap))

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))
  const backdrop = useAnimatedStyle(() => ({
    opacity: scale.value > 1 ? 1 : Math.max(0.2, 1 - Math.abs(ty.value) / 400),
  }))

  if (media.kind === 'VIDEO' || media.kind === 'VIDEO_NOTE') return <VideoPage uri={media.url} width={width} height={height} active={active} />

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, backdrop]}>
        <Animated.View style={anim}>
          <RemoteImage
            source={media.url}
            /* Moderation can delete the asset after the bubble was sent — a
               black page with only a close button reads as a hang. */
            fallback="overlay"
            fallbackIcon="image"
            fallbackIconSize={32}
            fallbackLabel="Image unavailable"
            style={{ width, height: height * 0.8 }}
            contentFit="contain"
            transition={160}
            cachePolicy="memory-disk"
            /* The grid/bubble cached the thumbnail — paint it under the
               full-res fetch instead of a black beat. */
            placeholder={media.thumbnailUrl ? { uri: media.thumbnailUrl } : undefined}
            placeholderContentFit="contain"
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}

function VideoPage({
  uri, width, height, active,
}: { uri: string; width: number; height: number; active: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = false })
  /* Pause on deactivation ONLY — unlike the post viewer these clips carry
     native controls and are started by hand, so swiping back to one must not
     restart it. Without the pause, attachment 1 keeps talking from a page you
     can no longer see and there is no control left to stop it. */
  React.useEffect(() => {
    if (active) return
    try { player.pause() } catch { /* released */ }
  }, [active, player])
  return (
    <View style={styles.page}>
      <VideoView
        player={player}
        style={{ width, height: height * 0.8 }}
        contentFit="contain"
        /* SDK 57 replaced the `allowsFullscreen` boolean with an options
           object — the fullscreen button is `fullscreenOptions.enable`. */
        fullscreenOptions={{ enable: true }}
        nativeControls
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.sm, paddingBottom: space.sm2,
  },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.md2, paddingTop: space.sm2, gap: space.sm2,
  },
  caption: {},
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  filmstrip: { flexDirection: 'row', gap: space.xs2, height: 44 },
  thumb: { width: 44, height: 44, borderRadius: 8, borderWidth: 2, overflow: 'hidden' },
})
