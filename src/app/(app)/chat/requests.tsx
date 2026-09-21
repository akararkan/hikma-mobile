/* =========================================================
   Message requests.

   A stranger gets three messages before the platform stops
   them, and those three sit here rather than in the inbox.
   Two behaviours are contract, not preference:

   · Decline is SILENT. The requester is never told, so nothing
     on this screen may imply a reply was sent.
   · Accepting turns receipts, typing and presence on for both
     sides, which is a real privacy change — the explainer says
     so before the button is tapped, not after.

   The row calls the endpoints directly with the REQUEST id —
   `requestId` and `conversationId` are distinct fields on
   MessageRequestResponse and must never double for each other.
   The badge is kept honest by re-seeding through loadRequests(),
   and an accept refreshes the inbox because accepting is what
   graduates the thread into GET /conversations.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, isNotFound } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { useChatActions } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, ConfirmSheet, EmptyState, Header, Icon, ListFooter, Screen,
  SegmentedControl, Text, toast, useSheetState,
} from '@/ui'
import { RequestRow } from '@/components/chat/RequestRow'
import { ChatErrorState, RequestSkeleton } from '@/components/chat/states'
import { useUserDirectory } from '@/components/chat/userDirectory'

type Tab = 'PENDING' | 'ACCEPTED' | 'DECLINED'

const TABS: { value: Tab; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DECLINED', label: 'Declined' },
]

const keyExtractor = (item: any) => String(item.id)

export default function RequestsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { loadRequests, refreshInbox, subscribe } = useChatActions()

  const dir = useUserDirectory()
  const overflow = useSheetState<any>()
  const confirmBlock = useSheetState<any>()
  const [tab, setTab] = React.useState<Tab>('PENDING')
  const [busyId, setBusyId] = React.useState<string | null>(null)

  /* One fetch per visible first message, cached by message id. The list can
     re-render forty times while scrolling; the snippet must not re-fetch. */
  const [snippets, setSnippets] = React.useState<Record<string, any>>({})
  const wanted = React.useRef(new Set<string>())

  const list = usePaged<any>(
    ({ page, pageSize }) => api.chat.requests.list({ status: tab, page: page ?? 0, size: pageSize }),
    { mode: 'page', pageSize: 20, deps: [tab] },
  )

  React.useEffect(() => {
    dir.watchUsers(list.items.map(r => r.requesterId))

    const missing = list.items
      .map(r => r.firstMessageId)
      .filter(id => id && !wanted.current.has(String(id)))
    if (!missing.length) return
    for (const id of missing) wanted.current.add(String(id))

    void Promise.all(missing.map(id =>
      api.chat.messages.get(id)
        .then((m: any) => { if (m) setSnippets(prev => ({ ...prev, [String(id)]: m })) })
        /* A deleted opening message is a normal state; the row simply has no
           preview rather than an error. */
        .catch(() => {}),
    ))
  }, [list.items, dir])

  /* `request.new` prepends without a refetch — the frame carries the row. */
  React.useEffect(() => subscribe(evt => {
    if (evt.type !== 'request.new' || !evt.request || tab !== 'PENDING') return
    list.prepend(evt.request)
  }), [subscribe, tab, list])

  const settle = React.useCallback(async (
    req: any,
    verb: 'accept' | 'decline' | 'block',
  ) => {
    setBusyId(String(req.id))
    list.remove(String(req.id))
    try {
      if (verb === 'accept') {
        await api.chat.requests.accept(req.id)
        /* Accepting graduates the thread into the main inbox
           (message-requests.md §accept) — refresh so it is already in the
           rail when the user goes back; receipts, typing and presence all
           resume the moment it lands. */
        void refreshInbox()
        toast.ok('Request accepted', req.conversationId
          ? { label: 'Open chat', onPress: () => router.push(`/chat/${req.conversationId}`) }
          : undefined)
      } else if (verb === 'decline') {
        await api.chat.requests.decline(req.id)
      } else {
        await api.chat.requests.block(req.id)
        toast.ok('Blocked')
      }
      await loadRequests()
    } catch (e) {
      /* A 404 means someone already handled it — the row is correctly gone, so
         say nothing. Anything else restores the row where it was. */
      if (!isNotFound(e)) {
        list.prepend(req)
        toast.error(chatError(e, 'Could not update this request'))
      }
    } finally {
      setBusyId(null)
    }
  }, [list, loadRequests, refreshInbox, router])

  const renderItem = React.useCallback(({ item }: { item: any }) => (
    <RequestRow
      request={item}
      card={dir.userOf(item.requesterId)}
      firstMessage={item.firstMessageId ? snippets[String(item.firstMessageId)] : null}
      busy={busyId === String(item.id)}
      showActions={tab === 'PENDING'}
      onPress={() => { if (item.conversationId) router.push(`/chat/${item.conversationId}`) }}
      onAccept={() => { void settle(item, 'accept') }}
      onDecline={() => { void settle(item, 'decline') }}
      onOverflow={() => overflow.open(item)}
    />
    /* `overflow.open`, not `overflow`: useSheetState rebuilds its wrapper
       object every render, and FlashList compares renderItem by identity —
       a churning one re-invokes every mounted cell. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [dir, snippets, busyId, tab, router, settle, overflow.open])

  return (
    <Screen>
      <Header
        back
        title="Requests"
        below={
          <View style={styles.tabs}>
            <SegmentedControl options={TABS} value={tab} onChange={setTab} />
          </View>
        }
      />

      {tab === 'PENDING' ? (
        <View style={[styles.explainer, { backgroundColor: c.warningSoft }]}>
          <Icon name="shield" size={19} color={c.warningText} />
          <Text variant="footnote" tone="warning" align="ui" style={styles.flex}>
            People you don’t follow can send you up to 3 messages. Accepting moves the chat to your
            inbox and turns on read receipts and typing for both of you.
          </Text>
        </View>
      ) : null}

      {list.loading ? (
        <RequestSkeleton />
      ) : list.error ? (
        <ChatErrorState error={list.error} title="Could not load message requests" onRetry={list.reload} />
      ) : (
        <FlashList
          data={list.items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={list.refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            tab === 'PENDING' ? (
              <EmptyState
                icon="mail"
                title="No message requests"
                message="Messages from people you don't follow will wait here."
              />
            ) : (
              <EmptyState icon="mail" title="Nothing here yet" />
            )
          }
          ListFooterComponent={
            list.items.length ? <ListFooter loading={list.loadingMore} done={list.done} doneLabel="" /> : null
          }
        />
      )}

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        title={overflow.payload?.requester?.handle ? `@${overflow.payload.requester.handle}` : undefined}
        actions={[
          {
            label: 'Block',
            icon: 'block',
            destructive: true,
            onPress: () => { if (overflow.payload) confirmBlock.open(overflow.payload) },
          },
          {
            label: 'Report',
            icon: 'flag',
            onPress: () => {
              const id = overflow.payload?.requesterId
              const handle = overflow.payload?.requester?.handle
              if (id) {
                router.push(reportHref({
                  targetType: 'USER',
                  targetId: String(id),
                  name: handle ? `@${handle}` : undefined,
                }))
              }
            },
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmBlock.visible}
        onClose={confirmBlock.close}
        title={`Block @${confirmBlock.payload?.requester?.handle ?? 'this account'}?`}
        message="They will not be able to message you, and this request will be declined. They are not told."
        confirmLabel="Block"
        destructive
        onConfirm={() => {
          const req = confirmBlock.payload
          confirmBlock.close()
          if (req) void settle(req, 'block')
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  /* Callout plate — setback, never a uniform radius. */
  explainer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, padding: space.md, margin: space.lg,
    ...setback(shape.buttonMd), borderCurve: 'continuous',
  },
  flex: { flex: 1 },
})
