/* =========================================================
   useTransientRetry — the one automatic retry the error guide
   allows, and the ONLY copy of it.

   503 / DATASTORE_UNAVAILABLE is transient BY CONTRACT on the
   Cassandra-backed reads: the datastore did not answer, and the
   same request a second later usually does. One delayed retry
   for a READ is the documented behaviour; a loop is not, so
   this fires at most once per outage episode and then hands
   the user a Retry button.

   This lived in three places — src/components/search/,
   src/components/research/states.tsx and
   src/components/channels/states.tsx — with three different
   guards and three different delays. Two of the three guards
   did not actually guard (see the wall-clock note below), and
   a reader had no way to tell which copy a given screen had
   imported. The domain modules now re-export this one.
   ========================================================= */
import React from 'react'
import { isTransient } from '@/api'

/** How long one spent retry keeps the guard closed. Anything shorter and a
 *  datastore that is down for a minute gets a slow-motion retry loop; anything
 *  longer and a screen the user left open all afternoon never re-arms. */
const EPISODE_MS = 60_000

export function useTransientRetry(error: any, retry: () => void, delay = 1500) {
  /* A WALL CLOCK, not a boolean keyed on `error` going falsy, and not the
     error's object identity. useAsync.run and usePaged.load both clear the
     error synchronously BEFORE they await, so a persistent 503 arrives as
     E1 → null → E2 across three commits — a guard reset on that null commit
     re-arms on every single failure, which is the hammer loop this hook
     exists to prevent. Identity is worse still: http.js mints a fresh error
     object per request, so an identity guard never matches and never guards.
     The clock is the only signal here that honestly separates a new episode
     from the tail of the one whose retry we already spent. */
  const spentAt = React.useRef(0)
  const retryRef = React.useRef(retry)
  retryRef.current = retry

  React.useEffect(() => {
    if (!error || !isTransient(error)) return
    if (Date.now() - spentAt.current < EPISODE_MS) return
    spentAt.current = Date.now()
    const id = setTimeout(() => retryRef.current(), delay)
    return () => clearTimeout(id)
  }, [error, delay])
}
