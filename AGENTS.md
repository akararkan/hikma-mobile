# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

This is **SDK 57** — React Native 0.86, React 19.2, expo-router v7. Two APIs in
particular moved and will look like they are missing:

- `expo-file-system`'s root export is the new `File` / `Directory` / `Paths`
  API. `getInfoAsync`, `readAsStringAsync`, `createUploadTask` and the enums
  are at `expo-file-system/legacy`.
- `expo-media-library` did the same: `getAssetsAsync`, `MediaType` and `SortBy`
  are at `expo-media-library/legacy`.

`StyleSheet.absoluteFillObject` no longer exists — use `StyleSheet.absoluteFill`.

## Before you write a screen

1. `src/api/` is **finished**. Never add an endpoint, never call `fetch`. Import
   from the barrel and grep the module to confirm the call exists.
2. Everything visual comes from `@/ui` and `@/theme`. No colour literals outside
   `src/theme/`, no raw `Text` / `TouchableOpacity` / `Alert`. The visual
   language is **OXFORD** — [DESIGN.md](DESIGN.md) is the bible and supersedes
   MOBILE_GUIDE Part I. The laws that bite: white/off-white grounds only
   (tinted fills mark state, not surface), stone for lines and slate for
   words, cerulean `#49B6FF` only ever on dark plates (`Button
   variant="onDark"`, navy ink), no gold/gilt anywhere (scholarly emphasis is
   darker blue), pills only for unread counters + LIVE badges, quiet slate
   shadows via `t.shadow(n)` (never in list rows), never SVG inside list
   items. Fonts (Lora / IBM Plex Sans / Amiri) resolve inside the `Text`
   primitive — never set `fontFamily` at a call site. Every bottom-anchored
   bar owns `useSafeAreaInsets().bottom` — Android is edge-to-edge.
3. Error copy comes from `errorText(e)` — the backend's own message. Branch on
   `codeOf(e)` and the predicates in `src/api/errors.js`. Never re-word what the
   server sent.
4. Snowflake ids are **strings**. Never `Number(id)`; order with `cmpId` /
   `gteId` from `src/api/ids.js`.
5. The chat, notification and story-tray SSE streams are already open app-wide
   in `src/context/RealtimeContext.tsx`. Opening your own evicts one of the
   app's — the backend caps a user at five emitters with LRU eviction.
6. WebRTC has two entry points and you should not write a third:
   `src/lib/callEngine.ts` for calls (mesh, glare and ICE ordering handled) and
   `src/lib/liveWebrtc.ts` for live (WHIP publish, WHEP watch). Video renders
   in `<RTCView streamURL={stream.toURL()} />` — there is no `<video>`.

[BUILD.md](BUILD.md) explains the architecture. [PORT.md](PORT.md) explains the
data layer. `irc-client-docs/` is the backend and is the source of truth.

## Checks

```sh
npm run typecheck
node scripts/check-routes.mjs
node scripts/check-a11y-scale.mjs # the OS-accessibility fold — DESIGN.md §7 is the contract
node scripts/check-contrast.mjs   # QELAT palette gate — DESIGN.md §2 is the contract
node scripts/check-splash.mjs     # the launch handoff — src/lib/splash.ts is the contract
```
