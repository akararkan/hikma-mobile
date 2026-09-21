/* =========================================================
   Route helper.

   `typedRoutes` is on, so expo-router types every href against
   a table it regenerates from the files on disk. Two things
   make a bare literal unusable here:

     · a paper id is a plain `string`, and the generated
       `SingleRoutePart` type rejects an unconstrained string
       for a dynamic segment
     · half the destinations in this domain belong to other
       domains (/u/…, /qna/…, /posts/…, /report), so the table
       only knows them once those files exist

   One cast in one place is honest about that; a hundred
   inline `as any` casts would not be.
   ========================================================= */
import type { Href } from 'expo-router'

export function to(path: string): Href {
  return path as Href
}

/* There were four `xHref(id)` shorthands here — userHref, paperHref, tagHref,
   collectionHref — and not one screen ever called them; every destination in
   this domain is built inline and passed through `to()`. Four unused helpers
   that LOOK like the canonical way to spell a route are worse than none, so
   they are gone. The one rule they carried that is not obvious from a
   literal: a paper's route must stay `/research/{id}`, because search.js's
   hitHref and the notification deep-link rewrite both hardcode that shape. */
