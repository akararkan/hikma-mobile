/* =========================================================
   The identity block: cover, avatar, title, stats, CTA.

   Three membership states, not two — `subscribed`,
   `pendingJoinRequest`, and neither — plus the owner special
   case, where "unsubscribe" does not exist at all (the server
   answers 403; the way out is transfer or delete).

   `shareUrl` is null for a private channel, so every share
   affordance is absent there rather than rendering a dead link.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { avatarGradient } from '@/theme/colors'
import { Avatar, Chip, Icon, Text, Touchable, VerifiedMark, formatCount } from '@/ui'
import { SubscribeButton } from './SubscribeButton'

export interface ChannelHeaderProps {
  channel: any
  convo?: any
  myAdminRow?: any
  variant?: 'full' | 'compact'
  onSubscribe?: (channel: any) => void
  onOpenMembership?: () => void
  onMute?: () => void
  onShare?: () => void
  onPost?: () => void
  onStats?: () => void
  onManage?: () => void
  onPressAvatar?: () => void
  onPressHandle?: () => void
  /** Direct doors to Media and Subscribers — both existed but sat two taps
   *  deep behind the ⋯ membership sheet. */
  onMedia?: () => void
  onMembers?: () => void
}

export function ChannelHeader({
  channel, convo, variant = 'full', onSubscribe, onOpenMembership,
  onMute, onShare, onPost, onStats, onManage, onPressAvatar, onPressHandle, onMedia, onMembers,
}: ChannelHeaderProps) {
  const t = useTheme()
  const c = t.colors
  const [expanded, setExpanded] = React.useState(false)
  const isAdmin = !!channel?.isAdmin
  const member = !!channel?.subscribed

  return (
    <View style={{ backgroundColor: c.surface }}>
      <ChannelCover channel={channel} />

      <View style={{ paddingHorizontal: t.layout.screenPadding }}>
        <View style={styles.identity}>
          <View style={[styles.avatarRing, { backgroundColor: c.surface }]}>
            <Avatar
              uri={channel?.avatarUrl}
              name={channel?.title}
              seed={channel?.id}
              size={variant === 'compact' ? 72 : 76}
              square
              onPress={onPressAvatar}
            />
          </View>
          <View style={[styles.flex, { paddingBottom: space.xs2 }]}>
            <View style={styles.titleLine}>
              <Text variant="title2" numberOfLines={2} align="auto" style={styles.shrink}>
                {channel?.title || 'Channel'}
              </Text>
              {channel?.verified ? <VerifiedMark size={16} /> : null}
            </View>
            <Touchable onPress={onPressHandle} disabled={!onPressHandle || !channel?.handle} feedback="dim" noAutoHitSlop>
              <Text variant="subhead" tone="muted" align="ui" numberOfLines={1}>
                {channel?.handle ? `@${channel.handle} · ` : ''}
                {formatCount(channel?.subscriberCount)} subscribers
              </Text>
            </Touchable>
          </View>
        </View>

        {channel?.description ? (
          <Touchable onPress={() => setExpanded(e => !e)} feedback="none" noAutoHitSlop style={{ marginTop: space.sm2 }}>
            <Text variant="callout" align="auto" numberOfLines={expanded ? undefined : 3}>
              {channel.description}
            </Text>
            {!expanded && channel.description.length > 140 ? (
              <Text variant="subhead" tone="accent" align="ui" style={{ marginTop: space.xxs }}>more</Text>
            ) : null}
          </Touchable>
        ) : null}

        <View style={styles.metaRow}>
          {channel?.category ? <Chip label={channel.category} tone="neutral" size="sm" /> : null}
          {channel && channel.publicChannel === false ? <Chip label="Private" icon="lock" tone="warning" size="sm" /> : null}
          <Text variant="caption" tone="faint" align="ui">Created {monthYear(channel?.createdAt)}</Text>
        </View>

        <View style={styles.actions}>
          {!member ? (
            <SubscribeButton channel={channel} size="lg" block onChanged={onSubscribe} onOpenMembership={onOpenMembership} />
          ) : isAdmin ? (
            <>
              <GhostAction icon="edit" label="Post" onPress={onPost} />
              <GhostAction icon="stats" label="Stats" onPress={onStats} />
              <GhostAction icon="settings" label="Manage" onPress={onManage} />
            </>
          ) : (
            <>
              <GhostAction
                icon={convo?.muted ? 'mutedBell' : 'bell'}
                label={convo?.muted ? 'Unmute' : 'Mute'}
                onPress={onMute}
              />
              {channel?.shareUrl ? <GhostAction icon="share" label="Share" onPress={onShare} /> : null}
              <GhostAction icon="check" label="Subscribed" onPress={onOpenMembership} />
            </>
          )}
        </View>

        {member && (onMedia || onMembers) ? (
          <View style={styles.actions}>
            {onMedia ? <GhostAction icon="gallery" label="Media" onPress={onMedia} /> : null}
            {onMembers ? <GhostAction icon="people" label="Members" onPress={onMembers} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** The 16:9 plate. A channel with no cover gets its own deterministic gradient
 *  — the same hash the web app used — rather than a grey rectangle. */
export function ChannelCover({ channel, height }: { channel: any; height?: number }) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const h = height ?? Math.round(width * 0.5)
  const [g0, g1] = avatarGradient(channel?.id ?? channel?.handle ?? '')

  return (
    <View style={{ width: '100%', height: h, backgroundColor: t.colors.surfaceSunken }}>
      {channel?.coverUrl ? (
        <Image
          source={{ uri: channel.coverUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          cachePolicy="memory-disk"
          recyclingKey={channel.coverUrl}
        />
      ) : (
        <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      {/* A scrim so white header glyphs survive a bright photo. */}
      <LinearGradient
        colors={['transparent', t.colors.overlayBg]}
        style={[StyleSheet.absoluteFill, { top: h * 0.45 }]}
      />
    </View>
  )
}

function GhostAction({ icon, label, onPress }: { icon: any; label: string; onPress?: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      feedback="dim"
      haptic="light"
      noAutoHitSlop
      /* accentSoft, not the sunken grey: these are the channel's primary
         verbs, and grey plates read as disabled (the visibility rule that
         reworked the header icons and the composer). */
      style={[styles.ghost, { backgroundColor: c.accentSoft, borderRadius: t.radius.md }]}
    >
      <Icon name={icon} size={18} color={c.accentText} />
      <Text variant="caption" tone="accent" align="center" numberOfLines={1}>{label}</Text>
    </Touchable>
  )
}

/* Cached formatter — see the note in Charts.tsx. */
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export function monthYear(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return MONTH_YEAR.format(d)
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginTop: -34 },
  avatarRing: { padding: space.xs, borderRadius: 24 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md2, marginBottom: space.md2 },
  ghost: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.sm2, minHeight: 48 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
