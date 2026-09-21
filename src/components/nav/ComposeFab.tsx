/* =========================================================
   ComposeFab — the one "make something" affordance.

   This app creates six different things, and they are not
   variations of each other: a post, a reel, a story, a
   research paper, a question, and a channel. A single "New
   post" button hides five of them; six buttons is a menu
   nobody reads. So the FAB opens a chooser, each row saying
   what the thing IS rather than what it is called.

   It is a FAB rather than a tab because it is an action, not a
   destination — a chooser sitting behind a tab reads as a tab
   that failed to load. QELAT dress: a 56pt lapis plate with
   the fab setback (crowned 18 / rooted 8), a drawn 1px edge
   and letterpress press — no shadow, no glow. It sits 16pt
   above the solid tab bar and slides off-screen while a list
   is scrolling down, which is the only time it is in the way.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Icon, Sheet, Text, Touchable, fireHaptic, useSheetState, type IconName,
} from '@/ui'

interface Choice {
  key: string
  label: string
  hint: string
  icon: IconName
  tone: 'accent' | 'scholar' | 'success' | 'warning' | 'danger'
  href: string
}

const CHOICES: Choice[] = [
  { key: 'post', label: 'Post', hint: 'Text, photos or a video', icon: 'edit', tone: 'accent', href: '/compose' },
  { key: 'reel', label: 'Reel', hint: 'A short vertical video', icon: 'reels', tone: 'danger', href: '/reels/compose' },
  { key: 'story', label: 'Story', hint: 'Disappears after 24 hours', icon: 'camera', tone: 'warning', href: '/story/compose' },
  { key: 'question', label: 'Question', hint: 'Ask the community', icon: 'qna', tone: 'success', href: '/qna/ask' },
  { key: 'research', label: 'Research', hint: 'Publish a paper with sources', icon: 'research', tone: 'scholar', href: '/research/compose' },
  { key: 'channel', label: 'Channel', hint: 'Broadcast to subscribers', icon: 'channels', tone: 'accent', href: '/channels/new' },
]

const FAB_SIZE = 56

export interface ComposeFabProps {
  /** Drive from the list's scroll direction: 1 visible, 0 tucked away. */
  visible?: boolean
  /** Extra bottom offset when the screen has its own bar above the tabs. */
  bottomOffset?: number
}

export function ComposeFab({ visible = true, bottomOffset = 0 }: ComposeFabProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const sheet = useSheetState()

  /* Letterpress: the Touchable seats the plate 1pt; the fill swap to the
     pressed role belongs to the owner (kiln rule: dark BRIGHTENS). */
  const [pressed, setPressed] = React.useState(false)

  const bottom = insets.bottom + t.layout.tabBarHeight + 16 + bottomOffset

  /* Hide-on-scroll: translateY off-screen riding the sheet spring (a big
     travel earns the softer settle) — no scale, no fade; plates move, they
     do not shrink. Reduced motion cuts. */
  const shown = useSharedValue(1)
  React.useEffect(() => {
    if (t.prefs.reducedMotion) shown.value = visible ? 1 : 0
    else shown.value = withSpring(visible ? 1 : 0, t.motion.sheetSpring)
  }, [visible])   // eslint-disable-line react-hooks/exhaustive-deps

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - shown.value) * (bottom + FAB_SIZE) }],
  }))

  /* The plate never scales (DESIGN.md §8.2) — the + glyph dips instead,
     the same licence the tab icons hold. */
  const press = useSharedValue(0)
  const iconAnim = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.1 }] }))
  const seat = (down: boolean) => {
    setPressed(down)
    if (t.prefs.reducedMotion) press.value = down ? 1 : 0
    else press.value = withSpring(down ? 1 : 0, t.motion.spring)
  }

  const go = (href: string) => {
    sheet.close()
    /* Let the sheet finish leaving before the push — a navigation mid-dismiss
       leaves the backdrop stranded over the new screen on Android. */
    setTimeout(() => router.push(href as any), 110)
  }

  return (
    <>
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[
          styles.wrap,
          { bottom, zIndex: t.zIndex.fab },
          anim,
        ]}
      >
        <Touchable
          onPress={() => { fireHaptic('medium'); sheet.open() }}
          onPressIn={() => seat(true)}
          onPressOut={() => seat(false)}
          feedback="scale"
          noAutoHitSlop
          accessibilityLabel="Create"
          style={[
            styles.fab,
            setback(t.shape.fab),
            {
              backgroundColor: pressed ? c.accentPressed : c.accent,
              borderWidth: t.rule.course,
              borderColor: c.accentPressed,
            },
          ]}
        >
          <Animated.View style={iconAnim}>
            <Icon name="add" size={28} color={c.textOnAccent} />
          </Animated.View>
        </Touchable>
      </Animated.View>

      <Sheet visible={sheet.visible} onClose={sheet.close} title="Create" maxHeightRatio={0.8}>
        <View style={{ paddingVertical: space.xs }}>
          {CHOICES.map(choice => {
            /* Icons on the soft washes take the *Text roles — the pairs
               contrast-verified in DESIGN.md §2 (plain `accent` disappears on
               the dark scheme's accentSoft) — matching ListRow's iconTone. */
            const tint = choice.tone === 'scholar' ? c.scholarText
              : choice.tone === 'success' ? c.successText
                : choice.tone === 'warning' ? c.warningText
                  : choice.tone === 'danger' ? c.dangerText
                    : c.accentText
            const bg = choice.tone === 'scholar' ? c.scholarSoft
              : choice.tone === 'success' ? c.successSoft
                : choice.tone === 'warning' ? c.warningSoft
                  : choice.tone === 'danger' ? c.dangerSoft
                    : c.accentSoft
            return (
              <Touchable
                key={choice.key}
                onPress={() => go(choice.href)}
                feedback="tint"
                noAutoHitSlop
                haptic="light"
                style={styles.row}
              >
                <View style={[styles.glyph, setback(t.shape.chip), { backgroundColor: bg }]}>
                  <Icon name={choice.icon} size={21} color={tint} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong" align="ui">{choice.label}</Text>
                  <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{choice.hint}</Text>
                </View>
                <Icon name={t.isRTL ? 'back' : 'forward'} size={16} color={c.textFaint} />
              </Touchable>
            )
          })}
        </View>
      </Sheet>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, left: 16, alignItems: 'flex-end' },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    /* iOS-only smoothing on the setback corners; inert on Android. */
    borderCurve: 'continuous',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md2, paddingHorizontal: space.xl, paddingVertical: space.md2 },
  glyph: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  flex: { flex: 1 },
})
