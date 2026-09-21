/* =========================================================
   Channel info — the profile card and every per-subscriber
   control, with the admin doors behind their own rights.

   Each secondary count (requests, invites, scheduled, media)
   loads on its own and its row simply omits the number until it
   lands. None of them may block the screen, and a 403 on one of
   them means my rights changed under me — that row disappears
   rather than becoming an error.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Share } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, canRight, errorText, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useChatActions } from '@/context/ChatContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, AvatarStack, Button, Chip, ConfirmSheet, ErrorState, Field,
  GroupFooter, GroupLabel, Header, ListRow, RowGroup, Screen, ScreenScroll, Sheet,
  Skeleton, Text, Touchable, formatCount, toast, useSheetState,
} from '@/ui'
import { ChannelCover, monthYear } from '@/components/channels/ChannelHeader'
import { ReportSheet } from '@/components/channels/ReportSheet'
import { GoneCard } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const MUTE_OPTIONS: [string, number | null][] = [
  ['For 8 hours', 8 * 3600e3],
  ['For 1 week', 7 * 24 * 3600e3],
  ['Forever', 100 * 365 * 24 * 3600e3],
]

export default function ChannelInfoScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel
  const convo = useAsync<any>(() => api.chat.conversations.get(id), { enabled: !!id, deps: [id] })

  const hidden = !!channel?.settings?.hiddenSubscribers && !channel?.isAdmin
  const members = useAsync<any>(async () => {
    /* SUBSCRIBERS_HIDDEN is an answer, not a failure: the count on the channel
       record stays public, so the screen shows that and explains the gap. */
    try { return await api.chat.members.list(id, { page: 0, size: 5 }) }
    catch (e: any) { if (e?.status === 403) return null; throw e }
  }, { enabled: !!id && !hidden, deps: [id, hidden] })

  const mediaPreview = useAsync<any[]>(
    () => api.chat.messages.media(id, args({ kind: 'IMAGE', limit: 3 })),
    { enabled: !!id, deps: [id] },
  )
  const pinned = useAsync<any[]>(() => api.chat.messages.pinned(id), { enabled: !!id, deps: [id] })

  const canApprove = canRight(rights.myAdminRow, 'canApproveJoinRequests') || !!channel?.isOwner
  const canInvite = canRight(rights.myAdminRow, 'canInviteUsers') || !!channel?.isOwner
  const canPost = canRight(rights.myAdminRow, 'canPostMessages') || !!channel?.isOwner
  const canChangeInfo = canRight(rights.myAdminRow, 'canChangeInfo') || !!channel?.isOwner

  const requests = useAsync<any>(
    () => api.channels.requests.list(id, args({ status: 'PENDING', page: 0, size: 1 })),
    { enabled: !!id && canApprove, deps: [id, canApprove] },
  )
  const invites = useAsync<any[]>(() => api.channels.invites.list(id), { enabled: !!id && canInvite, deps: [id, canInvite] })
  const scheduled = useAsync<any[]>(() => api.chat.scheduled.list(id), { enabled: !!id && canPost, deps: [id, canPost] })
  const group = useAsync<any>(
    () => api.chat.conversations.get(channel!.linkedGroupId),
    { enabled: !!channel?.linkedGroupId, deps: [channel?.linkedGroupId] },
  )

  const muteSheet = useSheetState()
  const report = useSheetState()
  const confirmLeave = useSheetState()
  const confirmDelete = useSheetState()
  const [typed, setTyped] = React.useState('')
  const [gone, setGone] = React.useState(false)

  useFocusEffect(React.useCallback(() => { rights.reload() }, [id]))   // eslint-disable-line react-hooks/exhaustive-deps

  useChannelStream(id, {
    onConversation: e => { if (e.memberChange === 'DELETED') setGone(true); else rights.reload() },
    onMember: e => rights.setChannel((prev: any) => {
      if (!prev) return prev
      /* PROMOTED / DEMOTED are role changes on this same frame — only a
         join/leave moves the count. */
      const delta = e.memberChange === 'UNSUBSCRIBED' ? -1
        : (e.memberChange === 'SUBSCRIBED' || e.memberChange === 'ADDED') ? 1 : 0
      if (!delta) return prev
      return { ...prev, subscriberCount: Math.max(0, (prev.subscriberCount || 0) + delta) }
    }),
  })

  /* ---- optimistic switches ---- */

  const { dropConvo } = useChatActions()

  const patchConvo = (patch: any) => convo.setData((prev: any) => (prev ? { ...prev, ...patch } : prev))

  const setMute = async (ms: number | null) => {
    const iso = ms == null ? null : new Date(Date.now() + ms).toISOString()
    const before = { muted: convo.data?.muted, mutedUntil: convo.data?.mutedUntil }
    patchConvo({ muted: ms != null, mutedUntil: iso })
    try { await api.chat.conversations.mute(id, iso) }
    catch (e: any) { patchConvo(before); toast.error(errorText(e)) }
  }
  const setPinned = async (next: boolean) => {
    patchConvo({ pinned: next })
    try { await api.chat.conversations.pin(id, next) }
    catch (e: any) { patchConvo({ pinned: !next }); toast.error(errorText(e)) }
  }
  const setArchived = async (next: boolean) => {
    patchConvo({ archived: next })
    try { await api.chat.conversations.archive(id, next) }
    catch (e: any) { patchConvo({ archived: !next }); toast.error(errorText(e)) }
  }

  /* A channel is a conversation: it has a row in the chat rail. Both writes
     go through the provider so that row leaves in the same frame — the
     `member.changed` / `conversation.updated` echo that used to be the only
     thing clearing it is the socket, and the socket is what is down when a
     user retries a leave. */
  const unsubscribe = async () => {
    try {
      await dropConvo(id, () => api.channels.unsubscribe(id), 'Could not leave this channel')
      router.replace(chRoute.index())
    } catch { /* the provider restored the row and said why */ }
  }
  const removeChannel = async () => {
    try {
      await dropConvo(id, () => api.channels.remove(id), 'Could not delete this channel')
      router.replace(chRoute.index())
      toast.ok('Channel deleted')
    } catch { /* ditto */ }
  }

  if (gone || (rights.error && isNotFound(rights.error))) {
    return (
      <Screen background="sunken">
        <Header back title="Channel info" />
        <GoneCard onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  if (rights.loading && !channel) {
    return (
      <Screen background="sunken">
        <Header back title="Channel info" />
        <Skeleton height={190} radius={0} />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={86} radius={14} />
          <Skeleton height={140} radius={14} />
          <Skeleton height={140} radius={14} />
        </View>
      </Screen>
    )
  }

  if (rights.error) {
    return (
      <Screen background="sunken">
        <Header back title="Channel info" />
        <ErrorState error={rights.error} onRetry={rights.reload} />
      </Screen>
    )
  }

  const settings = channel?.settings || {}
  const memberTotal = members.data?.total ?? channel?.subscriberCount ?? 0

  return (
    <Screen background="sunken">
      <Header back title="Channel info" />
      <ScreenScroll refreshing={convo.refreshing} onRefresh={() => { void rights.refresh(); void convo.refresh() }}>
        <View style={{ backgroundColor: c.surface }}>
          <ChannelCover channel={channel} height={170} />
          <View style={styles.hero}>
            <View style={[styles.ring, { backgroundColor: c.surface }]}>
              <Avatar uri={channel?.avatarUrl} name={channel?.title} seed={channel?.id} size={88} square />
            </View>
            <Text variant="title2" align="center" numberOfLines={2} style={{ marginTop: space.sm2 }}>{channel?.title}</Text>
            {channel?.publicChannel === false ? (
              <Chip label="Private channel" icon="lock" tone="warning" size="sm" style={{ marginTop: space.xs2 }} />
            ) : channel?.handle ? (
              <Touchable
                onPress={async () => {
                  if (!channel?.shareUrl) return
                  await Clipboard.setStringAsync(channel.shareUrl)
                  toast.ok('Link copied')
                }}
                onLongPress={async () => { await Clipboard.setStringAsync(`@${channel.handle}`); toast.ok('Handle copied') }}
                feedback="dim"
              >
                <Text variant="subhead" tone="muted" align="center" style={{ marginTop: space.xxs }}>@{channel.handle}</Text>
              </Touchable>
            ) : null}

            <View style={[styles.stats, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.md }]}>
              <StatCell
                label="Subscribers"
                value={formatCount(channel?.subscriberCount)}
                onPress={hidden ? undefined : () => router.push(chRoute.subscribers(id))}
              />
              <StatCell label="Posts" value={formatCount(channel?.postCount)} />
              <StatCell label="Created" value={monthYear(channel?.createdAt)} />
            </View>

            {channel?.description ? (
              <Text variant="callout" align="auto" selectable style={{ marginTop: space.md2 }}>{channel.description}</Text>
            ) : null}
          </View>
        </View>

        <GroupLabel>Notifications</GroupLabel>
        <RowGroup>
          <ListRow
            title="Mute"
            icon="mutedBell"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: !!convo.data?.muted, onValueChange: () => muteSheet.open() }}
            onPress={() => muteSheet.open()}
          />
          <ListRow
            title="Pin to top of inbox"
            icon="pin"
            iconTone="accent"
            accessory={{ kind: 'switch', value: !!convo.data?.pinned, onValueChange: v => void setPinned(v) }}
          />
          <ListRow
            title="Archive"
            icon="archive"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: !!convo.data?.archived, onValueChange: v => void setArchived(v) }}
          />
        </RowGroup>
        <GroupFooter>Mentions still notify you.</GroupFooter>

        <GroupLabel>Content</GroupLabel>
        <RowGroup>
          <ListRow
            title="Media, files and links"
            icon="gallery"
            iconTone="accent"
            accessory={{
              kind: 'custom',
              node: (
                <View style={styles.thumbs}>
                  {(mediaPreview.data || []).slice(0, 3).map((m: any) => (
                    <Avatar key={String(m.id)} uri={m.media?.[0]?.thumbnailUrl || m.media?.[0]?.url} name="" seed={String(m.id)} size={26} square />
                  ))}
                </View>
              ),
            }}
            onPress={() => router.push(chRoute.media(id))}
          />
          <ListRow
            title="Pinned posts"
            icon="pin"
            iconTone="warning"
            accessory={{ kind: 'value', text: pinned.data ? String(pinned.data.length) : '' }}
            onPress={() => router.push(chRoute.pinned(id))}
          />
          <ListRow
            title="Search in channel"
            icon="search"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(chRoute.search(id))}
          />
          {canPost ? (
            <ListRow
              title="Scheduled posts"
              icon="clock"
              iconTone="accent"
              accessory={{ kind: 'value', text: scheduled.data ? String(scheduled.data.length) : '' }}
              onPress={() => router.push(chRoute.scheduled(id))}
            />
          ) : null}
          {canChangeInfo || channel?.linkedGroupId ? (
            <ListRow
              title="Discussion group"
              icon="chat"
              iconTone="success"
              accessory={{ kind: 'value', text: group.data?.displayTitle ?? (channel?.linkedGroupId ? '' : 'None') }}
              onPress={() => router.push(chRoute.discussion(id))}
            />
          ) : null}
        </RowGroup>

        <GroupLabel>People</GroupLabel>
        <RowGroup>
          {hidden ? (
            <ListRow
              title="Subscribers"
              subtitle="Subscriber list is hidden by this channel"
              icon="people"
              iconTone="neutral"
              accessory={{ kind: 'value', text: formatCount(channel?.subscriberCount), chevron: false }}
            />
          ) : (
            <ListRow
              title="Subscribers"
              icon="people"
              iconTone="accent"
              accessory={{
                kind: 'custom',
                node: (
                  <View style={styles.trailingCluster}>
                    <AvatarStack
                      users={(members.data?.items || []).map((m: any) => ({ id: m.userId, name: m.fullName }))}
                      size={24}
                      max={5}
                    />
                    <Text variant="callout" tone="muted">{formatCount(memberTotal)}</Text>
                  </View>
                ),
              }}
              onPress={() => router.push(chRoute.subscribers(id))}
            />
          )}
          <ListRow
            title={`Admins (${rights.admins.length})`}
            icon="shield"
            iconTone="scholar"
            accessory={{
              kind: 'custom',
              node: (
                <AvatarStack
                  users={rights.admins.map((a: any) => ({ id: a.userId, name: a.fullName }))}
                  size={24}
                  max={5}
                />
              ),
            }}
            onPress={() => router.push(chRoute.admins(id))}
          />
          {canApprove ? (
            <ListRow
              title="Join requests"
              icon="personAdd"
              iconTone="warning"
              accessory={{ kind: 'badge', count: requests.data?.total ?? 0 }}
              onPress={() => router.push(chRoute.requests(id))}
            />
          ) : null}
          {canInvite ? (
            <ListRow
              title="Invite links"
              icon="link"
              iconTone="accent"
              accessory={{ kind: 'value', text: invites.data ? String(invites.data.length) : '' }}
              onPress={() => router.push(chRoute.invites(id))}
            />
          ) : null}
        </RowGroup>

        {canChangeInfo ? (
          <>
            <GroupLabel>Channel settings</GroupLabel>
            <RowGroup>
              <ListRow title="Edit channel" icon="edit" iconTone="accent" accessory={{ kind: 'chevron' }} onPress={() => router.push(chRoute.edit(id))} />
              <ListRow title="Statistics" icon="stats" iconTone="success" accessory={{ kind: 'chevron' }} onPress={() => router.push(chRoute.stats(id))} />
            </RowGroup>
          </>
        ) : null}

        <GroupLabel>This channel</GroupLabel>
        <View style={styles.pills}>
          <Chip label="Sign posts" tone={settings.signMessages ? 'accent' : 'neutral'} selected={!!settings.signMessages} size="sm" />
          <Chip label="Reactions" tone={settings.reactionsEnabled !== false ? 'accent' : 'neutral'} selected={settings.reactionsEnabled !== false} size="sm" />
          <Chip label="Restrict saving" tone={settings.protectedContent ? 'accent' : 'neutral'} selected={!!settings.protectedContent} size="sm" />
          <Chip label="Hide subscribers" tone={settings.hiddenSubscribers ? 'accent' : 'neutral'} selected={!!settings.hiddenSubscribers} size="sm" />
          <Chip label="Approve new subscribers" tone={settings.joinByRequest ? 'accent' : 'neutral'} selected={!!settings.joinByRequest} size="sm" />
        </View>
        <GroupFooter>These are the rules every subscriber is under.</GroupFooter>

        <GroupLabel> </GroupLabel>
        <RowGroup>
          <ListRow title="Report channel" icon="flag" destructive onPress={() => report.open()} />
          {channel?.shareUrl ? (
            <ListRow
              title="Share channel"
              icon="share"
              iconTone="accent"
              onPress={() => void Share.share({ message: channel.shareUrl, url: channel.shareUrl }).catch(() => {})}
            />
          ) : null}
          {channel?.isOwner ? (
            <ListRow title="Delete channel" icon="trash" destructive onPress={() => { setTyped(''); confirmDelete.open() }} />
          ) : channel?.subscribed ? (
            <ListRow title="Unsubscribe" icon="logout" destructive onPress={() => confirmLeave.open()} />
          ) : null}
        </RowGroup>
        {channel?.isOwner ? (
          <GroupFooter>
            You can’t unsubscribe from a channel you own — transfer ownership or delete the channel instead.
          </GroupFooter>
        ) : null}
      </ScreenScroll>

      <ActionSheet
        visible={muteSheet.visible}
        onClose={muteSheet.close}
        title="Mute this channel"
        subtitle="Mentions still notify you."
        actions={[
          ...MUTE_OPTIONS.map(([label, ms]) => ({ label, icon: 'mutedBell' as const, onPress: () => void setMute(ms) })),
          { label: 'Unmute', icon: 'bell' as const, hidden: !convo.data?.muted, onPress: () => void setMute(null) },
        ]}
      />

      <ConfirmSheet
        visible={confirmLeave.visible}
        onClose={confirmLeave.close}
        title={`Unsubscribe from ${channel?.title}?`}
        message="You’ll stop getting its posts. You can subscribe again any time."
        confirmLabel="Unsubscribe"
        destructive
        onConfirm={() => { confirmLeave.close(); void unsubscribe() }}
      />

      {/* Type-to-confirm: deleting takes the channel away from every
          subscriber at once, which is not a thing to do by mis-tap. */}
      <Sheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this channel?"
        subtitle="Deletes it for everyone. Subscribers lose it from their inbox immediately."
        maxHeightRatio={0.6}
        footer={
          <Button
            label="Delete for everyone"
            variant="danger"
            size="lg"
            block
            disabled={typed.trim() !== String(channel?.title || '').trim()}
            onPress={() => { confirmDelete.close(); void removeChannel() }}
          />
        }
      >
        <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
          <Text variant="callout" tone="muted" align="ui">
            Type the channel’s title to confirm.
          </Text>
          <Field value={typed} onChangeText={setTyped} placeholder={channel?.title} autoFocus autoCorrect={false} />
        </View>
      </Sheet>

      <ReportSheet visible={report.visible} onClose={report.close} targetType="CHANNEL" targetId={id} subject={channel?.title} />
    </Screen>
  )
}

function StatCell({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <Touchable onPress={onPress} disabled={!onPress} feedback="dim" noAutoHitSlop style={styles.statCell}>
      <Text variant="title3" align="center">{value}</Text>
      <Text variant="caption" tone="muted" align="center">{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg2, marginTop: -46 },
  ring: { padding: space.xs, borderRadius: 28 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: space.lg, paddingVertical: space.md },
  statCell: { flex: 1, gap: space.xxs },
  thumbs: { flexDirection: 'row', gap: space.xs },
  trailingCluster: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
})
