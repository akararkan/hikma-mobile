/* =========================================================
   The directory row — /channels, search results, the by-handle
   resolver.

   React.memo'd because it is a FlashList row: the directory
   re-renders on every keystroke of the search field, and only
   the rows whose channel object actually moved should repaint.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, DisclosureIcon, Icon, Text, TouchableRow, VerifiedMark, formatCount,
} from '@/ui'
import { SubscribeButton } from './SubscribeButton'

export interface ChannelRowProps {
  channel: any
  subtitle?: string
  trailing?: 'cta' | 'chevron' | 'none'
  onPress?: () => void
  onLongPress?: () => void
  onSubscribe?: (channel: any) => void
}

export const ChannelRow = React.memo(function ChannelRow({
  channel, subtitle, trailing = 'cta', onPress, onLongPress, onSubscribe,
}: ChannelRowProps) {
  const t = useTheme()
  const c = t.colors
  const meta = subtitle ?? [
    channel?.handle ? `@${channel.handle}` : null,
    `${formatCount(channel?.subscriberCount)} subscribers`,
  ].filter(Boolean).join(' · ')

  return (
    <TouchableRow onPress={onPress} onLongPress={onLongPress}>
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding }]}>
        <Avatar uri={channel?.avatarUrl} name={channel?.title} seed={channel?.id} size={48} square />
        <View style={styles.flex}>
          <View style={styles.line}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{channel?.title || 'Channel'}</Text>
            {channel?.verified ? <VerifiedMark size={14} /> : null}
            {channel && channel.publicChannel === false ? <Icon name="lock" size={12} color={c.textFaint} /> : null}
          </View>
          <Text variant="subhead" tone="muted" numberOfLines={1} align="ui">{meta}</Text>
          {channel?.description ? (
            <Text variant="footnote" tone="faint" numberOfLines={1} align="auto" style={{ marginTop: space.xxs }}>
              {channel.description}
            </Text>
          ) : null}
        </View>
        {trailing === 'cta' ? (
          <SubscribeButton channel={channel} size="sm" onChanged={onSubscribe} onOpenMembership={onPress} />
        ) : trailing === 'chevron' ? <DisclosureIcon /> : null}
      </View>
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 72 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
