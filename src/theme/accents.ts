/* =========================================================
   Accent swatches — the user-pickable overrides.

   These live in src/theme/ and not in the Appearance screen
   for one reason: a hex in a screen is a hex no gate can
   reach. `scripts/check-contrast.mjs` walks this file the way
   it walks the two Palette maps, so every swatch is held to
   the same floor as a shipped role.

   THE CONTRACT each swatch must satisfy (DESIGN.md §2):

     · One of the two inks — slate #1C2330 or white #FFFFFF —
       must clear 4.5:1 against the swatch. `inkOn()` picks the
       better of the two, and the result becomes `textOnAccent`
       on every primary Button, so a swatch that fails has a
       sub-AA label everywhere, permanently, in both schemes.
     · `accentText` (the ink form, used on white/dark grounds)
       is nudged toward legibility by recolor() until it clears
       4.5:1, so it needs no floor here — but the nudge is
       capped at 12 steps and the gate checks it landed.

   Current margins, best-ink against the raw swatch:
     Oxford  #1F4E7E  8.57 (white)   Steel   #7FA8CE  6.30 (slate)
     Azure   #1F4E7E  8.57 (white)   Violet  #7C4DEB  5.10 (white)
     Emerald #0E9F6E  4.66 (slate)   Rose    #B93A52  5.54 (white)
                                     Teal    #0F7C8A  4.92 (white)

   An arbitrary colour picker cannot promise any of this, which
   is why the list is short and closed.
   ========================================================= */
import { ramp } from './tokens'

/** Emerald sits at L=0.260 — slate ink, not white (3.39:1). It is the
 *  swatch that proves inkOn() has to compare contrast rather than threshold
 *  on luminance; do not lighten it without re-running the gate. */
const EMERALD = '#0E9F6E'
const VIOLET = '#7C4DEB'
/** Rose was #D9435F, which no ink could carry: white 4.27:1, slate 3.69:1.
 *  Darkened until white ink clears the floor with room to spare. */
const ROSE = '#B93A52'
const TEAL = '#0F7C8A'

/** `[hex, label]`. The empty hex is "no override" — the app's own Oxford
 *  blue — and must stay first; the picker writes `null` for it. */
export const ACCENT_SWATCHES: readonly (readonly [string, string])[] = [
  ['', 'Oxford blue'],
  /* The old "deep blue" slot: brand 600 is now a near-navy that vanishes on
     the dark scheme, so this swatch carries the azure the app used to wear. */
  [ramp.blue[500], 'Azure'],
  [EMERALD, 'Emerald'],
  /* The old "gold" slot: scholar 500 is now the same link blue as Azure, so
     this swatch carries the story-ring steel instead. */
  [ramp.brand[400], 'Steel'],
  [VIOLET, 'Violet'],
  [ROSE, 'Rose'],
  [TEAL, 'Teal'],
] as const

/** What the first ("no override") swatch paints as — the app's resting
 *  accent, so the row reads as a colour and not as a hole. */
export const DEFAULT_ACCENT_SWATCH = ramp.brand[500]
