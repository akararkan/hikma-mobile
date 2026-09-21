/* =========================================================
   Figures.

   Reads `mediaFiles` filtered to IMAGE, never the detail's
   `figures` array: `figures[].bg` is a CSS background string
   the web client dropped into a style attribute, and it has no
   id, so it cannot address the download endpoint either.

   Order comes from the media row's displayOrder, not from
   array position — the two diverge as soon as the researcher
   reorders anything.
   ========================================================= */
import React from 'react'
import { FlatList, Modal, StyleSheet, View, useWindowDimensions, Linking, Share } from 'react-native'
import { Image } from 'expo-image'
import { RemoteImage } from '@/components/media/RemoteImage'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, EmptyState, Header, Icon, IconButton, Screen, ScreenScroll, Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ErrorPanel } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { MediaFile } from '@/components/research/types'

export default function FiguresScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()

  const { detail, error, loading, reload } = useResearchDetail(id, { subscribe: false, recordView: false })
  const [viewer, setViewer] = React.useState<number | null>(null)
  const menu = useSheetState<MediaFile>()

  const figures = React.useMemo(
    () => (detail?.mediaFiles || []).filter(m => m.type === 'IMAGE').sort((a, b) => a.order - b.order),
    [detail],
  )

  const saveImage = async (file: MediaFile) => {
    try {
      const res: any = await api.research.download(id, file.id)
      if (res?.url) await Linking.openURL(res.url)
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  /* recordShare only after a COMPLETED OS share — a dismissed sheet is not a
     share, and the preview link came from shareUrl without a bump. */
  const sharePaper = async () => {
    const res = await Share.share({ message: `${detail?.title ?? ''} ${detail?.shareUrl ?? ''}`.trim() })
    if (detail?.shareUrl && res.action === Share.sharedAction) {
      void Promise.resolve(api.research.recordShare(id)).catch(() => {})
    }
  }

  const colWidth = (width - 16 * 2 - 8) / 2
  const columns: MediaFile[][] = [[], []]
  figures.forEach((f, i) => columns[i % 2].push(f))

  return (
    <Screen>
      <Header back title={`Figures${figures.length ? ` · ${figures.length}` : ''}`} />

      {loading ? (
        <View style={styles.grid}>
          {[0, 1].map(col => (
            <View key={col} style={{ width: colWidth, gap: space.sm }}>
              {[0, 1, 2].map(i => (
                <Skeleton key={i} height={col === 0 ? (i % 2 ? 150 : 200) : (i % 2 ? 190 : 140)} radius={10} />
              ))}
            </View>
          ))}
        </View>
      ) : error ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : !figures.length ? (
        <EmptyState
          icon="image"
          title="This paper has no figures."
          actionLabel="See all files"
          onAction={() => router.replace(to(`/research/${id}/files`))}
        />
      ) : (
        <ScreenScroll contentContainerStyle={styles.gridScroll}>
          <View style={styles.grid}>
            {columns.map((col, ci) => (
              <View key={ci} style={{ width: colWidth, gap: space.sm }}>
                {col.map(fig => {
                  const ratio = fig.width && fig.height ? fig.width / fig.height : 4 / 3
                  const index = figures.indexOf(fig)
                  return (
                    <Touchable
                      key={fig.id}
                      onPress={() => setViewer(index)}
                      onLongPress={() => menu.open(fig)}
                      feedback="scale"
                      noAutoHitSlop
                      style={[styles.tile, { height: colWidth / ratio }]}
                    >
                      <FigureImage uri={fig.url} caption={fig.caption} />
                      <View style={[styles.tileScrim, { backgroundColor: c.overlayChip }]}>
                        {/* `micro` uppercases Latin inside the Text primitive
                            — writing the caps by hand would also hit Arabic. */}
                        <Text variant="micro" color={c.overlayText}>Fig. {index + 1}</Text>
                        {fig.caption ? (
                          <Text variant="caption" color={c.overlayText} numberOfLines={1} style={styles.flex}>
                            {fig.caption}
                          </Text>
                        ) : null}
                      </View>
                    </Touchable>
                  )
                })}
              </View>
            ))}
          </View>
        </ScreenScroll>
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.caption || menu.payload?.name}
        actions={[
          {
            label: 'Save image',
            icon: 'download',
            /* Routing through the endpoint is what keeps the download counter
               honest — and when downloads are off, the option is simply gone. */
            hidden: !detail?.downloadsEnabled,
            onPress: () => { if (menu.payload) void saveImage(menu.payload) },
          },
          {
            label: 'Share',
            icon: 'share',
            onPress: () => { void sharePaper() },
          },
        ]}
      />

      {viewer != null ? (
        <FigureViewer
          figures={figures}
          initial={viewer}
          title={detail?.title || ''}
          shareUrl={detail?.shareUrl || null}
          onShared={() => { void Promise.resolve(api.research.recordShare(id)).catch(() => {}) }}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </Screen>
  )
}

function FigureImage({ uri, caption }: { uri: string | null; caption?: string }) {
  const t = useTheme()
  const [failed, setFailed] = React.useState(false)
  if (!uri || failed) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.broken, { backgroundColor: t.colors.surfaceSunken }]}>
        <Icon name="image" size={22} color={t.colors.textFaint} />
        {caption ? <Text variant="caption" tone="faint" align="center" numberOfLines={2}>{caption}</Text> : null}
      </View>
    )
  }
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      recyclingKey={uri}
      onError={() => setFailed(true)}
    />
  )
}

/* ---------------------------------------------------------
   The pager. Pinch and double-tap zoom to 4x, pan while
   zoomed, swipe down to dismiss, and one tap toggles the
   chrome. The index lives in a ref as well as state so a
   rotation does not lose the position.
   --------------------------------------------------------- */

function FigureViewer({
  figures, initial, title, shareUrl, onShared, onClose,
}: {
  figures: MediaFile[]
  initial: number
  title: string
  shareUrl: string | null
  /** Called after a COMPLETED OS share — the parent records it. */
  onShared: () => void
  onClose: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = React.useState(initial)
  const indexRef = React.useRef(initial)
  const [chrome, setChrome] = React.useState(true)

  const current = figures[index]

  /* Stable handlers and one stable renderItem: rebuilding it on every chrome
     toggle would re-render — and re-register the gestures of — every mounted
     page of the pager. */
  const toggleChrome = useEvent(() => setChrome(v => !v))
  const dismiss = useEvent(() => onClose())
  const getItemLayout = React.useCallback(
    (_: unknown, i: number) => ({ length: width, offset: width * i, index: i }),
    [width],
  )
  const onMomentumEnd = useEvent((e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width)
    indexRef.current = i
    setIndex(i)
  })
  const renderPage = React.useCallback(({ item }: { item: MediaFile }) => (
    <ZoomPage uri={item.url} width={width} height={height} onTap={toggleChrome} onDismiss={dismiss} />
  ), [width, height, toggleChrome, dismiss])

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.viewer, { backgroundColor: c.overlayBg }]}>
        <FlatList
          data={figures}
          horizontal
          pagingEnabled
          initialScrollIndex={initial}
          getItemLayout={getItemLayout}
          keyExtractor={pageKey}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={renderPage}
        />

        {chrome ? (
          <>
            <View style={[styles.viewerTop, { top: insets.top + 8 }]}>
              <IconButton name="close" onPress={onClose} accessibilityLabel="Close" color={c.overlayText} size={24} />
              <Text variant="subhead" color={c.overlayText} align="center" style={styles.flex}>
                {index + 1} / {figures.length}
              </Text>
              <IconButton
                name="share"
                onPress={() => {
                  void Share.share({ message: `${title} ${shareUrl ?? ''}`.trim() }).then(res => {
                    if (shareUrl && res.action === Share.sharedAction) onShared()
                  })
                }}
                accessibilityLabel="Share"
                color={c.overlayText}
                size={22}
              />
            </View>
            {current?.caption || current?.altText ? (
              <View style={[styles.viewerBottom, { bottom: insets.bottom + 24 }]}>
                {current.caption ? (
                  <Text variant="callout" color={c.overlayText} align="auto">{current.caption}</Text>
                ) : null}
                {current.altText ? (
                  <Text variant="caption" color={c.overlayTextMuted} align="auto" style={{ marginTop: space.xs }}>
                    {current.altText}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  )
}

const pageKey = (f: MediaFile) => String(f.id)

function ZoomPageBase({
  uri, width, height, onTap, onDismiss,
}: { uri: string | null; width: number; height: number; onTap: () => void; onDismiss: () => void }) {
  const t = useTheme()
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  /* GestureDetector diffs the composed gesture by handler identity, so four
     freshly-built Gesture objects per render means re-registering the whole
     config with the native module. The fix here is the React.memo below plus
     useEvent-stable callbacks: with every prop stable this component simply
     does not re-render, so the gestures are built once per mount. (Wrapping
     the four builders in useMemo instead would trip react-hooks/immutability
     eighteen times — a memo body may not mutate the shared values these
     worklets close over.) */
  const tap = useEvent(onTap)
  const dismiss = useEvent(onDismiss)
  const composed = (() => {
    const pinch = Gesture.Pinch()
      .onUpdate(e => { scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale)) })
      .onEnd(() => {
        savedScale.value = scale.value
        if (scale.value <= 1.02) { scale.value = withSpring(1); x.value = withSpring(0); y.value = withSpring(0); savedScale.value = 1; savedX.value = 0; savedY.value = 0 }
      })

    /* Captured in JS — t.ms cannot run inside a worklet. */
    const zoomMs = t.ms(180)
    const pan = Gesture.Pan()
      .onUpdate(e => {
        if (scale.value > 1) { x.value = savedX.value + e.translationX; y.value = savedY.value + e.translationY }
        else y.value = e.translationY
      })
      .onEnd(e => {
        if (scale.value > 1) { savedX.value = x.value; savedY.value = y.value; return }
        /* Only a downward flick at 1x dismisses — otherwise a pan while zoomed
           would close the viewer under the user's finger. */
        if (e.translationY > 120 || e.velocityY > 900) { runOnJS(dismiss)(); return }
        y.value = withSpring(0)
      })

    const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
      const next = scale.value > 1 ? 1 : 2.5
      scale.value = withTiming(next, { duration: zoomMs })
      savedScale.value = next
      if (next === 1) { x.value = withTiming(0); y.value = withTiming(0); savedX.value = 0; savedY.value = 0 }
    })

    const singleTap = Gesture.Tap().numberOfTaps(1).onEnd(() => { runOnJS(tap)() })

    return Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, singleTap, pan))
  })()

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={style}>
          {/* Same URI the grid tile already warmed with `memory-disk`.
              Disk-only here would re-read and re-decode the full figure on
              every swipe past it, throwing away the entry sitting in memory. */}
          {uri ? (
            /* The grid tile shows a placeholder for a dead figure — zooming
               into it must not degrade to a blank pager page. */
            <RemoteImage
              source={uri}
              fallback="overlay"
              fallbackIcon="image"
              fallbackIconSize={32}
              fallbackLabel="Image unavailable"
              style={{ width, height: height * 0.8 }}
              contentFit="contain"
              transition={140}
              cachePolicy="memory-disk"
              recyclingKey={uri}
            />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const ZoomPage = React.memo(ZoomPageBase)

const styles = StyleSheet.create({
  gridScroll: { paddingBottom: space.huge },
  grid: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  tile: { width: '100%', borderRadius: 10, overflow: 'hidden' },
  tileScrim: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.sm, paddingVertical: space.xs2,
  },
  broken: { alignItems: 'center', justifyContent: 'center', gap: space.xs2, padding: space.sm },
  viewer: { flex: 1 },
  viewerTop: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm,
  },
  viewerBottom: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.xl },
  flex: { flex: 1 },
})
