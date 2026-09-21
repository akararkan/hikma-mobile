/* =========================================================
   Verify your email.

   The request carries NO destination on purpose: the backend
   reads the address off the account, because a client-supplied
   one would let anyone mark an address they don't own as
   verified — and account recovery trusts that flag. So there is
   no email field on this screen, only the address we already
   hold, shown so the user knows which inbox to open.

   Budgets that shape the controls: 3 sends per account per hour
   and 10 per IP per hour, with 5 wrong codes burning the
   challenge. A 30-second cooldown starts after EVERY send,
   success included — without it a user tapping Resend four
   times is locked out for the rest of the hour.

   The code lives 15 minutes here. The phone flow's is 5. Copying
   the wrong number into this screen's copy is the easiest
   mistake in the tree.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { OtpInput } from '@/components/auth/OtpInput'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, ErrorState, Header, Icon, Screen, ScreenScroll,
  Skeleton, Text, fireHaptic, toast,
} from '@/ui'

const SEND_COOLDOWN_SECONDS = 30

export default function VerifyEmailScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user, refreshUser } = useAuth()

  const me = useAsync<any>(() => api.auth.me(), { deps: [] })
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]
  const [sent, setSent] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [codeError, setCodeError] = React.useState<string | null>(null)
  const [shake, setShake] = React.useState(0)
  const [noAddress, setNoAddress] = React.useState(false)
  const [verified, setVerified] = React.useState(false)

  /* `me` is the authority; the context user is what is on screen before it
     lands, so either saying "verified" is enough to render the done state. */
  const email = me.data?.email || user?.email || ''
  const isVerified = verified || !!me.data?.emailVerified || (!me.data && !!user?.emailVerified)

  const send = useAction(async () => {
    setCodeError(null)
    await api.security.email.request()
    setSent(true)
    /* Every send, not just the rate-limited ones: three of these is the whole
       hourly budget. */
    startCooldown(SEND_COOLDOWN_SECONDS)
  }, {
    onError: e => {
      const err = codeOf(e)
      if (err === 'EMAIL_ALREADY_VERIFIED') {
        /* Stale UI, not a failure. */
        setVerified(true)
        void me.reload()
        void refreshUser()
        return
      }
      if (err === 'EMAIL_MISSING') { setNoAddress(true); return }
      /* http.js has already toasted the 429 line — this only runs the clock. */
      if (startCooldown(e)) return
      toast.error(errorText(e, 'Could not send the code.'))
    },
  })

  const verify = useAction(async (value: string) => {
    setCodeError(null)
    await api.security.email.verify(value)
    fireHaptic('success')
    setVerified(true)
    setCode('')
    await refreshUser()
    void me.reload()
  }, {
    onError: e => {
      if (codeOf(e) === 'EMAIL_ALREADY_VERIFIED') {
        setVerified(true)
        void refreshUser()
        void me.reload()
        return
      }
      setCode('')
      setShake(s => s + 1)
      fireHaptic('error')
      /* The server deliberately does not say whether the code was wrong,
         expired or already spent — so neither does this. */
      setCodeError(errorText(e, 'That code is wrong or has expired.'))
    },
  })

  if (me.loading && !user) {
    return (
      <Screen background="sunken">
        <Header back title="Verify your email" />
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Skeleton height={120} radius={t.radius.card} />
          <Skeleton height={52} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }
  if (me.error && !user) {
    return (
      <Screen background="sunken">
        <Header back title="Verify your email" />
        <ErrorState error={me.error} onRetry={me.reload} />
      </Screen>
    )
  }

  /* ---- done ---- */
  if (isVerified) {
    return (
      <Screen background="sunken">
        <Header back title="Verify your email" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg, alignItems: 'center' }}>
          <Halo icon="success" tone={c.success} soft={c.successSoft} />
          <Text variant="title2" align="center">Your email is verified</Text>
          {email ? (
            <Text variant="callout" tone="muted" align="center" selectable style={{ letterSpacing: 0.3 }}>
              {email}
            </Text>
          ) : null}
          <Card variant="outlined" padding={14} style={{ alignSelf: 'stretch' }}>
            <Text variant="footnote" tone="muted" align="ui">
              This is how you get back into your account if you lose your password
              or your authenticator. Keep the address reachable.
            </Text>
          </Card>
          <Button label="Done" variant="primary" size="lg" block onPress={() => router.back()} />
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- nothing to verify ---- */
  if (noAddress) {
    return (
      <Screen background="sunken">
        <Header back title="Verify your email" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
          <Callout tone="danger" icon="mail" title="There is no email address on this account">
            An address can't be changed from the app yet — contact support to have
            one added, then come back here.
          </Callout>
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- send, then redeem ---- */
  return (
    <Screen background="sunken">
      <Header back title="Verify your email" />
      <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: 16, alignItems: 'center' }}>
        <Halo icon="mail" tone={c.accent} soft={c.accentSoft} />

        <Text variant="title2" align="center">Verify your email</Text>
        <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 340 }}>
          We'll email a 6-digit code to{' '}
          <Text variant="callout" weight="700" align="center">{email || 'the address on your account'}</Text>.
          It expires in 15 minutes.
        </Text>

        {!sent ? (
          <Button
            label={cooldown > 0 ? `Send code in ${cooldown}s` : 'Send code'}
            icon="send"
            variant="primary"
            size="lg"
            block
            loading={send.pending}
            disabled={cooldown > 0}
            onPress={() => void send.run()}
            style={{ marginTop: space.sm }}
          />
        ) : (
          <>
            <View style={{ height: 4 }} />
            <OtpInput
              value={code}
              onChangeText={v => { setCode(v); setCodeError(null) }}
              /* One submit per entered code: each attempt burns one of only
                 five before the challenge is dead. */
              onComplete={v => { if (!verify.pending) void verify.run(v) }}
              disabled={verify.pending}
              shakeKey={shake}
            />

            {codeError ? (
              <Text variant="footnote" tone="danger" align="center" accessibilityLiveRegion="assertive">
                {codeError}
              </Text>
            ) : null}

            <Button
              label="Verify"
              variant="primary"
              size="lg"
              block
              loading={verify.pending}
              disabled={code.length < 6}
              onPress={() => void verify.run(code)}
            />
            <Button
              label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              variant="ghost"
              size="md"
              block
              disabled={cooldown > 0 || send.pending}
              onPress={() => void send.run()}
            />

            <Text variant="footnote" tone="muted" align="center" style={{ maxWidth: 320 }}>
              Check your spam folder — this is the first email you'll get from
              this sender. You can send three codes an hour.
            </Text>
          </>
        )}

        <Card variant="outlined" padding={14} style={{ alignSelf: 'stretch', marginTop: 8 }}>
          <Text variant="subhead" weight="700" align="ui">Why this matters</Text>
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: 4 }}>
            A verified address clears two items on your security checkup at once,
            and it is how you get back into your account if you lose your phone.
          </Text>
        </Card>
      </ScreenScroll>
    </Screen>
  )
}

function Halo({ icon, tone, soft }: { icon: 'mail' | 'success'; tone: string; soft: string }) {
  return (
    <View
      style={{
        width: 72,
        height: 72,
        borderRadius: 999,
        backgroundColor: soft,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
      }}
    >
      <Icon name={icon} size={34} color={tone} />
    </View>
  )
}
