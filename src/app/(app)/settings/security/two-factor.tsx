/* =========================================================
   Two-factor authentication.

   The enrolment flow has one property that dictates the whole
   screen: `2fa/setup` shows the secret ONCE. There is no way
   to read it back, so the QR and the typed secret must both be
   on screen at the same time and must survive a mis-tap — a
   user who backgrounds the app mid-setup and returns to an
   empty screen has to start over, and that is on us.

   `setup`, `disable` and `regenerateRecovery` all require
   step-up. StepUpHost is mounted app-wide, so the 403 replay
   happens without this screen doing anything — the calls just
   take a moment longer while the sheet is open.

   `verify` returns the ten recovery codes on FIRST enable and
   an empty array on re-verify. Those codes are also shown once.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { OtpInput } from '@/components/auth/OtpInput'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, ConfirmSheet, GroupFooter, GroupLabel, Header, ListRow,
  RowGroup, Screen, ScreenScroll, Text, Touchable, useSheetState, fireHaptic, toast,
} from '@/ui'

type Stage = 'idle' | 'enrolling' | 'codes'

export default function TwoFactorSettings() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { refreshUser } = useAuth()

  const status = useAsync<any>(() => api.security.twofa.status(), { deps: [] })
  const [stage, setStage] = React.useState<Stage>('idle')
  const [secret, setSecret] = React.useState<{ uri: string; secret: string } | null>(null)
  const [code, setCode] = React.useState('')
  const [codes, setCodes] = React.useState<string[]>([])
  const [shake, setShake] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const disable = useSheetState()

  const begin = useAction(async () => {
    setError(null)
    const res: any = await api.security.twofa.setup()
    setSecret({ uri: res?.provisioningUri || '', secret: res?.secret || '' })
    setStage('enrolling')
  }, {
    onError: e => {
      /* TWO_FA_ALREADY_ON included — the server's own sentence is shown, and
         the status reload flips the screen to the enabled state it missed. */
      toast.error(errorText(e, 'Could not start setup.'))
      void status.reload()
    },
  })

  const verify = useAction(async (value: string) => {
    setError(null)
    const res: any = await api.security.twofa.verify(value)
    fireHaptic('success')
    const fresh: string[] = Array.isArray(res?.codes) ? res.codes : []
    await status.reload()
    await refreshUser()
    if (fresh.length) { setCodes(fresh); setStage('codes') }
    else { setStage('idle'); setSecret(null); toast.ok('Two-factor is on') }
    setCode('')
  }, {
    onError: e => {
      setCode('')
      setShake(s => s + 1)
      fireHaptic('error')
      setError(errorText(e, 'That code is not right. Check your authenticator app.'))
    },
  })

  const turnOff = useAction(async () => {
    await api.security.twofa.disable()
    await status.reload()
    await refreshUser()
    setStage('idle')
    setSecret(null)
    toast.ok('Two-factor is off')
  }, { onError: e => toast.error(errorText(e, 'Could not turn two-factor off.')) })

  const enabled = !!status.data?.enabled

  /* ---- the recovery codes hand-off ---- */
  if (stage === 'codes') {
    return (
      <Screen background="sunken">
        <Header title="Save these codes" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
          <Callout tone="warning" title="This is the only time you'll see these" icon="key">
            Each code works once. Keep them somewhere you can reach WITHOUT your
            phone — that is the whole point of them.
          </Callout>

          <Card variant="outlined" padding={18}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {codes.map((v, i) => (
                <View key={i} style={{ width: '50%', paddingVertical: space.sm }}>
                  <Text variant="body" align="left" selectable style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
                    {v}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Button
            label="Copy all codes"
            icon="copy"
            variant="secondary"
            size="lg"
            block
            onPress={async () => { await Clipboard.setStringAsync(codes.join('\n')); toast.ok('Copied') }}
          />
          <Button
            label="I've saved them"
            variant="primary"
            size="lg"
            block
            onPress={() => { setCodes([]); setStage('idle'); setSecret(null); toast.ok('Two-factor is on') }}
          />
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- enrolment ---- */
  if (stage === 'enrolling' && secret) {
    return (
      <Screen background="sunken">
        <Header
          back={() => { setStage('idle'); setSecret(null); setCode('') }}
          title="Set up two-factor"
        />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, alignItems: 'center', gap: space.md2 }}>
          <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 340 }}>
            Scan this with an authenticator app — Google Authenticator, 1Password,
            Aegis, or any other.
          </Text>

          {secret.uri ? (
            <View style={{ backgroundColor: c.qrPlate, padding: space.lg2, borderRadius: t.radius.xl, marginTop: space.xs2 }}>
              <QRCode value={secret.uri} size={196} color={c.qrInk} backgroundColor={c.qrPlate} ecl="M" />
            </View>
          ) : null}

          {secret.secret ? (
            <Touchable
              onPress={async () => { await Clipboard.setStringAsync(secret.secret); toast.ok('Secret copied') }}
              feedback="scale"
              style={{
                backgroundColor: c.surface,
                borderRadius: t.radius.sm,
                paddingHorizontal: space.md2,
                paddingVertical: space.sm2,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm2,
              }}
            >
              <Text variant="footnote" tone="muted">Can't scan?</Text>
              <Text variant="footnote" selectable style={{ letterSpacing: 1.4 }}>{secret.secret}</Text>
            </Touchable>
          ) : null}

          <Text variant="subhead" align="center" style={{ marginTop: 18 }}>
            Enter the 6-digit code it shows
          </Text>

          <OtpInput
            value={code}
            onChangeText={v => { setCode(v); setError(null) }}
            onComplete={v => void verify.run(v)}
            disabled={verify.pending}
            shakeKey={shake}
          />

          {error ? (
            <Text variant="footnote" tone="danger" align="center" accessibilityLiveRegion="assertive">{error}</Text>
          ) : null}

          <Button
            label="Turn on two-factor"
            onPress={() => void verify.run(code)}
            loading={verify.pending}
            disabled={code.length < 6}
            variant="primary"
            size="lg"
            block
            style={{ marginTop: 8 }}
          />
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- the resting state ---- */
  return (
    <Screen background="sunken">
      <Header back title="Two-factor" />
      <ScreenScroll refreshing={status.refreshing} onRefresh={status.refresh}>
        <View style={{ padding: t.layout.screenPadding }}>
          <Callout
            tone={enabled ? 'success' : 'neutral'}
            icon="shield"
            title={enabled ? 'Two-factor is on' : 'Two-factor is off'}
          >
            {enabled
              ? 'Signing in needs a code from your authenticator app as well as your password.'
              : 'Add a second step so a stolen password alone is not enough to get in.'}
          </Callout>
        </View>

        {enabled ? (
          <>
            <GroupLabel>Recovery</GroupLabel>
            <RowGroup>
              <ListRow
                title="Recovery codes"
                subtitle={typeof status.data?.recoveryCodesRemaining === 'number'
                  ? `${status.data.recoveryCodesRemaining} unused`
                  : undefined}
                icon="key"
                iconTone={status.data?.recoveryCodesRemaining <= 2 ? 'warning' : 'neutral'}
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push('/settings/security/recovery-codes')}
              />
            </RowGroup>
            <GroupFooter>
              Recovery codes are how you get back in if you lose your phone.
              Generating a new set invalidates the old one.
            </GroupFooter>

            <View style={{ height: 12 }} />
            <RowGroup>
              <ListRow title="Turn off two-factor" icon="unlock" destructive onPress={disable.open} />
            </RowGroup>
          </>
        ) : (
          <View style={{ padding: t.layout.screenPadding }}>
            <Button
              label="Set up two-factor"
              icon="shield"
              onPress={() => void begin.run()}
              loading={begin.pending}
              variant="primary"
              size="lg"
              block
            />
          </View>
        )}
      </ScreenScroll>

      <ConfirmSheet
        visible={disable.visible}
        onClose={disable.close}
        title="Turn off two-factor?"
        message="Your password alone will be enough to sign in, and your recovery codes stop working."
        confirmLabel="Turn off"
        destructive
        loading={turnOff.pending}
        icon="unlock"
        onConfirm={async () => { await turnOff.run(); disable.close() }}
      />
    </Screen>
  )
}
