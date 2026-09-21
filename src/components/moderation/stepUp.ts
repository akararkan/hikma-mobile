/* =========================================================
   withStepUpAction — the wrapper every step-up-guarded admin
   write goes through.

   Eleven writes are marked @RequiresStepUp (REQUIRES_STEP_UP):
   review.bulk, settings.putThresholds, settings.putHoldDurations,
   settings.rawPut, settings.rawDelete, settings.reset,
   model.retrain, model.promote, model.rollback, queue.bulk and
   blocklist.add. <StepUpHost/> already satisfies the 403
   globally — it arms the marker and http.js replays the
   original request once — so in the normal path this wrapper
   does nothing at all.

   Its real job is the cancel case. When the user dismisses the
   host, http.js sets `err.stepUpCancelled`, and
   `security.withStepUp` translates that into a `cancelled`
   error. A screen swallows that silently: the user chose to
   stop, and both an error strip and a second prompt would
   argue with a decision they already made.

   The server arms a ~300s window, so a run of admin actions
   costs one password entry, not one per tap.
   ========================================================= */
import { api } from '@/api'

/** True for a step-up prompt the user dismissed — render NOTHING. */
export function isCancelled(e: any): boolean {
  return !!e && (e.cancelled === true || e.stepUpCancelled === true)
}

export function withStepUpAction<T>(action: () => Promise<T>): Promise<T> {
  /* The challenge resolves null on purpose: when no host is mounted there is
     no surface to collect a credential on, and "cancelled" is the honest
     answer — better than a second, screen-local password dialog that would
     race the global one. */
  return api.security.withStepUp(action, async () => null) as Promise<T>
}
