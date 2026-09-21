/* =========================================================
   LiveFeedCard — one live broadcast, IN the timeline.

   The rail at the top of the feed is discovery; this is the
   mid-scroll reminder for the reader who slid past it. It is a
   CLIENT-synthesized row (the ranked feed's `postType` has no
   LIVE value — post/posts.md), fed from the same `liveNow`
   array the rail renders, followed-hosts-first by contract.

   Law notes: the plate is the white feed plate, never a navy
   surface (§1 — backgrounds are paper; tinted fills mark
   state); the LIVE mark is one of the two sanctioned pills and
   rides Avatar's own `ring="live"`; the viewer count is
   approximate between refreshes BY CONTRACT (stream.viewer is
   not fanned to rails — live-streaming.md) so it prints
   without pretending to tick.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Button, Icon, NumericText, Text, Touchable, formatCount } from '@/ui'
import { LivePill } from '@/components/live/LiveCard'
import { FEED_GUTTER, feedPlate } from './plate'
import type { LiveStreamView } from './types'

export const LiveFeedCard = React.memo(function LiveFeedCard({
  stream, onPress,
}: {
  stream: LiveStreamView
  onPress: (stream: LiveStreamView) => void
}) {
  const t = useTheme()
  const c = t.colors
  const name = stream.hostDisplayName || `@${stream.hostHandle}`

  return (
    <Touchable
      onPress={() => onPress(stream)}
      feedback="tint"
      noAutoHitSlop
      accessibilityLabel={`${name} is live${stream.title ? `: ${stream.title}` : ''}. ${formatCount(stream.viewerCount)} watching. Opens the stream.`}
      style={[feedPlate, { backgroundColor: c.surface, borderColor: c.separator }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: FEED_GUTTER, paddingVertical: space.md }}>
        <Avatar
          uri={stream.hostAvatarUrl}
          name={name}
          seed={stream.hostId || stream.id}
          size={52}
          ring="live"
        />
        <View style={{ flex: 1, gap: space.xxs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <LivePill small />
            <Text variant="subhead" weight="600" align="ui" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
          </View>
          {stream.title ? (
            <Text variant="footnote" tone="secondary" align="auto" numberOfLines={1}>{stream.title}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="eye" size={12} color={c.textMuted} />
            <NumericText variant="caption" tone="muted">{formatCount(stream.viewerCount)}</NumericText>
            <Text variant="caption" tone="muted" align="ui"> watching</Text>
          </View>
        </View>
        <Button label="Watch" size="sm" onPress={() => onPress(stream)} />
      </View>
    </Touchable>
  )
})
