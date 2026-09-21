/* =========================================================
   Semantic colour maps — OXFORD (DESIGN.md §2).

   Screens never reach for a ramp step. They ask for a ROLE —
   `c.textMuted`, `c.surfaceRaised` — and the role resolves
   differently per scheme. That is the whole contract: add a
   role here and both schemes must answer it, which is what
   keeps dark mode from rotting.

   THE OXFORD SYSTEM (ported from the web app's theme.css):

     · The body is WHITE #FFFFFF; secondary surfaces are
       off-white #F2F0F0 (rails may use the #F7F6F5 half-step).
       Backgrounds are only ever these — tinted fills mark
       STATE, not surface.
     · Stone (#D9D8D6 / #E9E8E6 / #C2C1BF) draws lines; cool
       slate (#1C2330 / #4D5768 / #616B7C) sets words. Stone is
       never used for text.
     · Oxford Blue #002147 is the identity: primary actions,
       own bubbles, active nav, headings, seals. Link blue
       #1F4E7E carries links and interactive icons (7.2:1 on
       white). Sky #B9D6F2 is the secondary — selected washes
       and every on-dark accent.
     · Cerulean #49B6FF is the ONE bright accent, reserved for
       actions sitting on dark navy plates, carrying Oxford
       Blue ink (8.6:1). On white it is a 1.9:1 disaster —
       light surfaces keep Oxford Blue.
     · Green #426A5A means success ONLY (presence dots are the
       sanctioned exception). Amber #8A5A17 warns; muted red
       #9C3A33 is errors and destructive. A filled like-heart
       is rose #B3453E and never re-themed.
     · Dark scheme surfaces are Oxford night blues (§4 of the
       web spec) — blue-black, never pure black, never warm.

   Every text/surface pair here was contrast-verified in
   DESIGN.md §2 ("Verified contrast"); regressions from that
   table are bugs.

   Naming:
     bg*        page backgrounds, back to front
     surface*   cards/sheets that sit ON a background
     text*      foreground text, strongest to weakest
     border*    hairlines and outlines
     accent*    Oxford Blue and its washes
     scholar*   scholarly emphasis — Oxford Blue seniority
                (darker = more senior); gold is retired
     cta*       the cerulean on-dark action
     *Soft      the wash behind a state (solid, not alpha,
                except where alpha stacking is meant)
   ========================================================= */
import { ramp } from './tokens'

export type ColorScheme = 'light' | 'dark'

export interface Palette {
  scheme: ColorScheme

  /* Backgrounds */
  bg: string
  bgSunken: string
  bgElevated: string
  surface: string
  surfaceRaised: string
  surfaceSunken: string
  surfaceInverse: string

  /* Text */
  text: string
  textSecondary: string
  textMuted: string
  textFaint: string
  textInverse: string
  textOnAccent: string
  textOnDanger: string
  /** Input placeholders — decorative, never carries required info. */
  placeholder: string

  /* Lines */
  border: string
  borderStrong: string
  borderFaint: string
  separator: string

  /* Brand */
  accent: string
  accentPressed: string
  accentSoft: string
  accentSofter: string
  accentText: string
  /** Links, interactive icons, focus rings, the STANDARD verify seal. */
  link: string
  /** Oxford Sky — accents that sit on a dark/navy plate (rings, quotes,
   *  unread markers in own bubbles). Same value in both schemes. */
  sky: string

  /* The on-dark action — Oxford Cerulean. ONLY on dark plates
     (reels, stories, live, auth pane, navy cards); carries navy ink. */
  cta: string
  ctaPressed: string
  textOnCta: string

  /* Research / scholarly — Oxford Blue seniority (darker = more senior) */
  scholar: string
  scholarSoft: string
  scholarText: string
  textOnScholar: string

  /* Semantic */
  success: string
  successSoft: string
  successText: string
  warning: string
  warningSoft: string
  warningText: string
  danger: string
  dangerPressed: string
  dangerSoft: string
  dangerText: string
  info: string
  infoSoft: string
  infoText: string
  /** The filled like-heart. Sacred content colour, both schemes. */
  like: string

  /* Chrome */
  headerBg: string
  tabBarBg: string
  scrim: string
  skeleton: string
  skeletonHighlight: string
  ripple: string

  /* Chat */
  bubbleOut: string
  bubbleOutText: string
  bubbleIn: string
  bubbleInText: string
  chatWallpaper: string

  /* Status dots + story rings */
  online: string
  away: string
  offline: string
  liveDot: string
  /** Unseen story ring — steel. Seen = stone-strong. */
  storyRing: string
  storyRingSeen: string

  /* Fixed — identical in both schemes, for media overlays that
     sit on top of arbitrary imagery. */
  overlayBg: string
  overlayText: string
  overlayTextMuted: string
  overlayChip: string
  /** The QR plate — white with brand-navy ink in BOTH schemes: a code on a
   *  dark surface will not scan, and a code that cannot be scanned is worse
   *  than no code at all. Three screens reinvented this pair before it was
   *  a role (§1: when no role fits, add the role). */
  qrPlate: string
  qrInk: string

  /* The voice plate — the web's .vnp card: a dark-by-design navy
     gradient carrying the cerulean transport and a Sky waveform.
     Fixed in both schemes, like the overlay roles: the plate IS
     the dark ground, whatever the paper around it. */
  voicePlate: string
  voicePlateEnd: string
  voicePlateBorder: string
  voiceWaveRest: string
}

export const lightPalette: Palette = {
  scheme: 'light',

  /* WHITE PAPER — the body is white; wells and rails are off-white. */
  bg: '#FFFFFF',
  bgSunken: '#F2F0F0',
  bgElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#F7F6F5',
  surfaceInverse: '#002147',

  /* Cool slate ink — 15.8:1 on white. Stone never sets words. */
  text: '#1C2330',
  textSecondary: '#4D5768',
  textMuted: '#616B7C',                // 5.2:1 white · 4.5:1 off-white — AA both
  textFaint: '#616B7C',                // == muted, deliberate (the AA floor)
  textInverse: '#F2F0F0',
  textOnAccent: '#FFFFFF',             // 15.9:1 on Oxford Blue
  textOnDanger: '#FFFFFF',
  placeholder: '#98A1B0',              // decorative, exempt

  border: '#D9D8D6',
  borderStrong: '#C2C1BF',
  borderFaint: '#E9E8E6',
  separator: '#E9E8E6',

  /* Oxford Blue is the interactive colour on white. Pressed deepens. */
  accent: '#002147',
  accentPressed: '#00172F',
  accentSoft: '#E7EFF8',               // quiet wash — hover/selected fills
  accentSofter: 'rgba(31,78,126,0.07)',
  accentText: '#1F4E7E',               // 7.2:1 on white
  link: '#1F4E7E',
  sky: '#B9D6F2',                      // fixed, both schemes

  /* Cerulean — only ever on dark plates, with navy ink (8.6:1). */
  cta: '#49B6FF',
  ctaPressed: '#2AA1F2',
  textOnCta: '#002147',

  /* Scholarly = Oxford Blue seniority. The old gilt is retired. */
  scholar: '#002147',
  scholarSoft: '#DCE9F6',
  scholarText: '#163E66',              // 9.5:1 on white
  textOnScholar: '#FFFFFF',

  success: '#426A5A',                  // 6.0:1 on white — success ONLY
  successSoft: '#E4EDE9',
  successText: '#426A5A',
  warning: '#8A5A17',                  // 5.6:1 on white
  warningSoft: '#F5EAD7',
  warningText: '#8A5A17',
  danger: '#9C3A33',                   // 6.3:1 on white
  dangerPressed: '#872F29',
  dangerSoft: '#F6E4E2',
  dangerText: '#9C3A33',
  info: '#1F4E7E',
  infoSoft: '#E7EFF8',
  infoText: '#1F4E7E',
  like: '#B3453E',                     // hearts keep their red — both schemes

  /* Chrome — white at ~96%, quiet slate shadows do the lifting. */
  headerBg: 'rgba(255,255,255,0.96)',
  tabBarBg: '#FFFFFF',
  scrim: 'rgba(11,18,32,0.55)',
  skeleton: '#F2F0F0',
  skeletonHighlight: '#E9E8E6',
  ripple: 'rgba(28,35,48,0.06)',

  /* Own bubbles Oxford Blue with off-white text; others' white on stone. */
  bubbleOut: '#002147',
  bubbleOutText: '#F2F0F0',
  bubbleIn: '#F2F0F0',
  bubbleInText: '#1C2330',
  chatWallpaper: '#F7F6F5',

  /* Presence green and live red are SACRED content colours. */
  online: '#3D9A5F',
  away: '#8A5A17',
  offline: '#8A94A4',
  liveDot: '#9C3A33',
  storyRing: '#7FA8CE',                // steel — unseen
  storyRingSeen: '#C2C1BF',            // stone-strong — seen

  overlayBg: 'rgba(11,18,32,0.55)',
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.72)',
  overlayChip: 'rgba(8,14,22,0.42)',
  qrPlate: '#FFFFFF',
  qrInk: '#002147',

  voicePlate: '#00172F',
  voicePlateEnd: '#0E2440',
  voicePlateBorder: 'rgba(185,214,242,0.14)',   // ghost-sky hairline
  voiceWaveRest: 'rgba(185,214,242,0.30)',      // rest bars — ghost sky
}

export const darkPalette: Palette = {
  scheme: 'dark',

  /* OXFORD NIGHT — blue-black surfaces, never pure black, never warm. */
  bg: '#0A121C',
  bgSunken: '#080E16',
  bgElevated: '#101C2C',
  surface: '#101C2C',
  surfaceRaised: '#162436',
  surfaceSunken: '#0E1826',
  surfaceInverse: '#FFFFFF',

  text: '#E8EDF3',
  textSecondary: '#A9B8C8',
  textMuted: '#7F92A6',
  textFaint: '#7F92A6',                // == muted, deliberate
  textInverse: '#1C2330',
  textOnAccent: '#FFFFFF',
  textOnDanger: '#240F0C',             // dark danger is a LIGHT plate
  placeholder: '#5E7089',

  border: '#22344A',
  borderStrong: '#3D5677',
  borderFaint: '#1A2A3D',
  separator: '#1A2A3D',

  /* Link blue is the plate at night; pressed BRIGHTENS — on dark,
     pressure glows. Sky carries the identity. */
  accent: '#1F4E7E',
  accentPressed: '#2E6094',
  accentSoft: '#152A42',               // selected wash
  accentSofter: 'rgba(143,184,224,0.10)',
  accentText: '#8FB8E0',               // 7:1 on body
  link: '#8FB8E0',
  sky: '#B9D6F2',                      // fixed, both schemes

  cta: '#49B6FF',
  ctaPressed: '#6EC6FF',               // pressed brightens on dark
  textOnCta: '#002147',

  /* Scholarly at night wears Sky — the identity on dark. */
  scholar: '#B9D6F2',
  scholarSoft: '#152A42',
  scholarText: '#B9D6F2',
  textOnScholar: '#002147',

  success: '#7FBFA5',
  successSoft: '#12291F',
  successText: '#7FBFA5',
  warning: '#D9A75A',
  warningSoft: '#2C2210',
  warningText: '#D9A75A',
  danger: '#D98078',
  dangerPressed: '#E39189',            // pressed brightens
  dangerSoft: '#2E1512',
  dangerText: '#D98078',
  info: '#8FB8E0',
  infoSoft: '#152A42',
  infoText: '#8FB8E0',
  like: '#B3453E',                     // hearts keep their rose — both schemes

  headerBg: 'rgba(10,18,28,0.96)',
  tabBarBg: '#0E1826',
  scrim: 'rgba(3,7,14,0.72)',
  skeleton: 'rgba(232,237,243,0.07)',
  skeletonHighlight: 'rgba(185,214,242,0.10)',
  ripple: 'rgba(232,237,243,0.08)',

  bubbleOut: '#163E66',
  bubbleOutText: '#F2F0F0',
  bubbleIn: '#162436',
  bubbleInText: '#E8EDF3',
  chatWallpaper: '#0C1624',

  /* Sacred hues — presence unchanged; live red lifts for dark ground. */
  online: '#3D9A5F',
  away: '#D9A75A',
  offline: '#5E7089',
  liveDot: '#C2483D',
  storyRing: '#7FA8CE',
  storyRingSeen: '#2B3B4E',

  overlayBg: 'rgba(11,18,32,0.55)',
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.72)',
  overlayChip: 'rgba(8,14,22,0.42)',
  qrPlate: '#FFFFFF',
  qrInk: '#002147',

  voicePlate: '#00172F',
  voicePlateEnd: '#0E2440',
  voicePlateBorder: 'rgba(185,214,242,0.14)',   // ghost-sky hairline
  voiceWaveRest: 'rgba(185,214,242,0.30)',      // rest bars — ghost sky
}

export const palettes: Record<ColorScheme, Palette> = {
  light: lightPalette,
  dark: darkPalette,
}

/* ---------------------------------------------------------
   Deterministic avatar / channel fallback colours. Same hash
   and modulus the web app used (adapters.js) so an avatarless
   user keeps the same colour across clients; the six hues are
   the Oxford muted categoricals (navy, fiqh steel, science
   teal, hadith madder, history olive, aqidah plum). Flat
   pairs — gradients are not part of the language.
   --------------------------------------------------------- */

const AVATAR_HUES = [
  ['#002147', '#002147'],
  ['#4E6580', '#4E6580'],
  ['#2F6B72', '#2F6B72'],
  ['#8A4A5B', '#8A4A5B'],
  ['#5B7A67', '#5B7A67'],
  ['#6B5B8A', '#6B5B8A'],
] as const

export function avatarGradient(seed: string | number | null | undefined): readonly [string, string] {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_HUES[h % AVATAR_HUES.length]
}

/* ---------------------------------------------------------
   The research card's 3px discipline spine (DESIGN.md §5).
   Fixed content categoricals — identical in both schemes,
   the same family the avatar fallbacks draw from.
   --------------------------------------------------------- */

export const disciplineSpines: Record<string, string> = {
  hadith: '#8A4A5B',
  tafsir: '#002147',
  aqidah: '#6B5B8A',
  fiqh: '#4E6580',
  science: '#2F6B72',
  history: '#5B7A67',
  manuscript: '#6B5B8A',
}

/** Spine colour for one paper: the first tag that names a discipline wins;
 *  a paper that names none falls back to the id hash, so the same card keeps
 *  the same spine on every device (the web's `tintOf` behaviour). */
export function disciplineSpine(seed: string | null | undefined, names?: readonly string[] | null): string {
  for (const n of names || []) {
    const hit = disciplineSpines[String(n).trim().toLowerCase()]
    if (hit) return hit
  }
  return avatarGradient(seed)[0]
}

/* ---------------------------------------------------------
   Colour math. Used by ThemeProvider's recolor() (the user
   accent override must keep AA ink) and by anything that
   plates arbitrary colour (avatar initials).
   --------------------------------------------------------- */

/** Hex/rgb → rgba at a given alpha. Accepts `#rgb`, `#rrggbb` and `rgb()`. */
export function withAlpha(color: string, a: number): string {
  if (!color) return color
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${a})`)
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`)
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`
}

export function hexToRgb(color: string): [number, number, number] | null {
  let hex = color.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('')
  if (hex.length !== 6) return null
  const n = parseInt(hex, 16)
  if (!Number.isFinite(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex2(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
}

/** Solid mix of `color` into `into` at ratio t (0 = into, 1 = color). */
export function mixHex(color: string, into: string, t: number): string {
  const a = hexToRgb(color)
  const b = hexToRgb(into)
  if (!a || !b) return color
  return `#${toHex2(a[0] * t + b[0] * (1 - t))}${toHex2(a[1] * t + b[1] * (1 - t))}${toHex2(a[2] * t + b[2] * (1 - t))}`
}

/** WCAG relative luminance (0–1) of a hex colour. */
export function relLuminance(color: string): number {
  const rgb = hexToRgb(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** The on-plate ink rule (DESIGN.md §2): slate ink on light plates, white on
 *  dark ones. Never hardcode on-accent ink where recolor() can reach.
 *
 *  This asks the question directly rather than guessing at a luminance
 *  threshold. The two inks break even at Y ≈ 0.214, so a 0.35 cut-off handed
 *  the WORSE ink to every plate in between — reachable in production, since
 *  recolor() feeds this the user's accent and the Emerald swatch sits at
 *  Y = 0.26 (white on it is 3.4:1; slate is 4.7:1 and passes AA). */
export function inkOn(plate: string): string {
  return contrastRatio('#1C2330', plate) >= contrastRatio('#FFFFFF', plate) ? '#1C2330' : '#FFFFFF'
}
