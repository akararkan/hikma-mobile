/* =========================================================
   callNotifee — the WhatsApp-style incoming-call notification.

   expo-notifications (pushNotify.ts) covers every ordinary
   banner, but it has no Android "full-screen intent" API: a
   heads-up notification the user must tap, not a ring that wakes
   the phone over the lock screen. That needs notifee's
   `fullScreenAction`, which is Android-only — iOS full-screen
   calling needs CallKit + a VoIP push the backend does not send
   yet (see PUSH.md), so iOS keeps riding pushNotify's ordinary
   `notifyIncomingCall` heads-up banner.

   Reuses pushNotify's CHANNEL_CALLS rather than creating a
   second one: Android channels are identified by (package,
   channelId) at the OS level, so a channel `ensureNotificationChannels`
   already created (sound, importance, bypassDnd) works exactly
   the same when notifee targets it by id — one ring identity,
   whichever library posts it.
   ========================================================= */
import { Platform } from 'react-native'
import notifee, {
  AndroidCategory, AndroidImportance, EventType,
  type Event, type Notification, type NotificationPressAction,
} from '@notifee/react-native'
import { api } from '@/api'
import { CHANNEL_CALLS } from '@/lib/pushNotify'

/** The server sweeps a ring to MISSED after ~60s — match that window so the
 *  notification does not outlive a call nobody is going to answer. */
const RING_TIMEOUT_MS = 60_000

/** The brand navy the colorized call plate wears (DESIGN.md §2 — the one
 *  dark ground cerulean and white ink are sanctioned on). */
const CALL_PLATE = '#002147'

function notificationId(callId: string) { return `call-${callId}` }

/** Show the full-screen ringing notification. Android only — see header.
 *
 *  Two situations, one notification:
 *  · Screen off / locked — the fullScreenAction launches the ringing screen
 *    over the lock screen: the true WhatsApp full-screen ring.
 *  · Screen on, phone in use — Android POLICY (not this code) downgrades a
 *    full-screen intent to a heads-up so it never yanks the screen away from
 *    whatever the user is doing. WhatsApp gets the same treatment; what makes
 *    its heads-up read as a CALL is everything this notification now carries
 *    too — the caller's face, the caller's name, a colorized call plate, a
 *    ring that loops for the whole window, Answer/Decline. */
export async function presentIncomingCall(opts: {
  callId: string
  title: string
  body: string
  /** Caller's (or group's) picture — the circular largeIcon, like WhatsApp. */
  avatarUrl?: string | null
}): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    await notifee.displayNotification({
      id: notificationId(opts.callId),
      title: opts.title,
      body: opts.body,
      data: { callId: opts.callId },
      android: {
        channelId: CHANNEL_CALLS,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        autoCancel: false,
        ongoing: true,
        /* FLAG_INSISTENT: the channel's ringtone repeats until the
           notification is answered, declined or timed out — a ring, not a
           ding. The 60s timeout below is what bounds it. */
        loopSound: true,
        /* Wake the display for the heads-up even when the full-screen path
           is unavailable — a dark phone that only buzzes is a missed call. */
        lightUpScreen: true,
        /* The colorized call plate: Android paints the whole notification in
           the brand navy (sanctioned for CATEGORY_CALL + ongoing) and picks
           its own contrasting ink — the visual grammar of an OS call. */
        color: CALL_PLATE,
        colorized: true,
        ...(opts.avatarUrl ? { largeIcon: opts.avatarUrl, circularLargeIcon: true } : {}),
        timeoutAfter: RING_TIMEOUT_MS,
        smallIcon: 'notification_icon',
        /* Tapping the notification body opens the ringing screen; the
           full-screen action is the same default launch, fired
           automatically (screen-on, over the lock screen) rather than
           waiting for a tap — that IS the WhatsApp behaviour. */
        pressAction: { id: 'default' },
        fullScreenAction: { id: 'default' },
        actions: [
          /* No `launchActivity` — Notifee will NOT bring the app forward for
             this one, so declining from the shade never flashes the UI open.
             Handled headlessly by index.js's onBackgroundEvent. */
          { title: 'Decline', pressAction: { id: 'decline' } },
          /* `launchActivity: 'default'` — unlike the plain body/full-screen
             press, an action button does not open the app on its own
             (notifee docs); Answer needs to. */
          { title: 'Answer', pressAction: { id: 'answer', launchActivity: 'default' } },
        ],
      },
    })
  } catch { /* a failed call notification must never take the ring down */ }
}

export interface CallIdentity { name: string | null; avatar: string | null }

/** Who is calling — the conversation first (its displayTitle covers groups,
 *  the 1:1 peer brings the face), then the initiator's public profile. The
 *  wire CallResponse carries NO identity (calls.md), so every ring surface
 *  has to ask; this is the one shared answer. Bounded and fail-open: a ring
 *  must never hinge on a lookup, so a slow or failed read resolves null and
 *  the caller falls back to whatever it already had. */
export function resolveCallIdentity(opts: {
  conversationId?: string | null
  initiatorId?: string | null
  timeoutMs?: number
}): Promise<CallIdentity | null> {
  const lookup = async (): Promise<CallIdentity | null> => {
    if (opts.conversationId) {
      try {
        const convo: any = await api.chat.conversations.get(String(opts.conversationId))
        if (convo) {
          const peer = convo.isGroup ? null : convo.peer
          const name = convo.displayTitle || peer?.full || null
          const avatar = (convo.isGroup ? convo.avatarUrl : peer?.profileImage) ?? null
          if (name || avatar) return { name, avatar }
        }
      } catch { /* fall through to the public profile */ }
    }
    if (opts.initiatorId) {
      try {
        const u: any = await api.users.get(String(opts.initiatorId))
        if (u) {
          return {
            name: u.full || (u.handle ? `@${u.handle}` : null),
            avatar: u.profileImage ?? null,
          }
        }
      } catch { /* unresolvable — the generic ring stands */ }
    }
    return null
  }
  return Promise.race([
    lookup(),
    new Promise<null>(resolve => setTimeout(() => resolve(null), opts.timeoutMs ?? 1200)),
  ]).catch(() => null)
}

export function cancelIncomingCall(callId: string): void {
  if (Platform.OS !== 'android') return
  void notifee.cancelNotification(notificationId(callId)).catch(() => { /* already gone */ })
}

/** The backend sends `CALL_INCOMING` as a data-only FCM message (PUSH.md,
 *  "Full-screen incoming calls") specifically so a killed app's background
 *  task — index.js's `expo-task-manager` task — gets a chance to build this
 *  notification itself instead of the OS auto-rendering a plain heads-up one.
 *  `title`/`body` ride inside `data` because a data-only message has no other
 *  place to put them.
 *
 *  expo-notifications' background-task payload shape varies: individual keys
 *  may be spread directly onto `data`, or bundled as a JSON string under
 *  `data.dataString` — handle both. Returns null for anything that is not a
 *  ringing call (every other push kind keeps its ordinary notification block
 *  and never reaches this parser at all). */
export function callIncomingFromTaskData(raw: unknown): {
  callId: string
  title: string
  body: string
  /** For the identity lookup (avatar + name) — the payload carries both
   *  (ChatNotificationService.notifyIncomingCall), the parser passes them on. */
  conversationId: string | null
  callType: 'VOICE' | 'VIDEO' | null
} | null {
  if (!raw || typeof raw !== 'object') return null
  let payload: any = raw
  const dataString = (raw as any).dataString
  if (typeof dataString === 'string') {
    try { payload = JSON.parse(dataString) } catch { payload = raw }
  }
  if (payload?.type !== 'CALL_INCOMING') return null
  const callId = payload.callId
  if (typeof callId !== 'string' || !callId) return null
  const callType = payload.callType === 'VIDEO' ? 'VIDEO' : payload.callType === 'VOICE' ? 'VOICE' : null
  return {
    callId,
    title: typeof payload.title === 'string' && payload.title ? payload.title : 'Incoming call',
    body: typeof payload.body === 'string' && payload.body
      ? payload.body
      : callType === 'VIDEO' ? 'Incoming video call' : 'Incoming voice call',
    conversationId: typeof payload.conversationId === 'string' && payload.conversationId ? payload.conversationId : null,
    callType,
  }
}

export interface CallRoute { callId: string; href: string }

/* The `incoming` screen already cancels both notifications for itself on
   mount (call/[id]/incoming.tsx), but the `answer` route opens the call room
   directly — bypassing that screen and CallBanner's own `accept()` — so
   callers of these two functions must cancel using the returned `callId`
   themselves. Doing it here unconditionally, for every route, is simplest and
   harmless: cancelling an already-gone notification is a no-op. */
function routeFor(notification: Notification | undefined, pressAction: NotificationPressAction | undefined): CallRoute | null {
  const callId = notification?.data?.callId
  if (typeof callId !== 'string' || !callId) return null
  if (pressAction?.id === 'decline') return null
  const href = pressAction?.id === 'answer' ? `/call/${callId}?answer=1` : `/call/${callId}/incoming`
  return { callId, href }
}

/** Where a FOREGROUND notifee event (app already alive) should route to, or
 *  null when it is not a call press this app cares about — a swipe-dismiss,
 *  or an unrelated notifee notification if one is ever added. */
export function callRouteFromForegroundEvent(e: Event | null | undefined): CallRoute | null {
  if (!e) return null
  if (e.type !== EventType.PRESS && e.type !== EventType.ACTION_PRESS) return null
  return routeFor(e.detail.notification, e.detail.pressAction)
}

/** Where a COLD-START notifee launch (the app process didn't exist until the
 *  tap created it) should route to. `getInitialNotification()`'s shape has no
 *  `type` — by definition it is always the press that launched the app. */
export function callRouteFromInitialNotification(
  initial: { notification: Notification; pressAction: NotificationPressAction } | null | undefined,
): CallRoute | null {
  if (!initial) return null
  return routeFor(initial.notification, initial.pressAction)
}
