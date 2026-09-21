/* =========================================================
   The conversation.

   The hard parts live in ./components/chat/useThread.ts — the
   ascending Snowflake-ordered store, cursor paging backwards,
   gap sync on every reconnect, optimistic sends and the delta
   application of every live frame. What lives here is the
   screen's own contract:

   · setActiveConversation(id) on FOCUS and null on BLUR. Without
     it every message arriving in the thread you are reading
     bumps the tab badge, and the badge never comes back down
     because the read marker has already fired.
   · The read marker is debounced and only ever moves FORWARD,
     and only while the app is in the foreground. A thread open
     behind a lock screen has not been read.
   · The composer is disabled from the PERMISSION MATRIX, not
     from a failed send. Being told "only admins can post" after
     typing three sentences is the worst version of that.
   · Every send failure keeps the bubble, the draft and the
     text. A 429 counts down; a policy rejection offers no retry
     at all, because retrying it produces the same rejection.
   · THE LIST IS THE HOT PATH. `renderRow` must stay
     identity-stable across an arriving message, so nothing
     object-shaped may enter its dependency array — least of all
     `convo`, which ChatContext patches on every `message.new`
     and every `receipt.read`. The bubbles take the four scalars
     derived below instead. Five row shapes share the list, so
     `getItemType` is not optional: without it FlashList pools
     them together and a day divider hands its React key to a
     MessageBubble, tearing down the whole subtree on recycle.
   ========================================================= */
import React from 'react'
import { AppState, StyleSheet, View, useWindowDimensions, type AppStateStatus } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
/* /legacy, not the root: SDK 57's root export turned the classic calls
   (`presentContactPickerAsync`, `presentFormAsync`) into throwing stubs —
   sharing a contact died at the tap. Same migration as expo-file-system. */
import * as Contacts from 'expo-contacts/legacy'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as Sharing from 'expo-sharing'
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { REPORT_REASONS, api, codeOf, errorText, isNotFound } from '@/api'
import { gtId, isTmpId, maxId } from '@/api'
import { useAuth } from '@/context/AuthContext'
import {
  useChatActions, useChatRequests, useChatSettings, useConversation,
} from '@/context/ChatContext'
import { useChatEvents, usePresence, useTyping, type TypingState } from '@/context/RealtimeContext'
import { callLogForConvo, type CallLogEntry } from '@/components/call/callStore'
import { CallSessionRow } from '@/components/chat/CallSessionRow'
import { chatVoice } from '@/components/chat/chatVoicePlayer'
import { chatError } from '@/lib/chatErrors'
import { isNsfwBlocked } from '@/lib/moderation'
import { toLocalFile } from '@/lib/localFile'
import { useChatSkin } from '@/lib/chatPrefs'
import { prepareUploads } from '@/lib/mediaTier'
import { checkAssets } from '@/lib/fileMeta'
import { toUploadFile } from '@/platform/files'
import { useEvent } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useDockInset } from '@/hooks/useDockInset'
import { useTheme } from '@/theme/ThemeProvider'
import { announce } from '@/theme/announce'
import { rule, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, ConfirmSheet, Field, Header, Icon, Screen, Sheet,
  Spinner, Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'
import { AttachTray, PollComposer, type AttachKind, type DraftPoll } from '@/components/chat/AttachTray'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { MessageMenu, type MessageAction } from '@/components/chat/MessageActionSheet'
import { PinBar } from '@/components/chat/PinBar'
import { DayDivider, SystemNote, UnreadDivider } from '@/components/chat/SystemNote'
import { TypingRow } from '@/components/chat/TypingRow'
import { dayKey, presenceLine, typingSentence } from '@/components/chat/format'
import {
  canSend, composerBlockReason, isAdmin, slowModeFor,
} from '@/components/chat/permissions'
import { ChatErrorState, ThreadSkeleton } from '@/components/chat/states'
import { useThread } from '@/components/chat/useThread'
import { useUserDirectory } from '@/components/chat/userDirectory'
import type { RecordingResult } from '@/components/chat/VoiceRecorder'

const RUN_GAP_MS = 5 * 60 * 1000
/* Under the server's 6s typing TTL and above the provider's 3s POST
   throttle, so a re-signal always lands before the peer's indicator dies and
   never floods the wire. */
const ACTIVITY_KEEPALIVE_MS = 4000
const DRAFT_DEBOUNCE_MS = 1200

type Row =
  | { type: 'day'; key: string; iso: string }
  | { type: 'unread'; key: string }
  | { type: 'system'; key: string; message: any }
  | { type: 'msg'; key: string; message: any; runStart: boolean; runEnd: boolean }
  | { type: 'call'; key: string; entry: CallLogEntry; count: number; firstTs: number }

/* ---------------------------------------------------------
   The two live leaves. They hold the typing/presence store
   subscriptions so those frames — the highest-frequency
   traffic an open thread sees — re-render a caption and a
   footer row, never the screen component around the list.
   --------------------------------------------------------- */

const ThreadSubtitle = React.memo(function ThreadSubtitle({
  convId, isGroup, isChannel, memberCount, peerId, lastSeenVisible, nameOf,
}: {
  convId: string
  isGroup: boolean
  isChannel: boolean
  memberCount: number
  peerId: string | null
  lastSeenVisible: boolean
  nameOf: (id: any) => string
}) {
  const typers: TypingState[] = useTyping(convId)
  /* Per-key: only THIS peer's presence flips re-render the caption. */
  const peerPresence = usePresence(peerId)
  const typingLine = typingSentence(typers, nameOf, isGroup)
  const text = typingLine
    || (isGroup
      ? `${memberCount} ${isChannel ? 'subscribers' : 'members'}`
      : presenceLine(peerPresence, lastSeenVisible))
  if (!text) return null
  return (
    <Text variant="caption" tone={typingLine ? 'accent' : 'muted'} numberOfLines={1} align="ui">
      {text}
    </Text>
  )
})

const ThreadTypingFooter = React.memo(function ThreadTypingFooter({
  convId, nameOf, isGroup,
}: { convId: string; nameOf: (id: any) => string; isGroup: boolean }) {
  const typers = useTyping(convId)
  if (!typers.length) return null
  return <TypingRow typers={typers} nameOf={nameOf} isGroup={isGroup} />
})

/* Module scope, so both survive every render of the screen.

   `getItemType` is the one that matters here. FlashList's recycle pools are
   keyed by item type (RenderStackManager.recycleKeyPools) and a React key is
   recycled when the stable id OR the type changes. Without this, five row
   shapes share one pool: scrolling past a day divider hands its key to a
   message index, React sees <DayDivider> become <MessageBubble> at the same
   key, and tears the whole subtree down — the GestureDetector and its
   handlers, three shared values, the avatar's image, MediaGrid, ReactionChips
   — instead of swapping props on a mounted bubble. A thread has a divider
   every calendar day plus a system note per membership change (and now a
   call card per ended call), so on a fast scroll back through history that
   fired constantly. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.type

/* A conversation deleted under the reader is an ANSWER, not a failure, and
   ChatErrorState's 404 branch already has the right words for one — so the
   gone case is handed the shape that branch tests for rather than growing a
   second copy of the same empty state. */
const CONVERSATION_GONE = { status: 404 }

export default function ConversationScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id, jump } = useLocalSearchParams<{ id: string; jump?: string }>()
  const convId = String(id)

  const { user } = useAuth()
  const myId = user?.id ? String(user.id) : null

  const {
    getConvo, trackPresence, sendTyping, setActiveConversation,
  } = useChatActions()
  const chatSettings = useChatSettings()
  const { requests } = useChatRequests()
  const skin = useChatSkin()
  const dir = useUserDirectory()
  const thread = useThread(convId, myId)
  /* The select bar REPLACES the composer at the bottom edge, so it inherits
     the composer's duty: Android is edge-to-edge and a 56pt bar with no inset
     puts Delete under the gesture pill (DESIGN.md §8). Same hook the Composer
     uses, so the two docks agree while the keyboard is up. */
  const dock = useDockInset()

  const listRef = React.useRef<FlashListRef<Row>>(null)
  const [convo, setConvo] = React.useState<any>(() => getConvo(convId))
  const [convoError, setConvoError] = React.useState<any>(null)
  const [pinIndex, setPinIndex] = React.useState(0)
  const [reply, setReply] = React.useState<any>(null)
  const [editing, setEditing] = React.useState<any>(null)
  const [draft, setDraft] = React.useState<string | undefined>(undefined)
  const [highlight, setHighlight] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [permanentBlock, setPermanentBlock] = React.useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = React.useState<number | null>(null)
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [atBottom, setAtBottom] = React.useState(true)
  const [jumping, setJumping] = React.useState(false)
  const [localReactions, setLocalReactions] = React.useState<Record<string, string>>({})
  const [cooldown, startCooldown] = useCooldown()

  const menu = useSheetState<{ message: any; y: number; height: number; mode: 'full' | 'reactOnly' }>()
  const tray = useSheetState()
  const pollSheet = useSheetState()
  const deleteSheet = useSheetState<any>()
  const scheduleSheet = useSheetState<string>()
  const reportSheet = useSheetState<any>()

  const draftTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftDirty = React.useRef(false)

  /* The unread rule is captured ONCE. Recomputing it as messages are read
     would make the divider crawl down the screen while you look at it. */
  const unreadAnchor = React.useRef<string | null>(null)

  /* ---------------- conversation ---------------- */

  const loadConvo = React.useCallback(() => {
    api.chat.conversations.get(convId)
      .then((fresh: any) => {
        if (!fresh) return
        setConvo(fresh)
        setConvoError(null)
        if (unreadAnchor.current === null) unreadAnchor.current = fresh.lastReadMessageId ?? ''
      })
      .catch(e => { if (!getConvo(convId)) setConvoError(e) })
  }, [convId, getConvo])

  React.useEffect(loadConvo, [loadConvo])

  /* Keep the header and the composer live. `member.changed` patches myRole and
     myStatus straight into the provider's row, and `receipt.read` persists the
     peer's marker there — reading that row is what stops every "Seen" tick
     rolling back to "Delivered" the moment you leave and return. Subscribed
     per KEY rather than calling getConvo(): it reacts to those frames like
     watching the inbox array did, without this screen rendering for every
     OTHER conversation's traffic the way the array subscription made it. */
  const cachedConvo = useConversation(convId)
  /* GUARDED. ChatContext patches that row on every `message.new` and every
     `receipt.read`, so `cachedConvo` gets a fresh identity several times a
     second in a busy thread. Merging it unconditionally minted a new `convo`
     each time, which recreated renderRow and missed the memo on every visible
     bubble — a cosmetic frame repainting the whole viewport. Merge only when a
     field the merge would actually change has moved. */
  React.useEffect(() => {
    if (!cachedConvo) return
    setConvo((prev: any) => {
      /* The peer receipt markers ride ONLY the single GET and live receipt
         frames — inbox list rows carry them as null (the backend's inbox
         mapper never populates them). A raw spread of the store row therefore
         rolled every "Seen" tick back to "Sent" whenever the row was
         rewritten (each message.new, each reconnect's inbox refresh). Fold
         the markers forward instead, and only then decide whether the merge
         changed anything at all. */
      const fold = {
        peerLastReadMessageId: maxId(prev?.peerLastReadMessageId, (cachedConvo as any).peerLastReadMessageId),
        peerLastDeliveredMessageId: maxId(prev?.peerLastDeliveredMessageId, (cachedConvo as any).peerLastDeliveredMessageId),
      }
      if (prev
        && fold.peerLastReadMessageId === prev.peerLastReadMessageId
        && fold.peerLastDeliveredMessageId === prev.peerLastDeliveredMessageId
        && Object.keys(cachedConvo).every(k =>
          k in fold || prev[k] === (cachedConvo as any)[k])) return prev
      return { ...prev, ...cachedConvo, ...fold }
    })
  }, [cachedConvo])

  /* Arrivals in the thread you are LOOKING at must not bump the badge; the
     read marker will clear them a moment later either way. The ref mirrors
     focus for the AppState listener below, which cannot take a hook. */
  const focusedRef = React.useRef(false)
  useFocusEffect(React.useCallback(() => {
    focusedRef.current = true
    setActiveConversation(convId)
    return () => {
      focusedRef.current = false
      setActiveConversation(null)
    }
  }, [convId, setActiveConversation]))

  /* Leaving the conversation ENDS whatever voice note is playing. The player
     is screen-level and deliberately outlives scrolling, list recycling and
     the hop to pinned / starred / media — all of those are pushed on TOP of
     this screen, which stays mounted underneath. Being popped is the one case
     that is not a hop: the bubbles that own the transport are gone, so nothing
     is left on screen to pause a note that is still talking. Unmount, not
     blur, for exactly that reason. */
  React.useEffect(() => () => chatVoice.stop(), [])

  React.useEffect(() => {
    if (convo?.peer?.id) {
      dir.watchUsers([convo.peer.id])
      trackPresence([convo.peer.id])
    }
  }, [convo?.peer?.id, dir, trackPresence])

  React.useEffect(() => {
    dir.watchUsers(thread.messages.map(m => m.senderId))
  }, [thread.messages, dir])

  /* ---------------- draft ---------------- */

  React.useEffect(() => {
    api.chat.drafts.get(convId)
      /* A 404 is the documented "no draft" answer and chat.js already swallows
         it, so anything reaching here is a real failure and costs one draft. */
      .then((d: any) => { if (d?.body) setDraft(d.body) })
      .catch(() => {})
  }, [convId])

  /* useEvent, not useCallback: a `reply?.id` dependency would mint a fresh
     handler on every reply change and break the memo'd Composer. */
  const onDraftChange = useEvent((body: string) => {
    draftDirty.current = true
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      draftDirty.current = false
      if (body.trim()) api.chat.drafts.save(convId, { body, replyToId: reply?.id }).catch(() => {})
      else api.chat.drafts.discard(convId).catch(() => {})
    }, DRAFT_DEBOUNCE_MS)
  })

  React.useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current) }, [])

  /* ---------------- rows ---------------- */

  /* ---- call sessions in the timeline ----
     The server writes no message for a call (calls.md), so the sessions come
     from the device-local call log, merged into the timeline by time. The log
     is written by whichever surface watched the call end (CallBanner, the
     call room, the incoming screen) — re-read a beat after a terminal call
     frame lands so the writer has run, and again on focus for the round trip
     through the call room. */
  /* Derived-state reset (keyed on convId) rather than an effect: the effect
     version double-rendered on every conversation switch and is the exact
     set-state-in-effect shape the compiler bails on. */
  const [callState, setCallState] = React.useState<{ convId: string; log: CallLogEntry[] }>(
    () => ({ convId, log: callLogForConvo(convId) }),
  )
  if (callState.convId !== convId) setCallState({ convId, log: callLogForConvo(convId) })
  const callLog = callState.log
  const rereadCallLog = React.useCallback(
    () => setCallState({ convId, log: callLogForConvo(convId) }),
    [convId],
  )
  useChatEvents(evt => {
    if (evt.type !== 'call.ended' && evt.type !== 'call.declined') return
    if (evt.conversationId && String(evt.conversationId) !== convId) return
    setTimeout(rereadCallLog, 80)
  })
  useFocusEffect(React.useCallback(() => { rereadCallLog() }, [rereadCallLog]))

  /* Only the calls that fall INSIDE the loaded window. The merge below walks
     the loaded messages and flushes every earlier call before the first one —
     so with older pages still unfetched, a year of call history would stack
     up above the oldest loaded message, all at the wrong place in the thread.
     The floor lifts as pages load, and drops away entirely once the whole
     history is here (or when there are no messages at all and the calls ARE
     the conversation). */
  const oldestLoadedTs = React.useMemo(() => {
    if (!thread.hasMore || !thread.messages.length) return 0
    const first = thread.messages[0]
    const ts = first._ts ?? Date.parse(first.createdAt)
    return Number.isFinite(ts) ? ts : 0
  }, [thread.hasMore, thread.messages])

  const callMerges = React.useMemo(() => {
    const flat = callLog
      .map(entry => ({ entry, ts: Date.parse(entry.endedAt || entry.startedAt || '') || 0 }))
      .filter(x => x.ts > 0 && x.ts >= oldestLoadedTs)
    /* Runs of the SAME outcome collapse into one card — three rapid redials
       used to stack three identical plates. Key = direction+status+kind
       within ten minutes; the newest entry drives the card and the
       call-back, the first timestamp gives the range. */
    const grouped: { entry: CallLogEntry; ts: number; count: number; firstTs: number }[] = []
    for (const x of flat) {
      const prev = grouped[grouped.length - 1]
      if (prev
        && prev.entry.direction === x.entry.direction
        && prev.entry.status === x.entry.status
        && prev.entry.type === x.entry.type
        && x.ts - prev.ts < 10 * 60_000) {
        prev.count += 1
        prev.ts = x.ts
        prev.entry = x.entry
      } else {
        grouped.push({ ...x, count: 1, firstTs: x.ts })
      }
    }
    return grouped
  }, [callLog, oldestLoadedTs])

  const pinnedSet = React.useMemo(
    () => new Set(thread.pinnedList.map((p: any) => String(p.id))),
    [thread.pinnedList],
  )

  /* `_pinned` is stamped HERE, not in renderRow: the stamped object's identity
     then survives every render in which messages and pins are untouched, which
     is what lets MessageBubble's memo hold for pinned rows too. The WeakMap
     keeps that promise across REBUILDS as well — keyed by the stored message
     object, so a clone is minted once per message identity, not once per
     arriving frame (which broke the memo for every visible pinned bubble). */
  const pinnedClones = React.useRef(new WeakMap<any, any>())

  /* This memo re-runs on EVERY frame of the open conversation (its dep is the
     whole message window), so the per-message time maths reads the `_ts` and
     `_day` stamps useThread bakes at ingest — parsing ISO dates here again
     cost ~4 parses per loaded message per frame. */
  const msgRows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    let lastDay = ''
    let unreadPlaced = false
    let ci = 0
    const anchor = unreadAnchor.current

    for (let i = 0; i < thread.messages.length; i++) {
      const m = thread.messages[i]
      /* Call sessions slot in chronologically, BEFORE this message's day
         divider — a call from yesterday must not land under today's chip. */
      const mts = m._ts ?? Date.parse(m.createdAt)
      while (ci < callMerges.length && callMerges[ci].ts <= mts) {
        out.push({ type: 'call', key: `call-${callMerges[ci].entry.callId}`, entry: callMerges[ci].entry, count: callMerges[ci].count, firstTs: callMerges[ci].firstTs })
        ci++
      }
      const day = m._day ?? dayKey(m.createdAt)
      if (day && day !== lastDay) {
        lastDay = day
        out.push({ type: 'day', key: `d-${day}`, iso: m.createdAt })
      }

      if (!unreadPlaced && anchor && String(m.senderId) !== String(myId) && gtId(m.id, anchor)) {
        unreadPlaced = true
        out.push({ type: 'unread', key: 'unread' })
      }

      if (m.isSystem) { out.push({ type: 'system', key: String(m.id), message: m }); continue }

      const prev = thread.messages[i - 1]
      const next = thread.messages[i + 1]
      const tsOf = (x: any) => x._ts ?? Date.parse(x.createdAt)
      const near = (a: any, b: any) =>
        !!a && !!b && !a.isSystem && !b.isSystem
        && String(a.senderId) === String(b.senderId)
        && Math.abs(tsOf(b) - tsOf(a)) < RUN_GAP_MS

      let row = m
      if (pinnedSet.has(String(m.id))) {
        row = pinnedClones.current.get(m)
        if (!row) { row = { ...m, _pinned: true }; pinnedClones.current.set(m, row) }
      }

      out.push({
        type: 'msg',
        key: String(m.id),
        message: row,
        runStart: !near(prev, m),
        runEnd: !near(m, next),
      })
    }

    /* Calls newer than the newest message — the just-ended call's card. */
    for (; ci < callMerges.length; ci++) {
      out.push({ type: 'call', key: `call-${callMerges[ci].entry.callId}`, entry: callMerges[ci].entry, count: callMerges[ci].count, firstTs: callMerges[ci].firstTs })
    }

    return out
  }, [thread.messages, pinnedSet, myId, callMerges])

  /* The typing row moved OUT of the data entirely — it renders as the list
     footer, whose leaf holds the useTyping subscription. A typing frame now
     re-renders that footer (and the header subtitle leaf), never this
     1300-line screen body. */
  const rows = msgRows

  /* ---------------- read marker ---------------- */

  const newestId = React.useMemo(() => {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (!isTmpId(thread.messages[i].id)) return String(thread.messages[i].id)
    }
    return null
  }, [thread.messages])

  /* FOCUS-gated: this screen can exist without ever having been opened —
     router.prefetch mounts it under the inbox to warm the thread — and a
     mount-time mark would clear an unread count the user never looked at.
     markReadUpTo's own AppState guard covers backgrounding; focus covers
     "mounted but not the screen on top". */
  const focused = useIsFocused()
  const markReadUpTo = thread.markReadUpTo
  React.useEffect(() => {
    if (focused && atBottom && newestId) markReadUpTo(newestId)
  }, [focused, atBottom, newestId, markReadUpTo])

  /* Spoken arrival for the OPEN thread (VoiceOver): the app-wide banner
     rightly suppresses itself here — you are looking at the thread — which
     left reader users with no arrival signal at all; the typing dots are
     decorative. announce() is normally the toast layer's alone (its header);
     this is the sanctioned second voice for the same reason the banners got
     one, and it queues rather than interrupts. Seeded on mount so history is
     never read back. */
  const lastSpoken = React.useRef<string | null>(null)
  React.useEffect(() => {
    const m = thread.messages[thread.messages.length - 1]
    if (!m || isTmpId(m.id) || String(m.senderId) === String(myId)) return
    const id = String(m.id)
    if (lastSpoken.current === id) return
    const seeding = lastSpoken.current === null
    lastSpoken.current = id
    if (seeding || !focused) return
    announce(`${dir.nameOf(m.senderId) || 'New message'}: ${m.body || 'sent an attachment'}`)
  }, [thread.messages, focused, myId, dir])

  /* A message can land while the app is BACKGROUNDED with the stream still
     alive: the row merges, `newestId` settles, the effect above fires — and
     markReadUpTo correctly refuses (you cannot read what you cannot see). On
     resume nothing re-triggers it, so the thread sat read on screen but
     unread on the server, badge stuck, sender never getting the receipt. The
     foreground transition is that missing trigger; refs keep the listener
     identity-stable. */
  const newestIdRef = React.useRef<string | null>(null)
  React.useEffect(() => { newestIdRef.current = newestId }, [newestId])
  React.useEffect(() => {
    let last: AppStateStatus = AppState.currentState
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' && last !== 'active' && focusedRef.current && atBottomRef.current && newestIdRef.current) {
        markReadUpTo(newestIdRef.current)
      }
      last = next
    })
    return () => sub.remove()
  }, [markReadUpTo])

  /* ---------------- jump ---------------- */

  /* The scroll is deferred through state rather than done inline: paging
     toward a message mutates the store, and the `rows` this callback closed
     over is the list from BEFORE that page landed — looking the index up here
     would always miss on exactly the case the jump exists for. */
  const [pendingScroll, setPendingScroll] = React.useState<string | null>(null)

  const scrollToMessage = React.useCallback(async (messageId: string) => {
    setHighlight(String(messageId))
    setTimeout(() => setHighlight(null), 1000)
    if (!thread.has(messageId)) {
      setJumping(true)
      const found = await thread.pageToward(messageId)
      setJumping(false)
      /* Past the paging window: fetch it alone so the quoted content can at
         least be shown rather than nothing. */
      if (!found) await thread.hydrate(messageId).catch(() => null)
    }
    setPendingScroll(String(messageId))
    /* The stable methods, not `thread` — its identity tracks the messages. */
  }, [thread.has, thread.pageToward, thread.hydrate])

  React.useEffect(() => {
    if (!pendingScroll) return
    const index = rows.findIndex(r => r.type === 'msg' && r.key === pendingScroll)
    if (index < 0) return
    void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 })
    setPendingScroll(null)
  }, [pendingScroll, rows])

  const jumpedTo = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!jump || thread.loading || jumpedTo.current === String(jump)) return
    jumpedTo.current = String(jump)
    void scrollToMessage(String(jump))
  }, [jump, thread.loading, scrollToMessage])

  /* ---------------- sending ---------------- */

  const handleSendError = React.useCallback((e: any) => {
    const code = codeOf(e)
    if (startCooldown(e)) return
    if (isNsfwBlocked(e)) {
      /* The failed bubble itself renders the gate's message with its Remove
         affordance (MessageBubble) — a toast on top would double-report, and
         the progress bar has already stood down in sendAssets' finally.
         MEDIA_MODERATION_UNAVAILABLE deliberately falls through: it is
         transient, so the bubble keeps its tap-to-retry chip and the toast
         carries the server's "try again in a moment". */
      return
    }
    if (code === 'BLOCKED' || code === 'REQUEST_LIMIT_REACHED') {
      setPermanentBlock(chatError(e, 'You can’t message this account.'))
      return
    }
    if (code === 'CONTENT_BLOCKED_BY_POLICY' || code === 'CONTENT_REJECTED') {
      /* No retry affordance: the same body produces the same rejection. */
      setNotice(errorText(e, 'This message was not sent.'))
      return
    }
    if (code === 'READ_ONLY' || code === 'ADMINS_ONLY' || code === 'NOT_A_MEMBER') {
      setPermanentBlock(chatError(e, 'You can’t post here.'))
      return
    }
    toast.error(chatError(e, 'Could not send'))
  }, [startCooldown])

  const doSend = React.useCallback(async (body: string) => {
    setNotice(null)
    const replyToId = reply?.id ?? null
    setReply(null)
    try {
      await thread.send({ body, replyToId })
      setLastSentAt(Date.now())
      /* Never re-save a draft you have just sent — the server clears the row on
         send and a late debounce would bring it straight back. */
      if (draftTimer.current) clearTimeout(draftTimer.current)
      api.chat.drafts.discard(convId).catch(() => {})
    } catch (e) { handleSendError(e) }
  }, [thread, reply?.id, convId, handleSendError])

  const doEdit = React.useCallback(async (body: string) => {
    const target = editing
    setEditing(null)
    if (!target) return
    try { await thread.edit(target.id, body) }
    catch (e) { toast.error(chatError(e, 'Could not edit this message')) }
  }, [editing, thread])

  /* An upload runs for as long as the file is large and the uplink is slow —
     far past the ~6s typing TTL — so a ONE-SHOT activity signal showed
     "sending a photo…" briefly, went blank mid-transfer, and never came back.
     Re-signal on an interval while the send is in flight; the provider's
     throttle collapses these to one POST per 3s. One slot, latest activity
     wins — the same contract the one-shot stop already had for overlapping
     sends. */
  /* Live upload progress for the bar above the composer; null when idle.
     The AbortController lets its ✕ cancel the send mid-flight. */
  const [upProgress, setUpProgress] = React.useState<number | null>(null)
  const upAbort = React.useRef<AbortController | null>(null)
  const activityTimer = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const startActivity = React.useCallback((activity: string) => {
    sendTyping(convId, true, activity)
    if (activityTimer.current) clearInterval(activityTimer.current)
    activityTimer.current = setInterval(() => sendTyping(convId, true, activity), ACTIVITY_KEEPALIVE_MS)
  }, [convId, sendTyping])
  const stopActivity = React.useCallback(() => {
    if (activityTimer.current) { clearInterval(activityTimer.current); activityTimer.current = null }
    sendTyping(convId, false)
  }, [convId, sendTyping])
  React.useEffect(() => () => { if (activityTimer.current) clearInterval(activityTimer.current) }, [])

  const sendAssets = React.useCallback(async (rawAssets: any[], activity: string) => {
    /* Fail fast on doomed files (size caps / blocked types) BEFORE any bytes
       move — the server re-checks everything authoritatively. */
    const { ok: assets, rejected } = checkAssets(rawAssets, 'chat')
    rejected.forEach(v => toast.warn(`${v.asset.fileName || v.asset.name || 'File'}: ${v.reason}`))
    if (!assets.length) return
    startActivity(activity)
    const files = assets.map(a => toUploadFile(a))
    const optimisticMedia = assets.map((a: any) => ({
      kind: a.type === 'video' || /video/i.test(a.mimeType || '') ? 'VIDEO' : 'IMAGE',
      url: a.uri,
      thumbnailUrl: a.uri,
      width: a.width ?? null,
      height: a.height ?? null,
      fileName: a.fileName || '',
      bytes: a.fileSize ?? 0,
      mime: a.mimeType || '',
    }))
    const controller = new AbortController()
    upAbort.current = controller
    setUpProgress(0)
    try {
      await thread.sendFiles({
        files, optimisticMedia, replyToId: reply?.id ?? null,
        onProgress: setUpProgress, signal: controller.signal,
      })
    }
    catch (e: any) { if (e?.name !== 'AbortError') handleSendError(e) }
    finally { setUpProgress(null); upAbort.current = null; stopActivity(); setReply(null); setLastSentAt(Date.now()) }
  }, [thread, reply?.id, startActivity, stopActivity, handleSendError])

  const pick = React.useCallback(async (kind: AttachKind) => {
    try {
      if (kind === 'photos') {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1,
        })
        if (res.canceled || !res.assets?.length) return
        const ready = await prepareUploads(res.assets as any)
        await sendAssets(ready, res.assets[0].type === 'video' ? 'SENDING_VIDEO' : 'SENDING_PHOTO')
        return
      }
      if (kind === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync()
        if (!perm.granted) { toast.warn('Allow camera access in Settings to take a photo.'); return }
        const res = await ImagePicker.launchCameraAsync({ quality: 1 })
        if (res.canceled || !res.assets?.length) return
        const ready = await prepareUploads(res.assets as any)
        await sendAssets(ready, 'SENDING_PHOTO')
        return
      }
      if (kind === 'document') {
        const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
        if (res.canceled || !res.assets?.length) return
        const { ok: docs, rejected } = checkAssets(res.assets, 'chat')
        rejected.forEach(v => toast.warn(`${v.asset.name || 'File'}: ${v.reason}`))
        if (!docs.length) return
        startActivity('SENDING_FILE')
        const controller = new AbortController()
        upAbort.current = controller
        setUpProgress(0)
        try {
          await thread.sendFiles({
            files: docs.map((a: any) => toUploadFile(a)),
            optimisticMedia: docs.map((a: any) => ({
              kind: 'FILE', url: a.uri, fileName: a.name, bytes: a.size ?? 0, mime: a.mimeType || '',
            })),
            replyToId: reply?.id ?? null,
            onProgress: setUpProgress, signal: controller.signal,
          })
        } catch (e: any) { if (e?.name !== 'AbortError') handleSendError(e) }
        finally { setUpProgress(null); upAbort.current = null; stopActivity(); setReply(null); setLastSentAt(Date.now()) }
        return
      }
      if (kind === 'contact') {
        const perm = await Contacts.requestPermissionsAsync()
        if (!perm.granted) { toast.warn('Allow contacts access in Settings to share a contact.'); return }
        const picked: any = await Contacts.presentContactPickerAsync()
        if (!picked) return
        await thread.send({
          type: 'CONTACT',
          /* Same reply parity as every other payload — a contact sent as a
             reply must keep the strip. */
          replyToId: reply?.id ?? null,
          contact: {
            firstName: picked.firstName || picked.name || 'Contact',
            lastName: picked.lastName || '',
            phone: picked.phoneNumbers?.[0]?.number || '',
          },
        }).catch(handleSendError)
        setReply(null)
        setLastSentAt(Date.now())
        return
      }
      if (kind === 'location') {
        /* Asked at the TAP, never on mount: the permission copy promises the
           position is read only when you choose to attach it. */
        setNotice(null)
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted) {
          setNotice(perm.canAskAgain
            ? 'Nothing was sent — sharing a pin needs permission to read your position once.'
            : 'Location is off for Hikmah Web. Turn it on in Settings to share where you are.')
          return
        }
        startActivity('SENDING_LOCATION')
        try {
          /* One fix, not a watch. Balanced is a street-level answer in a second
             or two; Highest waits on GPS for a precision a shared pin never
             needed. `live` stays false because nothing here subscribes. */
          const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .catch(() => null)
          if (!fix) {
            /* Permission granted and still no fix: Location is off system-wide,
               or the radio never answered. Not the same failure as a rejected
               send, so it does not borrow that copy. */
            setNotice('Your position could not be read. Check that Location is on, then try again.')
            return
          }
          const { latitude, longitude } = fix.coords
          const place = await Location.reverseGeocodeAsync({ latitude, longitude })
            .then(rows => rows[0] ?? null)
            /* A geocoder outage costs the label, not the pin. */
            .catch(() => null)
          await thread.send({
            type: 'LOCATION',
            replyToId: reply?.id ?? null,
            location: {
              latitude,
              longitude,
              name: place ? (place.name || place.street || place.city || '') : '',
              address: addressLine(place),
              live: false,
            },
          })
          setReply(null)
          setLastSentAt(Date.now())
        } catch (e) { handleSendError(e) }
        finally { stopActivity() }
        return
      }
      if (kind === 'poll') { pollSheet.open(); return }
      if (kind === 'schedule') { scheduleSheet.open(''); return }
    } catch (e) {
      toast.error(chatError(e, 'Could not attach that'))
    }
  }, [reply?.id, sendAssets, startActivity, stopActivity, thread, handleSendError, pollSheet, scheduleSheet])

  /* ---------------- per-message actions ---------------- */

  /* Ref mirrors keep the row handlers below IDENTITY-STABLE while still
     reading the current value at call time — the same trick the realtime
     hooks use for their event handlers. */
  const localReactionsRef = React.useRef(localReactions)
  localReactionsRef.current = localReactions
  const selectModeRef = React.useRef(selectMode)
  selectModeRef.current = selectMode

  const toggleReaction = React.useCallback(async (message: any, emoji: string) => {
    const already = (message.reactions || []).find((r: any) => r.emoji === emoji && r.reactedByMe)
      || localReactionsRef.current[String(message.id)] === emoji
    setLocalReactions(prev => ({ ...prev, [String(message.id)]: already ? '' : emoji }))
    try {
      /* The tapped emoji IS the one being removed — the hint lets the chip
         count fall optimistically. */
      if (already) await thread.unreact(message.id, emoji)
      else await thread.react(message.id, emoji)
    } catch (e) {
      setLocalReactions(prev => ({ ...prev, [String(message.id)]: already ? emoji : '' }))
      toast.warn(chatError(e, 'Could not react'))
    }
  }, [thread.react, thread.unreact])

  const runAction = React.useCallback(async (message: any, action: MessageAction) => {
    switch (action) {
      case 'reply': setReply(message); break
      case 'copy':
        await Clipboard.setStringAsync(String(message.body || ''))
        toast.ok('Copied')
        break
      case 'forward': router.push(`/chat/forward?messageId=${message.id}`); break
      case 'star':
      case 'unstar':
        await thread.toggleStar(message.id, action === 'star')
          .catch(e => toast.warn(chatError(e, 'Could not update the star')))
        break
      case 'pin':
      case 'unpin':
        await thread.setPinned(message.id, action === 'pin')
          .catch(e => toast.warn(chatError(e, 'Could not update the pin')))
        break
      case 'edit': setEditing(message); break
      case 'deleteMe':
      case 'deleteAll':
        await thread.remove(message.id, action === 'deleteAll' ? 'everyone' : 'me')
          .catch(e => toast.error(chatError(e, 'Could not delete this message')))
        break
      case 'info': router.push(`/chat/${convId}/seen/${message.id}`); break
      case 'select': setSelectMode(true); setSelected([String(message.id)]); break
      case 'report': reportSheet.open(message); break
      default: break
    }
    /* useSheetState rebuilds its wrapper object every render; `open` is the
       stable piece, so it is the dependency. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, router, convId, reportSheet.open])

  /* Filed directly with the message ID only — never through /report, whose
     route params are persisted navigation state where a message body must not
     travel. Dedup is server-side: an open (target, reason) report is returned
     as-is, so a double tap is harmless. */
  const reportMessage = React.useCallback(async (message: any, reason: string) => {
    try {
      /* MESSAGE ids are Snowflake STRINGS — the wire's `targetId` is a UUID
         field that rejects them, so they travel in `targetRef` (settings.js
         §safety.report; SubmitReportRequest wants exactly one of id/ref). */
      await api.settings.safety.report({
        targetType: 'MESSAGE',
        targetId: undefined,
        targetRef: String(message.id),
        reason,
        details: undefined,
      })
      toast.ok("Thanks, we'll review it")
    } catch (e) {
      toast.error(errorText(e))
    }
  }, [])

  const openFile = React.useCallback(async (media: any) => {
    if (!media?.url) return
    try {
      if (!(await Sharing.isAvailableAsync())) { toast.warn('Sharing is not available on this device.'); return }
      /* shareAsync takes a FILE uri — the remote url never opens a sheet. */
      await Sharing.shareAsync(await toLocalFile(media.url, media.name))
    } catch { toast.warn('Could not open this file.') }
  }, [])

  /* ---------------- composer handlers ---------------- */

  /* All useEvent: Composer is React.memo'd, and an inline arrow per prop
     would break that memo on every render of this screen — which include
     every inbox mutation app-wide via useChat(). Stable identity, fresh
     values. */
  const onComposerSend = useEvent((body: string) => { void doSend(body) })
  const onComposerConfirmEdit = useEvent((body: string) => { void doEdit(body) })
  const onComposerSendVoice = useEvent((recording: RecordingResult) => {
    startActivity('SENDING_VOICE')
    thread.sendFiles({
      files: [{ uri: recording.uri, name: recording.name, type: recording.type }],
      durationMs: recording.durationMs,
      waveform: recording.waveform,
      optimisticMedia: [{ kind: 'VOICE', url: recording.uri, durationMs: recording.durationMs, waveform: recording.waveform }],
      replyToId: reply?.id ?? null,
    })
      .then(() => setLastSentAt(Date.now()))
      .catch(handleSendError)
      .finally(() => { stopActivity(); setReply(null) })
  })
  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  const onComposerTyping = useEvent((active: boolean, activity?: string) => sendTyping(convId, active, activity))
  const onComposerAttach = useEvent(() => tray.open())
  const onComposerSchedule = useEvent((body: string) => scheduleSheet.open(body))

  /* ---------------- render ---------------- */

  const blockReason = permanentBlock ?? composerBlockReason(convo)
  /* `myStatus` is ACTIVE|RESTRICTED|LEFT|REMOVED — there is NO pending value
     on the conversation (MemberStatus enum). A pending message request is its
     own resource keyed by conversationId (message-requests.md), so the banner
     reads the Requests state instead. */
  const pendingRequest = requests.some(
    (r: any) => String(r.conversationId) === convId && r.status === 'PENDING',
  )
  /* The typing/presence line lives in the ThreadSubtitle leaf below — its
     stores re-render that caption, not this screen. */

  /* One handler per ACTION, shared by every row. MessageBubble's memo only
     holds if the function props it receives are the same between renders —
     per-row arrows would hand every visible bubble fresh props on every
     screen render (and this screen renders on its own thread's every frame).
     The message rides the callback's first argument instead. */
  const onBubbleLongPress = React.useCallback((m: any, layout: { y: number; height: number }) => {
    if (selectModeRef.current) return
    /* `m` is the row's stamped message, so a pinned bubble's menu already
       knows it is pinned. */
    menu.open({ message: m, y: layout.y, height: layout.height, mode: 'full' })
    /* useSheetState rebuilds its wrapper object every render; `open` is the
       stable piece, so it is the dependency. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open])

  /* A quick tap on a plain-text bubble: the reaction bar alone, never the
     action sheet — that split is the point of onLongPress vs onTapReact. */
  const onBubbleTapReact = React.useCallback((m: any, layout: { y: number; height: number }) => {
    if (selectModeRef.current) return
    menu.open({ message: m, y: layout.y, height: layout.height, mode: 'reactOnly' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open])

  const onReplyTo = React.useCallback((m: any) => setReply(m), [])

  const onQuickReact = React.useCallback((m: any) => {
    fireHaptic('light')
    /* The double-tap default is the HEART — the Instagram reflex. */
    void toggleReaction(m, '❤️')
  }, [toggleReaction])

  const onReplyPress = React.useCallback((target: string) => { void scrollToMessage(target) }, [scrollToMessage])

  /* The scroll handler runs on the JS thread every 64ms while a finger is
     down. Ref-gating the setState means it costs a comparison per event
     instead of a screen re-render — and a screen re-render here re-invokes
     renderRow for every mounted cell. */
  const atBottomRef = React.useRef(true)
  const onListScroll = React.useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const next = contentOffset.y + layoutMeasurement.height >= contentSize.height - 120
    if (next === atBottomRef.current) return
    atBottomRef.current = next
    setAtBottom(next)
  }, [])

  /* By reference, never a freshly-minted element: FlashList re-renders the
     header ViewHolder whenever its identity moves. */
  const listHeader = React.useMemo(() => (
    thread.loadingOlder ? <Spinner /> : thread.hasMore ? <View style={styles.topPad} /> : (
      <View style={styles.threadStart}>
        <Text variant="caption" tone="muted" align="center">
          Messages are delivered to members of this conversation.
        </Text>
      </View>
    )
  ), [thread.loadingOlder, thread.hasMore])

  const onMediaPress = React.useCallback((m: any, index: number) => {
    router.push(`/chat/${convId}/viewer?messageId=${m.id}&index=${index}`)
  }, [router, convId])

  const onToggleReaction = React.useCallback((m: any, emoji: string) => { void toggleReaction(m, emoji) }, [toggleReaction])

  const onOpenReactionDetail = React.useCallback((m: any) => {
    void thread.hydrate(m.id).catch(() => {})
  }, [thread.hydrate])

  const onRetry = React.useCallback((m: any) => {
    thread.retry(m.id).catch(handleSendError)
  }, [thread.retry, handleSendError])

  /* A bubble whose send can never succeed (the image gate's refusal) offers
     Remove instead of retry — this is that Remove. */
  const onDiscard = React.useCallback((m: any) => {
    thread.drop(m.id)
  }, [thread.drop])

  /* The contact card's two actions. Message = the same createDirect the
     share sheet uses; Save = the SYSTEM contact form, prefilled — the OS does
     the writing, so no WRITE_CONTACTS permission enters the manifest. */
  const onContactMessage = React.useCallback(async (userId: string) => {
    try {
      const convo: any = await api.chat.conversations.createDirect(userId)
      if (convo?.id) router.push(`/chat/${convo.id}`)
    } catch (e) { toast.error(errorText(e)) }
  }, [router])

  const onContactSave = React.useCallback(async (contact: any) => {
    try {
      const perm = await Contacts.requestPermissionsAsync()
      if (!perm.granted) { toast.warn('Allow contacts access in Settings to save a contact.'); return }
      await Contacts.presentFormAsync(null, {
        contactType: Contacts.ContactTypes.Person,
        name: contact?.fullName || 'Contact',
        firstName: contact?.firstName || contact?.fullName || 'Contact',
        lastName: contact?.lastName || '',
        phoneNumbers: contact?.phone ? [{ label: 'mobile', number: contact.phone }] : undefined,
      } as any)
    } catch (e) {
      /* The user backing out of the system form is not an error worth copy. */
      const msg = String((e as any)?.message || '')
      if (!/cancel/i.test(msg)) toast.error(errorText(e))
    }
  }, [])

  const onVote = React.useCallback((m: any, indexes: number[]) => {
    thread.vote(m.id, indexes).catch(e => toast.warn(chatError(e, 'Could not vote')))
  }, [thread.vote])

  const onRetractVote = React.useCallback((m: any) => {
    thread.retractVote(m.id).catch(e => toast.warn(chatError(e, 'Could not retract')))
  }, [thread.retractVote])

  const onClosePoll = React.useCallback((m: any) => {
    thread.closePoll(m.id).catch(e => toast.warn(chatError(e, 'Could not close the poll')))
  }, [thread.closePoll])

  const onSelectToggle = React.useCallback((m: any) => setSelected(prev => (
    prev.includes(String(m.id)) ? prev.filter(x => x !== String(m.id)) : [...prev, String(m.id)]
  )), [])

  const onAvatarPress = React.useCallback((m: any) => {
    const card = dir.userOf(m.senderId)
    if (card?.handle) router.push(`/u/${card.handle}`)
  }, [dir, router])

  /* The bubbles get SCALARS, never `convo`. That row is patched in place on
     every arriving message and every read receipt, so a `convo` in renderRow's
     dependency array meant one cosmetic frame re-rendered every visible
     bubble. These four are the whole of what a bubble reads off it, and each
     is a primitive that only moves when the bubble's own rendering changes. */
  const convoIsGroup = !!convo?.isGroup
  const peerLastReadMessageId = convo?.peerLastReadMessageId ?? null
  const peerLastDeliveredMessageId = convo?.peerLastDeliveredMessageId ?? null
  const amAdmin = isAdmin(convo)
  /* Measured once here rather than through a useWindowDimensions subscription
     inside each of the hundreds of mounted bubbles. */
  const { width: screenW } = useWindowDimensions()
  const bubbleMaxWidth = Math.min(screenW * 0.78, 520)

  /* By reference — the footer leaf owns the typing subscription. */
  const typingFooter = React.useMemo(
    () => <ThreadTypingFooter convId={convId} nameOf={dir.nameOf} isGroup={convoIsGroup} />,
    [convId, dir.nameOf, convoIsGroup],
  )

  /* useEvent: renderRow depends on it, and the router identity must not
     re-mint every visible row. */
  const onCallBack = useEvent((video: boolean) => {
    router.push(`/call/new?convId=${convId}&type=${video ? 'VIDEO' : 'VOICE'}`)
  })

  const renderRow = React.useCallback(({ item }: { item: Row }) => {
    switch (item.type) {
      case 'day': return <DayDivider iso={item.iso} />
      case 'unread': return <UnreadDivider />
      case 'system': return <SystemNote message={item.message} nameOf={dir.nameOf} myId={myId} />
      case 'call': return <CallSessionRow entry={item.entry} count={item.count} spanStartMs={item.firstTs} onCallBack={onCallBack} />
      case 'msg': {
        const m = item.message
        const mine = String(m.senderId) === String(myId)
        const card = dir.userOf(m.senderId)
        return (
          <MessageBubble
            message={m}
            mine={mine}
            myId={myId}
            isGroup={convoIsGroup}
            peerLastReadMessageId={peerLastReadMessageId}
            peerLastDeliveredMessageId={peerLastDeliveredMessageId}
            maxWidth={bubbleMaxWidth}
            chatSettings={chatSettings}
            skin={skin}
            runStart={item.runStart}
            runEnd={item.runEnd}
            authorName={card?.full || m.sender?.full || 'Member'}
            authorAvatar={card?.profileImage ?? null}
            localReaction={localReactions[String(m.id)] || null}
            highlighted={highlight === String(m.id)}
            selectMode={selectMode}
            selected={selected.includes(String(m.id))}
            onLongPress={onBubbleLongPress}
            onTapReact={onBubbleTapReact}
            onReply={onReplyTo}
            onQuickReact={onQuickReact}
            onReplyPress={onReplyPress}
            onMediaPress={onMediaPress}
            onFilePress={openFile}
            onToggleReaction={onToggleReaction}
            onOpenReactionDetail={onOpenReactionDetail}
            onRetry={onRetry}
            onDiscard={onDiscard}
            onVote={onVote}
            onRetractVote={onRetractVote}
            onClosePoll={m.poll && !m.poll.closed && (mine || amAdmin) ? onClosePoll : undefined}
            onSelectToggle={onSelectToggle}
            onAvatarPress={onAvatarPress}
            onContactMessage={onContactMessage}
            onContactSave={onContactSave}
          />
        )
      }
      default: return null
    }
  }, [dir, myId, convoIsGroup, peerLastReadMessageId, peerLastDeliveredMessageId, bubbleMaxWidth,
    amAdmin, chatSettings, skin, localReactions, highlight, selectMode, selected,
    onBubbleLongPress, onBubbleTapReact, onReplyTo, onQuickReact, onReplyPress, onMediaPress, openFile,
    onToggleReaction, onOpenReactionDetail, onRetry, onDiscard, onVote, onRetractVote, onClosePoll,
    onSelectToggle, onAvatarPress])

  /* `thread.gone` is the owner deleting the group or the channel out from
     under an open thread (`conversation.updated` / DELETED). `convo` is still
     loaded in that case — it is the conversation that stopped existing, not
     the fetch that failed — so it needs its own arm of this branch or the
     reader keeps typing into a composer whose every send is now a 404. */
  if (thread.gone || (convoError && !convo)) {
    return (
      <Screen>
        <Header back title="Conversation" />
        <ChatErrorState
          error={thread.gone ? CONVERSATION_GONE : convoError}
          title={codeOf(convoError) === 'NOT_A_MEMBER' ? 'You are not a member of this conversation.' : undefined}
          onRetry={thread.gone || isNotFound(convoError) ? undefined : loadConvo}
          back={() => router.replace('/(app)/(tabs)/chat')}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      {selectMode ? (
        /* Selection is modal, and the header says so: the count where the
           title was, one X out — the same grammar the notification inbox
           speaks. Calls and info have no business inside a selection. */
        <Header
          border={false}
          closeButton
          back={() => { setSelectMode(false); setSelected([]) }}
          title={`${selected.length} selected`}
        />
      ) : (
      <Header
        border={false}
        titleNode={
          <Touchable
            onPress={() => router.push(`/chat/${convId}/info`)}
            feedback="dim"
            noAutoHitSlop
            style={styles.titleRow}
          >
            <Avatar
              uri={convo?.isGroup ? convo?.avatarUrl : (dir.userOf(convo?.peer?.id)?.profileImage ?? null)}
              name={convo?.displayTitle}
              seed={convo?.isGroup ? convId : convo?.peer?.id}
              size={38}
              square={!!convo?.isGroup}
            />
            <View style={styles.titleText}>
              <Text variant="headline" numberOfLines={1} align="ui">{convo?.displayTitle || 'Conversation'}</Text>
              <ThreadSubtitle
                convId={convId}
                isGroup={!!convo?.isGroup}
                isChannel={!!convo?.isChannel}
                memberCount={convo?.memberCount ?? 0}
                peerId={convo?.peer?.id ?? null}
                lastSeenVisible={chatSettings.lastSeenVisible}
                nameOf={dir.nameOf}
              />
            </View>
          </Touchable>
        }
        back={() => router.back()}
        actions={[
          /* No calls in channels — a broadcast thread is not a room you can
             ring. The same gate rides chat/[id]/info's quick actions. */
          ...(convo?.isChannel ? [] : [
            { icon: 'call' as const, onPress: () => router.push(`/call/new?convId=${convId}&type=VOICE`), label: 'Voice call' },
            { icon: 'videoCall' as const, onPress: () => router.push(`/call/new?convId=${convId}&type=VIDEO`), label: 'Video call' },
          ]),
          { icon: 'moreVertical' as const, onPress: () => router.push(`/chat/${convId}/info`), label: 'Conversation info' },
        ]}
      />
      )}

      <PinBar
        pinned={thread.pinnedList}
        index={pinIndex}
        onCycle={(next, current) => { setPinIndex(next); void scrollToMessage(String(current.id)) }}
        onOpenList={() => router.push(`/chat/${convId}/pinned`)}
      />

      {pendingRequest ? (
        <Banner tone="warning" icon="mail" text="This person isn’t in your contacts." />
      ) : null}
      {convo?.myStatus === 'RESTRICTED' ? (
        <Banner tone="warning" icon="lock" text="You are restricted in this group — you can read but not post." />
      ) : null}
      {(convo?.disappearingSeconds || 0) > 0 ? (
        <Banner tone="neutral" icon="hourglass" text={`Disappearing messages are on for this chat.`} />
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={0}>
        <View style={[styles.flex, { backgroundColor: skin.wallpaper }]}>
          {thread.loading && !thread.messages.length ? (
            <ThreadSkeleton />
          ) : thread.error && !thread.messages.length ? (
            <ChatErrorState
              error={thread.error}
              title="Could not load messages"
              onRetry={thread.reload}
              back={() => router.replace('/(app)/(tabs)/chat')}
            />
          ) : (
            <FlashList
              ref={listRef}
              data={rows}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderRow}
              /* v2's own bottom-anchoring: no `inverted`, so the day dividers,
                 the unread rule and the typing row all read the right way up. */
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 0.2,
              }}
              onStartReached={() => { if (thread.hasMore) void thread.loadOlder() }}
              onStartReachedThreshold={0.4}
              onScroll={onListScroll}
              scrollEventThrottle={64}
              /* The platform default is 250px — under one screenful, so a fast
                 fling past a run of media messages outruns the render stack.
                 600 prepares roughly two screens of bubbles; higher would
                 decode more images up front than the reader ever sees. */
              drawDistance={600}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={listHeader}
              ListFooterComponent={typingFooter}
              /* An empty thread is a real state, not an absence — a new group,
                 or a chat the reader just cleared. It was drawn only for DMs;
                 a group fell through to `null` and the reader got a blank
                 rectangle above a live composer, which reads as a failed load.
                 Both arms now name the thread and say what to do next; the
                 group's art is its own avatar rather than a peer's face. */
              ListEmptyComponent={
                <View style={styles.emptyThread}>
                  <Avatar
                    uri={convo?.isGroup
                      ? (convo?.avatarUrl ?? null)
                      : (dir.userOf(convo?.peer?.id)?.profileImage ?? null)}
                    name={convo?.displayTitle}
                    seed={convo?.isGroup ? convo?.id : convo?.peer?.id}
                    square={!!convo?.isGroup}
                    size={96}
                  />
                  <Text variant="title3" align="center" style={{ marginTop: space.md }}>{convo?.displayTitle}</Text>
                  <Text variant="callout" tone="muted" align="center">
                    {convo?.isChannel ? 'No posts yet.'
                      : convo?.isGroup ? 'No messages yet — start the conversation.'
                        : 'Say salam 👋'}
                  </Text>
                </View>
              }
            />
          )}

          {jumping ? (
            <View style={[styles.jumpOverlay, { backgroundColor: c.scrim }]}>
              <Spinner label="Finding that message…" />
            </View>
          ) : null}

          {!atBottom ? (
            <Touchable
              onPress={() => listRef.current?.scrollToEnd({ animated: true })}
              feedback="scale"
              accessibilityLabel="Scroll to latest"
              /* Separation is a drawn rule, not a shadow (DESIGN.md §8.2):
                 the 1px borderStrong stele is what lifts it off the
                 wallpaper. The circle stays — it is an icon-only button. */
              style={[styles.scrollDown, { backgroundColor: c.surfaceRaised, borderColor: c.borderStrong }]}
            >
              <Icon name="down" size={20} color={c.textSecondary} />
            </Touchable>
          ) : null}
        </View>

        {selectMode ? (
          /* Three tab-bar-sized targets, each a full flex column — nobody
             should have to hit a 20px glyph to act on a selection. The count
             and the way out live in the header now. The dock inset keeps
             Delete off the gesture pill: Android is edge-to-edge (§8). */
          <View
            style={[
              styles.selectBar,
              { backgroundColor: c.surface, borderTopColor: c.separator, paddingBottom: dock },
            ]}
          >
            <Touchable
              onPress={async () => {
                const bodies = thread.messages
                  .filter(m => selected.includes(String(m.id)) && m.body)
                  .map(m => m.body)
                await Clipboard.setStringAsync(bodies.join('\n'))
                toast.ok('Copied')
              }}
              feedback="dim"
              disabled={!thread.messages.some(m => selected.includes(String(m.id)) && m.body)}
              accessibilityLabel="Copy selected messages"
              style={styles.selectAction}
            >
              <Icon name="copy" size={22} color={c.accent} />
              <Text variant="caption" caps={false} weight="600" color={c.accent}>Copy</Text>
            </Touchable>
            <Touchable
              onPress={() => { if (selected.length) router.push(`/chat/forward?messageIds=${selected.join(',')}`) }}
              feedback="dim"
              disabled={!selected.length}
              accessibilityLabel="Forward selected messages"
              style={styles.selectAction}
            >
              <Icon name="forwardMsg" size={22} color={c.accent} />
              <Text variant="caption" caps={false} weight="600" color={c.accent}>Forward</Text>
            </Touchable>
            <Touchable
              onPress={() => deleteSheet.open(selected)}
              feedback="dim"
              disabled={!selected.length}
              accessibilityLabel="Delete selected messages"
              style={styles.selectAction}
            >
              <Icon name="trash" size={22} color={c.danger} />
              <Text variant="caption" caps={false} weight="600" color={c.danger}>Delete</Text>
            </Touchable>
          </View>
        ) : (
          <>
          {upProgress != null && (
            <View style={[styles.upRow, { borderTopColor: c.separator, backgroundColor: c.surface }]}>
              <View style={[styles.upTrack, { backgroundColor: c.surfaceSunken }]}>
                <View style={[styles.upFill, { backgroundColor: c.accent, width: `${Math.round(upProgress * 100)}%` }]} />
              </View>
              <Text variant="caption" caps={false} color={c.textMuted}>{Math.round(upProgress * 100)}%</Text>
              <Touchable onPress={() => upAbort.current?.abort()} feedback="dim" accessibilityLabel="Cancel upload" hitSlop={8}>
                <Icon name="close" size={18} color={c.textMuted} />
              </Touchable>
            </View>
          )}
          <Composer
            disabledReason={blockReason}
            reply={reply}
            editing={editing}
            initialBody={draft}
            cooldown={cooldown}
            slowModeSeconds={slowModeFor(convo)}
            lastSentAt={lastSentAt}
            enterToSend={skin.enterToSend}
            notice={notice}
            onSend={onComposerSend}
            onConfirmEdit={onComposerConfirmEdit}
            onSendVoice={onComposerSendVoice}
            onCancelReply={onComposerCancelReply}
            onCancelEdit={onComposerCancelEdit}
            onDraftChange={onDraftChange}
            onTyping={onComposerTyping}
            onAttach={onComposerAttach}
            onSchedule={onComposerSchedule}
          />
          </>
        )}
      </KeyboardAvoidingView>

      <MessageMenu
        visible={menu.visible}
        onClose={menu.close}
        message={menu.payload?.message}
        convo={convo}
        myId={myId}
        anchorY={menu.payload?.y ?? 0}
        anchorHeight={menu.payload?.height ?? 0}
        mode={menu.payload?.mode ?? 'full'}
        onReact={emoji => { if (menu.payload) void toggleReaction(menu.payload.message, emoji) }}
        onAction={action => { if (menu.payload) void runAction(menu.payload.message, action) }}
      />

      <ActionSheet
        visible={reportSheet.visible}
        onClose={reportSheet.close}
        title="Report this message"
        actions={(REPORT_REASONS as string[][]).map(([value, label]) => ({
          label,
          onPress: () => { if (reportSheet.payload) void reportMessage(reportSheet.payload, value) },
        }))}
      />

      <AttachTray
        visible={tray.visible}
        onClose={tray.close}
        onPick={kind => { void pick(kind) }}
        allowSchedule={canSend(convo)}
      />

      <PollComposer
        visible={pollSheet.visible}
        onClose={pollSheet.close}
        onSubmit={(poll: DraftPoll) => {
          thread.send({ type: 'POLL', poll }).catch(handleSendError)
        }}
      />

      <ScheduleSheet
        visible={scheduleSheet.visible}
        onClose={scheduleSheet.close}
        body={scheduleSheet.payload ?? ''}
        convId={convId}
        replyToId={reply?.id ?? null}
      />

      <ConfirmSheet
        visible={deleteSheet.visible}
        onClose={deleteSheet.close}
        title={`Delete ${Array.isArray(deleteSheet.payload) ? deleteSheet.payload.length : 1} message${Array.isArray(deleteSheet.payload) && deleteSheet.payload.length > 1 ? 's' : ''}?`}
        message="They will be removed from your copy of this chat."
        confirmLabel="Delete for me"
        destructive
        onConfirm={() => {
          const ids: string[] = Array.isArray(deleteSheet.payload) ? deleteSheet.payload : []
          deleteSheet.close()
          setSelectMode(false)
          setSelected([])
          for (const mid of ids) {
            thread.remove(mid, 'me').catch(e => toast.error(chatError(e, 'Could not delete')))
          }
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Small local pieces.
   --------------------------------------------------------- */

/** LocationDto.address is ONE line and the server round-trips it verbatim, so
 *  it is composed here. `formattedAddress` is Android-only; everywhere else the
 *  parts are assembled, and which of them the geocoder fills varies by country,
 *  which is why every piece is optional. */
function addressLine(p: Location.LocationGeocodedAddress | null): string {
  if (!p) return ''
  if (p.formattedAddress) return p.formattedAddress
  const street = [p.streetNumber, p.street].filter(Boolean).join(' ')
  return [street, p.city || p.subregion, p.region, p.country].filter(Boolean).join(', ')
}

function Banner({ tone, icon, text }: { tone: 'warning' | 'neutral'; icon: any; text: string }) {
  const t = useTheme()
  const c = t.colors
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: tone === 'warning' ? c.warningSoft : c.surfaceSunken, borderBottomColor: c.separator },
      ]}
    >
      <Icon name={icon} size={14} color={tone === 'warning' ? c.warningText : c.textMuted} />
      <Text variant="caption" tone={tone === 'warning' ? 'warning' : 'muted'} align="ui" style={styles.flex}>{text}</Text>
    </View>
  )
}

/** Send-later. The picker writes an ISO instant; the server re-checks
 *  permission when it fires, so a queued message can still fail later. */
function ScheduleSheet({
  visible, onClose, body, convId, replyToId,
}: { visible: boolean; onClose: () => void; body: string; convId: string; replyToId: string | null }) {
  const [text, setText] = React.useState(body)
  const [minutes, setMinutes] = React.useState(60)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => { setText(body); setError(null) }, [body, visible])

  const when = new Date(Date.now() + minutes * 60_000)

  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.chat.scheduled.create(convId, {
        scheduledAt: when.toISOString(),
        clientNonce: api.chat.newNonce(),
        type: 'TEXT',
        body: text.trim(),
        replyToId: replyToId ?? undefined,
      } as any)
      toast.ok('Message scheduled')
      onClose()
    } catch (e) {
      setError(chatError(e, 'Could not schedule this message'))
    } finally { setBusy(false) }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Schedule message" maxHeightRatio={0.7}>
      <View style={styles.scheduleBody}>
        <Field label="Message" value={text} onChangeText={setText} multiline minHeight={80} />
        <View style={styles.scheduleChips}>
          {[30, 60, 180, 1440].map(m => (
            <Button
              key={m}
              label={m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : 'Tomorrow'}
              onPress={() => setMinutes(m)}
              variant={minutes === m ? 'primary' : 'secondary'}
              size="sm"
            />
          ))}
        </View>
        <Text variant="footnote" tone="muted" align="ui">
          Sends {when.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.
          Permission is checked again at send time.
        </Text>
        {error ? <Text variant="footnote" tone="danger" align="ui">{error}</Text> : null}
        <Button label="Schedule" onPress={submit} loading={busy} disabled={!text.trim() || busy} size="lg" block />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  titleText: { flex: 1 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md2, paddingVertical: space.sm2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listContent: { paddingVertical: space.sm },
  topPad: { height: 12 },
  threadStart: { paddingHorizontal: space.xxxl, paddingVertical: space.lg2 },
  emptyThread: { alignItems: 'center', paddingVertical: space.giant, gap: space.xxs },
  scrollDown: {
    position: 'absolute', end: 14, bottom: 14,
    width: 40, height: 40, borderRadius: 20, borderWidth: rule.course,
    alignItems: 'center', justifyContent: 'center',
  },
  jumpOverlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  /* No fixed height: the 58pt action columns set it, and the dock inset
     pads below them at the call site. */
  selectBar: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingHorizontal: space.sm, paddingTop: space.xxs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectAction: {
    flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: space.xs,
    paddingVertical: space.sm,
  },
  scheduleBody: { padding: space.xl, paddingTop: space.md, gap: space.md2 },
  scheduleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  upRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    paddingHorizontal: space.md2, paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  upTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  upFill: { height: '100%', borderRadius: 2 },
})
