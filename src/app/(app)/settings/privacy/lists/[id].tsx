/* =========================================================
   List members.

   `members(id)` returns bare UUIDs, so every row is one
   `users.get(id)` away. Those are fanned out in parallel and
   failures are DROPPED rather than surfaced: an id that no
   longer resolves is a deleted account, and the visible count
   being lower than the stored one is the correct outcome, not
   a bug to paper over.

   403 NOT_LIST_OWNER and 404 PRIVACYLIST_NOT_FOUND both mean
   "this list isn't yours to see" — the 404 family rule applies,
   so they render as a quiet card with no retry rather than an
   error with a button that will fail identically.

   Scroll shape: module-scope keyExtractor, a memoized row, and
   item-first handlers through useEvent. FlashList's ViewHolder
   memo compares renderItem BY IDENTITY — an inline arrow there
   re-renders every mounted SwipeRow, gesture handlers and all.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { SwipeRow } from '@/components/chat/SwipeRow'
import { useAsync, useDebounced, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, EmptyState, ErrorState, Header, Icon, Screen, SearchField,
  Sheet, SkeletonRow, Text, Touchable, useSheetState, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

const MemberRow = React.memo(function MemberRow({
  item, onPressUser, onDrop,
}: { item: any; onPressUser: (id: string) => void; onDrop: (user: any) => void }) {
  const t = useTheme()
  const trailing = React.useMemo(() => [{
    key: 'remove',
    label: 'Remove',
    icon: 'personRemove' as const,
    tint: t.colors.danger,
    onTrigger: () => onDrop(item),
  }], [t.colors.danger, onDrop, item])

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
        <Button label="Remove" variant="ghost" size="sm" onPress={() => onDrop(item)} />
      </View>
    </SwipeRow>
  )
})

export default function ListMembersScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const picker = useSheetState()

  /* The list's own row is only needed for the title, and the create screen
     usually passes it through — so it is a fallback read, not a blocking one. */
  const meta = useAsync<any[]>(() => api.settings.privacy.lists.all(), { enabled: !!id && !name, deps: [id] })
  const title = name || (meta.data ?? []).find((r: any) => String(r.id) === String(id))?.name || 'List'

  const members = useAsync<any[]>(async () => {
    const ids: string[] = (await api.settings.privacy.lists.members(id)) || []
    const users = await Promise.all(ids.map(uid => api.users.get(uid).catch(() => null)))
    return users.filter(Boolean) as any[]
  }, { enabled: !!id, deps: [id] })

  const add = async (user: any) => {
    picker.close()
    if ((members.data ?? []).some(u => String(u.id) === String(user.id))) return
    members.setData(prev => [user, ...(prev ?? [])])
    try { await api.settings.privacy.lists.addMember(id, user.id) }
    catch (e) {
      members.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
      toast.error(errorText(e, 'Could not add them to the list.'))
    }
  }

  const drop = useEvent(async (user: any) => {
    const previous = members.data ?? []
    const index = previous.findIndex(u => String(u.id) === String(user.id))
    members.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
    try {
      await api.settings.privacy.lists.removeMember(id, user.id)
      toast.ok(`Removed @${user.handle}`, { label: 'Undo', onPress: () => void restore(user, index) })
    } catch (e) {
      members.setData(prev => insertAt(prev ?? [], user, index))
      toast.error(errorText(e, 'Could not remove them.'))
    }
  })

  const restore = async (user: any, index: number) => {
    members.setData(prev => insertAt(prev ?? [], user, index))
    try { await api.settings.privacy.lists.addMember(id, user.id) }
    catch (e) {
      members.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
      toast.error(errorText(e, 'Could not put them back.'))
    }
  }

  const rows = members.data ?? []

  /* Above the `gone` guard: a refetch that 404s after first paint would
     otherwise render two fewer hooks than the paint before it. */
  const onPressUser = useEvent((uid: string) => router.push(`/user/${uid}`))
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <MemberRow item={item} onPressUser={onPressUser} onDrop={drop} />,
    [onPressUser, drop],
  )

  /* Not yours, or gone. The server answers both the same way on purpose. */
  const gone = members.error && (isNotFound(members.error) || codeOf(members.error) === 'NOT_LIST_OWNER')
  if (gone) {
    return (
      <Screen>
        <Header back title={title} />
        <EmptyState
          icon="lock"
          title="This list is no longer available"
          message="It may have been deleted, or it belongs to another account."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        title={title}
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : undefined}
        actions={[{ icon: 'personAdd', onPress: picker.open, label: 'Add people' }]}
      />

      {members.loading ? (
        <View>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} />)}</View>
      ) : members.error ? (
        <ErrorState error={members.error} onRetry={members.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          refreshing={members.refreshing}
          onRefresh={members.refresh}
          ListEmptyComponent={
            <EmptyState
              icon="people"
              title="No one in this list yet"
              message="A privacy setting pointing at an empty list shows that field to nobody."
              actionLabel="Add people"
              onAction={picker.open}
            />
          }
          renderItem={renderItem}
        />
      )}

      <MemberPickerSheet
        visible={picker.visible}
        onClose={picker.close}
        excludeIds={rows.map((u: any) => String(u.id))}
        onPick={add}
      />
    </Screen>
  )
}

function insertAt(rows: any[], user: any, index: number) {
  const without = rows.filter(u => String(u.id) !== String(user.id))
  const at = index < 0 ? without.length : Math.min(index, without.length)
  return [...without.slice(0, at), user, ...without.slice(at)]
}

/* A blank query lists every active user, which is what makes this usable as a
   browser rather than only a search box. The abort signal is not optional:
   without it the answer to "a" can land after the answer to "ah". */
function MemberPickerSheet({
  visible, onClose, excludeIds, onPick,
}: {
  visible: boolean
  onClose: () => void
  excludeIds: string[]
  onPick: (user: any) => void
}) {
  const t = useTheme()
  const [q, setQ] = React.useState('')
  const debounced = useDebounced(q, 250)

  const results = useAsync<any>(
    /* `as any`: users.js is plain JS and TS infers the options type from the
       destructuring defaults, which drops `signal`. */
    signal => api.users.search(debounced.trim(), { page: 0, size: 20, signal } as any),
    { enabled: visible, deps: [debounced, visible] },
  )

  React.useEffect(() => { if (!visible) setQ('') }, [visible])

  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds])
  const items: any[] = results.data?.items ?? []

  return (
    <Sheet visible={visible} onClose={onClose} title="Add people" maxHeightRatio={0.86}>
      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md, paddingBottom: space.sm }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search people" autoFocus />
      </View>

      {results.loading ? (
        <View>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} lines={1} />)}</View>
      ) : results.error ? (
        <View style={{ padding: t.layout.screenPadding, alignItems: 'center', gap: space.sm2 }}>
          <Text variant="footnote" tone="muted" align="center">{errorText(results.error)}</Text>
          <Button label="Try again" variant="tinted" size="sm" onPress={results.reload} />
        </View>
      ) : !items.length ? (
        <EmptyState icon="search" title="No matches" compact />
      ) : (
        <View>
          {items.map((u: any) => {
            const already = excluded.has(String(u.id))
            return (
              <Touchable
                key={String(u.id)}
                onPress={() => { if (!already) onPick(u) }}
                disabled={already}
                feedback="tint"
                noAutoHitSlop
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: t.layout.screenPadding,
                  paddingVertical: space.sm2,
                }}
              >
                <Avatar uri={u.profileImage} name={u.full} seed={u.id} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" align="ui" numberOfLines={1}>{u.full}</Text>
                  <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{u.handle}</Text>
                </View>
                <Icon
                  name={already ? 'check' : 'addCircle'}
                  size={22}
                  color={already ? t.colors.textFaint : t.colors.accent}
                />
              </Touchable>
            )
          })}
        </View>
      )}
    </Sheet>
  )
}
