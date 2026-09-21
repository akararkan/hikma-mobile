/* =========================================================
   Account.

   Identity that is not cosmetic: the address you sign in with,
   the number that makes recovery possible, the password, and
   the end of the account.

   Email verification state IS readable back (`/users/me`
   carries `isEmailVerified`), so this row reports it. Phone
   binding is not — there is no GET — so the phone row can only
   ever offer the action, never claim a state. Saying "verified"
   from a value the client happens to remember from earlier in
   the session would be a lie the moment the app restarts.
   ========================================================= */
import React from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import {
  GroupFooter, GroupLabel, Header, ListRow, RowGroup, Screen, ScreenScroll,
} from '@/ui'

export default function AccountSettings() {
  const router = useRouter()
  const { user } = useAuth()

  return (
    <Screen background="sunken">
      <Header back title="Account" />
      <ScreenScroll>
        <GroupLabel>Identity</GroupLabel>
        <RowGroup>
          <ListRow
            title="Name and username"
            subtitle={user?.handle ? `@${user.handle || user.handle}` : undefined}
            icon="person"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/profile/edit/identity')}
          />
          <ListRow
            title="Email"
            subtitle={user?.email || 'No email on file'}
            icon="mail"
            iconTone={user?.emailVerified ? 'success' : 'warning'}
            accessory={{ kind: 'value', text: user?.emailVerified ? 'Verified' : 'Not verified' }}
            onPress={() => router.push('/settings/security/verify-email')}
          />
          <ListRow
            title="Phone number"
            icon="phone"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/security/phone')}
          />
        </RowGroup>
        {/* No forgot-password flow exists on this platform (auth.md) — the copy
            must not promise email recovery it cannot deliver. */}
        <GroupFooter>
          A verified email confirms this account is yours and is where important
          notices about it are sent. There is no password reset by email — keep
          your password safe.
        </GroupFooter>

        <GroupLabel>Sign-in</GroupLabel>
        <RowGroup>
          <ListRow
            title="Change password"
            icon="lock"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/account/change-password')}
          />
          <ListRow
            title="Security"
            subtitle="Two-factor, sessions, sign-in history"
            icon="shield"
            iconTone="success"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/security')}
          />
        </RowGroup>

        <GroupLabel>Ending your account</GroupLabel>
        <RowGroup>
          <ListRow
            title="Download your data"
            subtitle="Take a copy before you go"
            icon="download"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/data')}
          />
          <ListRow
            title="Delete account"
            icon="trash"
            destructive
            onPress={() => router.push('/settings/account/delete')}
          />
        </RowGroup>
      </ScreenScroll>
    </Screen>
  )
}
