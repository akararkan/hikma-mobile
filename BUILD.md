# The application layer — build log

`PORT.md` documents the data layer: the 28 API modules, the six platform
shims, the SSE hardening. This document is its counterpart. It covers
everything above that line — the design system, the navigation shell, and the
screens — and the decisions that are not visible from reading any single file.

The source for all of it is `irc-client-docs/` (≈27 000 lines across thirteen
domains). Where a screen and the docs disagree, the docs win; where this
document and the code disagree, the code wins.

**Where it stands:** 221 route screens, 15 layouts, 231 domain components, 18
design-system modules — about 112 000 lines. `npm run check` (typecheck +
route lint) is clean, and `npx expo export` bundles for both iOS and Android.

Nothing has talked to the live backend yet; see *Known gaps*.

---

## The toolchain was broken and is now fixed

The repo arrived with `expo@53.0.27` and `react-native@0.72.17` installed
against an otherwise-SDK-57 dependency set — `expo-router@57`, `@expo/ui@57`,
`expo-image@57`. That combination cannot run: expo-router 7 requires the SDK 57
runtime. The original `package.json` in git had it right; a loose `npm install`
during the data-layer port resolved `expo` and `react-native` down.

Restored to the versions SDK 57 actually pins:

| Package | Was | Now |
|---|---|---|
| `expo` | 53.0.27 | ~57.0.13 |
| `react-native` | 0.72.17 | 0.86.2 |
| `react-native-reanimated` | ^4.2.2 | 4.5.1 |
| `react-native-worklets` | ^0.7.4 | 0.10.1 |
| `expo-splash-screen` | ^55.0.23 | ~57.0.6 |
| `expo-sharing` | ^14.0.8 | ~57.0.12 |

Everything added since is pinned from SDK 57's own `bundledNativeModules.json`,
so `npx expo install --check` is quiet.

`app.json` now carries the plugins and permission strings those modules need at
prebuild time — camera, microphone, photos, contacts, notifications, plus
`expo-build-properties` (iOS 16.4, Android compile/target 36). The permission
copy is written to be read by a person deciding whether to grant it; the
contacts string in particular explains the hashing, because that is the one
permission this app asks for that people are right to hesitate over.

---

## `src/theme/` — tokens, not styles

`tokens.ts` holds the raw scale (spacing, radii, type, motion, layout).
`colors.ts` maps it into two **semantic palettes**: screens ask for a role
(`c.textMuted`, `c.surfaceRaised`, `c.bubbleIn`), never a ramp step. Adding a
role obliges both schemes to answer it, which is the mechanism that stops dark
mode rotting.

`ThemeProvider.tsx` folds four inputs into one object:

1. the OS colour scheme, live;
2. the user's `appearance` / `accessibility` blocks;
3. text direction, derived from the content language;
4. the density and font-scale multipliers.

`prefs.ts` is the RN port of `lib/prefs.js`. The web version translated those
blocks into attributes and custom properties on `<html>`; there is no `<html>`
here, so the translation target is a plain object. The contract is preserved
exactly, **including the rule that every default resolves to "no change"** — a
user on defaults renders the untouched design system. It also keeps the two
synchronous readers (`prefersHaptics`, `prefersCaptions`) that other modules
call off the render path.

Three consequences worth knowing:

- **`t.ms(n)`** wraps every duration. It returns 0 when the user asked for
  reduced motion, so animations degrade to cuts everywhere at once rather than
  screen by screen.
- **High contrast is a transform on the palette**, not a third palette, so the
  two cannot drift.
- **The accent colour recolours four roles and stops.** Recolouring semantic
  red would be a bug.

### Direction

The platform is trilingual (English / Arabic / Central Kurdish), so RTL is not
a late-stage concern. The design system never depends on `I18nManager`:
`forceRTL` needs an app reload to take effect, and flipping it live leaves the
tree half-mirrored. Instead every component uses logical properties
(`marginStart`, `paddingEnd`, `borderStartWidth`) and reads `dir` from the
theme for the cases those do not cover — chevron glyphs, swipe directions,
carousel maths. `nativeRTL` is exported so a settings screen can offer the
reload-required native mirror as an explicit, honest action.

`<Text>` defaults to `align="auto"`, which resolves alignment from the
**content's** first strong character, matching `dir="auto"` in the browser. A
user reading an English UI still gets an Arabic quotation right-aligned.
`align="ui"` opts into following the interface instead.

---

## `src/ui/` — the design system

Thirteen modules, one barrel. Screens import from `@/ui` and nothing else, so a
primitive can be split or renamed without touching the screens.

The pieces that carry more weight than their size suggests:

- **`Icon`** maps *concepts* to glyphs (`<Icon name="reels" />`), not icon-set
  names. Swapping sets is one file, and a concept cannot render as two
  different glyphs on two screens. `DisclosureIcon` and `BackIcon` mirror under
  RTL on their own.
- **`Touchable`** adds the three things every tappable surface needs and would
  otherwise re-implement: a press response, haptics gated on the accessibility
  setting, and an automatic hit-slop when the visual target measures under
  44 pt.
- **`Field`** owns the whole presentation of an error, because every write in
  this app can come back with `fieldErrorMap(err)`. A screen never draws its
  own error text.
- **`State`** holds the four states every data surface has: skeleton, empty,
  error, offline. `ErrorState` derives its copy from `errorText(e)` — the
  backend's own message for a known envelope — and branches on the error
  taxonomy: a 404 is not retryable and says so, a 429 counts down, a network
  failure names the real cause instead of blaming the server.
- **`ListRow`** is the settings row, the menu item, the picker option and the
  action-sheet line. There are roughly two hundred of them; making them one
  component is the difference between a settings tree that reads as one product
  and one that reads as fourteen screens.
- **`Sheet`** is hand-written rather than a sheet library, because what the app
  needs is ~120 lines of reanimated + gesture-handler, and a third-party
  sheet's gesture handling would then have to be reconciled with the story
  viewer's and the reel pager's.
- **`Toast`** registers itself with `platform/toast.js` at mount, which is what
  makes `api/http.js`'s existing `flashToast()` calls — the 429 warning, the
  deprecation notice — light up without touching those call sites.

---

## `src/app/` — the shell

Provider order in the root layout is load-bearing:

```
GestureHandlerRootView   outermost native view
KeyboardProvider         wraps anything that scrolls
SafeAreaProvider         everything below reads insets
ThemeProvider            colours before anything paints
AuthProvider             the session state machine
RealtimeProvider         needs signedIn from AuthProvider
ChatProvider             (inside (app)) seeds three requests
StepUpHost + ToastHost   register the two api-layer callbacks
```

The last line is why those hosts exist at all. `api/http.js` deliberately does
not import UI, so the 403 step-up replay and the 429 toast reach the user
through a registered callback rather than an import cycle.

**No screen uses the native header.** Almost every one needs something the
stock header cannot do — an avatar and a presence line in the title, a blurred
translucent background over scrolling media, a live viewer count — so there is
one `<Header>` component and `headerShown: false` throughout. One header beats a
stock one plus twenty overrides.

### Tabs

`Home · Explore · Reels · Chat · You`

Composing is a floating action button, not a sixth tab and not a centre "+":
this app has six things to create, so the entry point opens a chooser, and a
chooser behind a tab reads as a broken tab. Notifications live in the Home
header — the bell is what people reach for by icon, and the badge rides the SSE
stream either way.

The tab bar is custom because the stock one cannot render a live SSE badge, the
user's own avatar as the profile tab, or the re-tap-to-scroll-to-top gesture
(`components/nav/tabEvents.ts`) that is the most-used interaction in a feed app
and has no stock equivalent.

---

## Realtime

`realtime/overview.md` §3 is unambiguous: an authenticated shell keeps **three**
SSE connections open for the whole session, in one place — chat, notifications,
story tray — and everything else is page-scoped. The per-user cap is **five
emitters with LRU eviction**, so opening the chat stream from both the inbox and
an open conversation would silently evict the app's own older connection.

`RealtimeContext` owns those three. It also owns the badges, the presence map
and the typing map (with the 6 s client-side TTL, because a dropped "stopped
typing" frame must not pin a bubble forever), and it exposes a fan-out that
`ChatContext`, the inbox and an open thread all read from one socket.

Two rules every screen inherits:

- **Every `connected` is a reconcile.** The frame fires on the first handshake
  *and* on every reconnect. `useReconcile(fn)` runs on each one; treating it as
  "first open" loses everything that arrived while the socket was down.
- **Events carry deltas, not counters.** Apply ±1 locally and let the next REST
  read correct it. The documented exceptions that *do* carry absolutes are post
  `SHARE_COUNT_UPDATED`, story poll tallies, `stream.viewer` and the
  notification `unread-count`.

Backgrounding matters here in a way it never did in a browser tab: iOS suspends
sockets, so the streams tear down on background and re-dial on foreground —
which fires `connected`, which triggers the reconcile every screen already
implements.

### ChatContext — the one architectural change to a ported file

On the web, `ChatContext.jsx` owned the `/messaging/stream` socket. It cannot
here, for the eviction reason above. So `src/context/ChatContext.tsx`
subscribes to the shell's fan-out instead, and presence + typing are
re-exported from it rather than tracked twice.

Everything else is the web logic, deliberately: the delta model with its
reconnect re-seed, the disappearing-message preview substitution (the server
never puts a vanishing message's text in the inbox rail, and neither may the
client), the badge dedupe, the "active means open **and** foregrounded" rule,
and the delivered-receipt-for-a-closed-conversation path.

`document.visibilityState` became `AppState`, and the one
`window.location.pathname.includes('/live/…')` check became the expo-router
segments.

---

## `src/lib/` — the six modules the port had left blocked

`PORT.md` listed these as "blocked on a UI decision". They are done:

| Module | What it became |
|---|---|
| `richtext.tsx` | a **native block renderer**, not a WebView |
| `mediaTier.ts` | `expo-image-manipulator` instead of canvas |
| `chatPrefs.ts` | resolved values behind `useChatSkin()` instead of CSS hooks |
| `chime.ts` | haptics — see below |
| `pushNotify.ts` | `expo-notifications`, replacing `desktopNotify.js` |
| `chatErrors.ts` | the chat 403 family, which the wire leaves terse |

**`richtext.tsx`** deserves the detail. The web version was `marked` +
DOMPurify + `innerHTML`; none of those exist here, and a WebView per body is not
an option when a feed holds forty of them. So it parses the three BodyFormats
into a block tree and paints it with RN primitives. What is preserved exactly:
the `PLAIN | MARKDOWN | HTML` contract, `detectFormat` character for character
(the server uses the same heuristic and the two must agree), the URL whitelist,
and per-block direction resolution.

**`chime.ts`** is the one place the port answers a web behaviour with a
*different* behaviour rather than a translation. The web version synthesised a
tone with WebAudio. expo-audio has no oscillator, and a foreground app that
plays its own ding over the user's music is worse behaviour than the web blip
ever was — the platform convention is haptic-only in-app, with the OS sound when
backgrounded. The rate limit and the mute gate, which were the load-bearing
parts, are preserved.

---

## Moderation

`components/system/Moderation.tsx` is the cross-cutting surface: the badge, the
notice, the composer's refusal strip, and `useHeldWatch`.

Every string comes from `lib/moderation.js` or from the server. That is not a
style preference. The copy is deliberately vague — "your content is being
checked", never "your text contained X" — because naming the label that fired
turns the moderation endpoint into an oracle. So: never decorate a refusal,
never highlight the offending phrase, never clear the draft, and **never invent
a badge for a surface that carries no marker**, because guessing marks clean
content as "checking".

There is no realtime moderation event anywhere in the platform, so a held item
polls itself back. `useHeldWatch` owns that loop and gets the two things a naive
poll gets wrong: it stops when the app backgrounds (when the classifier is
unreachable *everything* is held at once, and a tight poll turns one outage into
two), and it gives up at the kind's ceiling, because past that a human owns the
case.

---

## Routing

`experiments.typedRoutes` is **off**, and `scripts/check-routes.mjs` replaces
it. The generated `.expo/types/router.d.ts` only refreshes when the dev server
runs, which made it useless while the route tree was being built and actively
misleading when stale. The script walks `src/app` for the real route table,
walks the source for every navigation target, and computes the same guarantee
from the truth rather than from a cache.

```sh
npm run check          # typecheck + routes
npm run check:routes
```

It reports four things, and the last two are the ones a type system would not
have caught anyway:

- **broken targets** — a link to a route that does not exist;
- **orphans** — routes nothing links to (tab screens excluded, since the tab
  bar navigates by name);
- **swallowed literals** — a literal path that lands on a *dynamic* route.
  `/sounds/picker` matching `/sounds/[id]` opens the detail screen for a sound
  called "picker", and the router is perfectly happy about it. This found two
  real ones. `/call/new` is the deliberate-sentinel case and is reported for
  the same reason: from the outside they are indistinguishable;
- **unmatched `<Stack.Screen name>`** — the navigator ignores a name that
  matches no sibling, so a `presentation: 'fullScreenModal'` on a mistyped one
  silently degrades to a push. `name="live/[id]"` is the trap: only a directory
  with its own `_layout` collapses to the bare name, so the real route is
  `live/[id]/index`.

Turn `typedRoutes` back on whenever you like; the script stays useful either
way, because none of the last three checks is something the generated union
expresses.

`src/app/(app)/posts/[id].tsx` exists because `/posts/{id}` — plural — is what
the **backend** emits. `notifications.js` derives it for every Post row,
`activity.js` returns it from `hrefOf`, `search.js` builds it in `hitHref`.
Those strings cannot be changed from here, so the app answers at that address
and redirects to the canonical singular route.

---

### Known duplication

`ModerationBadge` exists four times — the shared one in
`components/system/Moderation.tsx`, plus a per-surface copy under `post/`,
`stories/` and `reels/`. They all read their strings from `lib/moderation.js`,
so they cannot disagree about *what* they say, which is the load-bearing part.
They differ in placement and contrast, because a chip on a feed card, on story
chrome and on a full-bleed reel stage have genuinely different constraints.
`ReportSheet` is duplicated the same way across `profile/`, `qna/` and
`channels/`. Worth consolidating; not worth the regression risk to do blind.

---

## The media plane

`react-native-webrtc` is installed, and two modules carry the whole of it.

**`lib/callEngine.ts`** — 1:1 and group calls. The backend is a blind relay:
it forwards an opaque `payload` between participants and never inspects it, so
the entire negotiation is the client's. The topology is a **mesh**, one peer
connection per remote — right up to a handful of participants and wrong past
it; an SFU would sit in front of these same frames without changing them.

Three rules make it work, and each fixes a failure that looks like a network
problem:

1. **Glare.** If both sides offer at once, both answer their own offer and
   neither connects. Comparing user ids as strings settles it with no
   coordination — but *not* by deciding who may offer. Anyone with no
   connection offers; the id order decides who **yields** when two offers
   cross. The higher id drops its own attempt and takes the other's; the lower
   id ignores the incoming one and lets its own complete.

   The stricter rule — only the lower id may ever offer — looks equivalent and
   deadlocks on re-entry: leave the call screen and come back, and for every
   peer whose id sorts below yours you wait for an offer they will never send,
   because their connection still exists and they think you are up. Silent,
   one-directional, and indistinguishable from a network fault. The wiring pass
   found this from the outside and flagged it; the fix is in the engine.
2. **ICE before SDP.** A candidate can legitimately arrive before the
   description it belongs to. Dropping it stalls the connection on a slow relay,
   so early candidates are queued per peer and drained when a description lands.
3. **`failed` is recoverable.** Restart ICE rather than tear down — but from
   the lower id only. Rule 1 leaves both sides able to offer, so without a
   single restarter a transport blip makes both restart, and the recovery
   becomes the collision it exists to repair.

Accepting an offer always rebuilds the peer connection rather than rolling
back: `setRemoteDescription` on a connection that is mid-negotiation throws,
and react-native-webrtc's rollback support is not dependable enough to lean on.
It costs one ICE round trip and always works. The remote's stream is kept
across the rebuild so their tile does not blank while it reconnects.

**`lib/liveWebrtc.ts`** — WHIP publish and WHEP watch against MediaMTX. The
web module's hard-won behaviour is preserved, because every piece of it fixes
something invisible until you play the recording back:

- **The camera warm-up.** MediaMTX finalises a session's track list a beat
  after the peer connection is up, and whatever has produced data by then *is*
  the stream, permanently. Lose that race and the session registers as audio
  only: viewers get sound over a black rectangle and the recording is written
  with no video track. The web proved a frame had decoded via
  `requestVideoFrameCallback`; there is no native equivalent, so this is a
  bounded wait on the track reaching `live` — a heuristic where the web had a
  signal, and marked as one.
- **The picture watchdog.** A video track can stop feeding the encoder without
  the connection leaving `connected` — screen lock, another app taking the
  camera, a burst of loss that leaves H264 undecodable with no keyframe coming.
  Audio is Opus, so every packet stands alone and the sound sails on. That is
  the "recording freezes but you can still hear them" bug. So `framesEncoded`
  is polled, and a stall re-acquires the camera and `replaceTrack`s: a new
  encoder always opens with a keyframe. The transceiver is reused, because a
  changed track set makes MediaMTX restart its recorder and split the file.
- **`maintain-framerate` plus a bitrate cap**, so degradation sheds pixels
  rather than taking the framerate to something that reads as a freeze.
- **A wake lock**, re-taken on foreground: a sleeping display suspends the
  camera, which is the most common way a live picture dies with the app open.

`hasWebRTC` survives as the gate, and a build that strips the module still
degrades honestly rather than showing a silent call. It reads the imported
class rather than probing `globalThis`, because nothing calls
`registerGlobals()`: both engines import what they need, so installing
`RTCPeerConnection` and `navigator.mediaDevices` globally would buy nothing and
risk colliding with the fetch and stream shims already there.

### The one thing to verify on a device first

`react-native-webrtc@124` is a **Paper (old-architecture) native module** — no
Fabric component, no codegen. SDK 57 runs the New Architecture by default, so
it goes through the interop layer. The native module half of that is routine;
`RTCView` is a native *component*, and component interop is the thinner half.

Turning the New Architecture off is not an option here: **reanimated 4 requires
it**, and reanimated is in every screen. So the configuration is the standard
one — New Architecture on, WebRTC through interop — and `expo-doctor`'s
"untested on New Architecture" warning is excluded in `package.json` because it
reports directory *metadata*, not a measured failure.

What that means practically: **the first thing to try on a real device is a
video call**, before anything else. If `RTCView` renders nothing while audio
works, that is the interop layer and not this code — the peer connection,
signalling and stats paths would all be fine, and the fix is upstream or a
small Fabric wrapper, not a rewrite.

---

## Two things that only a device could tell us

**`react-native-mmkv` v4 has no `MMKV` class.** The ported `storage.js` did
`new MMKV({ id: 'ika' })`, which is the v3 API; v4 replaced it with a
`createMMKV()` factory and renamed `instance.delete()` to `instance.remove()`.
Nothing catches this before the device: the import does not fail, the named
export is simply `undefined`, so it throws *"undefined cannot be used as a
constructor"* at module scope — and because `api/config.js` imports it,
**every route in the app** fails to evaluate and expo-router reports each one
as "missing the required default export". The file is JavaScript and `checkJs`
is off, so the type checker never saw it. Fixed, and worth remembering as the
shape of the bug: a JS-only shim against a third-party API that moved.

**The Android build needs JDK 17.** With JDK 25 on `PATH`, three CMake
configure tasks fail — `react-native-screens`, `react-native-nitro-modules`,
`react-native-worklets` — with `WARNING: A restricted method in
java.lang.System has been called`. Java 25 tightened restricted-method access
and AGP's NDK configuration trips over it. Set:

```sh
export JAVA_HOME=$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home
```

or add `org.gradle.java.home=…` to `~/.gradle/gradle.properties` so it survives
`expo prebuild` (which rewrites `android/gradle.properties`).

---

## Web is not a target

`app.json` still carries the template's `web` block, and `expo start --web`
will fail — the first thing it hits is `react-native-pager-view` importing
`codegenNativeCommands`. That is not a fixable oversight: **twelve** of the
app's dependencies are native-only, including the two it cannot function
without.

```
react-native-mmkv      the synchronous token store the whole API layer needs
react-native-webrtc    calls and live
react-native-pager-view, react-native-keyboard-controller, react-native-view-shot
expo-camera, expo-video, expo-audio, expo-image-picker,
expo-location, expo-media-library, expo-contacts
```

Run `npx expo start` and press **a** for Android or **i** for iOS. Pressing
**w** will always fail. Shimming a path to web would mean replacing the storage
layer, the media plane, the capture surfaces and the pager — a separate
product, not a build target.

---

## Known gaps

- **`doRefresh()` still posts `{}`** and leans on the HttpOnly cookie. The open
  question in `PORT.md` is unchanged and still needs one live login to answer:
  RN's fetch delegates cookies to the native stack, which is not guaranteed to
  survive an app restart, and the symptom is the app signing the user out about
  hourly while looking like a backend bug.
- **`prebuild` has not been run.** It writes `ios/` and `android/`, which is the
  user's call:
  ```sh
  npx expo prebuild
  npx expo run:ios      # or run:android
  ```
  A development build is required — `react-native-mmkv` v4 is a Nitro module,
  and the reason is in `PORT.md`.
- **`src/mock/data.json` (1 MB) is reachable through Metro's dynamic import**
  and Metro does not tree-shake it. Fine for development; strip it from release
  builds.
