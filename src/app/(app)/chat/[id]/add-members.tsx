/* =========================================================
   Add members.

   `members.add` validates each id INDEPENDENTLY and silently
   skips the ones it refuses — blocked accounts, people already
   here. That is why the snackbar says "Adding {n} people…"
   rather than "Added": the truth arrives as member.changed
   frames a moment later, and claiming a number the server may
   not honour is worse than saying less.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, errorText } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, EmptyState, Header, Screen, SearchField, Text, toast,
} from '@/ui'
import {
  PersonRow, PickerSectionLabel, SelectionChips, usePeopleSearch,
} from '@/components/chat/PeoplePicker'

const MAX_PER_REQUEST = 100

const keyExtractor = (item: any) => String(item.id)

export default function AddMembersScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const roster = useAsync<any>(() => api.chat.members.list(convId, { page: 0, size: 256 }), { deps: [convId] })
  const search = usePeopleSearch({})

  const [picked, setPicked] = React.useState<any[]>([])
  const [adding, setAdding] = React.useState(false)
  const [denied, setDenied] = React.useState<string | null>(null)

  const existing = React.useMemo(
    () => new Set((roster.data?.items || []).map((m: any) => String(m.userId))),
    [roster.data],
  )
  const pickedIds = React.useMemo(() => new Set(picked.map(p => String(p.id))), [picked])
  const full = picked.length >= MAX_PER_REQUEST

  const people = search.active ? search.results : search.suggestions

  /* Item-first and identity-stable, so renderPerson survives a re-render —
     FlashList compares renderItem by identity and re-invokes every mounted
     cell when it moves. */
  const toggle = useEvent((person: any) => {
    const id = String(person.id)
    setPicked(prev => (
      prev.some(p => String(p.id) === id) ? prev.filter(p => String(p.id) !== id) : [...prev, person]
    ))
  })

  const renderPerson = React.useCallback(({ item }: { item: any }) => {
    const already = existing.has(String(item.id))
    const selected = pickedIds.has(String(item.id))
    return (
      <PersonRow
        user={item}
        checkbox
        selected={selected}
        disabled={already || (!selected && full) || !!denied}
        disabledNote={already ? 'Already in group' : (!selected && full ? 'Limit reached' : undefined)}
        onPress={() => toggle(item)}
      />
    )
  }, [existing, pickedIds, full, denied, toggle])

  const submit = async () => {
    if (!picked.length || adding) return
    setAdding(true)
    try {
      await api.chat.members.add(convId, picked.slice(0, MAX_PER_REQUEST).map(p => p.id))
      toast.ok(`Adding ${picked.length} ${picked.length === 1 ? 'person' : 'people'}…`)
      router.back()
    } catch (e: any) {
      if (codeOf(e) === 'ADMINS_ONLY') setDenied(errorText(e, 'You cannot add members to this group.'))
      else toast.error(chatError(e, 'Could not add these members'))
      setAdding(false)
    }
  }

  return (
    <Screen>
      <Header
        title="Add members"
        closeButton
        back={() => { if (!adding) router.back() }}
        below={
          <View style={styles.head}>
            <SelectionChips users={picked} onRemove={pid => setPicked(prev => prev.filter(p => String(p.id) !== pid))} />
            <View style={styles.field}>
              <SearchField value={search.query} onChangeText={search.setQuery} placeholder="Search people" autoFocus />
            </View>
          </View>
        }
      />

      {denied ? <View style={styles.callout}><Callout tone="danger">{denied}</Callout></View> : null}

      <FlashList
        data={people}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={renderPerson}
        ListHeaderComponent={<PickerSectionLabel>{search.active ? 'Results' : 'Suggested'}</PickerSectionLabel>}
        ListEmptyComponent={
          search.active && !search.searching
            ? <EmptyState icon="search" title={`No people found for “${search.query.trim()}”`} compact />
            : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
      />

      <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.flex}>
          <Text variant="footnote" tone="muted" align="ui">{picked.length}/{MAX_PER_REQUEST} selected</Text>
          <Text variant="caption" tone="faint" align="ui">
            People you can’t add — blocked accounts, or people already here — are skipped silently.
          </Text>
        </View>
        <Button
          label={`Add${picked.length ? ` (${picked.length})` : ''}`}
          onPress={submit}
          loading={adding}
          disabled={!picked.length || adding || !!denied || roster.loading}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  head: { paddingBottom: space.sm },
  field: { paddingHorizontal: space.lg },
  callout: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
})
