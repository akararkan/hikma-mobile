/* =========================================================
   The mentions feed — everywhere I was DIRECTLY mentioned.

   GET /mentions/me is keyset-paged, not page-numbered: the
   cursor for the next page is the LAST row's `mentionedAt`,
   and the server answers strictly-older rows — so an empty
   page is the end, never an error. mentionRowFrom mirrors
   mentionedAt into createdAt precisely so the shared
   date-bucket grouping works unchanged; this screen leans on
   that.

   Two absences are the server's, not gaps here: @followers
   fan-outs never write a feed row, and chat mentions surface
   as MESSAGE_MENTION notifications only (messages can be
   deleted or disappearing). The empty-state copy says so.

   `deepLink` arrives already rewritten to client routes by
   api/mentions.js — nested sources (comment, answer) link to
   their navigable parent by design.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api } from '@/api'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, EmptyState, ErrorState, Header, Icon, ListFooter, Screen, Text, Touchable,
  type IconName,
} from '@/ui'
import { DateSectionHeader, NotificationSkeleton } from '@/components/notifications/ListParts'
import { dateBucket, toneColors, type KindTone } from '@/components/notifications/constants'

interface Mention {
  key: string
  sourceType: string
  sourceId: string
  parentId: string | null
  snippet: string
  mentionedAt: string | null
  createdAt: string | null
  time: string
  deepLink: string | null
  _actor: {
    id: string
    full: string
    handle: string
    profileImage: string | null
  } | null
}

type ListItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'row'; key: string; row: Mention }

/* The api modules are JS. TypeScript infers their option bags from the
   destructuring defaults alone, so `cursor` (which has no default) vanishes
   from the inferred signature — the alias restores the contract documented
   in api/mentions.js. */
const listMentions = api.mentions.me as (
  args?: { limit?: number; cursor?: string | null; signal?: AbortSignal },
) => Promise<Mention[]>

/** Where the mention happened, in the inbox's own type-skin language
 *  (toneColors) — research and Q&A surfaces read scholar, the rest accent. */
const SOURCE_SKINS: Record<string, { label: string; icon: IconName; tone: KindTone }> = {
  POST: { label: 'Post', icon: 'sparkle', tone: 'accent' },
  POST_COMMENT: { label: 'Comment', icon: 'comment', tone: 'accent' },
  RESEARCH: { label: 'Research', icon: 'research', tone: 'scholar' },
  RESEARCH_COMMENT: { label: 'Research comment', icon: 'comment', tone: 'scholar' },
  QUESTION: { label: 'Question', icon: 'qna', tone: 'scholar' },
  QUESTION_ANSWER: { label: 'Answer', icon: 'reply', tone: 'scholar' },
}

/* Server clamp is [1, 50]. */
const PAGE_SIZE = 30

/* Module scope. FlashList compares keyExtractor/getItemType by identity and
   pools recycled cells by item type; an inline arrow re-renders every mounted
   cell and lets a date header's key be handed to a full mention row. */
const keyExtractor = (item: ListItem) => item.key
const getItemType = (item: ListItem) => item.kind

/* One element, built once: passing a fresh <EmptyState> in the JSX re-renders
   the empty ViewHolder on every screen render. */
const EMPTY = (
  <EmptyState
    icon="at"
    title="No mentions yet"
    message="When someone @mentions you in a post, comment, research or Q&A, it shows up here. Chat mentions stay in your notifications."
  />
)

export default function MentionsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  /* Large-title collapse (§6 Header): past 8pt the display title folds and
     the DOUBLE RULE lands on the header's bottom edge. */
  const [collapsed, setCollapsed] = React.useState(false)

  const fetchPage = React.useCallback(async ({ cursor, pageSize, signal }: { cursor?: string | null; pageSize: number; signal: AbortSignal }) => {
    const rows = await listMentions({ limit: pageSize, cursor, signal })
    /* Keyset discipline: feed the last row's mentionedAt back as the cursor.
       The server pages strictly older, so no no-progress guard is needed. */
    const last = rows.length ? rows[rows.length - 1].mentionedAt : null
    return { items: rows, nextCursor: last }
  }, [])

  const {
    items, error, loading, refreshing, loadingMore, done,
    loadMore, refresh, reload,
  } = usePaged<Mention>(fetchPage, {
    mode: 'cursor',
    pageSize: PAGE_SIZE,
    keyOf: r => r.key,
  })

  const openRow = React.useCallback((row: Mention) => {
    if (row.deepLink) router.push(row.deepLink as any)
  }, [router])

  const data = React.useMemo<ListItem[]>(() => {
    const out: ListItem[] = []
    const seen = new Set<string>()
    let bucket = ''
    for (const row of items) {
      /* A duplicate key is a hard crash in FlashList. */
      if (!row?.key || seen.has(row.key)) continue
      seen.add(row.key)
      const b = dateBucket(row.createdAt)
      if (b !== bucket) { bucket = b; out.push({ kind: 'header', key: `h:${b}:${out.length}`, title: b }) }
      out.push({ kind: 'row', key: row.key, row })
    }
    return out
  }, [items])

  const stickyIndices = React.useMemo(
    () => data.reduce<number[]>((acc, it, i) => { if (it.kind === 'header') acc.push(i); return acc }, []),
    [data],
  )

  /* `openRow` is the only moving part and it is useCallback-stable, so this
     identity holds for the life of the screen — which is what keeps
     FlashList's ViewHolder memo from re-rendering every mounted cell. */
  const renderItem = React.useCallback(({ item }: { item: ListItem }) => {
    if (item.kind === 'header') return <DateSectionHeader title={item.title} />
    return <MentionRow row={item.row} onPress={openRow} />
  }, [openRow])

  /* React only when the collapse boolean flips, not on every scroll frame. */
  const onScroll = React.useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const next = e.nativeEvent.contentOffset.y > 8
    setCollapsed(prev => (prev === next ? prev : next))
  }, [])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 32 }),
    [insets.bottom],
  )

  const listFooter = React.useMemo(() => (
    <ListFooter
      loading={loadingMore}
      error={items.length ? error : null}
      onRetry={loadMore}
      done={done && items.length > 0}
      doneLabel="That's every mention."
    />
  ), [loadingMore, error, items.length, loadMore, done])

  return (
    <Screen>
      <Header back title="Mentions" large collapsed={collapsed} />

      {loading ? <NotificationSkeleton /> : error && !items.length ? (
        <ErrorState error={error} onRetry={reload} title="Couldn't load your mentions" />
      ) : (
        <FlashList
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          stickyHeaderIndices={stickyIndices}
          ListEmptyComponent={EMPTY}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={contentStyle}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={c.textMuted}
              colors={[c.accent]}
              progressBackgroundColor={c.surface}
            />
          }
          ListFooterComponent={listFooter}
        />
      )}
    </Screen>
  )
}

/* ---------------------------------------------------------
   One mention row: who, the snippet captured at mention time,
   and which surface it happened on. The snippet is a
   notification-time SNAPSHOT — the source may since have been
   edited or (outside posts) deleted, which is why a missing
   deepLink leaves the row inert rather than broken.

   Memoized on an item-first `onPress`, so the screen hands one
   stable function to every row.
   --------------------------------------------------------- */

const ROW_INSET = 72          // avatar block + gutter — the separator inset

const MentionRow = React.memo(function MentionRow({ row, onPress }: { row: Mention; onPress: (row: Mention) => void }) {
  const t = useTheme()
  const c = t.colors
  const skin = SOURCE_SKINS[row.sourceType] ?? SOURCE_SKINS.POST
  const tint = toneColors(c, skin.tone)
  const actor = row._actor
  const who = actor?.handle ? `@${actor.handle}` : actor?.full || 'Someone'

  return (
    <View style={{ backgroundColor: c.bg }}>
      <Touchable
        onPress={() => onPress(row)}
        feedback={row.deepLink ? 'tint' : 'scale'}
        noAutoHitSlop
        accessibilityLabel={`${who} mentioned you in a ${skin.label.toLowerCase()}. ${row.snippet}`}
        style={[styles.row, { paddingVertical: space.md * t.densityScale }]}
      >
        <View style={styles.leading}>
          <Avatar uri={actor?.profileImage} name={actor?.full} seed={actor?.id} size={44} />
          <View style={[styles.badge, { backgroundColor: tint.fg, borderColor: c.bg }]}>
            <Icon name="at" size={11} color={c.textOnAccent} filled />
          </View>
        </View>

        <View style={styles.middle}>
          <Text variant="body" weight="600" numberOfLines={1}>{who}</Text>
          {row.snippet ? (
            <Text variant="callout" tone="secondary" numberOfLines={2} style={styles.snippet}>
              {row.snippet}
            </Text>
          ) : null}
          <View style={styles.meta}>
            <View style={[styles.sourcePlate, { backgroundColor: tint.soft }]}>
              <Icon name={skin.icon} size={11} color={tint.fg} />
              <Text variant="caption" color={tint.fg} align="ui">{skin.label}</Text>
            </View>
            {row.time ? <Text variant="footnote" tone="faint" align="ui">{row.time}</Text> : null}
          </View>
        </View>

        {row.deepLink ? <Icon name="forward" size={16} color={c.textFaint} style={styles.chevron} /> : null}
      </Touchable>

      <View style={[styles.separator, { backgroundColor: c.separator, marginStart: ROW_INSET }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    minHeight: 76,
  },
  leading: { width: 44, height: 44 },
  badge: {
    position: 'absolute',
    end: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, marginStart: space.md, marginEnd: space.sm },
  snippet: { marginTop: space.xxs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs },
  /* A labelled chip ("Post", "Research"), so it wears the chip setback —
     pills belong to unread counters and LIVE badges alone. */
  sourcePlate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 18,
    paddingHorizontal: space.xs2,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  chevron: { opacity: 0.35, marginTop: space.md2 },
  separator: { height: StyleSheet.hairlineWidth },
})
