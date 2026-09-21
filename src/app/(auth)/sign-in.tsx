/* =========================================================
   Sign in.

   Two error contracts matter here and both come from the docs:

   1. Never re-word what the backend sends. `errorText(e)`
      returns the server's own message for a known envelope, so
      the banner shows that verbatim; only the framing around
      it is ours.
   2. A 2FA account returns a CHALLENGE, not a session —
      nothing is stored, `signedIn` stays false, and the
      mfaToken goes to an in-memory store rather than a route
      param (route params are persisted by the navigator).
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Redirect, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { codeOf, errorText, fieldErrorMap, traceRef } from '@/api'
import { useAuth, useAuthGate } from '@/context/AuthContext'
import { setMfaChallenge, takeSignInNotice } from '@/lib/mfaChallenge'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Divider, Field, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import { BrandBand } from '@/components/brand/BrandBand'

export default function SignInScreen() {
  const t = useTheme()
  const router = useRouter()
  const gate = useAuthGate()
  const { login, consumeSignedOutReason } = useAuth()

  const [identifier, setIdentifier] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [reveal, setReveal] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [notice, setNotice] = React.useState<string | null>(null)

  const passwordRef = React.useRef<any>(null)

  /* Read-and-clear, once: the "why am I here" line must not survive into the
     next attempt. Two sources — http.js parks a signed-out reason, and the
     2FA screen parks a dead-challenge explanation on its way back. */
  React.useEffect(() => {
    setNotice(consumeSignedOutReason() || takeSignInNotice())
  }, [consumeSignedOutReason])

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const res: any = await login({ identifier: identifier.trim(), password })
      if (res?.mfaRequired) {
        setMfaChallenge({ mfaToken: res.mfaToken, expiresIn: res.expiresIn })
        setBusy(false)
        setPassword('')
        router.push('/(auth)/two-factor')
        return
      }
      /* Success needs no navigation — `signedIn` flipping true makes the
         layout's gate redirect. */
      fireHaptic('success')
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')
      const code = codeOf(e)
      if (code === 'VALIDATION_FAILED') {
        setFieldErrors(fieldErrorMap(e, { username: 'identifier' }) as Record<string, string>)
      } else {
        setFormError(e)
        /* Clear the password only — retyping an email you already got right
           is a punishment for the server's mistake. */
        setPassword('')
      }
    }
  }

  if (gate === 'allow') return <Redirect href="/(app)/(tabs)" />

  const code = codeOf(formError)
  const needsHelp = ['AUTH_ACCOUNT_DISABLED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_ACCOUNT_EXPIRED', 'AUTH_CREDENTIALS_EXPIRED'].includes(code)

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.content}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <BrandBand caption="Welcome back" />

      <View style={styles.column}>

        {notice ? (
          <Callout tone="warning" icon="info" onDismiss={() => setNotice(null)} style={{ marginBottom: space.lg2 }}>
            {notice}
          </Callout>
        ) : null}

        {formError ? (
          <Touchable
            onLongPress={async () => {
              const ref = traceRef(formError)
              if (!ref) return
              await Clipboard.setStringAsync(String(ref))
              toast.ok('Diagnostic reference copied')
            }}
            feedback="none"
            noAutoHitSlop
            style={{ marginBottom: space.lg }}
          >
            <Callout
              tone="danger"
              actionLabel={needsHelp ? 'Get help' : undefined}
              onAction={needsHelp ? () => router.push('/(auth)/sign-in-help') : undefined}
            >
              {errorText(formError)}
            </Callout>
          </Touchable>
        ) : null}

        <View style={{ gap: space.md }}>
          <Field
            label="Username or email"
            value={identifier}
            onChangeText={v => { setIdentifier(v); setFieldErrors(f => ({ ...f, identifier: '' })) }}
            error={fieldErrors.identifier || null}
            icon="at"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!busy}
          />
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={v => { setPassword(v); setFieldErrors(f => ({ ...f, password: '' })) }}
            error={fieldErrors.password || null}
            icon="lock"
            placeholder="••••••••"
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
            action={{
              icon: reveal ? 'eyeOff' : 'eye',
              onPress: () => setReveal(r => !r),
              label: reveal ? 'Hide password' : 'Show password',
            }}
          />
        </View>

        <Button
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={submit}
          variant="primary"
          size="lg"
          block
          loading={busy}
          disabled={!canSubmit}
          style={{ marginTop: 22 }}
        />

        <Touchable
          onPress={() => router.push('/(auth)/sign-in-help')}
          feedback="dim"
          style={styles.helpLink}
        >
          <Text variant="subhead" tone="accent" align="center">Trouble signing in?</Text>
        </Touchable>

        <View style={styles.dividerRow}>
          <Divider style={styles.flex} />
          <Text variant="footnote" tone="muted" align="center">New here?</Text>
          <Divider style={styles.flex} />
        </View>

        <Button
          label="Create an account"
          onPress={() => router.push('/(auth)/sign-up')}
          variant="secondary"
          size="lg"
          block
        />
      </View>
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  /* No horizontal padding and no top padding: the brand band is full-bleed and
     pays the status-bar inset itself. The form's own gutter lives on `column`. */
  content: { flexGrow: 1, paddingBottom: space.huge },
  /* Cap the column so the form does not sprawl on a tablet. */
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingHorizontal: space.xxl, paddingTop: 28 },
  helpLink: { paddingVertical: space.md2, alignSelf: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.lg2 },
  flex: { flex: 1 },
})
