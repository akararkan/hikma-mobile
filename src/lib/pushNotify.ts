/* =========================================================
   Push notifications — the RN replacement for lib/desktopNotify.js.

   The web module asked the browser for permission and drew a
   Notification when a `notification` SSE frame arrived while
   the tab was hidden. Neither half survives the move:

     · a phone delivers push through APNs/FCM, from the server,
       whether or not the app is running — so the client's job
       shrinks to registering a device token and handling taps;
     · a foreground notification is the OS's decision, not the
       app's, and expo-notifications owns that handler.

   The registration contract is the settings API's:
     POST /settings/notifications/push-tokens { provider, token, platform, sid }

   `provider` is the transport the backend will deliver on.
   Expo's push service sits in front of both APNs and FCM, so
   the token registered is the Expo token and the provider says
   so — registering a bare APNs token under an FCM provider is
   the classic way to make push silently never arrive.

   Nothing here runs automatically: the settings screen calls
   `enablePush()` when the user turns push on, and `disablePush()`
   when they turn it off, so the permission prompt is attached
   to an action the user took.
   ========================================================= */
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { api, session } from '@/api'
import { clientHrefOf } from '@/api/notifications'
import { storage } from '@/platform/storage'

const TOKEN_KEY = 'ika_push_token'
const ROW_KEY = 'ika_push_token_id'

/** The `sid` claim off the access JWT — the session id the backend keys token
 *  hygiene on (PushTokenService.deleteBySid: revoking the session purges its
 *  push token). Registering without it works, but the token then outlives its
 *  session. Best-effort: a malformed token just registers sid-less. */
function currentSid(): string | undefined {
  try {
    const payload = String(session.getToken() || '').split('.')[1]
    if (!payload) return undefined
    const json = globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const sid = JSON.parse(json)?.sid
    return typeof sid === 'string' && sid ? sid : undefined
  } catch { return undefined }
}

/** Foreground presentation. The OS decides whether to show a banner; this is
 *  the app saying it wants one, because an in-app toast covers only the
 *  screens that are mounted. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,   // chime.ts owns in-app alerting, and honours the mute
    /* No badge. `present()` never puts a `badge` on its content and nothing in
       the app clears one, so asking for badging could only produce a count
       that goes up and never comes down. Wire a clear before turning it on. */
    shouldSetBadge: false,
  }),
})

/* Channel ids are VERSIONED because Android freezes a channel's sound and
   importance at creation — the original silent 'default'/'messages' channels
   can never learn their sounds, so the sounded generation gets fresh ids and
   the old ones are deleted (harmless where they never existed). The backend's
   push payloads name these same ids; change them in lockstep or a push falls
   back to the plugin's silent default channel. */
export const CHANNEL_DEFAULT = 'default_v2'
export const CHANNEL_MESSAGES = 'messages_v2'
export const CHANNEL_CALLS = 'calls_v1'
export const CHANNEL_LIVE = 'live_v1'

let channelsReady: Promise<void> | null = null

/** Create the Android channels (sounds included) — idempotent, cheap, and
 *  required BEFORE any local or remote notification can carry sound. Called
 *  at app bootstrap, not just when push is enabled: local notifications ride
 *  the same channels. */
export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve()
  if (channelsReady) return channelsReady
  channelsReady = (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL_DEFAULT, {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'notification.wav',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    })
    await Notifications.setNotificationChannelAsync(CHANNEL_MESSAGES, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'message.wav',
      vibrationPattern: [0, 160],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    })
    await Notifications.setNotificationChannelAsync(CHANNEL_LIVE, {
      name: 'Live',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'live.wav',
      vibrationPattern: [0, 160],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    })
    await Notifications.setNotificationChannelAsync(CHANNEL_CALLS, {
      name: 'Calls',
      /* MAX + the long ringtone: for a backgrounded app this channel IS the
         ring — the sound file carries ~24s of repeating ring, which is the
         Android way to "loop" (a channel plays its sound once per post). */
      importance: Notifications.AndroidImportance.MAX,
      sound: 'ringtone.wav',
      vibrationPattern: [0, 400, 250, 400, 250, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    })
    /* The pre-sound generation. Deleting a channel that never existed is a
       no-op, so this is safe on fresh installs. */
    await Notifications.deleteNotificationChannelAsync('default').catch(() => {})
    await Notifications.deleteNotificationChannelAsync('messages').catch(() => {})
  })().catch(() => { channelsReady = null })
  return channelsReady ?? Promise.resolve()
}

/* ---- SSE-driven local notifications ----
   True remote push needs FCM credentials (see PUSH.md); until those exist —
   and even after, for the app-alive-in-background window — the realtime
   streams are the delivery pipe. These presenters let the providers surface
   what arrived while the app is backgrounded, with the right channel and
   sound. They must NOT fire while the app is foregrounded: banners over a
   live screen are the OS's job for REMOTE pushes only, and chime.ts already
   covers in-app alerting. The caller owns that AppState gate. */

async function present(content: Notifications.NotificationContentInput, channelId: string, id?: string) {
  try {
    await ensureNotificationChannels()
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content,
      /* Android routes sound/importance through the channel; iOS takes the
         sound on the content. */
      trigger: Platform.OS === 'android'
        ? ({ channelId } as Notifications.NotificationTriggerInput)
        : null,
    })
  } catch { /* a failed banner must never take the stream handler down */ }
}

/** A chat message that landed while the app was backgrounded. Dedup by
 *  message id — a reconnect replay must not re-ring. */
export function notifyMessage(opts: { title: string; body: string; conversationId: string; messageId?: string }) {
  void present({
    title: opts.title,
    body: opts.body,
    sound: 'message.wav',
    data: { conversationId: opts.conversationId },
  }, CHANNEL_MESSAGES, opts.messageId ? `msg-${opts.messageId}` : undefined)
}

/** An inbox notification that landed while the app was backgrounded. */
export function notifyGeneric(opts: { title: string; body?: string; href?: string | null; id?: string }) {
  void present({
    title: opts.title,
    body: opts.body || undefined,
    sound: 'notification.wav',
    data: opts.href ? { href: opts.href } : undefined,
  }, CHANNEL_DEFAULT, opts.id ? `ntf-${opts.id}` : undefined)
}

/** A followed user going live (STREAM_STARTED). Its own channel/sound so a
 *  "went live" alert reads distinctly from an ordinary inbox notification. */
export function notifyLive(opts: { title: string; body?: string; href?: string | null; id?: string }) {
  void present({
    title: opts.title,
    body: opts.body || undefined,
    sound: 'live.wav',
    data: opts.href ? { href: opts.href } : undefined,
  }, CHANNEL_LIVE, opts.id ? `live-${opts.id}` : undefined)
}

/** An incoming call. The calls channel rings for ~24s on its own; dismiss via
 *  dismissCallNotification when the call is answered/declined/ended so the
 *  ring does not outlive the call.
 *  `avatarUrl` is accepted for signature parity with the Android path
 *  (callNotifee.presentIncomingCall) and unused here: expo-notifications can
 *  only attach LOCAL files on iOS, and downloading mid-ring is the wrong
 *  trade. CallKit is the real iOS answer — see PUSH.md. */
export function notifyIncomingCall(opts: { callId: string; title: string; body: string; avatarUrl?: string | null }) {
  void present({
    title: opts.title,
    body: opts.body,
    sound: 'ringtone.wav',
    priority: Notifications.AndroidNotificationPriority.MAX,
    data: { href: `/call/${opts.callId}/incoming`, callId: opts.callId },
  }, CHANNEL_CALLS, `call-${opts.callId}`)
}

export function dismissCallNotification(callId: string) {
  void Notifications.dismissNotificationAsync(`call-${callId}`).catch(() => {})
}

/** `unregistered` is the honest middle state: the OS said yes, but the token
 *  never reached the backend — no EAS project id (the Expo route needs one),
 *  no google-services.json (the FCM route needs that), or the register call
 *  failed. Permission is real; the delivery pipe is not wired. Without this
 *  the switch reports success and push silently never arrives. */
export type PushState = 'granted' | 'denied' | 'undetermined' | 'unsupported' | 'unregistered'

export async function pushPermissionState(): Promise<PushState> {
  if (!Device.isDevice) return 'unsupported'
  const { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') return status === 'denied' ? 'denied' : 'undetermined'
  /* OS permission alone is not push. After disablePush() — or before any
     opt-in — this device is deregistered and delivery is off, whatever the
     OS says; TOKEN_KEY is the opt-in record. Without this check the settings
     switch reads ON for a device the backend no longer sends to. */
  return storage.getItem(TOKEN_KEY) ? 'granted' : 'undetermined'
}

/** The EAS project id, which `getExpoPushTokenAsync` needs in SDK 49+. */
function projectId(): string | undefined {
  return (
    (Constants.expoConfig as any)?.extra?.eas?.projectId
    ?? (Constants as any)?.easConfig?.projectId
    ?? undefined
  )
}

/**
 * Ask for permission, mint a device token, and register it with the backend.
 * Returns the state so the settings screen can explain a refusal rather than
 * showing a switch that silently does nothing.
 */
export async function enablePush(): Promise<PushState> {
  /* A simulator cannot receive push. Saying so plainly beats a token request
     that fails with a cryptic native error. */
  if (!Device.isDevice) return 'unsupported'

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync()
    status = asked.status
  }
  if (status !== 'granted') return status === 'denied' ? 'denied' : 'undetermined'

  /* Android needs the channels before anything is delivered, and a channel
     created after the first notification does not retroactively apply. */
  await ensureNotificationChannels()

  /* NATIVE FCM first on Android: the backend's FcmPushSender talks straight
     to Firebase, cutting the Expo push service (and its EAS project id) out
     of the chain entirely. getDevicePushTokenAsync succeeds exactly when the
     build carries google-services.json (app.config.js picks it up from the
     repo root automatically) — without it, this throws and the Expo route
     below gets its try. */
  if (Platform.OS === 'android') {
    try {
      const { data: fcmToken } = await Notifications.getDevicePushTokenAsync()
      if (typeof fcmToken === 'string' && fcmToken) {
        if (storage.getItem(TOKEN_KEY) === fcmToken) return 'granted'
        const row: any = await api.settings.notifications.registerPushToken({
          provider: 'FCM',
          token: fcmToken,
          platform: 'ANDROID',
          sid: currentSid(),
        })
        storage.setItem(TOKEN_KEY, fcmToken)
        if (row?.id) storage.setItem(ROW_KEY, String(row.id))
        return 'granted'
      }
    } catch { /* no google-services.json in this build — fall through */ }
  }

  try {
    /* SDK 49+ requires the EAS project id; without one this throws, and on iOS
       (where the FCM branch above never runs) it is the ONLY route — so an
       unconfigured project means iOS push cannot work at all. `npx eas init`
       writes the id into app.json's extra.eas.projectId. */
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() })
    if (!token) return 'unregistered'

    /* Re-registering the same token every launch would grow the server's list
       with duplicates, so only write when it actually changed. */
    if (storage.getItem(TOKEN_KEY) === token) return 'granted'

    const row: any = await api.settings.notifications.registerPushToken({
      provider: 'EXPO',
      token,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      sid: currentSid(),
    })
    storage.setItem(TOKEN_KEY, token)
    if (row?.id) storage.setItem(ROW_KEY, String(row.id))
    return 'granted'
  } catch {
    /* Not a refusal — the permission is real — but not a success either: the
       backend has no address for this device, so nothing will ever arrive.
       Reported distinctly so the settings screen can say which of the two it
       is instead of showing a switch that lies. */
    return 'unregistered'
  }
}

/**
 * Re-register the CURRENT token if it has drifted from the one this device
 * last sent. Silent by design, and safe to call on every launch.
 *
 * A push token is not stable: the OS rotates it after a reinstall, a restore
 * from backup, a long idle period, or a Firebase/Expo-side refresh. When it
 * does, the backend keeps pushing to an address nobody is listening on, and
 * notifications stop with no error anywhere — the single most common way a
 * working push setup dies quietly (the architecture doc calls this out under
 * "Token management": the token can change, so re-send it on every start).
 *
 * Deliberately does NOT ask for permission and does NOT enable anything:
 *
 *   · no stored token → this device never opted in. Prompting at launch is
 *     exactly the pattern enablePush() exists to avoid, so we leave.
 *   · permission since revoked in Settings → nothing to refresh; the settings
 *     screen reports the real state when the user next looks.
 *
 * Failures are swallowed whole. This runs during boot, it is an optimisation
 * over "the user eventually toggles push off and on again", and a dead network
 * at launch must never surface an error the user cannot act on.
 */
export async function refreshPushRegistration(): Promise<void> {
  try {
    if (!Device.isDevice) return
    /* Opted in before? The stored token IS the record of that. */
    if (!storage.getItem(TOKEN_KEY)) return

    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return

    /* enablePush is the one place that knows the FCM-then-Expo preference
       order and the register call's shape; it early-returns when the freshly
       minted token equals the stored one, so the common case is a couple of
       native calls and no network at all. */
    await enablePush()
  } catch { /* boot-time best effort */ }
}

/** The involuntary sign-out (AUTH_EXPIRED) cannot hand the token back — the
 *  session it would authenticate with is already dead. What this half must
 *  NOT do is keep serving the cached token: enablePush short-circuits on it,
 *  so the next sign-in would never re-register and killed-app push would stay
 *  silently dead (the backend row is gone or bound to the dead sid). Poison
 *  the cache instead of clearing it — TOKEN_KEY doubles as the opt-in record,
 *  and an expiry is not an opt-out. */
export function invalidatePushRegistration(): void {
  if (storage.getItem(TOKEN_KEY)) storage.setItem(TOKEN_KEY, 'stale')
}

/** Deregister this device. The OS permission is not revoked (only the user can
 *  do that in Settings), but the backend stops sending here. */
export async function disablePush(): Promise<void> {
  const id = storage.getItem(ROW_KEY)
  storage.removeItem(TOKEN_KEY)
  storage.removeItem(ROW_KEY)
  if (!id) return
  try { await api.settings.notifications.deletePushToken(id) } catch { /* 204 always, but be safe */ }
}

/**
 * Route a notification tap. The backend's payload carries the same `href` the
 * inbox rows use, so one mapping serves both surfaces.
 *
 * There is no `onNotificationTap` subscriber helper any more: tap routing has
 * exactly one home, `Notifications.useLastNotificationResponse()` in
 * src/app/(app)/_layout.tsx, which also catches the tap that COLD-STARTED the
 * app — a listener registered at mount cannot. Do not add a second listener.
 * @returns the in-app path, or null when the payload says nothing useful.
 */
export function hrefFromPush(data: any): string | null {
  if (!data) return null
  /* Through the SAME grammar the inbox rows use (api/notifications.js):
     the backend's href speaks API-side paths (/users/, /questions/,
     /researches/) that must be rewritten to this client's routes, and two
     (/comments/, /answers/) have no route at all — those fall through to the
     id fallbacks below rather than deep-linking into +not-found. */
  const href = clientHrefOf(data.href)
  if (href) return href
  if (data.conversationId) return `/chat/${data.conversationId}`
  if (data.postId) return `/post/${data.postId}`
  if (data.questionId) return `/qna/${data.questionId}`
  if (data.researchId) return `/research/${data.researchId}`
  if (data.userId) return `/user/${data.userId}`
  return null
}
