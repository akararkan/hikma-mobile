/* =========================================================
   Reaction chips, hanging off the bubble's bottom edge.

   The subtlety is `authoritative`. Timeline page rows carry
   reaction COUNTS but deliberately omit `reactedByMe` — the
   backend will not run a per-viewer lookup across a page of
   forty messages. Only messages.get / messages.reactions fill
   it in.

   So until one of those has run, "mine" is local intent: what
   this device just tapped. Outlining a chip from a count alone
   would tell half the group they reacted when they did not.

   A chat reaction is also ONE per user — reacting again CHANGES
   it rather than adding a second — which is why the toggle
   handler passes the emoji rather than a delta.

   QELAT (DESIGN.md §6 Chip, §7.1): chips are SETBACK chips
   (shape.chip 8/3), not pills. A confirmed reaction announces
   itself with the DIAMOND TURN — a 4pt rotated square that
   turns 45°→0 on the masonry curve — plus the selection haptic
   the Touchable already fires. That mark is `SelectionDiamond`
   from '@/ui': ONE implementation, shared with the filter
   chips, so the app's "click" can never turn two ways. No
   shadows: the chip sits on the wallpaper by border alone.

   Both exports are memoized — they hang off MessageBubble,
   which is a recycled FlashList cell.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { NumericText, SelectionDiamond, Text, Touchable } from '@/ui'

export interface Reaction { emoji: string; count: number; reactedByMe?: boolean }

export interface ReactionChipsProps {
  reactions: Reaction[]
  /** True once a read that carries `reactedByMe` has populated these rows. */
  authoritative?: boolean
  /** Emoji this device has applied locally, pending an authoritative read. */
  localMine?: string | null
  onToggle: (emoji: string) => void
  onOpenDetail?: () => void
  mine: boolean
}

/* The setback maps are static token reads, so they are resolved once instead
   of allocating a fresh corner object per chip per render. */
const CHIP_SETBACK = setback(shape.chip)
const POPOVER_SETBACK = setback(shape.popover)

export const ReactionChips = React.memo(function ReactionChips({
  reactions, authoritative, localMine, onToggle, onOpenDetail, mine,
}: ReactionChipsProps) {
  const t = useTheme()
  const c = t.colors
  const rows = (reactions || []).filter(r => r.emoji && r.count > 0)
  if (!rows.length) return null

  return (
    <View style={[styles.rail, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      {rows.map(r => (
        <ReactionChip
          key={r.emoji}
          emoji={r.emoji}
          count={r.count}
          isMine={authoritative ? !!r.reactedByMe : localMine === r.emoji}
          onToggle={onToggle}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </View>
  )
})

/* One chip. The count POPS when it moves — the reel rail's confirm, scaled
   down — but there is deliberately no mount entrance: this lives in recycled
   bubbles, and an entrance replays on every reuse (§9). */
const ReactionChip = React.memo(function ReactionChip({
  emoji, count, isMine, onToggle, onOpenDetail,
}: {
  emoji: string
  count: number
  isMine: boolean
  onToggle: (emoji: string) => void
  onOpenDetail?: () => void
}) {
  const t = useTheme()
  const c = t.colors

  const pop = useSharedValue(0)
  const prev = React.useRef(count)
  React.useEffect(() => {
    if (prev.current === count) return
    prev.current = count
    if (t.prefs.reducedMotion) return
    pop.value = withSequence(withTiming(0.16, { duration: t.ms(90) }), withSpring(0, t.motion.spring))
  }, [count, pop, t])
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value }] }))

  return (
    <Animated.View style={anim}>
      <Touchable
        onPress={() => onToggle(emoji)}
        onLongPress={onOpenDetail}
        feedback="scale"
        haptic="select"
        noAutoHitSlop
        accessibilityLabel={`${emoji} ${count}`}
        accessibilityState={{ selected: isMine }}
        style={[
          styles.chip,
          CHIP_SETBACK,
          {
            /* Web .ch-react: white chip on a soft hairline; my own
               reaction sits on the accent wash under a sky course
               (.ch-react.mine) — the wash and the diamond carry the
               state, the border stays quiet. */
            backgroundColor: isMine ? c.accentSoft : c.surface,
            borderColor: isMine ? c.sky : c.borderFaint,
            borderWidth: isMine ? t.rule.control : t.rule.course,
          },
        ]}
      >
        {/* Mounted only while the reaction is mine, so the shared
            ornament's default `selected` plays the 45°→0 entrance. */}
        {isMine ? <SelectionDiamond color={c.accent} size={4} /> : null}
        <Text variant="caption" style={styles.emoji}>{emoji}</Text>
        {count > 1 ? (
          <NumericText variant="micro" tone={isMine ? 'accent' : 'muted'}>{count}</NumericText>
        ) : null}
      </Touchable>
    </Animated.View>
  )
})

/* ---------------------------------------------------------
   QuickReactions — the floating bar a long-press raises.
   A raised surface (§3): surfaceRaised + borderStrong course,
   popover setback, lifted on the popover shadow — this is a
   menu, not a list row, so the shadow is sanctioned.
   --------------------------------------------------------- */

export const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

export const QuickReactions = React.memo(function QuickReactions({
  current, onPick, onMore,
}: { current?: string | null; onPick: (emoji: string) => void; onMore?: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <View
      style={[
        styles.quickBar,
        POPOVER_SETBACK,
        { backgroundColor: c.surfaceRaised, borderColor: c.borderStrong, borderWidth: t.rule.course },
        t.shadow(2),
      ]}
    >
      {QUICK_EMOJI.map(e => (
        <Touchable
          key={e}
          onPress={() => onPick(e)}
          feedback="scale"
          haptic="select"
          noAutoHitSlop
          accessibilityLabel={`React ${e}`}
          accessibilityState={{ selected: current === e }}
          style={[
            styles.quickCell,
            current === e
              ? [CHIP_SETBACK, { backgroundColor: c.accentSoft }]
              : null,
          ]}
        >
          <Text variant="title3">{e}</Text>
        </Touchable>
      ))}
      {onMore ? (
        <Touchable onPress={onMore} feedback="scale" noAutoHitSlop accessibilityLabel="More reactions" style={styles.quickCell}>
          <Text variant="title3" tone="muted">＋</Text>
        </Touchable>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  /* The chips nestle onto the bubble's bottom edge (web .ch-reacts:
     margin-top −9, inset from the bubble corner so the overlap reads as
     deliberate rather than collision). */
  rail: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, marginTop: -space.sm2, paddingHorizontal: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    height: 22, paddingHorizontal: space.sm2,
    /* iOS smooths the setback corners; a plain no-op elsewhere. */
    borderCurve: 'continuous',
  },
  emoji: { fontSize: 13, lineHeight: 16 },
  quickBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.xxs,
    paddingHorizontal: space.xs2, paddingVertical: space.xs2,
    borderCurve: 'continuous',
  },
  quickCell: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
})
