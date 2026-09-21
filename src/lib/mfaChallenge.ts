/* =========================================================
   The 2FA challenge store.

   MEMORY ONLY, and that is the whole point. The mfaToken is a
   credential: `auth.js` is explicit that it lives for the
   length of the sign-in and is never written to storage.

   It also must not travel as a route param — expo-router
   persists navigation state, so a param would put the
   credential on disk by a side door and leave it there after
   the app is killed mid-sign-in.

   Single-use, and it burns after 5 server-side attempts, so a
   dead challenge is dead: the screen bounces back to the
   password step rather than offering a retry that cannot work.
   ========================================================= */

export interface MfaChallenge {
  mfaToken: string
  /** Seconds the challenge is valid for; the server default is 300. */
  expiresIn: number
  /** Wall-clock start, so a re-render does not restart the countdown. */
  startedAt: number
}

let challenge: MfaChallenge | null = null

/** Park a challenge on the way to the code screen. */
export function setMfaChallenge(c: { mfaToken: string; expiresIn?: number | null }) {
  challenge = {
    mfaToken: c.mfaToken || '',
    expiresIn: Number(c.expiresIn) > 0 ? Number(c.expiresIn) : 300,
    startedAt: Date.now(),
  }
}

/** Read it without consuming — the code screen may submit more than once
 *  (a wrong TOTP code leaves the challenge alive for another try). */
export function peekMfaChallenge(): MfaChallenge | null {
  if (!challenge?.mfaToken) return null
  return challenge
}

/** Seconds left, floored at 0. */
export function mfaSecondsLeft(): number {
  if (!challenge) return 0
  const elapsed = (Date.now() - challenge.startedAt) / 1000
  return Math.max(0, Math.round(challenge.expiresIn - elapsed))
}

/** Drop it. Called on success, on a dead challenge, and when the user backs
 *  out — a half-abandoned challenge must not leak into the next attempt. */
export function clearMfaChallenge() { challenge = null }

/* ---------------------------------------------------------
   A one-shot notice for the sign-in screen, in the same
   spirit as http.js's signed-out reason: the code screen
   bounces back carrying the server's explanation, and the
   password screen reads it once.
   --------------------------------------------------------- */

let notice: string | null = null

export function setSignInNotice(msg: string | null) { notice = msg || null }

export function takeSignInNotice(): string | null {
  const n = notice
  notice = null
  return n
}
