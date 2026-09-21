/* =========================================================
   `args()` — the one cast the API layer needs.

   The 28 modules under src/api are JavaScript, and TypeScript
   infers an options object's type from ONLY those destructured
   keys that carry a default. So

       async page(convId, { cursor, limit = 40 } = {})

   checks as `{ limit?: number }`, and `cursor` — a documented,
   load-bearing parameter — reads as an excess property. The
   runtime contract is right; the inferred type is a subset of
   it.

   Adding defaults to the JS to satisfy the inference would
   change behaviour (an explicit `cursor: undefined` is not the
   same as an absent one to `http.get`'s query builder), and
   hand-writing declarations for all 28 modules is a project of
   its own. So call sites wrap the bag:

       api.chat.messages.page(id, args({ cursor, limit: 40 }))

   Deliberately not a blanket `as any` on the call: the
   function, its name and its other arguments stay checked, and
   the widening is visible at the exact point it applies. One
   named seam beats `as any` at ninety call sites, which would
   hide real mistakes.
   ========================================================= */

/** Widen an options bag so keys without a JS default still type-check. */
export const args = <T extends object>(bag: T): any => bag
