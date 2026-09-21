/* =========================================================
   Automated moderation — the client's half of the contract, both pipelines:
   text (quarantine-then-publish) and the image gate (inline at ingest).
   (backend: docs/moderation/, docs/errors/frontend-error-handling.md §2.8/§2.8a)

   Every text-bearing create/edit on this platform is scored before anyone but
   its author can see it. Exactly three things can happen, and the client has to
   render all three:

     clean    → an ordinary 2xx. Nothing here fires.
     blocked  → 400 CONTENT_REJECTED. NOTHING was persisted. Show the server's
                message, KEEP THE DRAFT, and offer no retry button — resubmitting
                the identical text can only fail the identical way.
     held     → usually a NORMAL 2xx whose entity is hidden from everyone but its
                author until it clears. Not an error: render it, badge it,
                re-check it. (Four surfaces answer a hold with 400
                CONTENT_UNDER_REVIEW instead — see isUnderReview.)

   Two rules this module exists to enforce, because both are easy to break by
   accident and neither is recoverable once shipped:

   1. NEVER decorate a rejection. Do not name a label, do not highlight the
      offending phrase, do not add "your text contained…". The server is vague on
      purpose — a precise error is a working oracle for probing the classifier
      until something gets through.
   2. NEVER branch on message TEXT. Codes are the contract; wording is tuned
      server-side. There is exactly ONE exception in this file, it is forced by a
      backend bug, and it is labelled as such (see MULTIPART_BLOCK below).
   ========================================================= */

/* ---- error codes ------------------------------------------------------
   CONTENT_REJECTED is the automated classifier. CONTENT_BLOCKED_BY_POLICY is
   the older keyword blocklist — as of the 2026-08 build no user-facing create
   path can still emit it (the blocklist now settles inside the moderation case
   and re-throws as CONTENT_REJECTED), but it costs nothing to keep recognising
   and it is still thrown by the admin blocklist test endpoint. */
export const CONTENT_REJECTED = 'CONTENT_REJECTED'
export const CONTENT_UNDER_REVIEW = 'CONTENT_UNDER_REVIEW'
export const CONTENT_BLOCKED_BY_POLICY = 'CONTENT_BLOCKED_BY_POLICY'

const BLOCK_CODES = new Set([CONTENT_REJECTED, CONTENT_BLOCKED_BY_POLICY])

/* Fallbacks only. The backend always sends `message`; these exist so a bare or
   proxy-mangled body still says something true rather than "Request failed". */
export const BLOCKED_FALLBACK =
  'This content was blocked because it appears to violate the community guidelines. '
  + 'If you believe this is a mistake, you can appeal from your account settings.'
export const UNDER_REVIEW_FALLBACK =
  'This content is still being reviewed. You will be notified once a decision is made.'

/* ---- the one message sniff, and why ------------------------------------
   `POST /api/v1/posts` with multipart/form-data wraps createPost in
   `catch (Exception)` (CassandraFeedController). A moderation block is a
   BadRequestException, so it is swallowed and re-emitted as

       500 {"error":"post_create_failed","message":"<the moderation copy>","rolledBackFiles":N}

   — no `errorCode`, no 400. http.js maps `body.error` onto `err.code`, so the
   code we see is the literal "post_create_failed", which also covers genuine
   database failures. The message is the ONLY thing that separates "we blocked
   you" from "the write failed", so this one match earns its exception to rule 2.
   Matched on a stable clause rather than the full sentence so a copy tweak
   degrades to a generic error rather than to a wrong one.

   Fix this here the day the backend narrows that catch. */
const MULTIPART_FAIL_CODE = 'post_create_failed'
const MULTIPART_BLOCK = /community guidelines/i

/** 400 CONTENT_REJECTED / CONTENT_BLOCKED_BY_POLICY — refused, nothing saved.
 *  Also true for the multipart-post 500 described above. */
export function isBlocked(err) {
  if (!err) return false
  if (BLOCK_CODES.has(err.code)) return true
  return err.code === MULTIPART_FAIL_CODE && MULTIPART_BLOCK.test(err.message || '')
}

/** 400 CONTENT_UNDER_REVIEW — the change did NOT apply and is not refused
 *  either; a verdict is still pending on this exact text.
 *
 *  Thrown by the four surfaces that refuse to show a half-checked name to other
 *  people: channel update, group update, stream update, and research publish.
 *  The previously approved value keeps serving. The right UI is "not yet — try
 *  again in a moment", with the draft intact, NOT a rejection. */
export function isUnderReview(err) {
  return !!err && err.code === CONTENT_UNDER_REVIEW
}

/** Either moderation refusal — the test a composer's catch block wants. */
export function isModerationError(err) {
  return isBlocked(err) || isUnderReview(err)
}

/** The message to show, VERBATIM from the server when it sent one. Never
 *  concatenate anything onto the result (see rule 1 above). */
export function moderationText(err) {
  if (isUnderReview(err)) return err?.message || UNDER_REVIEW_FALLBACK
  /* The multipart 500 carries the moderation sentence in `message` too, so this
     is still the server's own copy — just arriving through the wrong door. */
  if (err?.message && isBlocked(err)) return err.message
  return err?.message || BLOCKED_FALLBACK
}

/* ---- the image gate (docs/moderation/image-moderation-frontend.md) -----
   The image sibling of the text pipeline above, and a much smaller contract:
   every upload endpoint — multipart and chunked sessions alike — screens image
   bytes (and video poster frames) server-side, so there is nothing new to
   call. Exactly two errors can come back, and they demand OPPOSITE recoveries,
   which is why this is a pair of predicates and not one:

     MEDIA_NSFW_BLOCKED (400)           → terminal. The same bytes score the
                                          same, so NEVER auto-retry and never
                                          offer "try again" — the only way
                                          forward is remove/replace the image.
                                          Keep the rest of the composer state.
     MEDIA_MODERATION_UNAVAILABLE (503) → transient, strict-mode only. Offer
                                          "Try again" with the SAME picked
                                          asset — a few seconds is enough.

   Batches roll back atomically: if file 3 of 5 trips, the request fails whole
   and files 1–2 are removed server-side. The envelope does not say WHICH file
   tripped, so surface the error against the batch, keep every file selected,
   and let the user drop one and resubmit.

   Videos block exactly like images (the poster frame is screened), and
   chunked sessions fail at the COMPLETE step — after 100% progress — so
   progress UI has to transition 100% → failed without treating it as done.

   Rule 1 above applies with extra force here: never mention scores,
   thresholds, or how detection works, and keep the tone non-accusatory —
   false positives (beach / medical / art photos) are expected and the copy
   must leave room for them. */
export const MEDIA_NSFW_BLOCKED = 'MEDIA_NSFW_BLOCKED'
export const MEDIA_MODERATION_UNAVAILABLE = 'MEDIA_MODERATION_UNAVAILABLE'

/** 400 — the gate refused the image; nothing was stored. Terminal. */
export function isNsfwBlocked(err) { return !!err && err.code === MEDIA_NSFW_BLOCKED }

/** 503 — the scorer is down and admins run FAIL_CLOSED. Retryable. (With the
 *  default fail-open policy this never occurs — uploads just publish.) */
export function isScreeningDown(err) { return !!err && err.code === MEDIA_MODERATION_UNAVAILABLE }

/* Fallbacks only — the server always sends `message` (MediaMessages) and its
   copy wins verbatim; these mirror it for a proxy-mangled body. */
const NSFW_BLOCKED_FALLBACK =
  "This image appears to contain explicit content and can't be uploaded here."
const SCREENING_DOWN_FALLBACK =
  'Image screening is temporarily unavailable — please try again in a moment.'

/**
 * The one switch an upload catch block needs:
 *   null                                    → not the image gate; use the
 *                                             surface's existing error path.
 *   { code, retryable, message }            → render `message` INLINE at the
 *     file/preview (not a global toast), keep all composer state, and show a
 *     retry affordance only when `retryable`.
 */
export function describeUploadError(err) {
  if (isNsfwBlocked(err)) {
    return { code: MEDIA_NSFW_BLOCKED, retryable: false, message: err?.message || NSFW_BLOCKED_FALLBACK }
  }
  if (isScreeningDown(err)) {
    return { code: MEDIA_MODERATION_UNAVAILABLE, retryable: true, message: err?.message || SCREENING_DOWN_FALLBACK }
  }
  return null
}

/* ---- held state -------------------------------------------------------
   Which modules actually TELL the client that something is held, verified
   against the DTOs rather than the docs (docs/moderation/user-behaviour.md is
   wrong on three of these):

     posts / reels    status: "PENDING_REVIEW"  ← PENDING and IN_REVIEW collapse
                      into this one string, so a post can never distinguish
                      "checking" from "a human has it"
     stories          moderationStatus: "PENDING" | "IN_REVIEW" | null
     research publish 200 whose status stayed "DRAFT"  (see heldPublish)

   And the ones that tell the client NOTHING — the response of a held item is
   byte-identical to a clean one:

     post comments + replies, research papers' comments, Q&A questions and
     answers, chat messages, channel / group / stream metadata.

   For those the author simply keeps seeing their own content (the server's read
   filters carve the author out) and no badge is possible. That is a backend
   gap, not a bug here: do not fake a badge by guessing, because guessing wrong
   marks clean content as "checking" — see docs note in ModerationNotice.

   A NULL/absent marker means approved: rows that predate moderation and rows
   whose verdict cleared both read that way (PostHydrator.visibleToViewer). */
const HELD_VALUES = new Set(['PENDING_REVIEW', 'PENDING', 'IN_REVIEW'])
const ESCALATED_VALUES = new Set(['IN_REVIEW'])
const REMOVED_VALUES = new Set(['REJECTED'])

/** Fields that may carry a moderation marker, most specific first. */
const MARKER_FIELDS = ['moderationStatus', 'moderationState', 'status']

function markerOf(item) {
  if (!item || typeof item !== 'object') return null
  for (const field of MARKER_FIELDS) {
    const raw = item[field]
    if (typeof raw !== 'string' || !raw) continue
    const value = raw.toUpperCase()
    /* `status` is a shared column, so only moderation's OWN spellings count
       there — PUBLISHED / DRAFT / ARCHIVED / ACTIVE must fall through as "not a
       marker". A DRAFT research paper is not a moderation hold, and treating it
       as one would badge every draft in the app. */
    if (HELD_VALUES.has(value) || REMOVED_VALUES.has(value)) return value
  }
  return null
}

/** 'live' | 'checking' | 'review' | 'removed' — the four states a client renders.
 *
 *  'checking' vs 'review' is a real distinction with different copy: the first
 *  is the automatic pass (seconds), the second means a human now owns it. Posts
 *  collapse both into PENDING_REVIEW on the wire, so a post can only ever reach
 *  'checking' — which is the honest thing to show when you cannot tell. */
export function moderationState(item) {
  const marker = markerOf(item)
  if (!marker) return 'live'
  if (REMOVED_VALUES.has(marker)) return 'removed'
  return ESCALATED_VALUES.has(marker) ? 'review' : 'checking'
}

/** Written but not published — visible to its author alone. */
export function isHeld(item) {
  const state = moderationState(item)
  return state === 'checking' || state === 'review'
}

/** Blocked and kept only as the author's own tombstone. */
export function isRemoved(item) {
  return moderationState(item) === 'removed'
}

/**
 * Research publish is the one surface whose HOLD is detectable without a marker:
 * `POST /researches/{id}/publish` answers 200 with the paper still
 * `status: "DRAFT"` and `publishedAt: null`. A successful publish returns
 * PUBLISHED. So "publish said OK but it is still a draft" means held — which is
 * exactly what the user-guide promises ("your paper stays as a draft while it is
 * checked, and becomes public the moment it clears").
 */
export function heldPublish(research) {
  return !!research && String(research.status || '').toUpperCase() === 'DRAFT'
}

/**
 * The same trick one step later: an edit to an ALREADY-PUBLISHED paper that
 * fails the check takes the paper back to draft until the new wording clears
 * (user-guide, "Editing a published paper"). The PATCH answers 200, not an
 * error, so the only tell is the shape of what comes back.
 *
 * `publishedAt` is what separates the two ways a paper can be a draft, and it
 * is reliable rather than a guess: the only path that clears publishedAt is
 * unpublish, which clears it on the very next line after setting DRAFT. A held
 * edit and a rejection both leave it intact, and a paper that was never
 * published has never had one. So DRAFT with a publishedAt means, and can only
 * mean, "moderation pulled this off the public surface."
 *
 * Do not "simplify" this to a status check — that would light the banner on
 * every ordinary draft.
 */
export function heldEdit(research) {
  return !!research
    && String(research.status || '').toUpperCase() === 'DRAFT'
    && !!research.publishedAt
}

/* ---- copy -------------------------------------------------------------
   Held/removed copy is OURS. ModerationMessages.NOTE_HELD_FOR_REVIEW exists
   server-side but is referenced by zero call sites — verified against both the
   source and the live API, no create response carries a `note`. Wording tracks
   those unused constants and docs/moderation/user-guide/ so that if the backend
   ever does start sending them, the two agree. */
export const MODERATION_COPY = {
  checking: {
    badge: 'Checking…',
    title: 'Checking…',
    note: 'Your content is being checked automatically. It becomes visible to others '
      + 'as soon as it clears — usually within a few seconds.',
  },
  review: {
    badge: 'Under review',
    title: 'Under review.',
    note: 'Automatic checking took longer than expected, so a moderator is reviewing '
      + 'this. It stays hidden from others until then.',
  },
  removed: {
    badge: 'Removed',
    title: 'Removed by moderation.',
    note: 'This was removed because it appears to violate the community guidelines. '
      + 'You can appeal from Settings → Safety.',
  },
}

/** The user-visible noun for a content kind, matching the words the server uses
 *  in its notification bodies (ModerationNotifier.LABELS) so the badge and the
 *  bell never disagree about what was held. */
export const ENTITY_LABEL = {
  POST: 'post',
  POST_COMMENT: 'comment',
  STORY: 'story',
  STORY_POLL: 'story poll',
  RESEARCH: 'research paper',
  RESEARCH_COMMENT: 'comment',
  QNA_QUESTION: 'question',
  QNA_ANSWER: 'answer',
  CHAT_MESSAGE: 'message',
  CHANNEL: 'channel details',
  STREAM_META: 'stream details',
  LIVE_CHAT: 'live chat message',
  CONTENT_ANNOTATION: 'content',
}

/* ---- re-check scheduling ----------------------------------------------
   Held content clears on its own and the client is never told: there is no
   realtime moderation event anywhere in the platform, and the "your content is
   live" bell fires ONLY for content that actually waited (an inline clear is
   deliberately silent). So a held item re-fetches itself.

   These are the server's HARD CEILINGS (ModeratedEntityType) — the maximum
   wait, not the expected one; most content clears in well under a second. */
export const HOLD_CEILING_MS = {
  POST: 30000,
  POST_COMMENT: 10000,
  STORY: 15000,
  STORY_POLL: 15000,
  RESEARCH: 60000,
  RESEARCH_COMMENT: 10000,
  QNA_QUESTION: 30000,
  QNA_ANSWER: 30000,
  CHAT_MESSAGE: 10000,
  CHANNEL: 30000,
  STREAM_META: 30000,
  LIVE_CHAT: 5000,
  CONTENT_ANNOTATION: 10000,
}

/**
 * Back-off schedule for one held item, as ms OFFSETS from the moment the hold
 * was first seen (not gaps — the hook differences them). Front-loaded
 * because the overwhelming majority clears inside the first second or two, then
 * spaced out: when the model is unreachable EVERYTHING is held at once, and
 * that is precisely the moment a tight poll would turn one outage into two.
 *
 * The last entry lands at the entity's ceiling, past which a human owns the
 * case and no amount of polling will change the answer.
 */
export function recheckDelays(kind = 'POST') {
  const ceiling = HOLD_CEILING_MS[kind] ?? HOLD_CEILING_MS.POST
  const schedule = [1200, 3000, 6000, 12000, 25000, 45000]
  const out = schedule.filter(ms => ms < ceiling)
  out.push(ceiling)                       // one final check at the ceiling itself
  return out
}
