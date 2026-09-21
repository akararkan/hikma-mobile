/* =========================================================
   The fullscreen story viewer.

   The screen owns three things and delegates everything else
   to StoryAuthorPage: which authors are in the deck, the cube
   between them, and the drag that closes the whole stack.

   The deck is frozen at mount on purpose. The tray is live —
   an author posting mid-view would otherwise reshuffle the
   pages under a finger that is already mid-swipe.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate, runOnJS, useAnimatedStyle, useEvent, useHandler, useSharedValue, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import PagerView from 'react-native-pager-view'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { StoryAuthorPage } from '@/components/stories/StoryAuthorPage'
import { BLACK } from '@/components/stories/night'
import { traySnapshot, type TrayEntry } from '@/components/stories/trayStore'
import { isStoryUnseen } from '@/lib/storySeen'

const AnimatedPager = Animated.createAnimatedComponent(PagerView)

interface Deck { authorId: string; author: TrayEntry['author'] | null }

export default function StoryViewerScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { width, height } = useWindowDimensions()
  const { authorId, source, storyId } = useLocalSearchParams<{ authorId: string; source?: string; storyId?: string }>()

  const pager = React.useRef<PagerView>(null)

  /* Frozen at mount — see the note at the top. */
  const [deck] = React.useState<Deck[]>(() => {
    const id = String(authorId || '')
    const tray = traySnapshot()
    if (source === 'tray' && tray.some(e => String(e.authorId) === id)) {
      /* The RAIL'S comparator (unseen first, then newest): the deck's
         left/right order must match the visual order the reader just tapped,
         or "next author" jumps to a tile three places back. */
      const ordered = [...tray].sort((a, b) => {
        const ua = isStoryUnseen(a.authorId, a.at)
        const ub = isStoryUnseen(b.authorId, b.at)
        return ua === ub ? b.at - a.at : ua ? -1 : 1
      })
      return ordered.map(e => ({ authorId: String(e.authorId), author: e.author }))
    }
    const known = tray.find(e => String(e.authorId) === id)
    return [{ authorId: id, author: known?.author ?? null }]
  })
  const [initialPage] = React.useState(() => Math.max(0, deck.findIndex(d => d.authorId === String(authorId))))
  const [page, setPage] = React.useState(initialPage)
  const [enterEndFor, setEnterEndFor] = React.useState<string | null>(null)

  const close = React.useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/(tabs)')
  }, [router])

  const goTo = React.useCallback((next: number) => {
    if (next < 0 || next >= deck.length) { close(); return }
    pager.current?.setPage(next)
    setPage(next)
  }, [close, deck.length])

  /* ---- the cube ------------------------------------------------------ */
  const scroll = useSharedValue(initialPage)
  const scrollHandler = usePageScrollHandler({
    onPageScroll: (e: any) => {
      'worklet'
      scroll.value = e.position + e.offset
    },
  })

  /* ---- drag to dismiss ----------------------------------------------- */
  const drag = useSharedValue(0)
  const [dragging, setDragging] = React.useState(false)

  /* Memoized on the three things the worklets close over. GestureDetector
     diffs by handler identity, so an object rebuilt on every page change or
     drag flag would re-register this gesture with the native module mid-swipe
     — on the one gesture the whole screen is judged on. */
  /* Captured in JS — t.ms cannot run inside a worklet. */
  const dismissMs = t.ms(180)
  const pan = React.useMemo(() => Gesture.Pan()
    .activeOffsetY(24)
    .failOffsetX([-24, 24])
    .onBegin(() => { runOnJS(setDragging)(true) })
    .onUpdate(e => { drag.value = Math.max(0, e.translationY) })
    .onEnd(e => {
      if (e.translationY > 90 || e.velocityY > 900) {
        drag.value = withTiming(height, { duration: dismissMs })
        runOnJS(close)()
      } else {
        drag.value = withSpring(0, t.motion.sheetSpring)
        runOnJS(setDragging)(false)
      }
    }),
  [drag, height, close, dismissMs, t.motion.sheetSpring])

  const shellStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: drag.value },
      { scale: 1 - Math.min(0.2, drag.value / 1200) },
    ],
    borderRadius: interpolate(drag.value, [0, 220], [0, 24], 'clamp'),
  }))

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drag.value, [0, 260], [1, 0.4], 'clamp'),
  }))

  return (
    <View style={[styles.fill, { backgroundColor: BLACK }]}>
      <StatusBar hidden style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }, backdropStyle]} pointerEvents="none" />

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, styles.clip, shellStyle]}>
          <AnimatedPager
            ref={pager}
            style={styles.fill}
            initialPage={initialPage}
            orientation="horizontal"
            overdrag
            onPageSelected={e => { setPage(e.nativeEvent.position); setEnterEndFor(null) }}
            onPageScroll={scrollHandler as any}
          >
            {deck.map((d, i) => (
              <View key={d.authorId} collapsable={false} style={styles.fill}>
                <CubeFace index={i} scroll={scroll} width={width} reduced={t.prefs.reducedMotion}>
                  <StoryAuthorPage
                    authorId={d.authorId}
                    active={i === page && !dragging}
                    /* One page either side, and no further. PagerView mounts
                       every face at once; without this the whole tray issues a
                       by-author read and builds a video player at open, and the
                       frame the user actually asked for queues behind twenty it
                       will never show. Neighbours stay warm because the cube
                       reveals them mid-swipe. */
                    prefetch={Math.abs(i - page) === 1}
                    startStoryId={i === initialPage ? (storyId ?? null) : null}
                    enterAtEnd={enterEndFor === d.authorId}
                    trayAuthor={d.author}
                    viewerId={user?.id ? String(user.id) : null}
                    paused={dragging}
                    onClose={close}
                    onNextAuthor={() => goTo(i + 1)}
                    onPrevAuthor={() => {
                      if (i === 0) return
                      setEnterEndFor(deck[i - 1].authorId)
                      goTo(i - 1)
                    }}
                  />
                </CubeFace>
              </View>
            ))}
          </AnimatedPager>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

/* ---------------------------------------------------------
   One face of the cube. A page that is not the current one
   rotates about the screen's vertical axis and darkens, which
   is what makes a horizontal swipe read as turning a solid
   rather than sliding a card.
   --------------------------------------------------------- */

function CubeFace({
  index, scroll, width, reduced, children,
}: {
  index: number
  scroll: SharedValue<number>
  width: number
  reduced: boolean
  children: React.ReactNode
}) {
  const face = useAnimatedStyle(() => {
    if (reduced) return {}
    const rel = Math.max(-1, Math.min(1, scroll.value - index))
    return {
      transform: [
        { perspective: 1000 },
        { rotateY: `${rel * 55}deg` },
        { scale: 1 - Math.abs(rel) * 0.12 },
        /* Nudge the face toward the edge it hinges on. */
        { translateX: rel * width * 0.08 },
      ],
    }
  })

  const shadow = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0 }
    return { opacity: Math.min(0.35, Math.abs(scroll.value - index) * 0.7) }
  })

  return (
    <Animated.View style={[styles.fill, face]}>
      {children}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BLACK }, shadow]} pointerEvents="none" />
    </Animated.View>
  )
}

/* PagerView's scroll event is a native event, not a Reanimated one, so it needs
   the documented useEvent/useHandler bridge to run as a worklet. Driving the
   cube from a JS callback would put a 60Hz bridge hop in the middle of the one
   gesture the whole screen is judged on. */
function usePageScrollHandler(handlers: Record<string, (e: any) => void>, deps: unknown[] = []) {
  const { doDependenciesDiffer } = useHandler(handlers as any, deps as any)
  return useEvent<any>(
    event => {
      'worklet'
      const { onPageScroll } = handlers
      if (onPageScroll && event.eventName.endsWith('onPageScroll')) onPageScroll(event)
    },
    ['onPageScroll'],
    doDependenciesDiffer,
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: 'hidden' },
})
