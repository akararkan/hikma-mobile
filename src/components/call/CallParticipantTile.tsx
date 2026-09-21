/* =========================================================
   One cell of the in-call grid.

   Four participant states have to be legible at a glance and
   they are NOT the same shape of information: INVITED is
   in-progress (a ripple — the invitee is still being rung),
   JOINED is settled (a dot), LEFT is past (the whole tile
   dims), DECLINED is an answer (a word).

   A peer who is JOINED is not yet a peer you can hear: the
   mesh still has to connect, and on a network with no TURN
   server it may never. So `media` — the transport state of
   that one peer connection — is drawn in the same slot, and a
   tile only goes quiet-and-settled once the connection is up.

   `stream` is that peer's remote MediaStream. With one, the
   tile is their picture; without one it is their avatar, which
   is also the whole voice-call case. `degraded` is the build
   with no media engine at all: a labelled panel, never a black
   rectangle — a black rectangle reads as a broken camera.

   The export is React.memo'd: the room re-renders on every
   transport frame, every mute and every tick of the duration
   timer, and none of those touch a tile whose own props did not
   move. The caller keeps its side of the bargain by handing
   each tile a per-id stable `onLongPress`.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'
import { ROOM } from '@/components/live/skin'
import type { PeerState } from '@/lib/callEngine'
import { RippleDot } from './CallVisuals'
import type { CallParticipant } from './types'

export interface TileUser {
  full?: string | null
  handle?: string | null
  avatar?: string | null
}

export interface CallParticipantTileProps {
  participant: CallParticipant
  user?: TileUser | null
  /** A video call renders the "no remote video" panel; a voice call does not. */
  video: boolean
  /** True in a build with no media engine — the panel instead of a picture. */
  degraded: boolean
  /** This peer's remote MediaStream, once their tracks arrive. */
  stream?: any
  /** This peer's connection state, for the JOINED-but-not-connected gap. */
  media?: PeerState
  width: number
  height: number
  isMe?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

export const CallParticipantTile = React.memo(function CallParticipantTile({
  participant, user, video, degraded, stream, media, width, height, isMe, onPress, onLongPress,
}: CallParticipantTileProps) {
  const t = useTheme()
  const name = user?.full || (user?.handle ? `@${user.handle}` : 'Participant')
  const left = participant.state === 'LEFT'
  const declined = participant.state === 'DECLINED'
  const joined = participant.state === 'JOINED'

  /* `toURL()` is a native handle, not a value: re-derive it whenever the
     stream object changes and never render a stale one. */
  const url = React.useMemo(() => {
    try { return stream ? String(stream.toURL()) : null } catch { return null }
  }, [stream])
  const showVideo = !!url && !left && !declined
  /* The web's `.unstable` ring: a frozen tile with no marking is
     indistinguishable from a peer who stopped moving. A border, not a shadow —
     shadows never carry state, and the tile's box must not grow. */
  const unstable = joined && (media === 'disconnected' || media === 'failed')

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback={onPress || onLongPress ? 'dim' : 'none'}
      noAutoHitSlop
      accessibilityLabel={`${name}, ${STATE_LABEL[participant.state] ?? participant.state}`}
      style={[
        styles.tile,
        {
          width,
          height,
          borderRadius: t.radius.md,
          backgroundColor: ROOM.tile,
          borderWidth: unstable ? 2 : 0,
          borderColor: ROOM.danger,
          opacity: left ? 0.4 : 1,
        },
      ]}
    >
      {showVideo ? (
        <RTCView streamURL={url!} objectFit="cover" style={StyleSheet.absoluteFill} zOrder={0} />
      ) : null}

      {video && degraded && !showVideo && !left && !declined ? (
        <View style={[StyleSheet.absoluteFill, styles.videoPanel, { backgroundColor: ROOM.pane }]}>
          <Icon name="videoOff" size={26} color={ROOM.fgGhost} />
          <Text variant="micro" color={ROOM.fgFaint} align="center" style={styles.panelCopy}>
            Video needs the media engine
          </Text>
        </View>
      ) : null}

      {showVideo ? null : (
        <View style={styles.center}>
          <Avatar
            uri={user?.avatar ?? null}
            name={name}
            seed={participant.userId}
            size={Math.min(64, Math.round(Math.min(width, height) * 0.34))}
          />
        </View>
      )}

      {/* `glassStrong`, not `glass`: these chips sit on arbitrary video and
          the web's label plates run at ~.66/.78 black — the lighter chip wash
          disappears over a bright picture. */}
      <View style={[styles.nameChip, { backgroundColor: ROOM.glassStrong }]}>
        <Text variant="micro" color={ROOM.fg} numberOfLines={1} weight="600">
          {isMe ? 'You' : name}
        </Text>
      </View>

      <View style={styles.stateSlot}>
        {participant.state === 'INVITED' ? (
          <View style={[styles.statePill, { backgroundColor: ROOM.glassStrong }]}>
            <RippleDot />
            <Text variant="micro" color={ROOM.fg}>Ringing</Text>
          </View>
        ) : joined && media && MEDIA_COPY[media] ? (
          /* Sky for the in-progress transport words, the web's reconnecting
             caption colour — danger is reserved for the failed link. */
          <View style={[styles.statePill, { backgroundColor: ROOM.glassStrong }]}>
            <Text variant="micro" color={media === 'failed' ? ROOM.danger : ROOM.accent}>
              {MEDIA_COPY[media]}
            </Text>
          </View>
        ) : joined ? (
          <View style={[styles.dot, { backgroundColor: ROOM.success }]} />
        ) : declined ? (
          <View style={[styles.statePill, { backgroundColor: ROOM.glassStrong }]}>
            <Text variant="micro" color={ROOM.danger}>Declined</Text>
          </View>
        ) : left ? (
          <View style={[styles.statePill, { backgroundColor: ROOM.glassStrong }]}>
            <Text variant="micro" color={ROOM.fgMuted}>Left</Text>
          </View>
        ) : null}
      </View>
    </Touchable>
  )
})

/* Keys are the wire CallParticipantState values — INVITED is "still being
   rung", so the human word for it is still "ringing". */
const STATE_LABEL: Record<string, string> = {
  INVITED: 'ringing', JOINED: 'in the call', LEFT: 'left', DECLINED: 'declined',
}

/* `connected` and `closed` say nothing a user needs: the first is the settled
   dot, the second only ever shows for the instant before the tile changes
   state. `disconnected` is usually transient, so it reads as recovery rather
   than failure. */
const MEDIA_COPY: Partial<Record<PeerState, string>> = {
  new: 'Connecting',
  connecting: 'Connecting',
  disconnected: 'Reconnecting',
  failed: 'No connection',
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  videoPanel: { alignItems: 'center', justifyContent: 'center', gap: space.xs2, paddingHorizontal: space.md },
  panelCopy: { maxWidth: 150 },
  nameChip: {
    position: 'absolute',
    bottom: 8,
    start: 8,
    maxWidth: '70%',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  /* Top-START, like the web's per-tile state caption — the two chips share
     the leading edge so a tile reads top-to-bottom as state, then name. */
  stateSlot: { position: 'absolute', top: 8, start: 8 },
  /* Named "pill" from before QELAT; it is a chip now — the sanctioned pills
     are unread counters and LIVE badges, and "Ringing" is neither. */
  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.sm,
    height: 20,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
