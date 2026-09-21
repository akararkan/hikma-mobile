/* =========================================================
   storySeen — which rings are still lit, and why
   ---------------------------------------------------------
   A story ring means two DIFFERENT things depending on whose
   story it is, and conflating them is how this pattern goes
   wrong:

     someone else's  "you haven't watched this yet"
     your own        "nobody has watched this yet"

   Neither is a field the backend hands over.

   · For OTHER people there is no per-viewer seen flag on a
     story row at all — `/stories/by-author/{id}` returns the
     frames and nothing about you. So "seen" is remembered
     locally, keyed by author and stamped with the newest frame
     we saw. A newer frame relights the ring automatically,
     because the stamp is a TIMESTAMP and not a boolean — a
     boolean would mark an author "seen" forever and their next
     story would arrive dark.
   · For YOUR OWN story the truth is server-side but indirect:
     `GET /stories/{id}/views` is the author-only viewer log,
     and 0 rows across your frames means nobody has seen it.

   Local state is per-device by design. Watching a story on your
   phone leaving the ring lit on your laptop is the correct
   failure: the ring is a reading aid, and re-lighting one you
   already watched costs a glance, while darkening one you
   haven't costs you the story.
   ========================================================= */
/* RN: `localStorage` → ../platform/storage.js (MMKV). Same synchronous
   contract, same three methods, so every call site below is unchanged apart
   from the identifier. */
import { storage } from '../platform/storage.js'

const KEY = 'ika:story-seen'
/** Don't let the map grow forever — stories live 24h, so does anything here. */
const MAX_AGE_MS = 36 * 60 * 60 * 1000
const MAX_ENTRIES = 300

function readAll() {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }        // corrupt or blocked → behave as "nothing seen"
}

function writeAll(map) {
  try { storage.setItem(KEY, JSON.stringify(map)) } catch { /* nothing to persist to */ }
}

/** Drop entries older than a story can possibly live, then cap the map. */
function prune(map, now) {
  const live = Object.entries(map).filter(([, at]) => Number(at) > 0 && now - Number(at) < MAX_AGE_MS)
  if (live.length <= MAX_ENTRIES) return Object.fromEntries(live)
  live.sort((a, b) => Number(b[1]) - Number(a[1]))
  return Object.fromEntries(live.slice(0, MAX_ENTRIES))
}

/**
 * Has this author posted something we haven't opened?
 * @param authorId
 * @param newestAt epoch ms of their newest frame
 */
export function isStoryUnseen(authorId, newestAt) {
  if (!authorId) return true
  const at = Number(readAll()[String(authorId)] || 0)
  if (!at) return true
  // `>=` deliberately: a frame posted in the same millisecond we recorded the
  // open is one we just watched, not a new one.
  return Number(newestAt || 0) > at
}

/** Remember that we opened this author's story up to `newestAt`. */
export function markStorySeen(authorId, newestAt) {
  if (!authorId) return
  const now = Date.now()
  const map = prune(readAll(), now)
  const stamp = Number(newestAt) || now
  const prev = Number(map[String(authorId)] || 0)
  // Never move the stamp BACKWARDS — opening an older frame after a newer one
  // would otherwise relight a ring you have already cleared.
  map[String(authorId)] = Math.max(prev, stamp)
  writeAll(map)
}

/* =========================================================
   YOUR OWN story — a "new views you haven't looked at" light
   ---------------------------------------------------------
   Not the same rule as everyone else's, because there is
   nothing for you to "watch" in your own story. What you come
   back for is WHO SAW IT, so the ring tracks exactly that:

     you post                        → lit  (nothing acknowledged yet)
     you open it, "No views yet"     → dark (you're up to date)
     someone watches it              → lit  (a view you haven't seen)
     you open it, you see who saw    → dark
     you post a NEW frame            → lit  (a new thing to be seen)

   One record does all five: the newest frame you have
   acknowledged, and the viewer count at that moment. Anything
   newer or higher than the record is unacknowledged.
   ========================================================= */

const MY_KEY = 'ika:my-story-ack'

function readMyAck() {
  try {
    const raw = JSON.parse(storage.getItem(MY_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return null
    return { at: Number(raw.at) || 0, views: Number(raw.views) || 0 }
  } catch { return null }
}

/**
 * Should my own story ring be lit?
 * @param newestAt epoch ms of my newest frame
 * @param views    distinct viewers, or null while unknown
 */
export function isMyStoryUnseen(newestAt, views) {
  const ack = readMyAck()
  if (!ack) return true                                   // never acknowledged anything
  if (Number(newestAt || 0) > ack.at) return true          // a frame posted since
  // `null` is not zero — an unanswered viewer probe must never light the ring,
  // or a flaky request would read as "someone new saw this".
  if (views == null) return false
  return Number(views) > ack.views                         // views I haven't looked at
}

/** Mark my own story read up to `newestAt` / `views`. Called when the viewer
 *  opens (so the ring darkens under the tap) and again when it closes with a
 *  freshly-probed count (so the record is true rather than optimistic). */
export function markMyStorySeen(newestAt, views) {
  const at = Number(newestAt) || 0
  // No frame timestamp means nothing was shown. Substituting "now" would
  // out-stamp every existing frame and darken a ring that was never reviewed.
  if (!at) return
  const prev = readMyAck()
  // The record is a HIGH-WATER mark, so for the same frame it only ever moves
  // up. An unknown count must not RESET it (closing the viewer before the
  // probe answers would relight the ring), and neither may a LOWER one — the
  // close-time probe counts one frame while the open-time write counted
  // distinct viewers across all of them, and the smaller unit must not win.
  const floor = prev && prev.at === at ? prev.views : 0
  const next = views == null ? floor : Math.max(floor, Number(views) || 0)
  try { storage.setItem(MY_KEY, JSON.stringify({ at, views: next })) } catch { /* noop */ }
}

/** Test/debug seam. */
export function resetStorySeen() {
  try { storage.removeItem(KEY); storage.removeItem(MY_KEY) } catch { /* noop */ }
}
