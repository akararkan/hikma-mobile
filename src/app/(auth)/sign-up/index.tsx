/* =========================================================
   Step 1 of 3 — your name.

   Nothing is sent yet: registration is one atomic call at the
   end of step 3, so this only fills the draft. The validation
   copy is worded exactly like the server's own bean validation
   so a later rejection reads as the same sentence rather than
   a second opinion.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Button, Field, Text } from '@/ui'
import { BrandBand } from '@/components/brand/BrandBand'
import { getSignUpDraft, setSignUpDraft } from './_layout'

const MAX = 80

export default function SignUpNameScreen() {
  const t = useTheme()
  const router = useRouter()

  const [fname, setFname] = React.useState(() => getSignUpDraft().fname)
  const [lname, setLname] = React.useState(() => getSignUpDraft().lname)
  const [errors, setErrors] = React.useState<{ fname?: string; lname?: string }>({})

  const lastRef = React.useRef<any>(null)

  const full = [fname.trim(), lname.trim()].filter(Boolean).join(' ')
  const canContinue = fname.trim().length > 0 && lname.trim().length > 0

  const validate = () => {
    const next: { fname?: string; lname?: string } = {}
    if (!fname.trim()) next.fname = 'First name is required'
    else if (fname.trim().length > MAX) next.fname = `First name must be at most ${MAX} characters`
    if (!lname.trim()) next.lname = 'Last name is required'
    else if (lname.trim().length > MAX) next.lname = `Last name must be at most ${MAX} characters`
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = () => {
    if (!validate()) return
    setSignUpDraft({ fname: fname.trim(), lname: lname.trim() })
    router.push('/(auth)/sign-up/account')
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.content}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* The same band the door wears, one step in — the flow reads as one
          surface rather than three screens. */}
      <BrandBand compact caption="Create your account" />

      <View style={styles.column}>
        <Text variant="title1" align="ui">What should we call you?</Text>
        <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          This is the name on your profile. You can change it later.
        </Text>

        <View style={{ gap: space.md, marginTop: 26 }}>
          <Field
            label="First name"
            value={fname}
            onChangeText={v => { setFname(v); setErrors(e => ({ ...e, fname: undefined })) }}
            error={errors.fname || null}
            icon="person"
            placeholder="Ahmad"
            maxLength={MAX}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => lastRef.current?.focus()}
          />
          <Field
            ref={lastRef}
            label="Last name"
            value={lname}
            onChangeText={v => { setLname(v); setErrors(e => ({ ...e, lname: undefined })) }}
            error={errors.lname || null}
            icon="person"
            placeholder="Rashid"
            maxLength={MAX}
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>

        {/* The display name defaults to "fname lname" server-side, so showing
            the joined result here is the only place that default is visible
            before it exists. */}
        <View style={[styles.preview, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md }]}>
          <Avatar name={full || '· ·'} seed={full || 'new'} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1} align="auto">
              {full || 'Your name'}
            </Text>
            <Text variant="footnote" tone="muted" align="ui">Shown on your profile and posts</Text>
          </View>
        </View>

        <Button
          label="Continue"
          onPress={submit}
          variant="primary"
          size="lg"
          block
          disabled={!canContinue}
          style={{ marginTop: space.xxl }}
        />
      </View>
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  /* The band is full-bleed and pays the status-bar inset itself. */
  content: { flexGrow: 1, paddingBottom: space.huge },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingHorizontal: space.xxl, paddingTop: 28 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginTop: 22 },
})
