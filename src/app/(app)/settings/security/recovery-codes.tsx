/* =========================================================
   Recovery codes.

   Regenerating is destructive in a way the word "generate"
   hides: the moment the new set returns, every code the user is
   carrying stops working. So the confirmation says that, and
   the new set is shown on a screen that is hard to leave by
   accident — this is the only time it can ever be read.

   `regenerateRecovery` is step-up gated. StepUpHost is mounted
   app-wide and does the arm-and-replay, so nothing here talks
   to the step-up API; what this screen must handle is the user
   CANCELLING that sheet, which arrives as `e.stepUpCancelled`
   and is not a failure — it is the user changing their mind, so
   it is swallowed without a toast.
   ========================================================= */
import React from 'react'
import { Share, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, ConfirmSheet, EmptyState, ErrorState, GroupFooter,
  Header, Screen, ScreenScroll, Skeleton, Text, useSheetState, fireHaptic, toast,
} from '@/ui'

const TOTAL_CODES = 10
const DONE_DELAY_MS = 5000

export default function RecoveryCodesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const confirm = useSheetState()

  const status = useAsync<any>(() => api.security.twofa.status(), { deps: [] })
  const [codes, setCodes] = React.useState<string[]>([])
  const [doneAt, setDoneAt] = React.useState(0)
  const [now, setNow] = React.useState(() => Date.now())
  const leaveGuard = useSheetState()

  /* The Done button unlocks on a clock, so the clock has to tick — and then
     stops. This is the screen a user sits on for minutes copying codes into a
     password manager; a tick that outlives the countdown re-renders the whole
     grid four times a second for nothing. */
  React.useEffect(() => {
    if (!doneAt || Date.now() >= doneAt) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= doneAt) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [doneAt])

  const regenerate = useAction(async () => {
    const res: any = await api.security.twofa.regenerateRecovery()
    const fresh: string[] = Array.isArray(res?.codes) ? res.codes : []
    if (!fresh.length) {
      /* No codes in the response means nothing was rotated — say so rather
         than showing an empty grid that looks like a rendering bug. */
      toast.warn('No new codes came back. Try again.')
      return
    }
    fireHaptic('success')
    setCodes(fresh)
    setDoneAt(Date.now() + DONE_DELAY_MS)
    void status.reload()
  }, {
    onError: e => {
      /* A cancelled step-up is a decision, not an error. */
      if (e?.stepUpCancelled) return
      toast.error(errorText(e, 'Could not generate new codes.'))
    },
  })

  /* ---- the hand-off: shown once, so it owns the whole screen ---- */
  if (codes.length) {
    const remaining = Math.max(0, Math.ceil((doneAt - now) / 1000))
    return (
      <Screen background="sunken">
        <Header
          title="Save these codes"
          back={() => leaveGuard.open()}
        />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
          <Callout tone="danger" title="This is the only time you'll see these" icon="key">
            Each code works once, and anyone holding one can sign in as you. Keep
            them somewhere you can reach WITHOUT your phone — that is the whole
            point of them.
          </Callout>

          <Card variant="outlined" padding={18}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {codes.map((v, i) => (
                <View key={i} style={{ width: '50%', paddingVertical: space.sm }}>
                  <Text
                    variant="body"
                    align="left"
                    selectable
                    style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}
                  >
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
            label="Share"
            icon="share"
            variant="secondary"
            size="lg"
            block
            onPress={() => { void Share.share({ message: codes.join('\n') }) }}
          />
          <Button
            label={remaining > 0 ? `I've saved them (${remaining})` : "I've saved them"}
            variant="primary"
            size="lg"
            block
            disabled={remaining > 0}
            onPress={() => { setCodes([]); setDoneAt(0); router.back() }}
          />
          <Text variant="footnote" tone="muted" align="center">
            Screenshots are fine — nothing here blocks them.
          </Text>
        </ScreenScroll>

        <ConfirmSheet
          visible={leaveGuard.visible}
          onClose={leaveGuard.close}
          title="Have you saved your codes?"
          message="They cannot be shown again. Leaving now means the only way back is to generate another set."
          confirmLabel="Leave"
          cancelLabel="Stay"
          destructive
          icon="warning"
          onConfirm={() => { leaveGuard.close(); setCodes([]); setDoneAt(0); router.back() }}
        />
      </Screen>
    )
  }

  /* ---- the resting state ---- */
  if (status.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Recovery codes" />
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Skeleton height={92} radius={t.radius.card} />
          <Skeleton height={52} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }
  if (status.error) {
    return (
      <Screen background="sunken">
        <Header back title="Recovery codes" />
        <ErrorState error={status.error} onRetry={status.reload} />
      </Screen>
    )
  }

  if (!status.data?.enabled) {
    return (
      <Screen background="sunken">
        <Header back title="Recovery codes" />
        <EmptyState
          icon="key"
          title="Recovery codes only exist while two-factor is on"
          message="They are the way back in when you can't reach your authenticator, so there is nothing to recover from until you have one."
          actionLabel="Set up two-factor"
          onAction={() => router.replace('/settings/security/two-factor')}
        />
      </Screen>
    )
  }

  const left = Number(status.data?.recoveryCodesRemaining ?? 0)
  const low = left <= 3

  return (
    <Screen background="sunken">
      <Header back title="Recovery codes" />
      <ScreenScroll refreshing={status.refreshing} onRefresh={status.refresh}>
        <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
          <Text variant="callout" tone="muted" align="ui">
            Each code works once. Use one in the code field at sign-in when you
            don't have your authenticator.
          </Text>

          <Card variant="outlined" padding={16}>
            <Text variant="title2" align="ui" color={low ? c.warning : c.text}>
              {left} of {TOTAL_CODES} unused
            </Text>

            {/* One pip per code: filled for unused, hollow for spent. A number
                alone does not communicate "you are nearly out". */}
            <View style={{ flexDirection: 'row', gap: 7, marginTop: 14 }}>
              {Array.from({ length: TOTAL_CODES }, (_, i) => {
                const unused = i < left
                return (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: unused ? (low ? c.warning : c.success) : 'transparent',
                      borderWidth: unused ? 0 : 1,
                      borderColor: c.borderStrong,
                    }}
                  />
                )
              })}
            </View>

            {low ? (
              <Text variant="footnote" tone="warning" align="ui" style={{ marginTop: 12 }}>
                {left === 0
                  ? 'You have none left. Generate a new set before you need one.'
                  : 'Running low — generate a new set while you still have access.'}
              </Text>
            ) : null}
          </Card>

          <Button
            label="Generate new codes"
            icon="refresh"
            variant="secondary"
            size="lg"
            block
            loading={regenerate.pending}
            onPress={confirm.open}
          />
        </View>

        <GroupFooter>
          Generating a new set invalidates the old one immediately — including
          any code you have written down or saved in a password manager.
        </GroupFooter>
      </ScreenScroll>

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Generate a new set?"
        message="Every code you have now stops working the moment the new ones appear. You'll be asked to confirm it's you first."
        confirmLabel="Generate"
        destructive
        icon="key"
        loading={regenerate.pending}
        onConfirm={async () => { confirm.close(); await regenerate.run() }}
      />
    </Screen>
  )
}
