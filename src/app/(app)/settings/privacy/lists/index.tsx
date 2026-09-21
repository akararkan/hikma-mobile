/* =========================================================
   Custom lists.

   These are the audiences the CUSTOM visibility level resolves
   against. Two facts drive the screen:

   1. Deleting a list does not reset the privacy rows that point
      at it. A field left on CUSTOM with no list resolves to
      NOBODY, so the confirmation says that rather than "this
      cannot be undone", which is true but useless.
   2. CLOSE_FRIENDS is a list of the same shape but it is not
      editable here — it is the one the stories surface owns. It
      renders locked so it cannot be renamed into a hole.

   Member counts come from one `members(id)` call per row, fired
   in parallel after the list lands. A count that fails to load
   leaves the subtitle without a number rather than claiming
   zero people. The row is handed the count as a SCALAR, never
   the counts map — a map prop would defeat the row's memo the
   moment any other row's count arrived.

   Scroll shape: module-scope keyExtractor + a memoized row +
   item-first handlers; FlashList compares renderItem by
   identity, so an inline arrow there re-renders every cell.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { SwipeRow } from '@/components/chat/SwipeRow'
import { useAction, useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, ConfirmSheet, EmptyState, ErrorState, Field, GroupFooter, Header, Icon,
  ListRow, RowGroup, Screen, Sheet, SkeletonRow, Text, useSheetState, toast,
} from '@/ui'

const keyExtractor = (r: any) => String(r.id)

const ListRowCard = React.memo(function ListRowCard({
  item, count, onOpen, onRemove,
}: {
  item: any
  count: number | undefined
  onOpen: (row: any) => void
  onRemove: (row: any) => void
}) {
  const t = useTheme()
  const locked = String(item.type) === 'CLOSE_FRIENDS'
  const trailing = React.useMemo(() => [{
    key: 'delete',
    label: 'Delete',
    icon: 'trash' as const,
    tint: t.colors.danger,
    onTrigger: () => onRemove(item),
  }], [t.colors.danger, onRemove, item])

  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}>
      <SwipeRow
        resetKey={String(item.id)}
        /* CLOSE_FRIENDS is not ours to delete — the stories domain
           owns that list, so its row carries no swipe action. */
        enabled={!locked}
        trailing={trailing}
      >
        <RowGroup inset={0}>
          <ListRow
            title={item.name || (locked ? 'Close friends' : 'Untitled list')}
            subtitle={[
              typeof count === 'number' ? `${count} ${count === 1 ? 'person' : 'people'}` : null,
              locked ? 'Managed in Close friends' : 'Custom',
            ].filter(Boolean).join(' · ')}
            icon={locked ? 'star' : 'people'}
            iconTone={locked ? 'scholar' : 'accent'}
            accessory={{ kind: 'chevron' }}
            onPress={() => onOpen(item)}
            onLongPress={locked ? undefined : () => onRemove(item)}
          />
        </RowGroup>
      </SwipeRow>
    </View>
  )
})

export default function ListsScreen() {
  const t = useTheme()
  const router = useRouter()
  const create = useSheetState()
  const remove = useSheetState<any>()

  const lists = useAsync<any[]>(() => api.settings.privacy.lists.all(), { deps: [] })
  const [counts, setCounts] = React.useState<Record<string, number>>({})
  const [name, setName] = React.useState('')
  const [nameError, setNameError] = React.useState<string | null>(null)

  const first = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (first.current) { first.current = false; return }
    void lists.refresh()
  }, [lists.refresh]))   // eslint-disable-line react-hooks/exhaustive-deps

  /* One fan-out per load. Failures are dropped: a missing count is a missing
     subtitle, never an error state over a list that loaded fine. */
  React.useEffect(() => {
    const rows = lists.data
    if (!rows?.length) return
    let alive = true
    void Promise.all(rows.map(async (row: any) => {
      try {
        const ids: string[] = await api.settings.privacy.lists.members(row.id)
        return [String(row.id), Array.isArray(ids) ? ids.length : 0] as const
      } catch { return null }
    })).then(pairs => {
      if (!alive) return
      setCounts(prev => {
        const next = { ...prev }
        for (const p of pairs) if (p) next[p[0]] = p[1]
        return next
      })
    })
    return () => { alive = false }
  }, [lists.data])

  const doCreate = useAction(async () => {
    const value = name.trim()
    if (!value) { setNameError('Give the list a name.'); return }
    const row: any = await api.settings.privacy.lists.create(value)
    lists.setData(prev => (row ? [row, ...(prev ?? [])] : prev))
    setName('')
    setNameError(null)
    create.close()
    if (row?.id) router.push(`/settings/privacy/lists/${row.id}`)
  }, { onError: e => setNameError(errorText(e, 'Could not create that list.')) })

  const doRemove = async () => {
    const row = remove.payload
    remove.close()
    if (!row) return
    const previous = lists.data ?? []
    lists.setData(prev => (prev ?? []).filter(r => String(r.id) !== String(row.id)))
    try { await api.settings.privacy.lists.remove(row.id) }
    catch (e) {
      lists.setData(previous)
      toast.error(errorText(e, 'Could not delete that list.'))
    }
  }

  const rows = lists.data ?? []

  /* Close friends is the stories domain's own surface — the same shape
     server-side, a different owner in the app. */
  const onOpen = useEvent((row: any) => router.push(
    String(row.type) === 'CLOSE_FRIENDS'
      ? '/close-friends'
      : `/settings/privacy/lists/${row.id}?name=${encodeURIComponent(row.name || '')}`,
  ))
  const onRemove = useEvent((row: any) => remove.open(row))
  /* `counts` is the only moving dep — one fan-out per load, so this identity
     settles after the first paint. */
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => (
      <ListRowCard item={item} count={counts[String(item.id)]} onOpen={onOpen} onRemove={onRemove} />
    ),
    [counts, onOpen, onRemove],
  )

  return (
    <Screen background="sunken">
      <Header
        back
        title="Custom lists"
        actions={[{ icon: 'add', onPress: () => { setName(''); setNameError(null); create.open() }, label: 'New list' }]}
      />

      {lists.loading ? (
        <View>{Array.from({ length: 3 }, (_, i) => <SkeletonRow key={i} avatarSize={30} lines={2} />)}</View>
      ) : lists.error ? (
        <ErrorState error={lists.error} onRetry={lists.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          refreshing={lists.refreshing}
          onRefresh={lists.refresh}
          contentContainerStyle={{ paddingTop: space.md }}
          ListEmptyComponent={
            <EmptyState
              icon="people"
              title="No custom lists yet"
              message="A custom list lets you show a field or a post to a specific group. Create one, add people, then choose “Custom lists” on any privacy row."
              actionLabel="Create a list"
              onAction={() => { setName(''); setNameError(null); create.open() }}
            />
          }
          ListFooterComponent={
            rows.length ? (
              <GroupFooter>
                Deleting a list does not change the privacy rows that pointed at
                it. A field left on “Custom lists” with no list resolves to nobody.
              </GroupFooter>
            ) : null
          }
          renderItem={renderItem}
        />
      )}

      <Sheet
        visible={create.visible}
        onClose={create.close}
        title="New list"
        subtitle="Only you can see a list's name and members."
        maxHeightRatio={0.5}
        footer={
          <Button
            label="Create"
            variant="primary"
            size="lg"
            block
            loading={doCreate.pending}
            disabled={!name.trim()}
            onPress={() => void doCreate.run()}
          />
        }
      >
        <View style={{ padding: t.layout.screenPadding }}>
          <Field
            value={name}
            onChangeText={v => { setName(v); setNameError(null) }}
            label="List name"
            placeholder="Study group"
            error={nameError}
            maxLength={60}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => { if (name.trim()) void doCreate.run() }}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'flex-start' }}>
            <Icon name="info" size={15} color={t.colors.textFaint} style={{ marginTop: space.xxs }} />
            <Text variant="footnote" tone="muted" align="ui" style={{ flex: 1 }}>
              Add people on the next screen. An empty list shows a field to nobody.
            </Text>
          </View>
        </View>
      </Sheet>

      <ConfirmSheet
        visible={remove.visible}
        onClose={remove.close}
        title={`Delete “${remove.payload?.name || 'this list'}”?`}
        message="Its members are removed with it. Any privacy setting still pointing at a custom list will resolve to nobody until you pick a different audience."
        confirmLabel="Delete"
        destructive
        icon="trash"
        onConfirm={() => void doRemove()}
      />
    </Screen>
  )
}
