/* =========================================================
   When the brand gets a moment.

   THE BUG THIS EXISTS TO KILL. The welcome curtain used to be
   inferred from a gate TRANSITION — `useRef(gate === 'allow')`
   inside the signed-in layout, showing the curtain only when
   the layout was already mounted while signed OUT. It never
   was. expo-router mounts `(app)/_layout` for the first time
   *after* the session flips, so `gate` is already 'allow' on
   its first render and the curtain was permanently disarmed:
   nobody signing in, and nobody finishing sign-up, ever saw it.

   A moment is now QUEUED BY THE THING THAT CAUSES IT — login,
   two-factor redemption, register, sign-out — and claimed by
   whichever surface can show it. That also survives the long
   way round: `register()` flips the session while the user is
   still in onboarding, several screens and a minute or two
   before the app shell exists, and the queued arrival simply
   waits for it.

   One slot, deliberately. Two brand moments cannot be pending
   at once (you cannot sign in while signing out), and if the
   impossible happens the newest is the truth.
   ========================================================= */

export type BrandMomentKind =
  /** Signed in on a device that already knew this account. */
  | 'welcome'
  /** The account was created minutes ago — this is the first door. */
  | 'arrival'
  /** The session ended on purpose. */
  | 'farewell'

export interface BrandMoment {
  kind: BrandMomentKind
  /** First name, when the caller has one worth greeting. */
  name?: string | null
}

let pending: BrandMoment | null = null

/** Called by whatever changed the session. Never awaited, never fails. */
export function queueBrandMoment(kind: BrandMomentKind, name?: string | null): void {
  pending = { kind, name: name ?? null }
}

/** Claim the moment if it is one of `kinds` — otherwise leave it for the
 *  surface that owns it. Claiming clears the slot, so it plays once. */
export function takeBrandMoment(kinds: readonly BrandMomentKind[]): BrandMoment | null {
  if (!pending || !kinds.includes(pending.kind)) return null
  const m = pending
  pending = null
  return m
}

/** Drop anything pending — a session that dies on its own is not a moment. */
export function clearBrandMoment(): void {
  pending = null
}
