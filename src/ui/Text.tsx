/* =========================================================
   Text — every string in the app goes through here.

   Three reasons it is not `react-native`'s Text:

   1. The type ramp is a `variant` prop, so a heading can never
      be "16 semibold" in one place and "17 bold" in another.
   2. Direction. The platform is trilingual (English / Arabic /
      Central Kurdish) and user content mixes scripts freely, so
      alignment has to follow the CONTENT, not the UI.
   3. OXFORD typography (DESIGN.md §4) resolves here and only
      here. Serif roles (display, titles, datelines) wear Lora;
      UI text wears IBM Plex Sans. Arabic/Kurdish runs take
      Amiri in serif roles and Vazirmatn (the Arabic sans of
      the web's font stack) in UI roles — Lora and Plex have
      no Arabic glyphs and must never fake them.

   HARD RULES enforced below: Arabic-script runs get
   letterSpacing 0 (tracking breaks connected script) and are
   never uppercased; the caps variants (caption/micro) are
   Latin-only transforms.
   ========================================================= */
import React from 'react'
import { Text as RNText, type TextProps as RNTextProps, type TextStyle, StyleSheet } from 'react-native'
import { useTheme, autoAlign } from '@/theme/ThemeProvider'
import type { TypeKey } from '@/theme/tokens'

/* Set by the root layout once expo-font resolves. Until then (or if loading
   fails) every run rides the system stack with numeric weights — the same
   silent fallback the bible mandates. */
let fontsReady = false
export function setFontsReady(ok: boolean) { fontsReady = ok }

/* First strong character decides the script of a run — the same contract as
   autoAlign / the web's dir="auto". */
const STRONG = /[\p{L}]/u
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
export function isArabicScript(s: string | null | undefined): boolean {
  if (!s) return false
  const m = STRONG.exec(s)
  return !!m && ARABIC.test(m[0])
}

type Fam =
  | { fontFamily: string }
  | { fontWeight: TextStyle['fontWeight'] }

/* Weight → face maps. When a concrete face is chosen, fontWeight is OMITTED —
   pairing a static face with a numeric weight invites faux-bolding. */
function loraFace(w: number, italic?: boolean): string {
  if (italic) return w >= 600 ? 'Lora_600SemiBold_Italic' : 'Lora_400Regular_Italic'
  if (w >= 700) return 'Lora_700Bold'
  if (w >= 600) return 'Lora_600SemiBold'
  return 'Lora_400Regular'
}
function plexFace(w: number): string {
  if (w >= 700) return 'IBMPlexSans_700Bold'
  if (w >= 600) return 'IBMPlexSans_600SemiBold'
  if (w >= 500) return 'IBMPlexSans_500Medium'
  return 'IBMPlexSans_400Regular'
}
/* Arabic/Kurdish UI sans — the mobile equivalent of the web stack's
   "Noto Sans Arabic" fallback. Amiri stays for serif/ayah roles. */
function vazirmatnFace(w: number): string {
  if (w >= 700) return 'Vazirmatn_700Bold'
  if (w >= 600) return 'Vazirmatn_600SemiBold'
  if (w >= 500) return 'Vazirmatn_500Medium'
  return 'Vazirmatn_400Regular'
}
function amiriFace(w: number): string {
  return w >= 600 ? 'Amiri_700Bold' : 'Amiri_400Regular'
}
function monoFace(w: number): string {
  return w >= 600 ? 'IBMPlexMono_600SemiBold' : 'IBMPlexMono_400Regular'
}

/* The UI face, resolved for the one component that cannot use `Text` at all:
   `TextInput`. RN does not inherit fonts, so typed text falls back to the OS
   system stack while the field's label, hint and error — ordinary `Text` —
   wear IBM Plex, and the mismatch is visible in every form in the app.

   `arabicUI` is passed, not sniffed: a TextInput carries ONE family for the
   whole field, so the face has to follow the interface, never the run being
   typed. Returns undefined while the fonts are still loading, so callers
   spread nothing and the system stack stays the honest fallback — the same
   silence `Text` keeps above. */
export function inputFace(weight: number, arabicUI: boolean): string | undefined {
  if (!fontsReady) return undefined
  return arabicUI ? vazirmatnFace(weight) : plexFace(weight)
}

export type TextTone =
  | 'default' | 'secondary' | 'muted' | 'faint' | 'inverse'
  | 'accent' | 'scholar' | 'success' | 'warning' | 'danger' | 'onAccent' | 'overlay'

export interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: TypeKey
  tone?: TextTone
  weight?: TextStyle['fontWeight']
  /** `auto` follows the first strong character of the string (the default,
   *  matching the web's `dir="auto"`); `ui` follows the interface direction. */
  align?: 'auto' | 'ui' | 'center' | 'left' | 'right'
  /** Long-form reading size — the research reader and expanded post bodies. */
  reading?: boolean
  /** The editorial voice: Lora for Latin, Amiri for Arabic/Kurdish runs.
   *  Post bodies, quotes, titles, datelines. */
  serif?: boolean
  /** Ayah/Quranic blocks ONLY (§4): Amiri 400 — the one sanctioned home of
   *  the Quranic face. Never use it for ordinary Arabic titles or bodies. */
  ayah?: boolean
  /** The ledger voice: IBM Plex Mono — handles, timestamps, OTP, counters. */
  mono?: boolean
  /** Override the variant's caps transform. The caption/micro EYEBROW is
   *  uppercase by spec; pass `caps={false}` when the string is a NAME,
   *  handle or count riding a small variant — words, not chrome. */
  caps?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  style?: RNTextProps['style']
  children?: React.ReactNode
}

export function Text({
  variant = 'body',
  tone = 'default',
  weight,
  align = 'auto',
  reading = false,
  serif = false,
  ayah = false,
  mono = false,
  caps: capsProp,
  italic,
  underline,
  strike,
  color,
  style,
  children,
  ...rest
}: TextProps) {
  const t = useTheme()
  const c = t.colors
  const spec = t.type[variant]

  const toneColor =
    color ??
    (tone === 'secondary' ? c.textSecondary
      : tone === 'muted' ? c.textMuted
        : tone === 'faint' ? c.textFaint
          : tone === 'inverse' ? c.textInverse
            : tone === 'accent' ? c.accentText
              : tone === 'scholar' ? c.scholarText
                : tone === 'success' ? c.successText
                  : tone === 'warning' ? c.warningText
                    : tone === 'danger' ? c.dangerText
                      : tone === 'onAccent' ? c.textOnAccent
                        : tone === 'overlay' ? c.overlayText
                          : c.text)

  const content = typeof children === 'string' ? children : null
  const arabic = isArabicScript(content) || (align === 'auto' && !content && t.isRTL)
  /* The UI locale forces the Arabic display path even for Latin snippets in
     an ar/ckb interface — headlines must not zebra between two families. */
  const arabicUI = t.language === 'AR' || t.language === 'KU'

  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center'
      : align === 'left' ? 'left'
        : align === 'right' ? 'right'
          : align === 'ui' ? (t.isRTL ? 'right' : 'left')
            : autoAlign(content, t.dir)

  const decoration =
    underline && strike ? 'underline line-through'
      : underline ? 'underline'
        : strike ? 'line-through'
          : 'none'

  const requested =
    weight === 'bold' ? 700
      : weight === 'normal' ? 400
        : Number(weight ?? spec.weight) || 400
  /* iOS Bold Text (Settings → Accessibility → Display). The phone asked for
     heavier type, so the light end of the ramp steps up one stop and the
     already-heavy end stays put — the ramp compresses rather than flattening
     to a single weight, which would erase the hierarchy the variants exist
     to draw. `ayah` is unaffected: it pins Amiri 400 below and DESIGN.md §4
     forbids bolding it at any provocation. */
  const w = t.a11y.boldText && !ayah ? Math.max(requested, 600) : requested
  const fontSize = reading ? t.reading.fontSize : spec.fontSize

  /* ---- OXFORD family resolution (DESIGN.md §4) ---- */
  let fam: Fam
  if (!fontsReady) {
    fam = { fontWeight: String(w) as TextStyle['fontWeight'] }
  } else if (mono) {
    fam = { fontFamily: monoFace(w) }
  } else if (ayah) {
    /* Ayah/Quranic blocks stay Amiri 400 — never bolded. */
    fam = { fontFamily: 'Amiri_400Regular' }
  } else if (serif || spec.family === 'display') {
    /* The serif voice: Lora for Latin; Arabic/Kurdish runs (and Latin
       snippets in an ar/ckb UI) wear Amiri so headlines never zebra
       between two families mid-line. */
    fam = (arabic || arabicUI)
      ? { fontFamily: amiriFace(w) }
      : { fontFamily: loraFace(w, italic) }
  } else {
    /* UI text: IBM Plex Sans for Latin, Vazirmatn for Arabic script —
       small-size UI strings need a sans, exactly like the web stack. */
    fam = (arabic || arabicUI)
      ? { fontFamily: vazirmatnFace(w) }
      : { fontFamily: plexFace(w) }
  }

  const caps = (capsProp ?? (spec as { caps?: boolean }).caps === true) && !arabic && !arabicUI
  /* A de-capsed caption/micro is running text again — the eyebrow tracking
     would read as gappy lowercase, so it stands down with the transform. */
  const letterSpacing = arabic ? 0 : caps === false && (spec as { caps?: boolean }).caps ? 0.2 : spec.letterSpacing
  /* Static italic faces carry their own slant; only synthesize on the rest. */
  const synthItalic = italic && !('fontFamily' in fam && fam.fontFamily.includes('Italic'))

  return (
    <RNText
      /* The app scales type itself rather than letting RN do it per-Text:
         `t.type` is already multiplied by prefs.fontScale, which folds the
         user's in-app setting AND the phone's Dynamic Type / font-size
         setting together (ThemeProvider.foldOsA11y). Leaving this on would
         apply the phone's factor a SECOND time. Absolute line heights are
         why it has to happen there and not here — they must scale in step
         with the size, and RN scales only the size. */
      allowFontScaling={false}
      {...rest}
      style={[
        {
          fontSize,
          lineHeight: reading ? t.reading.lineHeight : spec.lineHeight,
          letterSpacing,
          ...fam,
          color: toneColor,
          textAlign,
          ...(caps ? { textTransform: 'uppercase' as const } : null),
          ...(t.isRTL ? { writingDirection: 'rtl' as const } : null),
          ...(synthItalic ? { fontStyle: 'italic' as const } : null),
          ...(decoration !== 'none' ? { textDecorationLine: decoration as TextStyle['textDecorationLine'] } : null),
        },
        style,
        /* HARD RULE clamp (§4, DON'T #5) — appended AFTER the caller style so
           it cannot be overridden: Arabic-script runs are never tracked, and
           no run is uppercased in an ar/ckb locale. Without this the
           guarantee above is advisory the moment a call site passes
           letterSpacing or textTransform through `style`. */
        (arabic || arabicUI)
          ? {
            ...(arabic ? { letterSpacing: 0 } : null),
            textTransform: 'none' as const,
          }
          : null,
      ]}
    >
      {children}
    </RNText>
  )
}

/* ---------------------------------------------------------
   Named shorthands. These exist so a screen reads as prose
   (`<Title2>`) instead of as configuration (`variant="title2"`),
   and so a grep for a heading level finds every use.
   --------------------------------------------------------- */
const make = (variant: TypeKey) =>
  function Named(props: Omit<TextProps, 'variant'>) { return <Text variant={variant} {...props} /> }

export const Display = make('display')
export const Title1 = make('title1')
export const Title2 = make('title2')
export const Title3 = make('title3')
export const Headline = make('headline')
export const Body = make('body')
export const BodyStrong = make('bodyStrong')
export const Callout = make('callout')
export const Subhead = make('subhead')
export const Footnote = make('footnote')
export const Caption = make('caption')
export const Micro = make('micro')

/** A number that must not reflow as it counts up (likes, viewers, unread).
 *  Tabular figures keep the width stable so neighbours do not jitter. */
export function NumericText(props: TextProps) {
  return <Text {...props} style={[styles.tabular, props.style]} />
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
})
