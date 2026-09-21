/* =========================================================
   Members.

   Every entry in the action sheet is computed from the
   permission matrix BEFORE the sheet renders (see
   ./components/chat/permissions.ts), so an admin never sees
   "Remove from group" on the owner and can never reach a 403.

   `?mode=transfer` reuses the same roster as an owner-picker:
   restricted members are filtered out (they cannot own a group)
   and a tap opens the two-step transfer confirm instead of the
   action sheet.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatActions, useChatSettings, useConversation } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, ConfirmSheet, EmptyState, Header, ListRow, Screen, SearchField,
  SkeletonList, Text, toast, useSheetState,
} from '@/ui'
import { MemberRow } from '@/components/chat/MemberRow'
import { canAddMembers, memberRights } from '@/components/chat/permissions'
import { ChatErrorState } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

type Row =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'member'; key: string; member: any }

/* Module scope; `getItemType` keeps the Admins/Members band out of the 64pt
   roster row's recycle pool, so crossing a band swaps props instead of
   remounting a row with an avatar in it. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

export default function MembersScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  const convId = String(id)
  const transferMode = mode === 'transfer'

  const { user } = useAuth()
  const myId = user?.id ? String(user.id) : null
  const { trackPresence, subscribe } = useChatActions()
  const chatSettings = useChatSettings()
  const dir = useUserDirectory()

  const convoQ = useAsync<any>(() => api.chat.conversations.get(convId), { deps: [convId] })
  /* The live inbox/archived row, subscribed per-key — a render-time getConvo()
     here would go permanently stale now that this screen no longer re-renders
     on inbox churn (the header count reads it until convoQ lands). */
  const liveRow = useConversation(convId)
  const convo = convoQ.data ?? liveRow

  const roster = useAsync<any>(() => api.chat.members.list(convId, { page: 0, size: 256 }), { deps: [convId] })
  const [query, setQuery] = React.useState('')
  const actions = useSheetState<any>()
  const confirmRemove = useSheetState<any>()
  const confirmTransfer = useSheetState<any>()
  const confirmTransfer2 = useSheetState<any>()

  const items: any[] = React.useMemo(() => roster.data?.items || [], [roster.data])

  React.useEffect(() => {
    const ids = items.map(m => m.userId)
    dir.watchUsers(ids)
    trackPresence(ids)
  }, [items, dir, trackPresence])

  /* Every mutation is reconciled by the `member.changed` frame rather than a
     refetch — a 256-row roster is not worth re-reading for one promotion.
     The ONE exception is ADDED/SUBSCRIBED: the frame carries an id and a
     role but no name, handle or face, so there is nothing to insert a row
     FROM — the roster must be re-read. Debounced, because "add 40 people"
     arrives as 40 frames and must cost one GET, not forty. */
  const addedReload = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (addedReload.current) clearTimeout(addedReload.current) }, [])
  React.useEffect(() => subscribe(evt => {
    if (evt.type !== 'member.changed' || String(evt.conversationId) !== convId) return
    const change = evt.memberChange
    if (change === 'ADDED' || change === 'SUBSCRIBED') {
      if (addedReload.current) clearTimeout(addedReload.current)
      addedReload.current = setTimeout(() => { void roster.reload() }, 400)
      return
    }
    roster.setData((prev: any) => {
      if (!prev) return prev
      if (change === 'REMOVED' || change === 'LEFT' || change === 'UNSUBSCRIBED') {
        return { ...prev, items: prev.items.filter((m: any) => String(m.userId) !== String(evt.userId)) }
      }
      return {
        ...prev,
        items: prev.items.map((m: any) => (
          String(m.userId) === String(evt.userId)
            ? {
              ...m,
              role: change === 'PROMOTED' ? (evt.role || 'ADMIN') : change === 'DEMOTED' ? 'MEMBER' : m.role,
              status: change === 'RESTRICTED' ? 'RESTRICTED' : change === 'UNRESTRICTED' ? 'ACTIVE' : m.status,
            }
            : m
        )),
      }
    })
  }), [subscribe, convId, roster])

  const patchLocal = React.useCallback((userId: string, fields: any) => {
    roster.setData((prev: any) => (prev
      ? { ...prev, items: prev.items.map((m: any) => (String(m.userId) === String(userId) ? { ...m, ...fields } : m)) }
      : prev))
  }, [roster])

  const run = React.useCallback(async (member: any, fn: () => Promise<any>, optimistic: any, rollback: any) => {
    patchLocal(member.userId, optimistic)
    try { await fn() }
    catch (e) {
      if (isNotFound(e)) {
        /* Already gone — the roster is correct, so say nothing. */
        roster.setData((prev: any) => (prev
          ? { ...prev, items: prev.items.filter((m: any) => String(m.userId) !== String(member.userId)) }
          : prev))
        return
      }
      patchLocal(member.userId, rollback)
      toast.error(chatError(e, 'Could not update this member'))
    }
  }, [patchLocal, roster])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items
    if (transferMode) {
      /* A restricted member cannot own a group, and neither can I. */
      list = list.filter(m => m.status !== 'RESTRICTED' && String(m.userId) !== String(myId))
    }
    if (q) {
      list = list.filter(m =>
        String(m.fullName || '').toLowerCase().includes(q)
        || String(m.handle || '').toLowerCase().includes(q))
    }
    return list
  }, [items, query, transferMode, myId])

  const rows = React.useMemo<Row[]>(() => {
    const rank = (m: any) => (m.role === 'OWNER' ? 0 : m.role === 'ADMIN' ? 1 : 2)
    const sorted = [...filtered].sort((a, b) => rank(a) - rank(b) || String(a.fullName).localeCompare(String(b.fullName)))
    const out: Row[] = []
    let lastGroup = ''
    for (const m of sorted) {
      const group = rank(m) < 2 ? 'Admins' : 'Members'
      if (group !== lastGroup) {
        lastGroup = group
        out.push({ kind: 'section', key: `s-${group}`, label: group })
      }
      out.push({ kind: 'member', key: String(m.userId), member: m })
    }
    return out
  }, [filtered])

  /* Identity-stable and member-first: one function for every row, so
     renderItem below survives a roster patch and FlashList leaves the cells
     it did not touch alone. */
  const openFor = useEvent((member: any) => {
    if (transferMode) { confirmTransfer.open(member); return }
    const rights = memberRights(convo, member, myId)
    if (!Object.values(rights).some(Boolean)) { router.push(`/u/${member.handle || member.userId}`); return }
    actions.open(member)
  })

  const renderRow = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'section') {
      return (
        <View style={[styles.section, { backgroundColor: c.surfaceSunken }]}>
          {/* `micro` uppercases Latin inside the primitive — a call-site
              transform would also shout at Arabic and Kurdish. */}
          <Text variant="micro" tone="muted" align="ui">{item.label}</Text>
        </View>
      )
    }
    const m = item.member
    return (
      <MemberRow
        member={m}
        card={dir.userOf(m.userId)}
        presenceVisible={chatSettings.lastSeenVisible}
        isMe={!!myId && String(m.userId) === myId}
        onPress={() => openFor(m)}
        onLongPress={() => openFor(m)}
      />
    )
  }, [c.surfaceSunken, dir, chatSettings.lastSeenVisible, myId, openFor])

  if (roster.loading && !items.length) {
    return (
      <Screen>
        <Header back title="Members" />
        <SkeletonList count={8} />
      </Screen>
    )
  }

  if (roster.error && !items.length) {
    return (
      <Screen>
        <Header back title="Members" />
        <ChatErrorState
          error={roster.error}
          title={codeOf(roster.error) === 'NOT_A_MEMBER' ? 'You are not a member of this group' : 'Could not load members'}
          onRetry={roster.reload}
          back={() => router.back()}
        />
      </Screen>
    )
  }

  const rights = actions.payload ? memberRights(convo, actions.payload, myId) : null

  return (
    <Screen>
      <Header
        back
        title={transferMode ? 'Choose a new owner' : 'Members'}
        /* The LIVE row first: ChatContext moves memberCount on every
           member.changed frame, while convoQ is a mount-time snapshot — the
           old order froze the count for the life of the screen. */
        subtitle={transferMode ? undefined : `${liveRow?.memberCount ?? convo?.memberCount ?? items.length} members`}
        actions={[
          !transferMode && canAddMembers(convo)
            ? { icon: 'personAdd', onPress: () => router.push(`/chat/${convId}/add-members`), label: 'Add members' }
            : null,
        ]}
        below={
          <View style={styles.field}>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search members" />
          </View>
        }
      />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        keyboardShouldPersistTaps="handled"
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          query.trim()
            ? <EmptyState icon="search" title={`No members match “${query.trim()}”`} compact />
            : <EmptyState icon="people" title="No members yet" compact />
        }
        ListFooterComponent={
          !transferMode && canAddMembers(convo) ? (
            <ListRow
              title="Add members"
              icon="personAdd"
              iconTone="accent"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push(`/chat/${convId}/add-members`)}
            />
          ) : null
        }
      />

      <ActionSheet
        visible={actions.visible}
        onClose={actions.close}
        title={actions.payload?.fullName}
        subtitle={actions.payload?.handle ? `@${actions.payload.handle}` : undefined}
        actions={[
          {
            label: 'View profile',
            icon: 'person',
            onPress: () => {
              const m = actions.payload
              if (m) router.push(`/u/${m.handle || m.userId}`)
            },
          },
          {
            label: 'Make admin',
            icon: 'shield',
            hidden: !rights?.promote,
            onPress: () => {
              const m = actions.payload
              if (m) void run(m, () => api.chat.members.setRole(convId, m.userId, 'ADMIN'), { role: 'ADMIN' }, { role: m.role })
            },
          },
          {
            label: 'Dismiss as admin',
            icon: 'personRemove',
            hidden: !rights?.demote,
            onPress: () => {
              const m = actions.payload
              if (m) void run(m, () => api.chat.members.setRole(convId, m.userId, 'MEMBER'), { role: 'MEMBER' }, { role: m.role })
            },
          },
          {
            label: 'Restrict (read-only)',
            icon: 'lock',
            hidden: !rights?.restrict,
            onPress: () => {
              const m = actions.payload
              if (m) void run(m, () => api.chat.members.restrict(convId, m.userId, true), { status: 'RESTRICTED' }, { status: m.status })
            },
          },
          {
            label: 'Lift restriction',
            icon: 'unlock',
            hidden: !rights?.unrestrict,
            onPress: () => {
              const m = actions.payload
              if (m) void run(m, () => api.chat.members.restrict(convId, m.userId, false), { status: 'ACTIVE' }, { status: m.status })
            },
          },
          {
            label: 'Transfer ownership',
            icon: 'crown',
            hidden: !rights?.transfer,
            onPress: () => { if (actions.payload) confirmTransfer.open(actions.payload) },
          },
          {
            label: 'Remove from group',
            icon: 'personRemove',
            destructive: true,
            hidden: !rights?.remove,
            onPress: () => { if (actions.payload) confirmRemove.open(actions.payload) },
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmRemove.visible}
        onClose={confirmRemove.close}
        title={`Remove ${confirmRemove.payload?.fullName ?? 'this member'}?`}
        message="They will lose access to this group's messages. You can add them again later."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const m = confirmRemove.payload
          confirmRemove.close()
          if (!m) return
          roster.setData((prev: any) => (prev
            ? { ...prev, items: prev.items.filter((x: any) => String(x.userId) !== String(m.userId)) }
            : prev))
          try { await api.chat.members.remove(convId, m.userId) }
          catch (e) {
            if (!isNotFound(e)) {
              void roster.reload()
              toast.error(chatError(e, 'Could not remove this member'))
            }
          }
        }}
      />

      <ConfirmSheet
        visible={confirmTransfer.visible}
        onClose={confirmTransfer.close}
        title={`Make @${confirmTransfer.payload?.handle ?? 'them'} the owner?`}
        message="They will be able to delete the group and change every setting."
        confirmLabel="Continue"
        onConfirm={() => {
          const m = confirmTransfer.payload
          confirmTransfer.close()
          if (m) confirmTransfer2.open(m)
        }}
      />

      <ConfirmSheet
        visible={confirmTransfer2.visible}
        onClose={confirmTransfer2.close}
        title="You will become an admin"
        message="This cannot be undone."
        confirmLabel="Transfer"
        destructive
        onConfirm={async () => {
          const m = confirmTransfer2.payload
          confirmTransfer2.close()
          if (!m) return
          try {
            await api.chat.members.transferOwner(convId, m.userId)
            toast.ok('Ownership transferred')
            void roster.reload()
            void convoQ.reload()
            if (transferMode) router.back()
          } catch (e) {
            toast.error(chatError(e, 'Could not transfer ownership'))
          }
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  section: { paddingHorizontal: space.lg, paddingVertical: space.sm },
})
