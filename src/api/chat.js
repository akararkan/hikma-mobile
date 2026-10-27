/* =========================================================
   Chat service — /api/v1 messaging (conversations, messages,
   members, requests, presence + the single per-user SSE stream)
   ---------------------------------------------------------
   Two storage engines sit behind this one module, and they page
   differently — the shapes below are NOT interchangeable:
     - conversations / members / requests → Postgres, Spring `Page`
       (page/size) → normalised to { items, total, hasMore, page }
     - messages → Cassandra, CURSOR paging (limit clamped 1..100)
       → { items, nextCursor, hasMore }, newest → older

   Wire ids: conversations/users are UUIDs; `messageId` is a 64-bit
   Snowflake — an 18-digit long that does NOT fit in a JS number
   (355456387759665152 comes back out of a double as …150, and the
   backend 404s that). So message ids stay EXACT DECIMAL STRINGS:
   http.js quotes them at parse time, `mid()` normalises them, and
   ordering/dedupe/gap-sync go through cmpId/maxId/gteId (./ids.js).
   Never `-`, `>=` or Math.max on a message id.

   Counters (unread, reaction counts) are deliberately ABSENT from
   SSE payloads — consumers apply +1/-1 deltas locally, exactly like
   the posts/research realtime model in realtime.js.
   ========================================================= */
import { http, parseJson, saveBlob, refreshSession } from './http.js'
import { mockEnabled } from '../mock/flag.js'
import { API_BASE, assetUrl, session } from './config.js'
import { authorFrom, handleOf, timeAgo } from './adapters.js'
import { mid } from './ids.js'
/* Circular by design — ./channels.js imports the hoisted adapters below back
   out of this module. Nothing on either side reads the other's `const` at
   module scope, which is what keeps the cycle safe. */
import { channels } from './channels.js'
/* RN: the only change in this file — RN has no global EventSource.
   The shim in ../platform/sse.js keeps the exact browser surface
   (addEventListener / onmessage / onerror / readyState / close), so every
   call site below is untouched. */
import { EventSource } from '../platform/sse.js'

/* ---------- small shared helpers ---------- */

/** Spring `Page` → the list shape the rest of the app uses (same as users.js). */
const pageOf = (res, map) => ({
  items: (res?.content || res || []).map(map),
  total: res?.totalElements ?? null,
  hasMore: res ? !res.last : false,
  page: res?.number ?? 0,
})

/* Message ids are Snowflakes — 18-digit longs that do NOT fit in a JS number.
   `mid()` (./ids.js) keeps them as their exact decimal string; ordering and
   high-water comparisons go through cmpId/maxId/gteId, never `-`/`>=`. */

/** The backend clamps message page size to 1..100 — clamp here too so a caller
 *  typo becomes a sane request instead of a 400. */
const clampLimit = (n, dflt = 40) => Math.min(100, Math.max(1, Number(n) || dflt))

/* =========================================================
   Adapters — DTO → view shape. Every adapter attaches a resolved
   `_author`-style object so <Avatar>/<Verify> render unchanged.
   ========================================================= */

/** MessageMedia → view media. Backend media URLs are RELATIVE → assetUrl them
 *  or <img>/<video>/<audio> would resolve them against the frontend origin. */
function mediaFrom(m) {
  /* The multipart classifier NOW labels audio/* uploads VOICE (messages.md
     §2.2) — but the AUDIO→VOICE and FILE-with-audio-mime→VOICE rescues stay:
     every row stored before that change (and any deploy still running the old
     classifier) carries AUDIO, or FILE for a container the old classifier did
     not recognise (m4a from Safari/newer Chrome, ogg from Firefox). Normalised
     here so every surface (player, reply strip, starred, pinned label) treats
     audio as playable with one rule: a scrubber and a speed control beat a
     bare download for ANY audio. */
  const audioMime = /^audio\//i.test(m?.mime || '')
  /* Belt for rows the mime rule cannot reach: uploads from the broken
     mp4-first recorder window (and any server that stored no mime) are only
     recognisable by name. Bare audio extensions are unambiguous; `.webm` is
     both a video and an audio container, so it only counts when it wears the
     recorder's own `voice-<ts>` prefix. */
  const audioName = /\.(m4a|mp3|ogg|oga|opus|aac|wav|weba)$/i.test(m?.fileName || '')
    || /^voice-\d+\.webm$/i.test(m?.fileName || '')
  return {
    kind: (m?.kind === 'AUDIO' || (m?.kind === 'FILE' && (audioMime || audioName)))
      ? 'VOICE' : (m?.kind || 'FILE'),   // IMAGE | VIDEO | VOICE | FILE
    storageKey: m?.storageKey || null,
    url: assetUrl(m?.url || null),
    thumbnailKey: m?.thumbnailKey || null,
    thumbnailUrl: assetUrl(m?.thumbnailUrl || null),
    mime: m?.mime || '',
    bytes: m?.bytes ?? 0,
    width: m?.width ?? null,
    height: m?.height ?? null,
    durationMs: m?.durationMs ?? null,
    waveform: m?.waveform || null,              // VOICE: sampled amplitudes for the scrubber
    fileName: m?.fileName || '',
    altText: m?.altText || '',
  }
}

/** PollResponse → view poll (the in-POST poll; story A/B polls are separate).
 *  Quiz `correctOptionIndex`/`explanation` are withheld by the server until the
 *  viewer votes or the poll closes, so `null` there means "not yet revealed",
 *  never "no correct answer" — `revealed` says which it is. */
export function pollFrom(dto) {
  if (!dto) return null
  const options = (dto.options || []).map((o, i) => ({
    index: o?.index ?? i,
    text: o?.text || '',
    voterCount: o?.voterCount ?? 0,
  }))
  const total = dto.totalVoters ?? 0
  const myVotes = (dto.myVotes || []).map(Number)
  return {
    question: dto.question || '',
    options: options.map(o => ({
      ...o,
      // Share of voters, not of votes — with multi-answer polls those differ.
      pct: total > 0 ? Math.round((o.voterCount / total) * 100) : 0,
      mine: myVotes.includes(o.index),
    })),
    allowsMultipleAnswers: !!dto.allowsMultipleAnswers,
    anonymous: dto.anonymous !== false,
    quiz: !!dto.quiz,
    correctOptionIndex: dto.correctOptionIndex ?? null,
    explanation: dto.explanation || '',
    closed: !!dto.closed,
    totalVoters: total,
    myVotes,
    voted: myVotes.length > 0,
    revealed: !!dto.closed || myVotes.length > 0,
  }
}

/** LocationDto — round-tripped verbatim by the server. */
function locationFrom(l) {
  if (!l) return null
  return {
    latitude: l.latitude, longitude: l.longitude,
    name: l.name || '', address: l.address || '',
    live: !!l.live, livePeriodSeconds: l.livePeriodSeconds ?? null,
  }
}

/** ContactDto — `userId` is set when the contact is a platform user. */
function contactFrom(c) {
  if (!c) return null
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  return {
    phone: c.phone || '', firstName: c.firstName || '', lastName: c.lastName || '',
    userId: c.userId || null,
    fullName: fullName || c.phone || 'Contact',
  }
}

/** MessageResponse → view message. */
export function msgFrom(dto) {
  if (!dto) return null
  /* MessageQueryService hydrates senders through `findActiveByIdIn`, so BOTH
     name fields come back null for an account that has been deleted — the id
     is the only thing left of them. Nothing else in this DTO produces that
     shape, so it is a conclusive signal rather than a guess, and without it
     the bubble reads "Member" and offers a tap to a profile that 404s. */
  const sender = authorFrom({
    id: dto.senderId,
    username: dto.senderUsername,
    fullName: dto.senderFullName,
    deleted: !!dto.senderId && !dto.senderUsername && !dto.senderFullName,
  })
  const type = dto.type || 'TEXT'
  return {
    id: mid(dto.messageId),
    conversationId: dto.conversationId || null,
    senderId: dto.senderId || null,
    sender,
    type,
    body: dto.body || '',
    media: (dto.media || []).map(mediaFrom),
    replyToId: mid(dto.replyToId),
    replyTo: dto.replyTo
      ? {
          messageId: mid(dto.replyTo.messageId),
          senderId: dto.replyTo.senderId || null,
          type: dto.replyTo.type || 'TEXT',
          snippet: dto.replyTo.snippet || '',
          deleted: !!dto.replyTo.deleted,
        }
      : null,
    forwardedFrom: dto.forwardedFrom || null,
    mentions: dto.mentions || [],
    reactions: (dto.reactions || []).map(r => ({
      emoji: r?.emoji || '',
      count: r?.count ?? 0,
      reactedByMe: !!r?.reactedByMe,
    })),
    editedAt: dto.editedAt || null,
    deleted: !!dto.deleted,
    /* Who tombstoned it, when the server says so. The REST page does not
       carry it today (the field is read opportunistically under three
       plausible names), so the bubble's copy has to stay impersonal when it
       is null rather than assuming the sender removed their own message —
       in a group an admin very often did. The live `message.deleted` frame
       DOES carry an actor, and useThread stamps it from there. */
    deletedBy: dto.deletedBy || dto.deletedByUserId || dto.deletedByUser?.userId || null,
    // Per-VIEWER bookmark: the same row is `true` for me and `false` for
    // everyone else. Computed server-side at read time via a bulk lookup.
    starred: !!dto.starred,
    systemEvent: dto.systemEvent || null,
    createdAt: dto.createdAt || null,
    isSystem: type === 'SYSTEM' || !!dto.systemEvent,
    time: timeAgo(dto.createdAt),               // convenience label; bubbles may format their own

    /* ---- typed payloads (present only for their own `type`) ---- */
    poll: pollFrom(dto.poll),
    location: locationFrom(dto.location),
    contact: contactFrom(dto.contact),

    /* ---- channel-post extras ----
       `tags` are re-extracted server-side on every edit, so they are read from
       the row rather than parsed out of the body here — the two would drift the
       moment the backend's extractor changed.

       views / forwards / comments are `null` OUTSIDE a channel, and that null
       is meaningful: it means "this counter does not exist here", not "zero".
       `comments` is additionally null when no discussion group is linked. The
       renderer must therefore test `!= null`, never truthiness, or every
       zero-view post would silently lose its counter row. */
    tags: dto.tags || [],
    authorSignature: dto.authorSignature || null,
    views: dto.views ?? null,
    forwards: dto.forwards ?? null,
    comments: dto.comments ?? null,
    isPost: dto.views != null || dto.forwards != null,
  }
}

/** ConversationResponse → view conversation. */
export function convoFrom(dto) {
  if (!dto) return null
  const type = dto.type || 'DIRECT'
  const isChannel = type === 'CHANNEL'
  // A CHANNEL is a group-shaped conversation with an admins-only send mode —
  // it reuses the entire message log / roster / realtime path, so everything
  // that keys on `isGroup` (roster, permissions, medallion) must include it.
  const isGroup = type === 'GROUP' || isChannel
  // DMs render as a person (avatar + verify); groups render as a title + group art.
  /* A DIRECT thread with NO peer at all is the inbox's way of saying the other
     account is gone. The two producers of a ConversationResponse resolve the
     peer differently (ConversationService): the single GET uses `findById`,
     unfiltered, so it hands back the row the purge anonymized — which
     `authorFrom` recognises by its `deleted_user_<hash>` username — while the
     inbox list uses `findActiveByIdIn` and `ChatMapper.toParticipant` returns
     null for a user it did not find. Same fact, two shapes. Without this the
     rail titled the row "Conversation", which names nothing and reads as a
     bug. A DM always has two members, so there is no other way to get here. */
  const peer = dto.peer
    ? authorFrom({ id: dto.peer.userId, username: dto.peer.username, fullName: dto.peer.fullName })
    : (type === 'DIRECT' ? authorFrom({ deleted: true }) : null)
  const mutedUntil = dto.mutedUntil || null
  const at = dto.lastMessageAt || dto.createdAt || null
  const markedUnread = !!dto.markedUnread
  return {
    id: dto.id,
    type,
    isGroup,
    isChannel,
    title: dto.title || '',
    description: dto.description || '',
    avatarUrl: assetUrl(dto.avatarUrl || null),
    avatarKey: dto.avatarKey || null,
    ownerId: dto.ownerId || null,
    memberCount: dto.memberCount ?? (isGroup ? 0 : 2),
    lastMessageId: mid(dto.lastMessageId),
    lastMessageAt: dto.lastMessageAt || null,
    lastMessagePreview: dto.lastMessagePreview || '',
    settings: dto.groupSettings || null,
    // 0 = off. Anything above is the per-message Cassandra TTL applied to
    // messages sent AFTER the timer was set (existing rows are untouched).
    disappearingSeconds: dto.disappearingSeconds ?? 0,
    /* Slow mode throttles NON-ADMIN members to one message per window; the
       owner and admins are exempt, so this number alone never tells the
       composer whether to count down — pair it with `myRole`. 0 = off. */
    slowModeSeconds: dto.groupSettings?.slowModeSeconds ?? 0,
    // Present on a CHANNEL that has a discussion group linked; comments are
    // disabled (400 on POST …/comments) while it is null.
    linkedGroupId: dto.linkedGroupId || null,
    myRole: dto.myRole || 'MEMBER',
    myStatus: dto.myStatus || 'ACTIVE',
    lastReadMessageId: mid(dto.lastReadMessageId),
    lastDeliveredMessageId: mid(dto.lastDeliveredMessageId),
    unreadCount: dto.unreadCount ?? 0,
    // `markedUnread` forces the dot on even with a zero count (POST …/unread).
    hasUnread: dto.hasUnread ?? ((dto.unreadCount ?? 0) > 0 || markedUnread),
    markedUnread,
    /* The peer's own markers, so re-opening a DM paints the right tick on my
       history immediately instead of showing a lone "Sent" until the peer
       happens to emit a fresh receipt. `null` when either side has read
       receipts off — that is a privacy answer, not a missing value. */
    peerLastReadMessageId: mid(dto.peerLastReadMessageId),
    peerLastDeliveredMessageId: mid(dto.peerLastDeliveredMessageId),
    mutedUntil,
    // `mutedUntil` is an instant, not a flag — a past value means the mute lapsed.
    muted: !!mutedUntil && new Date(mutedUntil).getTime() > Date.now(),
    pinned: !!dto.pinned,
    archived: !!dto.archived,
    peer,
    createdAt: dto.createdAt || null,
    time: timeAgo(at),
    displayTitle: isGroup ? (dto.title || (isChannel ? 'Channel' : 'Group')) : (peer?.full || dto.title || 'Conversation'),
    _author: isGroup ? null : peer,
  }
}

/** MemberResponse → view member row. */
export function memberFrom(dto) {
  if (!dto) return null
  /* GroupMemberService.members() loads the roster through `findActiveByIdIn`
     too, so a deleted member is a row with a userId and no name — same
     conclusive shape as a message sender. */
  const _author = authorFrom({
    id: dto.userId,
    username: dto.username,
    fullName: dto.fullName,
    deleted: !!dto.userId && !dto.username && !dto.fullName,
  })
  return {
    userId: dto.userId,
    username: dto.username || '',
    /* From `_author`, not `handleOf(dto.username)`: the fallback there is the
       literal 'member', which put "@member" under a deleted account. */
    handle: _author.handle,
    fullName: dto.fullName || _author.full,
    role: dto.role || 'MEMBER',
    status: dto.status || 'ACTIVE',
    joinedAt: dto.joinedAt || null,
    _author,
  }
}

/** MessageRequestResponse → view request row (stranger's first messages). */
export function requestFrom(dto) {
  if (!dto) return null
  const requester = authorFrom({
    id: dto.requesterId,
    username: dto.requesterUsername,
    fullName: dto.requesterFullName,
    deleted: !!dto.requesterId && !dto.requesterUsername && !dto.requesterFullName,
  })
  return {
    id: dto.id,
    conversationId: dto.conversationId || null,
    requesterId: dto.requesterId || null,
    requester,
    status: dto.status || 'PENDING',
    firstMessageId: mid(dto.firstMessageId),
    messageCount: dto.messageCount ?? 0,
    createdAt: dto.createdAt || null,
    time: timeAgo(dto.createdAt),
  }
}

/** ReactionSummary[] → view reactions (used by react/unreact/reactions). */
const reactionsFrom = (rows) => (rows || []).map(r => ({
  emoji: r?.emoji || '', count: r?.count ?? 0, reactedByMe: !!r?.reactedByMe,
}))

/** PresenceResponse[] → normalised rows ('online' | 'offline' lowercase). */
const presenceFrom = (rows) => (rows || []).map(p => ({
  userId: p?.userId,
  status: String(p?.status || p?.presenceStatus || 'offline').toLowerCase(),
  lastSeenEpochMs: p?.lastSeenEpochMs ?? null,
}))

/** ParticipantSummary → author card (seen-by lists, call rosters). */
export function participantFrom(dto) {
  if (!dto) return null
  const _author = authorFrom({
    id: dto.userId,
    username: dto.username,
    fullName: dto.fullName,
    deleted: !!dto.userId && !dto.username && !dto.fullName,
  })
  return {
    userId: dto.userId,
    username: dto.username || '',
    handle: _author.handle,
    fullName: dto.fullName || _author.full,
    _author,
  }
}

/** ChatSettingsResponse → view settings. Absent row = every switch ON. */
export function settingsFrom(dto) {
  return {
    readReceiptsEnabled: dto?.readReceiptsEnabled ?? true,
    lastSeenVisible: dto?.lastSeenVisible ?? true,
    typingIndicatorsEnabled: dto?.typingIndicatorsEnabled ?? true,
  }
}

/** ScheduledMessageResponse → view row (send-later queue). */
export function scheduledFrom(dto) {
  if (!dto) return null
  const status = dto.status || 'PENDING'
  return {
    id: dto.id,
    conversationId: dto.conversationId || null,
    type: dto.type || 'TEXT',
    body: dto.body || '',
    media: (dto.media || []).map(mediaFrom),
    replyToId: mid(dto.replyToId),
    scheduledAt: dto.scheduledAt || null,
    status,                                     // PENDING | SENT | CANCELLED | FAILED
    pending: status === 'PENDING',
    sentMessageId: mid(dto.sentMessageId),
    createdAt: dto.createdAt || null,
  }
}

/** DraftResponse → view draft. Conversation-wide, not channel-only. */
export function draftFrom(dto) {
  if (!dto) return null
  return {
    conversationId: dto.conversationId || null,
    body: dto.body || '',
    media: (dto.media || []).map(mediaFrom),
    replyToId: mid(dto.replyToId),
    updatedAt: dto.updatedAt || null,
    empty: !dto.body && !(dto.media || []).length,
  }
}

/** ChannelSettings — one JSONB blob, replaced WHOLE by PATCH. `@JsonInclude
 *  (NON_NULL)` means unset string knobs are simply absent from the response, so
 *  every read is defaulted here and `settingsTo` sends the complete object back
 *  — a partial `settings` on a PATCH would silently reset the omitted knobs. */
export function channelSettingsFrom(s) {
  const st = s || {}
  return {
    language: st.language || '',
    country: st.country || '',
    region: st.region || '',
    accentColor: st.accentColor || '',
    emojiStatus: st.emojiStatus || '',
    wallpaper: st.wallpaper || '',
    reactionsEnabled: st.reactionsEnabled !== false,
    allowedReactions: st.allowedReactions || null,     // null = every emoji allowed
    protectedContent: !!st.protectedContent,
    hiddenSubscribers: !!st.hiddenSubscribers,
    signMessages: !!st.signMessages,
    joinByRequest: !!st.joinByRequest,
    /* Platform-admin posting freeze (ChannelSettings.frozenByAdmin — not in
       overview.md). MUST round-trip: ChannelService.update replaces the blob
       verbatim, so omitting it would deserialize to false and an owner saving
       any setting would silently unfreeze an admin-frozen channel. */
    frozenByAdmin: !!st.frozenByAdmin,
  }
}

/** View settings → the wire blob. Empty strings are dropped (NON_NULL). */
export function channelSettingsTo(s = {}) {
  const out = {
    reactionsEnabled: s.reactionsEnabled !== false,
    protectedContent: !!s.protectedContent,
    hiddenSubscribers: !!s.hiddenSubscribers,
    signMessages: !!s.signMessages,
    joinByRequest: !!s.joinByRequest,
    frozenByAdmin: !!s.frozenByAdmin,   // echo the admin freeze back — see settingsFrom
  }
  for (const k of ['language', 'country', 'region', 'accentColor', 'emojiStatus', 'wallpaper']) {
    if (s[k]) out[k] = s[k]
  }
  if (s.allowedReactions?.length) out.allowedReactions = s.allowedReactions
  return out
}

/** ChannelResponse → view channel (a CHANNEL-typed conversation + its counts). */
export function channelFrom(dto) {
  if (!dto) return null
  const myRole = dto.myRole || null
  return {
    id: dto.id,                                 // ALSO the conversationId — post/read use it
    handle: dto.handle ? String(dto.handle).replace(/^@/, '') : '',
    title: dto.title || 'Channel',
    description: dto.description || '',
    category: dto.category || '',
    publicChannel: dto.publicChannel !== false,
    verified: !!dto.verified,                   // platform-granted, not owner-settable
    subscriberCount: dto.subscriberCount ?? 0,
    postCount: dto.postCount ?? 0,
    ownerId: dto.ownerId || null,
    subscribed: !!dto.subscribed,
    /* A viewer who subscribed to a `joinByRequest` channel is NOT subscribed —
       they are waiting. Three states, not two, and the card has to say which. */
    pendingJoinRequest: !!dto.pendingJoinRequest,
    myRole,                                     // OWNER | ADMIN | MEMBER | null (not a member)
    isOwner: myRole === 'OWNER',
    isAdmin: myRole === 'OWNER' || myRole === 'ADMIN',
    avatarUrl: assetUrl(dto.avatarUrl || null),
    coverUrl: assetUrl(dto.coverUrl || null),
    settings: channelSettingsFrom(dto.settings),
    linkedGroupId: dto.linkedGroupId || null,   // the discussion group; null = comments off
    /* Ready-to-share {irc.base-url}/c/{handle} — null for PRIVATE channels
       (nothing publicly resolvable; share those via an invite link). */
    shareUrl: dto.shareUrl || null,
    createdAt: dto.createdAt || null,
    time: timeAgo(dto.createdAt),
  }
}

/* =========================================================
   SSE — the ONE per-user chat stream, /api/v1/messaging/stream
   ========================================================= */

const STREAM_PATH = '/api/v1/messaging/stream'

/* Wire event name → handler key. These are the documented `event:` names. */
const EVENT_HANDLER = {
  'connected':            'onConnected',
  'message.new':          'onMessage',
  'message.edited':       'onEdited',
  'message.deleted':      'onDeleted',
  'message.reaction':     'onReaction',
  'receipt.read':         'onRead',
  'receipt.delivered':    'onDelivered',
  'typing':               'onTyping',
  'presence':             'onPresence',
  'conversation.updated': 'onConversation',
  'member.changed':       'onMember',
  'request.new':          'onRequest',
  /* Channel-scoped frames ride this same per-user stream — there is no channel
     socket. `poll.updated` is viewer-NEUTRAL (no myVotes), `message.comment`
     carries the POST id (not the comment's), and `channel.join_request` only
     reaches admins of the channel in question. */
  'poll.updated':         'onPoll',
  'channel.join_request': 'onJoinRequest',
  'message.comment':      'onComment',
}

/* An unnamed `message` frame (or a server that switched casing) carries its own
   discriminator — MESSAGE_NEW / message.new / RECEIPT_READ … Normalise both
   spellings onto the dotted lower-case name so routing can never silently die. */
function normalizeEventName(name) {
  return String(name || '').trim().toLowerCase().replace(/_/g, '.')
}

/** Adapt a raw SSE payload into VIEW shapes — consumers never see DTOs.
 *  `type` is always the dotted wire name so a generic subscriber can switch on it. */
function adaptEvent(type, d = {}) {
  switch (type) {
    case 'message.new':
      return { type, conversationId: d.conversationId, message: msgFrom(d.message) }
    case 'message.edited':
      return { type, conversationId: d.conversationId, messageId: mid(d.messageId), body: d.body || '', editedAt: d.editedAt || null }
    case 'message.deleted':
      /* The actor rides under whichever name the server uses; all three are
         read because this is the ONLY place the deleter is ever knowable —
         the message row itself comes back without one. */
      return {
        type, conversationId: d.conversationId, messageId: mid(d.messageId),
        userId: d.userId || d.deletedBy || d.actorId || null,
      }
    case 'message.reaction':
      return { type, conversationId: d.conversationId, messageId: mid(d.messageId), userId: d.userId, emoji: d.emoji || '', added: !!d.added }
    case 'receipt.read':
      return { type, conversationId: d.conversationId, userId: d.userId, lastReadMessageId: mid(d.lastReadMessageId) }
    case 'receipt.delivered':
      return { type, conversationId: d.conversationId, userId: d.userId, messageId: mid(d.messageId) }
    case 'typing':
      return {
        type, conversationId: d.conversationId, userId: d.userId, isTyping: !!d.isTyping,
        // Optional richer state ("recording a voice note", "sending a photo").
        // `activity` is a documented event field (realtime.md §2) — TYPING ·
        // RECORDING_VOICE · SENDING_* · CHOOSING_STICKER · … — parsed leniently
        // server-side, so an absent/unknown value degrades to plain "typing…".
        activity: d.activity || d.typingActivity || null,
      }
    case 'presence':
      return {
        type, userId: d.userId,
        presenceStatus: d.presenceStatus || null,
        status: String(d.presenceStatus || 'offline').toLowerCase(),
        lastSeenEpochMs: d.lastSeenEpochMs ?? null,
      }
    case 'conversation.updated':
      return { type, conversationId: d.conversationId, conversation: d.conversation ? convoFrom(d.conversation) : null, memberChange: d.memberChange || null }
    case 'member.changed':
      return { type, conversationId: d.conversationId, userId: d.userId, memberChange: d.memberChange || null, role: d.role || null }
    case 'request.new':
      return { type, conversationId: d.conversationId, request: requestFrom(d.request) }

    /* ---- channels ---- */
    case 'poll.updated':
      /* The aggregate is viewer-neutral: `myVotes` is absent, so merging this
         wholesale over a local poll would wipe the viewer's own selection.
         Consumers must keep their `myVotes` and take only the counts. */
      return { type, messageId: mid(d.messageId), poll: pollFrom(d.poll), conversationId: d.conversationId || null }
    case 'channel.join_request': {
      const jr = d.joinRequest || d.request || null
      return {
        type,
        conversationId: jr?.conversationId || d.conversationId || null,
        joinRequest: jr,                        // raw — channels.js owns the view shape
        userId: jr?.userId || d.userId || null,
      }
    }
    case 'message.comment':
      // `messageId` is the POST's id, not the comment's — apply ±1 to that
      // post's `comments` counter (delta model, same as every other counter).
      return { type, messageId: mid(d.messageId), added: !!d.added, conversationId: d.conversationId || null }

    default:
      return { type, ...d }
  }
}

/**
 * Open the per-user chat stream. Returns an unsubscribe fn.
 *
 * Hardening (mirrors realtime.js / stories.js):
 *  - the JWT is read INSIDE connect() on every attempt — the access token rotates
 *    ~hourly via the 401 refresh, and a long-lived tab will reconnect after that;
 *    capturing it once would re-dial forever with a dead token.
 *  - both the dotted lower-case event names AND the unnamed `message` frame are
 *    handled (EventSource delivers each frame to exactly one listener, so nothing
 *    double-fires and a server-side casing change can't kill live updates).
 *  - a 45s-silence watchdog (3 missed 15s beats — overview.md §3's ">2×
 *    cadence" rule) closes BEFORE reconnecting, so we never hold two sockets
 *    and trip the per-user SSE cap.
 *  - readyState 2 (hard close — usually an expired token) self-heals like
 *    notifications.js: ONE single-flight refreshSession() per 8s window, then
 *    a fresh dial with the rotated token. Without it an idle screen re-dialed
 *    the same dead token every watchdog tick and the stream stayed dark until
 *    an unrelated REST call happened to refresh the session. `onError`
 *    still fires with the readyState for consumers that surface state.
 */
function stream(handlers = {}) {

  /* Mock mode: EventSource does not pass through request(), so nothing can
     intercept it — opening one only retry-loops against a server that is not
     running. Report connected and stay silent. */
  if (mockEnabled()) {
    let stopped = false
    const t = setTimeout(() => handlers.onConnected?.({ mock: true }), 0)
    return () => { stopped = true; clearTimeout(t) }
  }
  let es = null
  let closed = false
  let healing = false
  let lastBeat = Date.now()

  /* `parseJson`, not `JSON.parse`: a live frame carries the same 18-digit
     Snowflakes as the REST payloads, and a rounded id here would not match
     the one already in the message map. */
  const parse = (e) => { try { return parseJson(e.data) } catch { return {} } }

  const dispatch = (rawName, data) => {
    lastBeat = Date.now()
    const type = normalizeEventName(rawName || data?.eventType || data?.type)
    if (type === 'heartbeat' || !type) return
    const key = EVENT_HANDLER[type]
    const evt = adaptEvent(type, data)
    handlers[key]?.(evt)
    handlers.onAny?.(evt)          // optional firehose (ChatContext re-broadcasts to subscribers)
  }

  const connect = () => {
    if (closed) return
    const token = session.getToken()
    const url = `${API_BASE}${STREAM_PATH}` + (token ? `?token=${encodeURIComponent(token)}` : '')
    es = new EventSource(url, { withCredentials: true })

    for (const name of Object.keys(EVENT_HANDLER)) {
      es.addEventListener(name, (e) => dispatch(name, parse(e)))
      // defensive: some deploys emit the raw enum (MESSAGE_NEW) as the event name
      const upper = name.toUpperCase().replace(/\./g, '_')
      if (upper !== name) es.addEventListener(upper, (e) => dispatch(name, parse(e)))
    }
    es.addEventListener('heartbeat', () => { lastBeat = Date.now() })
    es.addEventListener('HEARTBEAT', () => { lastBeat = Date.now() })
    es.onmessage = (e) => dispatch(null, parse(e))     // unnamed frames → route by payload
    es.onerror = () => {
      const state = es?.readyState ?? 2
      handlers.onError?.(state)
      /* Hard-close heal (mirrors notifications.js): on native every error is
         terminal, and the usual cause is an expired access token — re-dialing
         with the same token is what kept the stream dark. One refresh through
         the single-flight funnel, then a fresh dial with the rotated token. */
      if (state === 2 && !closed && !healing) {
        healing = true
        refreshSession().catch(() => null).then(() => {
          if (closed) return
          try { es?.close() } catch { /* noop */ }
          lastBeat = Date.now()
          connect()
        })
        setTimeout(() => { healing = false }, 8000)   // one heal attempt per window
      }
    }
  }
  connect()

  const watchdog = setInterval(() => {
    if (closed) return
    // 3 missed 15s beats — overview.md §3's ">2× cadence" wedged-proxy rule.
    if (Date.now() - lastBeat > 45000) {
      try { es?.close() } catch { /* noop */ }
      lastBeat = Date.now()
      connect()
    }
  }, 15000)

  return () => {
    closed = true
    clearInterval(watchdog)
    try { es?.close() } catch { /* noop */ }
    es = null
  }
}

/* =========================================================
   The service object
   ========================================================= */

export const chat = {
  /* ---------- conversations (Postgres, page/size) ---------- */
  conversations: {
    async list({ page = 0, size = 30 } = {}) {
      return pageOf(await http.get('/api/v1/conversations', { page, size }), convoFrom)
    },
    async archived({ page = 0, size = 30 } = {}) {
      return pageOf(await http.get('/api/v1/conversations/archived', { page, size }), convoFrom)
    },
    async create(body) { return convoFrom(await http.post('/api/v1/conversations', body)) },
    createDirect(recipientId) { return chat.conversations.create({ type: 'DIRECT', recipientId }) },
    createGroup({ title, description, memberIds = [], avatarKey } = {}) {
      return chat.conversations.create({
        type: 'GROUP', title, memberIds,
        description: description || undefined,
        avatarKey: avatarKey || undefined,
      })
    },
    async get(id)            { return convoFrom(await http.get(`/api/v1/conversations/${id}`)) },
    // { title?, description?, avatarKey?, settings? } — null fields are left unchanged.
    async update(id, body)   { return convoFrom(await http.patch(`/api/v1/conversations/${id}`, body)) },
    remove(id)               { return http.del(`/api/v1/conversations/${id}`) },                           // 204
    read(id, lastReadMessageId) { return http.post(`/api/v1/conversations/${id}/read`, { lastReadMessageId }) },
    /** Flag the thread unread in MY inbox until I next open it. Purely
     *  personal: no receipt, nothing broadcast, cleared by the next …/read. */
    unread(id)               { return http.post(`/api/v1/conversations/${id}/unread`, {}) },
    mute(id, mutedUntil)     { return http.post(`/api/v1/conversations/${id}/mute`, { mutedUntil: mutedUntil ?? null }) },  // null = unmute
    pin(id, pinned)          { return http.post(`/api/v1/conversations/${id}/pin`, { pinned: !!pinned }) },
    archive(id, archived)    { return http.post(`/api/v1/conversations/${id}/archive`, { archived: !!archived }) },
    /** Conversation-wide auto-delete. `0` turns it off. Applies a Cassandra
     *  TTL to messages sent AFTER this call — existing rows never expire. */
    disappearing(id, seconds) { return http.post(`/api/v1/conversations/${id}/disappearing`, { seconds: Math.max(0, Number(seconds) || 0) }) },
  },

  /* ---------- messages (Cassandra, cursor paging) ---------- */
  messages: {
    /** Newest → older. Pass the previous `nextCursor` to walk back. */
    async page(convId, { cursor, limit = 40 } = {}) {
      const res = await http.get(`/api/v1/conversations/${convId}/messages`, { cursor, limit: clampLimit(limit) })
      return {
        items: (res?.items || []).map(msgFrom),
        nextCursor: res?.nextCursor ?? null,
        hasMore: !!res?.hasMore,
      }
    },
    /** Gap-sync after a reconnect: everything ASCENDING after `afterId`. */
    async sync(convId, afterId, limit = 100) {
      const rows = await http.get(`/api/v1/conversations/${convId}/messages/sync`, { after: afterId ?? undefined, limit: clampLimit(limit, 100) })
      return (rows || []).map(msgFrom)
    },
    /** `opts` forwards an AbortSignal — ChatSearchPanel cancels in-flight
     *  queries as you type so a slow earlier response can't land after a
     *  newer one and clobber the results. */
    async search(convId, q, limit = 30, opts) {
      const rows = await http.get(`/api/v1/conversations/${convId}/messages/search`, { q, limit: clampLimit(limit, 30) }, opts)
      return (rows || []).map(msgFrom)
    },
    /** `clientNonce` makes the send idempotent AND lets the sender reconcile its
     *  own optimistic bubble when the echo arrives on the stream.
     *
     *  The typed payload must MATCH `type` — a `location` on a TEXT, or a
     *  LOCATION with no `location`, is a 400. Each one is therefore attached
     *  only under its own type rather than "whatever the caller passed", so a
     *  composer that forgets to clear stale state cannot poison the send. */
    async send(convId, { clientNonce, type = 'TEXT', body, replyToId, media, silent, poll, location, contact } = {}) {
      return msgFrom(await http.post(`/api/v1/conversations/${convId}/messages`, {
        clientNonce, type, body,
        replyToId: replyToId ?? undefined,
        media: media || undefined,
        silent: silent ? true : undefined,          // delivered normally, no push
        poll:     type === 'POLL'     ? poll     : undefined,
        location: type === 'LOCATION' ? location : undefined,
        contact:  type === 'CONTACT'  ? contact  : undefined,
      }))
    },
    /** Multipart send. `replyToId` is sent best-effort: the documented parts
     *  are clientNonce/body/files, so a backend that ignores it simply posts
     *  an unthreaded attachment rather than failing the upload. `durationMs`
     *  and `waveform` ride the same way for voice notes — verified live that
     *  today's backend drops them (the echo carries neither), so until it
     *  learns the parts a receiver first paints a 0:00 clock and the
     *  synthetic id-seeded waveform; the moment the backend stores them,
     *  every receiver gets the real length and the real shape for free. */
    async sendFiles(convId, { clientNonce, body, files = [], replyToId, durationMs, waveform, onProgress, signal } = {}) {
      const fd = new FormData()
      fd.append('clientNonce', clientNonce)
      if (body) fd.append('body', body)
      if (replyToId != null) fd.append('replyToId', String(replyToId))
      if (durationMs != null) fd.append('durationMs', String(Math.round(durationMs)))
      if (waveform) fd.append('waveform', waveform)
      for (const f of files) fd.append('files', f)          // repeatable part name
      /* uploadX (RN XHR) when the caller wants progress/cancel — the native
         layer streams {uri} parts directly, no fetchable-parts shim needed.
         Without them, the expo/fetch funnel stays exactly as before. */
      return msgFrom(await (onProgress || signal
        ? http.uploadX(`/api/v1/conversations/${convId}/messages/upload`, fd, { onProgress, signal })
        : http.upload(`/api/v1/conversations/${convId}/messages/upload`, fd)))
    },
    async get(messageId)          { return msgFrom(await http.get(`/api/v1/messages/${messageId}`)) },   // full reaction detail
    async edit(messageId, body)   { return msgFrom(await http.patch(`/api/v1/messages/${messageId}`, { body })) },
    /** Two WhatsApp-style deletes behind one verb, selected by `scope`:
     *   'everyone' (default) — tombstone for ALL members (sender or a group
     *                          admin only); the stub stays in the timeline.
     *   'me'                 — hide from MY page/sync/search/starred only;
     *                          works on ANY readable message, no broadcast. */
    remove(messageId, scope = 'everyone') {
      return http.del(`/api/v1/messages/${messageId}`, { query: { scope } })                             // 204
    },
    async forward(messageId, targetConversationId, clientNonce) {
      return msgFrom(await http.post(`/api/v1/messages/${messageId}/forward`, { targetConversationId, clientNonce }))
    },
    delivered(messageId)          { return http.post(`/api/v1/messages/${messageId}/delivered`, {}) },
    async react(messageId, emoji) { return reactionsFrom(await http.post(`/api/v1/messages/${messageId}/react`, { emoji })) },
    async unreact(messageId)      { return reactionsFrom(await http.del(`/api/v1/messages/${messageId}/react`)) },
    async reactions(messageId)    { return reactionsFrom(await http.get(`/api/v1/messages/${messageId}/reactions`)) },
    pin(convId, messageId)        { return http.post(`/api/v1/conversations/${convId}/messages/${messageId}/pin`, {}) },
    unpin(convId, messageId)      { return http.del(`/api/v1/conversations/${convId}/messages/${messageId}/pin`) },
    async pinned(convId)          { return ((await http.get(`/api/v1/conversations/${convId}/pinned`)) || []).map(msgFrom) },

    /* ---- starred (private bookmarks) ----
       A star is per-viewer, invisible to everyone else, survives edits, and is
       dropped when the message is deleted for everyone. Both writes are
       idempotent; the flag rides back on `MessageResponse.starred`. */
    star(messageId)               { return http.post(`/api/v1/messages/${messageId}/star`, {}) },        // 200
    unstar(messageId)             { return http.del(`/api/v1/messages/${messageId}/star`) },             // 204
    /** My starred messages across ALL conversations, most-recently-starred
     *  first. Postgres-paged but returns a bare List, not a Spring Page. */
    async starred({ page = 0, size = 30 } = {}) {
      const rows = await http.get('/api/v1/messaging/starred', { page, size })
      return (rows || []).map(msgFrom)
    },

    /** Group "Seen by". Symmetrically gated: EMPTY if I turned read receipts
     *  off, and readers who turned theirs off are omitted. Excludes the
     *  sender. An empty array is a normal answer, not an error. */
    async seenBy(messageId) {
      const rows = await http.get(`/api/v1/messages/${messageId}/seen-by`)
      return (rows || []).map(participantFrom).filter(Boolean)
    },

    /* ---- shared-media gallery ----
       Backed by the `media_by_conversation` index (one row per attachment,
       plus LINK rows for bodies containing a URL) — NOT a timeline scan, so it
       stays cheap on a channel with fifty thousand posts. An album comes back
       once, as its single message. */
    async media(convId, { kind, before, limit = 40 } = {}) {
      const rows = await http.get(`/api/v1/conversations/${convId}/media`, {
        kind: kind || undefined, before: before || undefined, limit: clampLimit(limit),
      })
      return (rows || []).map(msgFrom).filter(Boolean)
    },

    /** EXACT tag match (ES `tags` keyword field) — `#ml` and `#machinelearning`
     *  are different tags, so this is a lookup, not a search. */
    async byTag(convId, tag) {
      const rows = await http.get(`/api/v1/conversations/${convId}/messages/by-tag`, {
        tag: String(tag || '').replace(/^#/, ''),
      })
      return (rows || []).map(msgFrom).filter(Boolean)
    },

    /* ---- in-post polls ----
       Every write broadcasts `poll.updated` with the viewer-NEUTRAL aggregate,
       so the caller keeps its own `myVotes` and takes only the counts. Quiz
       answers are final: `retractVote` 400s on a quiz by design. */
    async vote(messageId, optionIndexes) {
      const idx = (Array.isArray(optionIndexes) ? optionIndexes : [optionIndexes]).map(Number)
      return pollFrom(await http.post(`/api/v1/messages/${messageId}/poll/votes`, { optionIndexes: idx }))
    },
    async retractVote(messageId) {
      return pollFrom(await http.del(`/api/v1/messages/${messageId}/poll/votes`))
    },
    /** Author, or an admin holding `canEditMessages`. */
    async closePoll(messageId) {
      return pollFrom(await http.post(`/api/v1/messages/${messageId}/poll/close`, {}))
    },
  },

  /* ---------- drafts (per conversation, PER USER, server-side) ----------
     A half-written message follows the account across devices. One row per
     (conversation, user) — `save` overwrites rather than appends. Sending into
     the conversation clears it server-side, so the client must not re-save a
     draft it has just sent or the cleared row comes straight back. */
  drafts: {
    async get(convId) {
      // 404 is the documented answer for "no draft", not a failure — quiet
      // keeps DRAFT_NOT_FOUND out of the error log on every thread open.
      try { return draftFrom(await http.get(`/api/v1/conversations/${convId}/draft`, undefined, { quiet: [404] })) }
      catch (e) { if (e?.status === 404) return null; throw e }
    },
    async save(convId, { body, media, replyToId } = {}) {
      return draftFrom(await http.put(`/api/v1/conversations/${convId}/draft`, {
        body: body || '',
        media: media?.length ? media : undefined,
        replyToId: replyToId ?? undefined,
      }))
    },
    discard(convId) { return http.del(`/api/v1/conversations/${convId}/draft`) },    // 204, idempotent
  },

  /* ---------- scheduled (send-later) messages ----------
     The row lives in Postgres; a poller fires it through the NORMAL send path
     ~every 15s, so permission, idempotency, fan-out and realtime are identical
     to a live send. Permission is re-checked at fire time: a message queued
     before you were blocked/removed lands FAILED, never delivered. */
  scheduled: {
    async create(convId, { scheduledAt, clientNonce, type = 'TEXT', body, replyToId, media, silent } = {}) {
      return scheduledFrom(await http.post(`/api/v1/conversations/${convId}/messages/schedule`, {
        scheduledAt, clientNonce, type, body,
        replyToId: replyToId ?? undefined, media: media || undefined,
        silent: silent ? true : undefined,   // rides to fire time: no bell fan-out when it lands
      }))
    },
    /** My still-PENDING queue for this conversation, soonest first. */
    async list(convId) {
      const rows = await http.get(`/api/v1/conversations/${convId}/scheduled`)
      return (rows || []).map(scheduledFrom).filter(Boolean)
    },
    cancel(scheduledId) { return http.del(`/api/v1/messaging/scheduled/${scheduledId}`) },               // 204
  },

  /* ---------- chat privacy settings (the symmetric gates) ----------
     Read receipts and last-seen are RECIPROCAL — turning yours off stops you
     sending AND receiving that signal. Typing is one-way (off = you emit
     none, you still see others'). A user with no row behaves as all-on. */
  settings: {
    async get()          { return settingsFrom(await http.get('/api/v1/messaging/settings')) },
    /** Partial: omit a field to leave it unchanged. Returns the full state. */
    async update(patch)  { return settingsFrom(await http.put('/api/v1/messaging/settings', patch || {})) },
  },

  /* ---------- channels (Telegram-style broadcast) ----------
     A channel IS a conversation (`id` is the conversationId) with an
     admins-only send mode, so posting and reading go through the normal
     conversation/message endpoints above. Everything a conversation has no
     concept of — identity, admin rights, invite links, join requests, stats,
     the linked discussion group, stories and highlights — lives in
     ./channels.js and is hung here under the name every call site already
     uses. `api.channels` is the same object. */
  channels,

  /* ---------- realtime + misc ---------- */
  /* ---------- group membership ---------- */
  members: {
    /** Default size 30 — the documented server default for this list, kept in
     *  sync so an argument-less call and a bare GET agree. Every real call
     *  site passes an explicit size anyway (the info panel asks for 256, the
     *  whole-roster cutoff). */
    async list(convId, { page = 0, size = 30 } = {}) {
      return pageOf(await http.get(`/api/v1/conversations/${convId}/members`, { page, size }), memberFrom)
    },
    add(convId, userIds)                { return http.post(`/api/v1/conversations/${convId}/members`, { userIds }) },
    remove(convId, userId)              { return http.del(`/api/v1/conversations/${convId}/members/${userId}`) },
    setRole(convId, userId, role)       { return http.post(`/api/v1/conversations/${convId}/members/${userId}/role`, { role }) },        // ADMIN | MEMBER
    restrict(convId, userId, restricted){ return http.post(`/api/v1/conversations/${convId}/members/${userId}/restrict`, { restricted: !!restricted }) },
    leave(convId)                       { return http.post(`/api/v1/conversations/${convId}/leave`, {}) },
    transferOwner(convId, newOwnerId)   { return http.post(`/api/v1/conversations/${convId}/transfer-owner`, { newOwnerId }) },
    /** → { conversationId, token, expiresAt, maxUses, useCount } — kept raw (no view shape needed). */
    createInvite(convId, { expiresInHours, maxUses } = {}) {
      return http.post(`/api/v1/conversations/${convId}/invite-link`, {
        expiresInHours: expiresInHours ?? undefined, maxUses: maxUses ?? undefined,
      })
    },
    revokeInvite(convId)                { return http.del(`/api/v1/conversations/${convId}/invite-link`) },
    /** Redeem an invite token. The wire answer is a `JoinByTokenResponse`
     *  envelope `{ status, conversation }` — and `conversation` is NULL when
     *  the link requires approval (`PENDING_APPROVAL`: the use is consumed and
     *  a join request is filed, so this is a success, not an error). Older
     *  deployments answered with the bare conversation; the unwrap tolerates
     *  both. Callers branch on `pending`, never on the body alone. */
    async join(token) {
      const res = await http.post('/api/v1/conversations/join', { token })
      const dto = res?.conversation ?? (res?.id ? res : null)
      return {
        status: res?.status || (dto ? 'JOINED' : 'PENDING_APPROVAL'),
        pending: res?.status === 'PENDING_APPROVAL',
        conversation: dto ? convoFrom(dto) : null,
      }
    },
  },

  /* ---------- message requests (strangers get 3 pre-acceptance messages) ---------- */
  requests: {
    async list({ status = 'PENDING', page = 0, size = 20 } = {}) {
      return pageOf(await http.get('/api/v1/message-requests', { status, page, size }), requestFrom)
    },
    async count()   { const r = await http.get('/api/v1/message-requests/count'); return r?.count ?? 0 },
    accept(id)      { return http.post(`/api/v1/message-requests/${id}/accept`, {}) },
    decline(id)     { return http.post(`/api/v1/message-requests/${id}/decline`, {}) },
    block(id)       { return http.post(`/api/v1/message-requests/${id}/block`, {}) },
  },

  /* ---------- realtime + misc ---------- */
  /** Batch presence lookup. Empty input short-circuits (never send `userIds=`). */
  async presence(userIds) {
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)
    if (!ids.length) return []
    return presenceFrom(await http.get('/api/v1/presence', { userIds: ids.join(',') }))
  },
  /** `activity` (TYPING | RECORDING_VOICE | SENDING_PHOTO | SENDING_VIDEO |
   *  SENDING_VOICE | SENDING_FILE) is an optional extra the receiver renders
   *  Telegram-style; servers that only know `isTyping` simply ignore it. */
  typing(convId, isTyping, activity) {
    return http.post(`/api/v1/conversations/${convId}/typing`, {
      isTyping: !!isTyping, ...(isTyping && activity ? { activity } : {}),
    })
  },
  async unreadCount()      { const r = await http.get('/api/v1/messaging/unread-count'); return r?.count ?? 0 },
  async searchAll(q, limit = 30, opts) {
    const rows = await http.get('/api/v1/messaging/search', { q, limit: clampLimit(limit, 30) }, opts)
    return (rows || []).map(msgFrom)
  },

  /** Idempotency key for a send. randomUUID is unavailable on older Safari and
   *  in non-secure contexts, so fall back to time + randomness. */
  newNonce() {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return uuid
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  },

  stream,
}
