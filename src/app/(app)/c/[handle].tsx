/* =========================================================
   The public share link: {base}/c/{handle}.

   Resolve, then either bounce straight in or paint a join wall.
   A member never sees this screen's content — `router.replace`
   fires before the first paint of anything but the spinner, so
   the back gesture does not land on a wall for a channel you are
   already in.

   The two refusals here are final, so neither offers a retry: a
   404 means the link is dead, and a 403 means the channel is
   private and an invite link is the only way in.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Chip, Icon, Screen, Spinner, Text, VerifiedMark, formatCount,
} from '@/ui'
import { ChannelCover, monthYear } from '@/components/channels/ChannelHeader'
import { SubscribeButton } from '@/components/channels/SubscribeButton'
import { ReportSheet } from '@/components/channels/ReportSheet'
import { useSheetState } from '@/ui'
import { chRoute } from '@/components/channels/routes'

export default function ChannelByHandleScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { handle } = useLocalSearchParams<{ handle: string }>()
  const bare = String(handle || '').replace(/^@/, '')

  const [channel, setChannel] = React.useState<any>(null)
  const report = useSheetState()

  const resolved = useAsync<any>(() => api.channels.byHandle(bare), {
    enabled: !!bare,
    deps: [bare],
    onSuccess: (ch: any) => {
      setChannel(ch)
      /* Already in? Then this screen has nothing to say. */
      if (ch && (ch.subscribed || ch.myRole)) router.replace(chRoute.channel(ch.id))
    },
  })

  const browse = () => router.replace(chRoute.index())

  if (resolved.loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <Spinner size="large" />
          <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.md2 }}>@{bare}</Text>
        </View>
      </Screen>
    )
  }

  if (resolved.error) {
    const missing = isNotFound(resolved.error)
    const forbidden = resolved.error?.status === 403
    return (
      <Screen>
        <View style={styles.center}>
          <Icon name={missing ? 'search' : forbidden ? 'lock' : 'offline'} size={64} color={c.textFaint} />
          <Text variant="title3" align="center" style={{ marginTop: space.lg }}>
            {missing ? 'This channel is no longer available'
              : forbidden ? 'This channel is private'
                : 'Could not reach the server'}
          </Text>
          <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs2, maxWidth: 320 }}>
            {missing ? 'The link may be broken, or the channel was deleted.'
              : forbidden ? 'Ask an admin for an invite link.'
                : errorText(resolved.error)}
          </Text>
          {/* A 404 and a 403 are both settled answers — only a transport
              failure earns a retry. */}
          {!missing && !forbidden ? (
            <Button label="Try again" variant="tinted" onPress={resolved.reload} style={{ marginTop: space.lg2 }} />
          ) : null}
          <Button label="Browse channels" variant="ghost" onPress={browse} style={{ marginTop: space.sm }} />
        </View>
      </Screen>
    )
  }

  if (!channel) return <Screen><View style={styles.center}><Spinner size="large" /></View></Screen>

  return (
    <Screen>
      <ChannelCover channel={channel} height={190} />
      <View style={styles.body}>
        <View style={[styles.ring, { backgroundColor: c.bg }]}>
          <Avatar uri={channel.avatarUrl} name={channel.title} seed={channel.id} size={88} square />
        </View>

        <View style={styles.titleLine}>
          <Text variant="title2" align="center" numberOfLines={2}>{channel.title}</Text>
          {channel.verified ? <VerifiedMark size={16} /> : null}
        </View>
        {channel.handle ? <Text variant="callout" tone="muted" align="center">@{channel.handle}</Text> : null}

        <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.xs2 }}>
          {formatCount(channel.subscriberCount)} subscribers · {formatCount(channel.postCount)} posts
        </Text>

        {channel.description ? (
          <Text variant="callout" align="center" numberOfLines={6} style={{ marginTop: space.md2 }}>
            {channel.description}
          </Text>
        ) : null}

        {channel.category ? <Chip label={channel.category} tone="neutral" size="sm" style={{ marginTop: space.md }} /> : null}

        <SubscribeButton
          channel={channel}
          size="lg"
          block
          onChanged={next => {
            setChannel(next)
            if (next?.subscribed) router.replace(chRoute.channel(next.id))
          }}
        />

        <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.sm2 }}>
          {channel.publicChannel === false ? 'Private channel' : 'Public channel'} · created {monthYear(channel.createdAt)}
        </Text>

        <View style={styles.ghostRow}>
          {channel.shareUrl ? (
            <Button
              label="Share"
              variant="ghost"
              icon="share"
              onPress={() => void Share.share({ message: channel.shareUrl, url: channel.shareUrl }).catch(() => {})}
            />
          ) : null}
          <Button label="Report" variant="ghost" icon="flag" onPress={() => report.open()} />
        </View>
      </View>

      <ReportSheet
        visible={report.visible}
        onClose={report.close}
        targetType="CHANNEL"
        targetId={channel.id}
        subject={channel.title}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  body: { alignItems: 'center', paddingHorizontal: space.xxl, marginTop: -44 },
  ring: { padding: space.xs, borderRadius: 28, marginBottom: space.sm2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  ghostRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
})
