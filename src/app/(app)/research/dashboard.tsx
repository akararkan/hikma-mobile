/* =========================================================
   My research — the author dashboard.

   Lifecycle actions here are NOT optimistic. Every one of them
   answers with the full paper carrying the authoritative
   status, and publish can answer 200 with the status still
   DRAFT — which is a moderation HOLD, not a success. Guessing
   the outcome would show a paper as live while it is still
   being checked.

   The citations tile sums only the rows currently loaded and
   says so: paging the whole corpus to compute a true total
   would be a lie told expensively.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { adapters, api, errorText } from '@/api'
import { useAuthGate, useRoleGate } from '@/context/AuthContext'
import { useEvent } from '@/hooks/useAsync'
import { heldPublish } from '@/lib/moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Divider, EmptyState, Field, Header, ListFooter, NumericText,
  Screen, SegmentedControl, Sheet, Skeleton, Text, formatCount, toast, useSheetState,
} from '@/ui'
import { ResearchCard } from '@/components/research/ResearchCard'
import { ErrorPanel, RefusalState, SignInPrompt, useTransientRetry } from '@/components/research/states'
import { useResearchList } from '@/components/research/hooks'
import { formatDateTime } from '@/components/research/format'
import { isScheduled } from '@/components/research/StatusPill'
import { to } from '@/components/research/nav'
import type { ResearchCardData, ResearchDetail } from '@/components/research/types'

/* Module scope, both of them: FlashList's ViewHolder memo compares
   renderItem AND ItemSeparatorComponent by identity, and an inline separator
   arrow is a fresh component TYPE each render — React remounts every visible
   divider rather than reconciling it. */
const keyExtractor = (item: ResearchCardData) => String(item.id)
const Sep = () => <Divider style={styles.sep} />

export default function DashboardScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const authGate = useAuthGate()
  const roleGate = useRoleGate(['SCHOLAR', 'RESEARCHER', 'ADMIN', 'SUPER_ADMIN'])

  const [segment, setSegment] = React.useState<'drafts' | 'all'>('drafts')
  const [visitedAll, setVisitedAll] = React.useState(false)

  const enabled = roleGate === 'allow'
  const drafts = useResearchList(({ page, size }) => api.research.myDrafts({ page, size }), { enabled })
  const all = useResearchList(({ page, size }) => api.research.myAll({ page, size }), { enabled: enabled && visitedAll })
  const list = segment === 'drafts' ? drafts : all
  useTransientRetry(list.error, list.reload)

  const menu = useSheetState<ResearchCardData>()
  const deleteSheet = useSheetState<ResearchCardData>()
  const [confirmTitle, setConfirmTitle] = React.useState('')
  const [checking, setChecking] = React.useState<string[]>([])

  const patchRow = (card: ResearchCardData, detail: ResearchDetail) => {
    const patch = { status: detail.status, scheduledPublishAt: detail.scheduledPublishAt, metrics: detail.metrics }
    drafts.patch(card.id, row => ({ ...row, ...patch }))
    all.patch(card.id, row => ({ ...row, ...patch }))
  }

  const lifecycle = async (card: ResearchCardData, action: 'publish' | 'unpublish' | 'archive' | 'retract') => {
    try {
      const raw = await api.research[action](card.id)
      const detail = adapters.researchDetailFrom(raw) as ResearchDetail
      patchRow(card, detail)
      if (action === 'publish' && heldPublish(raw)) {
        /* A 200 with the status still DRAFT means the classifier held it. */
        setChecking(prev => [...prev, card.id])
        toast.info('Checking… it goes live as soon as it clears.')
        return
      }
      toast.ok(
        action === 'publish' ? 'Published'
          : action === 'unpublish' ? 'Back to draft'
            : action === 'archive' ? 'Archived' : 'Retracted',
      )
    } catch (e: any) {
      toast.error(errorText(e))
      void list.refresh()
    }
  }

  /* ---------- row plumbing ----------
     Declared here, above the gate returns, because hooks cannot be
     conditional. Both handlers take the card back, so ONE function serves
     every row and `renderItem` only moves when `checking` does — which is
     the only per-row value the list actually renders. */
  const openMenu = useEvent((item: ResearchCardData) => menu.open(item))
  const publishNow = useEvent((item: ResearchCardData) => { void lifecycle(item, 'publish') })
  const renderItem = React.useCallback(({ item }: { item: ResearchCardData }) => (
    <View>
      <ResearchCard item={item} variant="dashboard" showStatus onMenu={openMenu} onLongPress={openMenu} />
      {item.status === 'DRAFT' ? (
        <View style={styles.draftRow}>
          {isScheduled(item.status, item.scheduledPublishAt) ? (
            <Text variant="caption" tone="warning" align="ui" style={styles.flex}>
              Scheduled for {formatDateTime(item.scheduledPublishAt)}
            </Text>
          ) : <View style={styles.flex} />}
          <Button
            label={checking.includes(item.id) ? 'Checking…' : 'Publish'}
            size="sm"
            variant="tinted"
            disabled={checking.includes(item.id)}
            onPress={() => publishNow(item)}
          />
        </View>
      ) : null}
    </View>
  ), [checking, openMenu, publishNow])

  if (authGate === 'deny') {
    return (
      <Screen>
        <Header back title="My research" />
        <SignInPrompt message="Sign in to manage your papers." />
      </Screen>
    )
  }
  if (roleGate === 'deny') {
    return (
      <Screen>
        <Header back title="My research" />
        <RefusalState />
      </Screen>
    )
  }

  const rows = all.items.length ? all.items : drafts.items
  const stats = {
    papers: rows.length,
    published: rows.filter(r => r.status === 'PUBLISHED').length,
    drafts: drafts.items.length,
    citations: rows.reduce((sum, r) => sum + (r.metrics?.citations || 0), 0),
  }

  const remove = async (card: ResearchCardData) => {
    try {
      await api.research.remove(card.id)
      drafts.remove(card.id)
      all.remove(card.id)
      deleteSheet.close()
      setConfirmTitle('')
      toast.ok('Paper deleted.')
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  const header = (
    <View>
      <View style={[styles.stats, { backgroundColor: c.surfaceSunken }]}>
        <Stat label="Papers" value={stats.papers} />
        <Stat label="Published" value={stats.published} />
        <Stat label="Drafts" value={stats.drafts} />
        <Stat label="Citations" value={stats.citations} note="across loaded papers" />
      </View>
      <SegmentedControl
        options={[{ value: 'drafts', label: 'Drafts' }, { value: 'all', label: 'All' }]}
        value={segment}
        onChange={v => { setSegment(v); if (v === 'all') setVisitedAll(true) }}
        style={styles.segments}
      />
    </View>
  )

  return (
    <Screen>
      <Header
        back
        title="My research"
        actions={[{ icon: 'add', onPress: () => router.push(to('/research/compose')), label: 'New paper' }]}
      />

      <FlashList
        data={list.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={header}
        ListEmptyComponent={
          list.loading ? (
            <View style={{ padding: space.lg, gap: space.lg2 }}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
                  <Skeleton width={56} height={56} radius={10} />
                  <View style={{ flex: 1, gap: space.sm }}>
                    <Skeleton width="72%" height={13} />
                    <Skeleton width="40%" height={11} />
                  </View>
                </View>
              ))}
            </View>
          ) : list.error ? (
            <ErrorPanel error={list.error} onRetry={list.reload} />
          ) : segment === 'drafts' ? (
            <EmptyState
              icon="edit"
              title="No drafts."
              message="Start a paper and it will wait here until you publish."
              actionLabel="New paper"
              onAction={() => router.push(to('/research/compose'))}
            />
          ) : (
            <EmptyState icon="research" title="You have not published anything yet." />
          )
        }
        ListFooterComponent={list.items.length ? <ListFooter loading={list.loadingMore} done={list.done} /> : null}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl refreshing={list.refreshing} onRefresh={() => { void list.refresh() }} tintColor={c.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.title}
        subtitle={menu.payload?.irc || undefined}
        actions={[
          { label: 'Preview', icon: 'eye', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}`)) } },
          { label: 'Edit', icon: 'edit', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}/edit`)) } },
          { label: 'Publishing', icon: 'upload', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}/edit/publish`)) } },
          { label: 'Media & cover', icon: 'image', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}/edit/media`)) } },
          { label: 'Sources', icon: 'quote', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}/edit/sources`)) } },
          { label: 'Contributors', icon: 'people', onPress: () => { if (menu.payload) router.push(to(`/research/${menu.payload.id}/edit/contributors`)) } },
          {
            label: 'Copy link',
            icon: 'link',
            onPress: async () => {
              if (!menu.payload) return
              await Clipboard.setStringAsync(`/research/${menu.payload.id}`)
              toast.ok('Link copied')
            },
          },
          {
            label: 'Publish now',
            icon: 'upload',
            hidden: menu.payload?.status !== 'DRAFT',
            onPress: () => { if (menu.payload) void lifecycle(menu.payload, 'publish') },
          },
          {
            label: 'Unpublish',
            icon: 'eyeOff',
            hidden: menu.payload?.status !== 'PUBLISHED',
            onPress: () => { if (menu.payload) void lifecycle(menu.payload, 'unpublish') },
          },
          {
            label: 'Archive',
            icon: 'archive',
            hidden: menu.payload?.status !== 'PUBLISHED',
            onPress: () => { if (menu.payload) void lifecycle(menu.payload, 'archive') },
          },
          {
            label: 'Retract',
            icon: 'warning',
            destructive: true,
            hidden: menu.payload?.status !== 'PUBLISHED',
            onPress: () => { if (menu.payload) void lifecycle(menu.payload, 'retract') },
          },
          {
            label: 'Delete permanently',
            icon: 'trash',
            destructive: true,
            onPress: () => { if (menu.payload) { setConfirmTitle(''); deleteSheet.open(menu.payload) } },
          },
        ]}
      />

      <Sheet
        visible={deleteSheet.visible}
        onClose={deleteSheet.close}
        title="Delete permanently"
        subtitle="This cannot be undone. Retract instead if you only want to withdraw it."
        footer={
          <Button
            label="Delete"
            variant="danger"
            block
            size="lg"
            disabled={confirmTitle.trim() !== (deleteSheet.payload?.title || '').trim()}
            onPress={() => { if (deleteSheet.payload) void remove(deleteSheet.payload) }}
          />
        }
      >
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          <Text variant="footnote" tone="muted" align="ui">
            Type the paper's title to confirm:
          </Text>
          <Text variant="subhead" align="auto" numberOfLines={3}>{deleteSheet.payload?.title}</Text>
          <Field value={confirmTitle} onChangeText={setConfirmTitle} placeholder="Paper title" autoFocus />
        </View>
      </Sheet>
    </Screen>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <View style={styles.stat}>
      <NumericText variant="title3" align="center">{formatCount(value)}</NumericText>
      <Text variant="caption" tone="muted" align="center">{label}</Text>
      {note ? <Text variant="micro" tone="faint" align="center" numberOfLines={2}>{note}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, borderRadius: 16, paddingVertical: 14, minHeight: 96 },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  segments: { marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, marginTop: -4 },
  sep: { marginHorizontal: 16 },
  flex: { flex: 1 },
})
