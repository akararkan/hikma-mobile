/* =========================================================
   InAppBanner — the foreground pop-up notification.

   The OS shows banners for BACKGROUND arrivals (pushNotify.ts);
   in the foreground the app used to answer with a haptic and
   nothing visual — a message could land while you browsed the
   feed and leave no trace but a badge. This strip is that
   missing surface: a quiet drop-down under the status bar with
   the sender and a one-line preview. Tap opens the source,
   swipe up dismisses, and it leaves on its own after a beat.

   One slot, latest wins — a burst of messages must not stack a
   tower of chrome over the screen (the badge already counts
   them). The module-level sink mirrors Toast.tsx: providers can
   post from outside React; before the host mounts, posts drop —
   a banner with no screen has missed its moment.

   Deliberately BELOW the call strip in z: a ring outranks a
   preview, and both can be up at once.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { announce } from '@/theme/announce'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, type IconName } from '@/ui'

export interface BannerItem {
  /** Replaces the current banner when the key matches (same conversation's
   *  next message updates in place rather than re-animating). */
  key: string
  kind: 'message' | 'notification'
  title: string
  body?: string | null
  avatar?: string | null
  /** Monogram seed when there is no avatar — usually the sender/convo id. */
  seed?: string | null
  href?: string | null
}

type Sink = (item: BannerItem) => void
let sink: Sink | null = null

/** Post a foreground banner. Safe from any module; drops before mount. */
export function showInAppBanner(item: BannerItem) {
  if (!item?.title) return
  sink?.(item)
}

const SHOW_MS = 4200
/** Released past this much upward travel = dismissed. */
const FLICK = -26

export function InAppBannerHost() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [item, setItem] = React.useState<BannerItem | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const ty = useSharedValue(-120)
  const held = React.useRef(false)

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  const leave = React.useCallback(() => {
    clearTimer()
    if (t.prefs.reducedMotion) { setItem(null); return }
    ty.value = withTiming(-130, { duration: 160 }, done => { if (done) runOnJS(setItem)(null) })
  }, [t.prefs.reducedMotion, ty])

  const arm = React.useCallback((ms: number) => {
    clearTimer()
    timer.current = setTimeout(() => { if (!held.current) leave() }, ms)
  }, [leave])

  React.useEffect(() => {
    sink = (next: BannerItem) => {
      setItem(prev => {
        /* Fresh identity re-drops the strip; the same key just swaps copy —
           three fast messages from one thread read as one live banner. */
        if (!prev || prev.key !== next.key) {
          ty.value = t.prefs.reducedMotion ? 0 : -120
          ty.value = t.prefs.reducedMotion ? 0 : withSpring(0, t.motion.sheetSpring)
        }
        return next
      })
      arm(SHOW_MS)
      /* The strip's live region covers Android; iOS needs to be told, and a
         banner that drops in behind VoiceOver's focus is otherwise a haptic
         and nothing else — the exact silence this component exists to end.
         Copy only: the "tap to open" hint belongs to the press target, which
         reads it when the user actually swipes there. */
      announce(next.body ? `${next.title}. ${next.body}` : next.title)
    }
    return () => { sink = null; clearTimer() }
  }, [arm, t.prefs.reducedMotion, t.motion, ty])

  React.useEffect(() => () => clearTimer(), [])

  /* Upward drags only — activeOffsetY keeps taps for the Touchable and never
     claims a downward pull. All motion on the UI thread. */
  const pan = React.useMemo(() => Gesture.Pan()
    .activeOffsetY(-10)
    .onUpdate(e => { ty.value = Math.min(0, e.translationY) })
    .onEnd(e => {
      if (e.translationY < FLICK) {
        ty.value = withTiming(-130, { duration: 140 }, done => { if (done) runOnJS(setItem)(null) })
      } else {
        ty.value = withSpring(0, t.motion.spring)
      }
    }), [ty, t.motion.spring])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
    opacity: 1 + ty.value / 130,
  }))

  if (!item) return null

  const icon: IconName = item.kind === 'message' ? 'chat' : 'bell'
  const open = () => {
    const href = item.href
    setItem(null)
    clearTimer()
    if (href) router.push(href as any)
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.wrap, { top: insets.top + 6, zIndex: t.zIndex.banner }, style]}>
        <Touchable
          onPress={open}
          onPressIn={() => { held.current = true; clearTimer() }}
          onPressOut={() => { held.current = false; arm(1400) }}
          feedback="scale"
          noAutoHitSlop
          accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${item.body || ''}. Tap to open, swipe up to dismiss.`}
          /* Unprompted chrome over whatever the user was reading: it has to
             announce itself rather than wait to be found. Polite — a preview
             is news, not an interruption. */
          accessibilityLiveRegion="polite"
          /* Raised chrome over arbitrary screens: fenced by a stone course +
             one quiet slate shadow — this is floating chrome, not a list row. */
          style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.borderStrong }, t.shadow(2)]}
        >
          <Avatar uri={item.avatar ?? null} name={item.title} seed={item.seed ?? item.key} size={36} />
          <View style={styles.body}>
            <Text variant="footnote" weight="700" align="ui" numberOfLines={1}>{item.title}</Text>
            {item.body ? (
              <Text variant="caption" tone="muted" align="auto" numberOfLines={1}>{item.body}</Text>
            ) : null}
          </View>
          <Icon name={icon} size={16} color={c.textFaint} />
        </Touchable>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.md, paddingVertical: space.sm2,
    borderRadius: 16, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: space.xxs },
})
