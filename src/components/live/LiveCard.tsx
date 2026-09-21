/* =========================================================
   LiveCard + LiveRailCell — the two ways a stream appears in a
   list. The composition is the web directory's (`.lv-card`):
   a paper card on a stone hairline, a 16:9 navy broadcast
   plate on top, and the words on the paper below it — never
   over the picture.

   There is NO thumbnail field on LiveStreamResponse. Rather
   than invent one (a derived URL against a media server we do
   not own is a fabricated endpoint), the plate shows the
   host's own avatar when there is one — honest, always
   available, and it reads as "this person" from a glance — and
   the web's navy broadcast gradient with the broadcast glyph
   when there is not.

   `hostAvatarUrl` arrives already assetUrl()-ed from the
   mapper. Prefixing it again is the bug this comment exists to
   prevent.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, formatCount } from '@/ui'
import { PulseDot } from './RecordingStatusChip'
import { BROADCAST_PLATE, ROOM, SCRIM_DOWN } from './skin'
import type { LiveStream } from './types'

/** The LIVE badge — the web's `.lv-badge`: solid live red, white ink, a
 *  breathing white dot, and SQUARED corners (broadcast grammar; the pill
 *  form stays sanctioned but the web squared it off, so this follows).
 *  Pure #FFFFFF ink on the liveDot plate is the sanctioned exception. */
export function LivePill({ small }: { small?: boolean }) {
  const t = useTheme()
  return (
    <View
      style={[
        styles.livePill,
        { backgroundColor: ROOM.live, borderRadius: t.radius.xs, height: small ? 18 : 20 },
      ]}
    >
      <PulseDot color="#FFFFFF" size={small ? 5 : 6} />
      <Text variant="micro" color="#FFFFFF" weight="700">LIVE</Text>
    </View>
  )
}

/** A viewer count is NOT a sanctioned pill — it is a text plate, so it wears
 *  the chip setback like every other counter in the app. */
export function ViewerPill({ count, small }: { count: number; small?: boolean }) {
  const t = useTheme()
  return (
    <View
      style={[
        styles.viewerPill,
        setback(t.shape.chip),
        { backgroundColor: ROOM.glass, height: small ? 18 : 22 },
      ]}
    >
      <Icon name="eye" size={small ? 10 : 12} color={ROOM.fg} />
      <Text variant="micro" color={ROOM.fg}>{formatCount(count)}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   The discovery grid card.
   --------------------------------------------------------- */

export const LiveCard = React.memo(function LiveCard({
  stream, onPress, onLongPress, style,
}: {
  stream: LiveStream
  onPress?: () => void
  onLongPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors
  const name = stream.hostDisplayName || stream.hostHandle || 'Live'

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`${stream.title} — @${stream.hostHandle} is live, ${stream.viewerCount} watching`}
      style={[
        styles.card,
        {
          borderRadius: t.radius.card,
          backgroundColor: ROOM.pane,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {/* The TikTok explore card: one portrait plate, everything ON the
          picture. There is no stream thumbnail on the wire, so the plate is
          the host's picture blurred to a wash with the sharp face centered —
          the same connecting-state grammar as the player. */}
      <View style={styles.thumb}>
        {stream.hostAvatarUrl ? (
          <>
            <Image
              source={{ uri: stream.hostAvatarUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={160}
              cachePolicy="memory-disk"
              recyclingKey={stream.id}
              blurRadius={18}
            />
            <View style={styles.thumbCenter} pointerEvents="none">
              <View style={[styles.faceRing, { borderColor: ROOM.fgGhost }]}>
                <Image
                  source={{ uri: stream.hostAvatarUrl }}
                  style={styles.face}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={`${stream.id}:face`}
                />
              </View>
            </View>
          </>
        ) : (
          /* No avatar → the web's navy broadcast plate with the glyph. */
          <LinearGradient
            colors={BROADCAST_PLATE}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.thumbCenter]}
          >
            <Icon name="broadcast" size={34} color={ROOM.fgGhost} />
          </LinearGradient>
        )}

        <View style={styles.thumbBadge}>
          <LivePill small />
        </View>
        <View style={styles.thumbCount}>
          <ViewerPill count={stream.viewerCount} small />
        </View>

        {/* The words live on the picture, over the scrim that keeps them
            readable — the name leads, the title supports. */}
        <LinearGradient colors={SCRIM_DOWN} style={styles.cardScrim} pointerEvents="none" />
        <View style={styles.cardFoot} pointerEvents="none">
          <Text variant="footnote" weight="700" color={ROOM.fg} numberOfLines={1}>{name}</Text>
          {stream.title ? (
            <Text variant="micro" caps={false} color={ROOM.fgMuted} numberOfLines={1}>{stream.title}</Text>
          ) : null}
        </View>
      </View>
    </Touchable>
  )
})

/* ---------------------------------------------------------
   The "following is live" rail cell.
   --------------------------------------------------------- */

export const LiveRailCell = React.memo(function LiveRailCell({
  stream, onPress,
}: { stream: LiveStream; onPress?: () => void }) {
  const t = useTheme()
  const name = stream.hostDisplayName || stream.hostHandle || 'Live'
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`@${stream.hostHandle} is live, ${stream.viewerCount} watching`}
      style={styles.cell}
    >
      {/* `ring="live"` is the design system's own gradient ring and LIVE tag,
          so a live avatar here and a live avatar in the feed are one thing. */}
      <Avatar
        uri={stream.hostAvatarUrl}
        name={name}
        seed={stream.hostId || stream.id}
        size={68}
        ring="live"
      />
      <Text variant="caption" caps={false} align="center" numberOfLines={1} style={styles.cellHandle}>
        @{stream.hostHandle}
      </Text>
      {/* Eye + count + age — the web cell's meta line, one size down. */}
      <View style={styles.cellMeta}>
        <Icon name="eye" size={10} color={t.colors.textFaint} />
        <Text variant="micro" tone="faint" numberOfLines={1} weight="500">
          {formatCount(stream.viewerCount)}{stream.time ? ` · ${stream.time}` : ''}
        </Text>
      </View>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous' },
  /* Portrait, like the room it opens. */
  thumb: { aspectRatio: 3 / 4 },
  thumbCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbBadge: { position: 'absolute', top: 8, start: 8 },
  thumbCount: { position: 'absolute', top: 8, end: 8 },
  faceRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, padding: space.xxs, overflow: 'hidden' },
  face: { flex: 1, borderRadius: 28 },
  cardScrim: { position: 'absolute', start: 0, end: 0, bottom: 0, height: '45%' },
  cardFoot: { position: 'absolute', start: 10, end: 10, bottom: 9, gap: space.xxs },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.sm, justifyContent: 'center', borderCurve: 'continuous' },
  viewerPill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, borderCurve: 'continuous' },
  cell: { width: 84, alignItems: 'center' },
  cellHandle: { marginTop: space.sm2 },
  cellMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
})
