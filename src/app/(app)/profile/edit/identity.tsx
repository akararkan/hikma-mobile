/* =========================================================
   Name and username.

   Its own screen because it is a different endpoint with a
   different failure: PATCH /users/me can come back 409
   USER_DUPLICATE, and changing a handle rewrites how every
   existing mention of you resolves. That consequence is worth
   a warning the user reads before saving, not a toast after.

   `fname` / `lname` are not flattened onto the view object —
   the adapter keeps them on `.raw`, which is where they are
   read from here.
   ========================================================= */
import React from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api, codeOf, duplicateField, errorText, fieldErrorMap, isDuplicate, isNotFound } from '@/api'
import { useAsync, useDebounced } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Callout, Chip, ErrorState, Field, GroupLabel, Header, Icon, Screen, Skeleton,
  Text, Touchable, fireHaptic, toast,
} from '@/ui'

const HANDLE_RE = /^[a-zA-Z0-9._-]+$/
type Availability = 'idle' | 'checking' | 'free' | 'taken'

export default function EditIdentityScreen() {
  const t = useTheme()
  const router = useRouter()
  const { setUser } = useAuth()

  const me = useAsync<any>(() => api.users.meProfile(), {})

  const [fname, setFname] = React.useState('')
  const [lname, setLname] = React.useState('')
  const [handle, setHandle] = React.useState('')
  const [seeded, setSeeded] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)
  const [saving, setSaving] = React.useState(false)
  const [availability, setAvailability] = React.useState<Availability>('idle')

  const original = React.useMemo(() => ({
    fname: me.data?.raw?.fname || '',
    lname: me.data?.raw?.lname || '',
    handle: me.data?.handle || '',
    email: me.data?.email || '',
    emailVerified: !!me.data?.emailVerified,
  }), [me.data])

  React.useEffect(() => {
    if (!me.data || seeded) return
    setFname(original.fname)
    setLname(original.lname)
    setHandle(original.handle)
    setSeeded(true)
  }, [me.data, seeded, original])

  const lastRef = React.useRef<any>(null)
  const handleRef = React.useRef<any>(null)

  const shapeError = React.useCallback((value: string): string | null => {
    if (!value) return 'Username is required'
    if (value.length < 3 || value.length > 50) return 'Username must be between 3 and 50 characters'
    if (!HANDLE_RE.test(value)) return 'Username may only contain letters, digits, dots, hyphens, and underscores'
    return null
  }, [])

  const handleChanged = handle.trim() !== original.handle
  const handleShape = handle.trim() ? shapeError(handle.trim()) : null
  const debouncedHandle = useDebounced(handle.trim(), 500)
  const gen = React.useRef(0)

  React.useEffect(() => {
    const value = debouncedHandle
    const mine = ++gen.current
    if (!value || value === original.handle || shapeError(value)) { setAvailability('idle'); return }

    setAvailability('checking')
    api.users.getByUsername(value)
      .then(() => { if (mine === gen.current) setAvailability('taken') })
      .catch((e: any) => { if (mine === gen.current) setAvailability(isNotFound(e) ? 'free' : 'idle') })
  }, [debouncedHandle, original.handle, shapeError])

  const dirty = fname.trim() !== original.fname || lname.trim() !== original.lname || handleChanged
  const canSave = dirty && !handleShape && !!fname.trim() && !!lname.trim() && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const body: Record<string, string> = {}
      if (fname.trim() !== original.fname) body.fname = fname.trim()
      if (lname.trim() !== original.lname) body.lname = lname.trim()
      if (handleChanged) body.username = handle.trim()

      /* updateIdentity maps its own response — only the image uploads answer
         with an unmapped UserResponse. */
      setUser(await api.users.updateIdentity(body))
      fireHaptic('success')
      toast.ok(handleChanged ? 'Username updated' : 'Name updated')
      router.back()
    } catch (e: any) {
      setSaving(false)
      fireHaptic('error')
      if (isDuplicate(e) && duplicateField(e) === 'username') {
        setErrors({ username: errorText(e) })
        setAvailability('taken')
        handleRef.current?.focus()
        return
      }
      if (codeOf(e) === 'VALIDATION_FAILED') {
        setErrors(fieldErrorMap(e) as Record<string, string>)
        return
      }
      setFormError(e)
    }
  }

  if (me.loading && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Name and username" />
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Skeleton height={150} radius={t.radius.md} />
          <Skeleton height={130} radius={t.radius.md} />
          <Skeleton height={80} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (me.error && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Name and username" />
        <ErrorState error={me.error} onRetry={me.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Name and username"
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: canSave ? 'accent' : 'default' }]}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {formError ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
            <Callout tone="danger">{errorText(formError)}</Callout>
          </View>
        ) : null}

        <GroupLabel>Your name</GroupLabel>
        <Card>
          <Field
            label="First name"
            value={fname}
            onChangeText={v => { setFname(v); setErrors(e => ({ ...e, fname: '' })) }}
            error={errors.fname || null}
            maxLength={80}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => lastRef.current?.focus()}
            editable={!saving}
          />
          <Field
            ref={lastRef}
            label="Last name"
            value={lname}
            onChangeText={v => { setLname(v); setErrors(e => ({ ...e, lname: '' })) }}
            error={errors.lname || null}
            maxLength={80}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => handleRef.current?.focus()}
            editable={!saving}
          />
        </Card>

        <GroupLabel>Username</GroupLabel>
        <Card>
          <View>
            <Field
              ref={handleRef}
              label="Username"
              value={handle}
              onChangeText={v => { setHandle(v); setErrors(e => ({ ...e, username: '' })) }}
              error={errors.username || null}
              icon="at"
              maxLength={50}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="go"
              onSubmitEditing={save}
              editable={!saving}
            />
            <View style={styles.statusRow}>
              <View style={styles.statusSlot}>
                {availability === 'checking' ? <ActivityIndicator size="small" color={t.colors.textMuted} />
                  : availability === 'free' ? <Icon name="checkCircle" size={16} color={t.colors.success} filled />
                    : availability === 'taken' ? <Icon name="error" size={16} color={t.colors.danger} />
                      : null}
              </View>
              <Text
                variant="footnote"
                tone={handleShape ? 'danger' : availability === 'free' ? 'success' : availability === 'taken' ? 'danger' : 'muted'}
                align="ui"
                style={{ flex: 1 }}
              >
                {handleShape
                  ?? (availability === 'checking' ? 'Checking…'
                    : availability === 'free' ? 'Available'
                      : availability === 'taken' ? 'Already taken'
                        : 'Letters, digits, dots, hyphens and underscores. 3–50 characters.')}
              </Text>
            </View>

            {handleChanged && !handleShape ? (
              <Callout tone="warning" style={{ marginTop: space.sm2 }}>
                Changing your username changes your profile link. Old mentions of
                @{original.handle} will no longer point here.
              </Callout>
            ) : null}
          </View>
        </Card>

        <GroupLabel>Email</GroupLabel>
        <Card>
          <Touchable
            onLongPress={async () => { await Clipboard.setStringAsync(original.email); toast.ok('Email copied') }}
            feedback="dim"
            noAutoHitSlop
          >
            <View style={styles.emailRow}>
              <View style={{ flex: 1 }}>
                <Text variant="subhead" tone="secondary" align="ui">Email</Text>
                <Text variant="body" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xs }}>
                  {original.email || '—'}
                </Text>
              </View>
              <Touchable
                onPress={original.emailVerified ? undefined : () => router.push('/settings/security/verify-email')}
                disabled={original.emailVerified}
                feedback={original.emailVerified ? 'none' : 'scale'}
              >
                <Chip
                  label={original.emailVerified ? 'Verified' : 'Not verified'}
                  tone={original.emailVerified ? 'success' : 'warning'}
                  icon={original.emailVerified ? 'checkCircle' : 'warning'}
                  size="sm"
                />
              </Touchable>
            </View>
          </Touchable>
          <Text variant="footnote" tone="muted" align="ui">
            The address on your account cannot be changed in the app. Support can change it for you.
          </Text>
        </Card>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View
      style={{
        marginHorizontal: t.layout.screenPadding,
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.borderFaint,
        padding: space.md2,
        gap: space.md2,
      }}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs2, minHeight: 20 },
  statusSlot: { width: 18, alignItems: 'center' },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
