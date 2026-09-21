/* =========================================================
   Close friends.

   One list, used by two different endpoint families — the
   story-visibility one and `/close-friends` itself. This
   screen owns the second: the roster.

   The list is a set of *ids*, not user cards
   (`[{ ownerId, friendId, addedAt }]`), so identity has to be
   hydrated here. Each lookup fails open: a deleted account
   drops its row rather than breaking the screen, which is the
   same rule `settings.mutedUsers()` applies for the same
   reason.

   Removing is silent by design. Nobody is told they were added
   to a close-friends list and nobody is told they were taken
   off it, so the confirmation says so — a user who thinks this
   sends a notification will not use the feature.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, Chip, EmptyState, ErrorState, Header, Screen,
  SkeletonRow, Text, Touchable, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

/* Scalars and a memo: tapping Remove flips `removing`, and an inline row would
   re-render every visible avatar on the way to spinning one button. */
const CloseFriendRow = React.memo(function CloseFriendRow({
  id, displayName, handle, avatarUrl, loading, onOpen, onRemove,
}: {
  id: string
  displayName: string
  handle: string
  avatarUrl?: string | null
  loading: boolean
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: t.layout.screenPadding }}>
      <Avatar
        uri={avatarUrl}
        name={displayName}
        seed={id}
        size="md"
        ring="close"
        onPress={() => onOpen(id)}
      />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" align="ui" numberOfLines={1}>{displayName}</Text>
        <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{handle}</Text>
      </View>
      <Button
        label="Remove"
        variant="secondary"
        size="sm"
        loading={loading}
        onPress={() => onRemove(id)}
      />
    </View>
  )
})

export default function CloseFriendsScreen() {
  const t = useTheme()
  const router = useRouter()
  const [removing, setRemoving] = React.useState<string | null>(null)

  const list = useAsync<any[]>(async () => {
    const rows: any[] = (await api.closeCircle.list()) || []
    const ids = rows.map(r => String(r?.friendId ?? r?.id ?? '')).filter(Boolean)
    /* The roster is ids only. Hydrate in parallel and fail open per row. */
    const users = await Promise.all(
      ids.map(id => api.users.get(id).catch(() => null)),
    )
    return users.filter(Boolean)
  }, { deps: [] })

  /* Id-first and identity-stable, so the row memo survives a `removing` flip.
     The handle for the toast is looked up here rather than passed down — the
     row deals in scalars and this closure already has the roster. */
  const remove = useEvent(async (id: string) => {
    const user = (list.data ?? []).find(u => String(u.id) === id)
    if (!user) return
    setRemoving(id)
    const previous = list.data
    list.setData(prev => (prev ?? []).filter(u => String(u.id) !== id))
    try {
      await api.closeCircle.remove(id)
      toast.ok(`@${user.handle || user.handle} removed`)
    } catch (e) {
      list.setData(previous ?? null)
      toast.error(errorText(e, 'Could not update your close friends.'))
    } finally {
      setRemoving(null)
    }
  })

  const onRemove = useEvent((id: string) => { void remove(id) })
  const onOpen = useEvent((id: string) => router.push(`/user/${id}`))

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <CloseFriendRow
      id={String(item.id)}
      displayName={item.displayName || item.username}
      handle={item.handle || item.username}
      avatarUrl={item.avatarUrl}
      loading={removing === String(item.id)}
      onOpen={onOpen}
      onRemove={onRemove}
    />
  ), [removing, onOpen, onRemove])

  return (
    <Screen>
      <Header
        back
        title="Close friends"
        actions={[{ icon: 'personAdd', onPress: () => router.push('/close-friends/add'), label: 'Add people' }]}
      />

      {list.loading ? (
        <View>{Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)}</View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={list.data ?? []}
          keyExtractor={keyExtractor}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          ListHeaderComponent={
            (list.data?.length ?? 0) > 0 ? (
              <View style={{ padding: t.layout.screenPadding, paddingBottom: space.xs }}>
                <Callout tone="success" icon="star">
                  Stories you post to close friends are visible only to these people.
                  Nobody is told they are on the list, or that they were removed.
                </Callout>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="star"
              title="No close friends yet"
              message="Add people here, then choose “Close friends” when you post a story to share it with just them."
              actionLabel="Add people"
              onAction={() => router.push('/close-friends/add')}
            />
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}
