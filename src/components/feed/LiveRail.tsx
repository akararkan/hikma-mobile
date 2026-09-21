/* =========================================================
   LiveRail — the "live right now" strip above the feed.

   Page 1 only: a cursor page comes back with `liveNow: []` by
   design, so the rail is fed from the first page and then kept
   fresh by its own 60s poll rather than by re-reading the feed
   body.

   The ring breathes. It is the one piece of ambient motion in
   the feed, it is what makes "live" read as live rather than as
   a red label, and it stops entirely under reduced motion.

   A STELE like the post cards it sits between (DESIGN.md §6),
   wearing the liveDot SELVEDGE at the start edge. The LIVE tag
   on each avatar is one of the two sanctioned pills.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, {
  Easing, cancelAnimation, makeMutable, useAnimatedStyle, withRepeat, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { FEED_GUTTER } from './plate'
import { Avatar, Icon, NumericText, Selvedge, Skeleton, Text, Touchable, WeftDash, formatCount } from '@/ui'
import type { LiveStreamView } from './types'

/* ---------------------------------------------------------
   THE BREATH — one module-scope animated value drives every
   live ring on screen, refcounted like the skeleton weft
   (ui/State.tsx): the first mounted cell starts the loop, the
   last one stops it. O(1) infinite animations however many
   streams are live, and the rings breathe in phase instead of
   drifting. Reduced motion holds it at 1.
   --------------------------------------------------------- */
const breathe = makeMutable(1)
let breatheUsers = 0
let breatheOn: boolean | null = null

function acquireBreathe(reduced: boolean) {
  breatheUsers++
  const on = !reduced
  if (breatheOn === on) return
  breatheOn = on
  cancelAnimation(breathe)
  breathe.value = 1
  if (on) {
    breathe.value = withRepeat(
      withTiming(1.045, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
  }
}

function releaseBreathe() {
  breatheUsers--
  if (breatheUsers <= 0) {
    breatheUsers = 0
    breatheOn = null
    cancelAnimation(breathe)
    breathe.value = 1
  }
}

export interface LiveRailProps {
  streams: LiveStreamView[]
  onPress?: (stream: LiveStreamView) => void
  onSeeAll?: () => void
  loading?: boolean
}

export function LiveRail({ streams, onPress, onSeeAll, loading }: LiveRailProps) {
  const t = useTheme()
  const c = t.colors

  if (!loading && !streams.length) return null

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <Selvedge color={c.liveDot} />

      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: c.liveDot }]} />
        <Text variant="caption" tone="muted" style={styles.flex}>LIVE NOW</Text>
        {onSeeAll ? (
          <Touchable onPress={onSeeAll} feedback="dim" noAutoHitSlop style={styles.seeAll}>
            <Text variant="footnote" tone="accent">See all</Text>
          </Touchable>
        ) : null}
      </View>

      <WeftDash style={styles.dash} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {loading && !streams.length
          ? Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={styles.cell}>
              <Skeleton circle width={64} height={64} />
              <Skeleton width={54} height={9} style={{ marginTop: space.sm2 }} />
            </View>
          ))
          : streams.map(s => <LiveCell key={s.id} stream={s} onPress={onPress} />)}
      </ScrollView>
    </View>
  )
}

function LiveCell({ stream, onPress }: { stream: LiveStreamView; onPress?: (s: LiveStreamView) => void }) {
  const t = useTheme()
  const c = t.colors

  React.useEffect(() => {
    acquireBreathe(t.prefs.reducedMotion)
    return releaseBreathe
  }, [t.prefs.reducedMotion])

  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }))

  return (
    <Touchable
      onPress={() => onPress?.(stream)}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`${stream.hostDisplayName || stream.hostHandle} is live`}
      style={styles.cell}
    >
      <Animated.View style={breatheStyle}>
        {/* `ring="live"` is the design system's own liveDot ring + LIVE tag
            (a sanctioned pill), so the badge can never drift from the one on
            a story ring. */}
        <Avatar
          uri={stream.hostAvatarUrl}
          name={stream.hostDisplayName || stream.hostHandle}
          seed={stream.hostId || stream.id}
          size={64}
          ring="live"
        />
      </Animated.View>

      {/* The name reads as a NAME (no eyebrow caps), and the audience sits
          under it as quiet print — nothing overlaps the ring or the pill. */}
      <Text variant="footnote" weight="600" align="center" numberOfLines={1} style={styles.name}>
        {stream.hostDisplayName || stream.hostHandle}
      </Text>
      {stream.viewerCount > 0 ? (
        <View style={styles.viewers}>
          <Icon name="eye" size={11} color={c.textMuted} />
          <NumericText variant="caption" caps={false} tone="muted">
            {formatCount(stream.viewerCount)}
          </NumericText>
        </View>
      ) : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  wrap: {
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',   /* clips the selvedge to the setback corners */
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: FEED_GUTTER, paddingBottom: space.sm2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  flex: { flex: 1 },
  seeAll: { paddingVertical: space.xxs },
  dash: { marginBottom: space.sm2, marginHorizontal: FEED_GUTTER },
  rail: { paddingHorizontal: FEED_GUTTER, gap: space.md2 },
  cell: { width: 84, alignItems: 'center' },
  /* Under the name, not over the face: the eye + tabular count in muted
     slate — the LIVE tag on the avatar is the only pill here. */
  viewers: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
  name: { marginTop: space.sm, maxWidth: 84 },
})
