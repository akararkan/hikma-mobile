/* =========================================================
   Reels service — the reel-SPECIFIC slice of the post API.

   A reel is a post (postType=REEL), so CREATION is NOT here —
   reels are created through the generic post create with
   postType=REEL (see posts.create / posts.createMultipart;
   the backend additionally fans REELs into reels_by_day, §6.1).

   These are the endpoints that are reel-only and therefore kept
   separate from the generic post handling:
     - global reels discover feed   → POST_API §7.3
     - reel-watch view (REEL_WATCH) → POST_API §13.1 / §26
   ========================================================= */
import { http } from './http.js'
import { assetUrl } from './config.js'
import { postFromFeedItem, authorFrom, timeAgo } from './adapters.js'

/** ReelViewResponse (watch-history entry) → view shape.
 *  NOTE: today's ReelViewMapper populates only `reel.id` — textPreview /
 *  mediaUrl / author arrive null, so screens hydrate the clip via
 *  posts.get(reelId). The fields are still mapped for the day the backend
 *  fills them in. */
function reelViewFrom(dto) {
  const r = dto.reel || {}
  return {
    id: dto.id,                                  // reelViewId (for delete)
    reelId: r.id,
    watchedSeconds: dto.watchedSeconds || 0,
    title: r.textPreview || '',
    mediaUrl: assetUrl(r.mediaUrl),
    thumb: assetUrl(r.thumbnailUrl || r.mediaUrl),
    durationSeconds: r.durationSeconds || null,
    // ReelViewResponse.AuthorSummary spells the avatar `avatarUrl`, not the
    // `profileImage` the shared adapter reads — normalize before adapting.
    _author: authorFrom(r.author && { ...r.author, profileImage: r.author.profileImage ?? r.author.avatarUrl }, r.author?.id),
    time: dto.timeAgo || timeAgo(dto.watchedAt),
  }
}

export const reels = {
  /* GET /api/v1/posts/reels/for-you — ranked discover feed (engagement ×
     recency-decay × follow-boost). Auth optional; anon gets global ranking. */
  async forYou({ pageSize = 20 } = {}) {
    const rows = await http.get('/api/v1/posts/reels/for-you', { pageSize })
    return (rows || []).map(postFromFeedItem)
  },

  /* GET /api/v1/posts/reels/following — reels from accounts the viewer
     follows, newest first. Auth required; anon → empty list. Cursor = the
     createdAt of the last item from the previous page. */
  async following({ cursor, pageSize = 20 } = {}) {
    const rows = await http.get('/api/v1/posts/reels/following', { cursor, pageSize })
    return (rows || []).map(postFromFeedItem)
  },

  /* REELS_API §17.2  GET /api/v1/posts/reels/by-author/{authorId}
     Reel-only slice of an author's posts, newest first, cursor-paginated —
     the profile Reels tab. Pairs with reelCount from /users/{id}/stats so the
     tab count and list always agree (don't client-filter the mixed by-author
     feed — a 20-row page can contain zero reels). */
  async byAuthor(authorId, { cursor, pageSize = 20, signal } = {}) {
    const rows = await http.get(`/api/v1/posts/reels/by-author/${authorId}`, { cursor, pageSize }, { signal })
    return (rows || []).map(postFromFeedItem)
  },

  /* §7.3  GET /api/v1/posts/reels   (alias: GET /api/v1/posts/feed/reels)
     Global, day-bucketed by UTC date, chronological within a day.
     `day` = 'YYYY-MM-DD' (UTC); omit for today. Anonymous-safe. Legacy
     discover — prefer for-you/following above.

     TRAP: same alias resolution as posts.feed's `limit` — the controller reads
     `size > 0 ? size : pageSize` and `size` itself DEFAULTS TO 20, so there is
     no request in which `pageSize` is read: sending `pageSize=50` alone
     silently returns 20 rows. The effective size is therefore always sent as
     `size`. (reels.md §1 documents `size` as the precedence-taking legacy
     alias; the controller default makes it always win.) */
  async feed({ day, size, pageSize = 20 } = {}) {
    const rows = await http.get('/api/v1/posts/reels', { day, size: size || pageSize })
    return (rows || []).map(postFromFeedItem)
  },

  /* REELS_API §12.1  POST /api/v1/posts/{postId}/reels/view
     Records a watch SESSION (not deduped) carrying `watchedSeconds` in the
     JSON body → drives the "Watched reels" history. It ALSO bumps the post's
     unique-view counter server-side (ReelViewServiceImpl.recordWatch calls
     CassandraViewService.recordView — Redis-NX deduped, 7-day window), so do
     NOT pair it with posts.recordView: the second call is a guaranteed dedup
     no-op. Auth required (401 anonymous). Fire-and-forget after a dwell
     threshold. */
  recordWatch(postId, watchedSeconds = 0) {
    return http.post(`/api/v1/posts/${postId}/reels/view`, { watchedSeconds })
  },

  /* REELS_API §12.2-12.4  reel-specific watch history */
  async watched({ page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/users/me/reels/watched', { page, size })
    const items = (res?.content || []).map(reelViewFrom)
    /* The envelope LIES here (activity.md §5.2): the backend builds
       PageImpl(content, pageable, content.size()), so totalElements is only
       the returned window and `last` is always true. There is no real total,
       and "more?" can only be inferred from a full window. */
    return {
      items,
      total: null,
      hasMore: items.length >= size,
      page: res?.number ?? page,
    }
  },
  deleteWatched(reelViewId) { return http.del(`/api/v1/users/me/reels/watched/${reelViewId}`) },
  clearWatched()            { return http.del('/api/v1/users/me/reels/watched') },
}
