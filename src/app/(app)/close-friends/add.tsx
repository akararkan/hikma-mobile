/* =========================================================
   Add to close friends.

   The candidate pool is the people you follow — the backend
   has no "who can be a close friend" endpoint, and offering a
   global search here would let someone build a private list of
   strangers, which is not what the feature is for.

   `add` is idempotent (204 either way), so the row can toggle
   optimistically and a double-tap costs nothing. `isMember` is
   not used per row: it is one request per person, and the
   already-loaded roster answers the same question for free.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useDebounced } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { args } from '@/api/args'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, EmptyState, ErrorState, Header, ListFooter, Screen,
  SearchField, SkeletonRow, Text, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

/* Scalars, not the user object, and module scope: this screen re-renders on
   every keystroke in the search field, and a row fed the whole item would
   re-render the mounted window with it while the next page is still landing. */
const PersonToggleRow = React.memo(function PersonToggleRow({
  id, displayName, handle, avatarUrl, isMember, loading, onToggle,
}: {
  id: string
  displayName: string
  handle: string
  avatarUrl?: string | null
  isMember: boolean
  loading: boolean
  onToggle: (id: string) => void
}) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: t.layout.screenPadding }}>
      <Avatar
        uri={avatarUrl}
        name={displayName}
        seed={id}
        size="md"
        ring={isMember ? 'close' : 'none'}
      />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" align="ui" numberOfLines={1}>{displayName}</Text>
        <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{handle}</Text>
      </View>
      <Button
        label={isMember ? 'Added' : 'Add'}
        icon={isMember ? 'check' : undefined}
        variant={isMember ? 'tinted' : 'secondary'}
        size="sm"
        loading={loading}
        onPress={() => onToggle(id)}
      />
    </View>
  )
})

export default function AddCloseFriendsScreen() {
  const t = useTheme()
  const { user } = useAuth()
  const [query, setQuery] = React.useState('')
  const debounced = useDebounced(query, 280)
  const [members, setMembers] = React.useState<Set<string>>(() => new Set())
  const [busy, setBusy] = React.useState<string | null>(null)

  /* The roster, so every row knows its own state without a request. */
  const roster = useAsync<string[]>(async () => {
    const rows: any[] = (await api.closeCircle.list()) || []
    return rows.map(r => String(r?.friendId ?? r?.id ?? '')).filter(Boolean)
  }, {
    deps: [],
    onSuccess: (ids: string[]) => setMembers(new Set(ids)),
  })

  const following = usePaged<any>(
    ({ page, pageSize, signal }) => api.users.following(user?.id, args({ page, size: pageSize, signal })),
    { mode: 'page', pageSize: 30, enabled: !!user?.id, deps: [user?.id] },
  )

  const shown = React.useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return following.items
    return following.items.filter((u: any) =>
      String(u.displayName || '').toLowerCase().includes(q)
      || String(u.username || '').toLowerCase().includes(q)
      || String(u.handle || '').toLowerCase().includes(q))
  }, [following.items, debounced])

  /* useEvent so the row memo holds: this closes over `members`, which moves on
     every toggle, and a fresh identity here would repaint the whole viewport. */
  const toggle = useEvent(async (rawId: string) => {
    const id = String(rawId)
    const isMember = members.has(id)
    setBusy(id)
    setMembers(prev => {
      const next = new Set(prev)
      if (isMember) next.delete(id); else next.add(id)
      return next
    })
    try {
      await (isMember ? api.closeCircle.remove(id) : api.closeCircle.add(id))
    } catch (e) {
      setMembers(prev => {
        const next = new Set(prev)
        if (isMember) next.add(id); else next.delete(id)
        return next
      })
      toast.error(errorText(e, 'Could not update your close friends.'))
    } finally {
      setBusy(null)
    }
  })

  const onToggle = useEvent((id: string) => { void toggle(id) })

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <PersonToggleRow
      id={String(item.id)}
      displayName={item.displayName || item.username}
      handle={item.handle || item.username}
      avatarUrl={item.avatarUrl}
      isMember={members.has(String(item.id))}
      loading={busy === String(item.id)}
      onToggle={onToggle}
    />
  ), [members, busy, onToggle])

  return (
    <Screen>
      <Header back title="Add close friends" />

      <View style={{ padding: t.layout.screenPadding, paddingBottom: space.xs2 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search people you follow" />
      </View>

      {following.loading || roster.loading ? (
        <View>{Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} />)}</View>
      ) : following.error && !following.items.length ? (
        <ErrorState error={following.error} onRetry={following.reload} />
      ) : (
        <FlashList
          data={shown}
          keyExtractor={keyExtractor}
          onEndReached={debounced ? undefined : following.loadMore}
          onEndReachedThreshold={0.6}
          refreshing={following.refreshing}
          onRefresh={following.refresh}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            debounced ? (
              <EmptyState icon="search" title="Nobody matches that" compact />
            ) : (
              <EmptyState
                icon="people"
                title="You're not following anyone yet"
                message="Close friends are chosen from the people you follow."
              />
            )
          }
          ListFooterComponent={
            !debounced && shown.length
              ? <ListFooter loading={following.loadingMore} done={following.done} doneLabel="" />
              : null
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}
