/* =========================================================
   Send to… — share content into chats.

   The backend has no share message type, so a share IS a TEXT
   message carrying the entity's own short link (lib/shareLinks
   is the grammar; the bubble unfurls it into a card). This
   screen is the recipient picker every "Send in a message"
   tile lands on.

   Two rules inherited from the forward sheet:

   · Sends run SEQUENTIALLY — the limit is 30 per 10s and a
     ten-target fan-out fired in parallel turns success into a
     429 halfway through with no way to say which half landed.
   · recordShare fires ONCE, only after at least one send
     landed, and only for the kinds that have a ledger (post /
     research / question). A share that never reached anyone
     must not bump the author's counter — and ten recipients
     are still one share.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatInbox } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { shareMessageBody, shareSnippet, type ShareKind } from '@/lib/shareLinks'
import { useCooldown } from '@/hooks/useCooldown'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Chip, Field, Header, Icon, Screen, SearchField, Text, Touchable, toast,
} from '@/ui'
import { PersonRow, PickerSectionLabel, usePeopleSearch } from '@/components/chat/PeoplePicker'
import { useUserDirectory } from '@/components/chat/userDirectory'

const MAX_TARGETS = 10

type Target = { id: string; label: string; convId?: string; userId?: string; avatar?: string | null; isGroup?: boolean }

type Row =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'convo'; key: string; convo: any }
  | { kind: 'person'; key: string; user: any }

/* Module scope + getItemType, so the three row shapes keep three recycle
   pools — same reasoning as forward.tsx. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

/** The ledger write for kinds that have one — a no-op for the rest. */
function recordShareFor(kind: ShareKind | undefined, recordId: string, caption?: string) {
  switch (kind) {
    case 'post': return api.posts.recordShare(recordId, caption || undefined)
    case 'research': return api.research.recordShare(recordId)
    case 'question': return api.qna.recordShare(recordId)
    default: return Promise.resolve(null)
  }
}

export default function ShareToChatScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { conversations } = useChatInbox()
  /* Same face-resolution the chat list uses: a conversation's `peer` carries
     no avatar on the wire, so DM rows resolve it through the directory. */
  const dir = useUserDirectory()
  React.useEffect(() => {
    const peers = conversations
      .filter((x: any) => !x.isGroup && x.peer?.id)
      .map((x: any) => String(x.peer.id))
    if (peers.length) dir.watchUsers(peers)
  }, [conversations, dir])

  const params = useLocalSearchParams<{
    url?: string; kind?: string; label?: string; caption?: string; recordId?: string
  }>()
  const url = String(params.url || '')
  const kind = (params.kind || undefined) as ShareKind | undefined
  const what = String(params.label || '').trim()

  const exclude = React.useMemo(() => new Set([String(user?.id ?? '')]), [user?.id])
  const search = usePeopleSearch({ excludeIds: exclude, withSuggestions: false })

  const [selected, setSelected] = React.useState<Target[]>([])
  const [note, setNote] = React.useState(() => String(params.caption || ''))
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = React.useState<string[]>([])
  const [cooldown, startCooldown] = useCooldown()

  const q = search.query.trim().toLowerCase()
  const chats = React.useMemo(
    () => (q ? conversations.filter(x => String(x.displayTitle || '').toLowerCase().includes(q)) : conversations),
    [conversations, q],
  )

  const pickedIds = React.useMemo(() => new Set(selected.map(s => s.id)), [selected])

  const toggle = useEvent((target: Target) => {
    setSelected(prev => {
      if (prev.some(s => s.id === target.id)) return prev.filter(s => s.id !== target.id)
      if (prev.length >= MAX_TARGETS) return prev
      return [...prev, target]
    })
  })

  const openConvo = useEvent((convId: string) => router.replace(`/chat/${convId}`))

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    if (chats.length) {
      out.push({ kind: 'section', key: 'sec-chats', label: 'Chats' })
      out.push(...chats.map((x: any) => ({ kind: 'convo' as const, key: `c-${x.id}`, convo: x })))
    }
    if (search.active && search.results.length) {
      out.push({ kind: 'section', key: 'sec-people', label: 'People' })
      out.push(...search.results.map((u: any) => ({ kind: 'person' as const, key: `u-${u.id}`, user: u })))
    }
    return out
  }, [chats, search.active, search.results])

  const send = async () => {
    if (!selected.length || !url || progress) return
    setFailures([])
    const total = selected.length
    let done = 0
    setProgress({ done, total })

    const body = shareMessageBody(url, note)
    const failed: string[] = []
    let ok = 0
    let lastConvId: string | null = null

    for (const target of selected) {
      let convId = target.convId ?? null
      try {
        if (!convId && target.userId) {
          const convo: any = await api.chat.conversations.createDirect(target.userId)
          convId = convo?.id ?? null
        }
        if (!convId) throw new Error('No conversation')

        await api.chat.messages.send(convId, {
          clientNonce: api.chat.newNonce(), type: 'TEXT', body,
        } as any)
        done += 1
        setProgress({ done, total })
        ok += 1
        lastConvId = convId
      } catch (e: any) {
        /* A DM request thread refusing its 4th pre-acceptance message and a
           read-only group both land here as ordinary per-target failures —
           the send codes are per TARGET, so nothing but the rate limit fails
           the whole run. */
        if (startCooldown(e)) {
          setProgress(null)
          setFailures([chatError(e, 'Sending is rate limited')])
          if (ok && params.recordId) void recordShareFor(kind, String(params.recordId), note.trim()).catch(() => {})
          return
        }
        failed.push(`${target.label}: ${chatError(e, 'Could not send')}`)
      }
    }

    setProgress(null)

    /* One ledger row per completed share action, not per recipient — and none
       at all if every send failed. Best-effort: the messages are already
       delivered, so a ledger hiccup must not read as a failed share. */
    if (ok && params.recordId) {
      void recordShareFor(kind, String(params.recordId), note.trim()).catch(() => {})
    }

    if (failed.length) { setFailures(failed); return }

    toast.ok(`Sent to ${ok} ${ok === 1 ? 'chat' : 'chats'}`,
      ok === 1 && lastConvId ? { label: 'Open', onPress: () => router.replace(`/chat/${lastConvId}`) } : undefined)
    router.back()
  }

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'section') return <PickerSectionLabel>{item.label}</PickerSectionLabel>

    if (item.kind === 'convo') {
      const x = item.convo
      const id = `c-${x.id}`
      const picked = pickedIds.has(id)
      return (
        <Touchable
          onPress={() => toggle({ id, label: x.displayTitle, convId: String(x.id), avatar: x.avatarUrl, isGroup: x.isGroup })}
          onLongPress={() => openConvo(String(x.id))}
          feedback="tint"
          noAutoHitSlop
          style={styles.convoRow}
        >
          <Avatar
            uri={x.isGroup ? x.avatarUrl : dir.userOf(x.peer?.id)?.profileImage ?? null}
            name={x.displayTitle}
            seed={x.isGroup ? x.id : x.peer?.id}
            size={40}
            square={!!x.isGroup}
          />
          <View style={styles.flex}>
            <Text variant="subhead" weight="600" numberOfLines={1}>{x.displayTitle}</Text>
            <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
              {x.isGroup ? `${x.memberCount} members` : x.peer?.handle ? `@${x.peer.handle}` : ''}
            </Text>
          </View>
          <Icon name={picked ? 'checkCircle' : 'addCircle'} size={22} color={picked ? c.accent : c.textFaint} filled={picked} />
        </Touchable>
      )
    }

    const u = item.user
    const id = `u-${u.id}`
    return (
      <PersonRow
        user={u}
        checkbox
        selected={pickedIds.has(id)}
        onPress={() => toggle({ id, label: u.full || u.username, userId: String(u.id), avatar: u.profileImage })}
      />
    )
  }, [pickedIds, c.accent, c.textFaint, toggle, openConvo])

  const busy = !!progress
  const capped = selected.length >= MAX_TARGETS
  const summary = kind ? shareSnippet(kind).replace(/^Shared/, 'Sharing') : 'Sharing a link'

  return (
    <Screen>
      <Header
        title="Send to…"
        closeButton
        back={() => { if (!busy) router.back() }}
        below={
          <View style={styles.field}>
            {/* What's about to travel, before anyone is picked — the sheet
                should never feel like it lost the thing being shared. */}
            <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
              {what ? `${summary} · ${what}` : summary}
            </Text>
            <SearchField value={search.query} onChangeText={search.setQuery} placeholder="Search chats and people" />
          </View>
        }
      />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 220 }}
        ListEmptyComponent={
          search.active ? (
            <Text variant="footnote" tone="muted" align="center" style={styles.empty}>No chats or people found</Text>
          ) : null
        }
      />

      <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: insets.bottom + 10 }]}>
        {failures.length ? (
          <View style={styles.failures}>
            {failures.map((f, i) => (
              <Text key={i} variant="footnote" tone="danger" align="ui">{f}</Text>
            ))}
          </View>
        ) : null}

        {selected.length ? (
          <View style={styles.chips}>
            {selected.map(s => (
              <Chip key={s.id} label={s.label} size="sm" tone="accent" onRemove={() => toggle(s)} />
            ))}
          </View>
        ) : null}

        {capped ? (
          <Text variant="caption" tone="muted" align="ui">
            You can send to {MAX_TARGETS} chats at a time.
          </Text>
        ) : null}

        <View style={styles.sendRow}>
          <Field
            value={note}
            onChangeText={setNote}
            placeholder="Add a message"
            containerStyle={styles.flex}
            editable={!busy}
          />
          <Button
            label={
              progress ? `Sending ${progress.done}/${progress.total}`
                : cooldown > 0 ? `Wait ${cooldown}s`
                  : `Send${selected.length ? ` (${selected.length})` : ''}`
            }
            onPress={send}
            disabled={!selected.length || busy || cooldown > 0 || !url}
            loading={busy}
          />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: space.lg, paddingBottom: space.sm2, gap: space.sm },
  convoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56 },
  flex: { flex: 1 },
  empty: { padding: space.xxxl },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.md, paddingTop: space.sm2, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2 },
  failures: { gap: space.xs },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
})
