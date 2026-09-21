/* =========================================================
   Communities.

   There is no communities module on the backend, and inventing
   one here would be inventing endpoints. A community IS a
   channel: the same conversation row, the same nine-flag admin
   rights model, the same invite links, join requests and
   per-member mute. So this screen does the one honest thing —
   it explains that, and routes into the channel surfaces that
   already own each capability.

   The list is read from `chat.conversations.list()` filtered to
   `isChannel`, because a channel's id IS its conversation id.
   There is no "my channels" endpoint, so this is a client-side
   filter over the inbox and it is paged the same way: what you
   see is the channels near the top of your conversation list,
   not an exhaustive directory. The footer says so.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import {
  Avatar, Button, Callout, EmptyState, ErrorState, GroupFooter, GroupLabel,
  Header, ListRow, RowGroup, Screen, ScreenScroll, SkeletonList, Text,
} from '@/ui'

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Subscriber',
}

export default function CommunitiesSettings() {
  const t = useTheme()
  const router = useRouter()

  /* size 100 is the clamp; a channel further down the inbox than that is
     reachable from Chat, which is where the full list lives. */
  const convos = useAsync<any>(() => api.chat.conversations.list({ page: 0, size: 100 }), { deps: [] })

  const first = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (first.current) { first.current = false; return }
    void convos.refresh()
  }, [convos.refresh]))   // eslint-disable-line react-hooks/exhaustive-deps

  const channels = React.useMemo(
    () => ((convos.data?.items ?? []) as any[]).filter(c => c?.isChannel),
    [convos.data],
  )
  const managed = channels.filter(c => c.myRole === 'OWNER' || c.myRole === 'ADMIN')

  return (
    <Screen background="sunken">
      <Header back title="Communities" />
      <ScreenScroll refreshing={convos.refreshing} onRefresh={convos.refresh}>
        <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
          <Callout tone="neutral" icon="channels" title="Communities are channels">
            Everything a community needs — roles, invite links, join requests,
            muting a member — is the channel model. There is no second set of
            settings to keep in step, and no second place to look.
          </Callout>
        </View>

        <GroupLabel>Your channels</GroupLabel>
        {convos.loading ? (
          <SkeletonList count={3} />
        ) : convos.error ? (
          <ErrorState error={convos.error} onRetry={convos.reload} compact />
        ) : !channels.length ? (
          <EmptyState
            icon="channels"
            title="You're not in any channels"
            message="Channels are how communities work here — a broadcast feed with an optional discussion group attached."
            actionLabel="Browse channels"
            onAction={() => router.push('/channels')}
            compact
          />
        ) : (
          <RowGroup>
            {channels.map((ch: any) => (
              <ListRow
                key={String(ch.id)}
                title={ch.displayTitle || ch.title || 'Channel'}
                subtitle={[
                  ROLE_LABELS[String(ch.myRole)] ?? String(ch.myRole),
                  ch.memberCount ? `${ch.memberCount} members` : null,
                  ch.muted ? 'Muted' : null,
                ].filter(Boolean).join(' · ')}
                leading={
                  <Avatar uri={ch.avatarUrl} name={ch.displayTitle || ch.title} seed={ch.id} size={36} square />
                }
                accessory={{ kind: 'chevron' }}
                /* The info screen is the settings surface for a channel — it
                   is where roles, invites and requests hang off. */
                onPress={() => router.push(`/channels/${ch.id}/info`)}
              />
            ))}
          </RowGroup>
        )}
        {managed.length ? (
          <GroupFooter>
            You administer {managed.length} of these. Admin rights, invite links
            and join requests all live on each channel's own info screen.
          </GroupFooter>
        ) : channels.length ? (
          <GroupFooter>
            You're a subscriber on all of these. Notification and mute settings
            for a channel live on its info screen.
          </GroupFooter>
        ) : null}

        <GroupLabel>Manage</GroupLabel>
        <RowGroup>
          <ListRow
            title="All channels"
            subtitle="Browse, search and join"
            icon="channels"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/channels')}
          />
          <ListRow
            title="Create a channel"
            subtitle="Start a community of your own"
            icon="addCircle"
            iconTone="success"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/channels/new')}
          />
          <ListRow
            title="Group chats"
            subtitle="Smaller communities without the broadcast model"
            icon="people"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/chat')}
          />
        </RowGroup>

        <View style={{ padding: t.layout.screenPadding }}>
          <Text variant="footnote" tone="muted" align="ui">
            This list is drawn from the top of your conversation list, so a
            channel you haven't opened in a long time may not appear here. Chat
            has the complete one.
          </Text>
        </View>

        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Button
            label="Open Chat"
            icon="chat"
            variant="secondary"
            size="lg"
            block
            onPress={() => router.push('/chat')}
          />
        </View>
      </ScreenScroll>
    </Screen>
  )
}
