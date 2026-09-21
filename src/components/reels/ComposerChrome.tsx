/* =========================================================
   The composer's chrome — one header, one pair of insets.

   Three screens (capture → edit → publish) and two modals
   (sound, mix) draw the same black stage, and every one of them
   used to do its own arithmetic for the top of the phone:
   `insets.top + 4`, `+ 6`, `+ 8`. That is how a back chevron
   ends up under a punch-hole camera on one screen and clear of
   it on the next — nobody was deciding the number, five call
   sites were each guessing it.

   THE TOP INSET. `useSafeAreaInsets().top` is the truth on iOS
   and usually on Android too. Usually: this app is edge-to-edge
   there, and the window can render a frame or two BEFORE the
   system insets have been applied — reporting 0, or a value
   that predates the cutout — and a header that trusts it draws
   itself under the status bar for exactly as long as that
   lasts. `StatusBar.currentHeight` comes from the window's own
   resources and is there on the first frame, so the larger of
   the two is the honest answer on Android and a no-op on iOS.

   THE GAP. 10pt of air above the bar and never less than 10 at
   the bottom, which is the floor the rest of the app's docked
   surfaces already use (ui/Sheet). Buttons on a stage have no
   plate to separate them from the system bars, so they need
   that air more than a header on paper does, not less.

   TWO TONES. Four of these screens are a black stage — the
   clip is the content and any other ground tints it. The fifth
   is not: writing a caption, choosing an audience and picking a
   location is FORM work, and the app writes forms on white
   paper with slate ink (DESIGN.md §2). Same bar, same spacing,
   the ink swapped: `tone="paper"`.
   ========================================================= */
import React from 'react'
import { Platform, StatusBar as RNStatusBar, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, type IconName } from '@/ui'
import { STAGE } from './skin'

/** Air between the status bar and the first row of controls. */
export const COMPOSER_TOP_GAP = 10
/** The header's own row, below the inset — a 48pt target plus its breathing
 *  room, so a title and a text action both sit comfortably. */
export const COMPOSER_BAR_H = 48

export interface ComposerInsets {
  /** Status bar / cutout, floored by Android's own report. */
  top: number
  /** Home indicator or nav bar, floored at 10pt of air. */
  bottom: number
}

export function useComposerInsets(): ComposerInsets {
  const insets = useSafeAreaInsets()
  const androidBar = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0
  return React.useMemo(() => ({
    top: Math.max(insets.top, androidBar),
    bottom: Math.max(insets.bottom, 10),
  }), [insets.top, insets.bottom, androidBar])
}

export interface ComposerHeaderProps {
  title: string
  /** `stage` (default) is white ink on black; `paper` is the app's own ink on
   *  the app's own ground, for the details step. */
  tone?: 'stage' | 'paper'
  /** "Step 2 of 3". The flow is three screens deep and nothing said so. */
  step?: string
  onBack: () => void
  backIcon?: IconName
  backLabel?: string
  /** A leading text button instead of the chevron — the sound modal's Cancel. */
  backText?: string
  /** The trailing action: Next, Done, Post. */
  action?: React.ReactNode
  /** Receives the bar's measured height, so a stage rail can start below it
   *  rather than guessing at `insets.top + 62`. */
  onHeight?: (height: number) => void
  /** A hairline under the bar — for the screens that are lists rather than
   *  stages, where the content would otherwise start out of nowhere. */
  rule?: boolean
}

export function ComposerHeader({
  title, tone = 'stage', step, onBack, backIcon, backLabel = 'Go back', backText, action, onHeight, rule,
}: ComposerHeaderProps) {
  const t = useTheme()
  const { top } = useComposerInsets()
  const paper = tone === 'paper'
  const ink = paper ? t.colors.text : STAGE.fg
  const inkMuted = paper ? t.colors.textMuted : STAGE.fgMuted
  const inkFaint = paper ? t.colors.textFaint : STAGE.fgFaint

  const measure = React.useCallback((e: LayoutChangeEvent) => {
    onHeight?.(e.nativeEvent.layout.height)
  }, [onHeight])

  return (
    <View
      onLayout={onHeight ? measure : undefined}
      style={[
        styles.bar,
        { paddingTop: top + COMPOSER_TOP_GAP },
        rule ? { borderBottomWidth: t.rule.course, borderBottomColor: paper ? t.colors.separator : STAGE.hairline } : null,
      ]}
    >
      <Touchable
        onPress={onBack}
        feedback={backText ? 'dim' : 'scale'}
        noAutoHitSlop
        accessibilityLabel={backText || backLabel}
        style={[styles.lead, backText ? styles.leadText : null]}
      >
        {backText
          ? <Text variant="subhead" color={inkMuted}>{backText}</Text>
          : <Icon name={backIcon ?? (t.isRTL ? 'forward' : 'back')} size={24} color={ink} />}
      </Touchable>

      <View style={styles.gap} />
      <View style={styles.trail}>{action}</View>

      {/* Absolutely placed, so an action of any width leaves the title exactly
          centred — a row layout would push it off-centre by half of "Next". */}
      <View pointerEvents="none" style={[styles.titles, { top: top + COMPOSER_TOP_GAP }]}>
        <Text variant="headline" color={ink} align="center" numberOfLines={1}>
          {title}
        </Text>
        {step ? (
          <Text variant="micro" color={inkFaint} align="center" numberOfLines={1}>
            {step}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2, paddingBottom: space.xs2 },
  lead: { width: 48, height: COMPOSER_BAR_H, alignItems: 'center', justifyContent: 'center' },
  /* A word needs more room than a chevron, and it reads from the edge in. */
  leadText: { width: 'auto', minWidth: 48, paddingHorizontal: space.sm2, alignItems: 'flex-start' },
  gap: { flex: 1 },
  trail: { minWidth: 48, height: COMPOSER_BAR_H, alignItems: 'flex-end', justifyContent: 'center' },
  /* Clear of both slots, so a long title truncates instead of colliding. */
  titles: {
    position: 'absolute', start: 76, end: 76, height: COMPOSER_BAR_H,
    alignItems: 'center', justifyContent: 'center',
  },
})
