/* =========================================================
   StageGrid + StageTile — the multi-guest layout.

   The host tile is the host's player (WHEP, HLS behind it).
   Every guest tile is that guest's OWN WHEP subscription,
   because a guest publishes to their own MediaMTX path and the
   API publishes only a `whepUrl` for it. There is still no HLS
   URL for a guest, and rewriting ":8889/{path}/whep" into
   ":8888/{path}/index.m3u8" would be inventing an endpoint —
   forbidden, and it would break the moment the deployment
   changed a port. So a guest tile with no WebRTC (or with a
   subscription that failed) is an avatar with an authoritative
   mute badge, which is the part that is always real.

   Your own tile renders your LOCAL capture, mirrored the way a
   front camera should be. Subscribing to your own path would
   pay twice for your own picture and put your voice back
   through the earpiece a second late.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { RTCView } from 'react-native-webrtc'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'
import { MediaEngineNotice } from '@/components/call/MediaEngineNotice'
import { hasWebRTC } from '@/lib/liveWebrtc'
import { BROADCAST_PLATE, FILL, ROOM } from './skin'
import type { StageMember } from './types'

/** 1 → full bleed, 2 → two rows, 3–4 → 2×2, 5+ → 3 wide. */
export function stageColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 2) return 1
  if (count <= 4) return 2
  return 3
}

export interface StageGridProps {
  members: StageMember[]
  meId: string | null
  /** The host's player surface. Rendered inside the host's cell. */
  hostPlayer?: React.ReactNode
  /** Remote guest streams by user id — see `useStagePublishers`. */
  streams?: Record<string, any>
  /** Your own capture, when you are the one on stage. */
  localStream?: any | null
  /** Mirror the local tile (true while the front camera is selected). */
  localMirror?: boolean
  width: number
  height: number
  onTilePress?: (m: StageMember) => void
  onTileLongPress?: (m: StageMember) => void
}

export function StageGrid({
  members, meId, hostPlayer, streams, localStream, localMirror = true,
  width, height, onTilePress, onTileLongPress,
}: StageGridProps) {
  const cols = stageColumns(members.length)
  const rows = Math.max(1, Math.ceil(members.length / cols))
  /* 3, the web grid's seam (`.stg-grid{ gap:3px }`) — the split screen reads
     as one canvas with cuts, not as spaced cards. */
  const gap = 3
  const cellW = (width - gap * (cols + 1)) / cols
  const cellH = (height - gap * (rows + 1)) / rows

  return (
    <View style={[styles.grid, { width, height, padding: gap / 2 }]}>
      {members.map(m => {
        const isMe = !!meId && String(m.userId) === String(meId)
        return (
          <View key={String(m.userId ?? m.handle)} style={{ width: cellW, height: cellH, margin: gap / 2 }}>
            <StageTile
              member={m}
              isMe={isMe}
              player={m.isHost ? hostPlayer : undefined}
              stream={isMe ? localStream : streams?.[String(m.userId)]}
              mirror={isMe && localMirror}
              onPress={onTilePress ? () => onTilePress(m) : undefined}
              onLongPress={onTileLongPress ? () => onTileLongPress(m) : undefined}
            />
          </View>
        )
      })}
    </View>
  )
}

export function StageTile({
  member, isMe, player, stream, mirror, onPress, onLongPress,
}: {
  member: StageMember
  isMe?: boolean
  player?: React.ReactNode
  stream?: any | null
  mirror?: boolean
  onPress?: () => void
  onLongPress?: () => void
}) {
  const t = useTheme()
  const name = member.displayName || member.handle || 'Guest'

  const body = player ?? (stream ? (
    <RTCView streamURL={stream.toURL()} objectFit="cover" mirror={mirror} style={StyleSheet.absoluteFill} />
  ) : (
    /* No picture → the profile plate on the navy broadcast gradient, the
       web's `.stg-plate` — a face on a tinted plate, never a black cell. */
    <View style={styles.guestBody}>
      <LinearGradient colors={BROADCAST_PLATE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />
      <Avatar uri={member.avatarUrl} name={name} seed={member.userId} size={56} />
      {hasWebRTC ? null : (
        <View style={styles.guestCaption}>
          <MediaEngineNotice variant="guest" />
        </View>
      )}
    </View>
  ))

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback={onPress || onLongPress ? 'dim' : 'none'}
      noAutoHitSlop
      accessibilityLabel={`${name}${member.isHost ? ', host' : ''}${member.muted ? ', muted' : ''}`}
      style={[styles.tile, { borderRadius: t.radius.md, backgroundColor: ROOM.tile }]}
    >
      {body}

      {/* "This one is you" — the web's `.stg-cell.me` accent ring, Sky on
          this dark canvas. Drawn over the video, under the chips. */}
      {isMe ? (
        <View pointerEvents="none" style={[styles.meRing, { borderColor: ROOM.accent, borderRadius: t.radius.md }]} />
      ) : null}

      <View style={[styles.handleChip, { backgroundColor: ROOM.glass }]}>
        {/* The crown IS the host mark on the stage (web `.stg-tag`); red on a
            cell means muted, nothing else. */}
        {member.isHost ? <Icon name="crown" size={10} color={ROOM.fg} /> : null}
        <Text variant="micro" color={ROOM.fg} numberOfLines={1}>
          {isMe ? 'You' : `@${member.handle}`}
        </Text>
      </View>

      {member.muted ? (
        <View style={[styles.muteBadge, { backgroundColor: ROOM.live }]}>
          <Icon name="micOff" size={11} color={ROOM.fg} />
        </View>
      ) : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
  tile: { flex: 1, overflow: 'hidden' },
  meRing: { ...FILL, borderWidth: 2, opacity: 0.65 },
  guestBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm2, padding: space.sm },
  guestCaption: { paddingHorizontal: space.xs },
  /* A text-bearing plate, so a setback corner — not a capsule (DESIGN.md §8.9). */
  handleChip: {
    position: 'absolute',
    bottom: 6,
    start: 6,
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  muteBadge: {
    position: 'absolute',
    top: 6,
    end: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
