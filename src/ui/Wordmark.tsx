/* =========================================================
   The wordmark — where the mark IS the letter.

   The logo is a hand-drawn **h**, so the English lockup does
   not set the name beside the mark, it sets the name THROUGH
   it: the glyph stands in for the initial and the type carries
   the rest.

       [mark] ikmah Web        →  Hikmah Web

   THE MARK IS CROPPED TO ITS INK (assets/brand/mark-tight.png),
   which is the whole trick. A padded square could never sit on
   a baseline: the image's bottom edge has to BE the glyph's
   baseline, or the letter floats and the word breaks in half.
   `alignItems: 'flex-end'` then lands both bottoms together,
   and BASELINE_LIFT raises the mark by the descender space a
   Text box keeps under its baseline.

   KURDISH AND ARABIC NEVER TAKE THE LOCKUP. تۆڕی حیکمە and
   شبكة الحكمة are their own words in their own script, read
   right to left; splicing a Latin h into them would be
   nonsense, not branding. Ask for them and you get type, set
   in the face the Text primitive resolves for the script.

   TWO NUMBERS ARE TUNED BY EYE, and they are the only ones:
   MARK_HEIGHT (how tall the letter stands against the type)
   and BASELINE_LIFT. Nothing else in the lockup is a guess.

   `animate` PLAYS IT AS IT WAS DRAWN — and it is drawn by a
   hand, so it arrives the way ink does. THE LETTER FILLS FROM
   ITS FEET UP: a curtain cut from the ground's own colour
   retreats upward off the glyph with a bright rule riding its
   edge, so what the eye sees is the stroke being laid down,
   not a picture fading in. The word is then written out of the
   letter the same way, left to right. Both are transforms, not
   widths, so nothing relayouts (DESIGN.md §7). Under
   reduce-motion the whole thing is simply there, which is the
   same rule every other animation in this app obeys.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { APP_NAME_AR, APP_NAME_KU } from '@/lib/brand'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, ramp } from '@/theme/tokens'
import { Text } from './Text'
import { Touchable } from './Touchable'

/* THE MARK IS DRAWN, NOT LOADED.

   It began as a pair of cropped PNGs, and that was wrong twice over. A raster
   at masthead size is ten points wide — every edge of a hand-drawn curve
   guessed by a downscaler — and, worse, an asset added to a project while
   Metro is already running is not in its registry: the word rendered and the
   letter did not, which is exactly what a missing image looks like.

   The path is the same one in assets/brand/hand-sign-logo.svg, inlined so the
   lockup depends on nothing but itself. It costs one Svg node, it is exact at
   any size, and the colour is a prop rather than a second file. (DESIGN.md's
   "never SVG inside a list item" is about FlashList rows; a masthead drawn
   once per screen is the case the rule leaves open.) */
const MARK_PATH = 'M 177 34 C 186 24 200 20 212 21 C 232 26 252 34 268 47 C 280 57 293 66 297 76 C 301 85 297 93 289 93 C 283 93 279 90 278 86 C 271 76 258 64 245 57 C 236 52 229 58 224 72 C 220 84 218 96 216 110 C 214 124 214 136 213 148 C 210 170 207 190 206 210 C 206 220 207 226 209 230 C 220 227 232 224 244 226 C 258 228 269 232 276 244 C 282 254 285 272 286 297 C 285 330 284 396 278 424 C 276 440 274 452 269 462 C 264 474 252 478 245 471 C 240 464 238 454 239 442 C 241 420 242 398 242 378 C 243 350 244 322 243 305 C 242 292 240 280 234 275 C 226 269 214 272 208 281 C 200 294 191 310 184 326 C 172 352 158 390 146 424 C 142 436 137 448 131 456 C 125 465 116 474 108 474 C 99 473 94 465 99 456 C 102 450 106 444 109 436 C 113 425 118 407 124 385 C 133 352 146 316 158 292 C 165 277 172 262 176 250 C 178 240 178 232 178 222 C 177 190 175 130 176 70 C 176 55 176 42 177 34 Z'
/** The glyph's ink box inside the master's 390 × 530 document. */
const INK = { x: 94, y: 20, w: 207, h: 458 }
const MARK_ASPECT = INK.w / INK.h
/** The mark stands a little taller than the type, the way a drawn initial
 *  does — level with the ascenders would read as a font, not a hand. */
const MARK_HEIGHT = 1.05
/** LORA'S DESCENDER, measured from the shipped face (hhea descent 25 / em 88 =
 *  0.284). `flex-end` aligns the two BOXES, and a Text box keeps that much room
 *  under its baseline while the cropped mark keeps none — so lifting the mark
 *  by exactly one descender lands its legs ON the baseline. Checked against a
 *  render of Lora_700Bold, not guessed. */
const BASELINE_LIFT = 0.28
/** The join. Tight, because the mark is the word's first letter, not a logo
 *  sitting next to it. */
const JOIN = 0.04

/* The choreography. The ink rises through the letter, then the word is
   written out of it. Slower than a UI transition on purpose: this is the one
   surface in the app with nothing to read, and a logo that flicks past in
   400ms is a stutter rather than a signature. */
const MARK_MS = 660
const WORD_DELAY = 380
const WORD_MS = 560
/* The mark and the word run in PARALLEL (the word starts at WORD_DELAY,
   inside the mark's rise) — summing all three held onDone ~700ms after the
   last visible frame, a dead beat every launch paid for before the brand
   hold even started. The choreography is over when the LAST of the two
   overlapping phases lands. */
const TAIL_MS = Math.max(MARK_MS, WORD_DELAY + WORD_MS)
const masonry = Easing.bezier(...motion.out)

/* THE BOOT FORM — the other half of src/lib/splash.ts.

   On a cold start the letter is on screen BEFORE this component exists: the
   OS drew it, from the same master path, on the same navy. So the boot form
   does not re-reveal it — a glyph fading in over itself is a double exposure,
   and it is exactly what the app used to do. It TRAVELS instead: the mark
   leaves the native splash's geometry and settles into its seat in the word
   while the word is written out of it. One motion, and it is the seam.

   Shorter than the free-standing choreography above, because it is not the
   whole moment: by the time the mark starts moving it has already been on
   screen for the length of a cold start. */
const BOOT_SETTLE_MS = 620
const BOOT_WORD_DELAY = 180
const BOOT_WORD_MS = 480
const BOOT_TAIL_MS = Math.max(BOOT_SETTLE_MS, BOOT_WORD_DELAY + BOOT_WORD_MS)
/** Reduce motion: no travel at all, a dissolve through the ground. */
const BOOT_CROSSFADE_MS = 320
/** How long the boot form waits to be measured before giving up and playing
 *  as an ordinary lockup. A continuity trick that cannot measure itself must
 *  degrade to the animation that needs no measurement — never to a blank
 *  navy rectangle with the app's only exit behind it. */
const BOOT_MEASURE_MS = 400

/** The viewBox IS the ink box, so the drawing fills its own frame exactly —
 *  no padding to centre around, and the bottom edge is the baseline the lift
 *  is measured from. */
const VIEW_BOX = `${INK.x} ${INK.y} ${INK.w} ${INK.h}`

/** Where the mark ALREADY IS when the lockup mounts: the rect the OS splash
 *  drew it at, in window points. */
export interface WordmarkOrigin {
  /** Its centre on screen. */
  cx: number
  cy: number
  /** Its height there. */
  h: number
}

export type WordmarkTone = 'ink' | 'onDark'
export type WordmarkLang = 'en' | 'ku' | 'ar'

export interface WordmarkProps {
  /** Type size in points; the mark scales from it. */
  size?: number
  /** `onDark` takes the light mark — the boot screen, a navy plate. */
  tone?: 'ink' | 'onDark'
  /** `en` builds the lockup. `ku` / `ar` set their own name as type. */
  lang?: WordmarkLang
  /** Overrides the tone's colour for the type (the masthead takes `c.text`). */
  color?: string
  /** Play the lockup on mount. */
  animate?: boolean
  /** Hold the choreography back by this many ms — the splash lets its rosette
   *  draw first and brings the lockup in underneath it. */
  delay?: number
  /** The colour the writing curtain is cut from — it must BE the ground the
   *  lockup sits on, or the wipe shows as a moving block. */
  ground?: string
  /** Fires when the choreography finishes (or immediately, under reduce-motion
   *  — a caller waiting on it must never wait forever). */
  onDone?: () => void
  /** BOOT CONTINUITY. Given the rect the OS splash drew the mark at, the
   *  lockup starts there and settles into place rather than drawing itself.
   *  `en` only — the endonyms take no lockup. */
  origin?: WordmarkOrigin | null
  /** With `origin`, holds everything until the native splash is actually
   *  gone. Nothing may move under a half-faded OS layer. */
  play?: boolean
  /** With `origin`, fires on the frame the mark is measured and parked on that
   *  rect — which is the frame it becomes safe to take the OS splash away. */
  onParked?: () => void
  /** Makes the lockup a control. The masthead uses it for scroll-to-top; the
   *  press is the primitive's own seat, so it feels like every other plate. */
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Wordmark({
  size = 22, tone = 'ink', lang = 'en', color, animate, delay = 0, ground, onDone, onPress, style,
  origin = null, play = false, onParked,
}: WordmarkProps) {
  const t = useTheme()
  const ink = color ?? (tone === 'onDark' ? '#FFFFFF' : undefined)
  const still = t.prefs.reducedMotion || !animate

  /* One shared value per moving part, all started from a single effect so the
     sequence cannot drift between them. */
  const mark = useSharedValue(still ? 1 : 0)
  const word = useSharedValue(still ? 1 : 0)
  const [wordW, setWordW] = React.useState(0)
  /* Needed by the ink worklet below, so it is computed before the hooks
     rather than beside the JSX. */
  const markH = size * MARK_HEIGHT
  const markW = markH * MARK_ASPECT

  /* ---- the boot form ------------------------------------------------- */
  const [bootFailed, setBootFailed] = React.useState(false)
  const boot = !!origin && lang === 'en' && !bootFailed
  /* Primitives, not the object: a worklet that closes over `origin` is rebuilt
     on every render the caller forgets to memoise. */
  const originH = origin?.h ?? 0
  const originCx = origin?.cx ?? 0
  const originCy = origin?.cy ?? 0

  /* THE SEAT IS MEASURED UNTRANSFORMED. The wrapper below carries the layout
     and no transform of its own — the animation lives on a child — so
     `measureInWindow` reports where the mark WILL sit, which is the only
     rect the delta to the native splash can be computed against. */
  const seatRef = React.useRef<React.ComponentRef<typeof View>>(null)
  const [seat, setSeat] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const settle = useSharedValue(0)

  const onSeatLayout = React.useCallback(() => {
    seatRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setSeat({ x, y, w, h })
    })
  }, [])

  /* PARKED: measured, and the word has a width for its curtain to cover. Until
     both hold, nothing in the lockup is allowed to paint — a single naked
     frame here IS the flash this whole path exists to remove. */
  const parked = boot ? seat !== null && wordW > 0 : true
  React.useEffect(() => {
    if (!boot || !parked) return
    /* TWO FRAMES, not zero. This effect runs after React commits, but the
       transform that puts the mark on the OS splash's geometry is applied by
       reanimated on the UI thread — so signalling here would tell the root
       layout it is safe to lift the native layer one frame before the replica
       underneath it has actually painted, which is the flash with extra
       steps. */
    let second: number | undefined
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onParked?.())
    })
    return () => { cancelAnimationFrame(first); if (second) cancelAnimationFrame(second) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, parked])

  React.useEffect(() => {
    if (!boot || parked) return
    const id = setTimeout(() => setBootFailed(true), BOOT_MEASURE_MS)
    return () => clearTimeout(id)
  }, [boot, parked])

  /* ONE effect owns the timeline, both forms of it. Splitting it in two —
     "ordinary here, boot there" — put a write to `word` in each, which the
     React Compiler rejects outright and which is a race besides: `boot` is not
     settled on the first render (the origin is measured), so the free-standing
     choreography would start, and then the boot form would take over a word
     whose writing curtain had already slid halfway off. */
  React.useEffect(() => {
    if (boot) {
      /* Held until the mark is parked on the OS splash's geometry AND that
         splash is actually gone. Both, or the motion plays under it. */
      if (!parked || !play) return
      if (still) {
        settle.value = withTiming(1, { duration: BOOT_CROSSFADE_MS, easing: Easing.linear })
        const crossed = setTimeout(() => onDone?.(), BOOT_CROSSFADE_MS + 40)
        return () => clearTimeout(crossed)
      }
      settle.value = withTiming(1, { duration: BOOT_SETTLE_MS, easing: masonry })
      word.value = withDelay(BOOT_WORD_DELAY, withTiming(1, { duration: BOOT_WORD_MS, easing: masonry }))
      const landed = setTimeout(() => onDone?.(), BOOT_TAIL_MS + 40)
      return () => clearTimeout(landed)
    }
    if (still) { onDone?.(); return }
    mark.value = withDelay(delay, withTiming(1, { duration: MARK_MS, easing: masonry }))
    word.value = withDelay(delay + WORD_DELAY, withTiming(1, { duration: WORD_MS, easing: masonry }))
    const id = setTimeout(() => onDone?.(), delay + TAIL_MS + 40)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, parked, play, still, delay])

  /* The box itself barely moves — the REVEAL is the entrance, and a letter
     that also slides and fades reads as two effects fighting.

     In the boot form it is the opposite: the box is the ONLY thing that moves,
     and it moves from where the OS left the glyph to where the word needs it.
     Transform and opacity only, both on the UI thread, so the auth check and
     the feed prefetch running on the JS thread beside it cannot cost a frame. */
  const markStyle = useAnimatedStyle(() => {
    if (!boot) return { opacity: 1, transform: [{ scale: 0.975 + mark.value * 0.025 }] }
    if (!seat) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] }
    const s = originH / seat.h
    const tx = originCx - (seat.x + seat.w / 2)
    const ty = originCy - (seat.y + seat.h / 2)
    if (still) {
      /* Reduce motion asks for less MOTION, not less product: the mark is
         still handed over, but through the ground rather than across it. One
         value, a V of opacity, and the seat swapped at the bottom of it. */
      const x = settle.value
      return x < 0.5
        ? { opacity: 1 - x * 2, transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] }
        : { opacity: (x - 0.5) * 2, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] }
    }
    const k = 1 - settle.value
    return {
      opacity: 1,
      transform: [{ translateX: tx * k }, { translateY: ty * k }, { scale: 1 + (s - 1) * k }],
    }
  })
  /* The word's own veil, and only in the boot form: before the mark is parked
     nothing may show, and under reduce-motion the type arrives on the second
     half of the dissolve because the writing curtain is not mounted. */
  const wordVeil = useAnimatedStyle(() => {
    if (!boot) return { opacity: 1 }
    if (!parked) return { opacity: 0 }
    if (!still) return { opacity: 1 }
    const x = settle.value
    return { opacity: x < 0.5 ? 0 : (x - 0.5) * 2 }
  })
  /* The ink curtain: cut from the ground, covering the glyph, retreating
     straight up off the top of its own box. What it uncovers grows from the
     feet of the letter. */
  const inkStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -mark.value * markH }],
  }))
  /* The curtain starts over the whole word and leaves to the right. */
  const curtainStyle = useAnimatedStyle(() => ({
    opacity: word.value >= 1 ? 0 : 1,
    transform: [{ translateX: word.value * (wordW + 2) }],
  }))

  const onWordLayout = React.useCallback((e: LayoutChangeEvent) => {
    setWordW(e.nativeEvent.layout.width)
  }, [])

  if (lang !== 'en') {
    /* No mark, no splice: the endonym is the whole name. `align="auto"` lets
       the paragraph run right-to-left the way the script does. */
    return (
      <Text
        variant="title2"
        weight="700"
        color={ink}
        align="auto"
        numberOfLines={1}
        style={[{ fontSize: size, lineHeight: size * 1.35 }, style]}
      >
        {lang === 'ku' ? APP_NAME_KU : APP_NAME_AR}
      </Text>
    )
  }

  const curtain = ground ?? (tone === 'onDark' ? ramp.brand[900] : t.colors.bg)
  /* The letter takes the type's colour — it IS a letter of the word. */
  const markInk = ink ?? t.colors.text

  const lockup = (
    <View style={[styles.row, style]}>
      {/* THE SEAT — plain, untransformed, and the only thing that carries the
          mark's layout. It exists so `measureInWindow` can be trusted: the
          animation lives on the child, so this rect is where the letter is
          going rather than where it currently is. */}
      {/* @boost-ignore — this one is measured, so it keeps the JS wrapper */}
      <View
        ref={seatRef}
        onLayout={boot ? onSeatLayout : undefined}
        style={{
          width: markW,
          height: markH,
          marginBottom: size * BASELINE_LIFT,
          marginEnd: size * JOIN,
          /* Stated, not assumed. The boot form's glyph is nearly three times
             this box and travels most of a screen width out of it before it
             lands; RN's default is `visible`, but on Android that default is
             one `setClipChildren` away from cropping the letter in half and
             it is not a thing to leave to a default. */
          overflow: 'visible',
        }}
        /* It is a letter, not a picture: the row already says the whole name. */
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={[StyleSheet.absoluteFill, boot ? null : styles.markBox, markStyle]}>
          {boot ? (
            /* DRAWN AT THE SIZE IT ARRIVES AT, then scaled DOWN into the seat.
               A view's contents are rasterised at their layout size before the
               transform is applied, so laying the glyph out at seat size and
               scaling it 2.6× up for the handoff would hand the OS's crisp
               88.8pt mark over to a blurred one — the flash, in a different
               costume. Laid out at the arrival height instead, the first frame
               is 1:1 and every later frame is a downsample. The static
               counter-scale here cancels the difference so the seat still
               measures and lays out at type size. */
            <View
              style={[
                styles.oversize,
                {
                  width: originH * MARK_ASPECT,
                  height: originH,
                  left: (markW - originH * MARK_ASPECT) / 2,
                  top: (markH - originH) / 2,
                  transform: [{ scale: markH / (originH || 1) }],
                },
              ]}
            >
              <Svg width="100%" height="100%" viewBox={VIEW_BOX}>
                <Path d={MARK_PATH} fill={markInk} />
              </Svg>
            </View>
          ) : (
            <Svg width="100%" height="100%" viewBox={VIEW_BOX}>
              <Path d={MARK_PATH} fill={markInk} />
            </Svg>
          )}
          {/* The rising ink. The rule on its bottom edge is the nib: it is the
              only bright thing on the screen while the letter is being made,
              and it leaves the box (and is clipped) exactly as the last of the
              glyph appears. Never in the boot form — the OS already drew this
              letter, and drawing it a second time is a double exposure. */}
          {!still && !boot ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: curtain }, inkStyle]}
            >
              <View style={[styles.nib, { backgroundColor: markInk, height: Math.max(1.5, size * 0.05) }]} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
      <Animated.View onLayout={onWordLayout} style={wordVeil}>
        <Text
          variant="title2"
          serif
          weight="700"
          color={ink}
          numberOfLines={1}
          style={{ fontSize: size, letterSpacing: size * 0.06 }}
        >
          ikmah Web
        </Text>
        {/* The writing curtain. Cut from the ground, so what the eye sees is
            type appearing rather than a block moving. Only mounted while it has
            somewhere to travel — a zero width would park it over the word. */}
        {!still && wordW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.curtain, { backgroundColor: curtain, width: wordW + 2 }, curtainStyle]}
          />
        ) : null}
      </Animated.View>
    </View>
  )

  if (!onPress) {
    return (
      <View accessible accessibilityRole="header" accessibilityLabel="Hikmah Web">{lockup}</View>
    )
  }
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityRole="header"
      accessibilityLabel="Hikmah Web"
      accessibilityHint="Scrolls back to the top"
    >
      {lockup}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  /* flex-end, so the mark's cropped bottom meets the type's box bottom; the
     lift above turns that into a shared BASELINE. */
  row: { flexDirection: 'row', alignItems: 'flex-end', overflow: 'visible' },
  /* Taller than the line box on both edges: a curtain that stops at the type's
     bounds leaves the ascenders and the tracking's last pixel showing. */
  curtain: { position: 'absolute', top: -4, bottom: -4, start: -1 },
  /* The ink curtain rides inside the mark's own box, so the box has to clip.
     The boot form does not take this: its glyph is deliberately larger than
     the seat, and clipping would crop the letter down to type size on the
     very frame it is meant to match the OS splash. */
  markBox: { overflow: 'hidden' },
  oversize: { position: 'absolute' },
  nib: { position: 'absolute', start: 0, end: 0, bottom: 0, opacity: 0.9 },
})
