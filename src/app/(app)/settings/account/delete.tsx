/* =========================================================
   Delete account.

   This is not a DELETE. Requesting deletion soft-deletes the
   account immediately, revokes every refresh token, and starts
   a 30-day grace period — so SUCCESS IS A LOGOUT. Every call
   after it returns will 401, which means the success path must
   fire nothing else: no refetch, no score bump, no navigation
   that mounts a screen with a read on it.

   There is also no endpoint that reports deletion state. The
   pending card is therefore reached one of two ways: the user
   just requested it, or `requestDeletion` answered 409
   DELETION_PENDING. A "cancel" affordance is offered explicitly
   rather than pretended into existence from a status we cannot
   read.

   The alternatives sit ABOVE the confirmation on purpose. Most
   people arriving here want to be less findable, not gone.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, ConfirmSheet, Field, GroupLabel, Header, Icon, ListRow,
  RowGroup, Screen, ScreenScroll, Text, useSheetState, toast, type IconName,
} from '@/ui'

const CONSEQUENCES: [IconName, string][] = [
  ['eyeOff', 'Your account disappears immediately — your profile, posts and messages stop being visible to everyone.'],
  ['logout', "You're signed out on every device right now."],
  ['clock', 'You have 30 days to change your mind. After that it is permanent, and your username can never be reused.'],
  ['chat', "Messages you sent in other people's chats stay, attributed to a deleted account."],
]

export default function DeleteAccountScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user, logout } = useAuth()
  const confirm = useSheetState()

  const handle = String(user?.handle || user?.handle || '')
  const [typed, setTyped] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [farewell, setFarewell] = React.useState(false)

  const matches = !!handle && typed.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase()

  const request = useAction(async () => {
    await api.settings.data.requestDeletion()
    /* The session is already dead server-side. Show the interstitial, then
       drop local state — nothing else may fire in between. */
    setFarewell(true)
  }, {
    onError: e => {
      if (codeOf(e) === 'DELETION_PENDING') { setPending(true); return }
      toast.error(errorText(e, 'Could not start account deletion.'))
    },
  })

  const cancel = useAction(async () => {
    await api.settings.data.cancelDeletion()
    setPending(false)
    toast.ok('Deletion cancelled — your account stays.')
  }, {
    onError: e => {
      /* "No pending deletion to cancel" is a 404: nothing is wrong, the screen
         was simply showing a state the server does not hold. */
      if (isNotFound(e)) { setPending(false); toast.info('There is no pending deletion on this account.'); return }
      toast.error(errorText(e, 'Could not cancel the deletion.'))
    },
  })

  /* The last frame this session will ever render. */
  React.useEffect(() => {
    if (!farewell) return
    const id = setTimeout(() => { void logout() }, 3000)
    return () => clearTimeout(id)
  }, [farewell, logout])

  if (farewell) {
    return (
      <Screen background="sunken">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.md }}>
          <View
            style={{
              width: 76, height: 76, borderRadius: 999,
              backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="trash" size={34} color={c.danger} />
          </View>
          <Text variant="title2" align="center">Your account is scheduled for deletion</Text>
          <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320 }}>
            Sign in again within 30 days if you change your mind. After that it
            cannot be undone.
          </Text>
        </View>
      </Screen>
    )
  }

  if (pending) {
    return (
      <Screen background="sunken">
        <Header back title="Delete account" />
        <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg }}>
          <Callout tone="danger" icon="hourglass" title="Deletion pending">
            This account is already scheduled to be erased. Cancelling now keeps
            everything exactly as it is.
          </Callout>
          <Button
            label="Cancel deletion"
            variant="primary"
            size="lg"
            block
            loading={cancel.pending}
            onPress={() => void cancel.run()}
          />
          <Text variant="footnote" tone="muted" align="ui">
            We can't read the scheduled date back from here, so no countdown is
            shown rather than one that might be wrong. The grace period is 30 days
            from the request.
          </Text>
        </ScreenScroll>
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Delete account" />
      <ScreenScroll>
        <View style={{ padding: t.layout.screenPadding, gap: 14 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: c.dangerSoft,
              borderRadius: 999,
              padding: 14,
            }}
          >
            <Icon name="warning" size={26} color={c.danger} />
          </View>
          <Text variant="title1" align="ui">Delete your account</Text>

          <Card variant="outlined" padding={16}>
            <Text variant="subhead" weight="700" align="ui" style={{ marginBottom: 10 }}>
              What happens
            </Text>
            <View style={{ gap: 12 }}>
              {CONSEQUENCES.map(([icon, line]) => (
                <View key={line} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <Icon name={icon} size={17} color={c.textMuted} style={{ marginTop: 2 }} />
                  <Text variant="footnote" align="ui" style={{ flex: 1 }}>{line}</Text>
                </View>
              ))}
            </View>
          </Card>
        </View>

        <GroupLabel>Before you go</GroupLabel>
        <RowGroup>
          <ListRow
            title="Download your data first"
            subtitle="You can't request a copy once the account is gone"
            icon="download"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/data')}
          />
          <ListRow
            title="Turn off discovery instead"
            subtitle="Stop being findable by name, number or email"
            icon="eyeOff"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/discovery')}
          />
          <ListRow
            title="Make your profile private instead"
            subtitle="Choose exactly who sees each field"
            icon="lock"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/privacy')}
          />
        </RowGroup>

        <GroupLabel>Confirm</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding, gap: 12 }}>
          <Field
            value={typed}
            onChangeText={setTyped}
            label={`Type @${handle || 'your username'} to confirm`}
            placeholder={`@${handle}`}
            autoCapitalize="none"
            autoCorrect={false}
            hint="Typing it out is the only guard here — the button does the rest immediately."
          />
          <Button
            label="Delete my account"
            icon="trash"
            variant="danger"
            size="lg"
            block
            disabled={!matches || request.pending}
            loading={request.pending}
            onPress={confirm.open}
          />
          <Button
            label="I already requested deletion — cancel it"
            variant="ghost"
            size="md"
            block
            loading={cancel.pending}
            onPress={() => void cancel.run()}
          />
        </View>

        <View style={{ height: 24 }} />
      </ScreenScroll>

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Delete your account?"
        message="This signs you out everywhere immediately. Sign in again within 30 days to cancel. Continue?"
        confirmLabel="Delete"
        destructive
        icon="trash"
        loading={request.pending}
        onConfirm={async () => { confirm.close(); await request.run() }}
      />
    </Screen>
  )
}
