/* =========================================================
   Preference applier — the RN port of lib/prefs.js.

   The backend stores `appearance` / `accessibility` verbatim
   and never interprets them, so applying them is entirely a
   client job. On the web that meant attributes and custom
   properties on <html>. There is no <html> here, so the
   translation target is a plain object that ThemeProvider
   turns into a palette + a scale factor.

   The contract is preserved exactly, including the rule that
   every default resolves to "no change": a user on defaults
   renders the untouched design system.

   Two accessibility toggles are read by other modules rather
   than by the renderer, and keep their synchronous readers:
     prefersHaptics()   accessibility.hapticFeedback
     prefersCaptions()  accessibility.closedCaptions
   ========================================================= */
import { api } from '@/api'
import { storage } from '@/platform/storage'
import { emit, on, PREFS_EVENT } from '@/platform/appEvents'

/** Emitted after writing `appearance` / `accessibility` so the applier can
 *  re-run. The web dispatched this on `window`; `chatPrefs` and `mediaTier`
 *  listen on the same name, so it comes from appEvents rather than being
 *  redeclared here. */
export { PREFS_EVENT }

const CACHE_KEY = 'ika_prefs_cache'

/* AppearanceSettings.fontSize is a free string server-side
   (SMALL | MEDIUM | LARGE | XLARGE, default MEDIUM) — anything
   unknown falls back to 1. */
const FONT_SCALE: Record<string, number> = { SMALL: 0.92, MEDIUM: 1, LARGE: 1.09, XLARGE: 1.18 }
const LARGE_TEXT_BOOST = 1.08
/* interfaceScale is a Double the backend documents as 0.8–1.4. */
const INTERFACE_SCALE_MIN = 0.8
const INTERFACE_SCALE_MAX = 1.4
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export type ThemeChoice = 'SYSTEM' | 'LIGHT' | 'DARK'
export type Density = 'COMFORTABLE' | 'COMPACT'

export interface ResolvedPrefs {
  theme: ThemeChoice
  density: Density
  highContrast: boolean
  reducedMotion: boolean
  /** fontSize × largeText × interfaceScale, clamped. 1 = untouched. */
  fontScale: number
  /** A validated `#rgb`/`#rrggbb`, or null to keep the brand blue. */
  accentColor: string | null
  haptics: boolean
  captions: boolean
  /** Content language for trilingual vocabularies + RTL. */
  language: 'EN' | 'AR' | 'KU'
}

export const DEFAULT_PREFS: ResolvedPrefs = {
  theme: 'SYSTEM',
  density: 'COMFORTABLE',
  highContrast: false,
  reducedMotion: false,
  fontScale: 1,
  accentColor: null,
  haptics: true,
  captions: false,
  language: 'EN',
}

/** interfaceScale is a Double, documented range 0.8–1.4. Null / absent
 *  (Jackson NON_NULL drops it) and junk both mean "no scaling". */
function clampScale(n: unknown): number {
  if (n == null || n === '') return 1
  const v = Number(n)
  if (!Number.isFinite(v)) return 1
  return Math.min(INTERFACE_SCALE_MAX, Math.max(INTERFACE_SCALE_MIN, v))
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/* The extremes this block can reach on its own: fontSize × largeText ×
   interfaceScale at each end. `largeText` only ever multiplies UP, so it is
   absent from the floor.

   ThemeProvider clamps the OS-folded scale to exactly this range, which is
   what makes folding the phone's Dynamic Type setting in a safe change:
   honouring it can only move a user WITHIN the span the design system already
   had to render correctly, never past it. Derived rather than written down so
   the two cannot drift when a step is retuned. */
export const PREF_SCALE_BOUNDS = {
  min: round4(Math.min(...Object.values(FONT_SCALE)) * INTERFACE_SCALE_MIN),
  max: round4(Math.max(...Object.values(FONT_SCALE)) * LARGE_TEXT_BOOST * INTERFACE_SCALE_MAX),
} as const

/* ---------- toggles other modules read synchronously ---------- */
let current: ResolvedPrefs = { ...DEFAULT_PREFS }

/** accessibility.hapticFeedback — false means the app must not vibrate. */
export function prefersHaptics() { return current.haptics }
/** accessibility.closedCaptions — true means request/show captions by default. */
export function prefersCaptions() { return current.captions }
/** appearance|accessibility.reducedMotion — animations must degrade to cuts. */
export function prefersReducedMotion() { return current.reducedMotion }
/** The last applied block, for anything that needs it off the render path. */
export function currentPrefs(): ResolvedPrefs { return current }

/** Translate one settings object into the resolved shape.
 *  Any part may be missing; unknown values degrade to the default. */
export function resolvePrefs(settings: any): ResolvedPrefs {
  const app = settings?.appearance || {}
  const acc = settings?.accessibility || {}

  let theme = String(app.theme || 'SYSTEM').toUpperCase() as ThemeChoice
  if (theme !== 'DARK' && theme !== 'LIGHT') theme = 'SYSTEM'

  const base = FONT_SCALE[String(app.fontSize || '').toUpperCase()] ?? 1
  const fontScale = round4(base * (acc.largeText ? LARGE_TEXT_BOOST : 1) * clampScale(app.interfaceScale))

  const rawAccent = typeof app.accentColor === 'string' ? app.accentColor.trim() : ''

  const rawLang = String(app.language || settings?.language || 'EN').toUpperCase()
  const language: ResolvedPrefs['language'] =
    rawLang === 'AR' ? 'AR' : (rawLang === 'KU' || rawLang === 'CKB' || rawLang === 'KRD') ? 'KU' : 'EN'

  return {
    theme,
    density: String(app.density || '').toUpperCase() === 'COMPACT' ? 'COMPACT' : 'COMFORTABLE',
    highContrast: !!acc.highContrast,
    /* Either block can ask for it. */
    reducedMotion: !!(app.reducedMotion || acc.reducedMotion),
    fontScale,
    accentColor: HEX.test(rawAccent) ? rawAccent : null,
    /* Absent (Jackson NON_NULL drops it) keeps the platform default rather
       than flipping to false. */
    haptics: acc.hapticFeedback !== false,
    captions: !!acc.closedCaptions,
    language,
  }
}

/** Set the module-level cache the synchronous readers answer from. */
export function adoptPrefs(p: ResolvedPrefs) { current = p }

/** The last cached blocks, read synchronously so boot does not flash the
 *  default sizing or a light surface on a dark-mode launch. Never throws. */
export function readCachedPrefs(): ResolvedPrefs | null {
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached || typeof cached !== 'object') return null
    return resolvePrefs(cached)
  } catch { return null }
}

/* An older in-flight response must never stomp a newer one's application
   (two PREFS_EVENTs in quick succession can overlap). */
let seq = 0

/** Fetch the live settings and resolve them. Returns null on any failure —
 *  in which case the caller must leave the current prefs exactly as they
 *  were (a failed refresh should never revert the user to defaults). */
export async function loadPrefs(): Promise<ResolvedPrefs | null> {
  const mine = ++seq
  try {
    const res = await api.settings.all()
    if (!res || typeof res !== 'object') return null
    if (mine !== seq) return null                    // a newer load already applied
    const resolved = resolvePrefs(res)
    try {
      storage.setItem(CACHE_KEY, JSON.stringify({
        appearance: res.appearance || null,
        accessibility: res.accessibility || null,
        settingsVersion: res.settingsVersion ?? null,
      }))
    } catch { /* the resolve still worked */ }
    return resolved
  } catch {
    return null
  }
}

/** Announce a cosmetic write so ThemeProvider re-reads the server. */
export function notifyPrefsChanged() { emit(PREFS_EVENT) }
export function onPrefsChanged(fn: () => void) { return on(PREFS_EVENT, fn) }
