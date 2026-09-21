/* =========================================================
   The door's brand band.

   Every way into the app — sign in, sign up, the 2FA leg —
   opens on the same navy field with the lockup written across
   it, and the form on paper below. One surface, so the three
   screens read as three steps of one thing rather than three
   different products, and so the first thing anyone sees is
   the mark.

   THE BAND IS THE SPLASH, CONTINUED. Its ground is the exact
   colour of the native splash and of the boot gate
   (`ramp.brand[900]`), the lockup plays the same choreography,
   and the corners curve into the paper — so arriving at the
   door reads as the splash settling rather than as a new
   screen replacing it.

   IT OWNS THE TOP INSET. The band runs under the status bar
   on purpose (Android is edge-to-edge, and a navy field that
   stops short of the clock is a stripe, not a field), so the
   inset is paid INSIDE it rather than by the screen.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { APP_ENDONYMS } from '@/lib/brand'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, shape, space } from '@/theme/tokens'
import { Text, Wordmark } from '@/ui'

export const BRAND_GROUND = ramp.brand[900]

export interface BrandBandProps {
  /** The line under the lockup — "Welcome back", "Create your account". */
  caption?: string
  /** Compact for the deeper steps, where the form needs the room. */
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

export function BrandBand({ caption, compact, style }: BrandBandProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const still = t.prefs.reducedMotion

  return (
    <View
      style={[
        styles.band,
        {
          backgroundColor: BRAND_GROUND,
          paddingTop: insets.top + (compact ? 22 : 38),
          paddingBottom: compact ? 24 : 34,
          borderBottomLeftRadius: shape.sheet.top,
          borderBottomRightRadius: shape.sheet.top,
        },
        style,
      ]}
    >
      <Wordmark size={compact ? 24 : 30} tone="onDark" animate ground={BRAND_GROUND} />

      {/* The endonyms are type, never the lockup — a Latin h spliced into an
          Arabic or Kurdish word would be nonsense (ui/Wordmark). */}
      <Animated.View entering={still ? undefined : FadeIn.delay(620).duration(320)}>
        <Text
          variant="micro"
          color="rgba(255,255,255,0.66)"
          align="center"
          style={styles.endonyms}
        >
          {APP_ENDONYMS.join('  ·  ')}
        </Text>
      </Animated.View>

      {caption ? (
        <Animated.View entering={still ? undefined : FadeIn.delay(760).duration(320)}>
          <Text variant="callout" color="rgba(255,255,255,0.86)" align="center" style={styles.caption}>
            {caption}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  band: { alignItems: 'center', paddingHorizontal: space.xxl, borderCurve: 'continuous', overflow: 'hidden' },
  endonyms: { marginTop: space.sm2, letterSpacing: 0.6 },
  caption: { marginTop: space.md2 },
})
