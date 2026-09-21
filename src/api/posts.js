/* =========================================================
   Posts service — /api/v1/posts
   Feed, post CRUD, reactions, comments, saves, shares, views.
   Returns VIEW-shaped objects via the adapters.
   ========================================================= */
import { http } from './http.js'
import { feedItemFrom, postFromFeedItem, postFromResponse, commentFrom, suggestionFrom, rawSuggestionFrom } from './adapters.js'
import { liveStreamFrom } from './chat.js'

export const posts = {
  /* ---- Home feed ---------------------------------------------------------
     Two shapes over the same ranked pipeline (FEED_API §1):

       feed()  GET /feed        legacy BARE ARRAY. Kept for callers that only
                                want rows (and for `?ranked=false`); the server
                                tail-pins the chronologically-oldest timeline
                                item so `cursor = items.at(-1).createdAt` still
                                paginates correctly.
       home()  GET /feed/home   canonical. items + liveNow + an explicit
                                nextCursor — the ONLY correct cursor for a
                                ranked page, because ranked order is not
                                chronological order.

     `ranked` defaults to true server-side; pass false for a "Latest" tab (the
     exact pre-ranking chronological read, same response shape). It is only put
     on the wire when explicitly given, so the default stays the server's. */

  /* TRAP: `/feed` takes BOTH `pageSize` and `limit`, and the server resolves
     them as `limit > 0 ? limit : pageSize` — where `limit` itself defaults to
     20. There is therefore no request in which `pageSize` is read: sending
     `pageSize=50` alone silently returns 20 rows. So the effective size is
     always sent as `limit`. (`/feed/home` has no such alias — it takes
     `pageSize` only, and that one is real.) */
  async feed({ cursor, limit, pageSize = 20, ranked, signal } = {}) {
    const rows = await http.get('/api/v1/posts/feed', { cursor, limit: limit || pageSize, ranked }, { signal })
    // Mixed stream: POST | RESEARCH | QUESTION | CHANNEL_POST, by entityType.
    return (rows || []).map(feedItemFrom)
  },

  /** The whole home screen in one request. Viewer-bound: anonymous → empty.
   *  `liveNow` and the channel/explore injections are FIRST-PAGE ONLY, so a
   *  cursor page legitimately comes back with items and nothing else. */
  async home({ cursor, pageSize = 20, ranked, signal } = {}) {
    const res = await http.get('/api/v1/posts/feed/home', { cursor, pageSize, ranked }, { signal })   // usePaged cancels superseded pages
    return {
      items: (res?.items || []).map(feedItemFrom),
      liveNow: (res?.liveNow || []).map(liveStreamFrom).filter(Boolean),
      // Authoritative — never re-derive it from item order (guide §5).
      // null = end of feed.
      nextCursor: res?.nextCursor || null,
      ranked: res?.ranked !== false,
    }
  },

  /** The live rail alone — for polling it more often than the feed body.
   *  Followed hosts first, topped up to 10 with the most-watched public
   *  streams, blocked hosts removed. Same `LiveStreamResponse` as /streams. */
  async liveNow() {
    const rows = await http.get('/api/v1/posts/feed/live-now')
    return (rows || []).map(liveStreamFrom).filter(Boolean)
  },

  async byAuthor(authorId, { cursor, pageSize = 20, signal } = {}) {
    const rows = await http.get(`/api/v1/posts/by-author/${authorId}`, { cursor, pageSize }, { signal })
    return (rows || []).map(postFromFeedItem)
  },
  // NOTE: the reels feed (§7.3) and reel-watch view (§13.1/§26) are
  // reel-specific and live in their own namespace — see api.reels.

  /* ---- Single post ---- */
  async get(id) {
    return postFromResponse(await http.get(`/api/v1/posts/${id}`))
  },
  async create(command) {
    return postFromResponse(await http.post('/api/v1/posts', command))
  },
  async createMultipart(formData, opts) {
    /* uploadX (RN XHR) when the caller wants progress/cancel — the native
       layer streams {uri} parts directly. Plain upload otherwise. */
    return postFromResponse(await (opts?.onProgress || opts?.signal
      ? http.uploadX('/api/v1/posts', formData, opts)
      : http.upload('/api/v1/posts', formData, opts)))
  },
  async edit(id, command) {
    return postFromResponse(await http.patch(`/api/v1/posts/${id}`, command))
  },
  async remove(id) {
    return http.del(`/api/v1/posts/${id}`)
  },

  /* ---- Media carousel (post/media.md) -------------------------------------
     The ordered `media_by_post` rows behind big albums and post-publish edits:
     ≤4 items usually ride inline on the post's own mediaUrls; this table is
     the authority for anything larger, clustered by sortOrder ASC so read
     order IS render order. List is public; POST/PUT/DELETE are author-only
     (401 AUTH_UNAUTHORIZED / 404 POST_NOT_FOUND / 403 FORBIDDEN — the check
     runs against posts_by_id.author_id here, not in the post service).

     Rows are returned RAW, not adapter-shaped, on purpose: this is an EDITING
     surface and `replaceAll` round-trips the same rows back to the server —
     absolutizing `url` here would bake this client's API host into the DB
     column (the exact trap soundFrom documents). Display code absolutizes
     with assetUrl at render time. */
  media: {
    /** GET /posts/{postId}/media — public, sortOrder ASC. Empty carousel → []. */
    list(postId) { return http.get(`/api/v1/posts/${postId}/media`) },
    /** POST /posts/{postId}/media — append ONE row. The file must already be
     *  uploaded (pass its public url + s3Key); for brand-new posts prefer
     *  createMultipart, which uploads and persists atomically. Server
     *  generates mediaId when absent. */
    add(postId, { sortOrder, mediaType, url, thumbnailUrl, s3Key, durationSeconds, fileSizeBytes, mimeType, altText } = {}) {
      return http.post(`/api/v1/posts/${postId}/media`, {
        sortOrder, mediaType, url, thumbnailUrl, s3Key, durationSeconds, fileSizeBytes, mimeType, altText,
      })
    },
    /** PUT /posts/{postId}/media — replace the WHOLE carousel (drag-reorder).
     *  Send the full desired list, not a diff — `[]` clears it. sortOrder is
     *  reassigned from ARRAY INDEX server-side regardless of what rows say
     *  (it is a clustering key: bulk delete + re-insert, not UPDATE). Returns
     *  the freshly-read ordered list. */
    replaceAll(postId, rows) { return http.put(`/api/v1/posts/${postId}/media`, rows || []) },
    /** DELETE /posts/{postId}/media/{mediaId}?sortOrder= — remove one row.
     *  `sortOrder` is REQUIRED (part of the Cassandra primary key — the row
     *  cannot be addressed without it; omitting it is 400 MISSING_PARAMETER).
     *  Idempotent: an unknown tuple is a silent no-op. */
    remove(postId, mediaId, sortOrder) {
      return http.del(`/api/v1/posts/${postId}/media/${mediaId}`, { query: { sortOrder } })
    },
  },

  /* ---- Reactions (single LIKE, toggle) ---- */
  toggleReaction(id) { return http.post(`/api/v1/posts/${id}/reactions`, {}) },   // → { liked }
  unreact(id)        { return http.del(`/api/v1/posts/${id}/reactions`) },
  reactedByMe(id)    { return http.get(`/api/v1/posts/${id}/reactions/me`) },
  // §11.4 — posts a user has liked (light {userId,createdAt,postId} tuples; hydrate via get)
  reactionHistory(userId, pageSize = 20) { return http.get(`/api/v1/posts/users/${userId}/reactions`, { pageSize }) },

  /* ---- Comments & replies ---- */
  /** @param {string} postId
   *  @param {{ cursor?: string | null, pageSize?: number, signal?: AbortSignal }} [opts] —
   *  `cursor` is the last row's raw `createdAt` (ISO), echoed back verbatim. */
  async comments(postId, { cursor, pageSize = 20, signal } = {}) {
    const rows = await http.get(`/api/v1/posts/${postId}/comments`, { cursor, pageSize }, { signal })
    return (rows || []).map(commentFrom)
  },
  async addComment(postId, { text, mediaUrl = null, mediaType = null }) {
    return commentFrom(await http.post(`/api/v1/posts/${postId}/comments`, { text, mediaUrl, mediaType }))
  },
  async replies(commentId, { pageSize = 20, signal } = {}) {
    const rows = await http.get(`/api/v1/posts/comments/${commentId}/replies`, { pageSize }, { signal })
    return (rows || []).map(commentFrom)
  },
  async addReply(commentId, { text, mediaUrl = null }) {
    // ReplyResponse shares CommentResponse's fields → adapt the same way (§14.3)
    return commentFrom(await http.post(`/api/v1/posts/comments/${commentId}/replies`, { text, mediaUrl }))
  },
  editComment(commentId, text) { return http.patch(`/api/v1/posts/comments/${commentId}`, { text }) },
  deleteComment(commentId)     { return http.del(`/api/v1/posts/comments/${commentId}`) },
  toggleCommentReaction(postId, commentId) {
    return http.post(`/api/v1/posts/${postId}/comments/${commentId}/reactions`, {})
  },
  // §12.2 — explicit comment unlike (idempotent; no-op if not liked)
  unreactComment(postId, commentId) {
    return http.del(`/api/v1/posts/${postId}/comments/${commentId}/reactions`)
  },

  /* ---- Saves / shares / views ---- */
  toggleSave(id, collection)  { return http.post(`/api/v1/posts/${id}/saves`, {}, { query: { collection } }) },
  unsave(id)                  { return http.del(`/api/v1/posts/${id}/saves`) },
  savedByMe(id)               { return http.get(`/api/v1/posts/${id}/saves/me`) },
  async savedPosts(userId, { cursor, pageSize = 20, signal } = {}) {
    const rows = await http.get(`/api/v1/posts/users/${userId}/saves`, { cursor, pageSize }, { signal })
    return (rows || []).map(postFromResponse)
  },
  share(id, caption)  { return http.post(`/api/v1/posts/${id}/shares`, caption ? { caption } : {}) },
  sharesList(id, pageSize = 20) { return http.get(`/api/v1/posts/${id}/shares`, { pageSize }) },   // §16.2 recent shares
  // ShareLinkInfo {shortUrl, canonicalUrl, token, shareCount}. shareLink previews (no bump);
  // recordShare bumps shareCount + writes the ledger + notifies the author (POST_SHARED).
  shareLink(id)       { return http.get(`/api/v1/posts/${id}/share-link`) },
  recordShare(id, caption) { return http.post(`/api/v1/posts/${id}/share`, caption ? { caption } : {}) },
  recordView(id)      { return http.post(`/api/v1/posts/${id}/views`, {}) },

  /* ---- Friend suggestions — "People you may know" -------------------------
     Every route here acts on the JWT PRINCIPAL: one user can never read or
     mutate another's suggestion state, so there is no `userId` param on any
     of them (the old one is gone server-side, not merely ignored).

     Two read shapes over the same store:

       suggestions()          raw `friend_suggestions_by_user` rows. `score` is
                              the ×10 fixed-point int and identity is NOT
                              hydrated — kept for back-compat/debug only.
       suggestionsDetailed()  canonical. Candidate identity is join-fetched
                              (avatars are real), deleted candidates are
                              dropped, `score` is the true double, and
                              `reason` is the engine's top-signals label.
     Render from the detailed one. */

  async suggestions({ limit = 20, signal } = {}) {
    const rows = await http.get('/api/v1/posts/suggestions', { limit }, { signal })
    return (rows || []).map(rawSuggestionFrom).filter(Boolean)
  },

  async suggestionsDetailed({ limit = 20, signal } = {}) {
    const rows = await http.get('/api/v1/posts/suggestions/detailed', { limit }, { signal })
    return (rows || []).map(suggestionFrom).filter(Boolean)
  },

  /* Explicit negative feedback. NOT the same as "hide it for now": it writes a
     `suggestion_dismissals` row AND deletes the stored suggestion, so the
     person is gone now and excluded from every future recompute. Permanent —
     confirm before calling it on anything the user might have mis-tapped. */
  dismissSuggestion(candidateId) { return http.post(`/api/v1/posts/suggestions/${candidateId}/dismiss`, {}) },   // 204

  /* 202 Accepted — the recompute is async, so the caller must re-READ after a
     beat rather than expecting fresh rows in the response. Also fired
     server-side on follow / unfollow / contact sync, which covers most cases;
     call this for onboarding and pull-to-refresh. */
  recomputeSuggestions() { return http.post('/api/v1/posts/suggestions/recompute', {}) },
}
