/* =========================================================
   Conversation info — the per-thread control panel.

   Three variants of one screen (DM, group, channel), and the
   difference is which cards exist rather than which are
   disabled: an admin-only card that is merely greyed out still
   tells a member that a lever exists and they may not pull it,
   which is both noise and a small information leak. Admin cards
   are ABSENT for non-admins.

   `conversations.remove` means four different things depending
   on who is asking — delete the group for everyone, delete the
   channel, leave the channel, or delete for me — and there is
   no NOT_OWNER branch to fall back on, so the confirm copy is
   chosen from myRole BEFORE the call.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { api } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { useAuth } from '@/context/AuthContext'
import { useChatActions, useChatSettings, useConversation } from '@/context/ChatContext'
import { usePresence } from '@/context/RealtimeContext'
import { chatError } from '@/lib/chatErrors'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, ConfirmSheet, GroupLabel, Header, Icon, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, Text, Touchable, VerifiedMark, toast, useSheetState,
} from '@/ui'
import { MemberRow } from '@/components/chat/MemberRow'
import { disappearingLabel, muteLabel, presenceLine } from '@/components/chat/format'
import {
  canAddMembers, canEditInfo, canManageInvites, canChangeSettings,
  deleteConversationCopy, isAdmin, isOwner,
} from '@/components/chat/permissions'
import { ChatErrorState } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

const MUTE_CHOICES = [
  { label: 'For 8 hours', hours: 8 },
  { label: 'For 1 week', hours: 24 * 7 },
  { label: 'Always', hours: 24 * 365 * 20 },
]

export default function ConversationInfoScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const { user } = useAuth()
  const myId = user?.id ? String(user.id) : null
  const {
    trackPresence,
    togglePin, toggleMute, toggleArchive, deleteConvo, dropConvo,
  } = useChatActions()
  const chatSettings = useChatSettings()
  const dir = useUserDirectory()

  const muteSheet = useSheetState()
  const confirmDelete = useSheetState<{ title: string; message: string; label: string }>()
  /* One in-flight destructive write at a time, and the sheet stays up while it
     runs: the confirm button is the progress indicator, and it is disabled
     (Button: `loading` implies disabled) so a second tap cannot fire a second
     DELETE — which on a group owner's thread would be a second delete-for-
     everyone, and on a DM a second clear at a NEWER high-water mark. */
  const [deleting, setDeleting] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)
  const confirmLeave = useSheetState()
  const ownerLeave = useSheetState()
  const confirmBlock = useSheetState()

  const convoQ = useAsync<any>(() => api.chat.conversations.get(convId), { deps: [convId] })
  /* The live inbox/archived row, subscribed per-key — a render-time getConvo()
     here would go permanently stale now that this screen no longer re-renders
     on inbox churn. */
  const liveRow = useConversation(convId)
  const convo = convoQ.data ?? liveRow

  const isGroup = !!convo?.isGroup
  const members = useAsync<any>(
    () => api.chat.members.list(convId, { page: 0, size: 6 }),
    { enabled: isGroup, deps: [convId, isGroup] },
  )
  const media = useAsync<any[]>(
    /* `kind` is required by the gallery route (400 MISSING_PARAMETER without
       it, live-verified) — IMAGE for the teaser strip, same as channel info. */
    () => api.chat.messages.media(convId, { kind: 'IMAGE', limit: 3 } as any),
    { deps: [convId] },
  )
  const pinned = useAsync<any[]>(() => api.chat.messages.pinned(convId), { deps: [convId] })
  const scheduled = useAsync<any[]>(() => api.chat.scheduled.list(convId), { deps: [convId] })

  useFocusEffect(React.useCallback(() => { void convoQ.reload() }, [convId]))   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (convo?.peer?.id) { dir.watchUsers([convo.peer.id]); trackPresence([convo.peer.id]) }
    const ids = (members.data?.items || []).map((m: any) => m.userId)
    if (ids.length) { dir.watchUsers(ids); trackPresence(ids) }
  }, [convo?.peer?.id, members.data, dir, trackPresence])

  const peerPresence = usePresence(convo?.peer?.id ?? null)

  const patch = React.useCallback((fields: any) => {
    convoQ.setData((prev: any) => (prev ? { ...prev, ...fields } : prev))
  }, [convoQ])

  if (convoQ.loading && !convo) {
    return (
      <Screen background="sunken">
        <Header back title="" />
        <SkeletonList count={6} />
      </Screen>
    )
  }

  if (!convo) {
    return (
      <Screen background="sunken">
        <Header back title="" />
        <ChatErrorState
          error={convoQ.error}
          title="Could not load this conversation"
          onRetry={convoQ.reload}
          back={() => router.replace('/(app)/(tabs)/chat')}
        />
      </Screen>
    )
  }

  const peerCard = dir.userOf(convo.peer?.id)
  const subline = isGroup
    ? `${convo.isChannel ? 'Channel' : 'Group'} · ${convo.memberCount} ${convo.isChannel ? 'subscribers' : 'members'}`
    : [convo.peer?.handle ? `@${convo.peer.handle}` : '', presenceLine(peerPresence, chatSettings.lastSeenVisible)]
      .filter(Boolean).join(' · ')

  const thumbs = (media.data || []).flatMap((m: any) => m.media || []).slice(0, 3)
  const deleteCopy = deleteConversationCopy(convo)

  return (
    <Screen background="sunken">
      <Header back title="" border={false} />

      <ScreenScroll refreshing={convoQ.refreshing} onRefresh={convoQ.refresh}>
        <View style={styles.hero}>
          <Avatar
            uri={isGroup ? convo.avatarUrl : (peerCard?.profileImage ?? null)}
            name={convo.displayTitle}
            seed={isGroup ? convo.id : convo.peer?.id}
            size={96}
            square={isGroup}
            onPress={canEditInfo(convo) ? () => router.push(`/chat/${convId}/edit`) : undefined}
          />
          <View style={styles.heroTitle}>
            <Text variant="title2" align="center" numberOfLines={2}>{convo.displayTitle}</Text>
            {!isGroup && peerCard?.verified ? <VerifiedMark size={16} /> : null}
          </View>
          {subline ? <Text variant="footnote" tone="muted" align="center">{subline}</Text> : null}

          <View style={styles.quickRow}>
            <QuickAction
              icon="chat"
              label="Message"
              onPress={() => router.replace(`/chat/${convId}`)}
            />
            {/* No calls in channels: a broadcast surface with thousands of
                subscribers is not a room you can ring. DMs and groups only. */}
            {!convo.isChannel ? (
              <>
                <QuickAction icon="call" label="Call" onPress={() => router.push(`/call/new?convId=${convId}&type=VOICE`)} />
                <QuickAction icon="videoCall" label="Video" onPress={() => router.push(`/call/new?convId=${convId}&type=VIDEO`)} />
              </>
            ) : null}
            <QuickAction
              icon={convo.muted ? 'mutedBell' : 'bell'}
              label={convo.muted ? 'Unmute' : 'Mute'}
              active={convo.muted}
              onPress={() => {
                if (convo.muted) { patch({ muted: false }); void toggleMute(convId) }
                else muteSheet.open()
              }}
            />
          </View>
        </View>

        {isGroup && convo.description ? (
          <>
            <GroupLabel>About</GroupLabel>
            <RowGroup inset={16}>
              <View style={styles.description}>
                <Text variant="callout" align="auto">{convo.description}</Text>
              </View>
              {canEditInfo(convo) ? (
                <ListRow title="Edit info" icon="edit" iconTone="accent" accessory={{ kind: 'chevron' }} onPress={() => router.push(`/chat/${convId}/edit`)} />
              ) : null}
            </RowGroup>
          </>
        ) : isGroup && canEditInfo(convo) ? (
          <RowGroup>
            <ListRow title="Edit info" icon="edit" iconTone="accent" accessory={{ kind: 'chevron' }} onPress={() => router.push(`/chat/${convId}/edit`)} />
          </RowGroup>
        ) : null}

        <GroupLabel>In this chat</GroupLabel>
        <RowGroup>
          <ListRow
            title="Media, links and docs"
            icon="gallery"
            iconTone="accent"
            leading={thumbs.length ? (
              <View style={styles.thumbs}>
                {thumbs.map((m: any, i: number) => (
                  <Image
                    key={i}
                    source={{ uri: m.thumbnailUrl || m.url }}
                    style={[styles.thumb, { borderColor: c.surface, marginStart: i ? -12 : 0 }]}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ))}
              </View>
            ) : undefined}
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(`/chat/${convId}/media`)}
          />
          <ListRow
            title="Search in conversation"
            icon="search"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(`/chat/${convId}/search`)}
          />
          <ListRow
            title="Pinned messages"
            icon="pin"
            iconTone="neutral"
            accessory={{ kind: 'value', text: String(pinned.data?.length ?? 0) }}
            onPress={() => router.push(`/chat/${convId}/pinned`)}
          />
          <ListRow
            title="Starred in this chat"
            icon="star"
            iconTone="scholar"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(`/chat/starred?convId=${convId}`)}
          />
          <ListRow
            title="Scheduled messages"
            icon="calendar"
            iconTone="neutral"
            accessory={{ kind: 'value', text: String(scheduled.data?.length ?? 0) }}
            onPress={() => router.push(`/chat/${convId}/scheduled`)}
          />
        </RowGroup>

        <GroupLabel>Preferences</GroupLabel>
        <RowGroup inset={16}>
          <ListRow
            title="Mute notifications"
            accessory={{
              kind: 'custom',
              node: (
                <View style={styles.valueRow}>
                  {convo.muted && convo.mutedUntil ? (
                    <Text variant="footnote" tone="muted" align="ui">{muteLabel(convo.mutedUntil)}</Text>
                  ) : null}
                  <Icon name={convo.muted ? 'mutedBell' : 'bell'} size={18} color={convo.muted ? c.accent : c.textFaint} />
                </View>
              ),
            }}
            onPress={() => {
              if (convo.muted) { patch({ muted: false }); void toggleMute(convId) }
              else muteSheet.open()
            }}
          />
          <ListRow
            title="Pin chat"
            accessory={{
              kind: 'switch',
              value: !!convo.pinned,
              onValueChange: next => { patch({ pinned: next }); void togglePin(convId) },
            }}
          />
          <ListRow
            title="Archive chat"
            accessory={{
              kind: 'switch',
              value: !!convo.archived,
              onValueChange: next => {
                patch({ archived: next })
                /* toggleArchive rethrows on failure — fold the switch back. */
                toggleArchive(convId).catch(() => patch({ archived: !next }))
              },
            }}
          />
          <ListRow
            title="Disappearing messages"
            accessory={{ kind: 'value', text: disappearingLabel(convo.disappearingSeconds) }}
            onPress={() => router.push(`/chat/${convId}/disappearing`)}
          />
        </RowGroup>

        {isGroup && isAdmin(convo) ? (
          <>
            <GroupLabel>Administration</GroupLabel>
            <RowGroup>
              {canChangeSettings(convo) ? (
                <ListRow
                  title="Group permissions"
                  icon="shield"
                  iconTone="accent"
                  accessory={{ kind: 'chevron' }}
                  onPress={() => router.push(`/chat/${convId}/permissions`)}
                />
              ) : null}
              {canManageInvites(convo) ? (
                <ListRow
                  title="Invite via link"
                  icon="link"
                  iconTone="accent"
                  accessory={{ kind: 'chevron' }}
                  onPress={() => router.push(`/chat/${convId}/invite`)}
                />
              ) : null}
            </RowGroup>
          </>
        ) : null}

        {isGroup ? (
          <>
            <GroupLabel>{convo.isChannel ? 'Subscribers' : 'Members'}</GroupLabel>
            <RowGroup inset={72}>
              {canAddMembers(convo) ? (
                <ListRow
                  title="Add members"
                  icon="personAdd"
                  iconTone="accent"
                  accessory={{ kind: 'chevron' }}
                  onPress={() => router.push(`/chat/${convId}/add-members`)}
                />
              ) : null}
              {(members.data?.items || []).map((m: any) => (
                <MemberRow
                  key={String(m.userId)}
                  member={m}
                  card={dir.userOf(m.userId)}
                  presenceVisible={chatSettings.lastSeenVisible}
                  isMe={!!myId && String(m.userId) === myId}
                  onPress={() => router.push(`/u/${m.handle || m.userId}`)}
                />
              ))}
              <ListRow
                title={`See all ${convo.memberCount}`}
                icon="people"
                iconTone="neutral"
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push(`/chat/${convId}/members`)}
              />
            </RowGroup>
          </>
        ) : null}

        <GroupLabel> </GroupLabel>
        <RowGroup>
          {isGroup && !isOwner(convo) ? (
            <ListRow
              title={convo.isChannel ? 'Leave channel' : 'Exit group'}
              icon="logout"
              destructive
              onPress={confirmLeave.open}
            />
          ) : null}
          {!isGroup ? (
            <ListRow title={`Block @${convo.peer?.handle ?? 'this account'}`} icon="block" destructive onPress={confirmBlock.open} />
          ) : null}
          {!isGroup ? (
            <ListRow
              title="Report"
              icon="flag"
              destructive
              onPress={() => {
                const peer = convo.peer
                if (peer?.id) {
                  router.push(reportHref({
                    targetType: 'USER',
                    targetId: String(peer.id),
                    name: peer.handle ? `@${peer.handle}` : undefined,
                  }))
                }
              }}
            />
          ) : null}
          <ListRow title={deleteCopy.label} icon="trash" destructive onPress={() => confirmDelete.open(deleteCopy)} />
        </RowGroup>
      </ScreenScroll>

      <ActionSheet
        visible={muteSheet.visible}
        onClose={muteSheet.close}
        title="Mute notifications"
        actions={MUTE_CHOICES.map(choice => ({
          label: choice.label,
          icon: 'mutedBell' as const,
          onPress: () => {
            const until = new Date(Date.now() + choice.hours * 3600_000).toISOString()
            patch({ muted: true, mutedUntil: until })
            void toggleMute(convId, until)
          },
        }))}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title={confirmDelete.payload?.title ?? 'Delete this chat?'}
        message={confirmDelete.payload?.message}
        confirmLabel={confirmDelete.payload?.label ?? 'Delete'}
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (deleting) return
          setDeleting(true)
          try {
            /* deleteConvo rolls the row back and toasts on failure, then
               rethrows — so leaving the screen is reachable ONLY from the
               success path. Dismissing regardless is how a failed delete used
               to read as a successful one. */
            await deleteConvo(convId)
            confirmDelete.close()
            router.dismissAll()
          } catch { /* the provider already restored the row and said why */ }
          finally { setDeleting(false) }
        }}
      />

      <ConfirmSheet
        visible={confirmLeave.visible}
        onClose={confirmLeave.close}
        title={convo.isChannel ? 'Leave this channel?' : 'Exit this group?'}
        message="You will stop receiving its messages. You can be added again by a member."
        confirmLabel="Leave"
        destructive
        loading={leaving}
        onConfirm={async () => {
          if (leaving) return
          setLeaving(true)
          try {
            /* Through the provider, so the rail loses the row in this frame
               rather than whenever the server's `member.changed` echo happens
               to arrive — and gets it back if the leave is refused. */
            await dropConvo(convId, () => api.chat.members.leave(convId), null)
            confirmLeave.close()
            router.dismissAll()
          } catch (e: any) {
            confirmLeave.close()
            /* The owner cannot leave while members remain — the server says so
               with a 400, and the only two ways out are transfer or delete.
               That sheet IS the message, which is why this call passes
               `null` and keeps the messaging. dropConvo has already put the
               row back either way. */
            if (e?.status === 400) ownerLeave.open()
            else toast.error(chatError(e, 'Could not leave this group'))
          } finally { setLeaving(false) }
        }}
      />

      <ActionSheet
        visible={ownerLeave.visible}
        onClose={ownerLeave.close}
        title="You own this group"
        subtitle="Transfer ownership before leaving, or delete the group."
        actions={[
          {
            label: 'Transfer ownership',
            icon: 'crown',
            onPress: () => router.push(`/chat/${convId}/members?mode=transfer`),
          },
          {
            label: 'Delete group',
            icon: 'trash',
            destructive: true,
            onPress: () => confirmDelete.open(deleteCopy),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmBlock.visible}
        onClose={confirmBlock.close}
        title={`Block @${convo.peer?.handle ?? 'this account'}?`}
        message="They will not be able to message you or find you. They are not told."
        confirmLabel="Block"
        destructive
        onConfirm={async () => {
          confirmBlock.close()
          try {
            await api.users.block(convo.peer?.id)
            toast.ok('Blocked')
            router.dismissAll()
          } catch (e) {
            toast.error(chatError(e, 'Could not block this account'))
          }
        }}
      />
    </Screen>
  )
}

function QuickAction({
  icon, label, onPress, active,
}: { icon: any; label: string; onPress: () => void; active?: boolean }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable onPress={onPress} feedback="scale" accessibilityLabel={label} style={styles.quick}>
      <View style={[styles.quickIcon, { backgroundColor: active ? c.accentSoft : c.surfaceSunken }]}>
        <Icon name={icon} size={20} color={active ? c.accent : c.textSecondary} />
      </View>
      <Text variant="micro" tone="muted" align="center">{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xl, gap: space.xs },
  heroTitle: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.md, paddingHorizontal: space.xxl },
  quickRow: { flexDirection: 'row', gap: 22, marginTop: space.lg2 },
  quick: { alignItems: 'center', gap: space.xs2, width: 56 },
  quickIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  description: { paddingHorizontal: space.lg, paddingVertical: space.md },
  thumbs: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 34, height: 34, borderRadius: 8, borderWidth: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
})
