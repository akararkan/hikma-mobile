# mobile-kit → React Native · port log

The web app's platform-independent layer, running on Expo SDK 57. **No UI** —
`src/app/index.tsx` is a centred "Hello World" and stays that way until the
application documentation arrives.

## Layout

```
mobile-kit/      pristine copy of the web source — DIFF BASE ONLY, nothing imports it
src/platform/    the six shims (env · storage · appEvents · toast · sse · files)
src/api/         28 modules — the complete API client
src/lib/         17 of 25 helper modules
src/context/     AuthContext
src/hooks/       useRealtime · useCooldown
src/mock/        the fixture, unchanged except flag.js
src/app/         Hello World, and nothing else
```

`mobile-kit/docs/` was dropped — those guides are stale.

To resync from upstream, re-copy into `mobile-kit/` and `git diff` shows exactly
what changed in the web app.

---

## You need a development build. Expo Go will not run this.

`react-native-mmkv` v4 is a Nitro module and needs native code compiled in. Not
optional: `session.getToken()` is called **synchronously** inside `request()` on
every HTTP call and every SSE reconnect, so the store must be synchronous, and
every synchronous store on React Native is a native module. `react-native-sse`,
`expo-file-system` and `react-native-webrtc` land in the same place.

`expo-dev-client` is installed. First run:

```sh
npx expo prebuild          # generates ios/ and android/ (both gitignored)
npx expo run:ios           # or: npx expo run:android
```

After that `npx expo start` attaches to the dev build; you only rebuild when a
native dependency changes.

**`prebuild` has not been run** — it writes the native projects, so that is your
call.

---

## Dependencies added

| Package | Why |
|---|---|
| `react-native-mmkv` + `react-native-nitro-modules` | synchronous storage — the non-negotiable one |
| `react-native-sse` | `EventSource` for the five streams |
| `expo-file-system` | upload streaming, recording downloads |
| `expo-crypto` | sha256 for upload dedup + contact matching |
| `expo-sharing` | the native "save this file" |
| `expo-dev-client` | the dev build the above require |

---

## `src/platform/` — all six seams

Four are the kit's files unchanged (`appEvents`, `toast`). Four carry real work:

**`env.js`** — reads `process.env.EXPO_PUBLIC_*`, which SDK 57 inlines at build
time the way Vite inlined `VITE_*`. See `.env.example`. `APP_VERSION` is left
empty on purpose so `lib/version.js` can fall through to `expo-constants` —
a hardcoded version makes the backend's `minSupportedVersion` gate permanently
satisfied, which is exactly the failure that file exists to prevent.

**`storage.js`** — MMKV, plus the in-memory `sessionStorage` slot.

**`files.js`** — the `File`/`Blob` model translated. Two SDK-57 corrections to
the kit's version:

- SDK 57's `expo-file-system` root export is the new `File`/`Directory`/`Paths`
  API. `getInfoAsync`, `readAsStringAsync`, `createUploadTask`, `EncodingType`
  and `FileSystemUploadType` all moved to `expo-file-system/legacy`, which is
  what the shim imports. `createUploadTask` is kept over the new `File.upload()`
  because it is the only one with a progress callback.
- Added `saveBlob()` — see the `http.js` note below.

**`sse.js`** — rewritten. The kit's version had two defects that would have
failed silently:

1. **No `readyState`.** All five callers branch on it — `if (es.readyState !== 2)
   return` means "transient, the browser will retry, sit tight". Without the
   property that test is true forever, so `notifications.js` never runs its
   token-refresh heal and `stories.js` never reconnects. The mapping also can't
   be a pass-through: react-native-sse uses `-1` for a connection error and
   reserves `2` for an explicit `close()`, and with `pollingInterval: 0` there
   is no auto-reconnect — so on native every error IS terminal and `-1` must
   fold to `2`.
2. **`lineEndingCharacter: '\n'` was hardcoded.** The library auto-detects when
   left unset. Forcing LF corrupts a CRLF stream: every field keeps a trailing
   `\r` and the `\n\n` frame boundary never matches. Now unset.

Also guarded: the library writes a server `retry:` field into its own poll
interval, which quietly re-enables the auto-reconnect that `pollingInterval: 0`
turned off — it would re-dial with the URL captured at construction (the *old*
access token) *and* race the caller's own re-dial, spending two of the per-user
cap of 5 concurrent SSE connections on one stream. The shim re-zeroes it.

---

## `src/api/` — all 28 modules

**20 copied byte-for-byte**, including `adapters.js` (912 lines) and `errors.js`.

**8 edited:**

| File | Change |
|---|---|
| `config.js` | replaced with the kit's `config.rn.js` — MMKV `session`, env-resolved `API_BASE`, the new refresh-token slot |
| `http.js` | the six edits below |
| `activity.js` `chat.js` `notifications.js` `realtime.js` `stories.js` | one-line `EventSource` import swap; call sites untouched |
| `realtime.js` | also dropped the `window.__ikaRealtimePush` line |
| `media.js` | `sha256Of` + `putBytes` re-pointed at `platform/files.js`; pipeline logic unchanged |

### `http.js`, in full

1. `flashToast()` — DOM body deleted, imports `platform/toast.js`. Call site unchanged.
2. `endSession()` — `sessionStorage` → the in-memory slot; `window.dispatchEvent`
   → `emit(AUTH_EXPIRED)`. The web `typeof window === 'undefined'` early-return
   was **removed** — on native it is true, so leaving it would have silently
   disabled the entire sign-out signal.
3. Mock gate — `import.meta.env` → `mockEnabled()` from `mock/flag.js`, imported
   statically so the check stays synchronous and mocking-off never loads `data.json`.
4. `withTierApplied()` — explicit pass-through. RN's `FormData` has no
   `.entries()`, so the web body would throw on every upload and land in its own
   catch. Fail-open preserved; the downscale returns with `mediaTier.js`.
5. `saveBlob()` — moved to `platform/files.js` and re-exported here, so
   `chat.js` keeps its import. Writes the bytes with `expo-file-system`, then
   opens the OS share sheet (where "Save to Files"/"Save to Photos" live).
   **One deliberate contract change:** it is now async and must be awaited —
   only one share sheet can be open at a time, and `saveWholeRecording` saves
   multi-part recordings in a loop. `chat.js:saveRecording` now awaits it.
6. `credentials: 'include'` — kept, inert on RN. Consequence below.

Added: `takeSignedOutReason()` — read-and-clear for the reason `endSession`
parks. The web auth page read `sessionStorage` directly; the slot is now
module-private, so `AuthContext` needs an accessor.

**Untouched and verified:** the big-int-safe JSON parser, both error envelopes,
the 401 refresh-retry, the 403 step-up arm-and-replay, the 429 handling, the
unhydrated-param guard.

### `media.js`

"A file" is no longer a `File` — it is whatever the picker returned. `file.size`
and `file.type` now resolve through `sizeOf()` (which prefers the picker's own
number, because the oversize check must happen *without* reading the file) and a
`type`/`mimeType` fallback. `DOMException('Aborted')` → a plain Error with
`.name = 'AbortError'`, which is all the poll loop ever reads.

---

## `src/lib/` — 17 of 25

| Verdict | Files |
|---|---|
| copied byte-for-byte | `dialCodes` `feedChannelViews` `liveRows` `moderation` `reelOverlay` `soundMix` `stillClock` `useImageRatio` `userView` |
| `localStorage` → MMKV | `useViewMode` `pymkTimer` `storySeen` |
| real edits | `version` `qrToken` `contactHash` `storyTray` `openCompose` |

- **`contactHash.js`** — `crypto.subtle` → `expo-crypto`. The normalisation
  contract is byte-identical, which is the part that matters: the hash *is* the
  interop surface, so a hash minted here must join against one minted by the web
  client. `canHashContacts()` now returns true unconditionally (the
  secure-context precondition does not exist on native); `InsecureContextError`
  is kept so any caller that catches it by name still compiles.
- **`storyTray.js`** — `document.hidden`/`visibilitychange` → `AppState`. Only
  `'active'` beats: iOS also emits `'inactive'` for the app switcher and
  incoming calls, which is not the foreground.
- **`qrToken.js`** — `window.location.origin` → `EXPO_PUBLIC_WEB_ORIGIN`. The
  app must **not** paint its own deep link into a QR code: whoever scans it is
  usually a stranger without the app, and a bare `ikamobileapp://` code is inert
  on their phone. `qrWebLink()` returns null when no web origin is configured
  (better a missing QR than one that scans to nothing); `qrAppLink()` is added
  for "share to someone who has IKA".
- **`version.js`** — Vite's `__APP_VERSION__` globals → `expo-constants`.

---

## `src/context/`, `src/hooks/`

`AuthContext.jsx` ported. The state machine, the proactive-refresh timer and
`hasRole`/`isPlatformAdmin` are unchanged. Three changes:

- `window.addEventListener('ika:auth-expired')` → `on(AUTH_EXPIRED)`.
- `signedIn` is now React **state** mirroring `session.isAuthed()`. On web it was
  read off `localStorage` during render, which worked only because every sign-out
  also caused a navigation. Here `endSession()` clears the token from outside
  React, so as a plain read the tree would never re-render and a signed-out user
  would keep seeing the app.
- `RequireAuth`/`RequireRole` were react-router components rendering `<Navigate>`.
  They are now hooks — `useAuthGate()` / `useRoleGate(roles)` returning
  `'loading' | 'allow' | 'deny'`. On native the redirect belongs to the screen
  (`<Redirect>` / `router.replace`) and a rights refusal is a real screen, not a
  `<div>`. Both stay `'loading'` until the boot `/users/me` settles, because
  routing on an unknown auth state flashes the wrong screen.

`useRealtime.js` and `useCooldown.js` copied byte-for-byte.

---

## Everything below is now ported — see BUILD.md

This section listed what the data-layer pass could not finish. All of it landed
with the application layer; it is kept as a record of what each blocker turned
out to need.

**Was blocked on files the kit does not contain.** `ChatContext.jsx` imported
`showToast`, `chatError` and (for `CallContext`) `openCallLog`/`recordCall`.

- `showToast` → `@/ui`'s toast, which registers itself with
  `platform/toast.js`, so `http.js`'s existing `flashToast()` calls light up too.
- `chatError` → `lib/chatErrors.ts`. The rule that blocked it still holds: the
  server's own message is shown wherever it says something useful. What the file
  adds is copy for chat's 403 family only, which is deliberately terse on the
  wire (`BLOCKED` "never reveals who blocked whom"), and it falls through to
  `errorText` for everything else — so a code added later still shows the
  server's words rather than a generic apology.
- The call log became `components/call/callStore.ts`.

`ChatContext` needed one more change than expected. The two predicted edits
were right (`document.visibilityState` → `AppState`, the `/live/…` path check →
expo-router segments), but it could not keep the socket: `RealtimeContext` holds
the per-user chat stream for the whole session, and the backend caps a user at
five emitters with LRU eviction, so a second one would evict the app's own.

**Was blocked on a UI decision:**

| File | What it became |
|---|---|
| `lib/richtext.js` | `lib/richtext.tsx` — a native block renderer, not a WebView. The PLAIN/MD/HTML contract and `detectFormat` are character-for-character intact |
| `lib/prefs.js`, `lib/chatPrefs.js` | `theme/prefs.ts` + `lib/chatPrefs.ts`, behind `ThemeProvider` and `useChatSkin()` |
| `lib/mediaTier.js` | `lib/mediaTier.ts` on `expo-image-manipulator` |
| `lib/archive.js` | not needed — the data export is server-generated and `platform/files.js` already saves it through the share sheet |
| `lib/chime.js` | `lib/chime.ts` — haptics, not a synthesised tone. See BUILD.md for why that is a change of behaviour rather than a translation |
| `lib/desktopNotify.js` | `lib/pushNotify.ts` on `expo-notifications`, registering an Expo push token |

**Was deliberately last:** `lib/liveWebrtc.js` and the call media plane.
`react-native-webrtc` is installed with its config plugin, and the two engines
are `lib/liveWebrtc.ts` (WHIP publish, WHEP watch) and `lib/callEngine.ts`
(mesh peer connections over the blind relay). The signalling protocol is
unchanged, as predicted. BUILD.md has the detail, including the one thing that
still needs verifying on a real device.

---

## The one open question — answer this before anything else

`doRefresh()` still posts an empty `{}` and leans on the HttpOnly cookie, exactly
as the web app did.

On React Native that cookie is not dependable: RN's fetch ignores
`credentials: 'include'` and delegates cookies to the native stack, which is not
guaranteed to survive an app restart (worst on Android). **The symptom is the app
signing the user out roughly every hour, and it will look like a backend bug.**

`auth.js` documents the tokens as dual-channel — "the backend sets HttpOnly
cookies AND returns accessToken/refreshToken in the body" — so the fix is to
store `res.refreshToken` (the `session.setRefresh()` slot exists and is unused)
and send it explicitly as `POST /auth/refresh { refreshToken }`.

The porting notes say to **verify that field name against the live server once**
before building on it, and guessing wrong fails silently. So: log in against the
live backend and tell me which keys the response body carries. Then it is a
four-line change in `auth.js` + `http.js`, plus moving the refresh token into
`expo-secure-store`.

---

## Verified here

- `npx tsc --noEmit` — clean.
- `npx expo export --platform ios` — bundles. Every import in the ported graph
  resolves, including the mock branch's dynamic import; confirmed by grepping
  the built bundle for strings from `errors.js`, `chat.js`, `taxonomy.js`,
  `contactHash.js`, `qrToken.js` and `appEvents.js`.
- The big-int-safe parser unit-tested in isolation: 8/8 — the exact Snowflake
  from the `ids.js` header, negatives, `1.2345678901234567`, `1.5e300`, and an
  18-digit number inside a string literal.

Not verified: anything that needs a device. Nothing has talked to the live
backend yet.

**Note:** the bundle is ~4.4 MB because `src/mock/data.json` (1 MB) is reachable
through Metro's dynamic import and Metro does not tree-shake it the way the Vite
build did. Fine for development; strip it from release builds.
