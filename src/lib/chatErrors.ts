/* =========================================================
   chatError — the chat surface's error copy.

   `errorText(e)` returns the backend's own message for a known
   envelope, and that is what should be shown whenever it says
   something useful. But chat's 403 family is deliberately
   terse on the wire — `BLOCKED` "never reveals who blocked
   whom", `READ_ONLY` and `ADMINS_ONLY` are one word each — and
   a one-word toast tells the user nothing about what to do.

   So this maps the codes documented in
   chat/api-reference.md to copy that explains the situation
   without leaking anything the envelope withheld, and falls
   through to `errorText` for everything else. That fall-through
   is the important half: it means a code added server-side
   later still shows the server's message rather than a generic
   "something went wrong".
   ========================================================= */
import { codeOf, errorText, cooldownSecondsFrom, isNetworkError, isRateLimited } from '@/api'

/* The chat catalog, verbatim from the docs, plus the two shared codes that
   land here most often. Anything not listed falls through. */
const COPY: Record<string, string> = {
  /* Privacy-preserving by design: it must not say who blocked whom. */
  BLOCKED: 'You can’t message this account.',
  NOT_A_MEMBER: 'You’re no longer in this conversation.',
  READ_ONLY: 'You’re restricted from posting in this group.',
  ADMINS_ONLY: 'Only admins can do that here.',
  NOT_OWNER: 'Only the owner can do that.',
  REACTIONS_DISABLED: 'Reactions are turned off here.',
  PROTECTED_CONTENT: 'This channel doesn’t allow forwarding its posts.',
  SUBSCRIBERS_HIDDEN: 'This channel keeps its subscriber list private.',
  CANNOT_ACT_ON_ADMIN: 'You can’t do that to an admin.',
  REQUEST_LIMIT_REACHED: 'You’ve reached the message limit until they reply.',
  INVITE_INVALID: 'That invite link is no longer valid.',
  CONVERSATION_NOT_FOUND: 'This conversation isn’t available any more.',
  MESSAGE_NOT_FOUND: 'That message is gone.',
  ACCESS_FORBIDDEN: 'You don’t have access to that.',
}

/**
 * @param e        the caught ApiError
 * @param fallback what the call site was trying to do, e.g. 'Could not send'
 */
export function chatError(e: any, fallback = 'Something went wrong'): string {
  if (!e) return fallback
  /* No send queue exists — nothing retries by itself, so the copy must not
     promise it. A failed send keeps its tap-to-retry affordance instead. */
  if (isNetworkError(e)) return 'You’re offline. Check your connection and try again.'
  if (isRateLimited(e)) {
    const s = cooldownSecondsFrom(e)
    return s > 0 ? `Sending too fast — try again in ${s}s.` : 'Sending too fast — slow down a moment.'
  }
  const mapped = COPY[codeOf(e)]
  if (mapped) return mapped
  /* The server's own message when it has one, the call site's description
     otherwise — never a bare "error". */
  return errorText(e, fallback)
}

/** True when retrying the same call could plausibly work. Drives whether a
 *  failed send keeps its retry affordance or is dropped. */
export function isChatRetryable(e: any): boolean {
  if (isNetworkError(e) || isRateLimited(e)) return true
  const code = codeOf(e)
  return !(code in COPY) && (e?.status == null || e.status >= 500)
}
