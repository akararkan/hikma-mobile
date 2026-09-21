/* =========================================================
   Step 2 of 3 — handle and email.

   The handle probe is a COURTESY, never a gate: it is a
   debounced GET /users/username/{handle} whose 200 means taken
   and whose 404 means free, and the authoritative check is the
   409 that register answers. So a failed probe stays silent and
   Continue is never blocked on it.

   There is deliberately no email probe. GET /users/email/{email}
   is a public exact-match lookup, and calling it from a signup
   form turns the client into an address-enumeration oracle. The
   duplicate is learned at register, which is the one surface
   that legitimately reports one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { ActivityIndicator } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, isNotFound } from '@/api'
import { useDebounced } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Field, Icon, Text } from '@/ui'
import { getSignUpDraft, setSignUpDraft } from './_layout'

const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Availability = 'idle' | 'checking' | 'free' | 'taken'

export default function SignUpAccountScreen() {
  const t = useTheme()
  const router = useRouter()
  /* The password step bounces back here on a username collision, carrying the
     server's own sentence rather than a re-worded one. */
  const params = useLocalSearchParams<{ handleError?: string }>()

  const [handle, setHandle] = React.useState(() => getSignUpDraft().username)
  const [email, setEmail] = React.useState(() => getSignUpDraft().email)
  const [errors, setErrors] = React.useState<{ handle?: string; email?: string }>(
    () => (params.handleError ? { handle: String(params.handleError) } : {}),
  )
  const [availability, setAvailability] = React.useState<Availability>(
    () => (params.handleError ? 'taken' : 'idle'),
  )

  const emailRef = React.useRef<any>(null)
  const debouncedHandle = useDebounced(handle.trim(), 500)

  const handleShapeError = React.useCallback((value: string): string | null => {
    if (!value) return null
    if (value.length < 3 || value.length > 50) return 'Username must be between 3 and 50 characters'
    if (!HANDLE_RE.test(value)) return 'Username may only contain letters, digits, dots, hyphens, and underscores'
    return null
  }, [])

  const shapeError = handleShapeError(handle.trim())

  /* A generation counter rather than an AbortController: users.getByUsername
     takes no signal, so the only way to drop a stale answer is to know it is
     stale when it lands. */
  const gen = React.useRef(0)

  React.useEffect(() => {
    const value = debouncedHandle
    const mine = ++gen.current

    if (!value || handleShapeError(value)) { setAvailability('idle'); return }

    setAvailability('checking')
    api.users.getByUsername(value)
      .then(() => { if (mine === gen.current) setAvailability('taken') })
      .catch((e: any) => {
        if (mine !== gen.current) return
        /* 404 is the answer we want. Anything else — offline, a 500 — leaves
           the slot empty rather than claiming a handle is free. */
        setAvailability(isNotFound(e) ? 'free' : 'idle')
      })
  }, [debouncedHandle, handleShapeError])

  const emailShapeError = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Must be a valid email address' : null
  const canContinue = !!handle.trim() && !shapeError && !!email.trim() && !emailShapeError

  const submit = () => {
    const next: { handle?: string; email?: string } = {}
    if (!handle.trim()) next.handle = 'Username is required'
    else if (shapeError) next.handle = shapeError
    if (!email.trim()) next.email = 'Email is required'
    else if (emailShapeError) next.email = emailShapeError
    setErrors(next)
    if (Object.keys(next).length) return

    setSignUpDraft({ username: handle.trim(), email: email.trim() })
    router.push('/(auth)/sign-up/password')
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.content}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        <Text variant="title1" align="ui">Pick your handle</Text>
        <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          Your handle is public — it appears on your posts and mentions. Your email stays private.
        </Text>

        <View style={{ gap: space.xs, marginTop: 26 }}>
          <Field
            label="Handle"
            value={handle}
            onChangeText={v => { setHandle(v); setErrors(e => ({ ...e, handle: undefined })) }}
            error={errors.handle || null}
            icon="at"
            placeholder="ahmad.rashid"
            maxLength={50}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />

          <View style={styles.statusRow}>
            <View style={styles.statusSlot}>
              {availability === 'checking' ? (
                <ActivityIndicator size="small" color={t.colors.textMuted} />
              ) : availability === 'free' ? (
                <Icon name="checkCircle" size={16} color={t.colors.success} filled />
              ) : availability === 'taken' ? (
                <Icon name="error" size={16} color={t.colors.danger} />
              ) : null}
            </View>
            <Text
              variant="footnote"
              tone={shapeError ? 'danger' : availability === 'free' ? 'success' : availability === 'taken' ? 'danger' : 'muted'}
              align="ui"
              style={{ flex: 1 }}
            >
              {shapeError
                ?? (availability === 'checking' ? 'Checking…'
                  : availability === 'free' ? 'Available'
                    : availability === 'taken' ? 'Already taken'
                      : 'Letters, digits, dots, hyphens and underscores. 3–50 characters.')}
            </Text>
          </View>
        </View>

        <View style={{ gap: space.xs, marginTop: space.md2 }}>
          <Field
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={v => { setEmail(v); setErrors(e => ({ ...e, email: undefined })) }}
            error={errors.email || emailShapeError || null}
            icon="mail"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <Text variant="footnote" tone="muted" align="ui" style={{ paddingHorizontal: space.xxs }}>
            We send your verification code here.
          </Text>
        </View>

        <Button
          label="Continue"
          onPress={submit}
          variant="primary"
          size="lg"
          block
          disabled={!canContinue}
          style={{ marginTop: 28 }}
        />
      </View>
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xxl, paddingBottom: space.huge },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xxs, minHeight: 20 },
  statusSlot: { width: 18, alignItems: 'center' },
})
