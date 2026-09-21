/* =========================================================
   GiftOverlay + GiftPickerSheet.

   Gifts are SYMBOLIC. `coins` is a leaderboard score: there is
   no wallet, no purchase and no payout, so nothing here ever
   renders a currency symbol, a price, or a "buy coins" button,
   and both surfaces carry the same sentence saying so.

   Animate ONLY from the `stream.gift` frame. The broadcast
   echoes back to the sender, so animating from the POST
   response as well shows the sender their own gift twice —
   which is why `gifts.send()`'s return value is discarded at
   every call site.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Avatar, Sheet, Skeleton, Text, Touchable } from '@/ui'
import { ROOM } from './skin'
import { giftEmoji, type GiftEntry, type StreamGift } from './types'

/** 1 coin → 1.6s, 50+ coins → 4s. A bigger gift deserves a longer moment. */
function durationFor(coins: number): number {
  return Math.round(1600 + Math.min(1, Math.max(0, coins) / 50) * 2400)
}

/** Owns the queue: at most two on screen, the rest wait their turn.
 *
 *  Lives here rather than in useLiveRoom because both live rooms mount the
 *  overlay, but only the ROOM knows when a gift arrived — the room holds this
 *  and hands `showing`/`keyOf` to <GiftOverlay>. */
export function useGiftQueue() {
  const [showing, setShowing] = React.useState<StreamGift[]>([])
  const pending = React.useRef<StreamGift[]>([])
  const seq = React.useRef(0)
  const keys = React.useRef(new WeakMap<StreamGift, string>())
  /* The occupancy counter lives in a ref, not in `showing.length`, because
     that is the only way the shift and the timer can happen OUTSIDE the
     setState updater — and they must. React treats updaters as pure and is
     free to run one twice for a single dispatch (StrictMode in dev,
     re-entrant renders under concurrent rendering); a queue shifted twice
     drops a gift on the floor and schedules its expiry twice. */
  const live = React.useRef(0)
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>())

  const pump = React.useCallback(() => {
    if (live.current >= 2) return
    const next = pending.current.shift()
    if (!next) return
    live.current += 1
    keys.current.set(next, `g${++seq.current}`)
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timers.current.delete(timer)
      live.current -= 1
      setShowing(cur => cur.filter(g => g !== next))
      pump()
    }, durationFor(next.coins))
    timers.current.add(timer)
    setShowing(prev => [...prev, next])
  }, [])

  /* Leaving the room mid-burst leaves up to 4s of expiry callbacks in flight,
     each one a setState on a hook that is gone. */
  React.useEffect(() => () => {
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])

  const push = React.useCallback((gift: StreamGift) => {
    pending.current.push(gift)
    pump()
  }, [pump])

  /* Stable identity — the room hands this straight down as a prop. `pump`
     always assigns before the gift can be rendered, so the `sentAt` arm is
     unreachable belt-and-braces; `?? ''` keeps a null out of the key. */
  const keyOf = React.useCallback((g: StreamGift) => keys.current.get(g) ?? String(g.sentAt ?? ''), [])

  return { showing, push, keyOf }
}

/* The TikTok banner LANE: gifts dock top-start under the header instead of
   detonating over the host's face, and concurrent bursts stack as banners
   with no collision. */
export function GiftOverlay({ queue, keyOf }: { queue: StreamGift[]; keyOf: (g: StreamGift) => string }) {
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="none" style={[styles.overlay, { top: insets.top + 148 }]}>
      {queue.map(g => <GiftBurst key={keyOf(g)} gift={g} />)}
    </View>
  )
}

function GiftBurst({ gift }: { gift: StreamGift }) {
  const t = useTheme()
  const scale = useSharedValue(0.6)

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { scale.value = 1; return }
    scale.value = withSequence(
      withSpring(1.2, t.motion.spring),
      withTiming(1, { duration: t.ms(t.motion.fast) }),
    )
  }, [scale, t])

  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(160))}
      exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(240))}
      style={[styles.banner, { backgroundColor: ROOM.glassStrong }]}
    >
      <Avatar uri={gift.senderAvatarUrl} name={gift.senderUsername} seed={gift.senderId} size={30} />
      <View style={styles.bannerText}>
        <Text variant="caption" caps={false} weight="700" color={ROOM.fg} numberOfLines={1}>
          @{gift.senderHandle}
        </Text>
        <Text variant="micro" caps={false} color={ROOM.fgMuted} numberOfLines={1}>
          {`sent ${gift.giftName}${gift.coins ? ` · ${gift.coins} coins` : ''}`}
        </Text>
      </View>
      {/* Sky ghost, not the warning wash: amber halo read as decoration-gold
          (retired), and Sky is the one on-dark accent. */}
      <Animated.View style={[styles.glow, { backgroundColor: ROOM.accentGhost }, anim]}>
        <Text style={styles.giftGlyph} align="center">{giftEmoji(gift.iconKey)}</Text>
      </Animated.View>
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   The picker.
   --------------------------------------------------------- */

export function GiftPickerSheet({
  visible, onClose, catalog, loading, error, onSend,
}: {
  visible: boolean
  onClose: () => void
  catalog: GiftEntry[]
  loading?: boolean
  error?: string | null
  onSend: (gift: GiftEntry) => void
}) {
  const t = useTheme()

  return (
    <Sheet visible={visible} onClose={onClose} title="Send a gift" maxHeightRatio={0.55}>
      <View style={styles.grid}>
        {loading && !catalog.length
          ? Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={styles.giftCell}>
              <Skeleton width={58} height={58} radius={16} />
            </View>
          ))
          : catalog.map(g => (
            <Touchable
              key={String(g.id)}
              onPress={() => { onSend(g); onClose() }}
              haptic="light"
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={`Send ${g.name}, ${g.coins} coins`}
              style={styles.giftCell}
            >
              <View style={[styles.giftTile, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md }]}>
                <Text style={styles.giftTileGlyph} align="center">{giftEmoji(g.iconKey)}</Text>
              </View>
              <Text variant="caption" align="center" numberOfLines={1} style={styles.giftName}>{g.name}</Text>
              <View style={[styles.coinChip, setback(t.shape.chip), { backgroundColor: t.colors.scholarSoft }]}>
                <Text variant="micro" tone="scholar">{g.coins}</Text>
              </View>
            </Touchable>
          ))}
      </View>

      {error ? (
        <Text variant="footnote" tone="danger" align="ui" style={styles.pickerNote}>{error}</Text>
      ) : null}

      {!loading && !catalog.length && !error ? (
        <Text variant="footnote" tone="muted" align="center" style={styles.pickerNote}>
          No gifts are available right now.
        </Text>
      ) : null}

      <Text variant="footnote" tone="muted" align="ui" style={styles.pickerNote}>
        Gifts are symbolic — coins are a score, not money.
      </Text>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', start: 12, alignItems: 'flex-start', gap: space.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.xs2,
    paddingEnd: space.sm2,
    borderRadius: 8,
    maxWidth: 280,
  },
  bannerText: { flexShrink: 1 },
  glow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  giftGlyph: { fontSize: 24, lineHeight: 30 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.md, paddingTop: space.sm },
  giftCell: { width: '25%', alignItems: 'center', paddingVertical: space.sm2 },
  giftTile: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  giftTileGlyph: { fontSize: 30, lineHeight: 38 },
  giftName: { marginTop: space.xs2 },
  coinChip: { marginTop: space.xs, paddingHorizontal: space.xs2, borderCurve: 'continuous' },
  pickerNote: { paddingHorizontal: space.xl, paddingTop: space.sm2, paddingBottom: space.xs },
})
