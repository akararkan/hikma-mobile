/* =========================================================
   PostActions — the like / comment / share / save bar.

   Two variants over one geometry:
     post     four live controls, optimistic and haptic. With
              `labels` (the feed plate) they are four EQUAL
              cells carrying a glyph and its word — a bar that
              can be operated without being learned first, and
              the counts live in the ledger above it. Without
              `labels` they are content-packed chips (the web's
              .pca: 38pt, r-sm corners) that print their own
              counts, with save pushed to the far end. Liked
              wears the rose like-heart, saved fills the Oxford
              navy, in both dresses.
     channel  three read-only counters (views / forwards /
              comments). A channel post has no likes and no
              saves — reactions happen inside the channel — so
              the affordances are absent rather than disabled.

   The heart's and bookmark's pops are springs on the icon
   alone: animating the row would shift the counters. The
   counter itself ticks — old figure sliding out up, new in
   from below — but only on the ±1 step a press produces, so
   the wholesale jump of a recycled feed row stays a cut.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable, fireHaptic, formatCount, type HapticKind, type IconName } from '@/ui'

export interface PostActionsProps {
  liked?: boolean
  saved?: boolean
  likes?: number
  comments?: number
  shares?: number
  views?: number
  /** Moderation hold and offline both drop the bar to a readable ghost. */
  disabled?: boolean
  /** The feed plate's bar: equal cells, glyph + word, no counts. */
  labels?: boolean
  variant?: 'post' | 'channel'
  /** `overlay` is the fixed white-on-imagery palette — the media viewer. */
  tone?: 'default' | 'overlay'
  /** Detail screens run at 24px icons and a taller bar. */
  size?: 'md' | 'lg'
  onLike?: () => void
  onComment?: () => void
  onShare?: () => void
  onSave?: () => void
  onSaveLongPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function PostActions({
  liked, saved, likes = 0, comments = 0, shares = 0, views = 0,
  disabled, labels, variant = 'post', tone = 'default', size = 'md',
  onLike, onComment, onShare, onSave, onSaveLongPress, style,
}: PostActionsProps) {
  const t = useTheme()
  const c = t.colors
  const glyph = size === 'lg' ? 24 : 20
  const height = size === 'lg' ? 52 : 44
  /* On imagery the muted text role is unreadable in light mode, so the whole
     bar switches to the fixed overlay palette rather than being tinted. */
  const idle = tone === 'overlay' ? c.overlayText : c.textSecondary
  const heartIdle = tone === 'overlay' ? c.overlayText : c.textMuted
  const on = tone === 'overlay' ? c.overlayText : c.like
  const savedTint = tone === 'overlay' ? c.overlayText : c.accent

  /* The .pca chip, scaled up on the detail screen. */
  const chip: StyleProp<ViewStyle> = [
    styles.chip,
    { height: size === 'lg' ? 44 : 38, paddingHorizontal: size === 'lg' ? 15 : 13, borderRadius: t.radius.sm },
  ]

  const pop = useSharedValue(1)
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }))

  /* The pop rides the LIKED TRANSITION, not the press: a double-tap on the
     media likes this post without ever touching the bar, and the heart used
     to just swap `filled` there. One trigger covers press, double-tap and
     any other path — and only the turning-ON edge celebrates. */
  const prevLiked = React.useRef(!!liked)
  React.useEffect(() => {
    if (prevLiked.current === !!liked) return
    prevLiked.current = !!liked
    if (!liked || t.prefs.reducedMotion) return
    pop.value = withSequence(
      withTiming(0.8, { duration: t.ms(90) }),
      withSpring(1.25, t.motion.spring),
      withSpring(1, t.motion.spring),
    )
  }, [liked, pop, t])

  const like = () => {
    if (disabled) return
    fireHaptic('light')
    onLike?.()
  }

  /* The bookmark confirms the same way the heart does — dip, overshoot,
     settle — one shared value per icon so a like never wobbles the save. */
  const savePop = useSharedValue(1)
  const saveStyle = useAnimatedStyle(() => ({ transform: [{ scale: savePop.value }] }))

  const save = () => {
    if (disabled) return
    if (!t.prefs.reducedMotion) {
      savePop.value = withSequence(
        withTiming(0.8, { duration: t.ms(90) }),
        withSpring(1.25, t.motion.spring),
        withSpring(1, t.motion.spring),
      )
    }
    onSave?.()
  }

  /* The web's .pc-actions row carries no rule of its own — the stats strip
     above it does. The channel counters keep theirs: nothing else separates
     them from the broadcast body. */
  const frame: StyleProp<ViewStyle> = [
    styles.bar,
    { height },
    variant === 'channel' && tone !== 'overlay'
      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }
      : null,
    disabled ? { opacity: 0.4 } : null,
    style,
  ]

  if (variant === 'channel') {
    return (
      <View style={frame} pointerEvents={disabled ? 'none' : 'auto'}>
        <Counter icon="eye" label={views} color={idle} size={glyph} accessibilityLabel={`${views} views`} />
        <Counter icon="forwardMsg" label={shares} color={idle} size={glyph} accessibilityLabel={`${shares} forwards`} />
        <Counter icon="comment" label={comments} color={idle} size={glyph} accessibilityLabel={`${comments} comments`} />
      </View>
    )
  }

  /* THE LABELLED BAR — the feed plate's dress. Four EQUAL cells, each a
     glyph and its word, so the row is operable on sight instead of by
     memory. The counts are deliberately absent: they are printed once, in
     the ledger above, and a figure that appears twice on one card invites
     the reader to check whether the two agree.

     The words stand down above a 1.2 font scale. Four of them wrapped is not
     a bar, and every cell carries the same meaning in its accessibility
     label either way — which is the only reason the words are allowed to
     leave at all. */
  if (labels) {
    const words = t.prefs.fontScale <= 1.2
    return (
      <View style={frame} pointerEvents={disabled ? 'none' : 'auto'}>
        <Cell
          icon="heart"
          filled={!!liked}
          word={words ? (liked ? 'Liked' : 'Like') : null}
          color={liked ? on : idle}
          size={glyph}
          anim={heartStyle}
          onPress={like}
          accessibilityLabel={liked ? 'Unlike' : 'Like'}
          accessibilityState={{ selected: !!liked }}
        />
        <Cell
          icon="comment"
          word={words ? 'Comment' : null}
          color={idle}
          size={glyph}
          onPress={onComment}
          accessibilityLabel="Comments"
        />
        <Cell
          icon="share"
          word={words ? 'Share' : null}
          color={idle}
          size={glyph}
          onPress={onShare}
          accessibilityLabel="Share"
        />
        <Cell
          icon="bookmark"
          filled={!!saved}
          word={words ? (saved ? 'Saved' : 'Save') : null}
          color={saved ? savedTint : idle}
          size={glyph}
          anim={saveStyle}
          haptic="light"
          onPress={onSave ? save : undefined}
          onLongPress={onSaveLongPress}
          accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
          accessibilityState={{ selected: !!saved }}
        />
      </View>
    )
  }

  return (
    <View style={frame} pointerEvents={disabled ? 'none' : 'auto'}>
      <Action
        onPress={like}
        accessibilityLabel={liked ? 'Unlike' : 'Like'}
        accessibilityState={{ selected: !!liked }}
        style={chip}
      >
        <Animated.View style={heartStyle}>
          <Icon name="heart" size={glyph} filled={!!liked} color={liked ? on : heartIdle} />
        </Animated.View>
        <Count value={likes} color={liked ? on : idle} />
      </Action>

      <Action onPress={onComment} accessibilityLabel="Comments" style={chip}>
        <Icon name="comment" size={glyph} color={idle} />
        <Count value={comments} color={idle} />
      </Action>

      <Action onPress={onShare} accessibilityLabel="Share" style={chip}>
        <Icon name="share" size={glyph} color={idle} />
        <Count value={shares} color={idle} />
      </Action>

      <Touchable
        onPress={onSave ? save : undefined}
        onLongPress={onSaveLongPress}
        feedback="scale"
        haptic="light"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
        accessibilityState={{ selected: !!saved }}
        style={[chip, styles.end]}
      >
        <Animated.View style={saveStyle}>
          <Icon name="bookmark" size={glyph} filled={!!saved} color={saved ? savedTint : idle} />
        </Animated.View>
      </Touchable>
    </View>
  )
}

function Action({
  onPress, children, accessibilityLabel, accessibilityState, style,
}: {
  onPress?: () => void
  children: React.ReactNode
  accessibilityLabel: string
  accessibilityState?: { selected?: boolean }
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Touchable
      onPress={onPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={style}
    >
      {children}
    </Touchable>
  )
}

/* One cell of the labelled bar. `anim` is the owner's spring (the heart and
   the bookmark have one; comment and share do not) — an undefined style on
   an Animated.View is inert, so all four share this body. */
function Cell({
  icon, word, filled, color, size, anim, haptic = false, onPress, onLongPress,
  accessibilityLabel, accessibilityState,
}: {
  icon: IconName
  word: string | null
  filled?: boolean
  color: string
  size: number
  anim?: any
  haptic?: HapticKind
  onPress?: () => void
  onLongPress?: () => void
  accessibilityLabel: string
  accessibilityState?: { selected?: boolean }
}) {
  const t = useTheme()
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="tint"
      haptic={haptic}
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={[styles.cell, { borderRadius: t.radius.xs }]}
    >
      <Animated.View style={anim}>
        <Icon name={icon} size={size} color={color} filled={filled} />
      </Animated.View>
      {word ? (
        <Text variant="footnote" weight="600" color={color} numberOfLines={1}>{word}</Text>
      ) : null}
    </Touchable>
  )
}

/** Exported for the feed plate's ledger: the same ±1 tick the chip bar and
 *  the reel rail confirm with, so a like on the home feed no longer snaps
 *  its number while every other surface animates. */
export function Count({ value, color, weight = '600' }: { value: number; color: string; weight?: '400' | '500' | '600' }) {
  const t = useTheme()
  /* The tick. A press moves the figure by exactly one, and only that step
     animates — old figure out up, new in from below over `fast`. Anything
     else (a recycled row handed a different post, a server refresh landing
     a bigger delta) is not a confirm and cuts. Tabular figures mean the
     two layers share a width, so nothing beside them jitters. */
  const prev = React.useRef(value)
  const [ghost, setGhost] = React.useState<string | null>(null)
  const tick = useSharedValue(1)

  React.useEffect(() => {
    const before = prev.current
    prev.current = value
    if (value === before) return
    if (t.prefs.reducedMotion || Math.abs(value - before) !== 1 || value === 0) return
    setGhost(before > 0 ? formatCount(before) : null)
    tick.value = 0
    tick.value = withTiming(1, { duration: t.ms(t.motion.fast) })
    const id = setTimeout(() => setGhost(null), t.motion.fast + 40)
    return () => clearTimeout(id)
  }, [value])   // eslint-disable-line react-hooks/exhaustive-deps

  const inStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ translateY: (1 - tick.value) * 7 }],
  }))
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - tick.value,
    transform: [{ translateY: tick.value * -7 }],
  }))

  if (!value) return null
  return (
    <View>
      <Animated.View style={inStyle}>
        {/* The web's .pca label weight — 600 over the footnote size; the
            ledger passes 400 to keep its own voice. */}
        <NumericText variant="footnote" weight={weight} color={color}>{formatCount(value)}</NumericText>
      </Animated.View>
      {ghost != null ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outStyle]}>
          <NumericText variant="footnote" weight={weight} color={color}>{ghost}</NumericText>
        </Animated.View>
      ) : null}
    </View>
  )
}

function Counter({
  icon, label, color, size, accessibilityLabel,
}: { icon: IconName; label: number; color: string; size: number; accessibilityLabel: string }) {
  return (
    <View style={styles.action} accessible accessibilityLabel={accessibilityLabel}>
      <Icon name={icon} size={size} color={color} />
      <NumericText variant="footnote" color={color}>{formatCount(label)}</NumericText>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* A labelled cell takes an equal quarter of the bar and centres its pair;
     `alignSelf: stretch` is what gives the ripple the full 44pt to fill. */
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
  },
  end: { marginStart: 'auto' },
  /* The channel counters keep the old spread — three ledger figures, not
     four tappable chips. */
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch' },
})
