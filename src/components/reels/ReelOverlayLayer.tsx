/* =========================================================
   The overlay layer — text, emoji and moving stickers drawn
   live on top of a reel.

   Nothing here is baked into the frame: the author's items
   travel as `overlay.json` and the viewer redraws them, which
   is the only way a sticker can still move. The numbers in
   that file are fractions of the MEDIA rect (not the card, not
   the screen), so mediaRect() has to be re-derived on this
   side exactly as the composer derived it — that is what makes
   a sticker land where the author put it on a different phone.

   Fonts, colours, aligns and motions are INDEXES into the
   closed tables in lib/reelOverlay.js. A hand-edited
   overlay.json can therefore change which of eight colours is
   used and nothing else; no string from the file ever reaches
   a style.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { http } from '@/api'
import { COLORS, FONTS, mediaRect, overlaySpoken, parseOverlay, plateColor } from '@/lib/reelOverlay'
import { useTheme } from '@/theme/ThemeProvider'
import { Text, isArabicScript } from '@/ui'

export interface OverlayItem {
  k: 't' | 'e' | 's'
  text: string
  x: number; y: number; r: number; s: number
  f: number; c: number; a: number; m: number
  /** 0 = shadowed glyphs, 1 = solid pill, 2 = soft wash. */
  bg: 0 | 1 | 2
}
export interface OverlayDoc {
  v: number
  fit: 'cover' | 'contain'
  items: OverlayItem[]
}

/* The faces are the APP'S OWN (§4 — never a platform family at a call site):
   the root layout gates first paint on expo-font settling, so Lora, Amiri and
   IBM Plex Mono are exactly as guaranteed-present as Georgia was — and unlike
   Georgia they carry Arabic. The serif slot resolves per RUN the way the Text
   primitive does (Lora has no Arabic glyphs; Amiri is its §4 counterpart),
   and the weight is folded into the face name so Android never synthesizes
   over a registered family. Slot 0 stays `undefined` — the Text primitive
   already resolves the sans per script. */
export function overlayFamily(slot: number, text: string): string | undefined {
  const w = FONTS[slot]?.weight ?? 700
  if (slot === 1) {
    if (isArabicScript(text)) return w >= 600 ? 'Amiri_700Bold' : 'Amiri_400Regular'
    return w >= 700 ? 'Lora_700Bold' : w >= 600 ? 'Lora_600SemiBold' : 'Lora_400Regular'
  }
  if (slot === 2) return w >= 600 ? 'IBMPlexMono_600SemiBold' : 'IBMPlexMono_400Regular'
  /* Light: the quiet sans. Plex has no Arabic glyphs, so Arabic runs take
     Vazirmatn at the same weight — the exact swap the Text primitive makes. */
  if (slot === 3) return isArabicScript(text) ? 'Vazirmatn_400Regular' : 'IBMPlexSans_400Regular'
  /* Italic: the serif's italic face. Arabic typography has no italic; Amiri
     regular is its §4 counterpart rather than a synthesized slant. */
  if (slot === 4) return isArabicScript(text) ? 'Amiri_400Regular' : 'Lora_600SemiBold_Italic'
  /* Vazir: Vazirmatn carries Latin AND Arabic, so one face serves every run. */
  if (slot === 5) return 'Vazirmatn_700Bold'
  return undefined
}

/* ---------------------------------------------------------
   The item's text style, shared.

   Three surfaces draw an authored item — this viewer layer,
   the composer's editable stage, and the text tray's live
   preview — and they must be pixel-identical or the author is
   editing a lie. These two helpers ARE that agreement; no
   surface styles an item by hand any more.
   --------------------------------------------------------- */

/** Face + weight for an item: fontFamily when the slot resolves one (weight
 *  rides the face NAME — a fontWeight over a registered family invites an
 *  Android fallback to the system stack), numeric weight only for the sans
 *  slots the Text primitive resolves itself. */
export function overlayFaceStyle(item: Pick<OverlayItem, 'f' | 'text'>): object {
  const fam = overlayFamily(item.f, item.text)
  return fam
    ? { fontFamily: fam }
    : { fontWeight: String(FONTS[item.f]?.weight ?? 700) as any }
}

/** The plate behind the glyphs, or null for bg 0 (caller applies the drop
 *  shadow instead). Solid pill hugs tight; the wash breathes a little wider
 *  and rounder, reading as a highlighter rather than a label. */
export function overlayPlateStyle(item: Pick<OverlayItem, 'c' | 'bg'>, size: number): object | null {
  if (!item.bg) return null
  const wash = item.bg === 2
  return {
    backgroundColor: plateColor(item.c, item.bg),
    paddingHorizontal: size * (wash ? 0.34 : 0.28),
    paddingVertical: size * (wash ? 0.16 : 0.1),
    borderRadius: size * (wash ? 0.42 : 0.34),
    overflow: 'hidden' as const,
  }
}

/** Motion id → [duration ms, alternate?]. Every motion ends where it starts, so
 *  collapsing it to a static frame under reduce-motion leaves nothing crooked. */
const MOTION_SPEC: [number, boolean][] = [
  [0, false],      // None
  [700, true],     // Pulse
  [480, true],     // Bounce
  [900, true],     // Swing
  [320, true],     // Pop
  [1600, true],    // Float
  [3200, false],   // Spin
  [800, true],     // Twinkle
]

/** Kept as a named hook because several overlay call sites read it, but the
 *  OR it used to perform now happens once in ThemeProvider: `prefs` is the
 *  user's account block with the phone's Reduce Motion already folded in.
 *  This component subscribed to AccessibilityInfo itself for a while and was
 *  the ONLY thing in the app that honoured the phone's switch. */
export function useReduceMotion(): boolean {
  return useTheme().prefs.reducedMotion
}

/* ---------------------------------------------------------
   One item.
   --------------------------------------------------------- */

function Item({
  item, rect, paused, still,
}: {
  item: OverlayItem
  rect: { left: number; top: number; width: number; height: number }
  paused: boolean
  still: boolean
}) {
  const t = useTheme()
  const p = useSharedValue(0)
  const motion = item.m
  const [duration, alternate] = MOTION_SPEC[motion] ?? MOTION_SPEC[0]

  React.useEffect(() => {
    if (!duration || still || paused) {
      cancelAnimation(p)
      p.value = 0
      return
    }
    p.value = 0
    p.value = withRepeat(
      withTiming(1, { duration, easing: alternate ? Easing.inOut(Easing.quad) : Easing.linear }),
      -1,
      alternate,
    )
    return () => cancelAnimation(p)
  }, [p, duration, alternate, paused, still])

  const anim = useAnimatedStyle(() => {
    'worklet'
    const v = p.value
    switch (motion) {
      case 1: return { transform: [{ scale: 1 + 0.12 * v }] }
      case 2: return { transform: [{ translateY: -14 * v }] }
      case 3: return { transform: [{ rotate: `${(v * 2 - 1) * 8}deg` }] }
      case 4: return { transform: [{ scale: 1 + 0.22 * v }] }
      case 5: return { transform: [{ translateY: -8 * v }] }
      case 6: return { transform: [{ rotate: `${v * 360}deg` }] }
      case 7: return { opacity: 1 - 0.6 * v, transform: [{ scale: 1 + 0.05 * v }] }
      default: return {}
    }
  }, [motion])

  const size = Math.max(9, item.s * rect.width)
  const color = COLORS[item.c] ?? COLORS[0]
  const align = item.a === 1 ? 'center' : item.a === 2 ? (t.isRTL ? 'left' : 'right') : (t.isRTL ? 'right' : 'left')
  const plate = overlayPlateStyle(item, size)

  return (
    <View
      pointerEvents="none"
      style={[
        styles.anchor,
        {
          left: rect.left + item.x * rect.width - rect.width / 2,
          top: rect.top + item.y * rect.height - rect.height / 2,
          width: rect.width,
          height: rect.height,
        },
      ]}
    >
      <Animated.View style={[{ transform: [{ rotate: `${item.r}deg` }] }, anim]}>
        {/* The one place a raw fontSize is right: `s` is authored data, not a
            step on the type ramp, and the whole contract of the overlay is
            that it renders at the size its author chose. */}
        <Text
          variant="body"
          color={color}
          style={[
            overlayFaceStyle(item),
            {
              fontSize: size,
              lineHeight: size * 1.2,
              textAlign: align,
            },
            plate ?? styles.shadowed,
          ]}
        >
          {item.text}
        </Text>
      </Animated.View>
    </View>
  )
}

/* ---------------------------------------------------------
   The layer.
   --------------------------------------------------------- */

export interface ReelOverlayLayerProps {
  doc: OverlayDoc | null | undefined
  box: { width: number; height: number }
  /** Intrinsic media size. 0/0 is legitimate — mediaRect falls back to the box. */
  mediaW: number
  mediaH: number
  paused: boolean
}

export function ReelOverlayLayer({ doc, box, mediaW, mediaH, paused }: ReelOverlayLayerProps) {
  const still = useReduceMotion()
  if (!doc?.items?.length) return null
  const rect = mediaRect(box as any, mediaW, mediaH, doc.fit)
  const spoken = overlaySpoken(doc)

  return (
    <>
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {doc.items.map((item, i) => (
          <Item key={i} item={item} rect={rect} paused={paused} still={still} />
        ))}
      </View>
      {/* One sibling carries the words, so a screen reader hears the overlay
          once instead of twelve absolutely-positioned fragments out of order. */}
      {spoken ? (
        <View style={styles.hidden} accessible accessibilityLabel={`Text on this reel: ${spoken}`} />
      ) : null}
    </>
  )
}

/* ---------------------------------------------------------
   Fetching the document.

   Only the full read carries `overlayUrl`, so this fires after
   hydration and the layer fades in rather than popping. A
   malformed or oversized document draws nothing at all — a
   half-rendered layer is worse than none, and the clip is
   unaffected either way.
   --------------------------------------------------------- */

export function useOverlayDoc(url: string | null | undefined, enabled = true): OverlayDoc | null {
  const [doc, setDoc] = React.useState<OverlayDoc | null>(null)

  React.useEffect(() => {
    if (!url || !enabled) { setDoc(null); return }
    let alive = true
    ;(async () => {
      try {
        /* assetUrl already made this absolute, and buildUrl passes an absolute
           through untouched — but it must still go through http so the auth
           header and the big-int-safe parser apply. Never a bare fetch. */
        const raw = await http.get(url)
        if (alive) setDoc(parseOverlay(raw) as OverlayDoc | null)
      } catch {
        if (alive) setDoc(null)
      }
    })()
    return () => { alive = false }
  }, [url, enabled])

  return doc
}

const styles = StyleSheet.create({
  /* THE ANCHOR BOX — and why it is not zero-sized.

     An item's x/y are FRACTIONS of the media rect and they address the item's
     CENTRE, which on the web is `left:x%; top:y%; transform:translate(-50%,-50%)`.
     The port expressed that as a 0x0 flex box centring an overflowing child, and
     on the web that works because a 0-width flex container still gives its child
     `fit-content`, i.e. min-content — the text simply overflows.

     YOGA DOES NOT DO THAT. It hands the child's measure function the available
     width verbatim, so the Text below was measured against a container 0 points
     wide. TextKit cannot place a glyph in a 0-width line fragment and Android's
     StaticLayout degenerates the same way, so EVERY item — text, emoji, sticker
     — laid out to nothing and the overlay drew a completely empty layer on both
     platforms. Nothing else in this app nests text in a zero-width box, which is
     why nothing else showed the symptom.

     So the box is the MEDIA RECT, centred on the item's point: the child gets a
     real width to wrap against (the same width its author was looking at) and
     lands exactly on the anchor, with no percentage transform and no measuring
     pass. `left/top` shift the box, never the item. */
  anchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  shadowed: { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
})
