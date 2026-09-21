/* =========================================================
   The brand moment — the SEAL OF HIKMAH.

   Three occasions, one stage (lib/brandMoment.ts):

     arrival   the account was created minutes ago;
     welcome   a session began on a phone that knew it;
     farewell  a session ended on purpose.

   WHAT IS ON THE SCREEN, and why it is that and not a logo
   fading in. "Hikmah" is wisdom, and the instrument of the
   scholars who carried it was the ASTROLABE: a disc of rings,
   degree ticks and an eight-point star, drawn in fine lines.
   So the splash builds one. The ticks strike around the rim,
   the two rings close, the eight-point star — two squares at
   45°, the Rub el Hizb — turns into register, and the whole
   plate keeps drifting a few degrees the entire time, the way
   a real disc never quite sits still. Inside it the mark is
   written in RISING INK (ui/Wordmark), and the name is drawn
   out of the letter.

   IT IS ALL TRANSFORMS ON PLAIN VIEWS. Two bordered squares
   make the star, twelve 1pt rules make the rim, two bordered
   circles make the rings; every phase is derived from ONE
   shared value in a worklet, so the whole instrument costs no
   SVG, no shadow, no blur (DESIGN.md §10 forbids all three)
   and nothing that can drop a frame on the JS thread.

   WHY IT IS FOUR SECONDS. This is the only screen in the app
   with nothing to read, and the whole signed-in tree is
   mounting behind it. A quarter-second flash of a logo is not
   a brand moment, it is a stutter.

   UNDER REDUCE-MOTION nothing moves and the seal is still
   SHOWN, resting, for a beat. An accessibility setting asks
   for less motion, not for less product.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue,
} from 'react-native-reanimated'
import { APP_ENDONYMS } from '@/lib/brand'
import type { BrandMomentKind } from '@/lib/brandMoment'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, ramp, space } from '@/theme/tokens'
import { Text, Wordmark } from '@/ui'

/* Pixel-identical to app.json's splash and to the boot gate, so the native
   splash, the boot screen and this all read as ONE surface. */
const GROUND = ramp.brand[900]

/* ---- the timeline, in ms from mount ---------------------------------
   The instrument draws first and the lockup comes up inside it; the
   lockup's own choreography is 1600ms (ui/Wordmark: 660 ink, +380, 560
   word), so everything below is set against it rather than guessed. */
const ROSETTE_MS = 1700
const LOCKUP_DELAY = 460
const LOCKUP_MS = 1600
/** The rule starts just before the last letter lands — it closes the word. */
const RULE_AT = LOCKUP_DELAY + LOCKUP_MS - 120
const RULE_MS = 520
const ENDONYM_AT = 2220
const GREET_AT = 2520
const FADE_MS = 400
/** The beat after the last word lands — this is what makes it a moment. */
const HOLD_MS = 780
const OUT_AT = GREET_AT + FADE_MS + HOLD_MS
const OUT_MS = 540
/** ~4.2s door to door. */
const TOTAL_MS = OUT_AT + OUT_MS
/** Still, but still SEEN, when the phone asks for no motion. */
const STILL_MS = 1600

const ease = Easing.bezier(...motion.out)

export interface WelcomeCurtainProps {
  kind?: BrandMomentKind
  /** The person's first name, when the caller has one. */
  name?: string | null
  onDone: () => void
}

/** The words. A greeting that guesses at a name it does not have reads worse
 *  than one that simply states the brand. */
function copyFor(kind: BrandMomentKind, name?: string | null) {
  if (kind === 'farewell') {
    return { line: 'Signed out', note: 'Your session on this phone has ended.' }
  }
  if (kind === 'arrival') {
    return { line: name ? `Welcome, ${name}` : 'Welcome', note: 'Your account is ready.' }
  }
  return { line: name ? `Welcome back, ${name}` : 'Welcome back', note: null }
}

export function WelcomeCurtain({ kind = 'welcome', name, onDone }: WelcomeCurtainProps) {
  const t = useTheme()
  const still = t.prefs.reducedMotion
  const { line, note } = copyFor(kind, name)

  /* One-shot: the timeline fires it, and an unmount must not re-enter it. */
  const done = React.useRef(false)
  const finish = React.useCallback(() => {
    if (done.current) return
    done.current = true
    onDone()
  }, [onDone])

  /* One shared value per moving part, all started from a single effect so the
     sequence cannot drift between them. */
  const rule = useSharedValue(still ? 1 : 0)
  const endonym = useSharedValue(still ? 1 : 0)
  const greet = useSharedValue(still ? 1 : 0)
  const out = useSharedValue(0)

  React.useEffect(() => {
    if (still) {
      const id = setTimeout(finish, STILL_MS)
      return () => clearTimeout(id)
    }

    rule.value = withDelay(RULE_AT, withTiming(1, { duration: RULE_MS, easing: ease }))
    endonym.value = withDelay(ENDONYM_AT, withTiming(1, { duration: FADE_MS, easing: ease }))
    greet.value = withDelay(GREET_AT, withTiming(1, { duration: FADE_MS, easing: ease }))
    out.value = withDelay(OUT_AT, withTiming(1, { duration: OUT_MS, easing: ease }))

    /* The curtain lifts on the CLOCK, not on an animation's callback. A
       reanimated completion that never arrives — a backgrounded app, a
       remount mid-flight — would strand the reader behind a navy screen with
       the app fully loaded underneath, and that is not a risk a brand moment
       is allowed to take. */
    const id = setTimeout(finish, TOTAL_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still])

  /* The lift: the whole stage rises a little and fades. Scaling UP as it
     leaves is what makes it read as a curtain going away from the reader
     rather than a card being dismissed. */
  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - out.value,
    transform: [{ translateY: out.value * -20 }, { scale: 1 + out.value * 0.05 }],
  }))
  const ruleStyle = useAnimatedStyle(() => ({
    opacity: rule.value,
    transform: [{ scaleX: rule.value }],
  }))
  const endonymStyle = useAnimatedStyle(() => ({
    opacity: endonym.value,
    transform: [{ translateY: (1 - endonym.value) * 8 }],
  }))
  const greetStyle = useAnimatedStyle(() => ({
    opacity: greet.value,
    transform: [{ translateY: (1 - greet.value) * 10 }],
  }))

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: GROUND }, rootStyle]}
      pointerEvents="auto"
    >
      <BrandRosette still={still} exit={out} />

      <View style={styles.stack}>
        {/* The lockup writes itself INSIDE the instrument — the ink rises
            through the letter, then the name is drawn out of it. */}
        <Wordmark size={34} tone="onDark" animate={!still} delay={LOCKUP_DELAY} ground={GROUND} />

        <Animated.View style={[styles.ruleBox, ruleStyle]}>
          <View style={styles.rule} />
        </Animated.View>

        <Animated.View style={endonymStyle}>
          {/* Two right-to-left scripts sharing one line; the Text primitive
              resolves Amiri / Vazirmatn for them on its own. */}
          <Text variant="footnote" color="rgba(255,255,255,0.74)" align="center" style={styles.endonyms}>
            {APP_ENDONYMS.join('  ·  ')}
          </Text>
        </Animated.View>

        <Animated.View style={[styles.greeting, greetStyle]}>
          <Text variant="callout" serif color="rgba(255,255,255,0.95)" align="center">{line}</Text>
          {note ? (
            <Text variant="footnote" color="rgba(255,255,255,0.6)" align="center" style={styles.note}>{note}</Text>
          ) : null}
        </Animated.View>
      </View>

      {/* Optically centred: a lockup on the true middle reads as sitting low. */}
      <View style={styles.ballast} />
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   THE INSTRUMENT.

   Twelve rim ticks, two rings, and the eight-point star made
   of two squares at 45° — the Rub el Hizb, which is why it is
   two squares and not a drawn polygon: the figure IS two
   squares, and building it that way costs two Views instead of
   an SVG.

   ONE shared value drives the whole construction. Each part
   reads its own slice of it in a worklet (`seg`), which is why
   there is a single timing here and not seven: seven timings
   drift against each other, one cannot.

   `still` renders the finished instrument, resting. `exit` is
   the stage's own lift — the rings open outward a little
   faster than the type as everything goes, which is what makes
   the screen read as opening rather than fading.
   --------------------------------------------------------- */
const RING_OUTER = 318
const RING_INNER = 238
const STAR = 168
const TICKS = 12
const TICK_LEN = 13

/** A phase's own 0→1 inside the master progress, eased on the way out. */
function seg(p: number, from: number, to: number): number {
  'worklet'
  const x = Math.max(0, Math.min(1, (p - from) / (to - from)))
  return 1 - Math.pow(1 - x, 3)
}

export function BrandRosette({ still, exit, ms }: {
  still?: boolean
  exit?: SharedValue<number>
  /** How long the instrument takes to draw. The boot screen passes its own,
   *  shorter, number: the curtain is a four-second moment and the launch is
   *  a one-second one, and an instrument still drawing itself as the screen
   *  is replaced reads as a screen that was interrupted. */
  ms?: number
}) {
  const draw = useSharedValue(still ? 1 : 0)
  const spin = useSharedValue(0)
  /* A stand-in so the worklets can read `.value` unconditionally when no
     caller owns an exit. */
  const noExit = useSharedValue(0)
  const gone = exit ?? noExit

  React.useEffect(() => {
    if (still) return
    draw.value = withTiming(1, { duration: ms ?? ROSETTE_MS, easing: Easing.linear })
    /* The drift runs the whole moment, linearly — an instrument that eases to
       a stop looks mechanical; one that keeps turning looks alive. The 1.3 is
       the same relation the curtain has (1700 drawing inside 4240 turning),
       kept so a shorter instrument drifts at the same rate rather than
       spinning to catch up. */
    spin.value = withTiming(1, { duration: ms ? ms * 1.3 : TOTAL_MS, easing: Easing.linear })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, ms])

  /* The plate: the slow turn, and the outward open on the way out. */
  const plate = useAnimatedStyle(() => ({
    opacity: 1 - gone.value,
    transform: [{ rotate: `${spin.value * 7 - 3.5}deg` }, { scale: 1 + gone.value * 0.16 }],
  }))

  const outer = useAnimatedStyle(() => {
    const p = seg(draw.value, 0.10, 0.58)
    return { opacity: p * 0.5, transform: [{ scale: 0.88 + p * 0.12 }] }
  })
  const inner = useAnimatedStyle(() => {
    const p = seg(draw.value, 0.24, 0.72)
    return { opacity: p * 0.34, transform: [{ scale: 1.1 - p * 0.1 }] }
  })
  /* The two squares turn INTO register from opposite sides — the register is
     the moment the eight points appear, and it should be a resolution, not a
     reveal. */
  const squareA = useAnimatedStyle(() => {
    const p = seg(draw.value, 0.32, 0.92)
    return {
      opacity: p * 0.30,
      transform: [{ rotate: `${(1 - p) * -26}deg` }, { scale: 0.78 + p * 0.22 }],
    }
  })
  const squareB = useAnimatedStyle(() => {
    const p = seg(draw.value, 0.38, 1)
    return {
      opacity: p * 0.30,
      transform: [{ rotate: `${45 + (1 - p) * 26}deg` }, { scale: 0.78 + p * 0.22 }],
    }
  })

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.rosette, plate]} pointerEvents="none">
      {Array.from({ length: TICKS }, (_, i) => (
        <Tick key={i} index={i} draw={draw} still={!!still} />
      ))}
      <Animated.View style={[styles.ring, ringSize(RING_OUTER), outer]} />
      <Animated.View style={[styles.ring, ringSize(RING_INNER), inner]} />
      <Animated.View style={[styles.square, squareA]} />
      <Animated.View style={[styles.square, squareB]} />
    </Animated.View>
  )
}

const ringSize = (d: number) => ({ width: d, height: d, borderRadius: d / 2 })

/* One degree tick. Rotate, THEN push out — the order is the polar placement,
   and swapping it puts every tick in the same spot. */
function Tick({ index, draw, still }: { index: number; draw: SharedValue<number>; still: boolean }) {
  const anim = useAnimatedStyle(() => {
    /* Struck one after another around the rim: each tick owns a 0.06-wide
       slice of the first half of the draw. */
    const from = 0.02 + index * 0.035
    const p = seg(draw.value, from, from + 0.16)
    return {
      opacity: p * 0.55,
      transform: [
        { rotate: `${index * (360 / TICKS)}deg` },
        { translateY: -(RING_OUTER / 2 + 13) },
        { scaleY: 0.3 + p * 0.7 },
      ],
    }
  })
  if (still) {
    return (
      <View
        style={[styles.tick, {
          opacity: 0.4,
          transform: [{ rotate: `${index * (360 / TICKS)}deg` }, { translateY: -(RING_OUTER / 2 + 13) }],
        }]}
      />
    )
  }
  return <Animated.View style={[styles.tick, anim]} />
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxl, zIndex: 40 },
  rosette: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  /* The star is two squares, and the corner is barely softened — a hard
     corner at 1pt aliases into a spike on a high-density screen. */
  square: {
    position: 'absolute',
    width: STAR,
    height: STAR,
    borderWidth: 1,
    borderRadius: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  tick: { position: 'absolute', width: 1, height: TICK_LEN, backgroundColor: 'rgba(255,255,255,0.9)' },
  stack: { alignItems: 'center' },
  ruleBox: { marginTop: space.lg2, alignItems: 'center' },
  /* The rule draws from its centre outward (scaleX), which is why it is a
     fixed width rather than a percentage. */
  rule: { width: 132, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.34)' },
  endonyms: { marginTop: space.lg, letterSpacing: 0.4 },
  greeting: { marginTop: 26, alignItems: 'center' },
  note: { marginTop: space.xs2 },
  ballast: { height: 64 },
})
