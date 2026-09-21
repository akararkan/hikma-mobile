/* =========================================================
   Forward to…

   Permission is evaluated per TARGET, not per message, with one
   exception: `PROTECTED_CONTENT` comes from the SOURCE channel,
   so it fails every target at once and the sheet says it once
   rather than eleven times.

   Forwards run SEQUENTIALLY. The send limit is 30 per 10s and a
   ten-target fan-out fired in parallel is the fastest way to
   turn a successful forward into a 429 halfway through, with no
   way to tell the user which half landed.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatInbox } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
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

/* Module scope, and `getItemType` so the three shapes keep three recycle
   pools — a section label handing its React key to a 56pt conversation row
   means a full unmount/remount at every section boundary. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

export default function ForwardScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { conversations } = useChatInbox()
  /* A conversation's `peer` is { userId, username, fullName } on the wire
     (conversations.md) — there is no avatar on it, which is why every DM row
     here drew initials. The chat list has always resolved the face through the
     directory; this screen now does the same. */
  const dir = useUserDirectory()
  React.useEffect(() => {
    const peers = conversations
      .filter((x: any) => !x.isGroup && x.peer?.id)
      .map((x: any) => String(x.peer.id))
    if (peers.length) dir.watchUsers(peers)
  }, [conversations, dir])
  const params = useLocalSearchParams<{ messageId?: string; messageIds?: string }>()

  const messageIds = React.useMemo(() => {
    const raw = params.messageIds || params.messageId || ''
    return String(raw).split(',').map(s => s.trim()).filter(Boolean)
  }, [params.messageId, params.messageIds])

  const exclude = React.useMemo(() => new Set([String(user?.id ?? '')]), [user?.id])
  const search = usePeopleSearch({ excludeIds: exclude, withSuggestions: false })

  const [selected, setSelected] = React.useState<Target[]>([])
  const [note, setNote] = React.useState('')
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = React.useState<string[]>([])
  const [cooldown, startCooldown] = useCooldown()

  const q = search.query.trim().toLowerCase()
  const chats = React.useMemo(
    () => (q ? conversations.filter(x => String(x.displayTitle || '').toLowerCase().includes(q)) : conversations),
    [conversations, q],
  )

  /* A Set of the picked ids, so a row asks a scalar question instead of
     scanning the array — and so renderItem's dependency is one identity that
     only moves when the selection actually changes. */
  const pickedIds = React.useMemo(() => new Set(selected.map(s => s.id)), [selected])

  /* Identity-stable and target-first: one function for every row. */
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
    if (!selected.length || !messageIds.length || progress) return
    setFailures([])
    const total = selected.length * messageIds.length
    let done = 0
    setProgress({ done, total })

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

        for (const messageId of messageIds) {
          await api.chat.messages.forward(messageId, convId, api.chat.newNonce())
          done += 1
          setProgress({ done, total })
        }

        if (note.trim()) {
          /* The note is a SEPARATE message, sent after the forwards land, so
             the forwarded card keeps its own provenance. */
          await api.chat.messages.send(convId, {
            clientNonce: api.chat.newNonce(), type: 'TEXT', body: note.trim(),
          } as any)
        }
        ok += 1
        lastConvId = convId
      } catch (e: any) {
        const code = codeOf(e)
        if (code === 'PROTECTED_CONTENT') {
          /* The SOURCE refuses, so every target will fail identically. Stop
             and say it once. */
          setProgress(null)
          setFailures([errorText(e, 'This channel’s content is protected and cannot be forwarded.')])
          return
        }
        if (isNotFound(e)) {
          setProgress(null)
          toast.warn('That message is no longer available.')
          router.back()
          return
        }
        if (startCooldown(e)) {
          setProgress(null)
          setFailures([chatError(e, 'Forwarding is rate limited')])
          return
        }
        failed.push(`${target.label}: ${chatError(e, 'Could not forward')}`)
      }
    }

    setProgress(null)
    if (failed.length) { setFailures(failed); return }

    toast.ok(`Forwarded to ${ok} ${ok === 1 ? 'chat' : 'chats'}`,
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

  return (
    <Screen>
      <Header
        title="Forward to…"
        closeButton
        back={() => { if (!busy) router.back() }}
        below={
          <View style={styles.field}>
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
            You can forward to {MAX_TARGETS} chats at a time.
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
            disabled={!selected.length || busy || cooldown > 0}
            loading={busy}
          />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
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
