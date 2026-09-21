/* =========================================================
   Change password.

   `auth.changePassword` returns a fresh access token, which
   the api module already stores — so the user stays signed in
   HERE while every other session is invalidated server-side.
   The copy says that outright, because "why did my tablet sign
   out?" is the support question this screen generates.

   Strength is shown, never enforced beyond the server's own
   rule: a client-side policy that is stricter than the
   backend's rejects passwords the server would accept, and one
   that is looser produces a confusing 400.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText, fieldErrorMap } from '@/api'
import { useAction } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Callout, Field, Header, Screen, Text, toast } from '@/ui'

export default function ChangePassword() {
  const t = useTheme()
  const router = useRouter()

  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [reveal, setReveal] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)

  const currentRef = React.useRef<any>(null)
  const nextRef = React.useRef<any>(null)
  const confirmRef = React.useRef<any>(null)

  const mismatch = confirm.length > 0 && next !== confirm
  const strength = scorePassword(next)

  const save = useAction(async () => {
    setErrors({})
    setFormError(null)
    if (next !== confirm) { setErrors({ confirm: "These don't match." }); return }
    await api.auth.changePassword(current, next)
    toast.ok('Password changed')
    router.back()
  }, {
    onError: e => {
      const code = codeOf(e)
      if (code === 'VALIDATION_FAILED') {
        setErrors(fieldErrorMap(e, { newPassword: 'next', currentPassword: 'current' }) as Record<string, string>)
      } else if (code === 'AUTH_CURRENT_PASSWORD_INVALID') {
        /* A wrong current password belongs on its own field — it is a typo,
           not a form-level failure, and the 401 never touches the session
           (http.js exempts /api/v1/auth/ paths from the refresh dance). */
        setErrors({ current: errorText(e) })
        setCurrent('')
        currentRef.current?.focus()
      } else if (code === 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT') {
        setErrors({ next: errorText(e) })
        nextRef.current?.focus()
      } else {
        setFormError(e)
        setCurrent('')
      }
    },
  })

  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !mismatch

  return (
    <Screen>
      <Header back title="Change password" />
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: space.xl, paddingBottom: space.huge }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ maxWidth: 420, alignSelf: 'center', width: '100%', gap: space.md }}>
          {formError ? <Callout tone="danger">{errorText(formError)}</Callout> : null}

          <Field
            ref={currentRef}
            label="Current password"
            value={current}
            onChangeText={v => { setCurrent(v); setErrors(e => ({ ...e, current: '' })) }}
            error={errors.current || null}
            icon="lock"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
          />

          <Field
            ref={nextRef}
            label="New password"
            value={next}
            onChangeText={v => { setNext(v); setErrors(e => ({ ...e, next: '' })) }}
            error={errors.next || null}
            icon="key"
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            action={{
              icon: reveal ? 'eyeOff' : 'eye',
              onPress: () => setReveal(r => !r),
              label: reveal ? 'Hide password' : 'Show password',
            }}
          />

          {next ? (
            <View style={{ gap: space.xs2, marginTop: -space.xs }}>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                {[0, 1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: i < strength.score
                        ? (strength.score <= 1 ? t.colors.danger : strength.score === 2 ? t.colors.warning : t.colors.success)
                        : t.colors.surfaceSunken,
                    }}
                  />
                ))}
              </View>
              <Text variant="caption" tone="muted" align="ui">{strength.hint}</Text>
            </View>
          ) : null}

          <Field
            ref={confirmRef}
            label="Confirm new password"
            value={confirm}
            onChangeText={v => { setConfirm(v); setErrors(e => ({ ...e, confirm: '' })) }}
            error={errors.confirm || (mismatch ? "These don't match." : null)}
            icon="key"
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => { if (canSubmit) void save.run() }}
          />

          <Callout tone="neutral" icon="devices" style={{ marginTop: space.xs2 }}>
            Changing your password signs out every other device. You'll stay signed
            in here.
          </Callout>

          <Button
            label="Change password"
            onPress={() => void save.run()}
            loading={save.pending}
            disabled={!canSubmit}
            variant="primary"
            size="lg"
            block
            style={{ marginTop: 8 }}
          />
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

/** A hint, not a gate. The server owns the actual rule. */
function scorePassword(p: string): { score: number; hint: string } {
  if (!p) return { score: 0, hint: '' }
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 14) score++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++
  if (/\d/.test(p) && /[^\w\s]/.test(p)) score++
  const hint = score <= 1 ? 'Short and easy to guess — try a longer phrase.'
    : score === 2 ? 'Reasonable. A few more words would help.'
      : score === 3 ? 'Good.'
        : 'Strong.'
  return { score: Math.max(1, score), hint }
}
