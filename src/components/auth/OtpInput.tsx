/* =========================================================
   OtpInput — the boxed code entry.

   One hidden TextInput behind N drawn boxes, which is the only
   layout that gets iOS/Android autofill, paste, and a sane
   backspace at the same time. N separate inputs look the same
   and behave worse: autofill picks one box, paste fills one
   box, and backspace at an empty box does nothing.

   Auto-submits on the last character so the common path is
   zero taps after typing.
   ========================================================= */
import React from 'react'
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, cancelAnimation, Easing,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text, Touchable } from '@/ui'

export interface OtpInputProps {
  value: string
  onChangeText: (v: string) => void
  length?: number
  onComplete?: (v: string) => void
  disabled?: boolean
  /** Bump to replay the reject shake. */
  shakeKey?: number
  autoFocus?: boolean
  /** `numeric` for TOTP, `alnum` for the recovery-code fallback. */
  mode?: 'numeric' | 'alnum'
}

export function OtpInput({
  value, onChangeText, length = 6, onComplete, disabled,
  shakeKey = 0, autoFocus = true, mode = 'numeric',
}: OtpInputProps) {
  const t = useTheme()
  const c = t.colors
  const ref = React.useRef<TextInput>(null)
  const [focused, setFocused] = React.useState(false)
  const shake = useSharedValue(0)
  const caret = useSharedValue(1)

  /* Replay the shake whenever the caller bumps the key. */
  const firstShake = React.useRef(true)
  React.useEffect(() => {
    if (firstShake.current) { firstShake.current = false; return }
    if (t.prefs.reducedMotion) return
    shake.value = withSequence(
      withTiming(-9, { duration: 55 }),
      withTiming(9, { duration: 55 }),
      withTiming(-6, { duration: 55 }),
      withTiming(6, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    )
  }, [shakeKey])   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { caret.value = 1; return }
    caret.value = withRepeat(withTiming(0, { duration: 520, easing: Easing.linear }), -1, true)
    return () => cancelAnimation(caret)
  }, [caret, t.prefs.reducedMotion])

  const rowAnim = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))
  const caretAnim = useAnimatedStyle(() => ({ opacity: caret.value }))

  const sanitize = React.useCallback((raw: string) => {
    const cleaned = mode === 'numeric'
      ? raw.replace(/\D/g, '')
      : raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return cleaned.slice(0, length)
  }, [mode, length])

  const handle = (raw: string) => {
    const next = sanitize(raw)
    onChangeText(next)
    if (next.length === length) onComplete?.(next)
  }

  const chars = value.split('')
  const activeIndex = Math.min(value.length, length - 1)

  const inputProps: TextInputProps = {
    keyboardType: mode === 'numeric' ? 'number-pad' : 'default',
    autoCapitalize: mode === 'numeric' ? 'none' : 'characters',
    autoComplete: mode === 'numeric' ? (Platform.OS === 'android' ? 'sms-otp' : 'one-time-code') : 'off',
    textContentType: mode === 'numeric' ? 'oneTimeCode' : 'none',
  }

  return (
    <Touchable
      onPress={() => ref.current?.focus()}
      feedback="none"
      noAutoHitSlop
      disabled={disabled}
      accessibilityLabel={`${length}-character code`}
    >
      <Animated.View style={[styles.row, rowAnim]}>
        {Array.from({ length }, (_, i) => {
          const filled = i < chars.length
          const isActive = focused && i === activeIndex && !disabled
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: c.surfaceSunken,
                  borderRadius: t.radius.sm,
                  borderWidth: isActive ? 2 : StyleSheet.hairlineWidth,
                  borderColor: isActive ? c.accent : filled ? c.borderStrong : c.border,
                  opacity: disabled ? 0.55 : 1,
                },
              ]}
            >
              {filled ? (
                <Text variant="title2" align="center" style={styles.digit}>{chars[i]}</Text>
              ) : isActive ? (
                <Animated.View style={[styles.caret, { backgroundColor: c.accent }, caretAnim]} />
              ) : null}
            </View>
          )
        })}
      </Animated.View>

      <TextInput
        ref={ref}
        value={value}
        onChangeText={handle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        caretHidden
        style={styles.hidden}
        {...inputProps}
      />
    </Touchable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  box: { width: 48, height: 56, alignItems: 'center', justifyContent: 'center' },
  digit: { fontVariant: ['tabular-nums'] },
  caret: { width: 2, height: 24, borderRadius: 1 },
  /* Off-screen rather than opacity:0 — an invisible input still in the layout
     steals taps from the boxes it sits on top of. */
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, top: -100 },
})
