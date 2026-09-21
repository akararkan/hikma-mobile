/* =========================================================
   Top supporters.

   Coins are a SCORE. There is no wallet, no purchase and no
   payout anywhere in this product, so nothing on this board
   renders a currency symbol or a price — and the subtitle says
   so, on the one screen where a leaderboard of numbers next to
   avatars would otherwise read as money.

   The board is persisted server-side and outlives the
   broadcast, so it loads perfectly well for an ENDED stream.
   `stream.gift` updates a row from `senderTotalCoins`, the
   authoritative running total — accumulating `coins` locally
   drifts the moment a frame is missed.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import Animated, { LinearTransition } from 'react-native-reanimated'
import { api, errorText, isNetworkError } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Header, Icon, NumericText, Screen, ScreenScroll, SkeletonList,
  Text, Touchable,
} from '@/ui'
import type { GiftSupporter, LiveStream, StreamGift } from '@/components/live/types'

export default function SupportersScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const streamId = id ? String(id) : ''
  const meId = user?.id ? String(user.id) : null

  const board = useAsync<GiftSupporter[]>(
    /* 25, not the client default of 10 — this is the full board, not a preview. */
    () => api.chat.streams.gifts.top(streamId, 25),
    { enabled: !!streamId, deps: [streamId] },
  )
  const stream = useAsync<LiveStream>(
    async () => (await api.chat.streams.get(streamId)) as LiveStream,
    { enabled: !!streamId, deps: [streamId] },
  )

  useChatEvents(evt => {
    if (String(evt?.type || '') !== 'stream.gift') return
    const g: StreamGift = evt.streamGift
    if (!g || String(g.streamId) !== streamId) return
    board.setData(prev => {
      const rows = prev ?? []
      const existing = rows.find(r => String(r.userId) === String(g.senderId))
      const next: GiftSupporter = {
        userId: g.senderId,
        username: g.senderUsername,
        handle: g.senderHandle,
        displayName: existing?.displayName || g.senderUsername,
        avatarUrl: g.senderAvatarUrl ?? existing?.avatarUrl ?? null,
        coins: g.senderTotalCoins,
        giftCount: (existing?.giftCount ?? 0) + 1,
      }
      return [...rows.filter(r => String(r.userId) !== String(g.senderId)), next]
        .sort((a, b) => b.coins - a.coins)
    })
  })

  const rows = board.data ?? []
  const offline = isNetworkError(board.error)

  return (
    <Screen background="sunken">
      <Stack.Screen
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.5, 0.9],
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Header closeButton title="Top supporters" border={false} />

      <View style={styles.subtitle}>
        <Text variant="footnote" tone="muted" align="ui">
          Gifts are symbolic — coins are a score, not money.
        </Text>
        {stream.data && !stream.data.isLive ? (
          <Text variant="footnote" tone="faint" align="ui" style={styles.endedNote}>
            This stream has ended.
          </Text>
        ) : null}
      </View>

      {offline ? (
        <View style={[styles.strip, { backgroundColor: c.surfaceSunken }]}>
          <Icon name="offline" size={13} color={c.textMuted} />
          <Text variant="footnote" tone="muted" align="ui">Offline</Text>
        </View>
      ) : null}

      <ScreenScroll refreshing={board.refreshing} onRefresh={board.refresh}>
        {board.loading ? (
          <SkeletonList count={6} />
        ) : board.error && !rows.length && !offline ? (
          <View style={styles.errorCard}>
            <Text variant="callout" tone="muted" align="ui">{errorText(board.error)}</Text>
            <Button label="Try again" onPress={board.reload} variant="tinted" size="sm" icon="refresh" style={styles.retry} />
          </View>
        ) : !rows.length ? (
          <View style={styles.empty}>
            <Icon name="crown" size={48} color={c.textFaint} />
            <Text variant="headline" align="center" style={styles.emptyTitle}>No gifts yet</Text>
            <Text variant="footnote" tone="muted" align="center">Be the first to send one.</Text>
            <Button
              label="Send a gift"
              onPress={() => router.back()}
              variant="tinted"
              size="md"
              style={styles.emptyBtn}
            />
          </View>
        ) : (
          rows.map((s, i) => (
            <Animated.View
              key={String(s.userId ?? i)}
              layout={t.prefs.reducedMotion ? undefined : LinearTransition.duration(t.ms(240))}
            >
              <Touchable
                onPress={() => s.handle && router.push(`/u/${s.handle}`)}
                feedback="tint"
                noAutoHitSlop
                accessibilityLabel={`${s.displayName || s.handle}, rank ${i + 1}, ${s.coins} coins`}
                style={[
                  styles.row,
                  meId && String(s.userId) === meId ? { backgroundColor: c.surfaceSunken } : null,
                ]}
              >
                <View style={styles.rank}>
                  {i < 3 ? (
                    <Icon name="crown" size={18} color={MEDALS[i](c)} filled />
                  ) : (
                    <NumericText variant="bodyStrong" tone="faint" align="center">{i + 1}</NumericText>
                  )}
                </View>

                <Avatar uri={s.avatarUrl} name={s.displayName || s.handle} seed={s.userId} size={40} />

                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text variant="bodyStrong" align="ui" numberOfLines={1} style={styles.flex}>
                      {s.displayName || s.username || `@${s.handle}`}
                    </Text>
                    {meId && String(s.userId) === meId ? (
                      <View style={[styles.youChip, { backgroundColor: c.accentSoft }]}>
                        <Text variant="micro" tone="accent" weight="700">You</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{s.handle}</Text>
                </View>

                <View style={styles.coins}>
                  <View style={styles.coinRow}>
                    <Icon name="star" size={14} color={c.scholar} filled />
                    <NumericText variant="headline" align="ui">{s.coins}</NumericText>
                  </View>
                  <Text variant="micro" tone="muted" align="ui">{s.giftCount} gifts</Text>
                </View>
              </Touchable>
            </Animated.View>
          ))
        )}
      </ScreenScroll>
    </Screen>
  )
}

/* The web's rank discs after the gold retirement (`.lv-sup-rank`): first in
   the scholar navy, the rest in the quieter blues — never amber, which read
   as the retired gilt. Ranking still comes from position; the hue only
   grades it. */
const MEDALS = [
  (c: any) => c.scholar,
  (c: any) => c.scholarText,
  (c: any) => c.textMuted,
]

const styles = StyleSheet.create({
  subtitle: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  endedNote: { marginTop: space.xxs },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, height: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2, minHeight: 60 },
  rank: { width: 28, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  youChip: { paddingHorizontal: space.xs2, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  coins: { alignItems: 'flex-end' },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  empty: { alignItems: 'center', paddingVertical: 52, paddingHorizontal: space.xxxl, gap: space.xs },
  emptyTitle: { marginTop: space.md },
  emptyBtn: { marginTop: space.lg },
  errorCard: { padding: space.xl },
  retry: { marginTop: space.md },
  flex: { flex: 1 },
})
