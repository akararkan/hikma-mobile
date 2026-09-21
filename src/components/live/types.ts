/* =========================================================
   The view shapes the live domain renders.

   src/api/chat.js is JavaScript, so nothing it returns carries
   a type. These mirror its mappers field for field —
   `liveStreamFrom`, `stageMemberFrom`, `stageStateFrom`,
   `liveChatFrom`, `streamGiftFrom`, `giftSupporterFrom`,
   `giftEntryFrom`, `recordingInfoFrom`. They are documentation
   with teeth, not a parallel model: when the two disagree, the
   mapper is right.
   ========================================================= */

export type StreamStatus = 'LIVE' | 'ENDED' | (string & {})
/** The backend enum has SEVEN states (RecordingStatus.java), not the five the
 *  streaming doc lists: PAUSED (host stopped a take mid-broadcast, still LIVE)
 *  and PROCESSING (ended; takes being joined into one file) ride the wire too. */
export type RecordingStatus =
  | 'DISABLED' | 'RECORDING' | 'PAUSED' | 'PROCESSING' | 'AVAILABLE' | 'EMPTY' | 'DELETED'

export interface LiveStream {
  id: string
  hostId: string | null
  hostUsername: string | null
  /** BARE handle — render as `@{hostHandle}`. */
  hostHandle: string
  hostDisplayName: string | null
  /** Already assetUrl()-ed by the mapper. Never prefix it again. Nullable. */
  hostAvatarUrl: string | null
  title: string
  description: string
  status: StreamStatus
  isLive: boolean
  /** HLS out — higher latency, universal reach. The fallback, never dropped. */
  playbackUrl: string | null
  /** WebRTC out — sub-second, tried first when the media engine is present. */
  whepUrl: string | null
  /** SECRET, host-only — the phone's own publish path. Never share, never log. */
  whipUrl: string | null
  /** SECRET, host-only (RTMP + stream key). Never share, never log. */
  ingestUrl: string | null
  /** The only link that is safe to hand to anyone. */
  shareUrl: string | null
  viewerCount: number
  startedAt: string | null
  endedAt: string | null
  time: string
  recordingStatus: RecordingStatus | null
  recordingAvailable: boolean
  recordingDownloadUrl: string | null
}

export type StageStatus = 'REQUESTED' | 'INVITED' | 'ACTIVE' | 'DECLINED' | 'REMOVED'

export interface StageMember {
  streamId: string | null
  userId: string | null
  username: string
  handle: string
  displayName: string
  /** Nullable on every frame measured so far — always keep initials. */
  avatarUrl: string | null
  role: string
  isHost: boolean
  status: StageStatus | null
  muted: boolean
  whepUrl: string | null
  /** SECRET — present only on YOUR OWN member. Never render, never log. */
  whipUrl: string | null
  /** SECRET — same visibility as whipUrl. */
  publishKey: string | null
  joinedAt: string | null
}

export interface StageState {
  streamId: string | null
  hostId: string | null
  /** Host first; only ACTIVE members ride this list. */
  members: StageMember[]
  guestCount: number
  maxGuests: number
  isFull: boolean
}

export interface LiveChatLine {
  streamId: string | null
  userId: string | null
  username: string
  handle: string
  text: string
  sentAt: string | null
  /** Client-only: an optimistic line waiting for its SSE echo. */
  pending?: boolean
  /** Client-only key — live chat rows have no server id. */
  key?: string
}

/** A presence ghost line ("@omar joined"), folded into the chat rail. */
export interface PresenceLine {
  key: string
  handle: string
  joined: boolean
}

export interface StreamGift {
  streamId: string | null
  senderId: string | null
  senderUsername: string
  senderHandle: string
  senderAvatarUrl: string | null
  giftId: string | null
  giftName: string
  iconKey: string | null
  coins: number
  /** The sender's authoritative running total — fold it, never accumulate. */
  senderTotalCoins: number
  sentAt: string | null
}

export interface GiftEntry {
  id: string | null
  name: string
  iconKey: string | null
  coins: number
}

export interface GiftSupporter {
  userId: string | null
  username: string
  handle: string
  displayName: string
  avatarUrl: string | null
  coins: number
  giftCount: number
}

export interface RecordingPart {
  file: string
  sizeBytes: number
  modifiedAt: string | null
  /** An AUTHED api path, not an href — fetch it through the client. */
  downloadUrl: string | null
}

export interface RecordingInfo {
  streamId: string | null
  status: RecordingStatus | null
  available: boolean
  partCount: number
  totalBytes: number
  /** The largest part — the one carrying video; the part-less download route
   *  returns exactly this file (mirrors `recordingInfoFrom`). */
  primaryFile: string | null
  parts: RecordingPart[]
}

/** Someone seen joining since the screen opened. There is no viewer-roster
 *  endpoint, so the "Watching" list is built from `stream.viewer` frames. */
export interface Watcher {
  userId: string
  handle: string
  displayName: string
  avatarUrl: string | null
  at: number
}

export const REACTION_EMOJI: Record<string, string> = {
  LIKE: '❤️', LOVE: '😍', CLAP: '👏', FIRE: '🔥', WOW: '😮',
}

export const REACTION_TYPES = ['LIKE', 'LOVE', 'CLAP', 'FIRE', 'WOW'] as const

export function emojiFor(type: string | null | undefined): string {
  return REACTION_EMOJI[String(type || '').toUpperCase()] ?? '❤️'
}

/** The catalog has no artwork endpoint; `iconKey` is a slug. Map the ones the
 *  fixture ships and fall back to a generic present rather than a blank tile. */
const GIFT_EMOJI: Record<string, string> = {
  rose: '🌹', heart: '💖', star: '🌟', crown: '👑', diamond: '💎',
  rocket: '🚀', cake: '🎂', coffee: '☕️', book: '📚', trophy: '🏆',
  fire: '🔥', clap: '👏', dove: '🕊️', lantern: '🏮', moon: '🌙',
}

export function giftEmoji(iconKey: string | null | undefined): string {
  return GIFT_EMOJI[String(iconKey || '').toLowerCase()] ?? '🎁'
}

/** Bytes → "46.0 MB". The recording manifest is the only place this is used. */
export function humanBytes(n: number | null | undefined): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Elapsed seconds → mm:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`
}
