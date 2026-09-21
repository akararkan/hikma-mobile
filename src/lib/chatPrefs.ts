/* =========================================================
   Chat preferences — the RN port of lib/chatPrefs.js.

   MessageSettings is [C] client-owned: the backend stores
   wallpaper / chatTheme / fontSize / enterToSend verbatim and
   interprets none of them, so turning them into pixels is
   entirely a client job.

   The web version published three CSS hooks and shipped a
   <style> tag to give them meaning. There is no cascade here,
   so the hooks become resolved VALUES that the chat screens
   read off a hook — same contract, one indirection fewer.

   The rules that carry over unchanged:
     · every default resolves to "no change"
     · the theme tint touches the INCOMING bubble only. Own
       bubbles are the brand fill with a whole family of
       light-on-dark children (meta, ticks, voice bars, file
       glyphs) hanging off them; repainting those from here
       would leave every one illegible
     · a whole-block PUT nulls anything omitted, so
       MESSAGE_DEFAULTS has to stay complete
   ========================================================= */
import React from 'react'
import { api } from '@/api'
import { storage } from '@/platform/storage'
import { emit, on, PREFS_EVENT } from '@/platform/appEvents'
import { useTheme } from '@/theme/ThemeProvider'

const CACHE_KEY = 'ika_chat_prefs_cache'

/** The exact entity defaults (MessageSettings.java). */
export const MESSAGE_DEFAULTS = {
  wallpaper: 'DEFAULT',
  chatTheme: 'DEFAULT',
  fontSize: 'MEDIUM',
  enterToSend: true,
} as const

/* wallpaper is "a media id, a preset key, or a hex colour" on the wire. This
   client writes the HEX, but a preset KEY written by another client must still
   resolve — hence both columns. [key, light hex, dark hex, label] */
export const WALLPAPER_PRESETS: [string, string, string, string][] = [
  ['PORCELAIN', '#F2F0F0', '#14161A', 'Porcelain'],
  ['SKY', '#DCE9F6', '#101A24', 'Sky'],
  ['SAGE', '#E4EDE9', '#101A16', 'Sage'],
  ['PARCHMENT', '#F5EAD7', '#1C170E', 'Parchment'],
  ['MIDNIGHT', '#E6E8F2', '#0B0D16', 'Midnight'],
]

/* fontSize is SMALL | MEDIUM | LARGE (a free string server-side) — anything
   unknown falls back to 1, i.e. no change at all. */
export const CHAT_FONT_SCALE: Record<string, number> = { SMALL: 0.94, MEDIUM: 1, LARGE: 1.1 }

/* chatTheme → the incoming-bubble fill. Pairs only: both entries flip with
   the colour scheme, so neither can land as a light fill under dark ink.
   OXFORD and SKY are the web's exact pairs (lib/chatPrefs.js: --wash and
   --brass-soft, light/dark) so the same stored theme paints the same bubble
   on both clients; SAGE and ROSE are mobile-only extras a synced pref must
   keep resolving. */
export const CHAT_THEMES: Record<string, { light: string; dark: string; label: string }> = {
  DEFAULT: { light: '', dark: '', label: 'Default' },
  OXFORD: { light: '#E7EFF8', dark: '#152A42', label: 'Oxford' },
  SKY: { light: '#B9D6F2', dark: '#2E4A68', label: 'Sky' },
  SAGE: { light: '#E3F0E8', dark: '#11291D', label: 'Sage' },
  ROSE: { light: '#F8E7EC', dark: '#331A22', label: 'Rose' },
}

export interface ChatPrefs {
  wallpaper: string
  chatTheme: string
  fontSize: string
  enterToSend: boolean
}

let current: ChatPrefs = { ...MESSAGE_DEFAULTS }
let loaded = false
let inflight: Promise<ChatPrefs> | null = null

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function normalize(block: any): ChatPrefs {
  return {
    wallpaper: typeof block?.wallpaper === 'string' && block.wallpaper ? block.wallpaper : MESSAGE_DEFAULTS.wallpaper,
    chatTheme: typeof block?.chatTheme === 'string' && block.chatTheme ? String(block.chatTheme).toUpperCase() : MESSAGE_DEFAULTS.chatTheme,
    fontSize: typeof block?.fontSize === 'string' && block.fontSize ? String(block.fontSize).toUpperCase() : MESSAGE_DEFAULTS.fontSize,
    enterToSend: block?.enterToSend !== false,
  }
}

/** Read the cache synchronously — a chat screen must not flash the default
 *  wallpaper before the settings round trip lands. */
export function readCachedChatPrefs(): ChatPrefs {
  if (loaded) return current
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (raw) { current = normalize(JSON.parse(raw)); loaded = true }
  } catch { /* ignore */ }
  return current
}

/** enterToSend is read by JS, not styling: composers call this rather than
 *  re-parsing the block. */
export function enterToSend(): boolean { return readCachedChatPrefs().enterToSend }

export async function loadChatPrefs(): Promise<ChatPrefs> {
  if (inflight) return inflight
  inflight = api.settings.section('messages')
    .then((block: any) => {
      current = normalize(block)
      loaded = true
      try { storage.setItem(CACHE_KEY, JSON.stringify(current)) } catch { /* ignore */ }
      return current
    })
    .catch(() => current)
    .finally(() => { inflight = null })
  return inflight
}

/** Apply locally without waiting for the server — the settings screen writes
 *  in parallel, but the preview has to change on the tap. */
export function setChatPrefsLocal(patch: Partial<ChatPrefs>) {
  current = normalize({ ...current, ...patch })
  loaded = true
  try { storage.setItem(CACHE_KEY, JSON.stringify(current)) } catch { /* ignore */ }
  emit(PREFS_EVENT)
}

/* ---------------------------------------------------------
   The hook the chat screens actually use: resolved pixels,
   not stored strings.
   --------------------------------------------------------- */

export interface ResolvedChatSkin {
  prefs: ChatPrefs
  /** The conversation background. */
  wallpaper: string
  /** Incoming-bubble fill; own bubbles stay the brand colour. */
  bubbleIn: string
  bubbleInText: string
  bubbleOut: string
  bubbleOutText: string
  /** Multiply message text sizes by this. */
  fontScale: number
  enterToSend: boolean
  reload: () => void
}

export function useChatSkin(): ResolvedChatSkin {
  const t = useTheme()
  const [prefs, setPrefs] = React.useState<ChatPrefs>(readCachedChatPrefs)

  React.useEffect(() => {
    void loadChatPrefs().then(setPrefs)
    return on(PREFS_EVENT, () => setPrefs({ ...current }))
  }, [])

  return React.useMemo(() => {
    const dark = t.scheme === 'dark'

    /* wallpaper: a hex the user picked, else a preset key, else the theme's
       own chat background. */
    let wallpaper = t.colors.chatWallpaper
    if (HEX.test(prefs.wallpaper)) {
      wallpaper = prefs.wallpaper
    } else if (prefs.wallpaper !== 'DEFAULT') {
      const preset = WALLPAPER_PRESETS.find(p => p[0] === prefs.wallpaper)
      if (preset) wallpaper = dark ? preset[2] : preset[1]
    }

    const theme = CHAT_THEMES[prefs.chatTheme] || CHAT_THEMES.DEFAULT
    const tint = dark ? theme.dark : theme.light

    return {
      prefs,
      wallpaper,
      bubbleIn: tint || t.colors.bubbleIn,
      bubbleInText: t.colors.bubbleInText,
      bubbleOut: t.colors.bubbleOut,
      bubbleOutText: t.colors.bubbleOutText,
      fontScale: CHAT_FONT_SCALE[prefs.fontSize] ?? 1,
      enterToSend: prefs.enterToSend,
      reload: () => { void loadChatPrefs().then(setPrefs) },
    }
  }, [prefs, t])
}
