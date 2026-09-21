/* =========================================================
   Tab re-tap channel.

   Re-tapping the active tab is the most-used gesture in a feed
   app and react-navigation has no built-in for it: `tabPress`
   fires on every tap, focused or not, and there is no way for
   a deeply-nested list to hear it.

   So the bar announces, and whichever list is mounted for that
   tab listens. Two levels: the first re-tap scrolls to top,
   and a re-tap while already at the top refreshes — the screen
   decides which, because only it knows its scroll offset.
   ========================================================= */
import React from 'react'

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/** Returns whether anything was actually listening. The bar uses that to
 *  decide whether to fire its haptic: a buzz with no scroll behind it is
 *  worse than silence, because it teaches the gesture and then breaks the
 *  promise. Tabs with no list mounted (Explore, You) simply stay quiet. */
export function emitTabRetap(tab: string): boolean {
  let heard = false
  for (const fn of [...(listeners.get(tab) ?? [])]) {
    heard = true
    try { fn() } catch { /* one broken listener must not starve the rest */ }
  }
  return heard
}

export function onTabRetap(tab: string, fn: Listener): () => void {
  if (!listeners.has(tab)) listeners.set(tab, new Set())
  listeners.get(tab)!.add(fn)
  return () => { listeners.get(tab)?.delete(fn) }
}

/** Subscribe for the life of a component. The handler is held in a ref so an
 *  inline arrow does not re-subscribe on every render. */
export function useTabRetap(tab: string, fn: Listener) {
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => onTabRetap(tab, () => ref.current()), [tab])
}
