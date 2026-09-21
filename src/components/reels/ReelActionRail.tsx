/* =========================================================
   The right-hand column.

   Every glyph carries a text shadow: this rail floats over
   arbitrary video, and a white icon on a white frame is
   invisible exactly when someone is trying to tap it.

   PLACEMENT IS THE PARENT'S. This root is an ordinary in-flow
   column with a real height — the card anchors it with an
   absolute wrapper. It was absolute here once, inside an
   absolute wrapper that had no height, which laid the whole
   rail out BELOW the screen: an absolute only-child
   contributes nothing to its parent's auto height, and Yoga
   then places an absolute child with neither `top` nor
   `bottom` at its static position (the parent's top edge) and
   grows it downward. Never re-introduce `position:'absolute'`
   here — a child drawn outside its parent's box is untappable
   on Android even when it renders on iOS.

   `disabled` is not cosmetic — a reel held for review has its
   engagement affordances switched off (errors §2.8a), because
   the post is not visible to anyone else yet and a like it
   cannot receive is a lie.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { Avatar, Icon, NumericText, Touchable, fireHaptic, formatCount } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { STAGE, TEXT_SHADOW_STRONG } from './skin'
import type { ReelAuthor } from './types'

const LIKED = STAGE.like

export interface ReelActionRailProps {
  likes: number
  comments: number
  shares: number
  saves: number
  liked: boolean
  saved: boolean
  author: ReelAuthor
  /** null = unknown (not signed in, or the status read has not landed). */
  isFollowing: boolean | null
  disabled?: boolean
  onLike: () => void
  onComment: () => void
  onShare: () => void
  onSave: () => void
  onMore: () => void
  onAuthor: () => void
  onFollow: () => void
}

function RailButton({
  icon, filled, color, size, count, label, disabled, onPress,
}: {
  icon: any
  filled?: boolean
  color?: string
  size: number
  count?: number
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  const t = useTheme()
  const pop = useSharedValue(0)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value }] }))

  const press = () => {
    /* Pop to ~1.22 and settle on the house spring; reduced motion cuts and
       lets the fill/count change carry the confirm. */
    if (!t.prefs.reducedMotion) {
      pop.value = withSequence(withTiming(0.22, { duration: t.ms(90) }), withSpring(0, t.motion.spring))
    }
    onPress()
  }

  return (
    <Touchable
      onPress={press}
      disabled={disabled}
      feedback="none"
      haptic="light"
      noAutoHitSlop
      accessibilityLabel={label}
      style={styles.item}
    >
      <Animated.View style={anim}>
        <Icon name={icon} size={size} color={color ?? '#FFFFFF'} filled={filled} style={styles.glyph} />
      </Animated.View>
      {count != null ? <RailCount count={count} /> : null}
    </Touchable>
  )
}

/* The counter under the glyph ticks when a press moves it — old figure out
   up, new in from below. Only the ±1 step animates: the pager recycles this
   cell onto a different reel, and that wholesale jump has to stay a cut. */
function RailCount({ count }: { count: number }) {
  const t = useTheme()
  const prev = React.useRef(count)
  const [ghost, setGhost] = React.useState<string | null>(null)
  const tick = useSharedValue(1)

  React.useEffect(() => {
    const before = prev.current
    prev.current = count
    if (count === before) return
    if (t.prefs.reducedMotion || Math.abs(count - before) !== 1) return
    setGhost(formatCount(before))
    tick.value = 0
    tick.value = withTiming(1, { duration: t.ms(t.motion.fast) })
    const id = setTimeout(() => setGhost(null), t.motion.fast + 40)
    return () => clearTimeout(id)
  }, [count])   // eslint-disable-line react-hooks/exhaustive-deps

  const inStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ translateY: (1 - tick.value) * 6 }],
  }))
  const outStyle = useAnimatedStyle(() => ({
    opacity: 1 - tick.value,
    transform: [{ translateY: tick.value * -6 }],
  }))

  return (
    <View>
      <Animated.View style={inStyle}>
        <NumericText variant="caption" color="rgba(255,255,255,0.94)" align="center" style={styles.count}>
          {formatCount(count)}
        </NumericText>
      </Animated.View>
      {ghost != null ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outStyle]}>
          <NumericText variant="caption" color="rgba(255,255,255,0.94)" align="center" style={styles.count}>
            {ghost}
          </NumericText>
        </Animated.View>
      ) : null}
    </View>
  )
}

export function ReelActionRail({
  likes, comments, shares, saves, liked, saved, author, isFollowing, disabled,
  onLike, onComment, onShare, onSave, onMore, onAuthor, onFollow,
}: ReelActionRailProps) {
  const t = useTheme()

  return (
    <View style={styles.rail} pointerEvents="box-none">
      <View style={styles.avatarWrap}>
        <Avatar
          uri={author.profileImage}
          name={author.full}
          seed={author.id}
          size={46}
          onPress={onAuthor}
          accessibilityLabel={`${author.handle}'s profile`}
        />
        {isFollowing === false ? (
          <Touchable
            onPress={() => { fireHaptic('light'); onFollow() }}
            feedback="scale"
            hitSlop={13}
            accessibilityLabel={`Follow ${author.handle}`}
            /* Over a frame, not over paper: the navy plus was a dark disc on
               dark video. Cerulean with navy ink is the on-dark pairing. */
            style={[styles.plus, { backgroundColor: t.colors.cta }]}
          >
            <Icon name="add" size={13} color={t.colors.textOnCta} />
          </Touchable>
        ) : null}
      </View>

      <RailButton
        icon="heart"
        filled={liked}
        color={liked ? LIKED : '#FFFFFF'}
        size={30}
        count={likes}
        label={liked ? 'Unlike' : 'Like'}
        disabled={disabled}
        onPress={onLike}
      />
      <RailButton icon="comment" size={29} count={comments} label="Comments" disabled={disabled} onPress={onComment} />
      <RailButton
        icon="bookmark"
        filled={saved}
        size={28}
        count={saves}
        label={saved ? 'Remove from saved' : 'Save'}
        disabled={disabled}
        onPress={onSave}
      />
      <RailButton icon="share" size={28} count={shares} label="Share" disabled={disabled} onPress={onShare} />
      <RailButton icon="more" size={24} label="More" onPress={onMore} />
    </View>
  )
}

const styles = StyleSheet.create({
  /* In flow, so the column has a real height inside the card's wrapper. */
  rail: { width: 64, alignItems: 'center', gap: space.lg2 },
  /* The badge hangs off the avatar's bottom edge, so the box has to be tall
     enough to contain it — a child outside its parent's bounds gets no touches
     on Android. */
  avatarWrap: { alignItems: 'center', paddingBottom: space.sm2, marginBottom: space.xs },
  plus: {
    position: 'absolute',
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  item: { alignItems: 'center', gap: space.xs, minWidth: 48 },
  /* The rail's top half clears the bottom scrim on a tall phone, so the
     legibility here is the strong shadow, not the gradient. */
  glyph: TEXT_SHADOW_STRONG,
  count: TEXT_SHADOW_STRONG,
})
