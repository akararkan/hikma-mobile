/* =========================================================
   Muted accounts.

   Muting is one-directional and silent. The explainer names all
   three consequences people routinely get wrong: the other
   person is never told, they keep following you, and direct
   messages still arrive.

   `GET /settings/privacy/muted` answers with bare UUIDs.
   `api.settings.mutedUsers()` hydrates them and DROPS ids that
   no longer resolve, so the rendered count can be lower than
   the stored one — that is a deleted account, not a bug.

   Scroll shape: module-scope keyExtractor, a memoized row, and
   item-first handlers through useEvent. FlashList's ViewHolder
   memo compares renderItem BY IDENTITY — an inline arrow there
   re-renders every mounted SwipeRow, gesture handlers and all.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { SwipeRow } from '@/components/chat/SwipeRow'
import { useAsync, useDebounced, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, EmptyState, ErrorState, Header, Icon, Screen,
  SearchField, Sheet, SkeletonRow, Text, Touchable, useSheetState, toast,
} from '@/ui'

const keyExtractor = (u: any) => String(u.id)

const MutedRow = React.memo(function MutedRow({
  item, onPressUser, onUnmute,
}: { item: any; onPressUser: (id: string) => void; onUnmute: (user: any) => void }) {
  const t = useTheme()
  /* The swipe action array is rebuilt per row render, but the row only
     re-renders when its own scalars move now — and SwipeRow needs the tint
     from the theme anyway. */
  const trailing = React.useMemo(() => [{
    key: 'unmute',
    label: 'Unmute',
    icon: 'speaker' as const,
    tint: t.colors.warning,
    onTrigger: () => onUnmute(item),
  }], [t.colors.warning, onUnmute, item])

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
        <Button label="Unmute" variant="secondary" size="sm" onPress={() => onUnmute(item)} />
      </View>
    </SwipeRow>
  )
})

export default function MutedScreen() {
  const t = useTheme()
  const router = useRouter()
  const picker = useSheetState()

  const list = useAsync<any[]>(() => api.settings.mutedUsers(), { deps: [] })

  /* Someone can be muted from a post's overflow menu while this screen is in
     the stack, so the list re-reads whenever it comes back into view. */
  const first = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (first.current) { first.current = false; return }
    void list.refresh()
  }, [list.refresh]))   // eslint-disable-line react-hooks/exhaustive-deps

  const unmute = useEvent(async (user: any) => {
    const previous = list.data ?? []
    const index = previous.findIndex(u => String(u.id) === String(user.id))
    list.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
    try {
      await api.settings.privacy.muted.unmute(user.id)
      toast.ok(`Unmuted @${user.handle}`, {
        label: 'Undo',
        onPress: () => void remute(user, index),
      })
    } catch (e) {
      /* Back where it was, not on the end — a list that reorders itself on a
         failed write reads as a second, unrelated change. */
      list.setData(prev => insertAt(prev ?? [], user, index))
      toast.error(errorText(e, 'Could not unmute that account.'))
    }
  })

  const remute = async (user: any, index: number) => {
    list.setData(prev => insertAt(prev ?? [], user, index))
    try { await api.settings.privacy.muted.mute(user.id) }
    catch (e) {
      list.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
      toast.error(errorText(e, 'Could not mute them again.'))
    }
  }

  const mute = async (user: any) => {
    picker.close()
    if ((list.data ?? []).some(u => String(u.id) === String(user.id))) return
    list.setData(prev => [user, ...(prev ?? [])])
    try { await api.settings.privacy.muted.mute(user.id) }
    catch (e) {
      list.setData(prev => (prev ?? []).filter(u => String(u.id) !== String(user.id)))
      toast.error(errorText(e, 'Could not mute that account.'))
    }
  }

  const rows = list.data ?? []

  const onPressUser = useEvent((id: string) => router.push(`/user/${id}`))
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <MutedRow item={item} onPressUser={onPressUser} onUnmute={unmute} />,
    [onPressUser, unmute],
  )

  return (
    <Screen>
      <Header
        back
        title="Muted accounts"
        actions={[{ icon: 'add', onPress: picker.open, label: 'Mute someone' }]}
      />

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
                <Callout tone="neutral" icon="mutedBell">
                  Muting is silent and one-way. Their posts stop appearing in your
                  feed, they are never told, and their messages still reach you.
                </Callout>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="mutedBell"
              title="No muted accounts"
              message="Muting is silent and one-way. Their posts stop appearing in your feed, they are never told, and their messages still reach you."
              actionLabel="Mute someone"
              onAction={picker.open}
            />
          }
          renderItem={renderItem}
        />
      )}

      <UserPickerSheet
        visible={picker.visible}
        onClose={picker.close}
        title="Mute someone"
        excludeIds={rows.map((u: any) => String(u.id))}
        onPick={mute}
      />
    </Screen>
  )
}

function insertAt(rows: any[], user: any, index: number) {
  const without = rows.filter(u => String(u.id) !== String(user.id))
  const at = index < 0 ? without.length : Math.min(index, without.length)
  return [...without.slice(0, at), user, ...without.slice(at)]
}

/* ---------------------------------------------------------
   The people picker. `api.users.search` is the only people
   endpoint that pages and it is transactionally fresh, so a
   just-followed account is findable immediately. Every
   keystroke aborts the previous request through the signal —
   without it the answer to "a" can land after the answer to
   "ah" and overwrite it.
   --------------------------------------------------------- */

function UserPickerSheet({
  visible, onClose, title, excludeIds, onPick,
}: {
  visible: boolean
  onClose: () => void
  title: string
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
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightRatio={0.86}>
      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md, paddingBottom: space.sm }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search people" autoFocus />
      </View>

      {results.loading ? (
        <View>{Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} lines={1} />)}</View>
      ) : results.error ? (
        /* Never an empty-results claim on a failed search — "nobody by that
           name" and "the request failed" are different answers. */
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
