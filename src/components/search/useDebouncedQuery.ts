/* =========================================================
   useDebouncedQuery — debounce + abort + stale-response guard.

   Abort support across this domain is UNEVEN and getting it
   wrong is silent rather than loud:

     take a signal   api.search.*          api.users.search
                     api.channels.discover (3rd opts argument)
     take none       api.tags.search       api.mentions.suggest
                     api.sounds.search     api.sounds.byCategory

   So the hook always issues a monotonic sequence number and
   drops replies that are not the newest, and additionally
   aborts the previous request when `abortable` is set. A
   sequence guard alone is correct but wasteful; an abort alone
   does nothing for half the endpoints here.
   ========================================================= */
import React from 'react'

export interface DebouncedQueryOptions {
  delay?: number
  /** Pass false for the endpoints that ignore `signal` — see the header. */
  abortable?: boolean
  /** Below this trimmed length the hook stays idle and never calls. */
  minLength?: number
  enabled?: boolean
}

export interface DebouncedQuery<T> {
  q: string
  setQ: (v: string) => void
  data: T | null
  loading: boolean
  error: any
  /** Re-run the current term immediately, skipping the debounce. */
  run: () => void
}

export function useDebouncedQuery<T>(
  fn: (q: string, ctx: { signal: AbortSignal }) => Promise<T>,
  { delay = 250, abortable = true, minLength = 1, enabled = true }: DebouncedQueryOptions = {},
): DebouncedQuery<T> {
  const [q, setQ] = React.useState('')
  const [data, setData] = React.useState<T | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [nonce, setNonce] = React.useState(0)

  const fnRef = React.useRef(fn)
  fnRef.current = fn
  const seq = React.useRef(0)
  const abort = React.useRef<AbortController | null>(null)
  const alive = React.useRef(true)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abort.current?.abort() }
  }, [])

  React.useEffect(() => {
    const term = q.trim()
    if (!enabled || term.length < minLength) {
      seq.current++                       // orphan whatever is still in flight
      abort.current?.abort()
      setLoading(false)
      setError(null)
      setData(null)
      return
    }

    setLoading(true)
    const id = setTimeout(async () => {
      const mine = ++seq.current
      if (abortable) abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      try {
        const res = await fnRef.current(term, { signal: ctl.signal })
        if (!alive.current || mine !== seq.current) return
        setData(res)
        setError(null)
      } catch (e: any) {
        /* An abort is the expected outcome of a keystroke, not a failure. */
        if (e?.name === 'AbortError') return
        if (!alive.current || mine !== seq.current) return
        setError(e)
      } finally {
        if (alive.current && mine === seq.current) setLoading(false)
      }
    }, delay)

    return () => clearTimeout(id)
  }, [q, delay, abortable, minLength, enabled, nonce])

  const run = React.useCallback(() => setNonce(n => n + 1), [])

  return { q, setQ, data, loading, error, run }
}
