/* =========================================================
   Search all messages.

   Two things about this endpoint shape the screen:

   1. It is Elasticsearch-only with NO scan fallback, and it
      answers `[]` when ES is down. A genuine "no matches" and a
      degraded index are therefore indistinguishable, so the
      empty state says so instead of asserting there is nothing.
   2. Results are ranked by RELEVANCE, not date, and are
      floor-filtered per conversation. Grouping by conversation
      is what makes that legible — an undifferentiated list
      ranked by relevance reads as random ordering.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useChatActions } from '@/context/ChatContext'
import { storage } from '@/platform/storage'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Chip, ChipRail, EmptyState, Header, Icon, Screen, SearchField, Text, Touchable,
} from '@/ui'
import { SearchHitRow } from '@/components/chat/SearchHitRow'
import { ChatErrorState } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

const RECENTS_KEY = 'ika_chat_recent_queries'
const MAX_RECENTS = 8
const HITS_PER_GROUP = 3

type Row =
  | { kind: 'group'; key: string; convId: string }
  | { kind: 'hit'; key: string; message: any }

/* Module scope. `getItemType` is what keeps the two shapes in separate recycle
   pools: a group header and a hit row have nothing structurally in common, and
   sharing one pool means React tears down and rebuilds the subtree at every
   boundary instead of swapping props. Grouping by conversation means a
   boundary every three rows here. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

function readRecents(): string[] {
  try {
    const raw = storage.getItem(RECENTS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.slice(0, MAX_RECENTS) : []
  } catch { return [] }
}

export default function SearchAllScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  /* getConvo reads the live refs, so each call answers current data without
     this screen subscribing to inbox churn; headers re-render with the hits. */
  const { getConvo } = useChatActions()
  const dir = useUserDirectory()

  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<any[]>([])
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [settled, setSettled] = React.useState(false)
  const [recents, setRecents] = React.useState<string[]>(readRecents)
  /* Conversations the inbox has not cached — headers need a title and an
     avatar, and the hit rows carry neither. */
  const [convos, setConvos] = React.useState<Record<string, any>>({})

  const ctl = React.useRef<AbortController | null>(null)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; ctl.current?.abort() }
  }, [])

  React.useEffect(() => {
    const q = query.trim()
    if (!q) { ctl.current?.abort(); setHits([]); setSettled(false); setError(null); setSearching(false); return }

    const id = setTimeout(() => {
      ctl.current?.abort()
      const next = new AbortController()
      ctl.current = next
      setSearching(true)
      setError(null)
      api.chat.searchAll(q, 30, { signal: next.signal })
        .then((rows: any) => {
          if (!alive.current || next.signal.aborted) return
          setHits(rows || [])
          setSettled(true)
        })
        .catch(e => {
          /* An abort is our own doing, never a rendered failure. */
          if (e?.name !== 'AbortError' && alive.current) setError(e)
        })
        .finally(() => { if (alive.current && !next.signal.aborted) setSearching(false) })
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  React.useEffect(() => { dir.watchUsers(hits.map(h => h.senderId)) }, [hits, dir])

  /* The PEERS too, not just the senders. A conversation's `peer` carries no
     avatar on the wire (conversations.md), so a DM row draws its face from the
     directory — and an id nobody watches never resolves, leaving the row on
     its initials forever. */
  React.useEffect(() => {
    const peers = Object.values(convos)
      .filter((x: any) => x && !x.isGroup && x.peer?.id)
      .map((x: any) => String(x.peer.id))
    if (peers.length) dir.watchUsers(peers)
  }, [convos, dir])

  /* Every id this screen has ever asked the server about. It is never cleared,
     not even on failure: a 403/404 conversation is permanently unreadable, and
     a retry-on-every-render would hammer the endpoint for the whole session.
     This is also why `convos` and `dir` are NOT dependencies below — `dir`
     changes identity on every resolving user card (the watchUsers call above is
     what causes those), and `convos` is what this effect writes, so listing
     either re-fired one GET per still-unresolved conversation while the user
     was mid-keystroke. */
  const wanted = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const id of new Set(hits.map(h => String(h.conversationId)))) {
      if (!id || wanted.current.has(id) || getConvo(id)) continue
      wanted.current.add(id)
      api.chat.conversations.get(id)
        .then((convo: any) => { if (convo && alive.current) setConvos(prev => ({ ...prev, [id]: convo })) })
        .catch(() => {})
    }
  }, [hits, getConvo])

  const remember = React.useCallback((q: string) => {
    const clean = q.trim()
    if (!clean) return
    setRecents(prev => {
      const next = [clean, ...prev.filter(x => x !== clean)].slice(0, MAX_RECENTS)
      try { storage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* a full disk costs history, not search */ }
      return next
    })
  }, [])

  const convoOf = React.useCallback((id: string) => getConvo(id) || convos[String(id)] || null, [getConvo, convos])

  const rows = React.useMemo<Row[]>(() => {
    const groups = new Map<string, any[]>()
    for (const h of hits) {
      const key = String(h.conversationId)
      const bucket = groups.get(key)
      if (bucket) bucket.push(h)
      else groups.set(key, [h])
    }
    const out: Row[] = []
    for (const [convId, list] of groups) {
      out.push({ kind: 'group', key: `g-${convId}`, convId })
      for (const m of list.slice(0, HITS_PER_GROUP)) out.push({ kind: 'hit', key: String(m.id), message: m })
    }
    return out
  }, [hits])

  /* Identity-stable, item-first handlers: one function serves every row, so
     renderItem below survives a re-render and FlashList leaves the mounted
     cells alone. `useEvent` keeps them reading the live `query`. */
  const openHit = useEvent((message: any) => {
    remember(query)
    router.push(`/chat/${message.conversationId}?jump=${message.id}`)
  })

  const openGroup = useEvent((convId: string) => {
    remember(query)
    router.push(`/chat/${convId}/search?q=${encodeURIComponent(query.trim())}`)
  })

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'group') {
      const convo = convoOf(item.convId)
      return (
        <Touchable
          onPress={() => openGroup(item.convId)}
          feedback="tint"
          noAutoHitSlop
          style={[styles.groupHead, { backgroundColor: c.surfaceSunken }]}
        >
          <Avatar
            /* A conversation's `peer` is { userId, username, fullName } on the
               wire (conversations.md) — no avatar — so a DM's face comes from
               the user directory, exactly as the chat list gets it. */
            uri={convo?.isGroup ? convo?.avatarUrl : dir.userOf(convo?.peer?.id)?.profileImage ?? null}
            name={convo?.displayTitle || 'Conversation'}
            seed={item.convId}
            size={24}
            square={!!convo?.isGroup}
          />
          <Text variant="footnote" weight="700" numberOfLines={1} style={styles.flex}>
            {convo?.displayTitle || 'Conversation'}
          </Text>
          <Text variant="caption" tone="accent" align="ui">See all in chat</Text>
          <Icon name={t.isRTL ? 'back' : 'forward'} size={13} color={c.textFaint} />
        </Touchable>
      )
    }
    return (
      <SearchHitRow
        message={item.message}
        query={query}
        card={dir.userOf(item.message.senderId)}
        onPress={() => openHit(item.message)}
      />
    )
  }, [c.surfaceSunken, c.textFaint, t.isRTL, convoOf, dir, query, openGroup, openHit])

  return (
    <Screen>
      <Header
        titleNode={
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search all messages"
            autoFocus
            onSubmit={() => remember(query)}
            onCancel={() => router.back()}
          />
        }
        back
      />

      {searching ? <View style={[styles.progress, { backgroundColor: c.accent }]} /> : null}

      {recents.length && !query.trim() ? (
        <ChipRail style={styles.recents}>
          {recents.map(r => (
            <Chip
              key={r}
              label={r}
              onPress={() => setQuery(r)}
              onRemove={() => {
                setRecents(prev => {
                  const next = prev.filter(x => x !== r)
                  try { storage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
                  return next
                })
              }}
            />
          ))}
        </ChipRail>
      ) : null}

      {error ? (
        <ChatErrorState
          error={error}
          title="Search is unavailable right now"
          onRetry={() => setQuery(q => q + '')}
        />
      ) : !query.trim() ? (
        <View style={styles.idle}>
          <Text variant="footnote" tone="muted" align="center">Search across all your chats.</Text>
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            settled && !searching ? (
              <View>
                <EmptyState
                  icon="search"
                  title={`No messages found for “${query.trim()}”`}
                  message="Try fewer words — search is typo-tolerant but matches on message text only."
                  compact
                />
                {/* This endpoint answers [] when the index is down, so an empty
                    result cannot promise there is nothing to find. */}
                <Text variant="caption" tone="faint" align="center" style={styles.degraded}>
                  If you expected results, try again in a moment.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            rows.length ? (
              <Text variant="caption" tone="faint" align="center" style={styles.footnote}>
                Ranked by relevance. System messages and media-only messages are not searchable.
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  progress: { height: 2, opacity: 0.7 },
  recents: { maxHeight: 52, paddingVertical: space.sm2 },
  idle: { padding: space.xxxl },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, height: 34 },
  flex: { flex: 1 },
  footnote: { paddingHorizontal: space.xxxl, paddingVertical: space.lg2 },
  degraded: { paddingHorizontal: space.xxxl, paddingBottom: space.xl },
})
