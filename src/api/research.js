/* =========================================================
   Research service — /api/v1/researches  (full RESEARCH_API coverage)
   ========================================================= */
import { http } from './http.js'
import { researchFrom, sourceFrom } from './adapters.js'

export const research = {
  /* ---- read / feeds ---- */
  async feed({ page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/feed', { page, size, sort: 'publishedAt,desc' })
    return (res?.content || []).map(researchFrom)
  },
  async following({ page = 0, size = 20 } = {}) {                 // §12.5
    // FEEDS_DISCOVERY "newest first" — the server's findFollowingFeed query has no
    // ORDER BY and @PageableDefault(sort="publishedAt") defaults to ASC, so the
    // explicit desc sort is load-bearing (same as feed() above).
    const res = await http.get('/api/v1/researches/feed/following', { page, size, sort: 'publishedAt,desc' })
    return (res?.content || []).map(researchFrom)
  },
  async byResearcher(researcherId, { page = 0, size = 20 } = {}) {
    // No server-side ORDER BY / default sort on this route — send one so offset
    // pages are stable (unordered offset paging can skip/duplicate rows).
    const res = await http.get(`/api/v1/researches/researcher/${researcherId}`, { page, size, sort: 'publishedAt,desc' })
    return (res?.content || []).map(researchFrom)
  },
  get(id)            { return http.get(`/api/v1/researches/${id}`) },     // full ResearchResponse (detail maps inline)
  bySlug(slug)       { return http.get(`/api/v1/researches/slug/${slug}`) },
  byShareToken(tok)  { return http.get(`/api/v1/researches/share/${tok}`) },

  /* ---- search / tags (§14) ---- */
  async byTags(tags, { page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/search/tags', { tags, page, size })
    return (res?.content || []).map(researchFrom)
  },
  // Research-only trending list (FEEDS_DISCOVERY §trending-tags): usage counts across
  // published papers, cached server-side 10 min per limit; limit ≤0 or >100 falls back
  // to 10. → ["tafsir", ...]. The CROSS-CONTENT strip (research + Q&A, pre-ranked in
  // Cassandra) is a different surface — that one is api.tags.trending({ scope:'RESEARCH' }).
  trendingTags(limit = 20) { return http.get('/api/v1/researches/tags/trending', { limit }) },

  /* ---- lifecycle (scholar/researcher, author) ---- */
  create(formData)   { return http.upload('/api/v1/researches', formData) },     // multipart: data + files (backend also accepts files[], file, media, etc.)
  update(id, req)    { return http.patch(`/api/v1/researches/${id}`, req) },
  publish(id)        { return http.post(`/api/v1/researches/${id}/publish`, {}) },
  unpublish(id)      { return http.post(`/api/v1/researches/${id}/unpublish`, {}) },
  archive(id)        { return http.post(`/api/v1/researches/${id}/archive`, {}) },
  retract(id)        { return http.post(`/api/v1/researches/${id}/retract`, {}) },
  /** RETRACTED → PUBLISHED. There is no `/unretract` route on the server —
   *  publish() is the sanctioned transition: its only status guard is
   *  "already published", so a retracted paper passes, re-runs the title/
   *  abstract checklist and the moderation gate, and comes back PUBLISHED
   *  (or held). Calling the old /unretract path 404'd on every backend. */
  unretract(id)      { return http.post(`/api/v1/researches/${id}/publish`, {}) },
  remove(id)         { return http.del(`/api/v1/researches/${id}`) },

  /* ---- media / cover / promo (author) ---- */
  uploadVideoPromo(id, formData) { return http.upload(`/api/v1/researches/${id}/video-promo`, formData) },
  removeVideoPromo(id)           { return http.del(`/api/v1/researches/${id}/video-promo`) },
  // §8.1 — multipart part name is exactly `image` (ResearchController). Accepts a
  // File (preferred) or a prebuilt FormData. Endpoint is gated to SCHOLAR /
  // RESEARCHER / ADMIN / SUPER_ADMIN — a plain USER gets 403 (the modal guards this).
  uploadCover(id, fileOrForm) {
    let fd = fileOrForm
    if (!(typeof FormData !== 'undefined' && fileOrForm instanceof FormData)) { fd = new FormData(); fd.append('image', fileOrForm) }
    return http.upload(`/api/v1/researches/${id}/cover-image`, fd)
  },
  removeCover(id)                { return http.del(`/api/v1/researches/${id}/cover-image`) },
  addMedia(id, formData, query)  { return http.upload(`/api/v1/researches/${id}/media`, formData, { query }) },
  editMedia(id, mediaId, req)    { return http.patch(`/api/v1/researches/${id}/media/${mediaId}`, req) },
  deleteMedia(id, mediaId)       { return http.del(`/api/v1/researches/${id}/media/${mediaId}`) },

  /* ---- sources / contributors ---- */
  // Public, block-aware, ordered by displayOrder asc → List<SourceResponse>.
  async sources(id)              { const r = await http.get(`/api/v1/researches/${id}/sources`); return (r || []).map(sourceFrom) },
  editSource(id, sourceId, req)  { return http.patch(`/api/v1/researches/${id}/sources/${sourceId}`, req) },
  uploadSourceFile(id, sourceId, formData) { return http.upload(`/api/v1/researches/${id}/sources/${sourceId}/file`, formData) },
  contributors(id)               { return http.get(`/api/v1/researches/${id}/contributors`) },
  addContributor(id, req)        { return http.post(`/api/v1/researches/${id}/contributors`, req) },
  replaceContributors(id, list)  { return http.put(`/api/v1/researches/${id}/contributors`, list) },
  editContributor(id, cId, req)  { return http.patch(`/api/v1/researches/${id}/contributors/${cId}`, req) },
  deleteContributor(id, cId)     { return http.del(`/api/v1/researches/${id}/contributors/${cId}`) },

  /* ---- dashboard ---- */
  // Both dashboard routes have no server-side ORDER BY / default sort; drafts have
  // publishedAt = null, so createdAt is the field that keeps offset pages stable.
  async myDrafts({ page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/me/drafts', { page, size, sort: 'createdAt,desc' })
    return (res?.content || []).map(researchFrom)
  },
  async myAll({ page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/me/all', { page, size, sort: 'createdAt,desc' })
    return (res?.content || []).map(researchFrom)
  },

  /* ---- reactions ---- */
  react(id)          { return http.post(`/api/v1/researches/${id}/reactions`, { reactionType: 'LIKE' }) },
  unreact(id)        { return http.del(`/api/v1/researches/${id}/reactions`) },
  reactionBreakdown(id) { return http.get(`/api/v1/researches/${id}/reactions/breakdown`) },

  /* ---- save / bookmark ---- */
  save(id, collection){ return http.post(`/api/v1/researches/${id}/save`, {}, { query: { collection } }) },
  unsave(id)         { return http.del(`/api/v1/researches/${id}/save`) },
  // FEEDS_DISCOVERY §saved-papers: only these two routes populate `savedAt` (the
  // bookmark time, distinct from publishedAt) — carried past researchFrom, which
  // (being shared with feeds where savedAt is always null) doesn't map it.
  async mySaved({ page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/me/saved', { page, size })
    return (res?.content || res || []).map(d => ({ ...researchFrom(d), savedAt: d.savedAt || null }))
  },
  async mySavedCollection(name, { page = 0, size = 20 } = {}) {
    const res = await http.get('/api/v1/researches/me/saved/collection', { name, page, size })
    return (res?.content || res || []).map(d => ({ ...researchFrom(d), savedAt: d.savedAt || null }))
  },
  savedCollections()             { return http.get('/api/v1/researches/me/saved/collections') },
  renameCollection(oldName, newName) { return http.patch('/api/v1/researches/me/saved/collections', {}, { query: { oldName, newName } }) },

  /* ---- comments & replies (§17) ---- */
  comments(id, { page = 0, size = 20 } = {}) { return http.get(`/api/v1/researches/${id}/comments`, { page, size }) },
  addComment(id, content, parentId = null)   { return http.post(`/api/v1/researches/${id}/comments`, { content, parentId }) },
  addCommentUpload(id, formData)             { return http.upload(`/api/v1/researches/${id}/comments/upload`, formData) },
  editComment(id, commentId, content)        { return http.patch(`/api/v1/researches/${id}/comments/${commentId}`, { content }) },
  deleteComment(id, commentId)               { return http.del(`/api/v1/researches/${id}/comments/${commentId}`) },
  hideComment(id, commentId)                 { return http.post(`/api/v1/researches/${id}/comments/${commentId}/hide`, {}) },
  unhideComment(id, commentId)               { return http.post(`/api/v1/researches/${id}/comments/${commentId}/unhide`, {}) },
  reactComment(id, commentId)                { return http.post(`/api/v1/researches/${id}/comments/${commentId}/reactions`, { reactionType: 'LIKE' }) },
  unreactComment(id, commentId)              { return http.del(`/api/v1/researches/${id}/comments/${commentId}/reactions`) },

  /* ---- views / downloads / share / cite ---- */
  recordView(id)     { return http.post(`/api/v1/researches/${id}/view`, {}) },
  download(id, mediaId){ return http.post(`/api/v1/researches/${id}/download`, {}, { query: { mediaId } }) },
  shareLink(id)      { return http.get(`/api/v1/researches/${id}/share-link`) },
  recordShare(id)    { return http.post(`/api/v1/researches/${id}/share`, {}) },
  cite(id)           { return http.post(`/api/v1/researches/${id}/cite`, {}) },        // §19.3
}
