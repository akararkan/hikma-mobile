/* =========================================================
   The product's name, in the three languages it is read in.

   One module, because the name is now three strings rather
   than one word, and because a rename must never again mean
   hunting sixty literals. Anything a PERSON reads comes from
   here; anything a MACHINE reads — the bundle id
   `com.ika.mobile`, the Expo slug, the MMKV key prefix, the
   wire user-agent — deliberately did NOT change with the name
   and must stay where it is. A technical identity that follows
   its brand is how an app loses its installs, its push tokens
   and its App Store record in one afternoon.

   The endonyms are the author's own, verbatim. Do not
   transliterate them, do not "fix" the spelling, and do not
   reorder the words: تۆڕی حیکمە is Kurdish (Sorani) and
   شبكة الحكمة is Arabic, and both read right-to-left — the
   Text primitive resolves Amiri / Vazirmatn for them on its
   own, so no call site sets a fontFamily for these.
   ========================================================= */

/** English, and the name the app is published under. */
export const APP_NAME = 'Hikmah Web'
/** Kurdish (Sorani) — RTL. */
export const APP_NAME_KU = 'تۆڕی حیکمە'
/** Arabic — RTL. */
export const APP_NAME_AR = 'شبكة الحكمة'

/** The two endonyms, in the order the brand states them. */
export const APP_ENDONYMS = [APP_NAME_KU, APP_NAME_AR] as const

/** The name for the language the reader has chosen, falling back to English.
 *  Takes the app's own wire codes (settings/language.tsx: EN | AR | KU). */
export function appNameFor(lang: string | null | undefined): string {
  switch (String(lang || '').toUpperCase()) {
    case 'AR': return APP_NAME_AR
    case 'KU': return APP_NAME_KU
    default: return APP_NAME
  }
}
