# The AI prompt

Copy the block below into the AI assistant in your React Native project, after
dropping this `mobile-kit/` folder into that repo's root.

---

## Context

I am building the **React Native mobile app for IKA**, a scholarly-social
platform (Arabic/Kurdish/Turkish/English) whose web frontend is already complete
and in production against a live Spring backend.

I have copied the web app's entire platform-independent layer into
`mobile-kit/`. **This is not a reference — it is the code I want the mobile app
to run.** Your job is to port it, not to reinvent it.

The backend is unchanged and is the same server the web app talks to:
`https://irc-bakend-production.up.railway.app`, REST under `/api/v1/`, JWT
Bearer auth, Server-Sent Events for realtime.

### What the app does

Posts and feeds (ranked home feed), long-form **research papers** with sources
and citations, **Q&A**, **reels** (with authored audio mixing and overlays),
**stories** (polls, highlights, close friends), **direct chat and channels**
(reactions, replies, voice notes, receipts, typing), **live streaming** with
multi-guest stages, **1:1 and group calls** (WebRTC), notifications, search,
a knowledge taxonomy (topics/madhhabs), a full settings module, and a
moderation surface.

---

## What is in `mobile-kit/`

```
src/api/      28 files, 7,166 lines — the complete API client
src/lib/      25 helper modules
src/context/  AuthContext, ChatContext, CallContext
src/hooks/    useRealtime, useCooldown, useReelAudio
src/mock/     1 MB fixture — the whole app with no backend, in en/ar/ku/tr
platform/     shims I have already written for you (read these first)
docs/         9 backend/frontend guides
PORTING.md    file-by-file table: what to copy, what to edit, what to rewrite
```

**Read `PORTING.md` before writing any code.** It has a per-file verdict for all
81 files, with line numbers for every edit.

Everything in `src/` is a **verbatim, unmodified copy** of the web source, so it
stays diffable against the original.

---

## The core fact

`src/api/` never imports UI. That discipline is why this port is cheap: the
platform coupling did not spread. It sits in exactly **six seams**, and I have
written a replacement for each in `platform/`:

| Seam | Replacement |
|---|---|
| `localStorage` | `platform/storage.js` — MMKV, **synchronous** |
| `import.meta.env` | `platform/env.js` |
| `EventSource` | `platform/sse.js` — `react-native-sse` |
| `window.dispatchEvent` | `platform/appEvents.js` |
| `document.getElementById('toast')` | `platform/toast.js` |
| `File` / `Blob` / canvas | `platform/files.js` |

`platform/config.rn.js` is a finished drop-in replacement for `src/api/config.js`.

Across 7,166 lines of API code, exactly **46 lines** touch a web-only API.
**20 of the 28 files have no web dependency at all**, and five of the remaining
eight are a one-line `EventSource` import swap. Only `http.js` needs real work,
and it is eleven mechanical lines.

---

## Hard rules

1. **Use `react-native-mmkv`, not AsyncStorage.** `session.getToken()` is called
   synchronously inside `request()` on every HTTP call and every SSE reconnect.
   MMKV is synchronous, so it drops in with the same signature and nothing
   downstream changes. AsyncStorage would force `getToken` to become async,
   which would ripple through all 28 API modules. This is not negotiable.

2. **Do not rewrite `adapters.js`.** 912 lines, zero platform coupling. It
   encodes every field-name quirk and defensive parse the backend requires. Copy
   it byte-for-byte.

3. **Keep the Snowflake handling.** `http.js` quotes any integer of 16+ digits
   before parsing and `ids.js` compares ids as strings. This is not a browser
   workaround — Hermes loses the same precision. Message ids are 18-digit longs;
   parsing them as numbers silently corrupts them and the server answers 404.

4. **Branch on error codes, never on message strings.** Use the predicates in
   `errors.js` (`isRateLimited`, `isStepUp`, `isNotFound`, `cooldownSecondsFrom`,
   …). Never hardcode copy the backend sends.

5. **Preserve the recovery flows in `http.js`** — the 401 refresh-retry, the 403
   `STEP_UP_REQUIRED` arm-and-replay, and the 429 handling. They are subtle,
   they are correct, and they are the reason the app survives an hour-long
   session. Port them; do not simplify them.

6. **Ask me before changing an API contract.** If something looks wrong, it is
   far more likely to be a backend quirk the web app already learned the hard
   way. The comments explain most of them.

---

## Traps, verified — these will cost me days if you miss them

### The refresh token (most important)

The web app never stored a refresh token: the backend sets an **HttpOnly
cookie** and `doRefresh()` posts an empty `{}` body.

**That cookie is not dependable on React Native.** RN's fetch ignores
`credentials: 'include'` and delegates cookies to the native stack, which is not
guaranteed to survive an app restart — worst on Android. The symptom is the app
signing the user out about every hour, and it will look like a backend bug.

`auth.js` documents the tokens as **dual-channel**: *"the backend sets HttpOnly
cookies AND returns accessToken/refreshToken in the body."* So store
`res.refreshToken` (there is already a `session.setRefresh()` slot in
`platform/config.rn.js`) and send it explicitly as
`POST /auth/refresh { refreshToken }`. **Verify that field name against the live
server once** before building on it.

### Two-leg 2FA login

`POST /auth/login` may return `{ mfaRequired: true, mfaToken }` and **no session
at all** — no tokens, no user. The code screen then finishes with
`POST /auth/login/2fa { mfaToken, code }`. `mfaRequired` is *omitted* (never
`false`) on an ordinary login, so presence is the branch. `code` takes either a
6-digit TOTP or a recovery code — send it as typed and let the server classify.
The `mfaToken` is a credential: memory only, never storage. It is single-use and
burns after 5 attempts.

### SSE

All five streams authenticate with `?token=<jwt>` because browser EventSource
cannot set headers. `react-native-sse` **can** send headers — prefer
`Authorization: Bearer` and drop the token from the query string (it currently
lands in server access logs). Verify the backend accepts the header form first.

Rebuild the URL on **every** connect: the access token rotates roughly hourly,
and a long-lived screen that captures it once will re-dial with a dead token
forever. `realtime.js` already does this correctly — keep it.

There is a per-user cap of **5 concurrent SSE connections**. `realtime.js`
shares one connection per entity across all subscribers for exactly this reason.
Do not open one per component.

### Media

`assetUrl()` must prefix relative URLs — the backend returns `/api/v1/media/…`
and a native `<Image>`/`<Video>` cannot resolve that. Media behind Bearer auth
needs the header too; `react-native-video` and `expo-image` both accept
`{ uri, headers }`.

The presigned PUT goes to a **foreign origin** — never send the app's
`Authorization` header there. Stream from disk (`platform/files.js` uses
`expo-file-system`), never buffer a 512 MB video into JS memory.

### Mock mode

`src/mock/` serves the entire app from one fixture, in four languages, and it
intercepts at `request()` — so it exercises the real adapters and error
envelopes, not a diorama. Turn it on with `USE_MOCK = true` in
`platform/env.js`. Use it to build screens before the backend is reachable from
a device. Note that SSE does **not** pass through `request()`; the realtime layer
has a scripted replay instead.

---

## What I want you to do

Work in this order, and **stop after each step so I can test on a device**:

1. Install deps and wire `platform/` — then prove a single authenticated
   `GET /api/v1/users/me`.
2. `auth.js` + the refresh-token fix + `AuthContext` — login, 2FA, and a session
   that survives an app restart.
3. Copy the 21 no-change API modules + `adapters.js` + `errors.js` — feeds,
   profiles, research, Q&A rendering.
4. The SSE shim — realtime counters, notifications, the chat stream.
5. `media.js` + `platform/files.js` — uploads.
6. Chat and channels.
7. Live streaming and calls (`CallContext.jsx`, `liveWebrtc.js`) — **last**.
   These are the heaviest; the signalling protocol is unchanged and only the
   peer-connection glue becomes `react-native-webrtc`.

For the UI: this is a **native app, not a web port**. Use the platform's own
navigation and gestures. Do not carry over CSS, `.m-*` classes, or the web
layout — only the data layer, which is what this kit contains.

Ask me anything that is ambiguous before you build on an assumption.
