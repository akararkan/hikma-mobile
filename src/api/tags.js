/* =========================================================
   Tags & trending — /api/v1/tags  (SEARCH_API §7, May 2026)
   --------------------------------------------------------
   Cassandra-backed:
     · trending leaderboard (§7.3)
     · per-tag content feed: posts + reels + questions + research (§7.4)
     · per-tag usage (§7.5), incl. breakdown mode `scope=*` (§7.5)
     · prefix autocomplete (§7.6) — full-catalogue, not just top-N
   All reads are PUBLIC.
   ========================================================= */
import { http } from './http.js'
import { assetUrl } from './config.js'
import { trendingTagFrom, tagContentRowFrom, tagSuggestionFrom, timeAgo } from './adapters.js'

/** Client-side tag normalization mirrors the server (§7.2): lowercase
 *  (locale-independent), trim, strip a leading '#', cap each tag to 100
 *  chars and the list to 30. Dedup by lowercase value, preserve order.
 *  NOTE: Arabic ↔ Latin tags stay distinct on purpose — do not transliterate. */
export function normalizeTag(t) {
  return String(t || '').trim().replace(/^#+/, '').toLowerCase().slice(0, 100)
}
export function normalizeTags(list) {
  const seen = new Set()
  const out = []
  for (const raw of list || []) {
    const t = normalizeTag(raw)
    if (!t || seen.has(t)) continue
    seen.add(t); out.push(t)
    if (out.length >= 30) break
  }
  return out
}

export const tags = {
  /** §7.3 — pre-ranked most-used tags. `scope` ∈ ALL|QUESTION|RESEARCH|POST|REEL. */
  async trending({ scope = 'ALL', limit = 20 } = {}) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 20))
    const rows = await http.get('/api/v1/tags/trending', { scope, limit: lim })
    return (rows || []).map(trendingTagFrom)
  },

  /** §7.4 — newest-first content feed for one tag. Pass the opaque `nextCursor`
   *  from the previous response straight back; never decode it client-side.
   *  Posts, reels, questions and research all appear here (May 2026). */
  async content(tag, { cursor, pageSize = 20 } = {}) {
    const res = await http.get(`/api/v1/tags/${encodeURIComponent(tag)}/content`, {
      pageSize, cursor: cursor || undefined,
    })
    // The envelope changed to { tag, items, nextCursor, pageSize } — keep an
    // array fallback so a partial deploy (old server) doesn't crash the UI.
    const rows = Array.isArray(res) ? res : (res?.items || [])
    return {
      tag: res?.tag || tag,
      items: rows.map(tagContentRowFrom),
      nextCursor: res?.nextCursor || '',
      pageSize: res?.pageSize ?? pageSize,
    }
  },

  /** §7.5 — one tag's usage count.
   *  Pass scope='*' to get the per-scope breakdown in ONE round-trip
   *  ({tag, scopes: {ALL,QUESTION,RESEARCH,POST,REEL}}) — saves 4 calls. */
  async usage(tag, { scope = 'ALL' } = {}) {
    const res = await http.get(`/api/v1/tags/${encodeURIComponent(tag)}/usage`, { scope })
    if (scope === '*' || res?.scopes) {
      return { tag: res?.tag ?? tag, scopes: res?.scopes || {} }
    }
    return {
      tag: res?.tag ?? tag,
      scope: res?.scope ?? scope,
      usageCount: res?.usageCount ?? 0,
    }
  },

  /* ---- Cassandra hashtag-occurrence surface (feed/api-reference.md) ------
     NOT the same thing as `content`/`usage` above. That pair reads the
     unified tag-content rows (posts + reels + questions + research, opaque
     nextCursor, scope breakdowns). This pair reads the ORIGINAL
     posts_by_hashtag partitions directly: post occurrences only, paged by a
     plain createdAt keyset cursor, and its count is the posts-only tally.
     Both are live; use `content` for a tag page, this one when you need the
     raw post rows or the cheap posts-only count. */

  /** GET /hashtags/{tag}/posts — newest-first post rows for one hashtag.
   *  Keyset paging: pass the last row's `createdAt` back as `cursor` for the
   *  strictly-older page (the wire param is an ISO instant, `pageSize` sizes
   *  the page — not `limit`). Rows are light (no counters, no author plate):
   *  hydrate via posts.get(id) where a full card is needed. */
  async hashtagPosts(tag, { cursor, pageSize = 20 } = {}) {
    const rows = await http.get(`/api/v1/hashtags/${encodeURIComponent(normalizeTag(tag))}/posts`, {
      pageSize, cursor: cursor || undefined,
    })
    return (rows || []).map(r => ({
      id: r.postId,
      postId: r.postId,
      hashtag: r.hashtag || normalizeTag(tag),
      authorId: r.authorId || null,
      titlePreview: r.textPreview || '',
      mediaUrl: assetUrl(r.mediaUrl || null),
      createdAt: r.createdAt || null,       // the keyset cursor for the next page
      time: timeAgo(r.createdAt),
    }))
  },

  /** GET /hashtags/{tag}/usage — the posts-only occurrence count straight off
   *  the hashtag counter ({hashtag, postCount}). `usage(tag)` above answers
   *  the cross-content-type question; this one is the cheap posts tally. */
  async hashtagUsage(tag) {
    const res = await http.get(`/api/v1/hashtags/${encodeURIComponent(normalizeTag(tag))}/usage`)
    return { tag: res?.hashtag ?? normalizeTag(tag), postCount: res?.postCount ?? 0 }
  },

  /** §7.6 — prefix autocomplete over the whole tag catalogue.
   *  Use this on the chip-input — `trending` only knows the top-N. */
  async search({ prefix, scope = 'ALL', limit = 10 } = {}) {
    const p = String(prefix || '').trim()
    if (!p) return []
    const rows = await http.get('/api/v1/tags/search', {
      prefix: p, scope, limit: Math.max(1, Math.min(50, Number(limit) || 10)),
    })
    return (rows || []).map(tagSuggestionFrom)
  },
}
