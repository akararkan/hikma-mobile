/* =========================================================
   useViewMode — remembers a list page's layout (list / grid /
   compact) in localStorage, keyed per page. The stored value is
   validated against the allowlist on read so a stale / tampered
   key can never put a list into an unknown layout.
   ========================================================= */
/* RN: `localStorage` → ../platform/storage.js (MMKV). Same synchronous
   contract, same three methods, so every call site below is unchanged apart
   from the identifier. */
import { storage } from '../platform/storage.js'
import React from 'react'

export const VIEW_MODES = ['feed', 'grid', 'compact', 'grouped']

export function useViewMode(page, fallback = 'feed') {
  const key = 'ika:view:' + page
  const [view, setView] = React.useState(() => {
    try { const s = storage.getItem(key); return VIEW_MODES.includes(s) ? s : fallback }
    catch { return fallback }
  })
  React.useEffect(() => {
    try { storage.setItem(key, view) } catch { /* private mode / quota — keep in-memory */ }
  }, [key, view])
  return [view, setView]
}
