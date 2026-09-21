/* =========================================================
   Chat context — the inbox, requests and unread state.

   PORTED FROM THE WEB APP, WITH ONE ARCHITECTURAL CHANGE.

   On the web this file owned the /messaging/stream socket. It
   cannot here: RealtimeContext already holds that socket for
   the whole session, and the backend caps a user at FIVE
   emitters with LRU eviction — a second one would silently
   evict the app's own. So this subscribes to the shell's
   fan-out instead, and presence + typing stay in the shell —
   a row that shows a dot or a bubble subscribes to its own key
   via usePresence()/useTyping() rather than through here.

   Everything else is the web logic, preserved deliberately:

   DELTA MODEL. SSE events carry no counters. The client applies
   ±1 locally and RE-SEEDS the absolute unread total from
   GET /messaging/unread-count on mount and on every (re)connect
   — a delta-only badge drifts across a disconnect, and the
   reseed is the correction.

   DISAPPEARING MESSAGES. The server never puts a vanishing
   message's text in the inbox preview or a push notification.
   The client derives its own preview from the `message.new`
   payload, so without the same substitution it writes the
   vanishing text into the rail, where it outlives the message
   it came from.
   ========================================================= */
import React from 'react'
import { AppState } from 'react-native'
import { useSegments } from 'expo-router'
import { api } from '@/api'
import { maxId, cmpId, gtId, isNotFound } from '@/api'
import { useAuth } from './AuthContext'
import {
  createKeyedStore, useChatEvents, useRealtimeApi, useRealtimeConnection,
  type ChatEvent, type KeyedStore,
} from './RealtimeContext'
import {
  isTerminalCall, latestCallByConvo, latestCallForConvo, logFromCall,
  logFromMissedNotification, mergeCallLog, type CallLogEntry,
} from '@/components/call/callStore'
import { callAtMs, callRowPreview, callWasMissed } from '@/components/call/callSummary'
import { chatError } from '@/lib/chatErrors'
import { chime } from '@/lib/chime'
import { onIdle } from '@/lib/idle'
import { notifyMessage } from '@/lib/pushNotify'
import { showInAppBanner } from '@/components/system/InAppBanner'
import { toast } from '@/ui'

/** Inbox page size. The rail pages on scroll rather than capping at one page. */
const PAGE_SIZE = 30

/** Match the server's wording exactly — see the header note. The backend's
 *  placeholder is "🕓 Disappearing message" (messages.md §as-built;
 *  MessageService.disappearingPreview), so the client-derived preview must be
 *  the same string or the rail flips wording on the next inbox refetch. */
const DISAPPEARING_PREVIEW = '🕓 Disappearing message'

export interface ChatSettings {
  readReceiptsEnabled: boolean
  lastSeenVisible: boolean
  typingIndicatorsEnabled: boolean
}

/* The value is split across four contexts, by how often each changes and who
   reads it: actions (identity churns only on pagination cursors — safe for
   dispatch-only callers and effect arrays), settings (rarely), requests
   (request traffic only) and the inbox lists (every message, every receipt).
   A thread screen reads the first three plus ITS row via useConversation()
   and never renders for another conversation's traffic; useChat() composes
   everything for the legacy surface. */

export interface ChatInbox {
  ready: boolean
  connected: boolean
  loading: boolean
  error: any

  conversations: any[]
  archived: any[]
  totalUnread: number
  inboxHasMore: boolean
  archivedHasMore: boolean
  inboxLoadingMore: boolean
}

export interface ChatRequests {
  requests: any[]
  requestCount: number
}

export interface ChatData extends ChatInbox, ChatRequests {
  chatSettings: ChatSettings
}

export interface ChatActions {
  setChatPrivacy: (patch: Partial<ChatSettings>) => Promise<void>

  getConvo: (id: string) => any
  refreshInbox: () => Promise<void>
  loadMoreInbox: () => Promise<void>
  loadArchived: () => Promise<void>
  loadMoreArchived: () => Promise<void>
  loadRequests: () => Promise<void>

  markRead: (convId: string, lastMessageId?: string | null) => Promise<void>
  markUnread: (convId: string) => Promise<void>
  /** REST answered one of MY sends — stamp the rail row now rather than
   *  waiting on the `message.new` echo (which covers it moments later, but
   *  not at all while the socket is down). */
  noteOutgoing: (convId: string, message: any) => void
  togglePin: (convId: string) => Promise<void>
  toggleMute: (convId: string, mutedUntil?: string | null) => Promise<void>
  toggleArchive: (convId: string) => Promise<void>
  deleteConvo: (convId: string) => Promise<void>
  /** Drop a conversation from my lists around a write that ends my membership
   *  — leave a group, unsubscribe from a channel, delete a channel. The screen
   *  owns the endpoint (three of them, across two api modules); this owns the
   *  lists, the unread badge and the rollback. Same contract as deleteConvo:
   *  optimistic, restored on failure, and RETHROWN so a caller that navigates
   *  away on success cannot navigate away on a failure. */
  dropConvo: (convId: string, write: () => Promise<any>, failure?: string | null) => Promise<void>
  setDisappearing: (convId: string, seconds: number) => Promise<void>
  /** Both take the messageRequestId (NOT the conversationId — distinct
   *  fields on MessageRequestResponse, message-requests.md). */
  acceptRequest: (requestId: string) => Promise<void>
  declineRequest: (requestId: string, block?: boolean) => Promise<void>

  /** Absolute re-seed of the unread badge, for callers that ALREADY hold a
   *  fresh count — pull-to-refresh runs `unreadCount()` as its offline probe,
   *  so it hands the answer in rather than paying for a second request. The
   *  delta model asks for exactly this correction after a manual pull. */
  setUnreadCount: (n: number) => void

  /** Which conversation is open, so its arrivals do not bump the badge. */
  setActiveConversation: (id: string | null) => void
  /** Subscribe to the raw chat firehose — the open thread uses this. */
  subscribe: (fn: (e: ChatEvent) => void) => () => void

  trackPresence: (ids: (string | null | undefined)[]) => void
  sendTyping: (convId: string, isTyping: boolean, activity?: string) => void

  /** A stage invite that arrived while the user was elsewhere in the app. */
  takeStageInvite: (streamId: string) => any

  /** conversationId → its inbox/archived row, mirrored from the lists. Read
   *  one row via useConversation(); the store itself rides the stable actions
   *  surface the way presenceStore rides RealtimeApi. */
  convoStore: KeyedStore<any>

  /** conversationId → the newest message id this device must treat as CLEARED,
   *  mirroring the server's per-member `clearedBeforeMessageId`
   *  (ConversationService.deleteForMe). "Delete chat" on a DM or a non-owner
   *  group is a per-user clear + hide: the server floors every later read at
   *  that id, so anything already in a client store at or below it is a
   *  message the account can no longer see. Written by deleteConvo, read by
   *  useThread through useClearedFloor(). Never cleared on its own — the
   *  server's floor is permanent too, which is what stops a resurfaced thread
   *  showing history from before the delete. */
  clearedStore: KeyedStore<string>
}

export interface ChatValue extends ChatData, ChatActions {}

const InboxCtx = React.createContext<ChatInbox | null>(null)
const RequestsCtx = React.createContext<ChatRequests | null>(null)
const SettingsCtx = React.createContext<ChatSettings | null>(null)
const ChatActionsCtx = React.createContext<ChatActions | null>(null)

export function useChat(): ChatValue {
  const d = useChatData()
  const a = useChatActions()
  return React.useMemo(() => ({ ...d, ...a }), [d, a])
}

/** Actions only. Identity changes rarely (pagination cursors), never on
 *  message/typing/presence traffic — safe for effect dependency arrays. */
export function useChatActions(): ChatActions {
  const a = React.useContext(ChatActionsCtx)
  if (!a) throw new Error('useChatActions() outside <ChatProvider>')
  return a
}

/** The rail's surface: both lists and everything paging them. Re-renders on
 *  every message and receipt — that is its job; nothing else should pay it. */
export function useChatInbox(): ChatInbox {
  const v = React.useContext(InboxCtx)
  if (!v) throw new Error('useChatInbox() outside <ChatProvider>')
  return v
}

export function useChatRequests(): ChatRequests {
  const v = React.useContext(RequestsCtx)
  if (!v) throw new Error('useChatRequests() outside <ChatProvider>')
  return v
}

export function useChatSettings(): ChatSettings {
  const v = React.useContext(SettingsCtx)
  if (!v) throw new Error('useChatSettings() outside <ChatProvider>')
  return v
}

/** The legacy full-data surface — subscribes to all three data contexts. */
export function useChatData(): ChatData {
  const inbox = useChatInbox()
  const requests = useChatRequests()
  const chatSettings = useChatSettings()
  return React.useMemo(
    () => ({ ...inbox, ...requests, chatSettings }),
    [inbox, requests, chatSettings],
  )
}

/** One conversation's live row, re-rendering only when THAT row changes —
 *  what the thread screen reads instead of scanning the inbox arrays. Null
 *  until the row is loaded (deep link past page one); the screen's own GET
 *  covers that window. */
export function useConversation(convId?: string | null): any {
  const { convoStore } = useChatActions()
  const key = convId ? String(convId) : ''
  const subscribe = React.useCallback(
    (fn: () => void) => (key ? convoStore.subscribeKey(key, fn) : () => {}),
    [convoStore, key],
  )
  const read = React.useCallback(
    () => (key ? convoStore.get(key) ?? null : null),
    [convoStore, key],
  )
  return React.useSyncExternalStore(subscribe, read)
}

/** This device's clear floor for one conversation — the mirror of the server's
 *  `clearedBeforeMessageId`. `null` means nothing is hidden. Everything that
 *  writes messages into a store must gate on it, or a listener frame or an
 *  already-loaded page puts a cleared message back on screen. */
export function useClearedFloor(convId?: string | null): string | null {
  const { clearedStore } = useChatActions()
  const key = convId ? String(convId) : ''
  const subscribe = React.useCallback(
    (fn: () => void) => (key ? clearedStore.subscribeKey(key, fn) : () => {}),
    [clearedStore, key],
  )
  const read = React.useCallback(
    () => (key ? clearedStore.get(key) ?? null : null),
    [clearedStore, key],
  )
  return React.useSyncExternalStore(subscribe, read)
}

/** A conversation's last ACTIVITY: its newest message or its newest finished
 *  call, whichever came last. A call is not a message — the server writes no
 *  row for one — but it is the last thing that happened in the thread, and an
 *  inbox that ignored it would sink a call you took two minutes ago below a
 *  chat nobody has opened since Tuesday. */
function activityAt(c: any): number {
  const msg = c._lastAtMs ?? (c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0)
  return Math.max(msg || 0, c._callAtMs || 0)
}

/** Inbox order: pinned first, then newest activity (id as tiebreak).
 *  Compares the numeric `_lastAtMs` stamp so a sort never re-parses ISO dates
 *  per comparison; the Date.parse fallback covers rows not yet stamped. */
function byRecency(a: any, b: any) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  const ta = activityAt(a)
  const tb = activityAt(b)
  if (tb !== ta) return tb - ta
  /* Ids are Snowflake strings — subtracting them coerces to lossy doubles and
     ties (same millisecond) would then order arbitrarily. cmpId is exact. */
  return cmpId(b.lastMessageId, a.lastMessageId)
}

/** The three fields a finished call adds to an inbox row. Kept SEPARATE from
 *  `lastMessage*`: the call is not the last message, it only outranks it
 *  while no one has said anything since — which is a comparison the row makes
 *  for itself, and which reverses the moment the next message lands. */
function callStamp(entry: CallLogEntry | null | undefined) {
  if (!entry || !isTerminalCall(entry.status)) return null
  const at = callAtMs(entry)
  if (!at) return null
  return { _callAtMs: at, lastCallPreview: callRowPreview(entry), lastCallMissed: callWasMissed(entry) }
}

/** Stamp `_lastAtMs` once where a server row enters, so byRecency stays
 *  parse-free on the hot path (one inbox sort used to cost hundreds of
 *  Date.parse calls per SSE frame). `calls` is the whole log folded into one
 *  map by the caller — a server row carries nothing about calls, so without
 *  re-stamping here every refetch would drop the call line from the rail. */
function stampRecency(c: any, calls?: Map<string, CallLogEntry>) {
  const row = { ...c, _lastAtMs: c.lastMessageAt ? Date.parse(c.lastMessageAt) : 0 }
  const stamp = calls ? callStamp(calls.get(String(c.id))) : null
  return stamp ? { ...row, ...stamp } : row
}

/* The kind labels are the SERVER's exact strings (MessageService.previewOf:
   "📷 Photo" …), so a preview derived from a live frame and one refetched from
   the inbox render identically. */
const KIND_PREVIEW: Record<string, string> = {
  IMAGE: '📷 Photo', VIDEO: '🎥 Video', VOICE: '🎤 Voice message',
  AUDIO: '🎵 Audio', FILE: '📎 File',
  /* The server's switch also carries these three (MessageService.previewOf)
     — a live poll frame used to derive '' here while the refetched row said
     '📊 Poll', so the rail flickered between "empty" and the truth. LOCATION
     and CONTACT are '' on the SERVER too; the row's own fallback carries
     those (ConversationRow). */
  POLL: '📊 Poll', GIF: 'GIF', STICKER: 'Sticker',
}

function previewOf(m: any, ephemeral: boolean): string {
  if (!m) return ''
  const kind = m.media?.[0]?.kind || m.type
  if (ephemeral) {
    /* Mirror MessageService.disappearingPreview: the media KIND may show, the
       body never — a vanishing message must not outlive itself in the rail. */
    return KIND_PREVIEW[kind] || DISAPPEARING_PREVIEW
  }
  if (m.body) return m.body
  return KIND_PREVIEW[kind] || ''
}

/* Throttle: the docs ask for at most one typing POST every ~3s, resent when
   the activity verb changes. */
const TYPING_THROTTLE_MS = 3000

/* useSegments re-renders its caller on EVERY navigation, and the provider
   only ever reads the value through a ref (the live-room check) — so the
   subscription lives in this renderless sibling instead of re-running the
   whole provider per route change. */
function SegmentsMirror({ into }: { into: React.MutableRefObject<string[]> }) {
  const segments = useSegments()
  React.useEffect(() => { into.current = segments }, [segments, into])
  return null
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, signedIn } = useAuth()
  const { connected, epoch } = useRealtimeConnection()
  const { trackPresence, setChatUnread } = useRealtimeApi()

  const [ready, setReady] = React.useState(false)
  const [conversations, setConversations] = React.useState<any[]>([])
  const [archived, setArchivedList] = React.useState<any[]>([])
  const [requests, setRequests] = React.useState<any[]>([])
  const [totalUnread, setTotalUnread] = React.useState(0)
  const [requestCount, setRequestCount] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [inboxHasMore, setInboxHasMore] = React.useState(false)
  const [archivedHasMore, setArchivedHasMore] = React.useState(false)
  const [inboxLoadingMore, setInboxLoadingMore] = React.useState(false)

  /* A user with no saved row behaves as ALL-ON, so this optimistic default
     matches the server and needs no write. Read app-wide because both signals
     are SYMMETRIC — with receipts off you neither send nor see them, so the UI
     must stop promising a tick it will never get. */
  const [chatSettings, setChatSettings] = React.useState<ChatSettings>({
    readReceiptsEnabled: true, lastSeenVisible: true, typingIndicatorsEnabled: true,
  })

  const [convoStore] = React.useState(() => createKeyedStore<any>())
  const [clearedStore] = React.useState(() => createKeyedStore<string>())

  const convosRef = React.useRef<any[]>([])
  const archivedRef = React.useRef<any[]>([])
  const requestsRef = React.useRef<any[]>([])
  const requestsLoadedRef = React.useRef(false)
  const inboxPageRef = React.useRef(0)
  const archivedPageRef = React.useRef(0)
  const inboxLoadingRef = React.useRef(false)
  const archivedLoadingRef = React.useRef(false)
  const myIdRef = React.useRef<string | null>(null)
  const activeIdRef = React.useRef<string | null>(null)
  const seenRef = React.useRef(new Set<string>())
  const subscribersRef = React.useRef(new Set<(e: ChatEvent) => void>())
  const stageInvitesRef = React.useRef(new Map<string, { member: any; at: number }>())
  const typingSentRef = React.useRef(new Map<string, { at: number; activity: string }>())
  const settingsRef = React.useRef(chatSettings)
  const segmentsRef = React.useRef<string[]>([])

  React.useEffect(() => { convosRef.current = conversations }, [conversations])
  React.useEffect(() => { archivedRef.current = archived }, [archived])

  /* Mirror the two lists into the keyed store, diffed by ROW identity: every
     mutator below rewrites only the rows it touched, so this wakes exactly
     the conversations that changed — a message in one thread never repaints
     another thread's screen. One choke point rather than a write per mutator,
     so no path (present or future) can forget the store; the mirror lands
     post-commit, one frame behind the arrays at worst. */
  React.useEffect(() => {
    const present = new Set<string>()
    for (const list of [conversations, archived]) {
      for (const c of list) {
        const key = String(c.id)
        if (present.has(key)) continue
        present.add(key)
        if (convoStore.get(key) !== c) convoStore.set(key, c)
      }
    }
    for (const key of Object.keys(convoStore.getAll())) {
      if (!present.has(key)) convoStore.remove(key)
    }
  }, [conversations, archived, convoStore])
  React.useEffect(() => { requestsRef.current = requests }, [requests])
  React.useEffect(() => { myIdRef.current = user?.id ? String(user.id) : null }, [user])
  React.useEffect(() => { settingsRef.current = chatSettings }, [chatSettings])

  /* A conversation can live in EITHER list. Several web call sites searched
     only the inbox, so acting on an archived thread silently found nothing and
     skipped its badge bookkeeping. Every lookup goes through here. */
  const findConvo = React.useCallback(
    (id: string) => convosRef.current.find(x => String(x.id) === String(id))
      || archivedRef.current.find(x => String(x.id) === String(id))
      || null,
    [],
  )

  /* ---------------- loaders ---------------- */

  const refreshInbox = React.useCallback(async () => {
    try {
      const res: any = await api.chat.conversations.list({ page: 0, size: PAGE_SIZE })
      const calls = latestCallByConvo()
      /* List rows never carry the peer receipt markers (only the single GET
         does — ChatMapper's inbox mapper passes null) — so a wholesale replace
         here would roll every open thread's "Seen" tick back to "Sent" on each
         reconnect. Fold the markers forward from the rows being replaced. */
      setConversations(prev => {
        const held = new Map(prev.map(c => [String(c.id), c]))
        return res.items.map((c: any) => {
          const old = held.get(String(c.id))
          return stampRecency(old
            ? {
              ...c,
              peerLastReadMessageId: maxId(old.peerLastReadMessageId, c.peerLastReadMessageId),
              peerLastDeliveredMessageId: maxId(old.peerLastDeliveredMessageId, c.peerLastDeliveredMessageId),
            }
            : c, calls)
        /* The server orders by last MESSAGE; a thread whose last activity was
           a call has to be re-placed against that order here. */
        }).sort(byRecency)
      })
      inboxPageRef.current = 0
      setInboxHasMore(!!res.hasMore)
    } catch (e) {
      toast.warn(chatError(e, 'Could not refresh your chats'))
    }
  }, [])

  const loadMoreInbox = React.useCallback(async () => {
    if (inboxLoadingRef.current || !inboxHasMore) return
    inboxLoadingRef.current = true
    setInboxLoadingMore(true)
    try {
      const next = inboxPageRef.current + 1
      const res: any = await api.chat.conversations.list({ page: next, size: PAGE_SIZE })
      const calls = latestCallByConvo()
      inboxPageRef.current = next
      setInboxHasMore(!!res.hasMore)
      setConversations(prev => {
        const have = new Set(prev.map(c => String(c.id)))
        return [
          ...prev,
          ...res.items.filter((c: any) => !have.has(String(c.id))).map((c: any) => stampRecency(c, calls)),
        ].sort(byRecency)
      })
    } catch (e) {
      toast.warn(chatError(e, 'Could not load more conversations'))
    } finally {
      inboxLoadingRef.current = false
      setInboxLoadingMore(false)
    }
  }, [inboxHasMore])

  const loadArchived = React.useCallback(async () => {
    if (archivedLoadingRef.current) return
    archivedLoadingRef.current = true
    try {
      const res: any = await api.chat.conversations.archived({ page: 0, size: PAGE_SIZE })
      const calls = latestCallByConvo()
      setArchivedList(res.items.map((c: any) => stampRecency(c, calls)))
      archivedPageRef.current = 0
      setArchivedHasMore(!!res.hasMore)
    } catch (e) {
      toast.warn(chatError(e, 'Could not load archived chats'))
    } finally {
      archivedLoadingRef.current = false
    }
  }, [])

  const loadMoreArchived = React.useCallback(async () => {
    if (archivedLoadingRef.current || !archivedHasMore) return
    archivedLoadingRef.current = true
    try {
      const next = archivedPageRef.current + 1
      const res: any = await api.chat.conversations.archived({ page: next, size: PAGE_SIZE })
      const calls = latestCallByConvo()
      archivedPageRef.current = next
      setArchivedHasMore(!!res.hasMore)
      setArchivedList(prev => {
        const have = new Set(prev.map(c => String(c.id)))
        return [
          ...prev,
          ...res.items.filter((c: any) => !have.has(String(c.id))).map((c: any) => stampRecency(c, calls)),
        ]
      })
    } catch (e) {
      toast.warn(chatError(e, 'Could not load more archived chats'))
    } finally {
      archivedLoadingRef.current = false
    }
  }, [archivedHasMore])

  const loadRequests = React.useCallback(async () => {
    try {
      const res: any = await api.chat.requests.list({ page: 0, size: PAGE_SIZE })
      setRequests(res.items)
      requestsLoadedRef.current = true
      setRequestCount(res.total ?? res.items.length)
    } catch (e) {
      toast.warn(chatError(e, 'Could not load message requests'))
    }
  }, [])

  const reseedUnread = React.useCallback(() => {
    api.chat.unreadCount().then(setTotalUnread).catch(() => {})
  }, [])

  /* ---------------- conversation mutators ---------------- */

  const upsertConvo = React.useCallback((convo: any) => {
    if (!convo) return
    /* One row, so one lookup rather than folding the whole log into a map. */
    const stamp = callStamp(latestCallForConvo(convo.id))
    const row = { ...stampRecency(convo), ...(stamp || null) }
    if (row.archived) {
      setArchivedList(prev => [row, ...prev.filter(c => c.id !== row.id)])
      setConversations(prev => prev.filter(c => c.id !== row.id))
      return
    }
    setConversations(prev => [row, ...prev.filter(c => c.id !== row.id)].sort(byRecency))
  }, [])

  /* `resort` is opt-in: of every caller only togglePin patches a key
     (`pinned`) that byRecency orders by, and the receipt/preview/badge
     patches were paying an O(n log n) sort + per-comparison date maths on
     every SSE frame for an order that could not have changed. */
  const patchConvo = React.useCallback((id: string, patch: any, { resort = false } = {}) => {
    setConversations(prev => {
      const next = prev.map(c => (String(c.id) === String(id) ? { ...c, ...patch } : c))
      return resort ? next.sort(byRecency) : next
    })
    setArchivedList(prev => prev.map(c => (String(c.id) === String(id) ? { ...c, ...patch } : c)))
  }, [])

  const removeConvo = React.useCallback((id: string) => {
    const c = findConvo(id)
    const dec = c?.unreadCount || 0
    if (dec) setTotalUnread(t => Math.max(0, t - dec))
    setConversations(prev => prev.filter(x => String(x.id) !== String(id)))
    setArchivedList(prev => prev.filter(x => String(x.id) !== String(id)))
  }, [findConvo])

  const getConvo = React.useCallback((id: string) => findConvo(id), [findConvo])

  /* ---------------- calls in the rail ----------------

     A call leaves NO message behind (calls.md — there is not even a history
     endpoint), so a conversation whose last event was a call used to fall
     back to whatever was said before it: end a ten-minute call and the inbox
     still quotes yesterday's "ok", at yesterday's time, in yesterday's place
     in the list. The record is the device-local call log, and these two
     write it onto the row the way a message writes itself onto one. */

  const applyCall = React.useCallback((convId: string, entry: CallLogEntry | null) => {
    const stamp = callStamp(entry)
    /* `resort`: a finished call is new activity, so the row moves — the one
       other patch that reorders the rail. */
    if (stamp) patchConvo(convId, stamp, { resort: true })
  }, [patchConvo])

  /* Re-read the log for every loaded row. Used after rows arrive from the
     server (which knows nothing about calls) and after missed calls are
     folded in from their notifications. */
  const restampCalls = React.useCallback(() => {
    const calls = latestCallByConvo()
    if (!calls.size) return
    const apply = (list: any[]) => {
      let touched = false
      const next = list.map(c => {
        const stamp = callStamp(calls.get(String(c.id)))
        /* Identity is the memo the whole inbox rides on — only rows whose
           call line actually moved may be replaced. */
        if (!stamp || (c._callAtMs === stamp._callAtMs && c.lastCallPreview === stamp.lastCallPreview)) return c
        touched = true
        return { ...c, ...stamp }
      })
      return touched ? next : list
    }
    setConversations(prev => {
      const next = apply(prev)
      return next === prev ? prev : next.sort(byRecency)
    })
    setArchivedList(apply)
  }, [])

  /* A receipt for a row we do not hold (deep link past inbox page one, or an
     archived thread before loadArchived ran) would otherwise be dropped — and
     if that thread is OPEN, its ticks never flip while the user watches. Only
     the open thread warrants the GET: everywhere else the authoritative
     markers arrive with whichever fetch eventually loads the row. The
     in-flight set collapses a receipt burst into one GET. */
  const receiptPullRef = React.useRef(new Set<string>())
  const pullConvoForReceipt = React.useCallback((convId: string) => {
    const key = String(convId)
    if (key !== String(activeIdRef.current)) return
    if (receiptPullRef.current.has(key)) return
    receiptPullRef.current.add(key)
    api.chat.conversations.get(convId)
      .then((c: any) => { if (c) upsertConvo(c) })
      .catch(() => {})
      .finally(() => { receiptPullRef.current.delete(key) })
  }, [upsertConvo])

  /* ---------------- message.new → delta + reorder ---------------- */

  const applyMessageNew = React.useCallback((conversationId: string, message: any) => {
    if (!message) return
    /* A frame at or below this device's clear floor is a message the server
       will not hand back on any read (MessageQueryService.floorMessageId), so
       it must not reach the rail either — a late echo of an already-cleared
       message would otherwise resurrect the preview, the unread bump and the
       chime for a conversation the user deleted. New sends always carry a
       larger Snowflake, so the live path is untouched. */
    const floor = clearedStore.get(String(conversationId)) ?? null
    if (floor && message.id != null && !gtId(String(message.id), floor)) return
    const id = message.id
    const isNew = id != null && !seenRef.current.has(String(id))
    if (isNew) {
      seenRef.current.add(String(id))
      if (seenRef.current.size > 500) {
        seenRef.current.delete(seenRef.current.values().next().value as string)
      }
    }
    const mine = String(message.senderId) === String(myIdRef.current)
    /* "Active" means OPEN AND IN THE FOREGROUND. The thread's read marker
       refuses to fire while the app is backgrounded — you cannot read what you
       cannot see — so counting a backgrounded thread as active would drop the
       message from the badge AND leave it unread on the server. */
    const visible = AppState.currentState === 'active'
    const open = String(conversationId) === String(activeIdRef.current)
    const active = open && visible
    const bump = isNew && !mine && !active

    /* The chime rides the same gate as the badge. Mute silences the chime the
       way it silences push — but not the count: an unknown conversation cannot
       be muted, because nobody mutes a stranger before their first message. */
    if (bump) {
      const row = convosRef.current.find(c => String(c.id) === String(conversationId))
      if (!row?.muted) chime('message')
    }

    /* Foreground but ELSEWHERE in the app: the in-app pop-up is the visual
       the chime alone was not — a message must not land invisibly behind
       another screen. Same mute gate; `bump` already excludes the open
       thread and own echoes. */
    if (bump && visible) {
      const row = findConvo(conversationId)
      if (!row?.muted) {
        showInAppBanner({
          key: `chat-${conversationId}`,
          kind: 'message',
          title: row?.displayTitle || 'New message',
          body: previewOf(message, (row?.disappearingSeconds || 0) > 0),
          avatar: row?._author?.profileImage ?? row?.peer?.profileImage ?? null,
          seed: String(conversationId),
          href: `/chat/${conversationId}`,
        })
      }
    }

    /* Backgrounded arrival: the OS banner is the only surface the user can
       see, so the stream presents one locally (sounded via the messages
       channel). Same mute gate as the chime; the preview already respects
       the disappearing rule through previewOf. */
    if (isNew && !mine && !visible) {
      const row = findConvo(conversationId)
      if (!row?.muted) {
        notifyMessage({
          title: row?.displayTitle || 'New message',
          body: previewOf(message, (row?.disappearingSeconds || 0) > 0) || 'New message',
          conversationId: String(conversationId),
          messageId: id != null ? String(id) : undefined,
        })
      }
    }

    /* Delivered receipt for a conversation I am NOT looking at. The open
       thread acks its own arrivals; without this, everything landing in a
       closed conversation stays single-tick for the sender until I open it.
       Keyed on `open`, not `active` — the open thread acks even while
       backgrounded, and sending both would duplicate the receipt. */
    if (isNew && !mine && !open && id != null) {
      api.chat.messages.delivered(id).catch(() => {})
    }

    const known = convosRef.current.some(c => String(c.id) === String(conversationId))
    if (!known) {
      /* A still-PENDING request thread is EXCLUDED from the main inbox
         (conversations.md §GET /conversations; its messages reach us as
         `message.new` all the same) — it belongs to the Requests tray, so it
         must not be pulled into the rail here. */
      const pendingRequest = requestsRef.current.some(r =>
        String(r.conversationId) === String(conversationId) && r.status === 'PENDING')
      if (pendingRequest) return
      /* Someone we do not hold yet just messaged us — pull the row in. */
      api.chat.conversations.get(conversationId).then((c: any) => { if (c) upsertConvo(c) }).catch(() => {})
      if (bump) setTotalUnread(t => t + 1)
      return
    }
    if (bump) setTotalUnread(t => t + 1)
    setConversations(prev => prev.map(c => (
      String(c.id) === String(conversationId)
        ? {
          ...c,
          lastMessageId: id ?? c.lastMessageId,
          lastMessageAt: message.createdAt || c.lastMessageAt,
          /* ConversationResponse carries no sender for its last message, so
             this live stamp is the ONLY source of ConversationRow's "You:"
             prefix — the row renders it exactly where it is knowable. */
          lastMessageSenderId: message.senderId ?? c.lastMessageSenderId,
          /* `c` is the row being rewritten, so its own timer is the right one
             to read — and reading it INSIDE the updater keeps it correct even
             if the timer changed in the same tick. */
          lastMessagePreview: previewOf(message, (c.disappearingSeconds || 0) > 0),
          unreadCount: bump ? (c.unreadCount || 0) + 1 : c.unreadCount,
          hasUnread: bump ? true : c.hasUnread,
          _lastAtMs: message.createdAt ? Date.parse(message.createdAt) : c._lastAtMs,
        }
        : c
    )).sort(byRecency))
  }, [upsertConvo, findConvo, clearedStore])

  /* ---------------- boot seed ---------------- */

  React.useEffect(() => {
    if (!signedIn) {
      setReady(true)
      setConversations([]); setArchivedList([]); setRequests([])
      setTotalUnread(0); setRequestCount(0)
      /* The floors belong to the account that set them — a second account on
         the same device must not inherit them. */
      clearedStore.clear()
      return
    }
    let alive = true
    setLoading(true)

    /* The two badge counters are all the FIRST screen needs — the tab bar.
       They go out immediately; failures fall back to the reconnect reseed. */
    Promise.all([api.chat.requests.count(), api.chat.unreadCount()])
      .then(([rc, uc]: any[]) => {
        if (!alive) return
        setRequestCount(rc)
        setTotalUnread(uc)
      })
      .catch(() => {})

    /* The inbox page and the privacy settings are Chat-tab data, and parsing
       30 rows on the JS thread used to land exactly while Home's first
       FlashList measure ran. They wait for the first frame with slack in it
       (lib/idle); a user who goes straight to Chat sees the skeleton
       `loading` drives. */
    const cancelIdle = onIdle(() => {
      if (!alive) return

      /* Privacy settings ride alongside but must never fail the seed — a
         deploy without the settings endpoint should still open the inbox. */
      api.chat.settings.get().then((s: any) => { if (alive && s) setChatSettings(s) }).catch(() => {})

      api.chat.conversations.list({ page: 0, size: PAGE_SIZE }).then((inbox: any) => {
        if (!alive) return
        const calls = latestCallByConvo()
        setConversations(inbox.items.map((c: any) => stampRecency(c, calls)).sort(byRecency))
        inboxPageRef.current = 0
        setInboxHasMore(!!inbox.hasMore)
        setError(null)
      }).catch(e => {
        if (alive) setError(e)
      }).finally(() => {
        if (alive) { setLoading(false); setReady(true) }
      })
    })

    return () => { alive = false; cancelIdle() }
  }, [signedIn, clearedStore])

  /* Calls missed while the app was NOT RUNNING never reached the device log —
     nothing was listening for the `call.ended` frame — so the one call that
     most deserves a line in the rail is the one that would have left none.
     The server does keep it, as the CALL_MISSED bell (calls.md §Missed-call
     bell), so one page of those is folded back into the log at boot and every
     call surface reads it from there. Best-effort by design: a failure here
     costs a preview line, never the inbox. */
  React.useEffect(() => {
    if (!signedIn) return
    let alive = true
    /* Best-effort backfill — it can also wait for an idle frame rather than
       contending with Home's first paint. */
    const cancelIdle = onIdle(() => {
      if (!alive) return
      api.notifications.list({ type: 'CALL_MISSED', page: 0, size: 30 } as any)
        .then((res: any) => {
          if (!alive) return
          const rows = (res?.items || [])
            .map(logFromMissedNotification)
            .filter(Boolean) as CallLogEntry[]
          if (!rows.length) return
          mergeCallLog(rows)
          restampCalls()
        })
        .catch(() => {})
    })
    return () => { alive = false; cancelIdle() }
  }, [signedIn, restampCalls])

  /* Every (re)connect re-seeds the absolute badge and re-reads the inbox —
     the delta model drifts across a disconnect and this is the correction. */
  const firstEpoch = React.useRef(true)
  React.useEffect(() => {
    if (!signedIn) return
    if (firstEpoch.current) { firstEpoch.current = false; return }
    reseedUnread()
    void refreshInbox()
  }, [epoch, signedIn, reseedUnread, refreshInbox])

  /* THE TAB BADGE IS THIS NUMBER. The shell holds `chatUnread` because the tab
     bar renders it, but only this provider can compute it: the count has to
     exclude your own echo to another device, the thread you are looking at,
     and a `message.new` you have already seen — all three of which are state
     that lives here. The shell used to add +1 per frame regardless, so the
     badge and the inbox told different stories about the same conversation.
     Mirroring rather than lifting keeps ChatProvider's own consumers off the
     shell's re-render path; the write is idempotent, so the absolute reseeds
     (boot, and every reconnect above) reach the badge through here too. */
  React.useEffect(() => { setChatUnread(totalUnread) }, [totalUnread, setChatUnread])

  /* ---------------- the shell's stream, fanned out here ---------------- */

  useChatEvents(React.useCallback((evt: ChatEvent) => {
    const convId = evt.conversationId ? String(evt.conversationId) : ''

    switch (evt.type) {
      case 'message.new':
        applyMessageNew(convId, evt.message)
        break

      /* Keep the rail's preview truthful when the newest message is edited or
         tombstoned — otherwise the inbox quotes text that no longer exists. */
      case 'message.edited': {
        const c = findConvo(convId)
        if (c && String(c.lastMessageId) === String(evt.messageId)) {
          /* An edit re-applies the remaining TTL server-side, so the edited
             body is still ephemeral and still must not reach the rail. */
          patchConvo(convId, {
            lastMessagePreview: (c.disappearingSeconds || 0) > 0 ? DISAPPEARING_PREVIEW : (evt.body || ''),
          })
        }
        break
      }

      case 'message.deleted': {
        const c = findConvo(convId)
        if (c && String(c.lastMessageId) === String(evt.messageId)) {
          patchConvo(convId, { lastMessagePreview: 'Message deleted' })
        }
        break
      }

      case 'receipt.read': {
        const c = findConvo(convId)
        if (String(evt.userId) === String(myIdRef.current)) {
          /* My own read on another device zeroes this conversation here too. */
          const dec = c?.unreadCount || 0
          if (dec) setTotalUnread(t => Math.max(0, t - dec))
          patchConvo(convId, {
            unreadCount: 0, hasUnread: false, markedUnread: false,
            lastReadMessageId: maxId(c?.lastReadMessageId, evt.lastReadMessageId),
          })
          break
        }
        /* The PEER read my messages. The open thread keeps a live high-water
           mark, but it is per-mount — without persisting the peer's marker
           here, leaving and returning rolls every "Seen" back to "Delivered". */
        if (c && !c.isGroup) {
          patchConvo(convId, {
            peerLastReadMessageId: maxId(c.peerLastReadMessageId, evt.lastReadMessageId),
          })
        } else if (!c) {
          pullConvoForReceipt(convId)
        }
        break
      }

      case 'receipt.delivered': {
        if (String(evt.userId) === String(myIdRef.current)) break
        const c = findConvo(convId)
        if (c && !c.isGroup) {
          patchConvo(convId, {
            peerLastDeliveredMessageId: maxId(c.peerLastDeliveredMessageId, evt.messageId),
          })
        } else if (!c) {
          pullConvoForReceipt(convId)
        }
        break
      }

      /* A call just finished in one of my conversations — `call.ended` is the
         one terminal frame (calls.md: a group decline leaves the call live).
         It carries the whole call, so the rail is written straight from the
         frame rather than from the log: CallBanner is the log's writer of
         record and there is no ordering promise between two subscribers of
         the same fan-out. The log is only the fallback for a bare frame, read
         a beat later so its writer has run — the same beat the open thread
         waits. Both paths go through the same describe grammar, so the rail
         and the thread card say the same sentence either way. */
      case 'call.ended': {
        if (!convId) break
        if (evt.call) applyCall(convId, logFromCall(evt.call, myIdRef.current))
        else setTimeout(() => applyCall(convId, latestCallForConvo(convId)), 120)
        break
      }

      case 'conversation.updated': {
        if (evt.conversation) upsertConvo(evt.conversation)
        if (evt.memberChange === 'DELETED') removeConvo(convId)
        else if (evt.memberChange === 'REQUEST_ACCEPTED') {
          api.chat.conversations.get(convId).then((c: any) => { if (c) upsertConvo(c) }).catch(() => {})
        }
        break
      }

      case 'member.changed': {
        const mine = String(evt.userId) === String(myIdRef.current)
        const change = evt.memberChange
        /* `UNSUBSCRIBED` is the channel's spelling of LEFT — a channel leave
           removes the membership row rather than leaving a tombstone, and the
           server sends it to the leaver's own devices, which is what keeps a
           leave performed on one device from leaving a live-looking row on
           the others. */
        if (mine && (change === 'REMOVED' || change === 'LEFT' || change === 'UNSUBSCRIBED')) {
          removeConvo(convId)
          break
        }
        if (mine) {
          /* My own role/status changed under me. This drives what the UI lets
             me do, so it has to land now rather than at the next fetch. */
          if (change === 'PROMOTED' || change === 'DEMOTED') patchConvo(convId, { myRole: evt.role || 'MEMBER' })
          else if (change === 'RESTRICTED') patchConvo(convId, { myStatus: 'RESTRICTED' })
          else if (change === 'UNRESTRICTED') patchConvo(convId, { myStatus: 'ACTIVE' })
          else if (change === 'ADDED' || change === 'SUBSCRIBED') {
            /* Nothing local can be patched into shape — role, status, settings
               and the history floor are all new — so pull the real row. */
            api.chat.conversations.get(convId).then((c: any) => { if (c) upsertConvo(c) }).catch(() => {})
          }
          break
        }
        /* Someone else joined or left. Computed INSIDE the updater: reading a
           ref first and writing an absolute made a burst of joins collapse to
           a single +1, because every handler read the same stale snapshot. */
        const delta = (change === 'ADDED' || change === 'SUBSCRIBED') ? 1
          : (change === 'REMOVED' || change === 'LEFT' || change === 'UNSUBSCRIBED') ? -1 : 0
        if (delta) {
          const bumpCount = (list: any[]) => list.map(c => (
            String(c.id) === convId ? { ...c, memberCount: Math.max(0, (c.memberCount || 0) + delta) } : c
          ))
          setConversations(bumpCount)
          setArchivedList(bumpCount)
        }
        break
      }

      case 'request.new': {
        setRequestCount(n => n + 1)
        if (evt.request) {
          if (requestsLoadedRef.current) {
            setRequests(prev => [evt.request, ...prev.filter(r => r.id !== evt.request.id)])
          } else {
            /* Stashed in the ref even when the list was never loaded: the
               `message.new` handler needs to know this conversation is a
               still-pending request, or its next message pulls the thread
               into the main rail the server excludes it from. */
            requestsRef.current = [evt.request, ...requestsRef.current.filter(r => r.id !== evt.request.id)]
          }
        }
        break
      }

      /* A stage invite can land while the user is anywhere in the app. The
         full Accept/Decline banner lives in the live room, so away from it say
         what happened and where to go. The frame fires ONCE and the roster
         never lists INVITED members, so it is also STASHED — the live screen
         takes it on mount. Suppress the toast in the room itself. */
      case 'stream.stage.invite': {
        if (!evt.stageMember || !evt.streamId) break
        stageInvitesRef.current.set(String(evt.streamId), { member: evt.stageMember, at: Date.now() })
        const inThatRoom = segmentsRef.current.some(s => String(s) === String(evt.streamId))
          || segmentsRef.current.join('/').includes(`live/${evt.streamId}`)
        if (inThatRoom) break
        const who = evt.stageMember.displayName
          || (evt.stageMember.handle ? '@' + evt.stageMember.handle : 'The host')
        toast.info(`${who} invited you up on their live stage — open their stream to accept`)
        break
      }

      default:
        break
    }

    for (const h of [...subscribersRef.current]) {
      try { h(evt) } catch { /* isolate a bad subscriber */ }
    }
  }, [applyMessageNew, findConvo, patchConvo, upsertConvo, removeConvo, pullConvoForReceipt, applyCall]))

  /* ---------------- actions ---------------- */

  const markRead = React.useCallback(async (convId: string, lastMessageId?: string | null) => {
    const c = findConvo(convId)
    const dec = c?.unreadCount || 0
    if (dec) setTotalUnread(t => Math.max(0, t - dec))
    patchConvo(convId, { unreadCount: 0, hasUnread: false, markedUnread: false })
    try {
      const target = lastMessageId ?? c?.lastMessageId ?? null
      /* `lastReadMessageId` is REQUIRED — a missing id is a guaranteed 400
         (conversations.md §POST …/read), and with no messages there is
         nothing to mark anyway. */
      if (target != null) await api.chat.conversations.read(convId, target)
    } catch { /* the badge reseeds on the next reconnect */ }
  }, [findConvo, patchConvo])

  const markUnread = React.useCallback(async (convId: string) => {
    patchConvo(convId, { markedUnread: true, hasUnread: true })
    try { await api.chat.conversations.unread(convId) }
    catch (e) { patchConvo(convId, { markedUnread: false }); toast.warn(chatError(e, 'Could not mark as unread')) }
  }, [patchConvo])

  const togglePin = React.useCallback(async (convId: string) => {
    const prev = !!findConvo(convId)?.pinned
    patchConvo(convId, { pinned: !prev }, { resort: true })
    try { await api.chat.conversations.pin(convId, !prev) }
    catch (e) { patchConvo(convId, { pinned: prev }, { resort: true }); toast.warn(chatError(e, 'Could not update pin')) }
  }, [findConvo, patchConvo])

  const toggleMute = React.useCallback(async (convId: string, mutedUntil?: string | null) => {
    const prev = !!findConvo(convId)?.muted
    patchConvo(convId, { muted: !prev })
    try { await api.chat.conversations.mute(convId, prev ? null : (mutedUntil ?? null)) }
    catch (e) { patchConvo(convId, { muted: prev }); toast.warn(chatError(e, 'Could not update mute')) }
  }, [findConvo, patchConvo])

  const toggleArchive = React.useCallback(async (convId: string) => {
    const snapshot = findConvo(convId)
    const next = !snapshot?.archived
    /* Optimistic like its siblings: the swiped row leaves NOW and comes back
       if the server refuses. The destination list is filled by the fresh read
       on success — a guessed insert there would only be churn the reconcile
       overwrites. */
    if (next) setConversations(prev => prev.filter(x => String(x.id) !== String(convId)))
    else setArchivedList(prev => prev.filter(x => String(x.id) !== String(convId)))
    try {
      await api.chat.conversations.archive(convId, next)
      const fresh: any = await api.chat.conversations.get(convId)
      if (fresh) upsertConvo(fresh)
    } catch (e) {
      /* upsertConvo routes by the row's own `archived` flag, so the snapshot
         lands back in exactly the list it left. Rethrow so callers' success
         toasts — and their Undo actions — never fire on a failed toggle. */
      if (snapshot) upsertConvo(snapshot)
      toast.warn(chatError(e, 'Could not archive conversation'))
      throw e
    }
  }, [findConvo, upsertConvo])

  /* The body every "this conversation leaves my lists" write runs: drop the
     row NOW, put it — and its share of the absolute unread badge — back if the
     server refuses, and rethrow so a caller that navigates away on success
     cannot navigate away on a failure.

     A 404 is NOT a failure here. It means the conversation is already gone,
     which is the outcome the caller asked for; restoring a row for a thread
     that does not exist is the one thing this must never do.

     `clearFloor` belongs to delete-for-me only. `conversations.remove` is four
     different server actions behind one verb (conversations.md §DELETE), and
     only ONE of them leaves the account able to see this thread again: the
     branch a DM participant or a non-owner group member gets, which sets the
     member's `clearedBeforeMessageId` to the thread's current `lastMessageId`
     and floors every later read at it, so the thread comes back — empty — the
     next time the other side sends. The client has to mirror that floor or it
     re-renders history the account can no longer fetch: the open thread keeps
     its loaded window, an SSE frame merges into it, and a resurfaced
     conversation opens on yesterday's messages. A leave or an unsubscribe
     hides nothing — it ends the membership — so it raises no floor. */
  const removeConvoAround = React.useCallback(async (
    convId: string,
    write: () => Promise<any>,
    { clearFloor = false, failure = 'Could not update this conversation' }:
      { clearFloor?: boolean; failure?: string | null } = {},
  ) => {
    const key = String(convId)
    const snapshot = findConvo(key)
    const floorBefore = clearedStore.get(key) ?? null
    if (clearFloor) {
      const floor = maxId(floorBefore, snapshot?.lastMessageId ?? null)
      if (floor) clearedStore.set(key, String(floor))
    }
    removeConvo(key)
    try {
      await write()
    } catch (e) {
      if (isNotFound(e)) return
      if (clearFloor) {
        if (floorBefore) clearedStore.set(key, floorBefore)
        else clearedStore.remove(key)
      }
      if (snapshot) {
        upsertConvo(snapshot)
        /* removeConvo took this row's unread out of the absolute badge. The
           row is back, so its count is owed back too — otherwise the tab
           badge under-counts until the next reconnect reseed. */
        const dec = snapshot.unreadCount || 0
        if (dec) setTotalUnread(t => t + dec)
      }
      /* `failure: null` = the caller owns the messaging. The one case is the
         group owner's 400 ("you cannot leave while members remain"), where a
         toast and the transfer-or-delete sheet would say the same thing
         twice. */
      if (failure) toast.warn(chatError(e, failure))
      throw e
    }
  }, [findConvo, removeConvo, upsertConvo, clearedStore])

  const deleteConvo = React.useCallback((convId: string) => removeConvoAround(
    convId,
    () => api.chat.conversations.remove(String(convId)),
    { clearFloor: true, failure: 'Could not delete conversation' },
  ), [removeConvoAround])

  /* Leave a group, unsubscribe from a channel, delete a channel — three
     endpoints across two api modules, all meaning "this row leaves my lists".
     The screens kept calling them directly and relied on the server echoing
     `member.changed` / `conversation.updated` back to their own device to
     clear the rail. That echo is the socket, and the socket is exactly what is
     down when a user is retrying a leave — so the row survived the action that
     removed it until the next reconnect. */
  const dropConvo = React.useCallback(
    (convId: string, write: () => Promise<any>, failure: string | null = 'Could not update this conversation') =>
      removeConvoAround(convId, write, { failure }),
    [removeConvoAround],
  )

  const setDisappearing = React.useCallback(async (convId: string, seconds: number) => {
    const prev = findConvo(convId)?.disappearingSeconds ?? 0
    patchConvo(convId, { disappearingSeconds: seconds })
    try { await api.chat.conversations.disappearing(convId, seconds) }
    catch (e) {
      patchConvo(convId, { disappearingSeconds: prev })
      toast.warn(chatError(e, 'Could not update the disappearing timer'))
      /* Re-thrown so the screen can roll back ITS local copy and branch on
         ADMINS_ONLY (conversations.md §disappearing errors) — swallowing here
         left the caller's optimistic checkmark stuck on the failed value. */
      throw e
    }
  }, [findConvo, patchConvo])

  const setChatPrivacy = React.useCallback(async (patch: Partial<ChatSettings>) => {
    const prev = settingsRef.current
    setChatSettings(s => ({ ...s, ...patch }))
    try { await api.chat.settings.update(patch) }
    catch (e) { setChatSettings(prev); toast.warn(chatError(e, 'Could not update chat privacy')) }
  }, [])

  /* `POST /message-requests/{id}/accept` takes the messageRequestId — the
     conversationId is a DIFFERENT field on the row (message-requests.md), so
     the id must never double as both. The thread to pull into the inbox is
     looked up from the loaded rows before this one is dropped. */
  const acceptRequest = React.useCallback(async (requestId: string) => {
    const row = requestsRef.current.find(r => String(r.id) === String(requestId)) || null
    setRequests(prev => prev.filter(r => String(r.id) !== String(requestId)))
    setRequestCount(n => Math.max(0, n - 1))
    try {
      await api.chat.requests.accept(requestId)
      /* Accepting graduates the thread into the main inbox
         (message-requests.md §accept) — surface it without a full refetch. */
      const convId = row?.conversationId
      if (convId) {
        const fresh: any = await api.chat.conversations.get(convId)
        if (fresh) upsertConvo(fresh)
      }
    } catch (e) {
      toast.warn(chatError(e, 'Could not accept request'))
      void loadRequests()
    }
  }, [upsertConvo, loadRequests])

  /* Decline and block are two endpoints, not one call with a flag: blocking is
     the strictly stronger action and the server records it separately. Both
     take the messageRequestId, like accept. */
  const declineRequest = React.useCallback(async (requestId: string, block = false) => {
    setRequests(prev => prev.filter(r => String(r.id) !== String(requestId)))
    setRequestCount(n => Math.max(0, n - 1))
    try { await (block ? api.chat.requests.block(requestId) : api.chat.requests.decline(requestId)) }
    catch (e) { toast.warn(chatError(e, 'Could not update request')); void loadRequests() }
  }, [loadRequests])

  /* ---------------- typing / presence / firehose ---------------- */

  /** Throttled to one POST per 3s, resent immediately when the verb changes.
   *  Silent when the user turned typing indicators off — the switch is
   *  symmetric, so sending anyway would leak a signal they opted out of. */
  const sendTyping = React.useCallback((convId: string, isTyping: boolean, activity = 'TYPING') => {
    if (!settingsRef.current.typingIndicatorsEnabled) return
    const key = String(convId)
    const last = typingSentRef.current.get(key)
    const now = Date.now()
    if (isTyping && last && last.activity === activity && now - last.at < TYPING_THROTTLE_MS) return
    typingSentRef.current.set(key, { at: now, activity })
    if (!isTyping) typingSentRef.current.delete(key)
    api.chat.typing(convId, isTyping, activity).catch(() => {})
  }, [])

  /** The SSE echo of an own send carries the identical patch moments later
   *  (the fanout includes the sender), so this is idempotent — its whole
   *  value is the case where the socket is down at send time and the rail
   *  would otherwise show the previous message until the next reconcile.
   *  Everything about RECEIVING stays out: no unread bump, no delivered
   *  receipt, no request-tray handling. */
  const noteOutgoing = React.useCallback((convId: string, message: any) => {
    if (!message || message.deleted) return
    const id = message.id != null ? String(message.id) : null
    setConversations(prev => prev.map(c => (
      String(c.id) === String(convId)
        ? {
          ...c,
          lastMessageId: id ?? c.lastMessageId,
          lastMessageAt: message.createdAt || c.lastMessageAt,
          lastMessageSenderId: message.senderId ?? c.lastMessageSenderId,
          lastMessagePreview: previewOf(message, (c.disappearingSeconds || 0) > 0),
          _lastAtMs: message.createdAt ? Date.parse(message.createdAt) : c._lastAtMs,
        }
        : c
    )).sort(byRecency))
  }, [])

  const setActiveConversation = React.useCallback((id: string | null) => {
    activeIdRef.current = id ? String(id) : null
  }, [])

  const subscribe = React.useCallback((fn: (e: ChatEvent) => void) => {
    subscribersRef.current.add(fn)
    return () => { subscribersRef.current.delete(fn) }
  }, [])

  const takeStageInvite = React.useCallback((streamId: string) => {
    const key = String(streamId)
    const v = stageInvitesRef.current.get(key)
    if (v) stageInvitesRef.current.delete(key)
    return v?.member ?? null
  }, [])

  const inbox = React.useMemo<ChatInbox>(() => ({
    ready, connected, loading, error,
    conversations, archived, totalUnread,
    inboxHasMore, archivedHasMore, inboxLoadingMore,
  }), [
    ready, connected, loading, error, conversations, archived, totalUnread,
    inboxHasMore, archivedHasMore, inboxLoadingMore,
  ])

  const requestsValue = React.useMemo<ChatRequests>(
    () => ({ requests, requestCount }),
    [requests, requestCount],
  )

  const actions = React.useMemo<ChatActions>(() => ({
    setChatPrivacy,
    getConvo, refreshInbox, loadMoreInbox, loadArchived, loadMoreArchived, loadRequests,
    markRead, markUnread, togglePin, toggleMute, toggleArchive, deleteConvo, dropConvo,
    setDisappearing, acceptRequest, declineRequest, noteOutgoing,
    /* setTotalUnread is a useState setter — stable for the provider's life, so
       it needs no dep entry. */
    setUnreadCount: setTotalUnread,
    setActiveConversation, subscribe,
    trackPresence, sendTyping,
    takeStageInvite,
    convoStore, clearedStore,
  }), [
    setChatPrivacy, getConvo, refreshInbox, loadMoreInbox, loadArchived, loadMoreArchived,
    loadRequests, markRead, markUnread, togglePin, toggleMute, toggleArchive, deleteConvo, dropConvo,
    setDisappearing, acceptRequest, declineRequest, noteOutgoing, setActiveConversation, subscribe,
    trackPresence, sendTyping, takeStageInvite, convoStore, clearedStore,
  ])

  return (
    <ChatActionsCtx.Provider value={actions}>
      <SettingsCtx.Provider value={chatSettings}>
        <RequestsCtx.Provider value={requestsValue}>
          <InboxCtx.Provider value={inbox}>
            <SegmentsMirror into={segmentsRef} />
            {children}
          </InboxCtx.Provider>
        </RequestsCtx.Provider>
      </SettingsCtx.Provider>
    </ChatActionsCtx.Provider>
  )
}
