/* =========================================================
   Verify your email.

   Registration already sent a code, so this screen opens in
   code-entry mode and does NOT send on mount — the budget is
   three sends per account per hour and spending one on a code
   that is already in the user's inbox is how a legitimate
   resend later gets refused.

   The email code lives 15 minutes. The 5-minute figure belongs
   to the phone flow and must not leak into this copy.

   Verification is worth 50 of the 100 security-checkup points
   and blocks nothing, so Skip is always available and never
   asks twice.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import { api, codeOf, errorText, isNetworkError, isRateLimited } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { useAuth } from '@/context/AuthContext'
import { OtpInput } from '@/components/auth/OtpInput'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, ConfirmSheet, Icon, Screen, Text, Touchable, fireHaptic, useSheetState,
} from '@/ui'
import { OnboardingHeader } from './_layout'

export default function VerifyEmailScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user, refreshUser } = useAuth()

  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [shakeKey, setShakeKey] = React.useState(0)
  const [verified, setVerified] = React.useState(false)
  const wrongAddress = useSheetState()

  const [cooldown, startCooldown] = useCooldown()

  const next = React.useCallback(() => router.replace('/(auth)/onboarding/profile'), [router])

  const finish = React.useCallback(async () => {
    setVerified(true)
    fireHaptic('success')
    await refreshUser()
  }, [refreshUser])

  const submit = React.useCallback(async (raw?: string) => {
    const value = (raw ?? code).trim()
    /* The keyboard path is guarded exactly like the button: five wrong codes
       burn the challenge, and an Enter that bypasses a disabled button is the
       classic way to spend one. */
    if (busy || verified || value.length !== 6) return

    setBusy(true)
    setError(null)
    try {
      await api.security.email.verify(value)
      setBusy(false)
      await finish()
    } catch (e: any) {
      setBusy(false)
      /* Already verified is not a failure — it is the state we wanted. */
      if (codeOf(e) === 'EMAIL_ALREADY_VERIFIED') { await finish(); return }
      if (codeOf(e) === 'EMAIL_MISSING') { next(); return }

      fireHaptic('error')
      setError(errorText(e, 'That code is wrong or has expired.'))
      if (!isNetworkError(e)) { setCode(''); setShakeKey(k => k + 1) }
      if (isRateLimited(e)) startCooldown(e)
    }
  }, [busy, code, verified, finish, next, startCooldown])

  const resend = async () => {
    if (sending || cooldown > 0) return
    setSending(true)
    setError(null)
    try {
      await api.security.email.request()
      startCooldown(30)
      setCode('')
    } catch (e: any) {
      if (codeOf(e) === 'EMAIL_ALREADY_VERIFIED') { await finish(); return }
      /* http.js already flashed the server's own rate-limit line — only the
         countdown is ours to start. */
      if (isRateLimited(e)) startCooldown(e)
      else setError(errorText(e))
    } finally {
      setSending(false)
    }
  }

  const address = user?.email || 'your inbox'

  return (
    <Screen>
      <OnboardingHeader onSkip={verified ? undefined : next} />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {verified ? (
          <Animated.View
            entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(260))}
            style={styles.column}
          >
            <View style={[styles.glyph, { backgroundColor: t.colors.successSoft }]}>
              <Icon name="checkCircle" size={32} color={t.colors.success} filled />
            </View>
            <Text variant="title2" align="center" style={{ marginTop: space.lg2 }}>Email verified</Text>
            <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs2 }}>
              {address} is confirmed. That is half of your security checkup done.
            </Text>
            <Button label="Continue" onPress={next} variant="primary" size="lg" block style={{ marginTop: 28 }} />
          </Animated.View>
        ) : (
          <View style={styles.column}>
            <View style={[styles.glyph, { backgroundColor: t.colors.accentSoft }]}>
              <Icon name="mail" size={30} color={t.colors.accent} />
            </View>

            <Text variant="title2" align="center" style={{ marginTop: space.lg2 }}>Check your inbox</Text>
            <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs2, maxWidth: 330 }}>
              We sent a 6-digit code to <Text variant="callout" weight="700">{address}</Text>.
            </Text>
            <Text variant="footnote" tone="faint" align="center" style={{ marginTop: space.xs2, maxWidth: 330 }}>
              It expires in 15 minutes. Check your spam folder if it has not arrived.
            </Text>

            <View style={{ marginTop: 26, width: '100%' }}>
              <OtpInput
                value={code}
                onChangeText={v => { setCode(v); setError(null) }}
                onComplete={v => void submit(v)}
                disabled={busy}
                shakeKey={shakeKey}
                length={6}
                mode="numeric"
              />
            </View>

            {error ? (
              <Text variant="footnote" tone="danger" align="center" style={{ marginTop: space.md2 }} accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : (
              <View style={{ height: 17, marginTop: space.md2 }} />
            )}

            <View style={styles.helperRow}>
              <Touchable
                onPress={resend}
                disabled={sending || cooldown > 0}
                feedback="dim"
                style={{ paddingVertical: space.sm2 }}
              >
                <Text
                  variant="subhead"
                  tone={sending || cooldown > 0 ? 'faint' : 'accent'}
                  align="ui"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : sending ? 'Sending…' : 'Resend code'}
                </Text>
              </Touchable>

              <Touchable onPress={() => wrongAddress.open()} feedback="dim" style={{ paddingVertical: space.sm2 }}>
                <Text variant="subhead" tone="muted" align="ui">Wrong address?</Text>
              </Touchable>
            </View>

            <Button
              label={busy ? 'Verifying…' : 'Verify'}
              onPress={() => void submit()}
              variant="primary"
              size="lg"
              block
              loading={busy}
              disabled={busy || code.length !== 6}
              style={{ marginTop: space.sm }}
            />

            <Touchable onPress={next} feedback="dim" style={{ paddingVertical: space.lg }}>
              <Text variant="subhead" tone="muted" align="center">I will do this later</Text>
            </Touchable>
          </View>
        )}
      </KeyboardAwareScrollView>

      <ConfirmSheet
        visible={wrongAddress.visible}
        onClose={wrongAddress.close}
        title="The address is fixed"
        message={`${address} was set when the account was created and cannot be changed in the app. Support can change it for you.`}
        confirmLabel="Got it"
        cancelLabel="Close"
        icon="info"
        onConfirm={wrongAddress.close}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xxl, paddingBottom: space.huge },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center' },
  glyph: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  helperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: space.xxs },
})
