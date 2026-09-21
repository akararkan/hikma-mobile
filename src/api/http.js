/* =========================================================
   Core HTTP client
   - Attaches `Authorization: Bearer <jwt>` (and sends cookies)
   - Parses BOTH backend error-envelope shapes:
       Posts:        { errorCode, message, fieldErrors, traceId, ... }
       QnA/Research: { error, message, path, ... }  (error = code)
   - Handles "bare-body" responses (401/403/404 with no JSON)
   - Returns parsed JSON, or null for 204 No Content
   - Self-reports every failure once (status/code/traceId) via
     logApiError, flags Deprecation'd routes and unhydrated
     path params, and — being the single funnel — owns the two
     global recovery dances: 401 refresh-retry-logout and
     403 STEP_UP_REQUIRED arm-and-replay (<StepUpHost/>).
   ---------------------------------------------------------
   REACT NATIVE PORT — the only api/ file with real edits.
   Six of them, all mechanical, each marked `RN:` below:
     1. flashToast  → ../platform/toast.js   (was document.getElementById)
     2. endSession  → ../platform/storage.js + ../platform/appEvents.js
     3. MOCK_BUILD  → ../platform/env.js     (was import.meta.env)
     4. withTierApplied → pass-through       (RN FormData has no .entries())
     5. saveBlob    → deleted                (expo-file-system + expo-sharing)
     6. credentials:'include' → kept, inert on RN; see doRefresh + config.js
   Everything else — the big-int-safe JSON parser, both error
   envelopes, the 401 refresh-retry, the 403 step-up replay, the
   429 handling, the unhydrated-param guard — is platform-neutral
   and is byte-identical to the web source.
   ========================================================= */
import { API_BASE, session } from './config.js'
import { logApiError } from './errors.js'
/* RN 1: the toast poke. Same contract as the web helper (fire-and-forget,
   never throws, no-op when nothing is registered) — one indirection instead
   of the DOM, so api/ still never imports UI. */
import { flashToast } from '../platform/toast.js'
/* RN 2: sessionStorage is an in-memory Map on native (which is exactly what
   "clears on app restart" means on a phone); the DOM event bus becomes a
   tiny emitter with the same event names. */
import { sessionStorage } from '../platform/storage.js'
import { emit, AUTH_EXPIRED } from '../platform/appEvents.js'
/* RN 7: SDK 57's global fetch is expo/fetch, whose multipart serializer
   rejects RN's `{uri, name, type}` file parts outright ("Unsupported
   FormDataPart implementation" — thrown before any network I/O, surfacing
   as the offline copy). withFetchableFileParts gives each such part a
   bytes() reader so expo/fetch can serialize it; a no-op on web. */
import { withFetchableFileParts } from '../platform/files.js'
/* RN 3: Metro does not do Vite's `import.meta.env` compile-time substitution,
   so the mock switch is read through flag.js (which is now backed by
   ../platform/env.js + ../platform/storage.js). Static import, not dynamic:
   `mockEnabled()` must stay synchronous — see the mock-mode block below. */
import { mockEnabled } from '../mock/flag.js'

/* ---------- big-integer-safe JSON ----------
   Message ids are Snowflakes — 18-digit longs, an order of magnitude ABOVE
   Number.MAX_SAFE_INTEGER (9007199254740991). `JSON.parse` turns them into
   doubles, and the double's shortest decimal form is a DIFFERENT integer:
   355456387759665152 comes back out of `String(n)` as 355456387759665150,
   which the backend answers with 404. Ids are identity, never arithmetic, so
   every integer too large to survive the round trip is kept as its exact
   decimal STRING and compared with the helpers in ./ids.js.

   NOT a browser workaround: Hermes uses the same IEEE-754 doubles and loses
   the same precision. Keep this.

   The alternation consumes whole string literals first, so digits inside a
   string are never touched, and a number is only quoted when it is preceded
   by a JSON delimiter (`:`/`,`/`[`/space) — which is why the fractional part
   of `1.2345678901234567` can't be mistaken for an id. */
const BIG_INT_RE = /"(?:\\.|[^"\\])*"|([:,[\s])(-?\d{16,})(?![\d.eE])/g

function quoteBigInts(text) {
  return text.replace(BIG_INT_RE, (whole, lead, digits) => {
    if (digits === undefined) return whole                       // a string literal — leave it alone
    return Number.isSafeInteger(Number(digits)) ? whole : `${lead}"${digits}"`
  })
}

/** JSON.parse that never silently rounds a Snowflake. Exported because the
 *  SSE stream parses its own frames and must agree with the REST layer. */
export function parseJson(text) {
  return JSON.parse(quoteBigInts(text))
}

export class ApiError extends Error {
  constructor(status, code, message, payload) {
    super(message || code || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code || null          // machine-readable code (errorCode OR error)
    this.payload = payload || null    // full parsed body when present
    this.fieldErrors = payload?.fieldErrors || null
    this.traceId = payload?.traceId || null
    this.details = payload?.details || null   // per-error context: {retryAfterSeconds, maxSize, field, hint, resetsAt, …}
    /* 429 rate-limit hints. Older modules put them at the envelope top level;
       the Settings module nests them under `details`
       (ApiErrorResponse.details = {action, retryAfterSeconds}). Read both. */
    this.retryAfterSeconds = payload?.retryAfterSeconds ?? payload?.details?.retryAfterSeconds ?? null
    this.action = payload?.action ?? payload?.details?.action ?? null
  }
}

function buildUrl(path, query) {
  const base = API_BASE || ''
  let url = path.startsWith('http') ? path : base + path
  if (query && Object.keys(query).length) {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      /* An array becomes a REPEATABLE param (?type=A&type=B) — the Spring
         convention for multi-value filters. append(k, array) would join with
         commas, which the server reads as one (invalid) enum value. */
      if (Array.isArray(v)) { for (const item of v) { if (item != null && item !== '') usp.append(k, item) } }
      else usp.append(k, v)
    }
    const qs = usp.toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }
  return url
}

/** Body text + status (+ Retry-After header seconds) → ApiError. Shared by the
 *  fetch funnel, the XHR upload funnel and the chunked-upload client
 *  (api/uploads.js) so all three speak the same envelope. */
export function errorFromText(status, text, retryAfterHeaderSeconds) {
  let body = null
  if (text) { try { body = parseJson(text) } catch { /* bare / non-json body */ } }

  // 429 can arrive as a JSON envelope OR a bare proxy/edge body that only carries a
  // `Retry-After` header — handle both so the friendly message + cooldown seconds work
  // regardless of who throttled the request.
  if (status === 429) {
    const nested = body?.details?.retryAfterSeconds            // Settings module nests the hint
    const retry = (body && typeof body.retryAfterSeconds === 'number') ? body.retryAfterSeconds
      : (typeof nested === 'number') ? nested
      : (Number.isFinite(retryAfterHeaderSeconds) ? retryAfterHeaderSeconds : null)
    const message = (body && body.message) || `Slow down — try again in ${retry ?? 5}s`
    const err = new ApiError(429, (body && (body.errorCode || body.error)) || 'RATE_LIMITED', message, body)
    if (retry != null) err.retryAfterSeconds = retry
    if (body && body.action) err.action = body.action
    return err
  }

  if (body && typeof body === 'object') {
    // Posts envelope uses `errorCode`; QnA/Research use `error` as the code.
    const code = body.errorCode || body.error || null
    const message = body.message || (typeof body.error === 'string' ? body.error : null)
    return new ApiError(status, code, message, body)
  }
  // Bare-body (no JSON) — common for Posts 401/403/404.
  const fallback = {
    401: 'You need to sign in to do that.',
    403: 'You do not have permission to do that.',
    404: 'Not found.',
  }[status] || `Request failed (${status})`
  return new ApiError(status, null, fallback, null)
}

async function parseError(res) {
  const text = await res.text().catch(() => '')
  return errorFromText(res.status, text, parseInt(res.headers.get('Retry-After') || '', 10))
}

/* ---------- 401 auto-refresh-and-retry ----------
   When the 1-hour access token expires, transparently rotate it via
   POST /auth/refresh and retry the original request ONCE. Concurrent
   401s share a single in-flight refresh (no stampede). A revoked token
   or a failed refresh is terminal → clear the session and signal the
   app to route to login. */
let refreshing = null

function isAuthPath(path) { return path.includes('/api/v1/auth/') }   // never refresh-retry the auth calls themselves

function refreshOnce() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null })
  return refreshing
}

/** The ONE refresh funnel, shared by this file's reactive 401 interceptor and
 *  auth.js's proactive timer. Sharing is a security requirement, not tidiness:
 *  rotation is mandatory server-side, so two refreshes racing (timer firing on
 *  app-wake while a queued 401 recovers) would have the loser replay a token
 *  the winner just rotated — and a replayed refresh token is treated as theft:
 *  the server revokes EVERY session (AUTH_REFRESH_TOKEN_REUSED).
 *  → {ok:true, data:AuthResponse} | {ok:false, code} */
export function refreshSession() { return refreshOnce() }

/** → {ok:true} | {ok:false, code} — the code is the refresh endpoint's OWN
 *  errorCode (AUTH_REFRESH_TOKEN_EXPIRED/_INVALID/_MISSING/_NOT_FOUND/_REUSED),
 *  every one of which is terminal. It matters because _REUSED means the server
 *  detected token reuse and revoked EVERY session — the sign-out copy must say
 *  so, not claim an ordinary expiry.
 *
 *  RN — STEP 2, LANDED. The stored refresh token rides the BODY (field name
 *  verified against the live server: AuthResponse carries `refreshToken`, and
 *  `POST /refresh {refreshToken}` rotates with no cookie present). The
 *  HttpOnly-cookie fallback still covers a body-less call, but native never
 *  depends on it. BOTH halves of the rotated pair are adopted: rotation is
 *  mandatory server-side, so failing to store the new refresh token would make
 *  the NEXT refresh replay a revoked one — which the server reads as theft and
 *  answers by revoking every session (AUTH_REFRESH_TOKEN_REUSED). */
async function doRefresh() {
  try {
    const stored = session.getRefresh()
    const res = await fetch(buildUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(stored ? { refreshToken: stored } : {}),
      credentials: 'include',
    })
    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (data?.accessToken) {
        session.setToken(data.accessToken)                        // Bearer beats cookie — must adopt the fresh one
        if (data.refreshToken) session.setRefresh(data.refreshToken)
        return { ok: true, data }                                 // data → auth.refresh() reads expiresIn for the next timer
      }
      return { ok: false, code: null }
    }
    const body = await res.json().catch(() => null)
    return { ok: false, code: body?.errorCode || body?.error || null }
  } catch { return { ok: false, code: null } }
}

const SIGNED_OUT_COPY = 'Your session expired. Please sign in again.'
const SIGNED_OUT_REUSED_COPY = 'You were signed out of all devices for security. Please sign in again.'

/* RN 2: `typeof window === 'undefined'` was the web's "not in a browser, do
   nothing" guard — on native it would be true and would skip the whole body,
   silently disabling the sign-out signal. It goes; the emitter is always
   available. */
function endSession(reason = SIGNED_OUT_COPY) {
  session.clear()
  /* Parked for the login screen: the redirect unmounts the toast host, so the
     "why am I here?" line has to survive the navigation. The auth screen reads
     and clears it on mount. */
  try { sessionStorage.setItem('ika:signed-out', reason) } catch { /* never break a request */ }
  emit(AUTH_EXPIRED)   // AuthProvider → setUser(null) → the navigator guard routes to login
}

/** The parked sign-out reason, read-and-clear. The auth screen calls this on
 *  mount so the user is told WHY they landed there. */
export function takeSignedOutReason() {
  const v = sessionStorage.getItem('ika:signed-out')
  if (v) sessionStorage.removeItem('ika:signed-out')
  return v
}

/* ---------- 403 STEP_UP_REQUIRED — arm-and-replay ----------
   Not a permission failure: the user IS allowed, they just have to re-prove
   presence. A step-up host (mounted once in the root layout) registers a
   prompt that collects the password / TOTP code, POSTs /api/v1/security/step-up,
   and resolves true — at which point the ORIGINAL request is replayed once. The
   server-side window (~5 min) then covers the rest of the batch, so a run of
   sensitive actions prompts once, not per tap. With no host registered
   (signed-out shell, tests) the 403 falls through to the caller unchanged. */
let stepUpPrompt = null
export function setStepUpPrompt(fn) { stepUpPrompt = fn }
function isStepUpPath(path) { return path.includes('/api/v1/security/step-up') }

/** `attachment; filename="2026-07-27_09-15-03.mp4"` → the bare filename.
 *  RFC 5987's `filename*=UTF-8''…` wins when present (it is the one that can
 *  carry non-ASCII). Returns '' when the header says nothing useful. */
function filenameFrom(disposition) {
  const d = String(disposition || '')
  const ext = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(d)
  if (ext) { try { return decodeURIComponent(ext[1].trim().replace(/^"|"$/g, '')) } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(d)
  return plain ? plain[1].trim() : ''
}

/* ---- mock mode ----------------------------------------------------------
   One switch (EXPO_PUBLIC_USE_MOCK, or the `ika_mock` storage key) serves the
   whole app from src/mock/data.json. It is intercepted HERE, at the single
   funnel every REST call passes through, so the fixture still travels the real
   path — adapters, defensive parsing, error envelopes. A miss falls through to
   the network, so a partial fixture degrades to the live API rather than to a
   blank screen.

   RN 3: on web this was an `import.meta.env` constant a production build could
   fold to `false`. Metro is different, and the difference was measured rather
   than assumed: `collectDependencies` walks the AST and registers every
   `import()` it finds BEFORE the constant folding that would drop this branch,
   so the dependency edge survives even though the code does not. Gating on
   `__DEV__` alone moved the release bundle by -0.2% and the fixture was still
   in the bytecode — grep a release .hbc for `hewler-iils.example` to see it.

   What actually keeps the 1.4 MB out is the `resolveRequest` swap in
   metro.config.js, which redirects ../mock/index.js to ../mock/index.prod.js
   whenever Metro builds with dev=false. Verified both ways: the release bundle
   loses 1,381,748 bytes (10.7%) and the fixture strings are gone, while a
   `--dev` bundle still carries them.

   The `if (__DEV__)` below stays — it is honest about intent and skips an
   await in release — but do not credit it with the size win.

   The gate ALSO reads the live switch (`mockEnabled()`, synchronous by design
   — flag.js exists precisely so this question can be asked without dragging
   data.json in). The cost, stated plainly: a release build can no longer be
   flipped into mock mode with `storage.setItem('ika_mock','on')`. Mock demos
   are a dev-build feature now. */

/** `{hit:false}` | `{hit:true, value}` — a plain object rather than a shared
 *  Symbol, so nothing has to be imported just to recognise a miss. */
async function tryMock(method, path, opts) {
  if (__DEV__) {
    const mock = await import('../mock/index.js')
    return mock.resolveMock(method, path, opts)
  }
  return { hit: false }
}

/* A path segment that is the literal 'undefined'/'null' is always a component
   that fetched before its variable was hydrated — the server answers 400
   TYPE_MISMATCH with hint=frontend_path_param_unhydrated. Catch it on the way
   OUT too, so the console names the bug even when the mock layer absorbs it. */
const UNHYDRATED_PATH_RE = /\/(?:undefined|null)(?=\/|$|\?)/

export async function request(method, path, opts = {}) {
  const { body, query, headers = {}, multipart = false, signal, keepalive = false, as = 'json', quiet = [], deadlineMs = 15000, _retried = false, _stepUpRetried = false } = opts

  if (UNHYDRATED_PATH_RE.test(path)) {
    console.error(`[api] ${method} ${path} — a path segment is the JS literal 'undefined'/'null': the call site fetched before its variable was hydrated. Guard it (e.g. \`if (!id) return\`).`)
  }

  /* Cheap sync gate: with mocking off (the default) this short-circuits before
     the dynamic import, so ../mock/index.js is never loaded and data.json is
     never parsed. */
  if (mockEnabled()) {
    let mocked
    try {
      mocked = await tryMock(method, path, { ...opts, query })
    } catch (e) {
      /* A handler that threw mockError() is a deliberate failure path — surface
         it as the real client would. Anything else is a broken fixture, and a
         broken fixture must not silently turn into a live request. */
      if (e?.__mockStatus) {
        const err = new ApiError(e.__mockStatus, e.__mockBody?.errorCode, e.__mockBody?.message, e.__mockBody)
        /* The fixture speaks the same step-up dialect as the backend — replay
           through the same dance so mock mode exercises the real flow. */
        if (err.status === 403 && err.code === 'STEP_UP_REQUIRED' && !_stepUpRetried && stepUpPrompt && !isStepUpPath(path)) {
          let armed
          try { armed = await stepUpPrompt(err) } catch { armed = false }
          if (armed) return request(method, path, { ...opts, _stepUpRetried: true })
          err.stepUpCancelled = true
        }
        logApiError(err, method, path)
        throw err
      }
      throw e
    }
    if (mocked.hit) return mocked.value
  }

  /* `as: 'blob'` is for authed BINARY downloads (the live-stream recording).
     It must go through this function rather than a bare fetch: the download is
     Bearer-authed, so a plain link sends no token, and going around `request`
     would also skip the 401→refresh→retry recovery — which is exactly what a
     long-open screen hitting a rotated token needs. Note the failure path is
     unchanged: a non-ok response is still parsed as an error envelope (a
     missing recording answers 404 with JSON, not with bytes). */
  const finalHeaders = { Accept: as === 'blob' ? '*/*' : 'application/json', ...headers }
  const token = session.getToken()
  if (token) finalHeaders.Authorization = `Bearer ${token}`

  let payload
  if (multipart) {
    payload = body                          // FormData — let the platform set the boundary
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  /* ---- deadline ⊕ caller abort ----
     fetch has no timeout of its own, so a stalled connection used to pin a
     screen's skeletons until the OS socket gave up (minutes). Composed BY
     HAND — AbortSignal.any / AbortSignal.timeout are not guaranteed on
     Hermes + expo/fetch: one internal controller drives fetch, a timer
     aborts it at the deadline (15s; uploads/downloads pass 120s), and the
     caller's signal (usePaged, live-typing pickers) is mirrored into it.
     Two contracts hold: a CALLER cancel keeps surfacing with name
     'AbortError' — the value every catch-and-swallow site keys on — and
     only the timer's own abort is re-badged CLIENT_TIMEOUT. The 401-refresh
     and step-up replays re-enter request() with the same opts and so compose
     a FRESH deadline per attempt; this one is settled before either runs. */
  if (signal?.aborted) {
    throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
  }
  const ctl = new AbortController()
  let timedOut = false
  const deadline = setTimeout(() => { timedOut = true; ctl.abort() }, deadlineMs)
  const onCallerAbort = () => ctl.abort()
  signal?.addEventListener('abort', onCallerAbort)
  const settle = () => { clearTimeout(deadline); signal?.removeEventListener('abort', onCallerAbort) }
  /* expo/fetch does not reliably name its abort rejection 'AbortError' (a
     connection-phase cancel surfaces as FetchError), so the FLAGS decide,
     not the error's name. Caller aborted → normalise to the name every
     swallow site keys on; our timer fired → the timeout. A timed-out request
     has no server copy to show, so that message is client-authored by
     necessity (the no-re-wording rule covers server messages only). */
  const rebadge = (e) => {
    if (signal?.aborted) return Object.assign(new Error('Aborted'), { name: 'AbortError' })
    if (!timedOut) return e
    const err = new ApiError(0, 'CLIENT_TIMEOUT', 'Request timed out. Check your connection and try again.', null)
    logApiError(err, method, path)
    return err
  }

  let res
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: payload,
      /* RN 6: inert on React Native — RN's fetch ignores this and delegates
         cookies to the native HTTP stack. Kept because it costs nothing and the
         native jar DOES often replay the cookie; the real consequence is that
         doRefresh() must not DEPEND on it. See config.js `getRefresh`. */
      credentials: 'include',
      signal: ctl.signal,
      /* `keepalive` let a web request outlive the document. RN's fetch ignores
         it; harmless, and kept so the call sites stay diffable against the web
         source. Small fire-and-forget writes only — a failure here is
         unobservable by design. */
      keepalive: keepalive || undefined,
    })
  } catch (e) {
    settle()
    throw rebadge(e)
  }

  /* Deprecation contract: a legacy alias still answers, but stamps
     `Deprecation: true` + a Link successor. Log it so future re-homings
     self-report instead of rotting until the alias is removed. */
  if (res.headers.get('Deprecation') === 'true') {
    console.warn(`[api] deprecated route: ${method} ${path} — migrate to ${res.headers.get('Link') || '(successor not announced)'}`)
  }

  if (res.ok) {
    try {
      if (res.status === 204) return null
      if (as === 'blob') {
        return {
          blob: await res.blob(),
          filename: filenameFrom(res.headers.get('content-disposition')),
          type: res.headers.get('content-type') || '',
        }
      }
      const text = await res.text()
      if (!text) return null
      try { return parseJson(text) } catch { return text }   // some endpoints return plain string
    } catch (e) {
      /* The deadline also covers the body read — a response that stalls
         mid-stream is the same hang wearing headers. */
      throw rebadge(e)
    } finally {
      settle()
    }
  }

  const err = await parseError(res)
  settle()   // parseError's own body read was the last thing under the deadline

  // 429 rate-limit: surface a friendly "slow down" toast with the server's
  // retry hint. Callers can still read err.retryAfterSeconds / err.action
  // (or cooldownSecondsFrom(err) — it also folds MEDIA_QUOTA_EXCEEDED's resetsAt)
  // to disable the submit button during the cooldown. Never auto-retry a 429.
  if (res.status === 429) {
    const secs = err.retryAfterSeconds ?? 5
    flashToast(err.message || `Slow down — try again in ${secs}s`, 'warn')
    logApiError(err, method, path)
    throw err
  }

  // 403 STEP_UP_REQUIRED → collect a fresh credential, arm, replay ONCE.
  if (res.status === 403 && err.code === 'STEP_UP_REQUIRED' && !_stepUpRetried && stepUpPrompt && !isStepUpPath(path)) {
    let armed
    try { armed = await stepUpPrompt(err) } catch { armed = false }
    if (armed) return request(method, path, { ...opts, _stepUpRetried: true })
    err.stepUpCancelled = true          // tells withStepUp-style wrappers not to prompt AGAIN
  }

  // Only attempt recovery when we believe we're signed in, on a non-auth path, once.
  if (res.status === 401 && token && !_retried && !isAuthPath(path)) {
    if (err.code === 'TOKEN_REVOKED') { endSession(); logApiError(err, method, path); throw err }   // terminal — logged out elsewhere / token reused
    const refreshed = await refreshOnce()             // expired/invalid access token → try ONE rotation
    if (refreshed.ok) return request(method, path, { ...opts, _retried: true })
    /* Refresh refused → the session is dead, and every AUTH_REFRESH_TOKEN_*
       code is terminal. _REUSED gets its own copy: the server revoked ALL
       sessions after detecting token reuse — saying "expired" would hide a
       security event from the person it happened to. */
    endSession(refreshed.code === 'AUTH_REFRESH_TOKEN_REUSED' ? SIGNED_OUT_REUSED_COPY : SIGNED_OUT_COPY)
    logApiError(err, method, path)
    throw err
  }

  /* `quiet` marks statuses that are expected OUTCOMES of this call, not
     failures — e.g. "story has no poll" is a documented 404 with an empty
     body (polls.md). Those still throw (the caller branches on them) but must
     not scream in the console on every story view. */
  if (!quiet.includes(res.status)) logApiError(err, method, path)
  throw err
}

/* ---- upload quality ----------------------------------------------------
   MediaSettings.uploadQuality is documented server-side as "a hint that saves
   the user's bandwidth — the client may pre-compress to it". Every multipart
   upload in the app funnels through http.upload, so honouring the setting
   here is what makes one preference cover avatars, covers, chat attachments,
   post and research media at once, instead of each call site remembering.

   RN 4: the web version iterated `formData.entries()` and re-packed any
   `File` whose type started with `image/`. React Native's FormData implements
   only `append` / `getAll` / `getParts` — there is no `entries()`, so the web
   body would throw on the first call and fall into its own catch. Rather than
   leave a hot path that always throws, this is an explicit pass-through until
   the downscale is re-implemented on expo-image-manipulator (lib/mediaTier.js,
   scheduled with step 5 — media). The contract is unchanged and deliberately
   fail-open: a compression helper must never be why an upload cannot happen. */
async function withTierApplied(formData) {
  return formData
}

/* ---- progress-aware uploads (XHR) --------------------------------------
   expo/fetch has no upload-progress events, so the progress/cancel path runs
   on React Native's XMLHttpRequest — whose native networking layer ALSO
   streams RN `{uri, name, type}` FormData parts directly from disk, so no
   withFetchableFileParts shim is needed here. Same funnel guarantees as
   `request`: Bearer, the shared error envelope (errorFromText), one 401
   refresh-retry, the step-up arm-and-replay, and the 429 toast.
   `onProgress(fraction 0..1)` fires from the platform's own byte counter. */
function xhrExchange(method, path, { body, headers, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, buildUrl(path))
    for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v)
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total, e) }
    }
    const onAbort = () => xhr.abort()
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort) }
    if (signal) {
      if (signal.aborted) { reject(abortError()) ; return }
      signal.addEventListener('abort', onAbort)
    }
    xhr.onerror = () => { cleanup(); reject(new ApiError(0, 'NETWORK', 'Network error during upload')) }
    xhr.onabort = () => { cleanup(); reject(abortError()) }
    xhr.onload = () => {
      cleanup()
      resolve({
        status: xhr.status,
        text: xhr.responseText || '',
        retryAfter: parseInt(xhr.getResponseHeader('Retry-After') || '', 10),
      })
    }
    xhr.send(body)
  })
}

function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

async function xhrRequest(method, path, opts = {}) {
  const { body, headers = {}, onProgress, signal, _retried = false, _stepUpRetried = false } = opts
  const finalHeaders = { Accept: 'application/json', ...headers }
  const token = session.getToken()
  if (token) finalHeaders.Authorization = `Bearer ${token}`
  // FormData sets its own boundary — only raw bodies carry an explicit type.

  const res = await xhrExchange(method, path, { body, headers: finalHeaders, onProgress, signal })

  if (res.status >= 200 && res.status < 300) {
    if (!res.text) return null
    try { return parseJson(res.text) } catch { return res.text }
  }

  const err = errorFromText(res.status, res.text, res.retryAfter)

  if (res.status === 429) {
    flashToast(err.message || 'Slow down — try again shortly', 'warn')
    logApiError(err, method, path)
    throw err
  }
  if (res.status === 403 && err.code === 'STEP_UP_REQUIRED' && !_stepUpRetried && stepUpPrompt && !isStepUpPath(path)) {
    let armed
    try { armed = await stepUpPrompt(err) } catch { armed = false }
    if (armed) return xhrRequest(method, path, { ...opts, _stepUpRetried: true })
    err.stepUpCancelled = true
  }
  if (res.status === 401 && token && !_retried && !isAuthPath(path)) {
    if (err.code === 'TOKEN_REVOKED') { endSession(); logApiError(err, method, path); throw err }
    const refreshed = await refreshOnce()
    if (refreshed.ok) return xhrRequest(method, path, { ...opts, _retried: true })
    endSession(refreshed.code === 'AUTH_REFRESH_TOKEN_REUSED' ? SIGNED_OUT_REUSED_COPY : SIGNED_OUT_COPY)
    logApiError(err, method, path)
    throw err
  }

  logApiError(err, method, path)
  throw err
}

export const http = {
  get:   (path, query, opts)        => request('GET', path, { query, ...opts }),
  post:  (path, body, opts)         => request('POST', path, { body, ...opts }),
  patch: (path, body, opts)         => request('PATCH', path, { body, ...opts }),
  put:   (path, body, opts)         => request('PUT', path, { body, ...opts }),
  del:   (path, opts)               => request('DELETE', path, opts),
  /** Multipart POST with REAL upload progress + cancel (XHR). Pass plain RN
   *  FormData with `{uri, name, type}` parts — the native layer streams them.
   *  `onProgress(fraction 0..1)`; abort via `signal` (AbortController). */
  uploadX: (path, formData, { onProgress, signal, ...opts } = {}) =>
    xhrRequest('POST', path, { body: formData, onProgress, signal, ...opts }),
  async upload(path, formData, opts) {
    /* RN 7: every multipart request funnels through here, so making the file
       parts readable by expo/fetch in this one spot covers posts, stories,
       avatars/covers, channels, chat attachments, Q&A and research at once.
       Media rides a 120s deadline, not the 15s default — a video over a slow
       uplink is slow BECAUSE it is working. */
    return request('POST', path, { body: withFetchableFileParts(await withTierApplied(formData)), multipart: true, deadlineMs: 120000, ...opts })
  },
  /** Authed binary GET → `{ blob, filename, type }`. See the `as: 'blob'` note
   *  in `request`. 120s deadline for the same reason `upload` carries one. */
  download:(path, query, opts)      => request('GET', path, { query, as: 'blob', deadlineMs: 120000, ...opts }),
}

/* RN 5: `saveBlob()` moved to ../platform/files.js and is re-exported here so
   its one caller (chat.js `streams.saveRecording`) keeps the same import.
   The web version handed a Blob to the browser's downloader via an object URL
   and a synthetic `<a download>`; the native one writes the bytes with
   expo-file-system and opens the OS share sheet, which is where "Save to
   Files" / "Save to Photos" live on a phone.

   ONE CONTRACT CHANGE, and it is deliberate: the native version is async and
   MUST be awaited. Only one share sheet can be open at a time, so a caller
   saving a multi-part recording has to sequence its saves — chat.js's
   `saveWholeRecording` already loops with `await`, and `saveRecording` now
   awaits this too. Kept next to `http.download` because the two are only ever
   used together. */
export { saveBlob } from '../platform/files.js'
