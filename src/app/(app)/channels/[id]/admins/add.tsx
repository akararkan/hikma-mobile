/* =========================================================
   Promote a subscriber.

   `admins.promote` is a bare PUT, which the wire contract says
   grants FULL rights — on the request side a missing flag means
   true. That is why this screen promotes and then goes straight
   to the rights editor: the honest order is "they can do
   everything, now turn things off", not a promise that a
   half-filled form was applied.

   There is no member-search endpoint, so the filter runs over
   the pages already loaded and says so.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { usePaged } from '@/hooks/usePaged'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Chip, EmptyState, ErrorState, Header, Icon, ListFooter, Screen, SearchField,
  SkeletonList, Text, toast,
} from '@/ui'
import { MemberRow } from '@/components/channels/MemberRow'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (m: any) => String(m.userId)

export default function AddAdminScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [filter, setFilter] = React.useState('')
  const [picked, setPicked] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  const rights = useChannelRights(id)
  const roster = usePaged<any>(
    ({ page, pageSize }) => api.chat.members.list(id, args({ page, size: pageSize })),
    { mode: 'page', pageSize: 30, enabled: !!id, deps: [id], keyOf: (m: any) => String(m.userId) },
  )
  const existing = useAsync<any[]>(() => api.channels.admins.list(id), { enabled: !!id, deps: [id] })

  const adminIds = React.useMemo(
    () => new Set((existing.data || []).map((a: any) => a.userId)),
    [existing.data],
  )

  const shown = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return roster.items
    return roster.items.filter((m: any) =>
      String(m.fullName || '').toLowerCase().includes(q) || String(m.handle || '').toLowerCase().includes(q))
  }, [roster.items, filter])

  const promote = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api.channels.admins.promote(id, picked.userId)
      /* replace, not push: coming "back" to a picker for someone who is
         already an admin would be a dead end. */
      router.replace(chRoute.adminRights(id, picked.userId))
    } catch (e: any) {
      toast.error(errorText(e))
      void roster.refresh()
      void existing.refresh()
    } finally {
      setBusy(false)
    }
  }

  /* Identity-stable and item-first, so picking one person does not re-render
     every other row in the roster. */
  const pick = useEvent((m: any) => setPicked((cur: any) => (cur?.userId === m.userId ? null : m)))
  const openProfile = useEvent((m: any) => router.push(chRoute.user(m.userId)))
  const surface = t.colors.surface

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <CandidateRow
      member={item}
      already={adminIds.has(item.userId)}
      selected={picked?.userId === item.userId}
      surface={surface}
      onPick={pick}
      onOpen={openProfile}
    />
  ), [adminIds, picked?.userId, surface, pick, openProfile])

  if (!rights.loading && rights.channel && !rights.can('canAddAdmins')) {
    return (
      <Screen background="sunken">
        <Header closeButton title="Add admin" />
        <RefusalCard title="You can’t manage admins in this channel" onAction={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        closeButton
        title="Add admin"
        subtitle={rights.channel?.title}
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}>
            <SearchField value={filter} onChangeText={setFilter} placeholder="Search subscribers" />
          </View>
        }
      />

      {roster.loading ? (
        <SkeletonList count={6} />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={roster.reload} />
      ) : (
        <FlashList
          data={shown}
          keyExtractor={keyExtractor}
          extraData={`${picked?.userId}:${adminIds.size}`}
          renderItem={renderItem}
          ListEmptyComponent={
            filter ? (
              <EmptyState compact icon="search" title={`No subscriber matches “${filter}”`} message="Only the subscribers already loaded are searched." />
            ) : (
              <EmptyState
                icon="people"
                title="No subscribers yet"
                message="Invite people first — an admin has to already be a subscriber."
                actionLabel="Invite people"
                onAction={() => router.replace(chRoute.invites(id))}
              />
            )
          }
          ListFooterComponent={
            roster.items.length ? <ListFooter loading={roster.loadingMore} done={roster.done} doneLabel="" /> : null
          }
          onEndReached={roster.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={roster.refreshing}
          onRefresh={() => void roster.refresh()}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
        />
      )}

      <View
        style={{
          paddingHorizontal: t.layout.screenPadding,
          paddingTop: space.sm2,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 0.5,
          borderTopColor: t.colors.separator,
          backgroundColor: t.colors.bg,
          gap: space.sm,
        }}
      >
        <Text variant="footnote" tone="muted" align="ui">
          They’ll get every right — you can turn individual ones off on the next screen.
        </Text>
        <Button
          label={picked ? `Add ${picked.fullName} as admin` : 'Add as admin'}
          onPress={promote}
          disabled={!picked}
          loading={busy}
          size="lg"
          block
        />
      </View>
    </Screen>
  )
}

/* ---------------------------------------------------------
   One promotable subscriber. Memoized on scalars (`already`,
   `selected`) so a pick repaints two rows, not the page.
   --------------------------------------------------------- */

const CandidateRow = React.memo(function CandidateRow({
  member, already, selected, surface, onPick, onOpen,
}: {
  member: any
  already: boolean
  selected: boolean
  surface: string
  onPick: (m: any) => void
  onOpen: (m: any) => void
}) {
  const t = useTheme()
  const restricted = member.status && member.status !== 'ACTIVE'
  const pick = React.useCallback(() => onPick(member), [onPick, member])
  const open = React.useCallback(() => onOpen(member), [onOpen, member])

  return (
    <View style={{ backgroundColor: surface }}>
      <MemberRow
        member={member}
        dimmed={already}
        disabled={already}
        onPress={already ? undefined : pick}
        onLongPress={open}
        showRolePill={false}
        trailing={
          already ? <Chip label="Admin" tone="accent" size="sm" />
            : (
              <View style={styles.trailing}>
                {restricted ? <Chip label="Restricted" tone="warning" size="sm" /> : null}
                <View
                  style={[
                    styles.check,
                    {
                      borderWidth: selected ? 0 : 1.5,
                      borderColor: t.colors.borderStrong,
                      backgroundColor: selected ? t.colors.accent : 'transparent',
                    },
                  ]}
                >
                  {selected ? <Icon name="check" size={14} color={t.colors.textOnAccent} /> : null}
                </View>
              </View>
            )
        }
      />
    </View>
  )
})

const styles = StyleSheet.create({
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* An empty checkbox is a sanctioned circle, not a plate. */
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
