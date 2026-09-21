/* =========================================================
   Screen chrome — the header, the safe-area frame, the
   segmented control and the top tab bar.

   expo-router's own header is not used anywhere in this app.
   Almost every screen here needs something the stock header
   cannot do — an avatar and a presence line in the title, a
   trailing row of three icon buttons, a live-count badge — so
   there is one header component and `headerShown: false`
   throughout. One header beats a stock one plus twenty
   overrides.

   QELAT chrome (DESIGN.md §6): the header is a solid
   `headerBg` plate — never blurred, never shadowed. Its
   bottom edge is the drawn DOUBLE RULE; the large-title
   variant carries the WARP RULE and may lay the brick course
   behind itself. Depth is line-work, not elevation.
   ========================================================= */
import React from 'react'
import {
  RefreshControl, ScrollView, StyleSheet, View,
  type ScrollViewProps, type StyleProp, type ViewStyle,
} from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { contentClamp, motion, setback, space } from '@/theme/tokens'
import { Text } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable } from './Touchable'
import { IconButton } from './Button'
import { Badge } from './Chip'
import { BrickCourse, DoubleRule, WarpRule } from './ornaments'

const masonry = Easing.bezier(...motion.out)

/* ---------------------------------------------------------
   Screen — the frame. Owns the background colour and the
   safe-area padding so no screen re-derives them. The ground
   is clay (`bg`); media containers letterbox on #000, never
   on the ground — clay casts photos.
   --------------------------------------------------------- */

export interface ScreenProps {
  children?: React.ReactNode
  /** `sunken` for grouped/settings screens, `plain` for feeds and readers. */
  background?: 'plain' | 'sunken' | 'elevated' | 'transparent'
  /** Which edges get safe-area padding. Bottom is off by default because
   *  tab screens get it from the tab bar and lists want to scroll under it. */
  edges?: ('top' | 'bottom')[]
  style?: StyleProp<ViewStyle>
}

export function Screen({ children, background = 'plain', edges = [], style }: ScreenProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const bg =
    background === 'sunken' ? t.colors.bgSunken
      : background === 'elevated' ? t.colors.bgElevated
        : background === 'transparent' ? 'transparent'
          : t.colors.bg
  return (
    <View
      style={[
        { flex: 1, backgroundColor: bg },
        edges.includes('top') ? { paddingTop: insets.top } : null,
        edges.includes('bottom') ? { paddingBottom: insets.bottom } : null,
        style,
      ]}
    >
      {children}
    </View>
  )
}

/* ---------------------------------------------------------
   Header.
   --------------------------------------------------------- */

export interface HeaderAction {
  icon: IconName
  onPress: () => void
  label: string
  badge?: number | null
  tone?: 'default' | 'accent' | 'danger'
  filled?: boolean
}

export interface HeaderProps {
  title?: string
  subtitle?: string
  /** Replaces the title block entirely — a conversation's avatar + name, a
   *  channel's identity row, a search field. */
  titleNode?: React.ReactNode
  back?: boolean | (() => void)
  /** A close × instead of a back chevron — for modally-presented screens. */
  closeButton?: boolean
  actions?: (HeaderAction | null | false)[]
  /** For content that scrolls beneath (pass `floating`). QELAT never blurs:
   *  the plate is the near-solid `headerBg` either way, so this is kept only
   *  so call sites need no edits. */
  translucent?: boolean
  floating?: boolean
  /** Show the DOUBLE RULE bottom edge — the drawn chrome line that replaced
   *  the hairline (and every shadow). Off for headers over media; callers
   *  that flip it on scroll offset get the scroll-past-8pt rule. Ignored
   *  when `large` is set — large headers take the rule from `collapsed`. */
  border?: boolean
  large?: boolean
  /** Large-title collapse (§6): at rest the large header carries the WARP
   *  RULE only. Callers flip this on scroll past 8pt — the large title folds
   *  away, the bar title takes over and the DOUBLE RULE lands on the edge. */
  collapsed?: boolean
  onTitlePress?: () => void
  /** For a header sitting on top of imagery: white glyphs, no background. */
  overlay?: boolean
  /** `soft` seats every trailing action on the quiet accent-wash circle —
   *  for root headers whose icons must read as buttons at a glance. */
  actionSurface?: 'none' | 'soft'
  style?: StyleProp<ViewStyle>
  /** A row rendered under the title — filter chips, a segmented control. */
  below?: React.ReactNode
}

export function Header({
  title, subtitle, titleNode, back, closeButton, actions = [],
  translucent = false, floating = false, border = true, large = false,
  collapsed = false, onTitlePress, overlay = false, actionSurface = 'none',
  style, below,
}: HeaderProps) {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const list = actions.filter(Boolean) as HeaderAction[]

  const fg = overlay ? c.overlayText : c.text
  const goBack = typeof back === 'function' ? back : () => { if (router.canGoBack()) router.back() }

  /* Large-title collapse: the display block stays MOUNTED and folds by
     height + opacity — unmounting it dropped the whole chrome by the block's
     height in one frame, mid-scroll, on every large-title screen. The inner
     block is never height-constrained, so its onLayout always reports the
     natural height; until the first report the wrapper stays 'auto' (screens
     start expanded — collapse is scroll-driven). t.ms() already turns the
     fold into a cut under reduced motion. Non-large headers never render the
     block, so nothing here moves for them.

     AND THIS ONE STAYS A HEIGHT — it is the exception, so do not convert it.
     The header is a FLOW sibling above the list on every large-title screen
     (`<Screen><Header/><FlashList/></Screen>`); the header's height is the
     only thing putting the list's first pixel where it is. A translateY would
     slide the block up behind the bar and leave the list exactly where it sat,
     which deletes the fold's whole purpose: the content is supposed to come
     WITH it. Buying the transform means making the header absolute and giving
     all nine of those screens a contentInset of the EXPANDED height plus a
     scroll range that no longer matches their content — a cross-file rewrite
     of the scroll contract, not a style change. What did leave is the work
     that bought nothing: `overflow` is a constant and belongs in a StyleSheet
     rather than being re-sent with every frame of the fold, and the fold no
     longer fires on mount (see below). */
  const largeH = useSharedValue(0)
  const largeOpen = useSharedValue(collapsed ? 0 : 1)
  const foldMs = t.ms(t.motion.fast)
  const folded = React.useRef(collapsed)
  React.useEffect(() => {
    /* Only on a CHANGE. This effect used to also fire on mount, spending
       150ms of animated height — Yoga, every frame, for the whole header
       subtree — folding `collapsed` to the identical `collapsed` while the
       push transition was still running. And it depended on the whole theme
       object, so any prefs or scheme change replayed that fold for free. */
    if (folded.current === collapsed) return
    folded.current = collapsed
    largeOpen.value = withTiming(collapsed ? 0 : 1, { duration: foldMs, easing: masonry })
  }, [collapsed, largeOpen, foldMs])
  const largeStyle = useAnimatedStyle(() => ({
    opacity: largeOpen.value,
    height: largeH.value > 0 ? largeH.value * largeOpen.value : ('auto' as const),
  }))

  const content = (
    <>
      <View style={[styles.bar, { height: t.layout.headerHeight, paddingHorizontal: space.xs2 }]}>
        {back || closeButton ? (
          /* IconButton, not a raw Touchable: icons answer presses with the
             0.92 scale + accentSofter wash (§6 IconButton) and wear the
             interactive accentText ink; over imagery they take the
             sanctioned overlayChip + overlayText treatment. */
          <IconButton
            name={closeButton ? 'close' : t.isRTL ? 'forward' : 'back'}
            onPress={goBack}
            accessibilityLabel={closeButton ? 'Close' : 'Go back'}
            size={closeButton ? 24 : 26}
            surface={overlay ? 'overlay' : 'none'}
          />
        ) : <View style={{ width: 8 }} />}

        <View style={styles.titleWrap}>
          {titleNode ?? (
            <Touchable
              onPress={onTitlePress}
              disabled={!onTitlePress}
              feedback={onTitlePress ? 'dim' : 'none'}
              noAutoHitSlop
              style={{ alignItems: 'stretch' }}
            >
              {/* Lora 700, start-aligned — the title reads as a running
                  head, not a centred caption. */}
              {title && (!large || collapsed) ? (
                <Text variant="headline" serif weight="700" align="ui" numberOfLines={1} color={fg}>{title}</Text>
              ) : null}
              {subtitle ? (
                <Text
                  variant="caption"
                  align="ui"
                  numberOfLines={1}
                  color={overlay ? c.overlayTextMuted : c.textMuted}
                  style={{ marginTop: space.xxs }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </Touchable>
          )}
        </View>

        <View style={styles.actions}>
          {list.map((a, i) => (
            /* Interactive header icons wear IconButton's accentText default
               (§6) — no ink override except danger; on-media headers take
               the overlay surface instead of a colour swap. */
            <IconButton
              key={i}
              name={a.icon}
              onPress={a.onPress}
              accessibilityLabel={a.label}
              badge={a.badge}
              filled={a.filled}
              size={22}
              surface={overlay ? 'overlay' : actionSurface}
              /* 'accent' = the full Oxford navy — the ACTIVE half of a toggle
                 pair (Saved's grid/list); default stays the link-blue
                 interactive ink, so the two states finally read apart. */
              color={a.tone === 'danger' ? c.danger : a.tone === 'accent' ? c.accent : undefined}
            />
          ))}
          {!list.length ? <View style={{ width: 8 }} /> : null}
        </View>
      </View>

      {large && title ? (
        <Animated.View style={[styles.largeFold, largeStyle]}>
          <View
            onLayout={e => { largeH.value = e.nativeEvent.layout.height }}
            style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm, paddingTop: space.xxs }}
          >
            <Text variant="display" align="ui" numberOfLines={1} color={fg}>{title}</Text>
            <WarpRule style={{ marginTop: space.xs2 }} />
          </View>
        </Animated.View>
      ) : null}

      {below}
    </>
  )

  const frame: StyleProp<ViewStyle> = [
    floating ? styles.floating : null,
    { paddingTop: insets.top, zIndex: t.zIndex.header },
    style,
  ]

  return (
    <View style={[frame, { backgroundColor: overlay ? 'transparent' : c.headerBg }]}>
      {/* Root (large) headers carry the brick-course band behind their
          content — one ground texture per screen lives here. */}
      {large && !overlay ? <BrickCourse /> : null}
      {content}
      {/* §6: the large variant carries the WARP RULE at rest; the DOUBLE RULE
          arrives only once the title has collapsed on scroll. */}
      {(large ? collapsed : border) && !overlay ? <DoubleRule /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   SegmentedControl — the two-to-four-way switch. Feed's
   For you / Following, the profile's grid tabs, search types.
   The track is a sunken setback well; one bordered `surface`
   thumb slides between cells on the masonry curve.
   --------------------------------------------------------- */

export interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; icon?: IconName; badge?: number }[]
  value: T
  onChange: (v: T) => void
  /** `pill` sits in a track (settings, filters); `underline` is a tab bar. */
  variant?: 'pill' | 'underline'
  scrollable?: boolean
  style?: StyleProp<ViewStyle>
}

export function SegmentedControl<T extends string>({
  options, value, onChange, variant = 'pill', scrollable = false, style,
}: SegmentedControlProps<T>) {
  const t = useTheme()
  const c = t.colors

  /* Thumb geometry comes from each cell's onLayout. Those x-coordinates are
     PHYSICAL, so the thumb positions with `left` + translateX deliberately —
     logical `start` would double-flip in RTL. Hidden until the active cell
     has reported once; first placement snaps, later ones slide. */
  const cells = React.useRef<Partial<Record<T, { x: number; width: number }>>>({}).current
  const valueRef = React.useRef(value)
  valueRef.current = value
  const thumbX = useSharedValue(0)
  const thumbW = useSharedValue(0)
  const thumbOn = useSharedValue(0)
  const lastW = React.useRef(-1)

  const placeThumb = React.useCallback((v: T, animate: boolean) => {
    const l = cells[v]
    if (!l) return
    const d = animate && thumbOn.value ? t.ms(t.motion.normal) : 0
    thumbX.value = d ? withTiming(l.x, { duration: d, easing: masonry }) : l.x
    /* The width stays a WIDTH — do not "optimise" it into a scaleX. The thumb
       wears setback(buttonSm) corners, and scaling a rounded rect on X pulls
       its caps into ovals; the setback is the shape here, not decoration. The
       clip-translate dodge does not apply either: this is a plate that MOVES
       between cells, not a fill that grows inside a fixed track, so there is
       nothing to clip it against. What we can do is not animate a layout prop
       that is not changing — every non-scrollable segmented control is
       `flex: 1` cells of identical width, so on those (which is nearly all of
       them) the thumb now slides on a transform alone and Yoga never wakes up.
       A direct assignment also cancels any in-flight width animation, which is
       what `duration: 0` was doing the long way round. */
    thumbW.value = d && l.width !== lastW.current
      ? withTiming(l.width, { duration: d, easing: masonry })
      : l.width
    lastW.current = l.width
    thumbOn.value = 1
  }, [cells, t, thumbX, thumbW, thumbOn])

  React.useEffect(() => { placeThumb(value, true) }, [value, placeThumb])

  /* TWO animated styles on one view, on purpose: a useAnimatedStyle only
     re-runs when the shared values IT reads are written. Keeping `width` in
     the same object as the sliding translateX re-committed the width on every
     frame of every slide — a layout prop, re-sent 14 times for a number that
     had not moved. Split, the slide is pure compositor work. */
  const thumbSlide = useAnimatedStyle(() => ({
    opacity: thumbOn.value,
    transform: [{ translateX: thumbX.value }],
  }))
  const thumbSize = useAnimatedStyle(() => ({ width: thumbW.value }))

  const segments = options.map(o => {
    const active = o.value === value
    if (variant === 'underline') {
      return (
        <Touchable
          key={o.value}
          onPress={() => onChange(o.value)}
          feedback="dim"
          haptic="select"
          noAutoHitSlop
          /* "tab", not "button": both platforms then announce position-in-set
             alongside `selected` (the TabBar rule). */
          accessibilityRole="tab"
          accessibilityState={{ selected: active }}
          style={[
            styles.tab,
            scrollable ? { paddingHorizontal: space.lg } : { flex: 1 },
            { borderBottomColor: active ? c.accent : 'transparent' },
          ]}
        >
          {o.icon ? <Icon name={o.icon} size={17} color={active ? c.text : c.textMuted} filled={active} /> : null}
          <Text
            variant="subhead"
            weight={active ? '700' : '500'}
            tone={active ? 'default' : 'muted'}
            numberOfLines={1}
            align="center"
          >
            {o.label}
          </Text>
          {o.badge ? (
            /* The shared unread-counter Badge (sanctioned pill #1) — the
               recipe stays single-sourced in Chip.tsx, never re-drawn here. */
            <Badge count={o.badge} />
          ) : null}
        </Touchable>
      )
    }
    return (
      <Touchable
        key={o.value}
        onPress={() => onChange(o.value)}
        feedback="none"
        haptic="select"
        noAutoHitSlop
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onLayout={e => {
          const { x, width } = e.nativeEvent.layout
          cells[o.value] = { x, width }
          if (o.value === valueRef.current) placeThumb(o.value, false)
        }}
        style={[
          styles.seg,
          { flex: scrollable ? undefined : 1, paddingHorizontal: scrollable ? 15 : 8 },
        ]}
      >
        {/* The thumb is the Oxford plate — the selection must be readable
            from arm's length, so the active cell wears on-accent ink over
            the sliding navy thumb; unselected cells stay muted. */}
        {o.icon ? <Icon name={o.icon} size={15} color={active ? c.textOnAccent : c.textMuted} filled={active} /> : null}
        <Text
          variant="subhead"
          weight={active ? '700' : '500'}
          color={active ? c.textOnAccent : undefined}
          tone={active ? undefined : 'muted'}
          numberOfLines={1}
          align="center"
        >
          {o.label}
        </Text>
      </Touchable>
    )
  })

  if (variant === 'underline') {
    const bar = (
      <View
        style={[
          styles.tabBar,
          scrollable ? null : { justifyContent: 'space-between' },
          { borderBottomColor: c.separator },
        ]}
      >
        {segments}
      </View>
    )
    if (!scrollable) return <View style={style}>{bar}</View>
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={{ minWidth: '100%' }}>
        {bar}
      </ScrollView>
    )
  }

  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: c.surfaceSunken,
          ...setback(t.shape.buttonMd),
          borderCurve: 'continuous' as const,
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            /* The Oxford plate, not a white card: white-on-white was the
               "which tab am I on?" complaint. Border matches the fill so the
               geometry stays identical to the old bordered thumb. */
            backgroundColor: c.accent,
            borderWidth: t.rule.course,
            borderColor: c.accent,
            ...setback(t.shape.buttonSm),
            borderCurve: 'continuous' as const,
          },
          thumbSize,
          thumbSlide,
        ]}
      />
      {segments}
    </View>
  )
}

/* ---------------------------------------------------------
   RefreshableScroll — a ScrollView pre-wired with the app's
   refresh control colours. Lists use FlashList; static
   screens use this.

   KEYBOARD-AWARE, not RN's ScrollView: RN does not scroll a
   focused TextInput into view on iOS, and under Android
   edge-to-edge `adjustResize` no longer resizes the root — so
   a Field near the end of a long static screen (the "type
   @handle to confirm" on account deletion, the Save under
   live/manage) sat UNDER the keyboard with nothing left to
   scroll. KeyboardProvider is already mounted in _layout, so
   this is a drop-in. Horizontal rails opt out: a code-block
   scroller has no keyboard contract and the avoidance maths
   is vertical.
   --------------------------------------------------------- */

export function ScreenScroll({
  children, refreshing, onRefresh, contentContainerStyle, bottomOffset = 24, ...rest
}: ScrollViewProps & { refreshing?: boolean; onRefresh?: () => void; bottomOffset?: number }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  /* Spread into both branches rather than picking a component in a variable:
     one union-typed element loses prop checking for every call site. */
  const common: ScrollViewProps = {
    keyboardShouldPersistTaps: 'handled',
    showsVerticalScrollIndicator: false,
    /* `contentClamp` first so a caller's own contentContainerStyle can still
       override it. A no-op on every phone — 720pt only binds on a tablet or an
       unfolded foldable, where a full-bleed settings list otherwise runs its
       rows the whole width of the slab. */
    contentContainerStyle: [contentClamp, { paddingBottom: insets.bottom + space.xxl + space.xs }, contentContainerStyle],
    refreshControl: onRefresh ? (
      <RefreshControl
        refreshing={!!refreshing}
        onRefresh={onRefresh}
        tintColor={t.colors.textMuted}
        colors={[t.colors.accent]}
        progressBackgroundColor={t.colors.surface}
      />
    ) : undefined,
  }
  if (rest.horizontal) {
    return <ScrollView {...common} {...rest}>{children}</ScrollView>
  }
  return (
    <KeyboardAwareScrollView bottomOffset={bottomOffset} {...common} {...rest}>
      {children}
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center' },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  floating: { position: 'absolute', top: 0, left: 0, right: 0 },
  /* The fold's clip. Constant, so it never rides an animated frame. */
  largeFold: { overflow: 'hidden' },
  track: { flexDirection: 'row', padding: space.xs, gap: space.xs },
  seg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, height: 34 },
  /* Physical `left`: positioned from measured onLayout x (see above). */
  thumb: { position: 'absolute', top: 3, bottom: 3, left: 0 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
    paddingVertical: space.md,
    borderBottomWidth: 2,
  },
})
