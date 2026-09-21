/* =========================================================
   ThemeProvider — the one place a screen learns what things
   should look like.

   It owns five inputs and folds them into a single `Theme`:

     1. the OS colour scheme (useColorScheme, live)
     2. the user's `appearance`/`accessibility` blocks, which
        arrive from the settings API and cache locally so a
        cold launch does not flash the wrong surface
     3. the PHONE's own accessibility settings (theme/osA11y) —
        Reduce Motion, Dynamic Type, Bold Text, screen reader
     4. text direction, derived from the content language
        (Arabic and Kurdish are RTL)
     5. the density + font-scale multipliers

   (2) and (3) are folded together into ONE resolved block before
   anything reads it, which is what makes the settings screen's
   promise ("we follow these too — turning something on here ADDS
   to your phone's setting") true everywhere at once. Every
   animation site in the app reads `t.prefs.reducedMotion` and
   every string sizes off `t.type`, so the fold happens here and
   no screen needs to know the phone was asked as well.

   Screens read it with `useTheme()`. Anything that needs only
   colours can use `useColors()`, which is the same object.
   ========================================================= */
import React from 'react'
import { I18nManager, useColorScheme, type TextStyle } from 'react-native'
import { contrastRatio, inkOn, mixHex, palettes, withAlpha, type ColorScheme, type Palette } from './colors'
import { alpha, layout, motion, ornament, radius, rule, shadows, shape, space, type as typeScale, readingType, zIndex } from './tokens'
import {
  DEFAULT_PREFS, PREF_SCALE_BOUNDS, adoptPrefs, loadPrefs, onPrefsChanged, readCachedPrefs,
  type ResolvedPrefs, type ThemeChoice,
} from './prefs'
import { useOsA11y, type OsA11y } from './osA11y'

export type Direction = 'ltr' | 'rtl'

export interface Theme {
  colors: Palette
  scheme: ColorScheme
  /** The user's choice, which may be SYSTEM — not the resolved scheme. */
  themeChoice: ThemeChoice
  dir: Direction
  isRTL: boolean
  language: ResolvedPrefs['language']
  /** The user's request and the phone's, already folded together. Read
   *  `prefs.reducedMotion` / `prefs.fontScale` and you get both. */
  prefs: ResolvedPrefs
  /** The phone's raw accessibility state. Reduce Motion and text size are
   *  already folded into `prefs`; read this for the parts with no in-app
   *  equivalent — chiefly `screenReader`, which should suppress autoplay,
   *  auto-advance and anything else that moves without a user asking. */
  a11y: OsA11y

  space: typeof space
  radius: typeof radius
  /** Per-surface corner maps — uniform Oxford radii (DESIGN.md §3). */
  shape: typeof shape
  /** Stroke widths for hairlines and borders. */
  rule: typeof rule
  /** Legacy ornament opacities — retired textures, kept for call sites. */
  ornament: typeof ornament
  motion: typeof motion
  alpha: typeof alpha
  zIndex: typeof zIndex
  layout: typeof layout

  /** Type ramp with the user's font scale already applied. */
  type: typeof typeScale
  reading: { fontSize: number; lineHeight: number }
  /** Multiply any hardcoded font size by this to respect the setting. */
  fontScale: number
  /** 1 in comfortable density, ~0.82 in compact — multiply vertical padding. */
  densityScale: number

  /** Duration helper: returns 0 when the user asked for reduced motion, so
   *  `withTiming(v, { duration: t.ms(240) })` degrades to a cut everywhere. */
  ms: (n: number) => number
  /** Oxford depth — quiet slate shadows: 1 = resting card, 2 = menu/popover,
   *  3+ = sheet/dialog. Returns iOS shadow* + Android elevation. */
  shadow: (level: 0 | 1 | 2 | 3 | 4) => object
  /** `start`/`end` aware horizontal inset. */
  inset: (start: number, end?: number) => { paddingStart: number; paddingEnd: number }

  setThemeChoice: (c: ThemeChoice) => void
  refreshPrefs: () => Promise<void>
}

const ThemeCtx = React.createContext<Theme | null>(null)

export function useTheme(): Theme {
  const t = React.useContext(ThemeCtx)
  if (!t) throw new Error('useTheme() outside <ThemeProvider>')
  return t
}

/** Colours only — the common case, and the shortest call site. */
export function useColors(): Palette { return useTheme().colors }

/* ---------------------------------------------------------
   High contrast pushes the two ends of the text ramp apart
   and hardens every hairline. It is a transform on the
   palette rather than a third palette so the two never drift.
   --------------------------------------------------------- */
function harden(p: Palette): Palette {
  const dark = p.scheme === 'dark'
  return {
    ...p,
    /* Cool slate extremes, not pure #FFF/#000 — the Oxford neutrals are
       slate, and high contrast must stay in the same temperature. These hold
       ≥16:1 on their grounds (AAA needs 7:1). */
    text: dark ? '#F4F7FA' : '#0E131C',
    textSecondary: dark ? '#DDE5EC' : '#2E3745',
    textMuted: dark ? '#B9C5D2' : '#3E4857',
    textFaint: dark ? '#9FAEC0' : '#4D5768',
    border: dark ? 'rgba(232,237,243,0.34)' : '#8B94A1',
    borderStrong: dark ? 'rgba(232,237,243,0.52)' : '#4D5768',
    borderFaint: dark ? 'rgba(232,237,243,0.22)' : '#AEB4BC',
    separator: dark ? 'rgba(232,237,243,0.26)' : '#AEB4BC',
  }
}

/** The user's accent replaces exactly six roles (DESIGN.md §2 recolor):
 *  accent, accentPressed, accentSoft, accentSofter, accentText, link — plus
 *  the luminance-computed on-accent ink. Pressed darkens on light and
 *  brightens on dark. The white/off-white grounds, status hues, sky,
 *  cerulean and the bubbles never follow a user accent. */
function recolor(p: Palette, accent: string | null): Palette {
  if (!accent) return p
  const dark = p.scheme === 'dark'
  const bg = dark ? '#0A121C' : '#FFFFFF'

  /* accentText: nudge toward legibility until it clears 4.5:1 on bg. */
  let accentText = accent
  for (let i = 0; i < 12 && contrastRatio(accentText, bg) < 4.5; i++) {
    accentText = mixHex(dark ? '#FFFFFF' : '#000000', accentText, 0.08)
  }

  const accentSoft = mixHex(accent, bg, dark ? 0.28 : 0.10)
  return {
    ...p,
    accent,
    accentPressed: dark ? mixHex('#FFFFFF', accent, 0.14) : mixHex('#000000', accent, 0.12),
    accentSoft,
    accentSofter: dark ? withAlpha(accentSoft, 0.55) : withAlpha(accent, 0.06),
    accentText,
    link: accentText,
    textOnAccent: inkOn(accent),
  }
}

/* Oxford depth: quiet slate-ink shadows (tokens.shadows). Levels map to the
   web's three steps — 1 ≈ shadow-sm (resting cards), 2 ≈ shadow (menus,
   popovers, raised cards), 3–4 ≈ shadow-lg (sheets, dialogs). */
const SHADOW_LEVELS = [shadows.none, shadows.sm, shadows.md, shadows.lg, shadows.lg] as const

function scaleType(base: typeof typeScale, f: number): typeof typeScale {
  if (f === 1) return base
  const out: any = {}
  for (const k of Object.keys(base) as (keyof typeof typeScale)[]) {
    const v = base[k]
    out[k] = {
      ...v,
      fontSize: Math.round(v.fontSize * f * 10) / 10,
      lineHeight: Math.round(v.lineHeight * f * 10) / 10,
    }
  }
  return out
}

/* The combined range for `in-app scale × phone scale`, taken verbatim from
   what the in-app block could already produce on its own (theme/prefs
   PREF_SCALE_BOUNDS ≈ 0.736 … 1.784).

   This is the whole safety argument for folding the phone's Dynamic Type
   setting in. iOS reaches ~3.1 at AX5 and Android ~2.0, and this app's chrome
   — header, tab bar, avatars, row heights — is fixed dp, so passing those
   through raw would break layouts that have never had to survive them.
   Clamping to the in-app range instead means the phone can only move a user
   somewhere the design system already had to render correctly. Raising the
   ceiling is a layout project (every fixed height in `layout` becomes a
   function of the scale), not a constant edit. */
const SCALE_MIN = PREF_SCALE_BOUNDS.min
const SCALE_MAX = PREF_SCALE_BOUNDS.max

/** Fold the phone's accessibility state into the user's account block.
 *  Additive in both directions, exactly as the settings screen says: either
 *  source can ask for reduced motion, and the two text scales multiply. */
function foldOsA11y(prefs: ResolvedPrefs, os: OsA11y): ResolvedPrefs {
  const fontScale = Math.round(
    Math.min(SCALE_MAX, Math.max(SCALE_MIN, prefs.fontScale * os.fontScale)) * 1e4,
  ) / 1e4
  /* Identity is load-bearing: `prefs` is a useMemo dep below and the sole
     dep of the adoptPrefs effect, so an unchanged fold must return the
     SAME object rather than an equal one. */
  if (fontScale === prefs.fontScale && (!os.reduceMotion || prefs.reducedMotion)) return prefs
  return { ...prefs, fontScale, reducedMotion: prefs.reducedMotion || os.reduceMotion }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const os = useColorScheme()
  const osA11y = useOsA11y()
  /* Boot from the cache so the first frame is already correct. */
  const [stored, setStored] = React.useState<ResolvedPrefs>(() => readCachedPrefs() ?? DEFAULT_PREFS)

  /* What the rest of the app means by "the user's preferences": their account
     block with the phone's own settings already folded in. */
  const prefs = React.useMemo(() => foldOsA11y(stored, osA11y), [stored, osA11y])

  /* The synchronous readers (prefersReducedMotion, prefersHaptics) answer
     from this — so they see the folded value too, not just the account one. */
  React.useEffect(() => { adoptPrefs(prefs) }, [prefs])

  const refreshPrefs = React.useCallback(async () => {
    const next = await loadPrefs()
    /* A failed refresh must never revert the user to defaults. */
    if (next) setStored(next)
  }, [])

  /* Re-read whenever a cosmetic write announces itself. */
  React.useEffect(() => onPrefsChanged(() => { void refreshPrefs() }), [refreshPrefs])

  /** Local, immediate theme flip — the settings screen writes the server in
   *  parallel, but the surface must change on the tap, not on the round trip. */
  const setThemeChoice = React.useCallback((themeChoice: ThemeChoice) => {
    setStored(p => ({ ...p, theme: themeChoice }))
  }, [])

  const value = React.useMemo<Theme>(() => {
    const scheme: ColorScheme =
      prefs.theme === 'DARK' ? 'dark'
        : prefs.theme === 'LIGHT' ? 'light'
          : os === 'dark' ? 'dark' : 'light'

    let colors = palettes[scheme]
    if (prefs.highContrast) colors = harden(colors)
    colors = recolor(colors, prefs.accentColor)

    const isRTL = prefs.language === 'AR' || prefs.language === 'KU'
    const densityScale = prefs.density === 'COMPACT' ? 0.82 : 1

    return {
      colors,
      scheme,
      themeChoice: prefs.theme,
      dir: isRTL ? 'rtl' : 'ltr',
      isRTL,
      language: prefs.language,
      prefs,
      a11y: osA11y,

      space, radius, shape, rule, ornament, motion, alpha, zIndex, layout,

      type: scaleType(typeScale, prefs.fontScale),
      reading: {
        fontSize: Math.round(readingType.fontSize * prefs.fontScale * 10) / 10,
        lineHeight: Math.round(readingType.lineHeight * prefs.fontScale * 10) / 10,
      },
      fontScale: prefs.fontScale,
      densityScale,

      ms: (n: number) => (prefs.reducedMotion ? 0 : n),
      shadow: (level) => SHADOW_LEVELS[level] as object,
      inset: (start: number, end = start) => ({ paddingStart: start, paddingEnd: end }),

      setThemeChoice,
      refreshPrefs,
    }
  }, [prefs, os, osA11y, setThemeChoice, refreshPrefs])

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

/* ---------------------------------------------------------
   Direction.

   `I18nManager.forceRTL` needs an app RELOAD to take effect,
   so flipping it live would leave the tree half-mirrored. The
   design system therefore never depends on I18nManager: every
   component uses logical properties (`start`/`end`,
   `marginStart`, `textAlign: 'start'`… ) and reads `dir` from
   the theme for the handful of cases logical properties do not
   cover (chevron glyphs, swipe directions, carousel maths).

   Exported so a settings screen can offer the reload-required
   native mirror as an explicit, honest action.
   --------------------------------------------------------- */
export const nativeRTL = {
  isForced: () => I18nManager.isRTL,
  /** Returns true when a reload is required for the change to land. */
  force(rtl: boolean): boolean {
    if (I18nManager.isRTL === rtl) return false
    I18nManager.allowRTL(rtl)
    I18nManager.forceRTL(rtl)
    return true
  },
}

/** `textAlign` that follows the reading direction of the CONTENT, not the UI.
 *  A user reading an English UI still wants an Arabic quote right-aligned. */
export function autoAlign(text: string | null | undefined, dir: Direction): TextStyle['textAlign'] {
  if (!text) return dir === 'rtl' ? 'right' : 'left'
  /* First strong character wins, matching `dir="auto"` in the browser. */
  const m = /[\p{L}]/u.exec(text)
  if (!m) return dir === 'rtl' ? 'right' : 'left'
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]) ? 'right' : 'left'
}

export { palettes, type Palette, type ColorScheme }
