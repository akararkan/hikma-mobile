/* =========================================================
   Admins.

   `rightsFrom` normalises a null rights object to all-true, so
   the owner and every legacy admin read as "full rights" without
   the screen special-casing them. The owner row is not editable
   at all — the server refuses it, and offering a control that
   always fails is worse than not offering one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { RIGHT_KEYS, RIGHT_LABELS, api, errorText, isNotFound } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, ConfirmSheet, EmptyState, ErrorState, Header, Screen, SkeletonList,
  Text, Touchable, toast, useSheetState,
} from '@/ui'
import { MemberRow } from '@/components/channels/MemberRow'
import { GoneCard } from '@/components/channels/states'
import { useChannelRights, useChannelStream } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

type Row =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'admin'; key: string; admin: any }
  | { kind: 'footer'; key: string; text: string }
  | { kind: 'transfer'; key: string }
  | { kind: 'empty'; key: string }

/* Module scope. `getItemType` keeps the five row shapes in five recycle pools
   — without it a section label's React key gets handed to an admin row. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function AdminsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel
  const admins = rights.admins

  const menu = useSheetState<any>()
  const confirmDemote = useSheetState<any>()
  const transfer = useSheetState()
  const confirmTransfer = useSheetState<any>()
  /* A LAST_ADMIN refusal is stable for the session: the roster cannot lose
     its final admin no matter how many times the button is pressed. */
  const [blockedDemote, setBlockedDemote] = React.useState<Set<string>>(new Set())

  useFocusEffect(React.useCallback(() => { rights.reload() }, [id]))   // eslint-disable-line react-hooks/exhaustive-deps

  useChannelStream(id, {
    onMember: e => { if (e.memberChange === 'PROMOTED' || e.memberChange === 'DEMOTED') rights.reload() },
  })

  const canAddAdmins = rights.can('canAddAdmins')
  const owner = admins.find((a: any) => a.role === 'OWNER')
  const others = admins.filter((a: any) => a.role !== 'OWNER')

  const demote = async (row: any) => {
    try {
      await api.channels.admins.demote(id, row.userId)
      rights.reload()
      toast.ok(`${row.fullName} is a subscriber again`)
    } catch (e: any) {
      if (e?.status === 409) setBlockedDemote(s => new Set(s).add(row.userId))
      toast.error(errorText(e))
      rights.reload()
    }
  }

  const doTransfer = async (row: any) => {
    try {
      await api.chat.members.transferOwner(id, row.userId)
      rights.reload()
      toast.ok(`${row.fullName} now owns this channel`)
    } catch (e: any) { toast.error(errorText(e)) }
  }

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    if (owner) {
      out.push({ kind: 'section', key: 's-owner', title: 'Owner' })
      out.push({ kind: 'admin', key: `a-${owner.userId}`, admin: owner })
    }
    out.push({ kind: 'section', key: 's-admins', title: `Admins (${others.length})` })
    if (!others.length) out.push({ kind: 'empty', key: 'empty' })
    for (const a of others) out.push({ kind: 'admin', key: `a-${a.userId}`, admin: a })
    out.push({
      kind: 'footer',
      key: 'foot',
      text: 'Rights only ever remove capability — a new admin starts with everything unless you turn something off.',
    })
    if (channel?.isOwner && others.length) out.push({ kind: 'transfer', key: 'transfer' })
    return out
  }, [owner, others, channel?.isOwner])

  /* Identity-stable and item-first, so `renderItem` survives a PROMOTED /
     DEMOTED frame instead of repainting every row with it. */
  const openRights = useEvent((a: any) => router.push(chRoute.adminRights(id, a.userId)))
  const openRowMenu = useEvent((a: any) => menu.open(a))
  const openTransfer = useEvent(() => transfer.open())
  const openAddAdmin = useEvent(() => router.push(chRoute.addAdmin(id)))
  const screenPadding = t.layout.screenPadding
  const surface = t.colors.surface

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    switch (item.kind) {
      case 'section':
        return (
          <View style={[styles.section, { paddingHorizontal: screenPadding }]}>
            {/* `caption` uppercases Latin only, inside the Text primitive —
                a manual transform would hit Arabic and Kurdish too. */}
            <Text variant="caption" tone="muted" align="ui">{item.title}</Text>
          </View>
        )
      case 'admin':
        return (
          <AdminRow
            admin={item.admin}
            surface={surface}
            onOpen={openRights}
            onMenu={openRowMenu}
          />
        )
      case 'empty':
        return (
          <EmptyState
            compact
            icon="shield"
            title="No other admins yet"
            message="An admin can post, pin and moderate on your behalf."
            actionLabel={canAddAdmins ? 'Add an admin' : undefined}
            onAction={openAddAdmin}
          />
        )
      case 'footer':
        return (
          <Text variant="footnote" tone="muted" align="ui" style={{ padding: screenPadding }}>
            {item.text}
          </Text>
        )
      case 'transfer':
        return (
          <Touchable onPress={openTransfer} feedback="dim" style={{ padding: screenPadding }}>
            <Text variant="body" tone="danger" align="ui">Transfer ownership</Text>
          </Touchable>
        )
    }
  }, [screenPadding, surface, canAddAdmins, openRights, openRowMenu, openTransfer, openAddAdmin])

  if (rights.error && isNotFound(rights.error)) {
    return (
      <Screen background="sunken">
        <Header back title="Admins" />
        <GoneCard onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Admins"
        subtitle={channel?.title}
        actions={canAddAdmins ? [{ icon: 'personAdd', onPress: () => router.push(chRoute.addAdmin(id)), label: 'Add admin' }] : []}
      />

      {rights.loading && !admins.length ? (
        <SkeletonList count={4} />
      ) : rights.error ? (
        <ErrorState error={rights.error} onRetry={rights.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: space.huge }}
          refreshing={rights.loading}
          onRefresh={() => void rights.refresh()}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.fullName}
        actions={[
          { label: 'Edit rights', icon: 'shield', onPress: () => router.push(chRoute.adminRights(id, menu.payload.userId)) },
          { label: 'View profile', icon: 'person', onPress: () => router.push(chRoute.user(menu.payload.userId)) },
          {
            label: 'Demote to subscriber',
            icon: 'personRemove',
            destructive: true,
            disabled: blockedDemote.has(menu.payload?.userId),
            onPress: () => confirmDemote.open(menu.payload),
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmDemote.visible}
        onClose={confirmDemote.close}
        title={`Demote ${confirmDemote.payload?.fullName}?`}
        message="They’ll become a regular subscriber and lose every admin right."
        confirmLabel="Demote"
        destructive
        onConfirm={() => { const row = confirmDemote.payload; confirmDemote.close(); void demote(row) }}
      />

      <ActionSheet
        visible={transfer.visible}
        onClose={transfer.close}
        title="Transfer ownership"
        subtitle="Pick the admin who will own this channel"
        actions={others.map((a: any) => ({
          label: a.fullName,
          subtitle: a.handle ? `@${a.handle}` : undefined,
          icon: 'crown' as const,
          onPress: () => confirmTransfer.open(a),
        }))}
      />

      <ConfirmSheet
        visible={confirmTransfer.visible}
        onClose={confirmTransfer.close}
        title={`Make ${confirmTransfer.payload?.fullName} the owner?`}
        message="You will become an admin. This cannot be undone."
        confirmLabel="Transfer"
        destructive
        onConfirm={() => { const row = confirmTransfer.payload; confirmTransfer.close(); void doTransfer(row) }}
      />
    </Screen>
  )
}

/** 'Full rights', or the two most notable plus a count — enough to tell two
 *  admins apart in a list without opening either. */
function summarise(admin: any): string {
  const flags = admin?.rights || {}
  const on = (RIGHT_KEYS as string[]).filter(k => flags[k] !== false)
  if (on.length === RIGHT_KEYS.length) return 'Full rights'
  if (!on.length) return 'No rights'
  const labels = on.map(k => (RIGHT_LABELS as unknown as Record<string, [string, string]>)[k][0].split(' ')[0])
  const head = labels.slice(0, 2).join(', ')
  return on.length > 2 ? `${head} +${on.length - 2} more` : head
}

/* ---------------------------------------------------------
   One admin. Memoized so a reload of the roster repaints only
   the rows whose record changed.
   --------------------------------------------------------- */

const AdminRow = React.memo(function AdminRow({
  admin, surface, onOpen, onMenu,
}: { admin: any; surface: string; onOpen: (a: any) => void; onMenu: (a: any) => void }) {
  /* The owner row is not editable at all — the server refuses it, and a
     control that always fails is worse than no control. */
  const isOwnerRow = admin.role === 'OWNER'
  const open = React.useCallback(() => onOpen(admin), [onOpen, admin])
  const menu = React.useCallback(() => onMenu(admin), [onMenu, admin])

  return (
    <View style={{ backgroundColor: surface }}>
      <MemberRow
        member={admin}
        subtitle={admin.handle ? `@${admin.handle}` : ''}
        onPress={isOwnerRow ? undefined : open}
        onLongPress={isOwnerRow ? undefined : menu}
        trailing={
          <View style={styles.trailing}>
            <Text variant="micro" tone="faint">Since {admin.time}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>{summarise(admin)}</Text>
          </View>
        }
      />
    </View>
  )
})

const styles = StyleSheet.create({
  section: { paddingTop: 22, paddingBottom: space.sm },
  trailing: { alignItems: 'flex-end', gap: space.xxs },
})
