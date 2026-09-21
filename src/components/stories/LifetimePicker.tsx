/* =========================================================
   LifetimePicker — 8, 16 or 24 hours, and nothing else.

   The server accepts only those three: 12, 0, -5 and an
   omitted value all become 24 silently, with no 400. A "12
   hours" chip would therefore be a promise the UI could never
   detect being broken.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Sheet, Text, Touchable } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { LIFETIMES, LIFETIME_LABEL } from './visibility'

export type Lifetime = 8 | 16 | 24

export function LifetimeSheet({
  visible, onClose, value, onChange,
}: {
  visible: boolean
  onClose: () => void
  value: Lifetime
  onChange: (h: Lifetime) => void
}) {
  const t = useTheme()
  return (
    <Sheet visible={visible} onClose={onClose} title="Disappears after">
      <View style={styles.body}>
        {LIFETIMES.map(h => {
          const active = h === value
          return (
            <Touchable
              key={h}
              onPress={() => { onChange(h); onClose() }}
              feedback="scale"
              haptic="select"
              noAutoHitSlop
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? t.colors.accent : t.colors.surfaceSunken,
                  borderColor: active ? t.colors.accent : t.colors.border,
                },
              ]}
            >
              <Text variant="headline" align="center" color={active ? t.colors.textOnAccent : t.colors.text}>
                {LIFETIME_LABEL[h]}
              </Text>
            </Touchable>
          )
        })}
        <Text variant="footnote" tone="muted" align="ui" style={{ paddingHorizontal: space.xs, marginTop: space.xs2 }}>
          Your story disappears after this. 24 hours is the default.
        </Text>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.xs, gap: space.sm2 },
  chip: {
    height: 56,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
