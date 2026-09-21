/* =========================================================
   Share activity — the append-only ledger for one post.

   There is no "unshare", and the rows arrive RAW: no adapter,
   no identity, just { postId, createdAt, shareId, sharerId,
   caption }. So the screen hydrates the sharers itself, once
   per unique id — a post shared forty times by five people
   costs five reads, not forty — and a rejected read degrades to
   the initials fallback rather than dropping the row, because
   the ledger entry is true whether or not the profile loads.

   No cursor exists on this endpoint: pageSize (clamped 1..100)
   is the whole window.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { api, adapters, errorText } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Divider, EmptyState, ErrorState, Header, NumericText, Screen, Text, Touchable,
  formatCount, toast,
} from '@/ui'
import { RowSkeleton } from '@/components/feed/FeedSkeleton'
import type { FeedAuthor } from '@/components/feed/types'

const WINDOW = 50

interface ShareRow {
  postId: string
  createdAt: string
  shareId: string
  sharerId: string
  caption: string | null
}

const keyExtractor = (r: ShareRow) => String(r.shareId)

/* Module-scope, because FlashList's cell memo compares both renderItem AND
   ItemSeparatorComponent by identity — an inline arrow is a brand-new
   component type per render, which remounts every visible separator. */
const Sep = () => <Divider inset={68} />

export default function SharesScreen() {
  const c = useTheme().colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const ledger = useAsync<ShareRow[]>(() => api.posts.sharesList(id, WINDOW), { enabled: !!id, deps: [id] })
  const link = useAsync<{ shareCount: number }>(() => api.posts.shareLink(id), { enabled: !!id, deps: [id] })

  const [people, setPeople] = React.useState<Record<string, FeedAuthor>>({})

  React.useEffect(() => {
    const rows = ledger.data
    if (!rows?.length) return
    const missing = [...new Set(rows.map(r => String(r.sharerId)))].filter(uid => uid && !people[uid])
    if (!missing.length) return
    let alive = true

    void Promise.allSettled(missing.map(uid => api.users.get(uid))).then(results => {
      if (!alive) return
      const next: Record<string, FeedAuthor> = {}
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled' || !res.value) return
        const u: any = res.value
        next[missing[i]] = {
          id: missing[i],
          full: u.full || u.displayName || 'Member',
          handle: u.handle || '',
          initials: u.initials || adapters.initialsOf(u.full || ''),
          avc: u.avc || '',
          profileImage: u.profileImage ?? u.avatarUrl ?? null,
          verified: !!u.verified,
          role: u.role || 'MEMBER',
        }
      })
      if (Object.keys(next).length) setPeople(prev => ({ ...prev, ...next }))
    })

    return () => { alive = false }
  }, [ledger.data, people])

  const rows = ledger.data || []

  const refresh = () => { void ledger.refresh(); void link.refresh() }

  /* One function for every row, taking what it needs as arguments — the
     ledger re-renders on each hydration batch and a per-row closure would
     re-invoke renderItem for every mounted cell. */
  const onPressPerson = useEvent((sharerId: string) => router.push(`/u/${sharerId}`))
  const onCopyCaption = useEvent(async (caption: string) => {
    await Clipboard.setStringAsync(caption)
    toast.ok('Copied')
  })

  const renderItem = React.useCallback(({ item }: { item: ShareRow }) => {
    const who = people[String(item.sharerId)]
    return (
      <LedgerRow
        sharerId={String(item.sharerId)}
        name={who?.full || 'Member'}
        handle={who?.handle || ''}
        avatar={who?.profileImage ?? null}
        caption={item.caption}
        time={adapters.timeAgo(item.createdAt)}
        onPressPerson={onPressPerson}
        onCopyCaption={onCopyCaption}
      />
    )
  }, [people, onPressPerson, onCopyCaption])

  return (
    <Screen>
      <Header back title="Shares" />

      <View style={styles.summary}>
        <NumericText variant="title2">
          {formatCount(link.data?.shareCount ?? rows.length)}
        </NumericText>
        <Text variant="title2" style={{ marginStart: space.xs2 }}>shares</Text>
      </View>
      <Text variant="footnote" tone="muted" align="ui" style={styles.sub}>Most recent first</Text>

      {ledger.loading ? (
        <RowSkeleton count={6} avatar={40} />
      ) : ledger.error ? (
        <ErrorState error={ledger.error} onRetry={() => { void ledger.reload() }} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={ledger.refreshing}
              onRefresh={refresh}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          ItemSeparatorComponent={Sep}
          ListEmptyComponent={
            <EmptyState
              icon="share"
              title="No shares yet"
              message="When someone shares this post it shows up here."
            />
          }
        />
      )}

      {link.error ? (
        <Text variant="caption" tone="faint" align="center" style={styles.linkErr}>{errorText(link.error)}</Text>
      ) : null}
    </Screen>
  )
}

/* One ledger row. Memoized and fed scalars — the sharer hydration lands in
   batches, and handing every row the whole `people` map would repaint the
   list each time one profile resolves. */
const LedgerRow = React.memo(function LedgerRow({
  sharerId, name, handle, avatar, caption, time, onPressPerson, onCopyCaption,
}: {
  sharerId: string
  name: string
  handle: string
  avatar: string | null
  caption: string | null
  time: string
  onPressPerson: (sharerId: string) => void
  onCopyCaption: (caption: string) => void
}) {
  const t = useTheme()
  const c = t.colors

  return (
    <Touchable onPress={() => onPressPerson(sharerId)} feedback="tint" noAutoHitSlop style={styles.row}>
      <Avatar uri={avatar} name={name} seed={sharerId} size={40} />
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text variant="subhead" weight="600" numberOfLines={1} style={styles.shrink}>{name}</Text>
          {handle ? <Text variant="footnote" tone="muted" numberOfLines={1}>@{handle}</Text> : null}
        </View>
        {caption ? (
          <Touchable
            onLongPress={() => onCopyCaption(caption)}
            feedback="dim"
            noAutoHitSlop
            style={[styles.captionBubble, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.xs }]}
          >
            <Text variant="footnote" tone="secondary">{caption}</Text>
          </Touchable>
        ) : null}
      </View>
      <Text variant="footnote" tone="faint">{time}</Text>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  summary: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: space.lg, paddingTop: space.md },
  sub: { paddingHorizontal: space.lg, paddingBottom: space.md2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs2 },
  captionBubble: { marginTop: space.xs2, paddingHorizontal: space.sm2, paddingVertical: space.xs2, alignSelf: 'flex-start' },
  linkErr: { paddingVertical: space.sm },
})
