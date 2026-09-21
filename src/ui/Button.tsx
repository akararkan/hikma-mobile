/* =========================================================
   Button — six variants, three sizes, one loading contract.

   Oxford plates (DESIGN.md §6): uniform friendly corners per
   size; on press the fill swaps to the pressed role (deeper
   on light, brighter on dark) and the plate scales quietly to
   0.98. The outer Touchable is the stationary hit target; the
   animated plate answers under the finger.

   The loading state keeps the button's width and CROSSFADES
   the label into a spinner rather than shrinking or swapping,
   because a button that resizes or flickers mid-tap moves the
   thing under the user's finger. `loading` also implies
   disabled: every screen that forgot that check shipped a
   double-submit.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  FadeIn, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { Text, NumericText } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable, seat, type HapticKind } from './Touchable'
import { Spinner } from './State'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, setback, shape, space } from '@/theme/tokens'

/* The press value is driven by Touchable's `seat`, so the plate here and the
   seat inside the primitive ride ONE masonry curve from one place — this
   file no longer keeps a second bezier of its own. */

export type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger' | 'scholar' | 'onDark' | 'paper'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  label?: string
  onPress?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconEnd?: IconName
  loading?: boolean
  disabled?: boolean
  /** Stretch to the container. Auth screens and sheets want this. */
  block?: boolean
  haptic?: HapticKind
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  accessibilityLabel?: string
}

/* DESIGN.md §6: heights unchanged — sm 32 / md 40 / lg 48 — but the corners
   are THE SETBACK per size (buttonSm 8/2 · buttonMd 10/3 · buttonLg 12/4):
   crowned top, rooted bottom. Buttons are ziggurat tiers, never pills.
   Labels ride Vazirmatn 600 at subhead/callout/headline by size (the weight
   is passed to Text below; the family resolves in the primitive). */
const SIZES: Record<ButtonSize, {
  h: number; px: number; gap: number; icon: number
  set: { top: number; bottom: number }
  variant: 'callout' | 'headline' | 'subhead'
}> = {
  sm: { h: 32, px: 14, gap: space.xs2, icon: 16, set: shape.buttonSm, variant: 'subhead' },
  md: { h: 40, px: 18, gap: space.sm, icon: 18, set: shape.buttonMd, variant: 'callout' },
  lg: { h: 48, px: 24, gap: space.sm2, icon: 20, set: shape.buttonLg, variant: 'headline' },
}

export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, iconEnd,
  loading = false, disabled = false, block = false, haptic = 'light',
  style, children, accessibilityLabel,
}: ButtonProps) {
  const t = useTheme()
  const c = t.colors
  const s = SIZES[size]
  const off = disabled || loading

  const skin = ((): {
    bg: string; bgPressed: string; fg: string; plate: boolean
    border?: string; borderPressed?: string
  } => {
    switch (variant) {
      case 'primary':
        return { bg: c.accent, bgPressed: c.accentPressed, fg: c.textOnAccent, plate: true }
      case 'danger':
        return { bg: c.danger, bgPressed: c.dangerPressed, fg: c.textOnDanger, plate: true }
      /* Scholarly emphasis — Oxford Blue seniority via the palette roles. */
      case 'scholar':
        return { bg: c.scholar, bgPressed: c.accentPressed, fg: c.textOnScholar, plate: true }
      /* THE ox.ac.uk PATTERN (DESIGN.md §6): on a dark plate the action is
         the BRIGHT thing — cerulean carrying Oxford Blue ink (8.6:1). A navy
         button on a navy card is invisible; that failure mode is why this
         variant exists. Never place it on a light ground (1.9:1). */
      case 'onDark':
        return { bg: c.cta, bgPressed: c.ctaPressed, fg: c.textOnCta, plate: true }
      /* PAPER ON NIGHT — a white plate carrying Oxford ink (15.4:1), for the
         forward action on dark-by-design stages (camera, reel editor). It is
         scheme-fixed like the overlay roles: the stage under it is black in
         both schemes, so the ramp steps are the palette here, not a raw-hex
         leak. Pressing dims to the off-white step — deeper on light ground,
         same law as every plate. Never place it on paper: white on white. */
      case 'paper':
        return { bg: ramp.slate[0], bgPressed: ramp.slate[100], fg: ramp.brand[900], plate: true }
      /* White fill + stone outline, ink label; the outline turns link blue
         under pressure — the web's secondary-button hover. */
      case 'secondary':
        return {
          bg: c.surface, bgPressed: c.surface, fg: c.text,
          border: c.borderStrong, borderPressed: c.link, plate: true,
        }
      /* Legacy variant — predates QELAT, kept for its call sites. There is
         no pressed role for accentSoft, so it letterpresses on the drop
         alone. */
      case 'tinted':
        return { bg: c.accentSoft, bgPressed: c.accentSoft, fg: c.accentText, plate: true }
      /* Not a plate, so no letterpress drop: pressing paints the
         accentSofter wash behind the label. */
      case 'ghost':
        return { bg: 'transparent', bgPressed: c.accentSofter, fg: c.accentText, plate: false }
    }
  })()

  /* Oxford press (DESIGN.md §7): pressed-role fill swap + a quiet 0.98
     scale. t.ms() zeroes the duration under reduced motion, so the press
     degrades to a clean cut. */
  const pressed = useSharedValue(0)
  const dur = t.ms(t.motion.instant)
  const pressAnim = useAnimatedStyle(() => ({
    transform: [{ scale: skin.plate ? 1 - pressed.value * 0.02 : 1 }],
    backgroundColor: interpolateColor(pressed.value, [0, 1], [skin.bg, skin.bgPressed]),
    ...(skin.border && skin.borderPressed
      ? { borderColor: interpolateColor(pressed.value, [0, 1], [skin.border, skin.borderPressed]) }
      : null),
  }))

  /* Held stable: with `feedback="none"` Touchable hands these straight to a
     plain Pressable, so a fresh arrow per render would churn its props. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  const seatIn = React.useCallback(() => { seat(pressed, 1, dur) }, [dur])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  const seatOut = React.useCallback(() => { seat(pressed, 0, dur) }, [dur])

  /* BUSY CROSSFADE — the label fades down as the spinner fades up, one
     t.ms()'d fast fade each way (reduced motion cuts). The content row
     stays mounted at opacity 0, so the plate never resizes mid-flight and
     the width contract above holds for icons and children too. */
  const busy = useSharedValue(loading ? 1 : 0)
  const fadeMs = t.ms(t.motion.fast)
  React.useEffect(() => {
    busy.value = withTiming(loading ? 1 : 0, { duration: fadeMs })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  }, [loading, fadeMs])
  const contentFade = useAnimatedStyle(() => ({ opacity: 1 - busy.value }))

  return (
    <Touchable
      onPress={onPress}
      disabled={off}
      haptic={off ? false : haptic}
      feedback="none"
      onPressIn={seatIn}
      onPressOut={seatOut}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: loading }}
      /* BUSY IS NOT DEAD. `off` blocks the press for both states, but only a
         truly disabled button wears `alpha.disabled` — a submitting one must
         stay at full ink or its own spinner (which wears the label colour)
         renders at 38% over the accent plate and reads as broken. So the
         primitive's wash is waived and the opacity is owned here, where
         `loading` and `disabled` are still distinguishable. */
      noDisabledDim
      style={[
        {
          height: s.h,
          alignSelf: block ? 'stretch' : 'flex-start',
          opacity: disabled && !loading ? t.alpha.disabled : 1,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.plate,
          {
            height: s.h,
            paddingHorizontal: s.px,
            gap: s.gap,
            ...setback(s.set),
            borderCurve: 'continuous' as const,   /* iOS; inert on Android */
            borderWidth: skin.border ? t.rule.control : 0,
          },
          pressAnim,
        ]}
      >
        <Animated.View style={[styles.content, { gap: s.gap }, contentFade]}>
          {icon ? <Icon name={icon} size={s.icon} color={skin.fg} /> : null}
          {label ? (
            <Text variant={s.variant} weight="600" color={skin.fg} align="ui" numberOfLines={1}>{label}</Text>
          ) : null}
          {children}
          {iconEnd ? <Icon name={iconEnd} size={s.icon} color={skin.fg} /> : null}
        </Animated.View>
        {loading ? (
          /* The spinner rides its own fade over the dimming label — a
             crossfade, never a swap, so submit never flickers. It wears
             the label ink. */
          <Animated.View
            pointerEvents="none"
            entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(fadeMs)}
            exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(fadeMs)}
            style={[StyleSheet.absoluteFill, styles.fill]}
          >
            <Spinner color={skin.fg} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   IconButton — a circular tap target with no label. Used in
   every header and every action rail.

   DESIGN.md §6: a 36pt circle (the default 22pt icon + 14),
   grown to the 44pt minimum by Touchable's auto hit-slop. No
   plate at rest; pressing paints the accentSofter wash and
   scales to 0.92 — icons are the ONE thing in QELAT that
   scales; plates letterpress instead. Interactive ink is
   accentText, passive is textMuted; on-media variants keep
   the overlayChip plate + overlayText.
   --------------------------------------------------------- */

export interface IconButtonProps {
  name: IconName
  onPress?: () => void
  onLongPress?: () => void
  size?: number
  color?: string
  filled?: boolean
  /** Draw a circular backing — needed over imagery and in headers with art. */
  surface?: 'none' | 'soft' | 'solid' | 'overlay'
  disabled?: boolean
  haptic?: HapticKind
  badge?: number | string | null
  accessibilityLabel: string
  style?: StyleProp<ViewStyle>
}

export function IconButton({
  name, onPress, onLongPress, size = 22, color, filled, surface = 'none',
  disabled, haptic = 'light', badge, accessibilityLabel, style,
}: IconButtonProps) {
  const t = useTheme()
  const c = t.colors
  const box = size + 14

  const bg =
    /* `soft` is the accent WASH, not the sunken grey — a grey circle on the
       white header read as disabled; the quiet blue wash is what makes an
       icon button legible as a button at rest (§6). */
    surface === 'soft' ? c.accentSoft
      : surface === 'solid' ? c.surfaceRaised
        : surface === 'overlay' ? c.overlayChip
          : 'transparent'
  /* The pressed wash replaces the ground only where there is no plate at
     rest; the backed variants keep their plate and answer with scale alone. */
  const bgPressed = surface === 'none' ? c.accentSofter : bg

  const interactive = !!(onPress || onLongPress)
  const fg = color ?? (
    surface === 'overlay' ? c.overlayText
      : interactive ? c.accentText
        : c.textMuted
  )

  const pressed = useSharedValue(0)
  const dur = t.ms(t.motion.instant)
  const pressAnim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
    backgroundColor: interpolateColor(pressed.value, [0, 1], [bg, bgPressed]),
  }))

  /* Held stable — see the note in Button. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  const seatIn = React.useCallback(() => { seat(pressed, 1, dur) }, [dur])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable
  const seatOut = React.useCallback(() => { seat(pressed, 0, dur) }, [dur])

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      haptic={disabled ? false : haptic}
      feedback="none"
      onPressIn={seatIn}
      onPressOut={seatOut}
      /* An accessible Pressable's label REPLACES its subtree, so the badge's
         NumericText is never read on its own — fold the count into the label
         or the one number this button carries is invisible (the same rule
         TabBar's items follow). */
      accessibilityLabel={badge != null && badge !== '' && badge !== 0
        ? `${accessibilityLabel}, ${typeof badge === 'number' && badge > 99 ? '99+' : badge} unread`
        : accessibilityLabel}
      /* Pinned to the circle's box — see the Button note above. */
      style={[styles.center, { width: box, height: box }, style]}
    >
      <Animated.View
        style={[
          styles.center,
          /* A true circle — faces and icon washes are the round things;
             the pill radius stays reserved for counters and LIVE. */
          { width: box, height: box, borderRadius: box / 2 },
          pressAnim,
        ]}
      >
        <Icon name={name} size={size} color={fg} filled={filled} />
        {badge != null && badge !== '' && badge !== 0 ? (
          /* The unread badge — one of the two sanctioned pills: danger fill,
             micro tabular figures, 2px bg ring. */
          <View style={[styles.badge, { backgroundColor: c.danger, borderColor: c.bg }]}>
            <NumericText variant="micro" color={c.textOnDanger} align="center" numberOfLines={1}>
              {typeof badge === 'number' && badge > 99 ? '99+' : String(badge)}
            </NumericText>
          </View>
        ) : null}
      </Animated.View>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    /* No overflow:'hidden' — nothing inside can bleed (the spinner is a
       centered dot), and clipping would shave the secondary outline on the
       tight bottom corners. */
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    end: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
