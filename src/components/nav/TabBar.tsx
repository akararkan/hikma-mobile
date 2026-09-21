/* =========================================================
   TabBar — a custom bar rather than the stock one.

   Three things the default cannot do that this app needs:

     · a live badge on Chat driven by the always-on SSE stream
     · the profile tab rendered as the user's own avatar, which
       is the affordance people actually look for
     · a scroll-to-top / refresh gesture on re-tapping the
       active tab, which is the single most-used interaction in
       a feed app and has no stock equivalent

   QELAT chrome: a solid `tabBarBg` plate on both platforms —
   no blur, no shadow — with a drawn 1px course along the top
   edge. The active tab is marked by the CRENELLATION (three
   merlons rising from that course) which slides between tabs
   on the masonry curve, plus an accent icon and a micro-caps
   label; inactive tabs are mute icons with no label.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
/* react-navigation is vendored inside expo-router v7 — there is no top-level
   @react-navigation/* to import from. */
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, space } from '@/theme/tokens'
import { useAuth } from '@/context/AuthContext'
import { useChatUnread } from '@/context/RealtimeContext'
import {
  Avatar, Crenellation, Icon, NumericText, Text, Touchable, fireHaptic, type IconName,
} from '@/ui'
import { emitTabRetap } from './tabEvents'

interface TabMeta { icon: IconName; label: string }

const META: Record<string, TabMeta> = {
  index: { icon: 'home', label: 'Home' },
  explore: { icon: 'search', label: 'Explore' },
  reels: { icon: 'reels', label: 'Reels' },
  chat: { icon: 'chat', label: 'Chat' },
  profile: { icon: 'profile', label: 'You' },
}

/* Masonry — fast arrival, dead stop; the crenellation slides, never floats. */
const masonry = Easing.bezier(...motion.out)

/** Width of the Crenellation ornament (three 3pt merlons at 8pt spacing). */
const CREN_W = 25

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const c = t.colors

  const height = t.layout.tabBarHeight + Math.max(insets.bottom, 8)

  /* CRENELLATION SLIDE (DESIGN.md §7.4). Tab centers come from onLayout,
     which reports PHYSICAL x — so the ornament is anchored with physical
     `left` + translateX on purpose; mixing logical `start` with measured
     coordinates would double-mirror in RTL. */
  const centers = React.useRef<Record<string, number>>({})
  const placed = React.useRef(false)
  const crenX = useSharedValue(-CREN_W * 4)   /* parked off-canvas until measured */

  const activeRoute = state.routes[state.index]
  const activeKey = activeRoute && META[activeRoute.name] ? activeRoute.key : null

  const place = React.useCallback((key: string) => {
    const cx = centers.current[key]
    if (cx == null) return
    const x = cx - CREN_W / 2
    if (!placed.current) {
      /* First layout: appear in place — travelling in from off-canvas on
         mount would read as a glitch, not an arrival. */
      placed.current = true
      crenX.value = x
    } else {
      crenX.value = withTiming(x, { duration: t.ms(motion.normal), easing: masonry })
    }
  }, [crenX, t])

  React.useEffect(() => {
    if (activeKey) place(activeKey)
  }, [activeKey, place])

  const onItemLayout = React.useCallback((key: string, x: number, width: number) => {
    centers.current[key] = x + width / 2
    if (key === activeKey) place(key)
  }, [activeKey, place])

  const crenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: crenX.value }] }))

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: c.tabBarBg, borderTopColor: c.separator, borderTopWidth: t.rule.course },
      ]}
    >
      {/* Merlons interrupt the top course above the active tab. Yoga insets
          absolute children by the parent border, so -3 lands the 3pt-tall
          ornament covering the 1px rule and rising 2pt above the plate. */}
      <Animated.View pointerEvents="none" style={[styles.cren, crenStyle]}>
        <Crenellation />
      </Animated.View>

      <View style={[styles.row, { height, paddingBottom: Math.max(insets.bottom, 8) }]}>
        {state.routes.map((route, index) => {
          const meta = META[route.name]
          if (!meta) return null
          const focused = state.index === index

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
            if (focused) {
              /* Re-tapping the active tab scrolls it to top, and a second
                 re-tap refreshes. Screens opt in via useTabRetap() — and only
                 the ones that did get the haptic. Buzzing for a tab nobody is
                 listening on is a confirmation of nothing. */
              if (emitTabRetap(route.name)) fireHaptic('light')
              return
            }
            if (!event.defaultPrevented) {
              fireHaptic('select')
              navigation.navigate(route.name as never)
            }
          }

          /* The unread subscription lives in ChatTabItem, one leaf down: read
             at the bar root it dragged all five TabItems (theme, auth, avatar,
             springs) through every counted message. */
          const Item = route.name === 'chat' ? ChatTabItem : TabItem
          return (
            <Item
              key={route.key}
              meta={meta}
              focused={focused}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              onItemLayout={(x, width) => onItemLayout(route.key, x, width)}
              badge={0}
              isProfile={route.name === 'profile'}
            />
          )
        })}
      </View>
    </View>
  )
}

interface TabItemProps {
  meta: TabMeta
  focused: boolean
  onPress: () => void
  onLongPress: () => void
  onItemLayout: (x: number, width: number) => void
  badge: number
  isProfile: boolean
}

/* The chat tab is the one item that needs the live counter — the badge pill
   AND the accessibility label carry it — so it alone subscribes. A delta
   re-renders this wrapper and its TabItem; the other four are memoized out. */
function ChatTabItem(props: TabItemProps) {
  const badge = useChatUnread()
  return <TabItem {...props} badge={badge} />
}

const TabItem = React.memo(function TabItem({
  meta, focused, onPress, onLongPress, onItemLayout, badge, isProfile,
}: TabItemProps) {
  const t = useTheme()
  const { user } = useAuth()
  const c = t.colors
  const pop = useSharedValue(focused ? 1 : 0)

  React.useEffect(() => {
    pop.value = t.prefs.reducedMotion ? (focused ? 1 : 0) : withSpring(focused ? 1 : 0, t.motion.spring)
  }, [focused])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Icons are the one thing allowed to scale (plates never do). */
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.08 }] }))

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={e => onItemLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      feedback="none"
      noAutoHitSlop
      /* "tab", not "button": both platforms then announce position-in-set,
         which is the only thing that tells a screen-reader user this is one
         of five and not a lone control. */
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      /* An `accessible` Pressable's label REPLACES its subtree, so the badge's
         NumericText is never read out on its own. The unread count is the one
         number this bar carries — fold it into the label or it is invisible. */
      accessibilityLabel={badge > 0 ? `${meta.label}, ${badge > 99 ? '99+' : badge} unread` : meta.label}
      style={styles.item}
    >
      <Animated.View style={[styles.iconWrap, anim]}>
        {isProfile ? (
          <View
            style={[
              styles.avatarRing,
              { borderColor: focused ? c.accent : 'transparent' },
            ]}
          >
            <Avatar uri={user?.profileImage} name={user?.displayName || user?.full} seed={user?.id} size={25} />
          </View>
        ) : (
          <Icon name={meta.icon} size={25} filled={focused} color={focused ? c.accent : c.textMuted} />
        )}

        <TabBadge count={badge} />
      </Animated.View>

      {/* Fixed-height slot keeps every tab's icon on the same line whether or
          not the label renders. micro is caps/tracked on Latin only — the
          Text primitive leaves Arabic script untransformed. */}
      <View style={{ height: t.type.micro.lineHeight, marginTop: space.xxs }}>
        {focused ? (
          <Text variant="micro" color={c.accent} align="center" numberOfLines={1}>
            {meta.label}
          </Text>
        ) : null}
      </View>
    </Touchable>
  )
})

/* Unread counter — one of the two sanctioned pills. The 2px ring is cut from
   the bar plate it sits on, not from `bg`. It pops in on the house spring and
   shrinks out on the masonry curve rather than blinking — the last count is
   held through the exit so the shrink has a number to shrink. Reduced motion
   cuts both ways. */
function TabBadge({ count }: { count: number }) {
  const t = useTheme()
  const c = t.colors
  const [shown, setShown] = React.useState(count)
  const [mounted, setMounted] = React.useState(count > 0)
  /* First layout appears in place, same rule as the crenellation. */
  const scale = useSharedValue(count > 0 ? 1 : 0)

  const unmount = () => setMounted(false)

  /* Derived in the render phase, not an effect: the effect version re-rendered
     the always-mounted bar twice per unread delta, and it is exactly the
     set-state-in-effect shape the compiler bails on. */
  if (count > 0 && shown !== count) setShown(count)
  if (count > 0 && !mounted) setMounted(true)
  if (count === 0 && mounted && t.prefs.reducedMotion) setMounted(false)

  React.useEffect(() => {
    if (count > 0) {
      scale.value = t.prefs.reducedMotion ? 1 : withSpring(1, t.motion.spring)
    } else if (mounted && !t.prefs.reducedMotion) {
      scale.value = withTiming(0, { duration: t.ms(motion.fast), easing: masonry }, finished => {
        if (finished) runOnJS(unmount)()
      })
    }
  }, [count])   // eslint-disable-line react-hooks/exhaustive-deps

  const anim = useAnimatedStyle(() => ({
    opacity: scale.value,
    transform: [{ scale: scale.value }],
  }))

  if (!mounted) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.badge,
        { borderRadius: t.shape.pill, backgroundColor: c.danger, borderColor: c.tabBarBg },
        anim,
      ]}
    >
      <NumericText variant="micro" color={c.textOnDanger} align="center">
        {shown > 99 ? '99+' : shown}
      </NumericText>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /* Physical `left` — pairs with physical onLayout coordinates (see above). */
  cren: { position: 'absolute', top: -3, left: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { alignItems: 'center', justifyContent: 'center', width: 44, height: 30 },
  avatarRing: { borderWidth: 2, borderRadius: 999, padding: 1.5 },
  badge: {
    position: 'absolute',
    top: -3,
    end: 4,
    minWidth: 17,
    height: 17,
    borderWidth: 2,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
