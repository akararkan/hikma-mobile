/* =========================================================
   useAsync — the load-once-and-render contract.

   Every detail screen in this app does the same four things:
   load, show a skeleton, show an error with a retry, and let
   a pull-to-refresh re-run it. Writing that inline is how the
   ninth screen ends up without the retry.

   Deliberately not a query library: there is no cache to
   invalidate here because the realtime layer already owns
   freshness, and a stale-while-revalidate cache fighting an
   SSE stream produces flicker rather than speed.
   ========================================================= */
import React from 'react'

export interface AsyncState<T> {
  data: T | null
  error: any
  /** First load only — render a skeleton. */
  loading: boolean
  /** A refresh over existing data — render the spinner in the RefreshControl. */
  refreshing: boolean
  reload: () => Promise<void>
  refresh: () => Promise<void>
  /** Patch the loaded value locally (optimistic updates, SSE deltas). */
  setData: React.Dispatch<React.SetStateAction<T | null>>
}

export interface UseAsyncOptions {
  /** Skip the call entirely — a screen whose id is not hydrated yet. */
  enabled?: boolean
  /** Re-run whenever any of these change. */
  deps?: React.DependencyList
  onSuccess?: (v: any) => void
  onError?: (e: any) => void
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { enabled = true, deps = [], onSuccess, onError }: UseAsyncOptions = {},
): AsyncState<T> {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [refreshing, setRefreshing] = React.useState(false)

  const fnRef = React.useRef(fn)
  fnRef.current = fn
  const cbRef = React.useRef({ onSuccess, onError })
  cbRef.current = { onSuccess, onError }

  /* Guards against the classic two bugs: a resolved promise from a screen the
     user already left, and an older request landing after a newer one. */
  const alive = React.useRef(true)
  const seq = React.useRef(0)
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; abort.current?.abort() }
  }, [])

  const run = React.useCallback(async (mode: 'load' | 'refresh') => {
    if (!enabled) return
    const mine = ++seq.current
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl

    if (mode === 'refresh') setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const value = await fnRef.current(ctl.signal)
      if (!alive.current || mine !== seq.current) return
      setData(value)
      cbRef.current.onSuccess?.(value)
    } catch (e: any) {
      if (!alive.current || mine !== seq.current) return
      if (e?.name === 'AbortError') return
      setError(e)
      cbRef.current.onError?.(e)
    } finally {
      if (alive.current && mine === seq.current) { setLoading(false); setRefreshing(false) }
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) { setLoading(false); return }
    void run('load')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const reload = React.useCallback(() => run('load'), [run])
  const refresh = React.useCallback(() => run('refresh'), [run])

  /* Identity moves only when the state does. Consumers put this object (or a
     method off it) in dependency arrays; a fresh literal every render would
     re-arm every one of those effects on unrelated renders. */
  return React.useMemo(
    () => ({ data, error, loading, refreshing, reload, refresh, setData }),
    [data, error, loading, refreshing, reload, refresh],
  )
}

/* ---------------------------------------------------------
   useAction — the write half.

   Owns `pending` so a button can't be double-tapped, catches
   the error so an unhandled rejection never reaches the
   redbox, and returns the error for a screen that wants to
   render it inline (field validation) rather than toast it.
   --------------------------------------------------------- */

export interface ActionState<A extends any[], R> {
  run: (...args: A) => Promise<R | undefined>
  pending: boolean
  error: any
  reset: () => void
}

export function useAction<A extends any[], R>(
  fn: (...args: A) => Promise<R>,
  opts: { onSuccess?: (r: R, ...args: A) => void; onError?: (e: any) => void; rethrow?: boolean } = {},
): ActionState<A, R> {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const alive = React.useRef(true)
  const busy = React.useRef(false)

  const ref = React.useRef({ fn, opts })
  ref.current = { fn, opts }

  React.useEffect(() => () => { alive.current = false }, [])

  const run = React.useCallback(async (...args: A) => {
    /* A ref, not the state, because two taps in the same frame both read the
       stale `false` from state and both fire. */
    if (busy.current) return undefined
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const r = await ref.current.fn(...args)
      if (alive.current) ref.current.opts.onSuccess?.(r, ...args)
      return r
    } catch (e: any) {
      if (alive.current) { setError(e); ref.current.opts.onError?.(e) }
      if (ref.current.opts.rethrow) throw e
      return undefined
    } finally {
      busy.current = false
      if (alive.current) setPending(false)
    }
  }, [])

  const reset = React.useCallback(() => setError(null), [])
  return { run, pending, error, reset }
}

/* ---------------------------------------------------------
   useDebounced — search fields, mention autocomplete, the
   typing signal's throttle.
   --------------------------------------------------------- */

export function useDebounced<T>(value: T, ms = 280): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/** A stable callback that never re-creates but always sees fresh values —
 *  for effects that must not re-subscribe when a handler changes. */
export function useEvent<T extends (...a: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn)
  ref.current = fn
  return React.useCallback(((...a: any[]) => ref.current(...a)) as T, [])
}

/** True only after the first render — skips "on mount" work in effects that
 *  should react to changes but not to the initial value. */
export function useIsMounted() {
  const mounted = React.useRef(false)
  React.useEffect(() => { mounted.current = true }, [])
  return mounted
}
