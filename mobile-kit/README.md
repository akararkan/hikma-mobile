# mobile-kit

Everything from the IKA web frontend that a React Native app can reuse, in one
folder — plus the shims and the AI prompt to port it.

## Start here

| File | What it is |
|---|---|
| **[AI_PROMPT.md](AI_PROMPT.md)** | **Paste this into the AI in your React Native project.** |
| [PORTING.md](PORTING.md) | Per-file verdict for all 81 files, with line numbers for every edit. |

## What is here

```
src/api/      28 files, 7,166 lines — the complete API client
src/lib/      25 helper modules
src/context/  AuthContext · ChatContext · CallContext
src/hooks/    useRealtime · useCooldown · useReelAudio
src/mock/     1 MB fixture — the whole app with no backend, in en/ar/ku/tr
platform/     ready-written React Native shims (7 files)
docs/         9 backend/frontend guides
```

Everything in `src/` is a **verbatim copy** of the web source — nothing edited,
so it stays diffable against the original. The edits it needs are described in
`PORTING.md`, and the replacements are in `platform/`.

## The short version

`src/api/` never imports UI, so the platform coupling never spread. It sits in
six seams, each of which already has a replacement:

| Seam | Replacement |
|---|---|
| `localStorage` | `platform/storage.js` — MMKV, **synchronous** |
| `import.meta.env` | `platform/env.js` |
| `EventSource` | `platform/sse.js` |
| `window.dispatchEvent` | `platform/appEvents.js` |
| `document.getElementById('toast')` | `platform/toast.js` |
| `File` / `Blob` / canvas | `platform/files.js` |

`platform/config.rn.js` is a finished drop-in for `src/api/config.js`.

Across 7,166 lines of API code, exactly **46 lines** touch a web-only API.
**20 of 28 files have no web dependency at all.** `http.js` is the only file
with real work, and it is eleven mechanical lines.

## Two things to get right

1. **MMKV, not AsyncStorage.** `session.getToken()` is called synchronously
   inside `request()` on every call. MMKV is synchronous and drops in; async
   storage would ripple through all 28 modules.

2. **Store the refresh token.** The web app relied on an HttpOnly cookie, which
   is not dependable on React Native — the app would sign the user out roughly
   every hour. The backend returns `refreshToken` in the login body; store it
   and send it explicitly. Full explanation in `PORTING.md` §4.

## Dependencies the port needs

```
react-native-mmkv          storage (sync — required)
react-native-sse           SSE streams
expo-file-system           uploads, downloads
expo-crypto                sha256 for upload dedup, contact hashing
expo-image-manipulator     image downscale (replaces canvas)
expo-av                    audio (reels, voice notes, chime)
react-native-webrtc        calls + live (last phase)
expo-secure-store          refresh token, if the threat model asks
```

Swap the Expo modules for their bare-RN equivalents (`react-native-blob-util`,
`react-native-quick-crypto`, …) if the project is not using Expo.

## Keeping it in sync

The web app is still under development. To refresh this folder:

```sh
cp src/api/*.js            mobile-kit/src/api/
cp src/lib/*.js            mobile-kit/src/lib/
cp src/context/*.jsx       mobile-kit/src/context/
cp src/hooks/*.js          mobile-kit/src/hooks/
cp src/mock/*.js src/mock/data.json mobile-kit/src/mock/
cp src/mock/handlers/*.js  mobile-kit/src/mock/handlers/
```

Then `git diff` in the mobile project shows exactly what changed upstream.
