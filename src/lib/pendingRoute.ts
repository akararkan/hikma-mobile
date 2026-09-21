/* =========================================================
   The route the gate turned away.

   A deep link that lands on the app while signed out is thrown
   at the sign-in door and, without this, forgotten: (app) is
   remounted empty afterwards and the user gets the Home feed
   instead of the post they tapped.

   Module scope, deliberately NOT persisted. A parked route is
   only meaningful for the sign-in that immediately follows it —
   surviving a cold start would drop someone into a stranger's
   post days later, from a link they no longer remember opening.
   ========================================================= */

let pending: string | null = null

export function setPendingHref(href: string) {
  pending = href
}

/** Read and forget — a parked route is replayed exactly once. */
export function takePendingHref(): string | null {
  const href = pending
  pending = null
  return href
}

export function clearPendingHref() {
  pending = null
}
