/* =========================================================
   Restricted accounts.

   Restriction is the quiet middle ground between doing nothing
   and blocking: their messages land in the request folder
   instead of the inbox, and they are never told.

   Only half of it is built. The backend enforces restriction on
   direct messages; comment quarantine — the other half of what
   the pattern means everywhere else — is not wired yet. The
   footnote says so, because a user who restricts someone to
   silence their comments and then sees those comments has been
   misled by this screen, not by the backend.

   `users.restricted()` returns a PLAIN ARRAY, not a page
   envelope — the `{page, size}` it takes are passed straight
   through to Spring, so there is no `hasMore` to read and no
   second page to ask for.

   Scroll shape: module-scope keyExtractor, a memoized row, and
   item-first handlers through useEvent. FlashList's ViewHolder
   memo compares renderItem BY IDENTITY — an inline arrow there
   re-renders every mounted SwipeRow, gesture handlers and all.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { applySocialStatus } from '@/components/profile/useSocialStatus'
import { SwipeRow } from '@/components/chat/SwipeRow'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, EmptyState, ErrorState, GroupFooter, Header,
  Screen, SkeletonRow, Text, Touchable, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

const RestrictedRow = React.memo(function RestrictedRow({
  item, onPressUser, onUnrestrict,
}: { item: any; onPressUser: (id: string) => void; onUnrestrict: (user: any) => void }) {
  const t = useTheme()
  const trailing = React.useMemo(() => [{
    key: 'unrestrict',
    label: 'Unrestrict',
    icon: 'eye' as const,
    tint: t.colors.warning,
    onTrigger: () => onUnrestrict(item),
  }], [t.colors.warning, onUnrestrict, item])

  return (
    <SwipeRow resetKey={String(item.id)} trailing={trailing}>
      {/* Opaque: the swipe pane sits behind the row, not through it. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: t.layout.screenPadding,
          backgroundColor: t.colors.bg,
        }}
      >
        <Avatar
          uri={item.profileImage}
          name={item.full}
          seed={item.id}
          size="md"
          onPress={() => onPressUser(String(item.id))}
        />
        <Touchable
          onPress={() => onPressUser(String(item.id))}
          feedback="dim"
          noAutoHitSlop
          style={{ flex: 1 }}
        >
          <Text variant="bodyStrong" align="ui" numberOfLines={1}>{item.full}</Text>
          <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{item.handle}</Text>
        </Touchable>
        <Button label="Unrestrict" variant="secondary" size="sm" onPress={() => onUnrestrict(item)} />
      </View>
    </SwipeRow>
  )
})

export default function RestrictedScreen() {
  const t = useTheme()
  const router = useRouter()

  const list = useAsync<any[]>(() => api.users.restricted({ page: 0, size: 100 }), { deps: [] })

  const first = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (first.current) { first.current = false; return }
    void list.refresh()
  }, [list.refresh]))   // eslint-disable-line react-hooks/exhaustive-deps

  const unrestrict = useEvent(async (user: any) => {
    const previous = list.data ?? []
    const index = previous.findIndex(u => String(u.id) === String(user.id))
    list.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
    try {
      const res: any = await api.users.unrestrict(user.id)
      applySocialStatus(String(user.id), res?.updatedStatus ?? { isRestricting: false })
      toast.ok(`Unrestricted @${user.handle}`, {
        label: 'Undo',
        onPress: () => void restore(user, index),
      })
    } catch (e) {
      /* 404 = the edge was already gone (undone elsewhere) — the removal IS the
         correct end state, so don't resurrect the row over it. */
      if (isNotFound(e)) { applySocialStatus(String(user.id), { isRestricting: false }); return }
      list.setData(prev => insertAt(prev ?? [], user, index))
      toast.error(errorText(e, 'Could not unrestrict that account.'))
    }
  })

  const restore = async (user: any, index: number) => {
    list.setData(prev => insertAt(prev ?? [], user, index))
    try {
      const res: any = await api.users.restrict(user.id)
      applySocialStatus(String(user.id), res?.updatedStatus ?? { isRestricting: true })
    } catch (e) {
      list.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
      toast.error(errorText(e, 'Could not restrict them again.'))
    }
  }

  const rows = list.data ?? []

  const onPressUser = useEvent((id: string) => router.push(`/user/${id}`))
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => (
      <RestrictedRow item={item} onPressUser={onPressUser} onUnrestrict={unrestrict} />
    ),
    [onPressUser, unrestrict],
  )

  return (
    <Screen>
      <Header back title="Restricted accounts" />

      {list.loading ? (
        <View>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)}</View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          ListHeaderComponent={
            rows.length ? (
              <View style={{ padding: t.layout.screenPadding, paddingBottom: space.xs }}>
                <Callout tone="neutral" icon="eyeOff">
                  Restricting is quiet. Their direct messages land in your requests
                  folder instead of your inbox, and they are never told.
                </Callout>
              </View>
            ) : null
          }
          ListFooterComponent={
            rows.length ? (
              <GroupFooter>
                Right now restriction applies to direct messages. Comments from a
                restricted account are not held back yet — block them if that is
                what you need.
              </GroupFooter>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="eyeOff"
              title="No restricted accounts"
              message="Restricting someone moves their direct messages into your requests folder without telling them. You can do it from any profile."
            />
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}

function insertAt(rows: any[], user: any, index: number) {
  const without = rows.filter(u => String(u.id) !== String(user.id))
  const at = index < 0 ? without.length : Math.min(index, without.length)
  return [...without.slice(0, at), user, ...without.slice(at)]
}
