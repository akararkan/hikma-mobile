/* =========================================================
   The 2FA login leg.

   `code` takes EITHER the 6-digit authenticator code or a
   single-use recovery code — auth.js is explicit that the
   server tries TOTP first, then recovery, and that the client
   must not pre-classify what was typed. So the two modes here
   differ only in keyboard and copy; both send the string as
   entered.

   Three error codes, three different behaviours:
     MFA_CODE_INVALID       retryable — the challenge survives
     MFA_TOO_MANY_ATTEMPTS  gone
     MFA_CHALLENGE_INVALID  gone
   The dead pair bounce to the password screen carrying the
   server's own message. There is deliberately no "resend":
   TOTP has nothing to resend, and offering it would be a lie.

   `isMfaCodeInvalid` / `isMfaChallengeDead` are not re-exported
   by the '@/api' barrel, hence the deep import.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { errorText, isNetworkError } from '@/api'
import { isMfaCodeInvalid, isMfaChallengeDead } from '@/api/errors.js'
import { useAuth } from '@/context/AuthContext'
import {
  clearMfaChallenge, mfaSecondsLeft, peekMfaChallenge, setSignInNotice,
} from '@/lib/mfaChallenge'
import { OtpInput } from '@/components/auth/OtpInput'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Field, Header, Icon, Screen, Text, Touchable, fireHaptic } from '@/ui'

type Mode = 'totp' | 'recovery'

export default function TwoFactorScreen() {
  const t = useTheme()
  const router = useRouter()
  const { completeTwoFactor } = useAuth()

  const [mode, setMode] = React.useState<Mode>('totp')
  const [code, setCode] = React.useState('')
  const [recovery, setRecovery] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [shakeKey, setShakeKey] = React.useState(0)
  const [left, setLeft] = React.useState(() => mfaSecondsLeft())

  /* A screen reached without a live challenge is a dead end — bounce rather
     than render a form that cannot succeed. */
  React.useEffect(() => {
    if (!peekMfaChallenge()) router.replace('/(auth)/sign-in')
  }, [router])

  const expire = React.useCallback(() => {
    clearMfaChallenge()
    setSignInNotice('This sign-in request expired. Please enter your password again.')
    router.replace('/(auth)/sign-in')
  }, [router])

  React.useEffect(() => {
    const id = setInterval(() => {
      const s = mfaSecondsLeft()
      setLeft(s)
      if (s <= 0) { clearInterval(id); expire() }
    }, 1000)
    return () => clearInterval(id)
  }, [expire])

  const submit = React.useCallback(async (raw?: string) => {
    const challenge = peekMfaChallenge()
    if (!challenge) { router.replace('/(auth)/sign-in'); return }
    const value = (raw ?? (mode === 'totp' ? code : recovery)).trim()
    if (!value) return

    setBusy(true)
    setError(null)
    try {
      await completeTwoFactor({ mfaToken: challenge.mfaToken, code: value })
      clearMfaChallenge()
      fireHaptic('success')
      /* No navigation: `signedIn` flipping true makes the (auth) layout's
         gate redirect into the app. */
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      if (isMfaChallengeDead(e)) {
        clearMfaChallenge()
        setSignInNotice(errorText(e, 'That sign-in request is no longer valid. Please start again.'))
        router.replace('/(auth)/sign-in')
        return
      }
      if (isMfaCodeInvalid(e)) {
        /* The challenge survives — clear the rejected code, keep focus, keep
           the countdown. Both fields: a rejected TOTP is stale forever and a
           rejected recovery code is spent or wrong either way. The server
           counts the 5 attempts; the client must not. */
        setError(errorText(e))
        setCode('')
        setRecovery('')
        setShakeKey(k => k + 1)
        return
      }
      /* Offline: keep what was typed so a retry costs no retyping. */
      setError(errorText(e))
      if (!isNetworkError(e)) setShakeKey(k => k + 1)
    }
  }, [mode, code, recovery, completeTwoFactor, router])

  const back = () => { clearMfaChallenge(); router.replace('/(auth)/sign-in') }

  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  const urgent = left <= 60

  return (
    <Screen>
      <Header back={back} title="Two-factor" border={false} />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={[styles.glyph, { backgroundColor: t.colors.accentSoft }]}>
            <Icon name="shield" size={30} color={t.colors.accent} />
          </View>

          <Text variant="title2" align="center" style={{ marginTop: space.lg2 }}>
            {mode === 'totp' ? 'Enter your code' : 'Use a recovery code'}
          </Text>
          <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs2, maxWidth: 330 }}>
            {mode === 'totp'
              ? 'Open your authenticator app and enter the 6-digit code for Hikmah Web.'
              : 'Enter one of the ten recovery codes you saved when you turned on two-factor.'}
          </Text>

          <View style={{ marginTop: 28, width: '100%' }}>
            {mode === 'totp' ? (
              <OtpInput
                value={code}
                onChangeText={v => { setCode(v); setError(null) }}
                onComplete={v => void submit(v)}
                disabled={busy}
                shakeKey={shakeKey}
                length={6}
                mode="numeric"
              />
            ) : (
              <Field
                value={recovery}
                onChangeText={v => { setRecovery(v.toUpperCase()); setError(null) }}
                placeholder="XXXXX-XXXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
                icon="key"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            )}
          </View>

          {error ? (
            <Text variant="footnote" tone="danger" align="center" style={{ marginTop: space.md2 }} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : (
            <Text
              variant="footnote"
              tone={urgent ? 'danger' : 'muted'}
              align="center"
              style={{ marginTop: space.md2 }}
            >
              {busy ? 'Checking…' : `This request expires in ${mm}:${ss}`}
            </Text>
          )}

          <Button
            label="Verify"
            onPress={() => void submit()}
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={busy || (mode === 'totp' ? code.length < 6 : recovery.trim().length < 4)}
            style={{ marginTop: space.xxl }}
          />

          <Touchable
            onPress={() => {
              setMode(m => (m === 'totp' ? 'recovery' : 'totp'))
              setError(null)
              setCode('')
              setRecovery('')
            }}
            feedback="dim"
            style={styles.switchLink}
          >
            <Text variant="subhead" tone="accent" align="center">
              {mode === 'totp' ? 'Use a recovery code instead' : 'Use the authenticator app instead'}
            </Text>
          </Touchable>

          <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.lg2, maxWidth: 320 }}>
            Codes refresh every 30 seconds. If yours keeps failing, check that your
            phone's clock is set automatically.
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center' },
  glyph: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  switchLink: { paddingVertical: 16 },
})
