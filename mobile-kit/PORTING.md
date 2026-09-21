# IKA → React Native · porting guide

Every file in `src/` is a **verbatim copy** from the web app. Nothing has been
edited, so this folder stays diffable against the source of truth. The changes
each file needs are listed below, and the ready-made replacements live in
`platform/`.

The counts are real (measured, not estimated): **7,166 lines of API code**, of
which exactly **46 lines** touch a web-only API — 0.6%.

---

## 1. The shape of the job

The web app was built with a single HTTP funnel and a strict rule that `src/api/`
never imports UI. That rule is what makes this port cheap — the platform coupling
did not spread. It sits in **six places**:

| # | Web thing | Native replacement | Where |
|---|---|---|---|
| 1 | `localStorage` (sync) | MMKV (sync) | `platform/storage.js` |
| 2 | `import.meta.env` | plain module | `platform/env.js` |
| 3 | `EventSource` | `react-native-sse` | `platform/sse.js` |
| 4 | `window.dispatchEvent` | emitter | `platform/appEvents.js` |
| 5 | `document.getElementById('toast')` | registered handler | `platform/toast.js` |
| 6 | `File` / `Blob` / canvas | URI + `expo-file-system` | `platform/files.js` |

Fix those six and the API layer runs.

### The one decision that must not be got wrong

`session.getToken()` is called **synchronously** inside `request()` on every
call, and again on every SSE reconnect. Use **`react-native-mmkv`**, which is
synchronous. If you reach for AsyncStorage instead, `getToken` becomes async,
which forces `request()` to be restructured, which ripples through all 28 API
modules. Same signature in, zero downstream edits.

---

## 2. `src/api/` — 28 files, 7,166 lines

`W` = lines touching a web-only API (46 in total). `0` means it runs on native
as-is.

| File | Lines | W | Action |
|---|---:|---:|---|
| **adapters.js** | 912 | 1 | **Copy as-is** — its one match is the word "window" in a comment. Every wire→view shape in the app; the single most valuable file here. |
| **chat.js** | 1,478 | 3 | Copy; swap `EventSource` import (1 site, line ~931). |
| **moderation.js** | 754 | 0 | Copy as-is. |
| **channels.js** | 441 | 0 | Copy as-is. |
| **http.js** | 421 | 11 | **Edit — see §3.** The one file with real work. |
| **settings.js** | 330 | 0 | Copy as-is. |
| **notifications.js** | 317 | 6 | Copy; swap `EventSource` import (line ~241). |
| **realtime.js** | 250 | 7 | Copy; swap `EventSource` (line ~125); drop the `window.__ikaRealtimePush` line at the bottom. |
| **users.js** | 182 | 0 | Copy as-is. |
| **stories.js** | 179 | 5 | Copy; swap `EventSource` (line ~42). |
| **posts.js** | 173 | 0 | Copy as-is. |
| **errors.js** | 162 | 0 | Copy as-is. The whole error taxonomy. |
| **security.js** | 153 | 0 | Copy as-is. |
| **taxonomy.js** | 152 | 0 | Copy as-is. |
| **search.js** | 138 | 0 | Copy as-is. |
| **auth.js** | 117 | 0 | Copy; **add refresh-token storage** (see §4). |
| **media.js** | 116 | 2 | Rewrite `sha256Of` + `putBytes` from `platform/files.js`. Pipeline logic unchanged. |
| **research.js** | 116 | 1 | Copy as-is — its one match is `instanceof FormData`, and RN has a global `FormData`. |
| **index.js** | 94 | 0 | Copy as-is. The barrel — `import { api } from './api'`. |
| **activity.js** | 92 | 2 | Copy; swap `EventSource` (line ~71). |
| **reels.js** | 90 | 0 | Copy as-is. |
| **qna.js** | 88 | 0 | Copy as-is. |
| **mentions.js** | 86 | 0 | Copy as-is. |
| **tags.js** | 84 | 0 | Copy as-is. |
| **config.js** | 67 | 8 | **Replace** with `platform/config.rn.js`. |
| **ids.js** | 66 | 0 | Copy as-is. Snowflake-safe id compare — needed, see §5. |
| **admin.js** | 60 | 0 | Copy as-is. |
| **sounds.js** | 48 | 0 | Copy as-is. |

**20 of the 28 files have no web dependency.** 19 of those are pure
copy-and-go; `auth.js` is clean too but needs the mobile refresh-token addition
in §4. The remaining 8 are `activity` · `chat` · `config` · `http` · `media` ·
`notifications` · `realtime` · `stories` — five of which are a one-line
`EventSource` import swap.

---

## 3. `http.js` — the only real edit

Eleven lines, all mechanical.

1. **`flashToast()` (lines ~68–78)** — delete the DOM body, import `flashToast`
   from `platform/toast.js`. Keep the call site at line ~330 unchanged.
2. **`endSession()` (lines ~176–184)** — `sessionStorage` → the in-memory one in
   `platform/storage.js`; `window.dispatchEvent(new Event('ika:auth-expired'))` →
   `emit(AUTH_EXPIRED)` from `platform/appEvents.js`.
3. **`MOCK_BUILD` (line ~218)** — `import.meta.env` → `USE_MOCK` from
   `platform/env.js`.
4. **`withTierApplied()` (lines ~371–390)** — `instanceof FormData` / `instanceof
   File` are always false on native, so it already degrades to a pass-through.
   Either leave it (harmless) or re-point it at `expo-image-manipulator`.
5. **`saveBlob()` (lines ~410–421)** — delete. "Save to Downloads" is
   `expo-file-system` + `expo-sharing` on native. `http.download` itself stays.
6. **`credentials: 'include'` (line ~290)** — harmless but inert on RN; the real
   consequence is §4.

Everything else in the file — the big-int-safe JSON parser, both error
envelopes, the 401 refresh-retry, the 403 step-up replay, the 429 handling, the
unhydrated-param guard — is platform-neutral and stays.

---

## 4. Auth: the trap that will bite

The web app never stored a refresh token; the backend's **HttpOnly cookie**
carried it and `doRefresh()` posted an empty `{}`.

**On React Native that cookie is not dependable.** RN's fetch ignores
`credentials: 'include'` and hands cookies to the native stack, which is not
guaranteed to survive an app restart (worst on Android). Symptom: the app signs
the user out roughly every hour, and it will look like a backend bug.

The fix is already in the codebase's own notes — `auth.js` documents the tokens
as **dual-channel**: *"the backend sets HttpOnly cookies AND returns
accessToken/refreshToken in the body."* So:

- store `res.refreshToken` in `storeAuth()` via `session.setRefresh()`
  (`platform/config.rn.js` already has the slot),
- send it explicitly: `POST /auth/refresh { refreshToken }` — the branch
  `doRefresh()` already alludes to,
- **verify the field name against the live server once** before building on it.

Keep the refresh token in `expo-secure-store` / `react-native-keychain` if the
threat model asks for it. The access token stays in MMKV — it must be sync.

Also note the **two-leg 2FA login**: `POST /auth/login` returns
`{mfaRequired, mfaToken}` and *no session*; the code screen finishes with
`POST /auth/login/2fa`. `mfaToken` is a credential — memory only, never storage.
That logic is already correct in `auth.js`; just don't lose it in the port.

---

## 5. Things that look like they need changing but don't

- **Snowflake ids.** `http.js` quotes any integer ≥ 16 digits before parsing, and
  `ids.js` compares them as strings. This is not a browser workaround — JS
  numbers lose precision identically in Hermes. Keep both, unchanged.
- **`adapters.js`.** 912 lines, zero platform coupling. Copy it and do not
  rewrite it; it encodes every field-name quirk the backend has.
- **`errors.js`.** Branch on codes via its predicates, never on message strings.
- **Mock mode.** `src/mock/` (1 MB fixture, en/ar/ku/tr) works on native once
  `flag.js` reads from `platform/env.js` + `platform/storage.js`. It intercepts
  at `request()`, so it covers every screen. Worth keeping — you can build the
  whole UI before the backend is reachable from a device.

---

## 6. `src/lib/` — 25 files

| Verdict | Files |
|---|---|
| **Copy as-is** (0 web deps) | `dialCodes.js` · `feedChannelViews.js` · `liveRows.js` · `moderation.js` (270 lines) · `reelOverlay.js` · `soundMix.js` · `stillClock.js` · `useImageRatio.js` · `userView.js` |
| **Swap storage only** (`localStorage` → `platform/storage.js`) | `useViewMode.js` · `pymkTimer.js` · `storySeen.js` |
| **Small edits** | `version.js` (env) · `qrToken.js` (drop `window.location.origin`, use a deep-link scheme) · `contactHash.js` (`crypto.subtle` → `expo-crypto`) · `storyTray.js` (`document.hidden` → `AppState`) · `openCompose.js` (7 lines → `platform/appEvents.js`) |
| **Rewrite — same logic, native primitives** | `mediaTier.js` (canvas → `expo-image-manipulator`) · `archive.js` (browser download → `expo-file-system`) · `prefs.js` + `chatPrefs.js` (CSS variables → a theme context / StyleSheet) |
| **Replace with a native library** | `richtext.js` (DOMPurify + `innerHTML` → `react-native-render-html` or a Markdown renderer; **keep the BodyFormat PLAIN/MD/HTML contract**) · `chime.js` (WebAudio synth → `expo-av`) · `desktopNotify.js` (Web Notifications → Notifee / `expo-notifications`) · `liveWebrtc.js` (426 lines; browser WebRTC → `react-native-webrtc` — **the signalling protocol is unchanged**, only the peer-connection glue differs) |

---

## 7. `src/context/` and `src/hooks/`

| File | Lines | Action |
|---|---:|---|
| `AuthContext.jsx` | 127 | Port. The state machine, the proactive-refresh timer, `hasRole`/`isPlatformAdmin` all stay. Replace: the `window.addEventListener('ika:auth-expired')` effect → `on(AUTH_EXPIRED)`; `RequireAuth`/`RequireRole` (react-router) → a navigator guard. |
| `ChatContext.jsx` | 934 | Port nearly as-is — **1** web line (`window.location.pathname` at ~524, a "am I already on this live page?" check → use the navigation state). |
| `CallContext.jsx` | 925 | Heaviest port (18 web lines) — WebRTC + audio devices. Signalling and state machine survive; media glue becomes `react-native-webrtc`. Do this LAST. |
| `useRealtime.js` | 28 | Copy as-is (its only match is a comment). |
| `useCooldown.js` | 44 | Copy as-is. Drives the 429 / rate-limit countdowns. |
| `useReelAudio.js` | 213 | Rewrite the two `new Audio()` sites → `expo-av`; the crossfade/mix logic stays. |

---

## 8. Suggested order

1. `platform/` shims + `config.rn.js` + `http.js` → prove one `GET /users/me`.
2. `auth.js` + refresh-token fix + `AuthContext` → login, 2FA, session survives a restart.
3. `adapters.js` + `errors.js` + the copy-as-is modules → feeds and profiles render.
4. SSE shim → realtime counters, notifications, chat stream.
5. `media.js` + `platform/files.js` → uploads.
6. Chat / channels, then live + calls last.

Turn on mock mode (`USE_MOCK = true`) for steps 3–4 if the backend is not yet
reachable from the device.

---

## 9. `docs/`

Nine backend/frontend guides copied from the repo root. `CHAT_FRONTEND.md`
(223 KB) is the authoritative chat module guide — **read its invariants section
before touching chat**. `ERROR_HANDLING_FRONTEND.md` and
`MODERATION_FRONTEND.md` are equally load-bearing; the moderation one overrides
the backend docs where they disagree.
