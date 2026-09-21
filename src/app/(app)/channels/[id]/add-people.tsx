/* =========================================================
   Add subscribers directly (join-source ADDED_BY_ADMIN).

   The server caps a single request at 100 user ids, so the
   selection is sliced and the batches run sequentially. A
   partial success is reported as one — "Added 7 of 12" — with
   the failures still selected, because silently dropping five
   people is the failure mode this screen exists to avoid.

   Unlike the member rows elsewhere in the domain, these are real
   UserResponses and DO carry an avatar.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Button, Chip, EmptyState, ErrorState, Header, Icon, Screen, SearchField,
  SkeletonList, Text, Touchable, TouchableRow, VerifiedMark, fireHaptic, toast,
} from '@/ui'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const BATCH = 100

/* Module scope: FlashList compares keyExtractor by identity. */
const keyExtractor = (u: any) => String(u.id)

export default function AddPeopleScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [q, setQ] = React.useState('')
  const [committed, setCommitted] = React.useState('')
  const [selected, setSelected] = React.useState<any[]>([])
  const [busy, setBusy] = React.useState(false)
  const tokenRail = React.useRef<ScrollView>(null)

  React.useEffect(() => {
    const t2 = setTimeout(() => setCommitted(q.trim()), 300)
    return () => clearTimeout(t2)
  }, [q])

  const rights = useChannelRights(id)
  const results = useAsync<any>(
    signal => api.users.search(committed, args({ page: 0, size: 20, signal })),
    { enabled: committed.length > 0, deps: [committed] },
  )
  const existing = useAsync<any>(
    () => api.chat.members.list(id, { page: 0, size: 100 }),
    { enabled: !!id, deps: [id] },
  )

  const memberIds = React.useMemo(
    () => new Set((existing.data?.items || []).map((m: any) => m.userId)),
    [existing.data],
  )

  /* Identity-stable so `renderItem` below does not change on every keystroke
     of the search field. */
  const toggle = useEvent((u: any) => {
    fireHaptic('select')
    setSelected(prev => {
      const next = prev.some(x => x.id === u.id) ? prev.filter(x => x.id !== u.id) : [...prev, u]
      if (next.length > prev.length) setTimeout(() => tokenRail.current?.scrollToEnd({ animated: true }), 40)
      return next
    })
  })
  const openProfile = useEvent((u: any) => router.push(chRoute.user(u.id)))

  /* One Set, built once per selection change — indexing it per row beats
     `selected.some(...)` inside the row body. */
  const selectedIds = React.useMemo(() => new Set(selected.map(u => String(u.id))), [selected])

  const submit = async () => {
    if (!selected.length) return
    setBusy(true)
    const ids = selected.map(u => u.id)
    let added = 0
    const failed: any[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH)
      try { await api.chat.members.add(id, slice); added += slice.length }
      catch (e: any) {
        failed.push(...selected.slice(i, i + BATCH))
        toast.error(errorText(e))
        break
      }
    }
    setBusy(false)
    if (failed.length) { setSelected(failed); toast.warn(`Added ${added} of ${ids.length}`); return }
    router.back()
    toast.ok(added === 1 ? 'Added 1 subscriber' : `Added ${added} subscribers`)
  }

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <PersonRow
      user={item}
      already={memberIds.has(item.id)}
      selected={selectedIds.has(String(item.id))}
      onToggle={toggle}
      onLongPress={openProfile}
    />
  ), [memberIds, selectedIds, toggle, openProfile])

  if (!rights.loading && rights.channel && !rights.can('canInviteUsers')) {
    return (
      <Screen background="sunken">
        <Header closeButton title="Add subscribers" />
        <RefusalCard title="You can’t add subscribers to this channel" onAction={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        closeButton
        title="Add subscribers"
        subtitle={rights.channel?.title}
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2, gap: space.sm2 }}>
            <SearchField value={q} onChangeText={setQ} placeholder="Search people" autoFocus />
            {selected.length ? (
              <ScrollView
                ref={tokenRail}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.sm, paddingVertical: space.xxs }}
              >
                {selected.map(u => (
                  <View key={u.id} style={[styles.token, { backgroundColor: c.accentSoft }]}>
                    <Avatar uri={u.avatarUrl} name={u.displayName || u.fname} seed={u.id} size={22} />
                    <Text variant="caption" tone="accent" numberOfLines={1}>{u.fname || u.displayName || u.handle}</Text>
                    <Touchable onPress={() => toggle(u)} feedback="dim" accessibilityLabel="Remove">
                      <Icon name="close" size={12} color={c.accentText} />
                    </Touchable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
      />

      {!committed ? (
        <EmptyState icon="search" title="Search for people to add" message="They’ll be added immediately and can leave any time." />
      ) : results.loading ? (
        <SkeletonList count={5} />
      ) : results.error ? (
        <ErrorState error={results.error} onRetry={results.reload} />
      ) : (
        <FlashList
          data={results.data?.items || []}
          keyExtractor={keyExtractor}
          extraData={selected.length}
          renderItem={renderItem}
          ListEmptyComponent={<EmptyState compact icon="search" title={`No one matches “${committed}”`} />}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
        />
      )}

      <View
        style={{
          paddingHorizontal: t.layout.screenPadding,
          paddingTop: space.sm2,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.separator,
          backgroundColor: c.bg,
          gap: space.sm,
        }}
      >
        <Text variant="footnote" tone="muted" align="ui">
          {selected.length >= BATCH
            ? 'Add at most 100 people per request.'
            : 'They’ll be added immediately and can leave any time.'}
        </Text>
        <Button
          label={selected.length ? `Add ${selected.length}` : 'Add'}
          onPress={submit}
          disabled={!selected.length}
          loading={busy}
          size="lg"
          block
        />
      </View>
    </Screen>
  )
}

/* ---------------------------------------------------------
   One searchable person.

   Memoized on scalars (`already`, `selected`) rather than on the
   selection array, so typing in the search field repaints only
   the rows whose state actually moved.
   --------------------------------------------------------- */

const PersonRow = React.memo(function PersonRow({
  user, already, selected, onToggle, onLongPress,
}: {
  user: any
  already: boolean
  selected: boolean
  onToggle: (u: any) => void
  onLongPress: (u: any) => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onToggle(user), [onToggle, user])
  const longPress = React.useCallback(() => onLongPress(user), [onLongPress, user])

  return (
    <TouchableRow onPress={already ? undefined : press} onLongPress={longPress}>
      <View style={[styles.row, { paddingHorizontal: t.layout.screenPadding, opacity: already ? 0.4 : 1 }]}>
        <Avatar uri={user.profileImage} name={user.displayName} seed={user.id} size={40} />
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{user.displayName || user.handle}</Text>
            {user.verified ? <VerifiedMark size={13} /> : null}
          </View>
          <Text variant="subhead" tone="muted" numberOfLines={1} align="ui">@{user.handle}</Text>
        </View>
        {already ? (
          <Chip label="Already in" tone="neutral" size="sm" />
        ) : (
          <View
            style={[
              styles.check,
              { borderColor: c.borderStrong, borderWidth: selected ? 0 : 1.5, backgroundColor: selected ? c.accent : 'transparent' },
            ]}
          >
            {selected ? <Icon name="check" size={14} color={c.textOnAccent} /> : null}
          </View>
        )}
      </View>
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm2, minHeight: 60 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  /* A selection token carries a name — chip setback, not a pill. */
  token: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.sm,
    height: 32,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
