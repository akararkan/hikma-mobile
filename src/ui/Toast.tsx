/* =========================================================
   Toast — the transient, non-blocking message.

   Two entry points on purpose:

     showToast(msg, tone)   from anywhere, including modules
                            that must not import React
     flashToast(...)        the api layer's existing call,
                            which platform/toast.js routes here

   The api layer already calls `flashToast` on a 429 and on a
   deprecated endpoint, so registering the handler at the app
   shell is what makes those years-old call sites light up
   without touching them.

   Toasts stack downward from the top under the safe area, cap
   at three, and are swipe-dismissable. Errors hold longer than
   confirmations because they are read, not glanced at.

   QELAT (DESIGN.md §6 Toast): the CLAY TABLET — a setback
   ink plate whose start-edge selvedge IS the countdown. The
   selvedge drains top-to-bottom across the lifetime (§7.8),
   pauses while a finger rests on the tablet, and the row —
   not the host — owns the clock, because only the row knows
   when it is being touched.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInUp, FadeOut, FadeOutUp, LinearTransition,
  runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/ThemeProvider'
import { announce } from '@/theme/announce'
import { darkPalette } from '@/theme/colors'
import { getOsA11y } from '@/theme/osA11y'
import { motion, setback, space } from '@/theme/tokens'
import { setToastHandler } from '@/platform/toast'
import { Text } from './Text'
import { Icon, type IconName } from './Icon'
import { Selvedge } from './ornaments'
import { Touchable, fireHaptic } from './Touchable'

/* The masonry curve — fast arrival, dead stop (§7). Built once at module
   scope so worklets capture a plain factory, not the theme object. */
const masonry = Easing.bezier(...motion.out)

export type ToastTone = 'ok' | 'warn' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  /** An inline affordance — "Undo" after a delete, "View" after a send. */
  action?: { label: string; onPress: () => void }
  duration: number
}

type Emitter = (t: Omit<ToastItem, 'id'>) => void

/* A module-level sink so non-React code can post. The host registers itself
   on mount; before that, posts are dropped rather than queued — a toast that
   arrives before there is a screen to show it has already missed its moment. */
let sink: Emitter | null = null

/* THE READING FLOOR. A screen-reader user has to REACH the tablet before it
   can be read — VoiceOver's focus does not jump to a plate that just
   appeared — and 3000ms is under the time that swipe takes, so an ok toast
   would vanish mid-sentence. Like the drain itself this is a clock, not
   decoration, so it does NOT go through t.ms(); and it reads the phone's
   state from osA11y (DESIGN.md §7), never AccessibilityInfo. A floor only
   ever lengthens, so a caller's explicit duration still holds otherwise. */
function lifetime(ms: number): number {
  return getOsA11y().screenReader ? Math.max(ms, 8000) : ms
}

export function showToast(
  message: string,
  tone: ToastTone = 'info',
  opts: { action?: ToastItem['action']; duration?: number } = {},
) {
  if (!message) return
  sink?.({
    message: String(message),
    tone,
    action: opts.action,
    duration: lifetime(opts.duration ?? (tone === 'error' ? 5200 : tone === 'warn' ? 4200 : 3000)),
  })
}

/** Convenience wrappers, so call sites read as intent. */
export const toast = {
  ok: (m: string, action?: ToastItem['action']) => showToast(m, 'ok', { action }),
  info: (m: string, action?: ToastItem['action']) => showToast(m, 'info', { action }),
  warn: (m: string, action?: ToastItem['action']) => showToast(m, 'warn', { action }),
  error: (m: string, action?: ToastItem['action']) => showToast(m, 'error', { action }),
}

let seq = 0

export function ToastHost() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [items, setItems] = React.useState<ToastItem[]>([])

  /* No host-side timer: each row's SELVEDGE DRAIN is the clock, so the
     countdown can pause under a resting finger (§7.8). */
  const dismiss = React.useCallback((id: number) => {
    setItems(list => list.filter(i => i.id !== id))
  }, [])

  React.useEffect(() => {
    const emit: Emitter = (item) => {
      const id = ++seq
      const full: ToastItem = { ...item, id }
      setItems(list => [...list, full].slice(-3))
      if (item.tone === 'error') fireHaptic('error')
      else if (item.tone === 'ok') fireHaptic('success')
      /* The plate's live region covers Android; iOS needs to be told. */
      announce(item.message)
    }
    sink = emit
    /* Route the api layer's existing flashToast() into the same queue. */
    setToastHandler((msg: string, tone: string) => emit({
      message: msg,
      tone: (tone === 'ok' ? 'ok' : tone === 'error' ? 'error' : 'warn') as ToastTone,
      duration: lifetime(tone === 'error' ? 5200 : 4200),
    }))
    return () => {
      sink = null
      setToastHandler(null as any)
    }
  }, [])

  /* The host stays mounted even when the queue is empty: unmounting it
     with the final tablet would tear that tablet out mid-exit and the last
     toast would pop where every other one fades. An empty box-none View
     draws nothing and intercepts nothing. */
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 6, zIndex: t.zIndex.toast }]}
    >
      {items.map(item => (
        <ToastRow key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </View>
  )
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const t = useTheme()
  const c = t.colors
  const dx = useSharedValue(0)
  const dy = useSharedValue(0)
  /* SELVEDGE DRAIN (§7.8): fraction of lifetime remaining. Deliberately NOT
     gated by t.ms() — this is the toast's clock, not decoration, and reduced
     motion must not shorten how long a message stays readable. */
  const drain = useSharedValue(1)
  const dismissing = useSharedValue(false)
  const snapMs = t.ms(motion.fast)

  /* The CLAY TABLET (DESIGN.md §6 Toast): every tone shares one plate —
     light = text-colour ink tablet with textInverse copy; dark = raised
     surface with a drawn borderStrong course and text ink. The tone lives
     entirely in the start-edge selvedge, whose height IS the countdown. */
  const dark = c.scheme === 'dark'
  const plate = dark
    ? { backgroundColor: c.surfaceRaised, borderWidth: t.rule.course, borderColor: c.borderStrong }
    : { backgroundColor: c.text }
  const fg = dark ? c.text : c.textInverse
  /* The light tablet is an INVERSE plate — a piece of the night set on clay —
     so its selvedge hues come from the kiln palette (the light-scheme tones
     are built for clay grounds and sink to ~2:1 on the ink plate). The accent
     tone rides `sky`, the role that exists precisely for accents on dark
     plates. In dark scheme the plate is a native surface and the scheme's own
     hues are already on-plate legible. */
  const kiln = dark ? c : darkPalette
  const tone: Record<ToastTone, { hue: string; icon: IconName }> = {
    ok: { hue: kiln.success, icon: 'success' },
    info: { hue: dark ? c.accentText : c.sky, icon: 'info' },
    warn: { hue: kiln.warning, icon: 'warning' },
    error: { hue: kiln.danger, icon: 'error' },
  }
  const s = tone[item.tone]

  /* Lifetime is fixed at mount; the drain's completion is the dismissal.
     `onDismiss` closes over the host's stable `dismiss`, so the mount-only
     capture stays correct. */
  React.useEffect(() => {
    drain.value = withTiming(0, { duration: item.duration, easing: Easing.linear }, finished => {
      if (finished) runOnJS(onDismiss)()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Deliberately NOT memoized — see the note on Sheet's drag. A toast is one
     short-lived instance, not a recycled row. */
  const swipe = Gesture.Pan()
    /* A resting finger pauses the countdown; letting go resumes it over the
       time the selvedge still shows. Swipe-away cancels it for good. */
    .onBegin(() => { cancelAnimation(drain) })
    .onUpdate(e => { dx.value = e.translationX; dy.value = Math.min(0, e.translationY) })
    .onEnd(e => {
      if (Math.abs(e.translationX) > 90 || e.translationY < -40) {
        dismissing.value = true
        dx.value = withTiming(e.translationX > 0 ? 400 : -400, { duration: snapMs, easing: masonry })
        runOnJS(onDismiss)()
      } else {
        dx.value = withTiming(0, { duration: snapMs, easing: masonry })
        dy.value = withTiming(0, { duration: snapMs, easing: masonry })
      }
    })
    .onFinalize(() => {
      if (dismissing.value) return
      drain.value = withTiming(0, { duration: item.duration * drain.value, easing: Easing.linear }, finished => {
        if (finished) runOnJS(onDismiss)()
      })
    })

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }],
    opacity: 1 - Math.min(1, Math.abs(dx.value) / 240),
  }))
  /* scaleY, not height. The drain runs for the WHOLE lifetime of the tablet —
     three to five seconds of animation on a plate that sits over whatever
     screen the user was already looking at — so an animated height was
     relayouting the toast (and re-measuring its text) on every one of those
     frames. scaleY is the safe conversion here and clip-translate would be
     ceremony: the strip is a plain square-cornered rect, and the setback
     corners belong to the tablet's own overflow:'hidden', so there is no
     radius on the thing being scaled to distort. `transformOrigin: 'bottom'`
     keeps it bottom-anchored, so it still empties from the top downward — the
     tablet visibly runs out of time. The origin is vertical: RTL has nothing
     to mirror, and `start: 0` still puts the selvedge on the reading edge.
     Losing the height also loses the plate's onLayout — the strip no longer
     has to be told how tall the tablet is, so it now spans the padding box
     exactly as `Selvedge` does inside every other card in the app. */
  const drainStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: drain.value }] }))

  return (
    <GestureDetector gesture={swipe}>
      {/* Two views on purpose: entering/exiting/layout animate opacity and
          transform themselves, so they live on this bare wrapper while the
          swipe's animated opacity/transform lives on the plate inside —
          sharing one view makes Reanimated warn that the layout animation
          may overwrite the swipe. */}
      <Animated.View
        /* COURSE SETTLE, adapted from-top: the tablet drops 6pt into place on
           the brick spring — one 1pt over-drop, no float (§7.2). */
        entering={t.prefs.reducedMotion
          ? FadeIn.duration(120)
          : FadeInUp.springify()
              .damping(motion.spring.damping)
              .stiffness(motion.spring.stiffness)
              .mass(motion.spring.mass)
              .withInitialValues({ transform: [{ translateY: -6 }] })}
        exiting={t.prefs.reducedMotion ? FadeOut.duration(120) : FadeOutUp.duration(motion.fast)}
        layout={t.prefs.reducedMotion ? undefined : LinearTransition.duration(motion.normal).easing(masonry)}
      >
      <Animated.View
        /* The tablet is the app's async-result channel, so it has to SPEAK.
           An error interrupts; everything else waits its turn. `accessible`
           groups the plate into one utterance — but only when there is no
           action, because grouping makes the "Undo" inside it unreachable on
           iOS, and an affordance you cannot reach is worse than a two-stop
           announcement. */
        accessible={!item.action}
        accessibilityRole="alert"
        accessibilityLiveRegion={item.tone === 'error' ? 'assertive' : 'polite'}
        accessibilityLabel={item.action ? undefined : item.message}
        style={[styles.toast, setback(t.shape.toast), plate, anim]}
      >
        <Animated.View pointerEvents="none" style={[styles.drainStrip, { width: t.rule.selvedge }, drainStyle]}>
          <Selvedge color={s.hue} />
        </Animated.View>
        <Icon name={s.icon} size={18} color={fg} />
        <Text variant="subhead" color={fg} align="ui" style={styles.flex} numberOfLines={3}>
          {item.message}
        </Text>
        {item.action ? (
          <Touchable
            onPress={() => { onDismiss(); item.action!.onPress() }}
            feedback="dim"
            style={{ paddingHorizontal: space.xs, paddingVertical: space.xxs }}
          >
            <Text variant="subhead" weight="700" color={fg} underline>{item.action.label}</Text>
          </Touchable>
        ) : null}
      </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, gap: space.sm },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.md2,
    paddingVertical: space.md,
    borderCurve: 'continuous',
    overflow: 'hidden',   /* the selvedge must clip to the setback corners */
  },
  /* Full-height and SCALED, not clipped — see the drainStyle note. The origin
     is what makes the strip drain downward instead of from the middle out;
     it is a constant, so it lives here and never rides a frame. */
  drainStrip: { position: 'absolute', start: 0, top: 0, bottom: 0, transformOrigin: 'bottom' },
  flex: { flex: 1 },
})
