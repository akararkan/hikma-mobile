/* =========================================================
   onIdle — "run this when the thread has a moment".

   This replaces `InteractionManager.runAfterInteractions`,
   and not only because RN 0.86 warns on the import. Read the
   stub it now ships (Libraries/Interaction/InteractionManager):
   `runAfterInteractions` is *literally* `setImmediate`,
   `createInteractionHandle` returns -1, `setDeadline` does
   nothing. Nothing tracks an interaction any more — so every
   call that still looked like it was deferring work past a
   navigation transition had quietly stopped deferring
   anything, and was landing on the next tick, in the middle
   of the frames it was written to protect.

   `requestIdleCallback` is what React Native points at
   instead, and it is a better instrument than the handle model
   ever was: it schedules the work at IdlePriority on the
   runtime scheduler, so it runs when nothing more urgent is
   queued rather than when a navigator remembers to release a
   token.

   TWO THINGS THE PLATFORM DOES NOT GIVE US, HENCE THE TIMER:

   · The `{ timeout }` option is not a ceiling. In RN's C++
     module (ReactCommon/react/nativemodule/idlecallbacks) it
     only decides the `didTimeout` flag on the deadline object;
     the task still carries the idle priority's own expiration.
     A thread that never goes quiet — a long list still
     measuring, a stream still parsing — can hold second-tier
     work for a long time, and work that never arrives is worse
     than work that arrives late. So the ceiling is a plain
     `setTimeout` here, and whichever fires first wins.

   · On the legacy runtime scheduler `scheduleIdleTask` is not
     implemented and the module THROWS. Same on web and under
     Jest, where the global may not exist at all. The timer is
     already running by then, so the catch is empty on purpose:
     the call degrades to a normal deferral instead of taking
     the screen down with it.

   Returns its own canceller, so an effect can `return onIdle(…)`
   and be done.
   ========================================================= */

/** The default ceiling: a shade past the 240ms push transition it defers past. */
export const IDLE_TIMEOUT_MS = 400

export function onIdle(run: () => void, timeoutMs: number = IDLE_TIMEOUT_MS): () => void {
  let fired = false
  let idle: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    if (idle !== undefined) { cancelIdleCallback(idle); idle = undefined }
  }
  /* Whichever arrives first — the idle frame or the ceiling — and only once. */
  const fire = () => {
    if (fired) return
    fired = true
    stop()
    run()
  }

  timer = setTimeout(fire, timeoutMs)
  try {
    idle = requestIdleCallback(fire, { timeout: timeoutMs })
  } catch {
    /* No idle scheduler on this runtime; the timer above is the whole story. */
  }

  return () => { fired = true; stop() }
}
