# Push notifications & sounds

What works out of the box, and the ONE 5-minute step that unlocks
notifications when the app is fully closed.

## Works now (no accounts, already in your build)

While the app is alive (foreground or recently backgrounded), the realtime
streams deliver everything:

- **Foreground**: the in-app pop-up banner (tap to open, swipe up to dismiss)
  + the haptic chime.
- **Backgrounded**: real OS notifications with sounds — messages
  (`message.wav`), a followed user going live (`live.wav`), everything else
  (`notification.wav`), incoming calls (~24s ringtone on a max-priority
  channel, full-screen wake on Android — see below). Taps deep-link, cold
  start included.

### Keep it alive on Xiaomi (do these once, on the phone)

MIUI kills background apps aggressively — these three settings are why
notifications "stop after a while" on Xiaomi phones:

1. **Security app → Permissions → Autostart** → enable for IKA.
2. **Settings → Apps → IKA → Battery saver** → **No restrictions**.
3. Recents screen → long-press the IKA card → **tap the lock** 🔒.

## Notifications when the app is CLOSED — one manual step

Android delivers killed-app push only through Google's FCM, which needs a
(free) Firebase project. Everything else is already coded on both sides —
the app auto-detects the file, the backend routes FCM tokens directly to
Google (no Expo account needed). The 5 minutes only you can do:

1. https://console.firebase.google.com → **Add project** (any name, e.g.
   `ika`; Analytics off is fine).
2. In the project: **Add app → Android**, package name **`com.ika.mobile`**
   → Register → **download `google-services.json`** → put it in the MOBILE
   repo root (`~/Desktop/hikma-mobile/google-services.json`). Skip the
   remaining console steps.
3. **⚙ Project settings → Service accounts → Generate new private key** →
   download the JSON → save it as
   **`~/Desktop/irc/firebase-service-account.json`** (the BACKEND repo root).
4. Restart the Spring backend.
5. Rebuild + reinstall the app:
   `npx expo prebuild --clean --platform android` → re-add the JDK 17 line to
   `android/gradle.properties` → `cd android && ./gradlew assembleRelease` →
   install. Then in the app: Settings → Notifications → enable push (this
   registers the phone's FCM token).

After that: messages, calls, everything — delivered with sound even when the
app is swiped away. (Keep both JSON files out of git if the repos ever go
public: they identify your Firebase project.)

## The channel contract (client ⇄ backend)

Android channel ids are versioned (a channel's sound is frozen at creation):
`default_v2` (notification.wav), `messages_v2` (message.wav), `calls_v1`
(ringtone.wav, MAX importance, bypasses DND), `live_v1` (live.wav — a
followed user going live, `STREAM_STARTED`). Backend push payloads name
these ids and route taps through `data.href`. Add a channel in
`src/lib/pushNotify.ts` AND the backend's PushNotifier mapping together.

## Full-screen incoming calls (WhatsApp-style) — Android

While the app is alive (foreground or backgrounded), an incoming call now
wakes the phone over the lock screen instead of waiting for a tap: `src/lib/
callNotifee.ts` posts the ring through `@notifee/react-native` with a
`fullScreenAction`, targeting the existing `calls_v1` channel so it inherits
the same ringtone/importance/bypassDnd `ensureNotificationChannels()` already
sets up. `plugins/withFullScreenCallIntent.js` adds the two manifest
attributes Android requires for the wake (`showWhenLocked`,
`turnScreenOn`) to `MainActivity`, and `USE_FULL_SCREEN_INTENT` is declared
in `app.json`. Answer/Decline are real notification actions; Decline is
handled headlessly by `index.js`'s `notifee.onBackgroundEvent` (calls
`api.chat.calls.decline` without opening the UI), Answer and a plain tap route
through `CallBanner`'s `notifee.onForegroundEvent` / `getInitialNotification`.

**This now reaches a fully killed app too (2026-08-24, both repos).** The
gap was that a killed Android app only gets a chance to run JS for a push
when the FCM message is **data-only** (no top-level `notification` block) —
otherwise the OS renders the tray notification itself, straight from the FCM
SDK, and no client code (notifee included) ever runs to add a full-screen
intent. Fixed on both sides:

- **Backend** (`ak.dev.irc.app.settings.notification.push`):
  `PushSender.send`/`sendAll` gained a `dataOnly` flag, threaded through
  `PushSenderRouter`, `FcmPushSender` (skips the `notification` AND
  `android.notification` blocks when set), and `ExpoPushSender` (skips
  `title`/`body`/`sound`). `PushNotifier.deliverDirectAsync` takes the flag;
  `ChatNotificationService.notifyIncomingCall` passes `true` and now also
  puts `title`/`body` into the `data` map itself (`data-only` means there is
  no other place for the client to read them from). Every other push kind is
  untouched — still a real `notification` block, so it keeps showing on a
  killed app even without a background task registered for it.
- **Client**: `index.js` defines and registers an `expo-task-manager` task
  (`Notifications.registerTaskAsync`) that parses the `CALL_INCOMING` data
  payload (`callIncomingFromTaskData` in `callNotifee.ts`, which handles both
  the raw-keys and the `dataString`-JSON shapes `expo-notifications` may
  deliver) and calls `presentIncomingCall()` — same code path the
  backgrounded-alive case already used, so the killed-app ring gets the exact
  same full-screen treatment.

Needs, to actually take effect: the Spring backend restarted (recompiled —
`./mvnw compile` already verified it builds clean), and the mobile app
rebuilt (new native dependency, `expo-task-manager`, plus the manifest
plugin) and reinstalled. Untested on a real device from here — worth a real
end-to-end check (kill the app, have someone call you) after both are
redeployed.

## Sounds

`assets/sounds/`: `notification.wav` (system messages, channels, research,
QNA, and everything else that isn't a DM/live/call), `message.wav` (direct
chat messages), `live.wav` (a followed user going live), `ringtone.wav`
(looped call sound, 24s, under iOS's 30s cap). All started life as mp3 and
were converted with ffmpeg — iOS notification sounds must be wav/caf/aiff,
never mp3. The in-app chime mute silences the call ringtone too; OS channels
obey the phone's own notification settings.

## Token hygiene (automatic, since 2026-08-19)

A push token is not stable — the OS rotates it after a reinstall, a restore,
or a long idle. Two things now keep the backend's copy honest:

- **On every launch**, `refreshPushRegistration()` (called from
  `src/app/(app)/_layout.tsx` once a session exists) re-sends the token if it
  drifted. It is silent: it never prompts, and it does nothing at all unless
  this device had already opted in. Without it, a rotated token means push
  stops arriving and nothing anywhere reports an error.
- **On logout**, `AuthContext` hands the token back before the session dies.
  A token left registered keeps the phone on that account's delivery list —
  the next person to sign in would receive the previous user's messages and
  calls on their lock screen.

The settings switch also stopped lying: when permission is granted but the
token cannot be registered, `enablePush()` returns `unregistered` rather than
`granted`, and the screen says so.

## iOS push — what it actually needs

Two hard requirements, both Apple's, neither optional:

1. **A PAID Apple Developer account.** A free "Personal Team" cannot sign the
   `aps-environment` entitlement. This is not a warning: Xcode refuses to
   create the provisioning profile, which blocks the certificate too, which
   surfaces as the very confusing *"No code signing certificates are available
   to use"*. Because of that, `app.config.js` strips the entitlement **by
   default** so the app stays installable on a free account. With a paid team,
   turn it back on:

   ```sh
   IKA_IOS_PUSH=1 npx expo run:ios --device
   ```

2. **An EAS project id.** iOS has no native-FCM shortcut, so the Expo token is
   the only route, and `getExpoPushTokenAsync` needs `extra.eas.projectId`
   (SDK 49+). There is none today, so the iOS branch throws and registration
   reports `unregistered`. Create one once with:

   ```sh
   npx eas init
   ```

   which writes the id into `app.json`. Then upload the APNs key to Expo
   (`eas credentials`) so Expo Push Service can reach APNs on your behalf.

Until both are done, iOS gets foreground and backgrounded-but-alive
notifications over SSE, exactly as before — just not killed-app push.
