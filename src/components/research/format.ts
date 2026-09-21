/* =========================================================
   Domain formatting — the small conversions the research
   surfaces would otherwise each re-derive slightly differently.
   ========================================================= */
import { formatBytes as sharedFormatBytes } from '@/lib/format'
import type { Palette } from '@/theme/colors'
import type { MediaFile } from './types'

/* The scholarly voices resolve INSIDE the Text primitive (§4): pass `serif`
   (Lora, Arabic-swapped) or `mono` (IBM Plex Mono) — never a raw
   fontFamily. The old Georgia/Menlo constants that lived here bypassed the
   QELAT family system and left Arabic serif runs to per-glyph fallback. */

/* A thin skin over src/lib/format.ts. The body used to live here and rounded
   KB to a whole number, so 1536 bytes read "2 KB" on a paper's file row and
   "1.5 KB" on the same file attached to an answer. The shared one wins; what
   stays local is the EMPTY string for a missing size, which FileRow /
   files.tsx / edit-sources rely on to make the segment vanish out of their
   ' · '-joined metadata line rather than print "0 B". */
export function formatBytes(n: number | null | undefined): string {
  return sharedFormatBytes(n, { zero: '' })
}

/* Cached formatters. Every `toLocale*` call that carries an options bag builds
   a fresh Intl.DateTimeFormat internally — on Hermes that is ICU pattern
   resolution, an order of magnitude dearer than formatting through an
   instance that already exists. These run once per dashboard row and once per
   scheduled-publish line, so they are on a scroll path. */
const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** "21 May 2026" — the date line under a paper title. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return DATE.format(d)
}

/** "12 Aug 2026, 09:00" — schedules, which need the time too. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${DATE.format(d)}, ${CLOCK.format(d)}`
}

/* mm:ss — character-identical to the qna and search copies, so it moved to
   src/lib/format.ts. Re-exported so promo.tsx, file/[mediaId].tsx and
   edit/media.tsx keep importing it from here. */
export { formatDuration } from '@/lib/format'

export function yearOf(iso: string | null | undefined): string {
  if (!iso) return String(new Date().getFullYear())
  const d = new Date(iso)
  return isNaN(d.getTime()) ? String(new Date().getFullYear()) : String(d.getFullYear())
}

export function extOf(name: string | null | undefined): string {
  const e = String(name || '').split('.').pop() || ''
  return e.length <= 4 ? e.toUpperCase() : 'FILE'
}

/* The nine media types the backend groups files under, in the order the files
   screen renders them: readers want the paper's data before its decoration. */
export const MEDIA_TYPE_ORDER: MediaFile['type'][] = [
  'DOCUMENT', 'DATASET', 'SPREADSHEET', 'CODE', 'ARCHIVE', 'IMAGE', 'VIDEO', 'AUDIO', 'OTHER',
]

export const MEDIA_TYPE_LABEL: Record<string, string> = {
  DOCUMENT: 'Documents', DATASET: 'Datasets', SPREADSHEET: 'Spreadsheets', CODE: 'Code',
  ARCHIVE: 'Archives', IMAGE: 'Figures', VIDEO: 'Video', AUDIO: 'Audio', OTHER: 'Other',
}

/** A file tile's tint. Roles only — the palette owns the hues. */
export function fileTint(c: Palette, type: string | null | undefined): { bg: string; fg: string } {
  switch (String(type || '').toUpperCase()) {
    case 'DOCUMENT': return { bg: c.dangerSoft, fg: c.dangerText }
    case 'SPREADSHEET': return { bg: c.successSoft, fg: c.successText }
    case 'DATASET': return { bg: c.scholarSoft, fg: c.scholarText }
    case 'ARCHIVE': return { bg: c.warningSoft, fg: c.warningText }
    case 'IMAGE': return { bg: c.accentSoft, fg: c.accentText }
    case 'VIDEO': return { bg: c.accentSoft, fg: c.accentText }
    case 'AUDIO': return { bg: c.infoSoft, fg: c.infoText }
    default: return { bg: c.surfaceSunken, fg: c.textSecondary }
  }
}

export const CONTRIBUTOR_ROLE_LABEL: Record<string, string> = {
  CO_AUTHOR: 'Co-author', ADVISOR: 'Advisor', REVIEWER: 'Reviewer',
  TRANSLATOR: 'Translator', EDITOR: 'Editor', CONTRIBUTOR: 'Contributor',
}

export function contributorTint(c: Palette, role: string | null | undefined): { bg: string; fg: string } {
  switch (String(role || '').toUpperCase()) {
    case 'CO_AUTHOR': return { bg: c.accentSoft, fg: c.accentText }
    case 'ADVISOR': return { bg: c.scholarSoft, fg: c.scholarText }
    case 'REVIEWER': return { bg: c.successSoft, fg: c.successText }
    case 'TRANSLATOR': return { bg: c.warningSoft, fg: c.warningText }
    case 'EDITOR': return { bg: c.infoSoft, fg: c.infoText }
    default: return { bg: c.surfaceSunken, fg: c.textSecondary }
  }
}

/** The four content kinds a tag feed can carry, tinted apart at a glance. */
export function contentTypeTint(c: Palette, type: string | null | undefined): { bg: string; fg: string } {
  switch (String(type || '').toUpperCase()) {
    case 'POST': return { bg: c.accentSoft, fg: c.accentText }
    case 'REEL': return { bg: c.dangerSoft, fg: c.dangerText }
    case 'QUESTION': return { bg: c.successSoft, fg: c.successText }
    case 'RESEARCH': return { bg: c.scholarSoft, fg: c.scholarText }
    default: return { bg: c.surfaceSunken, fg: c.textSecondary }
  }
}

/** Where a tag-feed row lands. The API's own paths differ from the client's. */
export function contentHref(type: string | null | undefined, id: string): string | null {
  if (!id) return null
  switch (String(type || '').toUpperCase()) {
    case 'RESEARCH': return `/research/${id}`
    case 'QUESTION': return `/qna/${id}`
    case 'POST': return `/posts/${id}`
    /* Known to be a reel — straight to the viewer, not through the post
       screen's doorway. */
    case 'REEL': return `/reels/${id}`
    default: return null
  }
}
