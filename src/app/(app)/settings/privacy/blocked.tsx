/* =========================================================
   Blocked accounts.

   Unblocking is not symmetric with blocking: it does not
   restore a follow, and the docs are explicit that a block
   severs the relationship in both directions. So the
   confirmation says what unblocking actually does rather than
   implying things go back to how they were.

   Scroll shape: module-scope keyExtractor, a memoized row, and
   item-first handlers threaded through useEvent — FlashList
   compares renderItem by identity, so an inline arrow there
   would re-render every mounted cell on every screen render.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { applySocialStatus } from '@/components/profile/useSocialStatus'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, ConfirmSheet, EmptyState, ErrorState, Header, ListFooter,
  Screen, SkeletonRow, Text, useSheetState, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

const BlockedRow = React.memo(function BlockedRow({
  item, onPressUser, onUnblock,
}: { item: any; onPressUser: (id: string) => void; onUnblock: (user: any) => void }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: t.layout.screenPadding }}>
      <Avatar
        uri={item.avatarUrl}
        name={item.displayName}
        seed={item.id}
        size="md"
        onPress={() => onPressUser(String(item.id))}
      />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" align="ui" numberOfLines={1}>
          {item.displayName || item.username}
        </Text>
        <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
          @{item.handle || item.username}
        </Text>
      </View>
      <Button label="Unblock" variant="secondary" size="sm" onPress={() => onUnblock(item)} />
    </View>
  )
})

export default function BlockedScreen() {
  const router = useRouter()
  const confirm = useSheetState<any>()
  const [busy, setBusy] = React.useState(false)

  const list = usePaged<any>(
    ({ page, pageSize, signal }) => api.settings.blocks.list({ page, size: pageSize, signal }),
    { mode: 'page', pageSize: 30 },
  )

  const unblock = async () => {
    const user = confirm.payload
    if (!user) return
    setBusy(true)
    try {
      const res: any = await api.settings.blocks.unblock(user.id)
      list.remove(String(user.id))
      /* Adopt the authoritative flags so a profile screen behind this list
         agrees without refetching (SocialActionResponse.updatedStatus). */
      applySocialStatus(String(user.id), res?.updatedStatus ?? { isBlocking: false })
      toast.ok(`Unblocked @${user.handle || user.handle}`)
    } catch (e) {
      /* 404 = the block edge is already gone — that IS the desired end state,
         so the row leaves quietly instead of shouting. */
      if (isNotFound(e)) {
        list.remove(String(user.id))
        applySocialStatus(String(user.id), { isBlocking: false })
      } else {
        toast.error(errorText(e, 'Could not unblock that account.'))
      }
    } finally {
      setBusy(false)
      confirm.close()
    }
  }

  /* One function per handler for the whole list, not one per row. */
  const onPressUser = useEvent((id: string) => router.push(`/user/${id}`))
  const onUnblock = useEvent((user: any) => confirm.open(user))
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <BlockedRow item={item} onPressUser={onPressUser} onUnblock={onUnblock} />,
    [onPressUser, onUnblock],
  )

  return (
    <Screen>
      <Header back title="Blocked accounts" />

      {list.loading ? (
        <View>{Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)}</View>
      ) : list.error && !list.items.length ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={list.items}
          keyExtractor={keyExtractor}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          ListEmptyComponent={
            <EmptyState
              icon="block"
              title="Nobody is blocked"
              message="When you block someone they can't see your profile, message you, or find you in search — and you won't see them either."
            />
          }
          ListFooterComponent={
            list.items.length
              ? <ListFooter loading={list.loadingMore} error={list.error} onRetry={list.loadMore} done={list.done} doneLabel="" />
              : null
          }
          renderItem={renderItem}
        />
      )}

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={`Unblock @${confirm.payload?.handle || confirm.payload?.username || ''}?`}
        message="They'll be able to see your profile and message you again. You won't be following each other — blocking removed that, and unblocking doesn't restore it."
        confirmLabel="Unblock"
        loading={busy}
        icon="personAdd"
        onConfirm={() => void unblock()}
      />
    </Screen>
  )
}
