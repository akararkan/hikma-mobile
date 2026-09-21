/* =========================================================
   Subscribers.

   `settings.hiddenSubscribers` makes `members.list` answer 403
   SUBSCRIBERS_HIDDEN for non-admins — but the COUNT on the
   channel record stays public. So the refusal state still shows
   the number; hiding it too would be stricter than the backend
   and read as an error.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import {
  ActionSheet, ConfirmSheet, EmptyState, ErrorState, Header, ListFooter, Screen,
  SearchField, SegmentedControl, SkeletonList, Text, formatCount, toast, useSheetState,
} from '@/ui'
import { MemberRow } from '@/components/channels/MemberRow'
import { RefusalCard, TopStrip } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

type Filter = 'all' | 'admins' | 'restricted'

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (m: any) => String(m.userId)

export default function SubscribersScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [filter, setFilter] = React.useState('')
  const [tab, setTab] = React.useState<Filter>('all')
  const [presence, setPresence] = React.useState<Record<string, string>>({})

  const rights = useChannelRights(id)
  const channel = rights.channel

  const roster = usePaged<any>(
    ({ page, pageSize }) => api.chat.members.list(id, args({ page, size: pageSize })),
    { mode: 'page', pageSize: 30, enabled: !!id, deps: [id], keyOf: (m: any) => String(m.userId) },
  )

  /* Presence rides one batched call per page. The api short-circuits an empty
     array, so a page of nobody costs nothing. */
  const seenIds = React.useRef(new Set<string>())
  React.useEffect(() => {
    const fresh = roster.items.map((m: any) => m.userId).filter(uid => uid && !seenIds.current.has(uid))
    if (!fresh.length) return
    fresh.forEach(uid => seenIds.current.add(uid))
    api.chat.presence(fresh)
      .then((rows: any[]) => setPresence(prev => {
        const next = { ...prev }
        for (const r of rows) next[r.userId] = r.status
        return next
      }))
      .catch(() => {})
  }, [roster.items])

  useChannelStream(id, {
    onMember: () => { void roster.refresh(); rights.reload() },
  })

  const menu = useSheetState<any>()
  const confirm = useSheetState<{ member: any; kind: 'remove' | 'transfer' }>()

  const canInvite = rights.can('canInviteUsers')
  const canAddAdmins = rights.can('canAddAdmins')
  const hiddenRefusal = roster.error?.status === 403

  const shown = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    return roster.items.filter((m: any) => {
      if (tab === 'admins' && m.role !== 'ADMIN' && m.role !== 'OWNER') return false
      if (tab === 'restricted' && m.status === 'ACTIVE') return false
      if (!q) return true
      return String(m.fullName || '').toLowerCase().includes(q) || String(m.handle || '').toLowerCase().includes(q)
    })
  }, [roster.items, filter, tab])

  /* ---- row actions, all optimistic with a restore on failure ---- */

  const act = async (member: any, run: () => Promise<any>, optimistic?: () => void, undo?: () => void) => {
    optimistic?.()
    try { await run() }
    catch (e: any) { undo?.(); toast.error(errorText(e)); void roster.refresh(); rights.reload() }
  }

  const removeMember = (m: any) => act(
    m,
    () => api.chat.members.remove(id, m.userId),
    () => roster.remove(String(m.userId)),
    () => void roster.refresh(),
  )
  const setRestricted = (m: any, next: boolean) => act(
    m,
    () => api.chat.members.restrict(id, m.userId, next),
    () => roster.patch(String(m.userId), x => ({ ...x, status: next ? 'RESTRICTED' : 'ACTIVE' })),
    () => roster.patch(String(m.userId), x => ({ ...x, status: m.status })),
  )
  const setRole = (m: any, role: 'ADMIN' | 'MEMBER') => act(
    m,
    () => api.chat.members.setRole(id, m.userId, role),
    () => roster.patch(String(m.userId), x => ({ ...x, role })),
    () => roster.patch(String(m.userId), x => ({ ...x, role: m.role })),
  )
  const transferOwner = (m: any) => act(m, () => api.chat.members.transferOwner(id, m.userId))

  /* Identity-stable and item-first: presence lands one batch at a time, and
     an inline renderItem would repaint the whole roster with it. */
  const openProfile = useEvent((m: any) => router.push(chRoute.user(m.userId)))
  const openMenu = useEvent((m: any) => menu.open(m))
  const isAdmin = !!channel?.isAdmin
  const surface = t.colors.surface

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <SubscriberRow
      member={item}
      presence={presence[item.userId]}
      surface={surface}
      canManage={isAdmin}
      onOpen={openProfile}
      onMenu={openMenu}
    />
  ), [presence, surface, isAdmin, openProfile, openMenu])

  if (hiddenRefusal && !channel?.isAdmin) {
    return (
      <Screen background="sunken">
        <Header back title="Subscribers" />
        <RefusalCard error={roster.error} title="This list is hidden" actionLabel={null} />
        <Text variant="callout" tone="muted" align="center" style={{ marginTop: -space.xxl }}>
          {formatCount(channel?.subscriberCount)} subscribers
        </Text>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Subscribers"
        subtitle={roster.extra?.total != null ? `${roster.extra.total}` : formatCount(channel?.subscriberCount)}
        actions={canInvite ? [{ icon: 'personAdd', onPress: () => router.push(chRoute.addPeople(id)), label: 'Add subscribers' }] : []}
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2, gap: space.sm2 }}>
            <SearchField value={filter} onChangeText={setFilter} placeholder="Filter loaded subscribers" />
            <SegmentedControl
              options={[
                { value: 'all', label: 'All' },
                { value: 'admins', label: 'Admins' },
                { value: 'restricted', label: 'Restricted' },
              ]}
              value={tab}
              onChange={setTab}
            />
          </View>
        }
      />

      {channel?.settings?.hiddenSubscribers && channel?.isAdmin ? (
        <TopStrip>The subscriber list is hidden from non-admins.</TopStrip>
      ) : null}

      {roster.loading ? (
        <SkeletonList count={8} />
      ) : roster.error && !hiddenRefusal ? (
        <ErrorState error={roster.error} onRetry={roster.reload} />
      ) : (
        <FlashList
          data={shown}
          keyExtractor={keyExtractor}
          extraData={`${tab}:${Object.keys(presence).length}`}
          renderItem={renderItem}
          ListEmptyComponent={
            filter || tab !== 'all' ? (
              <EmptyState compact icon="search" title="Nobody matches that filter" message="Only the pages already loaded are filtered." />
            ) : (
              <EmptyState
                icon="people"
                title="No subscribers yet"
                message="Share the channel and people will show up here."
                actionLabel={channel?.shareUrl ? 'Share the channel' : undefined}
                onAction={() => router.push(chRoute.invites(id))}
              />
            )
          }
          ListFooterComponent={
            roster.items.length ? (
              <ListFooter
                loading={roster.loadingMore}
                done={roster.done}
                doneLabel={`${formatCount(roster.extra?.total ?? channel?.subscriberCount)} subscribers`}
              />
            ) : null
          }
          onEndReached={roster.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={roster.refreshing}
          onRefresh={() => void roster.refresh()}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.huge }}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.fullName}
        subtitle={menu.payload?.handle ? `@${menu.payload.handle}` : undefined}
        actions={[
          { label: 'View profile', icon: 'person', onPress: () => router.push(chRoute.user(menu.payload.userId)) },
          {
            label: 'Make admin',
            icon: 'shield',
            hidden: !canAddAdmins || menu.payload?.role !== 'MEMBER',
            onPress: () => void setRole(menu.payload, 'ADMIN'),
          },
          {
            label: 'Edit rights',
            icon: 'settings',
            hidden: !canAddAdmins || menu.payload?.role !== 'ADMIN',
            onPress: () => router.push(chRoute.adminRights(id, menu.payload.userId)),
          },
          {
            label: menu.payload?.status === 'ACTIVE' ? 'Restrict' : 'Unrestrict',
            icon: 'block',
            hidden: menu.payload?.role === 'OWNER',
            onPress: () => void setRestricted(menu.payload, menu.payload?.status === 'ACTIVE'),
          },
          {
            label: 'Remove from channel',
            icon: 'personRemove',
            destructive: true,
            hidden: menu.payload?.role === 'OWNER',
            onPress: () => confirm.open({ member: menu.payload, kind: 'remove' }),
          },
          {
            label: 'Transfer ownership',
            icon: 'crown',
            destructive: true,
            hidden: !channel?.isOwner || menu.payload?.role === 'OWNER',
            onPress: () => confirm.open({ member: menu.payload, kind: 'transfer' }),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={
          confirm.payload?.kind === 'transfer'
            ? `Make ${confirm.payload?.member?.fullName} the owner?`
            : `Remove ${confirm.payload?.member?.fullName}?`
        }
        message={
          confirm.payload?.kind === 'transfer'
            ? 'You will become an admin. This cannot be undone.'
            : 'They’ll lose access to new posts. They can subscribe again if the channel is public.'
        }
        confirmLabel={confirm.payload?.kind === 'transfer' ? 'Transfer' : 'Remove'}
        destructive
        onConfirm={() => {
          const p = confirm.payload
          confirm.close()
          if (!p) return
          if (p.kind === 'transfer') void transferOwner(p.member)
          else void removeMember(p.member)
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One subscriber. Memoized on scalars — the presence STRING,
   not the presence map — so a presence batch only repaints the
   rows whose status actually changed.
   --------------------------------------------------------- */

const SubscriberRow = React.memo(function SubscriberRow({
  member, presence, surface, canManage, onOpen, onMenu,
}: {
  member: any
  presence?: string
  surface: string
  canManage: boolean
  onOpen: (m: any) => void
  onMenu: (m: any) => void
}) {
  const open = React.useCallback(() => onOpen(member), [onOpen, member])
  const menu = React.useCallback(() => onMenu(member), [onMenu, member])
  return (
    <View style={{ backgroundColor: surface }}>
      <MemberRow
        member={member}
        presence={presence}
        subtitle={`${member.handle ? `@${member.handle}` : ''}${member.time ? ` · joined ${member.time}` : ''}`}
        onPress={open}
        onMenu={canManage ? menu : undefined}
      />
    </View>
  )
})
