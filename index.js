/* =========================================================
   Custom entry point.

   `expo-router/entry` normally IS package.json's "main" — it
   owns bootstrapping the router and registering the root
   component. It still does; this file only wraps it, because
   two things have to be registered at module scope, outside any
   React component, to ever run in the headless JS context Android
   spins up for a killed app:

   1. notifee's background event handler (notifee's own docs:
      index.js, ahead of the app) — a handler attached from inside
      a component never fires there.
   2. The `expo-task-manager` task that turns a killed-app
      `CALL_INCOMING` push into the full-screen ringing
      notification (PUSH.md, "Full-screen incoming calls"). The
      backend sends that one push data-only specifically so this
      task gets a chance to run instead of the OS auto-rendering a
      plain heads-up notification — see callNotifee.ts.

   Kept deliberately thin otherwise: the only OTHER action a
   backgrounded/killed app can safely perform without a mounted UI
   is declining a call from the notification's action button.
   Everything else (answering, opening the ringing screen) needs
   the app in the foreground and is handled by CallBanner via
   notifee.onForegroundEvent + getInitialNotification().
   ========================================================= */
import { AppState } from 'react-native'
import notifee, { EventType } from '@notifee/react-native'
import * as TaskManager from 'expo-task-manager'
import * as Notifications from 'expo-notifications'
import { api } from '@/api'
import { presentIncomingCall, callIncomingFromTaskData, resolveCallIdentity } from '@/lib/callNotifee'
import 'expo-router/entry'

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type !== EventType.ACTION_PRESS || detail.pressAction?.id !== 'decline') return
  const callId = detail.notification?.data?.callId
  const notificationId = detail.notification?.id
  if (typeof callId === 'string' && callId) {
    try { await api.chat.calls.decline(callId) } catch { /* the ring times out server-side regardless */ }
  }
  if (notificationId) {
    try { await notifee.cancelNotification(notificationId) } catch { /* already gone */ }
  }
})

const CALL_PUSH_TASK = 'ika-call-incoming-task'

TaskManager.defineTask(CALL_PUSH_TASK, async ({ data, error }) => {
  if (error || !data || 'actionIdentifier' in data) return
  /* Foreground: CallBanner's own SSE listener already owns the ring (banner +
     audio) — this task exists for background/killed delivery. Letting it
     through too would re-post the same notification id, which Android
     re-alerts on update, next to a banner already ringing. */
  if (AppState.currentState === 'active') return
  const call = callIncomingFromTaskData(data)
  if (!call) return
  /* Whose face goes on the ring — resolved IN PARALLEL with the freshness
     check below (both are network reads; serial would double the latency of
     a ring that is already racing the caller's patience). The payload title
     is already the caller's NAME (backend puts it in data), so this lookup
     mostly buys the avatar; it is bounded and fail-open inside
     resolveCallIdentity itself. */
  const identity = resolveCallIdentity({ conversationId: call.conversationId, timeoutMs: 1800 })
  /* FCM can deliver this push seconds late — after the callee answered on
     another device, or the caller gave up. Posting the ring then is a phone
     that rings for a finished call, so ask the server first. Fail OPEN
     (present anyway) on any error or a slow answer: a killed app's only ring
     must never hinge on a lookup. */
  try {
    const fresh = await Promise.race([
      api.chat.calls.get(call.callId),
      new Promise(resolve => setTimeout(() => resolve(null), 1500)),
    ])
    if (fresh && !fresh.ringing) return
  } catch { /* unknowable — ring */ }
  const ident = await identity
  await presentIncomingCall({
    callId: call.callId,
    title: ident?.name || call.title,
    body: call.body,
    avatarUrl: ident?.avatar ?? null,
  })
})

void Notifications.registerTaskAsync(CALL_PUSH_TASK).catch(() => { /* e.g. unsupported platform */ })
