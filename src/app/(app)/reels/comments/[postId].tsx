/* =========================================================
   Comments, as a route.

   A modal ROUTE rather than a sheet component so the thread is
   deep-linkable from a notification and so Android's hardware
   back dismisses it for free. The reel stays mounted and
   visible behind the backdrop; the pager pauses it, because
   this panel covers 88% of the screen and audio from a clip
   nobody can see is just noise.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { ReelCommentsSheet } from '@/components/reels/ReelCommentsSheet'
import { STAGE } from '@/components/reels/skin'
import { shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { Touchable } from '@/ui'

const PANEL_RATIO = 0.88

export default function ReelCommentsRoute() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { postId } = useLocalSearchParams<{ postId: string }>()

  const panelHeight = height * PANEL_RATIO
  const translateY = useSharedValue(panelHeight)
  const backdrop = useSharedValue(0)

  const dismiss = React.useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/(tabs)/reels')
  }, [router])

  React.useEffect(() => {
    backdrop.value = withTiming(1, { duration: t.ms(220) })
    translateY.value = t.prefs.reducedMotion ? 0 : withSpring(0, t.motion.sheetSpring)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Only the grab handle drags. A pan on the panel body would fight the
     comment list's own scroll, and losing a half-typed reply to a stray
     downward flick is unforgivable.

     Memoized because GestureDetector re-registers its whole config with the
     native module whenever the handler identity changes — and this panel
     re-renders on every frame the comment list pushes into it. */
  /* Captured in JS — t.ms cannot run inside the worklet below. */
  const dismissMs = t.ms(180)
  const drag = React.useMemo(() => Gesture.Pan()
    .onUpdate(e => { translateY.value = Math.max(0, e.translationY) })
    .onEnd(e => {
      if (e.translationY > 120 || e.velocityY > 900) {
        translateY.value = withTiming(panelHeight, { duration: dismissMs })
        runOnJS(dismiss)()
      } else {
        translateY.value = withSpring(0, t.motion.sheetSpring)
      }
    }), [translateY, panelHeight, dismiss, dismissMs, t.motion.sheetSpring])

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }))

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Touchable onPress={dismiss} feedback="none" noAutoHitSlop accessibilityLabel="Close comments" style={StyleSheet.absoluteFill}>
          <View />
        </Touchable>
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          { height: panelHeight, paddingBottom: Math.max(insets.bottom, 8) },
          panelStyle,
        ]}
      >
        <GestureDetector gesture={drag}>
          <View style={styles.handleZone} collapsable={false}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>

        {postId ? (
          <ReelCommentsSheet postId={postId} onClose={dismiss} />
        ) : null}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: STAGE.sheet,
    /* The sheet setback's crown — 18/0, the same as every other sheet in the
       app (DESIGN.md §3). */
    borderTopLeftRadius: shape.sheet.top,
    borderTopRightRadius: shape.sheet.top,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  handleZone: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: STAGE.fgGhost },
})
