/* =========================================================
   feedWarm — one ranked page-1 read, started from the BOOT
   HOLD. The splash holds ~1.7s of idle radio; this fills it
   with the home feed's first page so the tabs mount onto a
   warm answer instead of starting the read on arrival.

   Contract with the home screen's fetcher:
   · consulted ONCE, by the FIRST `!cursor` read in RANKED
     mode only — the "Latest" toggle must never be served a
     ranked page;
   · hands the response over and forgets it — usePaged owns
     the cursor, the dedupe and every later page;
   · stale (>10s) answers are dropped, because a feed that
     opens on a page older than the pull-to-refresh window
     reads as broken refresh.
   ========================================================= */
import { api } from '@/api'

/** Must match the home screen's page size, or the warm page's shape lies to
 *  the pagination that continues from its cursor. */
const PAGE_SIZE = 20
const FRESH_MS = 10_000

let inflight: Promise<any | null> | null = null
let readyAt = 0

export function warmHomeFeed(): void {
  if (inflight) return
  readyAt = 0
  inflight = (api.posts.home({ pageSize: PAGE_SIZE }) as Promise<any>)
    .then(res => { readyAt = Date.now(); return res })
    .catch(() => null)
}

/** The one consult. Returns the warm page or null; either way the cache is
 *  spent — a second call always goes to the wire. */
export async function takeWarmHomePage(): Promise<any | null> {
  const run = inflight
  if (!run) return null
  inflight = null
  const res = await run
  if (!res) return null
  if (!readyAt || Date.now() - readyAt > FRESH_MS) return null
  return res
}
