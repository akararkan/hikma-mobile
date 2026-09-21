/* =========================================================
   The three-step sign-up group.

   Two things live here rather than in the screens:

   1. The chrome. All three steps share one header — a Cancel
      affordance and a 3-segment progress bar — so it is drawn
      once here and the screens render only their bodies.

   2. The DRAFT. Registration is a single atomic call made at
      the end of step 3, so steps 1 and 2 have nowhere to put
      what they collected except memory. It lives in this file
      because the draft's lifetime is exactly this group's:
      the layout clears it on cancel, and the password step
      clears it on success. It is module scope rather than
      context because the app directory is a route tree —
      a non-route `draft.ts` beside these screens would be
      picked up by expo-router as a route with no component.

      Nothing here is persisted. The draft holds a plaintext
      email and handle, and a navigation state that expo-router
      writes to disk is not where either belongs.
   ========================================================= */
import React from 'react'
import { BackHandler, StyleSheet, View } from 'react-native'
import { Stack, usePathname, useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { ConfirmSheet, Header, Screen, Text, useSheetState } from '@/ui'

/* ---------------------------------------------------------
   Draft
   --------------------------------------------------------- */

export interface SignUpDraft {
  fname: string
  lname: string
  username: string
  email: string
}

const EMPTY: SignUpDraft = { fname: '', lname: '', username: '', email: '' }
let draft: SignUpDraft = { ...EMPTY }

export function getSignUpDraft(): SignUpDraft { return draft }
export function setSignUpDraft(patch: Partial<SignUpDraft>) { draft = { ...draft, ...patch } }
export function clearSignUpDraft() { draft = { ...EMPTY } }

/* ---------------------------------------------------------
   Chrome
   --------------------------------------------------------- */

const STEPS = 3

function stepOf(pathname: string): number {
  if (pathname.endsWith('/password')) return 2
  if (pathname.endsWith('/account')) return 1
  return 0
}

export default function SignUpLayout() {
  const t = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const step = stepOf(pathname)
  const discard = useSheetState()

  /* Hardware back on the first step is a "leave sign-up", not a pop — the
     screen behind it is the password form the user chose to leave. */
  React.useEffect(() => {
    if (step !== 0) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { discard.open(); return true })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const leave = () => {
    clearSignUpDraft()
    discard.close()
    router.replace('/(auth)/sign-in')
  }

  return (
    <Screen>
      <Header
        border={false}
        titleNode={<ProgressBar step={step} />}
        back={step === 0 ? () => discard.open() : true}
        actions={[{ icon: 'close', onPress: () => discard.open(), label: 'Cancel sign-up' }]}
      />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.bg },
          animation: t.prefs.reducedMotion ? 'none' : 'slide_from_right',
          animationDuration: 240,
        }}
      />

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard sign-up?"
        message="Everything you have typed so far is dropped. Your account is not created."
        confirmLabel="Discard"
        cancelLabel="Keep going"
        destructive
        onConfirm={leave}
      />
    </Screen>
  )
}

function ProgressBar({ step }: { step: number }) {
  const t = useTheme()
  return (
    /* `accessible` is what makes the label a real element on iOS — a bare
       label on a View is silently dropped there (TalkBack maps it anyway). */
    <View style={styles.progressWrap} accessible accessibilityLabel={`Step ${step + 1} of ${STEPS}`}>
      <View style={styles.segments}>
        {Array.from({ length: STEPS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i <= step ? t.colors.accent : t.colors.border },
            ]}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted" align="center">Step {step + 1} of {STEPS}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  progressWrap: { alignItems: 'center', gap: space.xs2 },
  segments: { flexDirection: 'row', gap: space.xs2 },
  segment: { width: 34, height: 4, borderRadius: 2 },
})
