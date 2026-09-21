/* =========================================================
   The album carousel, in the shape the renderers already speak.

   `posts_by_id.mediaUrls` is NOT the authority for an album —
   media.md §2 is explicit that the carousel table is, and that
   mediaUrls is left un-rewritten when the album changes. So a
   post whose album was edited after publication renders the
   ORIGINAL urls from the inline list unless the detail screen
   reads /posts/{id}/media and prefers it.

   `api.posts.media.list` hands back RAW rows deliberately (the
   editor round-trips them and absolutizing would bake this
   client's host into the DB column), which is why the row →
   FeedMedia mapping lives out here in display code rather than
   in an adapter.

   The output is field-for-field what `mediaFromUrls` emits in
   src/api/adapters.js, so every surface that already renders
   `post.media` renders an album with no special casing. What
   the inline list cannot carry rides along too: alt text, and
   a duration for the video badge.
   ========================================================= */
import { assetUrl } from '@/api'
import type { FeedMedia } from '@/components/feed/types'

export interface AlbumRow {
  mediaType?: string | null
  url?: string | null
  thumbnailUrl?: string | null
  altText?: string | null
  durationSeconds?: number | null
  sortOrder?: number | null
}

/** mm:ss for the video badge. Albums are clips, so no hours component. */
export function mmss(s: number): string {
  const sec = Math.max(0, Math.round(s))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** Rows arrive sorted (sortOrder ASC) — never re-sort, and never coerce an id
 *  or an order to a Number beyond what it already is. */
export function albumToMedia(rows: AlbumRow[] | null | undefined): FeedMedia[] {
  return (rows || []).map(row => {
    const type = String(row.mediaType || 'IMAGE').toUpperCase()
    const src = assetUrl(row.url || '') || ''
    const poster = row.thumbnailUrl ? assetUrl(row.thumbnailUrl) : null
    const base: FeedMedia = {
      type,
      url: src,
      label: type.toLowerCase(),
      ratio: '16/10',
      alt: row.altText || undefined,
      durationSeconds: row.durationSeconds ?? null,
    }
    if (type === 'IMAGE') {
      return { ...base, label: 'image', bg: `center/cover no-repeat url("${src}")` } as FeedMedia
    }
    if (type === 'VIDEO') {
      return { ...base, label: 'video', poster, bg: 'linear-gradient(160deg,#1a2836,#0b131d)' } as FeedMedia
    }
    return base
  })
}
