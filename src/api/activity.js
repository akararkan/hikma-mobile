/* =========================================================
   Activity service — /api/v1/users/me/activity (history + live SSE).
   Reads the caller's own activity (no userId in the path — the server
   uses the authenticated principal). Maps the rich UserActivityResponse
   (server-rendered `label` / `subtitle` / `timeAgo` + typed references).
   ========================================================= */
import { http, refreshSession } from './http.js'
import { mockEnabled } from '../mock/flag.js'
import { API_BASE, assetUrl, session } from './config.js'
import { timeAgo } from './adapters.js'
/* RN: the only change in this file — RN has no global EventSource.
   The shim in ../platform/sse.js keeps the exact browser surface
   (addEventListener / onmessage / onerror / readyState / close), so every
   call site below is untouched. */
import { EventSource } from '../platform/sse.js'

/* Derive a navigation target from whichever reference the row carries. */
function activityLink(d) {
  if (d.post?.id)       return d.post.postType === 'REEL' ? `/reels/${d.post.id}` : `/posts/${d.post.id}`
  if (d.question?.id)   return `/qna/${d.question.id}`
  if (d.research?.id)   return `/research/${d.research.id}`
  if (d.targetUser?.id) return `/u/${d.targetUser.id}`
  if (d.activityType === 'HASHTAG_SEARCH' && d.query) return `/tags/${encodeURIComponent(d.query.replace(/^#/, ''))}`
  if (d.query)          return `/explore?q=${encodeURIComponent(d.query)}`
  return null
}

export function activityFrom(dto) {
  /* The wire carries a rich preview per row (activity.md §1: post.thumbnailUrl
     + textPreview, research.coverImageUrl + title, targetUser.avatarUrl…) —
     surface it so the history can show WHAT the action touched, not just the
     sentence about it. */
  const thumb = dto.post?.thumbnailUrl || dto.research?.coverImageUrl || null
  const avatar = dto.targetUser?.avatarUrl || null
  return {
    id:        dto.id || dto.activityId,
    type:      dto.activityType,
    label:     dto.label || 'Activity',                 // server-rendered, never null when typed
    subtitle:  dto.subtitle || '',
    time:      dto.timeAgo || timeAgo(dto.createdAt),
    date:      dto.formattedDate || '',
    createdAt: dto.createdAt,
    deepLink:  activityLink(dto),
    preview: {
      thumb:  thumb ? assetUrl(thumb) : null,
      avatar: avatar ? assetUrl(avatar) : null,
      text:   dto.post?.textPreview || dto.question?.title || dto.research?.title
                || dto.comment?.textPreview || dto.answer?.bodyPreview || null,
      name:   dto.targetUser?.fullName || dto.targetUser?.username || null,
    },
  }
}

/* Every UserActivityType is an SSE event NAME — activity.md §4: "Event names
   are the UserActivityType enum names verbatim … dispatch on the event name"
   (server fallback name for an untyped row: `activity`). A named frame never
   fires `onmessage`, so each name needs its own listener. */
const ACTIVITY_EVENTS = [
  'POST_CREATED', 'POST_REACTION', 'POST_COMMENT', 'POST_COMMENT_REACTION', 'POST_SHARE', 'POST_SAVED', 'REEL_WATCH',
  'GLOBAL_SEARCH', 'HASHTAG_SEARCH', 'MENTION_LOOKUP', 'USER_MENTIONED', 'PROFILE_VIEW', 'FOLLOWED_USER',
  'QNA_QUESTION_CREATED', 'QNA_QUESTION_SAVED', 'QNA_ANSWER_CREATED', 'QNA_REANSWER_CREATED', 'QNA_ANSWER_REACTION', 'QNA_ANSWER_FEEDBACK',
  'RESEARCH_PUBLISHED', 'RESEARCH_SAVED', 'RESEARCH_REACTION', 'RESEARCH_COMMENT', 'RESEARCH_COMMENT_REACTION',
  'STORY_VIEWED', 'STORY_REACTED', 'STORY_REPLIED', 'STORY_POLL_VOTED',
  'SOUND_USED',
  'activity',
]

export const activity = {
  /** Paged history. `types` is an array → comma-joined `types` param.
   *  NOTE the doc's pagination caveat (activity.md §1): `page` is NOT applied
   *  server-side — walk back by passing the last row's `createdAt` as `to`. */
  async list({ types, from, to, page = 0, size = 30, signal } = {}) {
    const res = await http.get('/api/v1/users/me/activity', {
      types: types?.length ? types.join(',') : undefined,
      from, to, page, size,
    }, { signal })
    return (res?.content || res?.items || res || []).map(activityFrom)
  },

  remove(id)   { return http.del(`/api/v1/users/me/activity/${id}`) },                  // → 204
  clear(type)  { return http.del('/api/v1/users/me/activity', { query: type ? { type } : undefined }) }, // → { deleted }

  /** Live SSE — NAMED events (one per UserActivityType, activity.md §4)
      carrying UserActivityRealtimeEvent (its `.activity` is a full
      UserActivityResponse when available). Hardened per overview.md §3:
      heartbeat watchdog (25s cadence, >60s silence → one fresh socket), an
      error-driven heal (every error is terminal on native — see the onerror
      note below) and the token re-read on every dial (it rotates; this stream
      has NO server timeout, so a wedged socket would otherwise stay dead
      forever). Returns an unsubscribe fn. */
  stream({ onActivity, onError } = {}) {

    /* Mock mode: EventSource does not pass through request(), so nothing can
       intercept it — opening one only retry-loops against a server that is not
       running. Report connected and stay silent. */
    if (mockEnabled()) {
      const t = setTimeout(() => onError?.({ mock: true }), 0)
      return () => clearTimeout(t)
    }
    let es = null
    let lastBeat = Date.now()
    let closed = false
    let healing = false
    const connect = () => {
      if (closed) return
      const token = session.getToken()
      const url = `${API_BASE}/api/v1/users/me/activity/stream` + (token ? `?token=${encodeURIComponent(token)}` : '')
      es = new EventSource(url, { withCredentials: true })
      const onRow = (e) => {
        lastBeat = Date.now()
        try {
          const ev = JSON.parse(e.data)
          /* The realtime payload keys its time as `timestamp` (activity.md §4);
             the `.activity` mirror, when present, is a full response row. */
          onActivity?.(activityFrom(ev.activity || { ...ev, createdAt: ev.createdAt || ev.timestamp }))
        } catch { /* ignore */ }
      }
      es.onmessage = onRow                              // belt: any unnamed frame
      for (const name of ACTIVITY_EVENTS) es.addEventListener(name, onRow)
      // Named lifecycle frames don't carry rows but DO prove the socket lives.
      es.addEventListener('connected', () => { lastBeat = Date.now() })
      es.addEventListener('heartbeat', () => { lastBeat = Date.now() })
      es.onerror = () => {
        const state = es?.readyState ?? 2
        onError?.(state)
        /* There is no such thing as a transient error here: the RN shim pins
           pollingInterval to 0 (platform/sse.js), so a CLOSED socket stays
           closed until WE re-dial — and the usual cause is the hourly token
           rotation, which the original url cannot survive. Without this the
           live feed went dark for up to 75s, until the silence watchdog
           happened to tick. One refresh through the single-flight funnel, then
           a fresh dial with the rotated token (mirrors chat.js). */
        if (state !== 2 || closed || healing) return
        healing = true
        refreshSession().catch(() => null).then(() => {
          if (closed) return
          try { es?.close() } catch { /* noop */ }
          lastBeat = Date.now()
          connect()
        })
        setTimeout(() => { healing = false }, 8000)   // one heal attempt per window
      }
    }
    connect()
    const watchdog = setInterval(() => {
      if (closed) return
      if (Date.now() - lastBeat > 60000) {
        try { es?.close() } catch { /* noop */ }
        lastBeat = Date.now()
        connect()
      }
    }, 15000)
    return () => { closed = true; clearInterval(watchdog); try { es?.close() } catch { /* noop */ } }
  },
}
