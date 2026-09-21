/* =========================================================
   StepUpHost — the 403 STEP_UP_REQUIRED surface.

   http.js's contract: a guarded action answers 403 with
   errorCode STEP_UP_REQUIRED when the short-lived marker is
   not armed. That is NOT a permission failure — the user is
   allowed, they just have to re-prove presence. The HTTP layer
   calls the registered prompt, and if it resolves true the
   ORIGINAL request is replayed once. The server window (~5 min)
   then covers the rest of a batch, so a run of sensitive
   actions prompts once rather than per tap.

   Mounted once in the root layout. With nothing registered the
   403 falls through to the caller unchanged, which is what a
   signed-out shell and the tests want.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, setStepUpPrompt, errorText, isRateLimited, cooldownSecondsFrom } from '@/api'
import { Sheet, Button, Field, Text, SegmentedControl, Callout } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'

type Resolver = (armed: boolean) => void
type Method = 'password' | 'code'

export function StepUpHost() {
  const t = useTheme()
  const [visible, setVisible] = React.useState(false)
  const [method, setMethod] = React.useState<Method>('password')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [reveal, setReveal] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [twoFaOn, setTwoFaOn] = React.useState(false)

  const resolver = React.useRef<Resolver | null>(null)

  const finish = React.useCallback((armed: boolean) => {
    resolver.current?.(armed)
    resolver.current = null
    setVisible(false)
    setPassword('')
    setCode('')
    setError(null)
    setBusy(false)
  }, [])

  React.useEffect(() => {
    setStepUpPrompt(() => new Promise<boolean>(resolve => {
      /* A second 403 while the sheet is already open should never orphan the
         first caller: resolve it false, then take over. */
      resolver.current?.(false)
      resolver.current = resolve
      setError(null)
      setVisible(true)
      /* Offer the authenticator tab only when the account actually has one. */
      api.security.twofa.status()
        .then((s: any) => {
          const on = !!s?.enabled
          setTwoFaOn(on)
          setMethod(on ? 'code' : 'password')
        })
        .catch(() => { setTwoFaOn(false); setMethod('password') })
    }))
    return () => setStepUpPrompt(null as any)
  }, [])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.security.stepUp(method === 'password' ? { password } : { code: code.trim() })
      finish(true)
    } catch (e: any) {
      setBusy(false)
      if (isRateLimited(e)) {
        const s = cooldownSecondsFrom(e)
        setError(s > 0 ? `Too many attempts. Try again in ${s}s.` : 'Too many attempts. Try again shortly.')
      } else {
        setError(errorText(e, method === 'password' ? 'That password is not right.' : 'That code is not right.'))
      }
    }
  }

  const canSubmit = method === 'password' ? password.length > 0 : code.trim().length >= 6

  return (
    <Sheet
      visible={visible}
      onClose={() => finish(false)}
      title="Confirm it's you"
      subtitle="This action needs you to re-authenticate."
      maxHeightRatio={0.7}
      footer={
        <View style={{ gap: space.sm }}>
          <Button
            label="Confirm"
            onPress={submit}
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!canSubmit}
          />
          <Button label="Cancel" onPress={() => finish(false)} variant="ghost" size="md" block />
        </View>
      }
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
        {twoFaOn ? (
          <SegmentedControl<Method>
            value={method}
            onChange={m => { setMethod(m); setError(null) }}
            options={[
              { value: 'code', label: 'Authenticator', icon: 'shield' },
              { value: 'password', label: 'Password', icon: 'key' },
            ]}
          />
        ) : null}

        {method === 'password' ? (
          <Field
            label="Your password"
            value={password}
            onChangeText={v => { setPassword(v); setError(null) }}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            icon="lock"
            placeholder="••••••••"
            error={error}
            action={{ icon: reveal ? 'eyeOff' : 'eye', onPress: () => setReveal(r => !r), label: reveal ? 'Hide password' : 'Show password' }}
            onSubmitEditing={() => { if (canSubmit) void submit() }}
            returnKeyType="go"
          />
        ) : (
          <Field
            label="6-digit code"
            value={code}
            onChangeText={v => { setCode(v.replace(/\D/g, '').slice(0, 8)); setError(null) }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            icon="shield"
            placeholder="123456"
            maxLength={8}
            hint="From your authenticator app. A recovery code works too."
            error={error}
            onSubmitEditing={() => { if (canSubmit) void submit() }}
            returnKeyType="go"
          />
        )}

        <Callout tone="neutral" icon="clock">
          Once confirmed, you won't be asked again for a few minutes.
        </Callout>
      </View>
    </Sheet>
  )
}
