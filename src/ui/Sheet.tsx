/* =========================================================
   Sheet — the bottom sheet, and everything built on it
   (action menus, confirmations, pickers).

   Deliberately not a third-party sheet library: what the app
   actually needs is a modal that slides, has a grabber, and
   dismisses on backdrop tap or a downward drag. That is ~120
   lines with reanimated + gesture-handler, and it avoids a
   native dependency whose gesture handling would then have to
   be reconciled with the story viewer's and the reel pager's.

   QELAT (DESIGN.md §6 "Sheet"): a `surfaceRaised` plate with
   the 18/0 sheet setback, arriving on the sheet spring over
   the plain scrim — no blur behind, no shadow ever. The
   grabber is the ZIGGURAT CROWN, faded in 120ms AFTER the
   plate lands (a settled building gets its crown); the header
   sits on the DOUBLE RULE instead of a hairline.

   `useSheet()` gives imperative openers so a long-press menu
   is one call instead of a piece of local state per screen.
   ========================================================= */
import React from 'react'
import {
  BackHandler, Modal, ScrollView, StyleSheet, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle,
} from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { useDockInset } from '@/hooks/useDockInset'
import { motion, setback, space } from '@/theme/tokens'
import { Text } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable, fireHaptic } from './Touchable'
import { Button, IconButton } from './Button'
import { ActionRow } from './ListRow'
import { DoubleRule, ZigguratCrown } from './ornaments'

/* Masonry ease (motion.out): fast arrival, dead stop. Built once at module
   scope so gesture worklets capture the factory, not rebuild it. */
const MASONRY = Easing.bezier(...motion.out)

export interface SheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children?: React.ReactNode
  /** Cap the body height as a fraction of the screen; it scrolls past that. */
  maxHeightRatio?: number
  /** Hide the grabber and title bar — full-bleed content (media pickers). */
  bare?: boolean
  /** A persistent footer below the scrolling body. */
  footer?: React.ReactNode
  scrollable?: boolean
  contentStyle?: StyleProp<ViewStyle>
}

export function Sheet({
  visible, onClose, title, subtitle, children,
  maxHeightRatio = 0.9, bare = false, footer, scrollable = true, contentStyle,
}: SheetProps) {
  const t = useTheme()
  const c = t.colors
  /* Not the raw inset: the plate sits inside the KeyboardAvoidingView below,
     which already pads by the full keyboard overlap — adding the home
     indicator on top of that floated the sheet a finger's width above the
     keys. `dock` is 0 while the keyboard is up and the inset otherwise. */
  const dock = useDockInset()
  const { height: screenH } = useWindowDimensions()

  /* Parked a full screen below the fold, not a fixed 600: a 0.9-ratio
     sheet is taller than any constant, and a plate that starts — or
     exits — half-visible pops instead of sliding. */
  const translateY = useSharedValue(screenH)
  const backdrop = useSharedValue(0)
  /* Crown grabber opacity — in 120ms AFTER the spring lands (§7.5). */
  const crown = useSharedValue(0)
  /* Set by a committed drag fling so the close effect below does not
     restart (and retime) an exit that is already in flight. */
  const dismissing = useSharedValue(false)
  /* The body's scroll offset, mirrored onto the UI thread so the plate's pan
     can ask "is the list already at the top?" before it decides to drag. */
  const scrollY = useSharedValue(0)
  const canDrag = useSharedValue(true)
  const [mounted, setMounted] = React.useState(visible)

  /* Durations are resolved on the JS side and captured by the worklets
     below — t.ms is a plain closure and must never run on the UI thread. */
  const crownMs = t.ms(t.motion.fast)
  const flingMs = t.ms(t.motion.fast)
  const reduced = t.prefs.reducedMotion

  React.useEffect(() => {
    if (visible) {
      setMounted(true)
      dismissing.value = false
      backdrop.value = withTiming(1, { duration: t.ms(t.motion.normal) })
      if (t.prefs.reducedMotion) {
        translateY.value = 0
        crown.value = 1
      } else {
        crown.value = 0
        translateY.value = withSpring(0, t.motion.sheetSpring, finished => {
          'worklet'
          if (finished) crown.value = withDelay(120, withTiming(1, { duration: crownMs }))
        })
      }
    } else if (mounted) {
      /* Leaving is lighter than arriving: the plate slides out on a plain
         timing well inside the entrance spring's settle, and the scrim lets
         go first. Android back and the backdrop tap both land here — the
         sheet always animates OUT, never cuts (reduced motion excepted). */
      backdrop.value = withTiming(0, { duration: t.ms(t.motion.fast) })
      crown.value = t.prefs.reducedMotion ? 0 : withTiming(0, { duration: t.ms(t.motion.fast) })
      if (!dismissing.value) {
        translateY.value = t.prefs.reducedMotion
          ? 0
          : withTiming(screenH, { duration: t.ms(t.motion.normal), easing: MASONRY })
      }
      const id = setTimeout(() => setMounted(false), t.ms(t.motion.normal) + 30)
      return () => clearTimeout(id)
    }
  }, [visible])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Android hardware back closes the sheet before it closes the screen. */
  React.useEffect(() => {
    if (!visible) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true })
    return () => sub.remove()
  }, [visible, onClose])

  /* The body's own scroll, as a gesture the plate's pan can name. Attached to
     the ScrollView below; without it the pan is a stranger that cancels the
     scroll the moment it wins. Held stable — unlike `drag` this one lives on
     the list, and a picker re-renders on every keystroke of its search
     field; a fresh handler per keystroke is a re-registration mid-scroll. */
  const bodyScroll = React.useMemo(() => Gesture.Native(), [])

  /* Deliberately NOT memoized. A composed gesture is worth holding stable on
     a list row, where the detector re-registers per recycle; a sheet is one
     instance that renders on open and close, and every candidate dep here is
     a shared value the hook lint would rather we did not write to.

     The three qualifiers are load-bearing, because this pan sits on the whole
     plate — body ScrollView included. `failOffsetY(-10)` hands upward drags
     back to the list (the clamp below moves the sheet zero pixels, so without
     it a 250-row country picker just twitched and froze). `activeOffsetY(10)`
     keeps the pan out of the way until the drag is unambiguously downward,
     and `simultaneousWithExternalGesture` lets the list keep scrolling when
     the pan does win. `canDrag` is latched at touch-down: a drag that starts
     mid-list scrolls the list; only a drag from the top moves the sheet. */
  const drag = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-10)
    .simultaneousWithExternalGesture(bodyScroll)
    .onBegin(() => { canDrag.value = scrollY.value <= 0 })
    .onUpdate(e => {
      if (!canDrag.value) return
      translateY.value = Math.max(0, e.translationY)
    })
    .onEnd(e => {
      if (!canDrag.value) return
      if (e.translationY > 110 || e.velocityY > 900) {
        /* Committed: fly out from wherever the finger let go, faster than
           the close effect's slide — momentum should read as obeyed. The
           flag keeps that effect from retiming this exit mid-flight. */
        dismissing.value = true
        translateY.value = withTiming(screenH, { duration: flingMs, easing: MASONRY })
        runOnJS(onClose)()
      } else if (reduced) {
        /* Reduced motion: no settle spring left running — snap home. */
        translateY.value = 0
        crown.value = 1
      } else {
        /* Not committed: settle home on the sheet spring, inheriting the
           finger's release velocity so the hand-off is seamless. */
        translateY.value = withSpring(0, { ...t.motion.sheetSpring, velocity: e.velocityY })
        /* A grab during arrival cancels the entrance spring before its
           completion fires — re-crown here (1→1 is a visual no-op). */
        crown.value = withDelay(120, withTiming(1, { duration: crownMs }))
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }))
  const crownStyle = useAnimatedStyle(() => ({ opacity: crown.value }))

  if (!mounted) return null

  const Body = scrollable ? ScrollView : View
  const bodyProps = scrollable
    ? {
      bounces: false,
      keyboardShouldPersistTaps: 'handled' as const,
      showsVerticalScrollIndicator: false,
      /* Just the breathing room. The safe-area allowance has exactly one
         owner — the plate's own paddingBottom, or the footer's when there is
         one — and padding it here too stacked 34 + 42pt of dead space under
         the last row of every picker on a home-indicator phone. */
      contentContainerStyle: { paddingBottom: space.sm },
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { scrollY.value = e.nativeEvent.contentOffset.y },
      scrollEventThrottle: 16,
    }
    : {}

  const body = (
    <Body {...(bodyProps as any)} style={[scrollable ? { flexShrink: 1 } : null, contentStyle]}>
      {children}
    </Body>
  )

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, backdropStyle]}>
          <Touchable
            onPress={onClose}
            feedback="none"
            noAutoHitSlop
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close"
          >
            <View />
          </Touchable>
        </Animated.View>

        {/* The card rides the keyboard: the Modal's own window does not
            resize (statusBarTranslucent + edge-to-edge), so a sheet with a
            TextInput — the report details, a poll option — otherwise keeps
            its input UNDER the keyboard. Yoga positions the absolute card
            against the padding box, so the avoider's padding lifts it. */}
        <KeyboardAvoidingView behavior="padding" style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <GestureDetector gesture={drag}>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: c.surfaceRaised,
                ...setback(t.shape.sheet),
                maxHeight: screenH * maxHeightRatio,
                paddingBottom: footer ? 0 : Math.max(dock, 10),
              },
              sheetStyle,
            ]}
          >
            {!bare ? (
              <Animated.View style={[styles.grabberWrap, crownStyle]}>
                <ZigguratCrown />
              </Animated.View>
            ) : null}

            {title ? (
              <>
                <View style={styles.titleBar}>
                  <View style={{ flex: 1 }}>
                    {/* §6 Sheet: titles are title3 Lora 700 — the explicit
                        weight keeps both script paths on the 700 face. */}
                    <Text variant="title3" serif weight="700" align="ui">{title}</Text>
                    {subtitle ? <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{subtitle}</Text> : null}
                  </View>
                  {/* IconButton, not a raw Touchable: icons answer presses
                      with the 0.92 scale + accentSofter wash (§6 IconButton),
                      never the letterpress seat. */}
                  <IconButton name="close" onPress={onClose} accessibilityLabel="Close" size={18} />
                </View>
                <DoubleRule />
              </>
            ) : null}

            {/* The scroll is only a gesture the plate's pan can defer to if it
                is registered as one — hence the detector. Non-scrolling bodies
                stay bare; there is nothing to hand back to. */}
            {scrollable ? <GestureDetector gesture={bodyScroll}>{body}</GestureDetector> : body}

            {footer ? (
              <View
                style={{
                  padding: t.layout.screenPadding,
                  paddingBottom: Math.max(dock, 12),
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: c.separator,
                }}
              >
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </GestureDetector>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

/* ---------------------------------------------------------
   ActionSheet — a menu of actions. The long-press surface for
   posts, messages, conversations, everything.
   --------------------------------------------------------- */

export interface SheetAction {
  label: string
  icon?: IconName
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
  subtitle?: string
  /** Hide without removing the entry — keeps call sites declarative. */
  hidden?: boolean
}

export function ActionSheet({
  visible, onClose, title, subtitle, actions, cancelLabel = 'Cancel',
}: {
  visible: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  actions: (SheetAction | null | false | undefined)[]
  cancelLabel?: string | null
}) {
  const t = useTheme()
  const list = actions.filter(Boolean).filter(a => !(a as SheetAction).hidden) as SheetAction[]
  return (
    <Sheet visible={visible} onClose={onClose} bare={!title} maxHeightRatio={0.8}>
      {title ? (
        <>
          <View style={{ paddingHorizontal: space.xl, paddingTop: space.xs, paddingBottom: space.sm2 }}>
            <Text variant="title3" serif weight="700" align="ui">{title}</Text>
            {subtitle ? <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs }}>{subtitle}</Text> : null}
          </View>
          <DoubleRule />
        </>
      ) : null}
      <View style={{ paddingTop: title ? 4 : 6 }}>
        {list.map((a, i) => (
          <ActionRow
            key={i}
            label={a.label}
            icon={a.icon}
            subtitle={a.subtitle}
            destructive={a.destructive}
            disabled={a.disabled}
            onPress={() => { onClose(); setTimeout(a.onPress, 90) }}
          />
        ))}
      </View>
      {cancelLabel ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.separator, marginTop: space.xs2 }}>
          <Button label={cancelLabel} onPress={onClose} variant="secondary" block size="lg" />
        </View>
      ) : null}
    </Sheet>
  )
}

/* ---------------------------------------------------------
   ConfirmSheet — a destructive confirmation. Never an Alert:
   Alert cannot carry the "this cannot be undone" body copy
   the moderation and deletion flows require.
   --------------------------------------------------------- */

export function ConfirmSheet({
  visible, onClose, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = false, loading = false, onConfirm, icon,
}: {
  visible: boolean
  onClose: () => void
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  icon?: IconName
}) {
  const t = useTheme()
  return (
    <Sheet visible={visible} onClose={onClose} bare scrollable={false} maxHeightRatio={0.6}>
      <View style={{ padding: space.xxl, paddingTop: space.sm2, alignItems: 'center', gap: space.sm }}>
        {/* Setback tile, not a circle — faces are the one round thing. */}
        <View
          style={{
            width: 54, height: 54, marginBottom: space.xs2,
            ...setback(t.shape.card), borderCurve: 'continuous',
            backgroundColor: destructive ? t.colors.dangerSoft : t.colors.accentSoft,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name={icon ?? (destructive ? 'warning' : 'info')} size={25} color={destructive ? t.colors.danger : t.colors.accent} />
        </View>
        <Text variant="title3" serif weight="700" align="center">{title}</Text>
        {message ? <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 330 }}>{message}</Text> : null}
        <View style={{ flexDirection: 'row', gap: space.sm2, marginTop: space.lg2, alignSelf: 'stretch' }}>
          <Button label={cancelLabel} onPress={onClose} variant="secondary" size="lg" style={{ flex: 1 }} />
          <Button
            label={confirmLabel}
            onPress={() => { fireHaptic(destructive ? 'warning' : 'success'); onConfirm() }}
            variant={destructive ? 'danger' : 'primary'}
            size="lg"
            loading={loading}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Sheet>
  )
}

/* ---------------------------------------------------------
   useSheetState — the two lines of state every sheet needs,
   with a payload slot so a long-press can carry its subject.
   --------------------------------------------------------- */

export function useSheetState<T = void>() {
  const [payload, setPayload] = React.useState<T | null>(null)
  const [visible, setVisible] = React.useState(false)
  /* `open` is typed loosely on purpose: a payload-less sheet is almost always
     wired straight to `onPress`, and a strict `(p?: void) => void` is not
     assignable to RN's `(e: GestureResponderEvent) => void`. The payload stays
     properly typed where it matters, on the way out. */
  const open = React.useCallback((p?: any) => {
    /* A press event is not a payload — passing `open` as a handler must not
       park the synthetic event where the sheet expects its subject. */
    const value = p && typeof p === 'object' && 'nativeEvent' in p ? null : (p ?? null)
    setPayload(value as T | null)
    setVisible(true)
  }, [])
  const close = React.useCallback(() => setVisible(false), [])
  return { visible, payload, open, close }
}

const styles = StyleSheet.create({
  /* iOS smooths the 18pt crown; borderCurve is a plain style prop, inert on
     Android. Full-bleed plate, so start/end == left/right — logical anyway. */
  sheet: { position: 'absolute', start: 0, end: 0, bottom: 0, borderCurve: 'continuous' },
  grabberWrap: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs2 },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.xs2,
    paddingBottom: space.md,
  },
})
