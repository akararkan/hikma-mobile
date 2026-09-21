# Hikmah Web — mobile

**تۆڕی حیکمە · شبكة الحكمة**

The React Native client for the IRC platform: a social feed, a scholarly
research library, a Q&A board, and a messenger with channels, calls and live
streaming.

Built on **Expo SDK 57** (React Native 0.86, React 19.2, expo-router v7),
against the backend documented in [`irc-client-docs/`](irc-client-docs/README.md).

## Running it

A **development build** is required — Expo Go will not work. `react-native-mmkv`
v4 is a Nitro module and needs native code compiled in, and the reason that is
not optional is in [PORT.md](PORT.md#you-need-a-development-build-expo-go-will-not-run-this).
`react-native-webrtc` is in the same category.

```sh
npm install
cp .env.example .env          # then point EXPO_PUBLIC_API_BASE_URL at your backend

npx expo prebuild             # writes ios/ and android/ (both gitignored)
npx expo run:ios              # or: npx expo run:android
```

After the first native build, `npx expo start` attaches to it. You only rebuild
when a native dependency changes.

To work without a backend at all, set `EXPO_PUBLIC_USE_MOCK=true` — the whole app
then runs off `src/mock/data.json`. A device-local override wins over the env
var: `storage.setItem('ika_mock', 'on' | 'off')`.

## Checks

```sh
npm run typecheck                # tsc --noEmit
node scripts/check-routes.mjs    # every navigation target resolves to a route
npm run lint
```

## Layout

```
src/theme/       design tokens, the two semantic palettes, ThemeProvider
src/ui/          the design system — screens import from '@/ui' and nothing else
src/components/  domain components, grouped by surface
src/app/         expo-router file tree
src/api/         the API client (28 modules) — finished, do not add endpoints here
src/lib/         helpers ported from the web app
src/context/     Auth, Realtime (the three always-on SSE streams), Chat
src/hooks/       useAsync · useAction · usePaged · useCooldown · useRealtime
src/platform/    the six RN shims: env · storage · appEvents · toast · sse · files
src/mock/        the fixture layer
mobile-kit/      pristine copy of the web source. DIFF BASE ONLY — nothing imports it
```

## Where to read next

- **[PORT.md](PORT.md)** — the data layer: how the web app's 28 API modules,
  its SSE handling and its helpers were moved to React Native, and what was
  deliberately changed on the way.
- **[BUILD.md](BUILD.md)** — the application layer: the design system, the
  navigation shell, the realtime architecture, and the decisions that are not
  visible from any single file.
- **[irc-client-docs/README.md](irc-client-docs/README.md)** — the backend.
  Every endpoint, error code and SSE event. It is the source of truth; where a
  screen and the docs disagree, the docs win.

## Conventions

Three rules carry most of the weight:

1. **Never invent an endpoint.** `src/api/` is complete. Import from the barrel
   (`import { api } from '@/api'`) and grep the module before you call it.
2. **Never hardcode copy the backend sends.** Errors render through
   `errorText(e)`; branch on `codeOf(e)` and the predicates in
   `src/api/errors.js`.
3. **Never reach past `@/ui` for a colour, a font size or a press handler.**
   If a token is missing, add it to `src/theme/`, not to a screen.
# hikma-mobile
