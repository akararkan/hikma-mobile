/* =========================================================
   The view shapes the call domain renders, plus the one
   capability flag the whole domain branches on.

   `callFrom` / `callSignalFrom` in src/api/chat.js are the
   authority; these mirror them so a screen can be type-checked
   against a JavaScript API layer.
   ========================================================= */
import { RTCPeerConnection } from 'react-native-webrtc'

export type CallStatus = 'RINGING' | 'ONGOING' | 'ENDED' | 'DECLINED' | 'CANCELLED' | 'MISSED'
/* Wire enum CallParticipantState: INVITED (still being rung — the backend's
   default) | JOINED | DECLINED | LEFT. RINGING is a CALL status, not a member
   state — `callFrom` never emits it. */
export type ParticipantState = 'INVITED' | 'JOINED' | 'LEFT' | 'DECLINED'
export type CallType = 'VOICE' | 'VIDEO'

export interface CallParticipant {
  userId: string | null
  state: ParticipantState
  joinedAt: string | null
  leftAt: string | null
}

export interface Call {
  id: string
  conversationId: string | null
  initiatorId: string | null
  type: CallType
  video: boolean
  status: CallStatus
  ringing: boolean
  ongoing: boolean
  /** RINGING or ONGOING — the single "should the UI be up?" flag. */
  live: boolean
  participants: CallParticipant[]
  startedAt: string | null
  answeredAt: string | null
  endedAt: string | null
}

/** One relayed WebRTC frame. `payload` is opaque: the server never parses it
 *  and neither do we — it goes to the peer connection verbatim. */
export interface CallSignal {
  callId: string | null
  fromUserId: string | null
  kind: 'OFFER' | 'ANSWER' | 'ICE'
  payload: string | null
}

/* ---------------------------------------------------------
   The capability flag.

   Every media-plane control in the domain is gated on this ONE
   constant, so a build without the engine says so out loud
   rather than showing a call that looks connected and is
   silent.

   It reads the imported class rather than probing `globalThis`,
   because nothing in this app calls `registerGlobals()`. That
   is deliberate: the two WebRTC modules
   (`lib/callEngine.ts`, `lib/liveWebrtc.ts`) import what they
   need, so installing `RTCPeerConnection` and
   `navigator.mediaDevices` globally would buy nothing and risk
   colliding with the fetch and stream shims that already live
   there. A probe of `globalThis` would therefore be permanently
   false while the engine works fine — which is the failure this
   flag exists to prevent, inverted.
   --------------------------------------------------------- */
export const hasWebRTC: boolean = typeof RTCPeerConnection === 'function'

/** Elapsed seconds since an ISO instant, or 0 when it is missing/in the future. */
export function secondsSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 1000))
}

/** UUIDs here, snowflakes elsewhere — always compare as strings. */
export function sameId(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b)
}
