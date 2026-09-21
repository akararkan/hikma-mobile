/* =========================================================
   Citation strings.

   There is no formatting endpoint anywhere in the API, so
   every style is assembled here from the fields the detail
   already carries: title, corresponding researcher, the year of
   publishedAt (falling back to createdAt), the IRC identifier
   and the public short link.

   The author's own `citation` field always wins when it is
   present — a researcher who wrote out how they want to be
   cited has said something the generators cannot infer.
   ========================================================= */
import { yearOf } from './format'
import type { ResearchDetail } from './types'

export type CitationStyle = 'AUTHOR' | 'APA' | 'MLA' | 'CHICAGO' | 'BIBTEX' | 'RIS'

export const CITATION_LABEL: Record<CitationStyle, string> = {
  AUTHOR: 'As given by the author',
  APA: 'APA',
  MLA: 'MLA',
  CHICAGO: 'Chicago',
  BIBTEX: 'BibTeX',
  RIS: 'RIS',
}

const INSTITUTION = 'IRC'

/** "Ahmed Karim" → "Karim, A." — the surname-first form APA and Chicago use. */
function surnameFirst(full: string): string {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] || 'Anonymous'
  const last = parts[parts.length - 1]
  const initials = parts.slice(0, -1).map(p => `${p[0].toUpperCase()}.`).join(' ')
  return `${last}, ${initials}`
}

/** "Ahmed Karim" → "Karim, Ahmed" — MLA keeps the given name in full. */
function surnameFirstFull(full: string): string {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] || 'Anonymous'
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
}

export function buildCitation(
  style: CitationStyle,
  detail: ResearchDetail,
  url: string | null,
): string {
  const author = detail._author?.full || 'Anonymous'
  const year = yearOf(detail.publishedAt || detail.createdAt)
  const title = detail.title || 'Untitled paper'
  const irc = detail.irc || ''
  const link = url || detail.shareUrl || ''

  switch (style) {
    case 'AUTHOR':
      return detail.citation || ''

    case 'APA':
      return [
        `${surnameFirst(author)} (${year}). ${title}.`,
        `${INSTITUTION}${irc ? ` (${irc})` : ''}.`,
        link,
      ].filter(Boolean).join(' ')

    case 'MLA':
      return [
        `${surnameFirstFull(author)}. “${title}.”`,
        `${INSTITUTION}, ${year}${irc ? `, ${irc}` : ''}.`,
        link,
      ].filter(Boolean).join(' ')

    case 'CHICAGO':
      return [
        `${surnameFirstFull(author)}. “${title}.”`,
        `${INSTITUTION} working paper${irc ? ` ${irc}` : ''}, ${year}.`,
        link,
      ].filter(Boolean).join(' ')

    case 'BIBTEX': {
      const key = (irc || `${INSTITUTION}${year}`).replace(/[^A-Za-z0-9]/g, '')
      return [
        `@techreport{${key},`,
        `  title  = {${title}},`,
        `  author = {${author}},`,
        `  institution = {${INSTITUTION}},`,
        `  year   = {${year}},`,
        irc ? `  number = {${irc}},` : null,
        link ? `  url    = {${link}}` : null,
        `}`,
      ].filter(Boolean).join('\n')
    }

    case 'RIS':
      return [
        'TY  - RPRT',
        `AU  - ${author}`,
        `TI  - ${title}`,
        `PY  - ${year}`,
        `PB  - ${INSTITUTION}`,
        irc ? `M1  - ${irc}` : null,
        link ? `UR  - ${link}` : null,
        'ER  - ',
      ].filter(Boolean).join('\n')
  }
}

/** The styles to offer for one paper — the author's own form only exists when
 *  they wrote one. */
export function citationStyles(detail: ResearchDetail): CitationStyle[] {
  const rest: CitationStyle[] = ['APA', 'MLA', 'CHICAGO', 'BIBTEX', 'RIS']
  return detail.citation?.trim() ? (['AUTHOR', ...rest] as CitationStyle[]) : rest
}

/** "Copy all" on the sources screen: a numbered plain-text bibliography. */
export function bibliographyText(sources: { citationText?: string; title?: string; sub?: string }[]): string {
  return sources
    .map((s, i) => `${i + 1}. ${s.citationText || s.title || s.sub || ''}`.trim())
    .filter(line => line.length > 3)
    .join('\n')
}
