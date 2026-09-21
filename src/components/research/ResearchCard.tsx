/* =========================================================
   ResearchCard — the domain's signature row.

   One component, three densities: the hub and tag pages get
   the full plate, the saved lists drop the abstract, and the
   dashboard swaps the plate for a thumb and inlines the
   lifecycle chip.

   The long-press menu deliberately does NOT live inside the
   card. A menu is a <Modal>, and a Modal per row means fifty
   modals mounted in a scroll view; `useResearchMenu` gives the
   LIST one menu and one optimistic-save path, and the card
   just reports the press.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, codeOf, errorText, isRateLimited } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { disciplineSpine, withAlpha } from '@/theme/colors'
import {
  ActionSheet, Avatar, Chip, Icon, IconButton, Selvedge, Skeleton, Text, Touchable,
  VerifiedMark, formatCount, toast, useSheetState,
} from '@/ui'
import { MetricStrip } from './MetricStrip'
import { ResearchCover } from './ResearchCover'
import { StatusPill } from './StatusPill'
import { toggleSaveRemote, useCooldown, type SavePatch } from './hooks'
import type { ResearchCardData } from './types'
import { to } from './nav'

/* Every callback takes the CARD as its first argument. That is not decoration:
   FlashList's ViewHolder memo compares renderItem by identity, so a list that
   writes `onLongPress={() => menu.open(item)}` mints a fresh renderItem — and
   with it a fresh render of every mounted cell — on each parent render. Taking
   the item back means ONE useEvent-stable handler serves the whole list. */
export interface ResearchCardProps {
  item: ResearchCardData
  variant?: 'feed' | 'compact' | 'dashboard'
  showStatus?: boolean
  /** The saved lists' "Saved 3d ago" line. */
  savedNote?: string | null
  onPress?: (item: ResearchCardData) => void
  onLongPress?: (item: ResearchCardData) => void
  onSaveToggle?: (item: ResearchCardData) => void
  onMenu?: (item: ResearchCardData) => void
}

function ResearchCardBase({
  item, variant = 'feed', showStatus = false, savedNote, onPress, onLongPress, onSaveToggle, onMenu,
}: ResearchCardProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()

  /* Bound here rather than at the call site — inside a memoized row a closure
     per render costs nothing, and it keeps the list's handlers stable. */
  const go = () => (onPress ? onPress(item) : router.push(to(`/research/${item.id}`)))
  const longPress = onLongPress ? () => onLongPress(item) : undefined
  const saveToggle = onSaveToggle ? () => onSaveToggle(item) : undefined
  const menu = onMenu ? () => onMenu(item) : undefined
  const openAuthor = () => router.push(to(`/u/${item.author}`))
  const tags = (item.tags || []).slice(0, 3)
  const moreTags = Math.max(0, (item.tags || []).length - tags.length)

  if (variant === 'dashboard') {
    return (
      <Touchable onPress={go} onLongPress={longPress} feedback="tint" noAutoHitSlop style={styles.dashRow}>
        <ResearchCover cover={item.cover} irc={item.irc} ratio={1} radius={t.radius.sm} style={styles.thumb} />
        <View style={styles.flex}>
          <Text variant="subhead" serif weight="600" align="auto" numberOfLines={2}>
            {item.title || 'Untitled paper'}
          </Text>
          <View style={[styles.rowWrap, { marginTop: space.xs2 }]}>
            <StatusPill status={item.status} scheduledPublishAt={item.scheduledPublishAt} />
            <Text variant="caption" tone="faint">{item.time}</Text>
          </View>
          <Text variant="caption" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xs2 }}>
            {formatCount(item.metrics.views)} views · {formatCount(item.metrics.reactions)} likes · {formatCount(item.metrics.citations)} citations
          </Text>
        </View>
        {menu ? <IconButton name="more" onPress={menu} accessibilityLabel="Paper actions" size={19} color={c.textMuted} /> : null}
      </Touchable>
    )
  }

  return (
    <Touchable onPress={go} onLongPress={longPress} feedback="dim" noAutoHitSlop style={styles.card}>
      <Selvedge color={disciplineSpine(item.id, item.tags)} />
      <ResearchCover cover={item.cover} irc={item.irc} radius={t.radius.md}>
        <View style={styles.plateChrome} pointerEvents="box-none">
          {item.irc ? (
            <View style={[styles.ircChip, { backgroundColor: c.overlayChip }]}>
              <Text variant="micro" mono color={c.overlayText} numberOfLines={1}>{item.irc}</Text>
            </View>
          ) : <View />}
          {item.hasVideo ? (
            <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
              <Icon name="play" size={14} color={c.overlayText} filled />
            </View>
          ) : null}
        </View>
        {saveToggle ? (
          <Touchable
            onPress={saveToggle}
            feedback="scale"
            haptic="light"
            accessibilityLabel={item.saved ? 'Remove from saved' : 'Save paper'}
            style={[styles.saveCorner, { backgroundColor: c.overlayChip }]}
          >
            <Icon name="bookmark" size={15} color={c.overlayText} filled={item.saved} />
          </Touchable>
        ) : null}
      </ResearchCover>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <View style={styles.titleRow}>
          <Text
            variant="headline"
            align="auto"
            numberOfLines={3}
            serif
            style={[styles.flex, { lineHeight: 23 }]}
          >
            {item.title || 'Untitled paper'}
          </Text>
          {showStatus ? <StatusPill status={item.status} scheduledPublishAt={item.scheduledPublishAt} /> : null}
        </View>

        {variant === 'feed' && item.abstract ? (
          <Text variant="footnote" tone="muted" align="auto" numberOfLines={2}>{item.abstract}</Text>
        ) : null}

        {variant === 'feed' && tags.length ? (
          <View style={[styles.rowWrap, { marginTop: space.xxs }]}>
            {tags.map(tag => (
              <Chip
                key={tag}
                label={`#${tag}`}
                tone="scholar"
                size="sm"
                onPress={() => router.push(to(`/research/tag/${encodeURIComponent(tag)}`))}
              />
            ))}
            {moreTags ? <Text variant="caption" tone="faint">+{moreTags}</Text> : null}
          </View>
        ) : null}

        <Touchable onPress={openAuthor} feedback="dim" noAutoHitSlop style={[styles.authorRow, { marginTop: space.xs }]}>
          <Avatar uri={item._author.profileImage} name={item._author.full} seed={item._author.id} size={22} />
          <Text variant="footnote" weight="600" align="ui" numberOfLines={1} style={styles.shrink}>
            {item._author.full}
          </Text>
          {item._author.verified ? <VerifiedMark size={12} /> : null}
          <Text variant="caption" tone="faint" numberOfLines={1}>· {item.time}</Text>
        </Touchable>

        <MetricStrip metrics={item.metrics} compact style={{ marginTop: space.xxs }} />

        {savedNote ? (
          <View style={styles.savedNote}>
            <Icon name="bookmark" size={11} color={withAlpha(c.accent, 0.9)} filled />
            <Text variant="caption" tone="faint">{savedNote}</Text>
          </View>
        ) : null}
      </View>
    </Touchable>
  )
}

/* Memoized, and every prop above is either the row's own item or a scalar —
   that pairing is the whole point. FlashList recycles the mounted instance,
   so a list render that moved nothing now stops at this boundary instead of
   rebuilding a cover, an avatar and a metric strip per visible row. */
export const ResearchCard = React.memo(ResearchCardBase)

/* ---------------------------------------------------------
   The skeleton mirrors the real card's rhythm — plate, two
   title bars, a chip row, a metric bar — so the first paint
   does not reflow when the data lands.
   --------------------------------------------------------- */

export function ResearchCardSkeleton() {
  const t = useTheme()
  const { width } = useWindowDimensions()
  return (
    <View style={styles.card}>
      {/* 16:9 at a phone's content width — the plate must not resize when the
          real cover lands. */}
      <Skeleton height={Math.round((width - 32) * 9 / 16)} radius={t.radius.md} />
      <View style={{ gap: space.sm2, marginTop: space.md }}>
        <Skeleton width="88%" height={14} />
        <Skeleton width="54%" height={14} />
        {/* The tag row's stand-ins: no `radius`, so they take the skeleton
            setback — the real chips are setback plates, not pills. */}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xxs }}>
          <Skeleton width={62} height={20} />
          <Skeleton width={78} height={20} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm2, alignItems: 'center', marginTop: space.xs }}>
          <Skeleton circle width={22} height={22} />
          <Skeleton width={120} height={11} />
        </View>
        <Skeleton width="70%" height={11} style={{ marginTop: space.xs }} />
      </View>
    </View>
  )
}

export function ResearchCardListSkeleton({ count = 3 }: { count?: number }) {
  return <View>{Array.from({ length: count }, (_, i) => <ResearchCardSkeleton key={i} />)}</View>
}

/* ---------------------------------------------------------
   useResearchMenu — one long-press menu and one optimistic
   save path for a whole list.

   Save is optimistic because the SSE stream never echoes the
   actor's own action back; the returned ResearchResponse then
   reconciles the count authoritatively. A 429 arms the cooldown
   and the menu item says how long is left rather than failing
   silently on the next tap.
   --------------------------------------------------------- */

export function useResearchMenu({
  onPatch, extra,
}: {
  onPatch?: (id: string, patch: Partial<ResearchCardData>) => void
  extra?: (card: ResearchCardData) => { label: string; icon?: any; onPress: () => void; destructive?: boolean }[]
} = {}) {
  const router = useRouter()
  const sheet = useSheetState<ResearchCardData>()
  const [cooldown, startCooldown] = useCooldown()
  const card = sheet.payload

  /* The paste-able link is ShareLinkInfo.shortUrl — `shareLink` reads it
     without bumping the counter, `recordShare` bumps it only once the user
     actually copied or completed the OS share. The summary adapter carries no
     shareUrl, so the menu fetches it on demand and falls back to the in-app
     path for anything the endpoint refuses (drafts answer NOT_PUBLISHED). */
  const fetchShortUrl = React.useCallback(async (target: ResearchCardData): Promise<string | null> => {
    try { return (await api.research.shareLink(target.id))?.shortUrl || null } catch { return null }
  }, [])

  const shareCard = React.useCallback(async (target: ResearchCardData) => {
    const url = await fetchShortUrl(target)
    const res = await Share.share({ message: [target.title, url].filter(Boolean).join('\n'), title: target.title })
    if (url && res.action === Share.sharedAction) {
      void Promise.resolve(api.research.recordShare(target.id)).catch(() => { /* a missed count must never interrupt a share */ })
    }
  }, [fetchShortUrl])

  const copyCardLink = React.useCallback(async (target: ResearchCardData) => {
    const url = await fetchShortUrl(target)
    await Clipboard.setStringAsync(url || `/research/${target.id}`)
    toast.ok('Link copied')
    if (url) {
      void Promise.resolve(api.research.recordShare(target.id)).catch(() => { /* best-effort counter */ })
    }
  }, [fetchShortUrl])

  const applySave = React.useCallback(async (target: ResearchCardData, next: boolean) => {
    const before: Partial<ResearchCardData> = { saved: target.saved, metrics: target.metrics }
    onPatch?.(target.id, {
      saved: next,
      metrics: { ...target.metrics, saves: Math.max(0, target.metrics.saves + (next ? 1 : -1)) },
    })
    try {
      const patch: SavePatch = await toggleSaveRemote(target.id, next)
      onPatch?.(target.id, { saved: patch.saved, metrics: { ...target.metrics, saves: patch.saves } })
      if (next) {
        toast.ok('Saved to Default', {
          label: 'Undo',
          onPress: () => { void applySave({ ...target, saved: true }, false) },
        })
      }
    } catch (e: any) {
      onPatch?.(target.id, before)
      if (isRateLimited(e)) startCooldown(e)
      toast.error(errorText(e))
    }
  }, [onPatch, startCooldown])

  const element = (
    <ActionSheet
      visible={sheet.visible}
      onClose={sheet.close}
      title={card?.title}
      subtitle={card?.irc || undefined}
      actions={[
        {
          label: cooldown > 0 ? `Wait ${cooldown}s` : card?.saved ? 'Remove from saved' : 'Save',
          icon: 'bookmark',
          disabled: cooldown > 0,
          onPress: () => { if (card) void applySave(card, !card.saved) },
        },
        {
          label: 'Change collection',
          icon: 'library',
          hidden: !card?.saved,
          onPress: () => { if (card) router.push(to(`/research/${card.id}/save`)) },
        },
        {
          label: 'Share',
          icon: 'share',
          onPress: () => { if (card) void shareCard(card) },
        },
        {
          label: 'Copy link',
          icon: 'link',
          onPress: () => { if (card) void copyCardLink(card) },
        },
        {
          label: 'See their papers',
          icon: 'person',
          onPress: () => { if (card) router.push(to(`/research/by/${card.author}`)) },
        },
        ...(card && extra ? extra(card) : []),
        {
          label: 'Report',
          icon: 'flag',
          destructive: true,
          onPress: () => {
            if (card) {
              router.push(reportHref({
                targetType: 'RESEARCH',
                targetId: card.id,
                authorId: card.author,
                name: card._author?.full || undefined,
                avatar: card._author?.profileImage || undefined,
                snippet: card.title || undefined,
              }))
            }
          },
        },
      ]}
    />
  )

  return { open: sheet.open, close: sheet.close, element, cooldown }
}

/** Shared by the card menu and the action bar: a block-relationship refusal is
 *  deliberately vague on the wire and must be shown exactly as sent. */
export function isBlockedInteraction(e: any): boolean {
  return e?.status === 403 && codeOf(e).includes('BLOCKED_RELATIONSHIP')
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg2 },
  dashRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center' },
  thumb: { width: 56, height: 56 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  titleRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs2 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  savedNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xxs },
  plateChrome: {
    position: 'absolute',
    top: 0, bottom: 0, start: 0, end: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: space.sm,
  },
  ircChip: { paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: 6 },
  /* Both round plates are icon-only buttons — sanctioned circles, not pills.
     `end` rather than `right` so the save corner mirrors in RTL. */
  playBadge: { width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  saveCorner: { position: 'absolute', top: 8, end: 8, width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
})
