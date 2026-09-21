/* =========================================================
   Phone number.

   Two things about this flow are counter-intuitive and both are
   said out loud on the screen:

   1. The code arrives by EMAIL. There is no SMS gateway. A
      screen that says "we texted you" leaves people staring at
      a phone that will never buzz, so the destination shown is
      the account's email address.
   2. A bound number cannot be read back. `verify` writes
      phoneE164 on the user, but no DTO exposes it and there is
      no GET. So this screen only ever reports what it just set,
      cached on the device and labelled as such — claiming
      "verified" from a value we merely remember would be a lie
      the moment the app is reinstalled.

   The assembly rule is exact, and getting it wrong is the
   double-country-code bug the backend had to fix: if the typed
   value already begins with '+' or '00', send it verbatim and
   ignore the picker. Otherwise send '+{dial}' plus the digits
   with a single leading trunk zero removed. The same string then
   goes to verify() — the OTP is keyed on it.
   ========================================================= */
import React from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { COUNTRIES, dialOf, flagOf } from '@/lib/dialCodes.js'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { OtpInput } from '@/components/auth/OtpInput'
import { storage } from '@/platform/storage'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, Header, Icon, Screen, ScreenScroll, SearchField, Sheet,
  Text, Touchable, useSheetState, fireHaptic,
} from '@/ui'

/** Device-local only — see the header. Never treated as server state. */
const CACHE_KEY = 'ika:phone-verified'
const SEND_COOLDOWN_SECONDS = 45
const MAX_CODE_ATTEMPTS = 5

type Country = { iso2: string; name: string; dial: string }

export default function PhoneScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const countrySheet = useSheetState()

  const me = useAsync<any>(() => api.auth.me(), { deps: [] })
  const destination = me.data?.email || user?.email || 'the email on your account'

  const [iso2, setIso2] = React.useState('IQ')
  const [typed, setTyped] = React.useState('')
  const [phoneError, setPhoneError] = React.useState<string | null>(null)

  /* The exact string sent to request(), kept so verify() sends the identical
     one — the challenge is keyed on it, not on the digits. */
  const [wire, setWire] = React.useState<string | null>(null)
  const [code, setCode] = React.useState('')
  const [codeError, setCodeError] = React.useState<string | null>(null)
  const [shake, setShake] = React.useState(0)
  const [attempts, setAttempts] = React.useState(0)
  const [burned, setBurned] = React.useState(false)
  const [bound, setBound] = React.useState(false)

  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]
  const [verifiedE164, setVerifiedE164] = React.useState<string | null>(
    () => storage.getItem(CACHE_KEY),
  )
  const [justVerified, setJustVerified] = React.useState(false)

  const send = useAction(async () => {
    setPhoneError(null)
    const value = toWire(typed, dialOf(iso2))
    if (!value || digitsOf(value).length < 8) {
      setPhoneError('That does not look like a full phone number.')
      return
    }
    await api.security.phone.request(value)
    setWire(value)
    setCode('')
    setCodeError(null)
    setAttempts(0)
    setBurned(false)
    startCooldown(SEND_COOLDOWN_SECONDS)
  }, {
    onError: e => {
      const err = codeOf(e)
      if (err === 'PHONE_ALREADY_BOUND') { setBound(true); return }
      if (err === 'PHONE_REQUIRED' || err === 'PHONE_INVALID') {
        setPhoneError(errorText(e, 'That number was not accepted.'))
        return
      }
      /* http.js already toasted the rate-limit line; this only runs the clock. */
      if (startCooldown(e)) return
      setPhoneError(errorText(e, 'Could not send the code.'))
    },
  })

  const verify = useAction(async (value: string) => {
    if (!wire) return
    setCodeError(null)
    const res: any = await api.security.phone.verify(wire, value)
    /* Display the canonical E.164 the server returned, not what was typed. */
    const canonical = String(res?.phone || wire)
    storage.setItem(CACHE_KEY, canonical)
    setVerifiedE164(canonical)
    setJustVerified(true)
    fireHaptic('success')
  }, {
    onError: e => {
      const err = codeOf(e)
      if (err === 'PHONE_ALREADY_BOUND') { setBound(true); return }
      setCode('')
      setShake(s => s + 1)
      fireHaptic('error')
      const next = attempts + 1
      setAttempts(next)
      if (next >= MAX_CODE_ATTEMPTS) {
        setBurned(true)
        setCodeError('Too many attempts — request a new code.')
        return
      }
      setCodeError(errorText(e, 'That code is wrong or has expired.'))
    },
  })

  /* ---- one number, one account ---- */
  if (bound) {
    return (
      <Screen background="sunken">
        <Header back title="Phone number" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
          <Callout tone="danger" icon="phone" title="This number is already verified on another account">
            A phone number can only be attached to one Hikmah Web account. Sign in to the
            account that holds it, or use a different number.
          </Callout>
          <Button label="Use a different number" variant="secondary" size="lg" block
            onPress={() => { setBound(false); setWire(null); setTyped('') }} />
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- verified in this session ---- */
  if (justVerified) {
    return (
      <Screen background="sunken">
        <Header back title="Phone number" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg, alignItems: 'center' }}>
          <View
            style={{
              width: 72, height: 72, borderRadius: 999, marginTop: space.md,
              backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="success" size={34} color={c.success} />
          </View>
          <Text variant="title2" align="center">Verified</Text>
          <Text variant="title3" align="center" selectable style={{ letterSpacing: 1 }}>
            {verifiedE164}
          </Text>
          <Card variant="outlined" padding={14} style={{ alignSelf: 'stretch' }}>
            <Text variant="footnote" tone="muted" align="ui">
              People who have this number saved can now find you — unless you turn
              that off under Discovery.
            </Text>
          </Card>
          <Button
            label="Discovery settings"
            variant="secondary"
            size="lg"
            block
            onPress={() => router.replace('/settings/discovery')}
          />
          <Button label="Done" variant="primary" size="lg" block onPress={() => router.back()} />
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- enter the code ---- */
  if (wire) {
    return (
      <Screen background="sunken">
        <Header back={() => setWire(null)} title="Enter the code" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg, alignItems: 'center' }}>
          <Text variant="title2" align="center" style={{ marginTop: space.md }}>Enter the code</Text>
          <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 340 }}>
            Sent to <Text variant="callout" weight="700" align="center">{destination}</Text> for{' '}
            <Text variant="callout" weight="700" align="center">{wire}</Text>. It expires in 5 minutes.
          </Text>

          <OtpInput
            value={code}
            onChangeText={v => { setCode(v); setCodeError(null) }}
            /* One submit per code — five wrong ones burn the challenge. */
            onComplete={v => { if (!verify.pending && !burned) void verify.run(v) }}
            disabled={verify.pending || burned}
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
            disabled={code.length < 6 || burned}
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
          <Touchable onPress={() => { setWire(null); setCode(''); setCodeError(null) }} feedback="dim">
            <Text variant="subhead" tone="accent" align="center">Change number</Text>
          </Touchable>

          <Text variant="footnote" tone="muted" align="center" style={{ maxWidth: 320 }}>
            Three codes per number per hour. There is no SMS — the code is emailed.
          </Text>
        </ScreenScroll>
      </Screen>
    )
  }

  /* ---- enter the number ---- */
  const dial = dialOf(iso2)

  return (
    <Screen background="sunken">
      <Header back title="Phone number" />
      <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
        <Text variant="title2" align="ui" style={{ marginTop: space.sm }}>Add your phone number</Text>
        <Text variant="callout" tone="muted" align="ui">
          People who have your number saved can find you — you decide that under
          Discovery.
        </Text>

        {verifiedE164 ? (
          /* Device-local, and said so: there is no endpoint that reads a bound
             number back, so this is a memory of this phone, not account state. */
          <Callout tone="neutral" icon="devices" title={`Last verified on this device: ${verifiedE164}`}>
            We can't read a bound number back from the server, so this is only what
            this phone remembers. Verifying again is harmless.
          </Callout>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch' }}>
          <Touchable
            onPress={countrySheet.open}
            feedback="tint"
            noAutoHitSlop
            accessibilityLabel="Choose country code"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              height: 48,
              borderRadius: t.radius.field,
              backgroundColor: c.surfaceSunken,
              borderWidth: 1,
              borderColor: phoneError ? c.danger : c.border,
            }}
          >
            <Text variant="body">{flagOf(iso2)}</Text>
            <Text variant="body" align="ui">+{dial}</Text>
            <Icon name="down" size={14} color={c.textMuted} />
          </Touchable>

          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: 13,
              height: 48,
              borderRadius: t.radius.field,
              backgroundColor: c.surfaceSunken,
              borderWidth: phoneError ? 1.5 : 1,
              borderColor: phoneError ? c.danger : c.border,
            }}
          >
            <TextInput
              value={typed}
              onChangeText={v => { setTyped(v); setPhoneError(null) }}
              placeholder="750 123 4567"
              placeholderTextColor={c.textFaint}
              selectionColor={c.accent}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              returnKeyType="done"
              onSubmitEditing={() => void send.run()}
              style={{
                padding: 0,
                margin: 0,
                color: c.text,
                fontSize: t.type.body.fontSize,
                /* A phone number is LTR even in an Arabic interface. */
                textAlign: 'left',
                writingDirection: 'ltr',
              }}
            />
          </View>
        </View>

        {phoneError ? (
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <Icon name="error" size={13} color={c.danger} />
            <Text variant="footnote" tone="danger" align="ui" style={{ flex: 1 }}>{phoneError}</Text>
          </View>
        ) : null}

        <Callout tone="warning" icon="mail" title="The code comes by email">
          There is no SMS. We'll email the 6-digit code to {destination}.
        </Callout>

        <Button
          label={cooldown > 0 ? `Send code in ${cooldown}s` : 'Send code'}
          icon="send"
          variant="primary"
          size="lg"
          block
          loading={send.pending}
          disabled={cooldown > 0 || !typed.trim()}
          onPress={() => void send.run()}
        />
      </ScreenScroll>

      <CountrySheet
        visible={countrySheet.visible}
        onClose={countrySheet.close}
        selected={iso2}
        onSelect={v => { setIso2(v); countrySheet.close() }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The assembly rule, verbatim from the phone-verification
   guide. Never glue the picker's code onto a number that
   already carries one.
   --------------------------------------------------------- */
function toWire(typed: string, dial: string): string {
  const raw = String(typed || '').trim()
  if (!raw) return ''
  if (raw.startsWith('+')) return `+${digitsOf(raw)}`
  if (raw.startsWith('00')) return `+${digitsOf(raw.slice(2))}`
  const local = digitsOf(raw).replace(/^0/, '')   // a single trunk zero, not all of them
  if (!local || !dial) return local ? `+${local}` : ''
  /* Already carries the country code, just without the '+'. Prefixing the
     picker's dial here is the double-country-code bug, so don't. The length
     guard keeps a genuinely local number that happens to start with the same
     digits from being misread as international. */
  if (local.startsWith(dial) && local.length >= dial.length + 8) return `+${local}`
  return `+${dial}${local}`
}

const digitsOf = (s: string) => String(s || '').replace(/\D/g, '')

function CountrySheet({
  visible, onClose, selected, onSelect,
}: {
  visible: boolean
  onClose: () => void
  selected: string
  onSelect: (iso2: string) => void
}) {
  const t = useTheme()
  const [q, setQ] = React.useState('')

  React.useEffect(() => { if (!visible) setQ('') }, [visible])

  const rows: Country[] = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = COUNTRIES as Country[]
    if (!needle) return all
    return all.filter(c =>
      c.name.toLowerCase().includes(needle) ||
      c.dial.startsWith(needle.replace(/^\+/, '')) ||
      c.iso2.toLowerCase() === needle)
  }, [q])

  return (
    <Sheet visible={visible} onClose={onClose} title="Country code" maxHeightRatio={0.88}>
      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md, paddingBottom: space.sm }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search countries" />
      </View>
      {rows.map(row => (
        <Touchable
          key={row.iso2}
          onPress={() => onSelect(row.iso2)}
          feedback="tint"
          noAutoHitSlop
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: t.layout.screenPadding,
            paddingVertical: space.md,
          }}
        >
          <Text variant="body">{flagOf(row.iso2)}</Text>
          <Text variant="body" align="ui" style={{ flex: 1 }} numberOfLines={1}>{row.name}</Text>
          <Text variant="callout" tone="muted">+{row.dial}</Text>
          {row.iso2 === selected ? <Icon name="check" size={18} color={t.colors.accent} /> : null}
        </Touchable>
      ))}
    </Sheet>
  )
}
