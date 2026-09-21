/* =========================================================
   RealtimeContext — the three always-on streams.

   realtime/overview.md §3 is unambiguous about this: an
   authenticated shell keeps exactly three SSE connections open
   for the whole session, in ONE place —

     1. /api/v1/messaging/stream    everything chat
     2. /api/v1/notifications/stream the bell
     3. /api/v1/stories/tray/stream  the story rail

   and page-scoped streams (post / story / question / research /
   activity) open on mount and close on unmount. The per-user
   cap is FIVE emitters with LRU eviction, so opening the chat
   stream from both the inbox and a conversation screen would
   silently evict the app's own older connection. Hence: here,
   once, and everything else subscribes to the fan-out.

   This provider owns:
     · connection lifecycle, including the reconnect-reconcile
       rule (every `connected` — first AND every reconnect —
       means "re-read via REST")
     · the two badges (chat unread, notification unread) —
       held here because the tab bar renders them, but the
       chat one is WRITTEN by ChatProvider: only the inbox
       knows which arrivals count (own echo, open thread,
       duplicate id), so this file reseeds it absolutely and
       otherwise leaves the arithmetic there
     · presence and typing maps, with the 6s typing TTL and the
       30s presence poll (presence is pull-only: GET /presence;
       the backend's `presence` SSE type is declared but never
       published)
     · a subscribe() firehose so ChatContext, the inbox and an
       open conversation all read one socket

   FAN-OUT SHAPE. Presence and typing frames arrive an order of
   magnitude more often than anything else, so they are NOT
   React state: they live in a ref-backed keyed store, and a row
   that shows one user's dot or one conversation's bubble
   subscribes to exactly that key via usePresence()/useTyping().
   The rest is split across three contexts — a stable API
   surface (subscribe*, trackPresence, badge setters; identity
   never changes while signed in), a connection context
   (connected + epoch, which flip on connect/disconnect only)
   and an unread context (the two counters, bumped by every
   incoming message). Connection and unread are separate
   because their audiences are disjoint: screens reconcile on
   epoch, chrome renders counters — folding them into one
   context made every incoming message re-render ChatProvider,
   the home screen and the tab bar alike. useRealtimeShell()
   still composes the whole legacy surface, at the cost of
   re-rendering its caller on EVERY presence/typing frame — hot
   paths should read the narrow hooks instead.

   Background/foreground matters on a phone in a way it never
   did in a tab: iOS suspends sockets, so the streams are torn
   down on background and re-dialled on foreground, which also
   triggers the reconcile every screen already handles.
   ========================================================= */
import React from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { api } from '@/api'
import { notifyGeneric, notifyLive } from '@/lib/pushNotify'
import { showInAppBanner } from '@/components/system/InAppBanner'
import { useAuth } from './AuthContext'

/* ---------------------------------------------------------
   Event shapes. The api layer already adapts wire payloads
   into view shapes, so these are just the union the fan-out
   carries.
   --------------------------------------------------------- */

export interface ChatEvent {
  type: string
  conversationId?: string | null
  messageId?: string | null
  userId?: string | null
  message?: any
  [k: string]: any
}

export interface NotificationEvent {
  type: 'notification' | 'unread-count' | 'read' | 'deleted' | 'connected' | 'feed-new-post'
  [k: string]: any
}

export type PresenceStatus = 'online' | 'away' | 'offline'

export interface PresenceEntry {
  status: PresenceStatus
  lastSeenEpochMs: number | null
}

export interface TypingState {
  userId: string
  /** TYPING | RECORDING_VOICE | SENDING_PHOTO | SENDING_VIDEO | SENDING_VOICE | SENDING_FILE */
  activity: string
  expiresAt: number
}

/* ---------------------------------------------------------
   The keyed store. An immutable map plus per-key listeners:
   getAll() is identity-stable between writes (the contract
   useSyncExternalStore needs), and a write wakes only that
   key's subscribers plus the whole-map ones — which is what
   lets a presence flip repaint one avatar dot instead of the
   whole tree.
   --------------------------------------------------------- */

type Listener = () => void

export interface KeyedStore<T> {
  get: (key: string) => T | undefined
  getAll: () => Record<string, T>
  set: (key: string, value: T) => void
  remove: (key: string) => void
  clear: () => void
  subscribeKey: (key: string, fn: Listener) => () => void
  subscribeAll: (fn: Listener) => () => void
  /** Keys something is currently subscribed to — i.e. rendered on screen right
   *  now. This is what the presence poll refreshes: an unmounted row's peer
   *  stops costing a fetch the moment it stops being visible. */
  watchedKeys: () => string[]
}

export function createKeyedStore<T>(): KeyedStore<T> {
  let map: Record<string, T> = {}
  const byKey = new Map<string, Set<Listener>>()
  const whole = new Set<Listener>()
  const wakeKey = (key: string) => {
    for (const fn of [...(byKey.get(key) ?? [])]) {
      try { fn() } catch { /* one broken subscriber must not starve the rest */ }
    }
  }
  const wakeWhole = () => {
    for (const fn of [...whole]) {
      try { fn() } catch { /* ditto */ }
    }
  }
  return {
    get: key => map[key],
    getAll: () => map,
    set: (key, value) => { map = { ...map, [key]: value }; wakeKey(key); wakeWhole() },
    remove: key => {
      if (!(key in map)) return
      const { [key]: _dropped, ...rest } = map
      map = rest as Record<string, T>
      wakeKey(key); wakeWhole()
    },
    clear: () => {
      const keys = Object.keys(map)
      if (!keys.length) return
      map = {}
      for (const k of keys) wakeKey(k)
      wakeWhole()
    },
    subscribeKey: (key, fn) => {
      const set = byKey.get(key) ?? new Set<Listener>()
      byKey.set(key, set)
      set.add(fn)
      return () => { set.delete(fn); if (!set.size) byKey.delete(key) }
    },
    subscribeAll: fn => { whole.add(fn); return () => { whole.delete(fn) } },
    watchedKeys: () => [...byKey.keys()],
  }
}

/* ---------------------------------------------------------
   Contexts. Two providers from one component: the API value is
   built once per session, the badges value only when a counter
   or the connection actually changes.
   --------------------------------------------------------- */

export interface RealtimeApi {
  setChatUnread: (n: number) => void
  setNotificationUnread: (n: number) => void
  refreshBadges: () => Promise<void>
  /** Ask for the presence of a set of users. Deduped, batched, and re-fetched
   *  when the cached answer is older than the 60s freshness window. */
  trackPresence: (userIds: (string | null | undefined)[]) => void
  /** Subscribe to the chat firehose. Returns an unsubscribe. */
  subscribeChat: (fn: (e: ChatEvent) => void) => () => void
  /** Subscribe to the notification firehose. */
  subscribeNotifications: (fn: (e: NotificationEvent) => void) => () => void
  /** Subscribe to story-tray events. */
  subscribeStoryTray: (fn: (e: any) => void) => () => void
  /** userId → presence. Read per key via usePresence(); getAll() is for the
   *  legacy whole-map surface and re-renders on every frame. */
  presenceStore: KeyedStore<PresenceEntry>
  /** conversationId → the users currently typing in it. */
  typingStore: KeyedStore<TypingState[]>
}

export interface RealtimeConnection {
  /** True once the chat stream has handshaken at least once. */
  connected: boolean
  /** Bumped on every (re)connect. Screens watch it and re-read via REST. */
  epoch: number
}

export interface RealtimeUnread {
  chatUnread: number
  notificationUnread: number
}

/** The legacy composed surface — see useRealtimeShell(). */
export interface RealtimeValue {
  connected: boolean
  epoch: number

  chatUnread: number
  notificationUnread: number
  setChatUnread: (n: number) => void
  setNotificationUnread: (n: number) => void
  refreshBadges: () => Promise<void>

  /** userId → presence. Seeded by GET /presence and kept live by a 30s poll of
   *  the on-screen keys — the backend never pushes presence frames. */
  presence: Record<string, PresenceEntry>
  trackPresence: (userIds: (string | null | undefined)[]) => void

  /** conversationId → the users currently typing in it. */
  typing: Record<string, TypingState[]>

  subscribeChat: (fn: (e: ChatEvent) => void) => () => void
  subscribeNotifications: (fn: (e: NotificationEvent) => void) => () => void
  subscribeStoryTray: (fn: (e: any) => void) => () => void
}

const ApiCtx = React.createContext<RealtimeApi | null>(null)
const ConnectionCtx = React.createContext<RealtimeConnection | null>(null)
/* Two contexts, not one object: TabBar renders chatUnread and the Home header
   renders notificationUnread, and a shared {chat, notification} value meant
   every counted message re-rendered the OTHER counter's chrome — the whole
   home screen (header, story rail) per chat message, the whole tab bar per
   notification frame. Primitives, so no memo is needed to keep them stable. */
const ChatUnreadCtx = React.createContext<number | null>(null)
const NotificationUnreadCtx = React.createContext<number | null>(null)

/** The stable half: subscriptions, setters and the stores. Its identity only
 *  changes when the session does, so effects keyed on it never re-arm. */
export function useRealtimeApi(): RealtimeApi {
  const v = React.useContext(ApiCtx)
  if (!v) throw new Error('useRealtimeApi() outside <RealtimeProvider>')
  return v
}

/** connected / epoch and nothing else — flips on connect and disconnect,
 *  never on message traffic. What reconciles and the offline banner read. */
export function useRealtimeConnection(): RealtimeConnection {
  const v = React.useContext(ConnectionCtx)
  if (!v) throw new Error('useRealtimeConnection() outside <RealtimeProvider>')
  return v
}

/** The chat counter alone — what the tab bar's badge renders. Written by
 *  ChatProvider (it mirrors the inbox's own gated totalUnread) and reseeded
 *  absolutely by refreshBadges. */
export function useChatUnread(): number {
  const v = React.useContext(ChatUnreadCtx)
  if (v === null) throw new Error('useChatUnread() outside <RealtimeProvider>')
  return v
}

/** The notification counter alone — what the Home header's bell renders.
 *  Comes from the notification stream's authoritative `unread-count`. */
export function useNotificationUnread(): number {
  const v = React.useContext(NotificationUnreadCtx)
  if (v === null) throw new Error('useNotificationUnread() outside <RealtimeProvider>')
  return v
}

/** Both counters — kept for the legacy shell. New chrome should read the ONE
 *  counter it renders via useChatUnread()/useNotificationUnread(), or it
 *  re-renders on the other's traffic too. */
export function useRealtimeUnread(): RealtimeUnread {
  const chatUnread = useChatUnread()
  const notificationUnread = useNotificationUnread()
  return React.useMemo(() => ({ chatUnread, notificationUnread }), [chatUnread, notificationUnread])
}

/** The whole surface in one object. Because it folds the presence and typing
 *  maps back in, the caller re-renders on EVERY frame of either — components
 *  that only need one user's dot or one conversation's bubble should use
 *  usePresence()/useTyping(), counter readers useRealtimeUnread() and
 *  reconnect logic useRealtimeConnection(). */
export function useRealtimeShell(): RealtimeValue {
  const shell = useRealtimeApi()
  const connection = useRealtimeConnection()
  const unread = useRealtimeUnread()
  const presence = React.useSyncExternalStore(shell.presenceStore.subscribeAll, shell.presenceStore.getAll)
  const typing = React.useSyncExternalStore(shell.typingStore.subscribeAll, shell.typingStore.getAll)
  return React.useMemo<RealtimeValue>(() => ({
    connected: connection.connected,
    epoch: connection.epoch,
    chatUnread: unread.chatUnread,
    notificationUnread: unread.notificationUnread,
    setChatUnread: shell.setChatUnread,
    setNotificationUnread: shell.setNotificationUnread,
    refreshBadges: shell.refreshBadges,
    presence,
    trackPresence: shell.trackPresence,
    typing,
    subscribeChat: shell.subscribeChat,
    subscribeNotifications: shell.subscribeNotifications,
    subscribeStoryTray: shell.subscribeStoryTray,
  }), [shell, connection, unread, presence, typing])
}

/** One user's presence, re-rendering only when THAT user changes. Also asks
 *  for the initial paint — trackPresence dedupes and batches, so calling this
 *  from every visible row costs one request per screenful. */
export function usePresence(userId?: string | null): PresenceEntry | null {
  const { presenceStore, trackPresence } = useRealtimeApi()
  const key = userId ? String(userId) : ''
  const subscribe = React.useCallback(
    (fn: Listener) => (key ? presenceStore.subscribeKey(key, fn) : () => {}),
    [presenceStore, key],
  )
  const read = React.useCallback(
    () => (key ? presenceStore.get(key) ?? null : null),
    [presenceStore, key],
  )
  const value = React.useSyncExternalStore(subscribe, read)
  React.useEffect(() => { if (key) trackPresence([key]) }, [key, trackPresence])
  return value
}

/** Who is typing in one conversation — never yourself, the provider drops own
 *  frames on arrival. Re-renders only when THAT conversation's list changes;
 *  "nobody" is a shared constant, safe for dependency arrays. */
export function useTyping(conversationId?: string | null): TypingState[] {
  const { typingStore } = useRealtimeApi()
  const key = conversationId ? String(conversationId) : ''
  const subscribe = React.useCallback(
    (fn: Listener) => (key ? typingStore.subscribeKey(key, fn) : () => {}),
    [typingStore, key],
  )
  const read = React.useCallback(
    () => (key ? typingStore.get(key) ?? NO_TYPERS : NO_TYPERS),
    [typingStore, key],
  )
  return React.useSyncExternalStore(subscribe, read)
}

const NO_TYPERS: TypingState[] = []

/** Subscribe to the chat stream for the life of a component. The handler is
 *  kept in a ref, so passing an inline arrow does not re-subscribe. */
export function useChatEvents(fn: (e: ChatEvent) => void, enabled = true) {
  const { subscribeChat } = useRealtimeApi()
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => {
    if (!enabled) return
    return subscribeChat(e => ref.current(e))
  }, [subscribeChat, enabled])
}

export function useNotificationEvents(fn: (e: NotificationEvent) => void, enabled = true) {
  const { subscribeNotifications } = useRealtimeApi()
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => {
    if (!enabled) return
    return subscribeNotifications(e => ref.current(e))
  }, [subscribeNotifications, enabled])
}

/** Run `fn` on every (re)connect — the REST reconcile the docs require. */
export function useReconcile(fn: () => void, enabled = true) {
  const { epoch } = useRealtimeConnection()
  const ref = React.useRef(fn)
  ref.current = fn
  const first = React.useRef(true)
  React.useEffect(() => {
    if (!enabled) return
    /* The screen's own load already covers the first paint; this is for the
       reconnects after it. */
    if (first.current) { first.current = false; return }
    ref.current()
  }, [epoch, enabled])
}

/* Typing frames auto-expire after ~6s server-side; the client keeps its own
   TTL so a dropped "stopped typing" frame cannot pin a bubble forever. */
const TYPING_TTL_MS = 6200

/* Presence freshness. trackPresence re-fetches an id whose last read is older
   than FRESH (mirrors the web ChatContext's 60s watchPresence window); the
   poll re-reads every on-screen key at the server's own presence TTL cadence,
   so an offline transition lands within one TTL of the truth. */
const PRESENCE_FRESH_MS = 60_000
const PRESENCE_POLL_MS = 30_000    // = the server's chat:presence key TTL

/* How long the app has to be away before a resume is treated as "the sockets
   are gone". Below this, iOS has not suspended them and the streams come back
   alive — see the AppState handler. */
const RESUME_REDIAL_AFTER_MS = 10_000

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { signedIn, user } = useAuth()

  const [connected, setConnected] = React.useState(false)
  const [epoch, setEpoch] = React.useState(0)
  const [chatUnread, setChatUnread] = React.useState(0)
  const [notificationUnread, setNotificationUnread] = React.useState(0)

  const [presenceStore] = React.useState(() => createKeyedStore<PresenceEntry>())
  const [typingStore] = React.useState(() => createKeyedStore<TypingState[]>())

  const chatSubs = React.useRef(new Set<(e: ChatEvent) => void>())
  const notifSubs = React.useRef(new Set<(e: NotificationEvent) => void>())
  const traySubs = React.useRef(new Set<(e: any) => void>())

  const fan = <T,>(set: React.RefObject<Set<(e: T) => void>>, evt: T) => {
    for (const fn of [...(set.current ?? [])]) {
      try { fn(evt) } catch { /* one broken subscriber must not starve the rest */ }
    }
  }

  /* ---------- badges ---------- */
  const refreshBadges = React.useCallback(async () => {
    if (!signedIn) return
    const [chatN, notifN] = await Promise.all([
      api.chat.unreadCount().catch(() => null),
      api.notifications.unreadCount().catch(() => null),
    ])
    if (typeof chatN === 'number') setChatUnread(chatN)
    if (typeof notifN === 'number') setNotificationUnread(notifN)
  }, [signedIn])

  /* ---------- presence ----------
     Presence is PULL-ONLY on this backend: the `presence` SSE event type is
     declared (ChatRealtimeEventType) but nothing ever publishes it — the truth
     lives in Redis keys with a 30s TTL, refreshed by the server's 15s SSE
     heartbeat, and is read via GET /presence. So freshness is the CLIENT's
     job: fetch on first want, then re-poll every watched key on a cadence, or
     a dot painted "online" at first sight would stay online for the whole
     session. Mirrors the web ChatContext's 60s-freshness watchPresence. */
  /* id → when it was last fetched (or reserved for an in-flight batch). */
  const presenceFetchedAt = React.useRef(new Map<string, number>())
  const presencePending = React.useRef(new Set<string>())
  const presenceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPresence = React.useCallback(async () => {
    const all = [...presencePending.current]
    presencePending.current.clear()
    if (!all.length) return
    /* One GET of at most 200 ids (URL-length bound); a longer queue re-arms. */
    const batch = all.slice(0, 200)
    for (const id of all.slice(200)) presencePending.current.add(id)
    try {
      const rows = await api.chat.presence(batch)
      const now = Date.now()
      for (const r of rows || []) {
        if (!r?.userId) continue
        const id = String(r.userId)
        presenceFetchedAt.current.set(id, now)
        const next: PresenceEntry = {
          status: (r.status || 'offline') as PresenceStatus,
          lastSeenEpochMs: r.lastSeenEpochMs ?? null,
        }
        /* online → online carries nothing time-varying — skip the write so a
           screenful of online dots doesn't repaint every poll. An OFFLINE
           entry is rewritten even when equal: presenceLine renders "last
           seen Xm ago" against Date.now(), so the write is what advances a
           mounted header's minutes (the web ticks on every flush likewise). */
        const prev = presenceStore.get(id)
        if (prev && prev.status === 'online' && next.status === 'online') continue
        presenceStore.set(id, next)
      }
    } catch {
      /* Presence is decoration — a failure must not surface. Release the
         reservations so the next track/poll retries instead of going dark
         for a full freshness window. */
      for (const id of batch) presenceFetchedAt.current.delete(id)
    }
    if (presencePending.current.size && !presenceTimer.current) {
      presenceTimer.current = setTimeout(() => { presenceTimer.current = null; void flushPresence() }, 220)
    }
  }, [presenceStore])

  const trackPresence = React.useCallback((ids: (string | null | undefined)[]) => {
    const now = Date.now()
    let added = false
    for (const raw of ids) {
      const id = raw ? String(raw) : ''
      if (!id) continue
      const at = presenceFetchedAt.current.get(id)
      if (at != null && now - at < PRESENCE_FRESH_MS) continue   // fresh enough — skip
      presenceFetchedAt.current.set(id, now)                     // reserve: a burst queues once
      presencePending.current.add(id)
      added = true
    }
    if (!added || presenceTimer.current) return
    /* Coalesce a screenful of avatars into one request. */
    presenceTimer.current = setTimeout(() => { presenceTimer.current = null; void flushPresence() }, 220)
  }, [flushPresence])

  /* Re-read every key something on screen still subscribes to (a row's dot,
     the thread header's line). Used by the 30s poll AND by every (re)connect —
     after a background/foreground round trip the map can be minutes stale. */
  const refreshWatchedPresence = React.useCallback(() => {
    const watched = presenceStore.watchedKeys()
    if (!watched.length) return
    const now = Date.now()
    for (const id of watched.slice(0, 200)) {
      presenceFetchedAt.current.set(id, now)
      presencePending.current.add(id)
    }
    void flushPresence()
  }, [presenceStore, flushPresence])

  React.useEffect(() => {
    if (!signedIn) return
    const id = setInterval(() => {
      /* Backgrounded: sockets are torn down and the screens invisible — the
         resume path re-seeds via `connected`, so polling would be waste. */
      if (AppState.currentState !== 'active') return
      refreshWatchedPresence()
    }, PRESENCE_POLL_MS)
    return () => clearInterval(id)
  }, [signedIn, refreshWatchedPresence])

  /* ---------- typing TTL sweeper ----------
     Armed ONLY while somebody is actually typing. A session-long 1.5s interval
     wakes ~57,000 times a day to run Object.entries over an empty map — and it
     keeps doing it while the app is backgrounded, because the streams are
     deliberately left open there and the JS thread is alive with them. Every
     write to the store goes through set/remove, so subscribeAll gives the exact
     empty↔busy edges to arm and disarm on. */
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const sweep = () => {
      const now = Date.now()
      for (const [convId, list] of Object.entries(typingStore.getAll())) {
        const live = list.filter(t => t.expiresAt > now)
        if (live.length === list.length) continue
        if (live.length) typingStore.set(convId, live)
        else typingStore.remove(convId)
      }
    }
    /* Re-entrant by design: sweep's own remove() wakes this, which is what
       stops the interval on the frame the last bubble retires. */
    const arm = () => {
      const busy = Object.keys(typingStore.getAll()).length > 0
      if (busy && !timer) timer = setInterval(sweep, 1500)
      else if (!busy && timer) { clearInterval(timer); timer = null }
    }
    const off = typingStore.subscribeAll(arm)
    arm()
    return () => { off(); if (timer) clearInterval(timer) }
  }, [typingStore])

  /* ---------- background / foreground ----------
     iOS suspends sockets when the app backgrounds. Rather than let them rot
     into a silent-but-open state, re-key the stream effects on resume: the
     reconnect fires `connected`, which bumps `epoch`, which is exactly the
     reconcile every screen already implements.

     But GATED. A two-second app switch is the commonest interaction on a
     phone, and the sockets survive it intact; re-keying anyway spends three
     SSE teardown/redials plus an app-wide REST reconcile (badges, inbox page,
     thread sync, story tray, post reload) on a connection that never dropped.
     So the redial only fires if we were away long enough for the OS to have
     suspended the sockets, or if the chat stream is already known to be down —
     otherwise the resume costs exactly one badge read. */
  const [resumeKey, setResumeKey] = React.useState(0)
  /* Read inside the listener, so the handler is not re-armed on every
     connect/disconnect flip. */
  const connectedRef = React.useRef(connected)
  connectedRef.current = connected
  React.useEffect(() => {
    let last: AppStateStatus = AppState.currentState
    let awayAt = 0
    const sub = AppState.addEventListener('change', next => {
      /* Only 'active' counts: iOS also emits 'inactive' for the app switcher
         and incoming calls, which is not the foreground. */
      if (next === 'active' && last !== 'active') {
        const away = awayAt ? Date.now() - awayAt : Number.POSITIVE_INFINITY
        /* The redial's own onConnected refreshes the badges (l. 541) — calling
           it here too fired chat.unreadCount and notifications.unreadCount
           twice on every resume. On the short path nothing redials, so this is
           the only read. */
        if (away > RESUME_REDIAL_AFTER_MS || !connectedRef.current) setResumeKey(k => k + 1)
        else void refreshBadges()
      } else if (last === 'active' && next !== 'active') {
        awayAt = Date.now()
      }
      last = next
    })
    return () => sub.remove()
  }, [refreshBadges])

  /* ---------- stream 1: chat ---------- */
  React.useEffect(() => {
    if (!signedIn) return
    let stopped = false

    const off = api.chat.stream({
      onConnected: () => {
        if (stopped) return
        setConnected(true)
        /* Every `connected` — first connect AND every auto-reconnect — is the
           signal to reconcile via REST. Presence rides along: it is pull-only
           (the backend never publishes `presence` frames), so whatever is on
           screen re-reads its dots here too — this is what heals the map
           after a background/foreground round trip. */
        setEpoch(e => e + 1)
        void refreshBadges()
        refreshWatchedPresence()
      },
      onError: () => { if (!stopped) setConnected(false) },

      onTyping: (e: any) => {
        if (!e?.conversationId || !e?.userId) return
        const uid = String(e.userId)
        if (user?.id && uid === String(user.id)) return          // never render your own
        const convId = String(e.conversationId)
        const list = (typingStore.get(convId) || []).filter(t => t.userId !== uid)
        if (!e.isTyping) {
          if (list.length) typingStore.set(convId, list)
          else typingStore.remove(convId)
          return
        }
        typingStore.set(convId, [...list, {
          userId: uid,
          activity: e.activity || 'TYPING',
          expiresAt: Date.now() + TYPING_TTL_MS,
        }])
      },

      onPresence: (e: any) => {
        /* Defensive only: the current backend declares the `presence` event
           type but never publishes it (polling above is the real mechanism).
           If a future deploy starts pushing transitions, honour them — and
           stamp freshness so the poll doesn't immediately re-ask. */
        if (!e?.userId) return
        const id = String(e.userId)
        presenceFetchedAt.current.set(id, Date.now())
        presenceStore.set(id, {
          status: (e.status || 'offline') as PresenceStatus,
          lastSeenEpochMs: e.lastSeenEpochMs ?? null,
        })
      },

      onMessage: (e: any) => {
        /* The badge is NOT bumped here. This handler knows only that a frame
           arrived: it cannot see whether the conversation is open, whether the
           app is foregrounded, or whether the message is a duplicate of one
           already counted — and a blind +1 per frame counted every one of
           those, so the tab read "3" over an inbox with nothing unread in it.
           ChatContext applies all three gates (`bump` in applyMessageNew) and
           mirrors its own totalUnread into setChatUnread, which is the same
           number the inbox renders. The absolute reseed via refreshBadges on
           every (re)connect still corrects any drift. */

        /* A delivered message retires its sender's typing bubble NOW — their
           stop ping (or the 6s TTL) arrives seconds after the text is already
           on screen, and "typing…" under a message that just landed reads as
           a ghost (web ChatContext applies the identical rule). */
        const convId = e?.conversationId ? String(e.conversationId) : ''
        const senderId = e?.message?.senderId ? String(e.message.senderId) : ''
        if (convId && senderId) {
          const list = typingStore.get(convId)
          if (list?.some(t => t.userId === senderId)) {
            const live = list.filter(t => t.userId !== senderId)
            if (live.length) typingStore.set(convId, live)
            else typingStore.remove(convId)
          }
        }
        fan(chatSubs, e)
      },

      onAny: (e: any) => {
        /* onMessage already fanned; everything else routes here once. */
        if (e?.type !== 'message.new') fan(chatSubs, e)
      },
    })

    return () => { stopped = true; setConnected(false); off?.() }
  }, [signedIn, user?.id, refreshBadges, refreshWatchedPresence, resumeKey, presenceStore, typingStore])

  /* ---------- stream 2: notifications ---------- */
  React.useEffect(() => {
    if (!signedIn) return
    const off = api.notifications.subscribe({
      /* This stream reconnects on its own (45s watchdog + token heal in
         notifications.js), independently of the chat stream that drives
         `epoch` — so its `connected` must reach subscribers too: every
         (re)connect is the consumer's "re-read via REST" signal
         (overview.md §3/§7). */
      onConnected: () => { void refreshBadges(); fan(notifSubs, { type: 'connected' }) },
      /* `unread-count` is authoritative — the one counter that is NOT a delta. */
      onUnreadCount: (n: any) => {
        const count = typeof n === 'number' ? n : n?.count
        if (typeof count === 'number') setNotificationUnread(count)
      },
      onNotification: (n: any) => {
        fan(notifSubs, { type: 'notification', notification: n })
        /* Backgrounded: surface the row as an OS banner (sounded via the
           default channel). The raw SSE row carries title + body except when
           coalesced — and a coalesced re-delivery is a refresh of something
           already announced, so absent title = no banner, by design. */
        if (AppState.currentState !== 'active' && n?.title) {
          /* STREAM_STARTED ("X is live") gets its own channel/sound — every
             other kind (system, channel, research, QNA, social…) rides the
             general default channel. */
          const notify = n.type === 'STREAM_STARTED' ? notifyLive : notifyGeneric
          notify({
            title: String(n.title),
            body: n.body ? String(n.body) : undefined,
            href: '/notifications',
            id: n.id != null ? String(n.id) : undefined,
          })
        } else if (n?.title) {
          /* Foreground: the in-app pop-up, so the bell ringing somewhere in
             the app is visible from ANY screen, not only the inbox. */
          showInAppBanner({
            key: `ntf-${n.id ?? n.title}`,
            kind: 'notification',
            title: String(n.title),
            body: n.body ? String(n.body) : null,
            seed: n.id != null ? String(n.id) : null,
            href: '/notifications',
          })
        }
      },
      onRead: (e: any) => fan(notifSubs, { type: 'read', ...e }),
      onDeleted: (e: any) => fan(notifSubs, { type: 'deleted', ...e }),
      /* FEED_NEW_POST rides this same socket but is NOT an inbox row — the
         home feed turns it into a quiet "New posts" pill. Fanning it to
         onNotification as well would double-count every new post. */
      onFeedNewPost: (e: any) => fan(notifSubs, { type: 'feed-new-post', ...e }),
    })
    return () => off?.()
  }, [signedIn, refreshBadges, resumeKey])

  /* ---------- stream 3: story tray ---------- */
  React.useEffect(() => {
    if (!signedIn) return
    const off = api.stories.trayStream({
      /* Like the notifications stream, the tray socket reconnects on its own
         (10-min server timeout redials included) independently of the chat
         stream that drives `epoch` — so its `connected` must reach tray
         subscribers directly: every (re)connect is their "re-read the tray
         via REST" signal (realtime.md reconnection checklist). */
      onConnected: () => fan(traySubs, { type: 'connected' }),
      onNewStory: (e: any) => fan(traySubs, { type: 'new_story', ...e }),
      onStoryRemoved: (e: any) => fan(traySubs, { type: 'story_removed', ...e }),
      onPollVote: (e: any) => fan(traySubs, { type: 'poll_vote_cast', ...e }),
    })
    return () => off?.()
  }, [signedIn, resumeKey])

  /* Signing out must clear every derived surface, or the next user briefly
     sees the previous one's badges. */
  React.useEffect(() => {
    if (signedIn) return
    setChatUnread(0); setNotificationUnread(0)
    setConnected(false)
    presenceStore.clear(); typingStore.clear()
    presenceFetchedAt.current.clear(); presencePending.current.clear()
    if (presenceTimer.current) { clearTimeout(presenceTimer.current); presenceTimer.current = null }
  }, [signedIn, presenceStore, typingStore])

  const subscribeChat = React.useCallback((fn: (e: ChatEvent) => void) => {
    chatSubs.current.add(fn)
    return () => { chatSubs.current.delete(fn) }
  }, [])
  const subscribeNotifications = React.useCallback((fn: (e: NotificationEvent) => void) => {
    notifSubs.current.add(fn)
    return () => { notifSubs.current.delete(fn) }
  }, [])
  const subscribeStoryTray = React.useCallback((fn: (e: any) => void) => {
    traySubs.current.add(fn)
    return () => { traySubs.current.delete(fn) }
  }, [])

  /* Everything here is session-stable (refreshBadges pivots on signedIn, the
     rest never changes), so this value survives every frame untouched and
     ApiCtx consumers never re-render from realtime traffic. */
  const apiValue = React.useMemo<RealtimeApi>(() => ({
    setChatUnread, setNotificationUnread, refreshBadges, trackPresence,
    subscribeChat, subscribeNotifications, subscribeStoryTray,
    presenceStore, typingStore,
  }), [
    refreshBadges, trackPresence, subscribeChat, subscribeNotifications,
    subscribeStoryTray, presenceStore, typingStore,
  ])

  const connectionValue = React.useMemo<RealtimeConnection>(
    () => ({ connected, epoch }),
    [connected, epoch],
  )

  return (
    <ApiCtx.Provider value={apiValue}>
      <ConnectionCtx.Provider value={connectionValue}>
        <ChatUnreadCtx.Provider value={chatUnread}>
          <NotificationUnreadCtx.Provider value={notificationUnread}>{children}</NotificationUnreadCtx.Provider>
        </ChatUnreadCtx.Provider>
      </ConnectionCtx.Provider>
    </ApiCtx.Provider>
  )
}
