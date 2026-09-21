/* =========================================================
   Local search history.

   There is NO endpoint that writes a search. The server records
   GLOBAL_SEARCH / HASHTAG_SEARCH activity rows by itself for
   authenticated callers, and the client can only read them
   (`api.activity.list`) or delete them. Signed-out users get no
   server trail at all — so "recent searches" lives on the device.

   MMKV is synchronous, which is the whole reason this is not a
   hook: the recents panel is readable during the first render
   and never flashes empty on the way in.
   ========================================================= */
import { storage } from '@/platform/storage'

export type RecentKind = 'text' | 'tag'
export interface Recent { q: string; kind: RecentKind; at: number }

const KEY = 'ika:search:recents'
const CAP = 12

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function read(): Recent[] {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r: any) => r && typeof r.q === 'string' && r.q.trim())
      .map((r: any): Recent => ({ q: r.q, kind: r.kind === 'tag' ? 'tag' : 'text', at: Number(r.at) || 0 }))
      .slice(0, CAP)
  } catch {
    /* A corrupt blob is not worth a crash on the app's most-used tab. */
    return []
  }
}

function write(list: Recent[]): Recent[] {
  const next = list.slice(0, CAP)
  try { storage.setItem(KEY, JSON.stringify(next)) } catch { /* full disk — the list is not load-bearing */ }
  return next
}

export const recentSearches = {
  list: read,

  /** Most-recent-first, deduped case-insensitively so "Zakat" does not sit
   *  above "zakat". Returns the new list so a caller can setState from it. */
  push(term: string, kind: RecentKind = 'text'): Recent[] {
    const q = String(term || '').trim()
    if (!q) return read()
    return write([{ q, kind, at: Date.now() }, ...read().filter(r => !same(r.q, q))])
  },

  remove(term: string): Recent[] {
    return write(read().filter(r => !same(r.q, term)))
  },

  clear(): Recent[] {
    return write([])
  },
}
