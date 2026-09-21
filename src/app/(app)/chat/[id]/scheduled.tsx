/* =========================================================
   Scheduled messages.

   The queue is mine and PENDING-only: once a row fires it
   leaves the list and the message appears in the thread through
   `message.new`, so "it disappeared" is the success state.

   Permission is re-checked at FIRE time. A message queued
   before you were removed or blocked lands FAILED rather than
   being delivered, and the intro says so — otherwise a
   scheduled message reads as a promise the app cannot keep.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, isNotFound } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ConfirmSheet, EmptyState, Header, NumericText, Screen, Text,
  Touchable, toast, useSheetState,
} from '@/ui'
import { clockTime, longDayLabel, snippetOf, weekdayShort } from '@/components/chat/format'
import { ChatErrorState, MessageCardSkeleton } from '@/components/chat/states'

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; row: any }

/* Module scope; `getItemType` keeps the day headers out of the card's recycle
   pool — a header handing its key to a 104pt card remounts the whole card. */
const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

/* By reference, so the header ViewHolder is not rebuilt on every render. */
function Intro() {
  return (
    <Text variant="footnote" tone="muted" align="ui" style={styles.intro}>
      These send automatically. Permission is checked again at send time — if you’re removed or
      blocked before then, the message fails instead of being delivered.
    </Text>
  )
}

export default function ScheduledScreen() {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const list = useAsync<any[]>(() => api.chat.scheduled.list(convId), { deps: [convId] })
  const menu = useSheetState<any>()
  const confirmCancel = useSheetState<any>()

  useFocusEffect(React.useCallback(() => { void list.reload() }, [convId]))   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    let lastDay = ''
    for (const r of list.data || []) {
      const label = longDayLabel(r.scheduledAt)
      if (label !== lastDay) { lastDay = label; out.push({ kind: 'header', key: `h-${label}`, label }) }
      out.push({ kind: 'item', key: String(r.id), row: r })
    }
    return out
  }, [list.data])

  const cancel = React.useCallback(async (row: any) => {
    list.setData(prev => (prev ?? []).filter(r => String(r.id) !== String(row.id)))
    try { await api.chat.scheduled.cancel(row.id) }
    catch (e) {
      /* A 404 means it already fired or was already cancelled — the row is
         correctly gone, so say nothing. */
      if (!isNotFound(e)) {
        void list.reload()
        toast.error(chatError(e, 'Could not cancel this message'))
      }
    }
  }, [list])

  const sendNow = React.useCallback(async (row: any) => {
    list.setData(prev => (prev ?? []).filter(r => String(r.id) !== String(row.id)))
    try {
      await api.chat.scheduled.cancel(row.id)
      /* A FRESH nonce: the queued one is spent, and reusing it would make the
         server treat this as a duplicate of a message it never delivered.
         The queued media rides along as MediaRef keys (messages.md §2.1) —
         the storage keys were uploaded when the message was scheduled, so a
         send-now must carry them or the attachments are silently dropped. */
      await api.chat.messages.send(convId, {
        clientNonce: api.chat.newNonce(),
        type: row.type || 'TEXT',
        body: row.body,
        replyToId: row.replyToId ?? undefined,
        media: row.media?.length
          ? row.media.map((m: any) => ({
            kind: m.kind,
            storageKey: m.storageKey,
            thumbnailKey: m.thumbnailKey ?? undefined,
            mime: m.mime || undefined,
            bytes: m.bytes || undefined,
            width: m.width ?? undefined,
            height: m.height ?? undefined,
            durationMs: m.durationMs ?? undefined,
            waveform: m.waveform || undefined,
            fileName: m.fileName || undefined,
            altText: m.altText || undefined,
          }))
          : undefined,
      } as any)
      toast.ok('Sent')
    } catch (e) {
      void list.reload()
      toast.error(chatError(e, 'Could not send this message'))
    }
  }, [convId, list])

  const renderRow = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      return (
        <View style={styles.header}>
          {/* `micro` uppercases Latin inside the primitive; a call-site
              transform would also shout at Arabic and Kurdish weekdays. */}
          <Text variant="micro" tone="muted" align="ui">{item.label}</Text>
        </View>
      )
    }
    const r = item.row
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint }]}>
        <View style={styles.when}>
          <Text variant="micro" tone="muted" align="center">{weekdayShort(r.scheduledAt)}</Text>
          <NumericText variant="subhead" weight="700" align="center">{clockTime(r.scheduledAt)}</NumericText>
        </View>
        <View style={[styles.rule, { backgroundColor: c.separator }]} />
        <View style={styles.body}>
          <Text variant="callout" align="auto" numberOfLines={2}>
            {r.body || snippetOf(r) || (r.media?.length ? `📎 ${r.media.length} attachments` : '')}
          </Text>
          <Chip label="Pending" size="sm" tone="warning" style={styles.pendingChip} />
        </View>
        <Touchable onPress={() => menu.open(r)} feedback="dim" accessibilityLabel="More" style={styles.more}>
          <Text variant="title3" tone="muted" align="center">⋮</Text>
        </Touchable>
      </View>
    )
    /* `menu.open` is the stable piece — useSheetState rebuilds its wrapper
       object every render, and FlashList compares renderItem by identity. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.surface, c.borderFaint, c.separator, menu.open])

  return (
    <Screen background="sunken">
      <Header back title="Scheduled" />

      {list.loading && !list.data ? (
        <MessageCardSkeleton count={3} />
      ) : list.error ? (
        <ChatErrorState error={list.error} title="Could not load scheduled messages" onRetry={list.reload} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderRow}
          contentContainerStyle={{ padding: space.md, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={Intro}
          ListEmptyComponent={
            <EmptyState
              icon="calendar"
              title="No scheduled messages"
              message="Hold the send button in a chat to schedule one."
            />
          }
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        actions={[
          { label: 'Send now', icon: 'send', onPress: () => { if (menu.payload) void sendNow(menu.payload) } },
          {
            label: 'Copy text',
            icon: 'copy',
            hidden: !menu.payload?.body,
            onPress: async () => {
              await Clipboard.setStringAsync(String(menu.payload?.body ?? ''))
              toast.ok('Copied')
            },
          },
          {
            label: 'Cancel',
            icon: 'close',
            destructive: true,
            onPress: () => { if (menu.payload) confirmCancel.open(menu.payload) },
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmCancel.visible}
        onClose={confirmCancel.close}
        title="Cancel this scheduled message?"
        message="It will not be sent."
        confirmLabel="Cancel it"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          const row = confirmCancel.payload
          confirmCancel.close()
          if (row) void cancel(row)
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: space.xs, paddingBottom: space.md },
  header: { paddingHorizontal: space.xs, paddingTop: space.sm2, paddingBottom: space.xs2 },
  /* THE STELE: card setback, 1px course, no shadow. */
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: StyleSheet.hairlineWidth, padding: space.md, marginBottom: space.sm2,
    ...setback(shape.card), borderCurve: 'continuous',
  },
  pendingChip: { marginTop: space.xs2 },
  when: { width: 52, alignItems: 'center' },
  rule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  body: { flex: 1 },
  more: { paddingHorizontal: space.xs2 },
})
