/* =========================================================
   Types for useCooldown.js.

   The hook returns a TUPLE, and inference over a JS array
   literal widens it to `(number | fn)[]` — which makes both
   destructured halves unusable from TypeScript. This pins the
   positions.
   ========================================================= */

/**
 * The 429 countdown primitive.
 *
 *   const [cooldown, startCooldown] = useCooldown()
 *   …catch (e) { startCooldown(e) }        // no-op unless the error is a 429
 *   <Button disabled={busy || cooldown > 0}
 *           label={cooldown > 0 ? `Wait ${cooldown}s` : 'Publish'} />
 *
 * `start` accepts a caught error (it reads the 429 hints and ignores anything
 * else) or a plain number of seconds, and answers whether a countdown actually
 * began.
 */
export declare function useCooldown(): [number, (secondsOrError: unknown) => boolean]
