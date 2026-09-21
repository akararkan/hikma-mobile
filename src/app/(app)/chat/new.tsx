/* =========================================================
   New chat.

   `createDirect` is a get-or-create keyed on the unordered
   pair, so tapping a person you already have a thread with
   opens that thread rather than making a second one. That is
   why the row navigates with REPLACE: the modal is a detour,
   and Back from the conversation belongs to the inbox, not to
   a picker the user has finished with.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatActions } from '@/context/ChatContext'
import { usePresence } from '@/context/RealtimeContext'
import { chatError } from '@/lib/chatErrors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ConfirmSheet, EmptyState, Header, Icon, ListRow, Screen, SearchField, Text, toast, useSheetState,
} from '@/ui'
import {
  PersonRow, PickerSectionLabel, usePeopleSearch,
} from '@/components/chat/PeoplePicker'

/** `https://ika.app/join/AbC123` → `AbC123`. Anything else is a search term. */
function inviteTokenOf(text: string): string | null {
  const m = /(?:^|\/)join\/([A-Za-z0-9_-]{6,})/.exec(text.trim())
  return m ? m[1] : null
}

type Row =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'person'; key: string; user: any }

/* Module scope; `getItemType` keeps the section label out of the 64pt person
   row's recycle pool. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

/* PersonRow takes presence as a prop (the other pickers don't show it), so
   this list's row subscribes to its own user's key here. */
function LivePersonRow({ user, busy, onPress, onLongPress }: {
  user: any; busy?: boolean; onPress: () => void; onLongPress?: () => void
}) {
  const presence = usePresence(user.id)
  return <PersonRow user={user} busy={busy} presence={presence} onPress={onPress} onLongPress={onLongPress} />
}

export default function NewChatScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { trackPresence } = useChatActions()

  /* Self-DM is a 400. Filtering here means the user never taps into one. */
  const exclude = React.useMemo(() => new Set([String(user?.id ?? '')]), [user?.id])
  const search = usePeopleSearch({ excludeIds: exclude })

  const blockedSheet = useSheetState<string>()
  const [openingId, setOpeningId] = React.useState<string | null>(null)

  const token = inviteTokenOf(search.query)

  React.useEffect(() => {
    const ids = (search.active ? search.results : search.suggestions).map(u => u.id)
    trackPresence(ids)
  }, [search.active, search.results, search.suggestions, trackPresence])

  const rows = React.useMemo<Row[]>(() => {
    const people = search.active ? search.results : search.suggestions
    if (!people.length) return []
    return [
      { kind: 'section', key: 'sec', label: search.active ? 'Results' : 'Suggested' },
      ...people.map((u: any) => ({ kind: 'person' as const, key: String(u.id), user: u })),
    ]
  }, [search.active, search.results, search.suggestions])

  const openDirect = React.useCallback(async (person: any) => {
    setOpeningId(String(person.id))
    try {
      const convo: any = await api.chat.conversations.createDirect(person.id)
      if (!convo) throw new Error('No conversation')
      router.replace(`/chat/${convo.id}`)
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'BLOCKED') {
        /* The envelope deliberately never says who blocked whom, so the sheet
           shows the server's own sentence and offers nothing to retry. */
        blockedSheet.open(errorText(e, 'This interaction is not allowed.'))
      } else if (isNotFound(e)) {
        toast.warn('That account is no longer available.')
      } else {
        toast.error(chatError(e, 'Could not start this chat'))
      }
    } finally {
      setOpeningId(null)
    }
    /* `blockedSheet.open` is the stable piece; the wrapper object is rebuilt
       every render, and renderItem below closes over this. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, blockedSheet.open])

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'section') return <PickerSectionLabel>{item.label}</PickerSectionLabel>
    return (
      <LivePersonRow
        user={item.user}
        busy={openingId === String(item.user.id)}
        onPress={() => { void openDirect(item.user) }}
        onLongPress={() => router.push(`/u/${item.user.handle || item.user.id}`)}
      />
    )
  }, [openingId, openDirect, router])

  return (
    <Screen>
      <Header
        title="New chat"
        back={() => router.back()}
        closeButton
        below={
          <View style={styles.field}>
            <SearchField
              value={search.query}
              onChangeText={search.setQuery}
              placeholder="Search people"
              autoFocus
            />
            {search.searching ? <View style={[styles.progress, { backgroundColor: c.accent }]} /> : null}
          </View>
        }
      />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View>
            {token ? (
              <ListRow
                title="Join group with this link"
                subtitle={`Invite code …${token.slice(-6)}`}
                icon="link"
                iconTone="accent"
                accessory={{ kind: 'chevron' }}
                onPress={() => router.replace(`/chat/join/${token}`)}
              />
            ) : null}
            <ListRow
              title="New group"
              icon="people"
              iconTone="accent"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push('/chat/new-group')}
            />
            <ListRow
              title="Join with invite link"
              subtitle="Paste a link you were sent"
              icon="link"
              iconTone="accent"
              accessory={{ kind: 'chevron' }}
              onPress={() => toast.info('Paste the invite link into the search field above.')}
            />
          </View>
        }
        ListEmptyComponent={
          search.active && !search.searching ? (
            <EmptyState icon="search" title={`No people found for “${search.query.trim()}”`} compact />
          ) : null
        }
        ListFooterComponent={
          search.error ? (
            <View style={styles.note}>
              <Icon name="offline" size={14} color={c.textMuted} />
              <Text variant="footnote" tone="muted" align="ui">Search needs a connection.</Text>
            </View>
          ) : null
        }
      />

      <ConfirmSheet
        visible={blockedSheet.visible}
        onClose={blockedSheet.close}
        title="Can’t start this chat"
        message={blockedSheet.payload ?? undefined}
        confirmLabel="OK"
        cancelLabel="Close"
        onConfirm={blockedSheet.close}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  progress: { height: 2, borderRadius: 2, marginTop: space.sm, opacity: 0.6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, justifyContent: 'center', paddingVertical: space.lg },
})
