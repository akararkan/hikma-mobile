/* =========================================================
   Step 3 of 3 — password, consent, and the one call.

   `register` returns a LIVE session: there is no separate
   login leg, so the moment it resolves the user is signed in
   and the draft — which is holding a plaintext email and
   handle — is dropped.

   The 409 has to be routed, not just shown. USER_DUPLICATE
   carries details.field, and a collision on `username` belongs
   to step 2: stranding the user on a screen with no username
   field on it and an error about their username is the failure
   mode this branch exists to avoid.
   ========================================================= */
import React from 'react'
import { BackHandler, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import {
  api, codeOf, duplicateField, errorText, fieldErrorMap, isDuplicate, isNetworkError,
} from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Field, Icon, Text, Touchable, fireHaptic,
} from '@/ui'
import { clearSignUpDraft, getSignUpDraft } from './_layout'

const MIN = 8
const MAX = 128

export default function SignUpPasswordScreen() {
  const t = useTheme()
  const router = useRouter()
  const { register } = useAuth()

  const [password, setPassword] = React.useState('')
  const [reveal, setReveal] = React.useState(false)
  const [agreed, setAgreed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  const draft = getSignUpDraft()

  /* Back during the in-flight call would leave a created account behind a
     screen that no longer exists. */
  React.useEffect(() => {
    if (!busy) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => sub.remove()
  }, [busy])

  const rules = [
    { label: `At least ${MIN} characters`, ok: password.length >= MIN },
    { label: `At most ${MAX} characters`, ok: password.length > 0 && password.length <= MAX },
    {
      label: 'Not the same as your handle or email',
      ok: password.length > 0
        && password.toLowerCase() !== draft.username.toLowerCase()
        && password.toLowerCase() !== draft.email.toLowerCase(),
    },
  ]
  const passes = rules.every(r => r.ok)
  const strength = scoreOf(password)

  const submit = async () => {
    if (busy || !passes || !agreed) return
    setBusy(true)
    setFormError(null)
    setFieldError(null)
    try {
      await register({
        fname: draft.fname,
        lname: draft.lname,
        username: draft.username,
        email: draft.email,
        password,
      })

      /* Consent evidence for the box the user just ticked. Fire-and-forget:
         a failure here must not undo an account that already exists. */
      void api.settings.app.acceptPolicy('terms').catch(() => {})
      void api.settings.app.acceptPolicy('privacy').catch(() => {})

      fireHaptic('success')
      clearSignUpDraft()
      router.replace('/(auth)/onboarding/verify-email')
    } catch (e: any) {
      setBusy(false)
      fireHaptic('error')

      if (isDuplicate(e)) {
        const field = duplicateField(e)
        if (field === 'username') {
          router.replace({ pathname: '/(auth)/sign-up/account', params: { handleError: errorText(e) } })
          return
        }
        setFormError(e)
        return
      }

      if (codeOf(e) === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e) as Record<string, string>
        /* A validation error about a field that lives on an earlier step has
           to go back to that step; only the password one can render here. */
        if (map.username) {
          router.replace({ pathname: '/(auth)/sign-up/account', params: { handleError: map.username } })
          return
        }
        if (map.email) {
          router.replace({ pathname: '/(auth)/sign-up/account', params: { handleError: map.email } })
          return
        }
        if (map.password) { setFieldError(map.password); return }
        setFormError(e)
        return
      }

      setFormError(e)
    }
  }

  const duplicateEmail = isDuplicate(formError) && duplicateField(formError) === 'email'
  const offline = isNetworkError(formError)

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.content}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        <Text variant="title1" align="ui">Set a password</Text>
        <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          At least {MIN} characters.
        </Text>

        <Field
          label="Password"
          value={password}
          onChangeText={v => { setPassword(v); setFieldError(null); setFormError(null) }}
          error={fieldError}
          icon="lock"
          placeholder="••••••••"
          secureTextEntry={!reveal}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          maxLength={MAX}
          containerStyle={{ marginTop: space.xxl }}
          action={{
            icon: reveal ? 'eyeOff' : 'eye',
            onPress: () => setReveal(r => !r),
            label: reveal ? 'Hide password' : 'Show password',
          }}
        />

        <View style={styles.strength}>
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={[
                styles.strengthSeg,
                {
                  backgroundColor: i < strength
                    ? (strength <= 1 ? t.colors.danger : strength === 2 ? t.colors.warning : t.colors.success)
                    : t.colors.border,
                },
              ]}
            />
          ))}
        </View>

        <View style={{ gap: space.sm, marginTop: space.md }}>
          {rules.map(r => (
            <View key={r.label} style={styles.rule}>
              <View
                style={[
                  styles.ruleDot,
                  {
                    backgroundColor: r.ok ? t.colors.success : 'transparent',
                    borderColor: r.ok ? t.colors.success : t.colors.borderStrong,
                  },
                ]}
              >
                {r.ok ? <Icon name="check" size={10} color={t.colors.textOnAccent} /> : null}
              </View>
              <Text variant="footnote" tone={r.ok ? 'secondary' : 'muted'} align="ui">{r.label}</Text>
            </View>
          ))}
        </View>

        <Touchable
          onPress={() => setAgreed(a => !a)}
          feedback="dim"
          noAutoHitSlop
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          style={[styles.consent, { marginTop: 22 }]}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: agreed ? t.colors.accent : 'transparent',
                borderColor: agreed ? t.colors.accent : t.colors.borderStrong,
                borderRadius: t.radius.xs,
              },
            ]}
          >
            {agreed ? <Icon name="check" size={13} color={t.colors.textOnAccent} /> : null}
          </View>
          <Text variant="subhead" tone="secondary" align="ui" style={{ flex: 1 }}>
            I agree to the <Text variant="subhead" tone="accent" underline>Terms of Service</Text>
            {' '}and <Text variant="subhead" tone="accent" underline>Privacy Policy</Text>.
          </Text>
        </Touchable>

        {formError ? (
          <Callout
            tone="danger"
            actionLabel={duplicateEmail ? 'Sign in instead' : undefined}
            onAction={duplicateEmail ? () => { clearSignUpDraft(); router.replace('/(auth)/sign-in') } : undefined}
            style={{ marginTop: space.lg2 }}
          >
            {errorText(formError)}
          </Callout>
        ) : null}

        <Button
          label={busy ? 'Creating your account…' : 'Create account'}
          onPress={submit}
          variant="primary"
          size="lg"
          block
          loading={busy}
          disabled={!passes || !agreed || busy || offline}
          style={{ marginTop: space.xl }}
        />

        <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.md }}>
          We will email a 6-digit code to verify your address.
        </Text>
      </View>
    </KeyboardAwareScrollView>
  )
}

/* Advisory only — length and variety, nothing the server checks. */
function scoreOf(pw: string): number {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^\w\s]/.test(pw)) s++
  return Math.min(4, s)
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xxl, paddingBottom: space.huge },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  strength: { flexDirection: 'row', gap: space.xs, marginTop: space.md },
  strengthSeg: { flex: 1, height: 4, borderRadius: 2 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  ruleDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2 },
  checkbox: { width: 20, height: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: space.xxs },
})
