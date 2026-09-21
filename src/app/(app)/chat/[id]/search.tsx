/* =========================================================
   Search in conversation.

   `#tag` is a different endpoint, not a different query:
   `messages.byTag` is an EXACT keyword lookup on the indexed
   tags field, so `#ml` and `#machinelearning` are unrelated.
   Routing a leading `#` to search instead would quietly return
   fuzzy matches for something the user asked for exactly.

   A failure never renders as an empty list. An empty list from
   a 500 reads as "no matches", which is a lie the user cannot
   detect.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf } from '@/api'
import { useChatActions } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ChipRail, EmptyState, Header, Screen, SearchField, Text, toast, useSheetState,
} from '@/ui'
import { SearchHitRow } from '@/components/chat/SearchHitRow'
import { ChatErrorState } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

const keyExtractor = (item: any) => String(item.id)

/* By reference, so the footer ViewHolder is not rebuilt on every keystroke. */
function RankNote() {
  return (
    <Text variant="caption" tone="faint" align="center" style={styles.footnote}>
      Results are ranked by relevance, not date.
    </Text>
  )
}

export default function ConversationSearchScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, q: initialQuery } = useLocalSearchParams<{ id: string; q?: string }>()
  const convId = String(id)

  const { getConvo } = useChatActions()
  const convo = getConvo(convId)
  const dir = useUserDirectory()
  const menu = useSheetState<any>()

  const [query, setQuery] = React.useState(initialQuery ?? '')
  const [hits, setHits] = React.useState<any[]>([])
  const [searching, setSearching] = React.useState(false)
  const [settled, setSettled] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  /* Session-local: a per-thread history is not worth a storage key, and it is
     genuinely useful only within one visit. */
  const [recents, setRecents] = React.useState<string[]>([])

  const ctl = React.useRef<AbortController | null>(null)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; ctl.current?.abort() }
  }, [])

  const tagMode = query.trim().startsWith('#')

  React.useEffect(() => {
    const raw = query.trim()
    if (!raw || raw === '#') { ctl.current?.abort(); setHits([]); setSettled(false); setError(null); return }

    const timer = setTimeout(() => {
      ctl.current?.abort()
      const next = new AbortController()
      ctl.current = next
      setSearching(true)
      setError(null)

      const run = raw.startsWith('#')
        ? api.chat.messages.byTag(convId, raw.slice(1))
        : api.chat.messages.search(convId, raw, 30, { signal: next.signal } as any)

      run
        .then((rows: any) => {
          if (!alive.current || next.signal.aborted) return
          setHits(rows || [])
          setSettled(true)
        })
        .catch((e: any) => {
          if (e?.name === 'AbortError' || !alive.current) return
          if (codeOf(e) === 'NOT_A_MEMBER') { toast.warn('You are not a member of this conversation.'); router.back(); return }
          setError(e)
        })
        .finally(() => { if (alive.current && !next.signal.aborted) setSearching(false) })
    }, 250)

    return () => clearTimeout(timer)
  }, [query, convId, router])

  React.useEffect(() => { dir.watchUsers(hits.map(h => h.senderId)) }, [hits, dir])

  const remember = useEvent((raw: string) => {
    const clean = raw.trim()
    if (!clean) return
    setRecents(prev => [clean, ...prev.filter(x => x !== clean)].slice(0, 8))
  })

  /* Item-first and identity-stable, so renderItem below keeps its identity —
     FlashList compares it by reference and re-invokes every mounted cell when
     it moves, which on a search screen is every keystroke. */
  const openHit = useEvent((message: any) => {
    remember(query)
    router.replace(`/chat/${convId}?jump=${message.id}`)
  })
  const openMenu = useEvent((message: any) => menu.open(message))

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <SearchHitRow
      message={item}
      query={tagMode ? '' : query}
      card={dir.userOf(item.senderId)}
      onPress={() => openHit(item)}
      onLongPress={() => openMenu(item)}
    />
  ), [tagMode, query, dir, openHit, openMenu])

  return (
    <Screen>
      <Header
        back
        titleNode={
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={`Search in ${convo?.displayTitle ?? 'this chat'}`}
            autoFocus
            onSubmit={() => remember(query)}
            onCancel={() => router.back()}
          />
        }
      />

      {searching ? <View style={[styles.progress, { backgroundColor: c.accent }]} /> : null}

      {(recents.length || tagMode) && !error ? (
        <ChipRail style={styles.chips}>
          {tagMode ? <Chip label={`Tag: ${query.trim()}`} tone="accent" icon="hash" /> : null}
          {recents.map(r => <Chip key={r} label={r} onPress={() => setQuery(r)} />)}
        </ChipRail>
      ) : null}

      {error ? (
        <ChatErrorState error={error} title="Search is unavailable right now" onRetry={() => setQuery(q => `${q} `.trim())} />
      ) : !query.trim() ? (
        <View style={styles.idle}>
          <Text variant="footnote" tone="muted" align="center">Search messages in this conversation.</Text>
        </View>
      ) : (
        <FlashList
          data={hits}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            settled && !searching ? (
              <EmptyState
                icon="search"
                title={`No messages found for “${query.trim()}”`}
                message="System messages and empty media captions are never indexed."
                compact
              />
            ) : null
          }
          ListFooterComponent={hits.length ? RankNote : null}
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          {
            label: 'Jump to message',
            icon: 'forward',
            onPress: () => { if (menu.payload) router.replace(`/chat/${convId}?jump=${menu.payload.id}`) },
          },
          {
            label: 'Copy',
            icon: 'copy',
            hidden: !menu.payload?.body,
            onPress: async () => {
              await Clipboard.setStringAsync(String(menu.payload?.body ?? ''))
              toast.ok('Copied')
            },
          },
          {
            label: 'Star',
            icon: 'star',
            onPress: () => {
              if (!menu.payload) return
              api.chat.messages.star(menu.payload.id)
                .then(() => toast.ok('Starred'))
                .catch(e => toast.warn(chatError(e, 'Could not star this message')))
            },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  progress: { height: 2, opacity: 0.7 },
  chips: { maxHeight: 52, paddingVertical: space.sm2 },
  idle: { padding: space.xxxl },
  footnote: { paddingHorizontal: space.xxxl, paddingVertical: space.lg2 },
})
