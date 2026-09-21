/* =========================================================
   Security.

   Three surfaces the user reaches for after something goes
   wrong — sessions, two-factor, and the sign-in log — plus the
   two verifications that make recovery possible at all.

   `security.sessions.list()` rows: the login path now persists
   the full display row, but sessions minted BEFORE the sessions
   migration can still carry a null `sid`. So rows must not be
   keyed on `sid`, and the two sid-addressed actions (revoke,
   trust) are only offered when it is actually there. A revoke
   button that 404s is worse than no revoke button.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { LOGIN_METHOD_LABELS, LOGIN_OUTCOME_LABELS } from '@/api/security.js'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import {
  Callout, Chip, ConfirmSheet, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, Skeleton, Text, useSheetState, toast,
} from '@/ui'

export default function SecuritySettings() {
  const t = useTheme()
  const router = useRouter()
  const { user, logoutEverywhere } = useAuth()

  const twoFa = useAsync<any>(() => api.security.twofa.status(), { deps: [] })
  const sessions = useAsync<any[]>(() => api.security.sessions.list(), { deps: [] })
  const history = useAsync<any>(() => api.security.loginHistory({ page: 0, size: 5 }), { deps: [] })

  const revoke = useSheetState<{ sid: string; label: string }>()
  const revokeAll = useSheetState()
  const [busy, setBusy] = React.useState(false)

  const rows = sessions.data ?? []
  const revocable = rows.filter(s => !!s?.sid)

  const doRevoke = async () => {
    if (!revoke.payload) return
    setBusy(true)
    try {
      await api.security.sessions.revoke(revoke.payload.sid)
      toast.ok('Session signed out')
      void sessions.reload()
    } catch (e) {
      toast.error(errorText(e, 'Could not sign that session out.'))
    } finally {
      setBusy(false)
      revoke.close()
    }
  }

  const doRevokeAll = async () => {
    setBusy(true)
    try { await logoutEverywhere() }
    catch (e) { toast.error(errorText(e, 'Could not sign out everywhere.')) }
    finally { setBusy(false); revokeAll.close() }
  }

  const recovery = twoFa.data?.recoveryCodesRemaining
  const lowRecovery = twoFa.data?.enabled && typeof recovery === 'number' && recovery <= 2

  return (
    <Screen background="sunken">
      <Header back title="Security" />
      <ScreenScroll refreshing={sessions.refreshing} onRefresh={() => { void sessions.refresh(); void twoFa.refresh() }}>
        {lowRecovery ? (
          <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
            <Callout
              tone="warning"
              title={recovery === 0 ? 'No recovery codes left' : `${recovery} recovery code${recovery === 1 ? '' : 's'} left`}
              actionLabel="Generate new codes"
              onAction={() => router.push('/settings/security/recovery-codes')}
            >
              Recovery codes are how you get back in if you lose your authenticator.
              Each one works once.
            </Callout>
          </View>
        ) : null}

        <GroupLabel>Sign-in</GroupLabel>
        <RowGroup>
          <ListRow
            title="Two-factor authentication"
            subtitle={twoFa.data?.enabled
              ? 'Required every time you sign in'
              : 'Add a second step to protect your account'}
            icon="shield"
            iconTone={twoFa.data?.enabled ? 'success' : 'warning'}
            accessory={{ kind: 'value', text: twoFa.loading ? '…' : twoFa.data?.enabled ? 'On' : 'Off' }}
            onPress={() => router.push('/settings/security/two-factor')}
          />
          {twoFa.data?.enabled ? (
            <ListRow
              title="Recovery codes"
              icon="key"
              iconTone="neutral"
              accessory={{ kind: 'value', text: typeof recovery === 'number' ? `${recovery} left` : '—' }}
              onPress={() => router.push('/settings/security/recovery-codes')}
            />
          ) : null}
          <ListRow
            title="Change password"
            icon="lock"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/account/change-password')}
          />
        </RowGroup>

        <GroupLabel>Verification</GroupLabel>
        <RowGroup>
          <ListRow
            title="Email"
            subtitle={user?.email || undefined}
            icon="mail"
            iconTone={user?.emailVerified ? 'success' : 'warning'}
            accessory={{ kind: 'value', text: user?.emailVerified ? 'Verified' : 'Verify' }}
            onPress={() => router.push('/settings/security/verify-email')}
          />
          <ListRow
            title="Phone number"
            icon="phone"
            iconTone="neutral"
            /* A bound number cannot be read back — there is no GET — so the row
               can only ever offer the action, never report the state. */
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/security/phone')}
          />
        </RowGroup>
        <GroupFooter>
          Verifying your phone also lets people who have your number in their
          contacts find you — you can turn that off under Discovery.
        </GroupFooter>

        <GroupLabel>Where you're signed in</GroupLabel>
        {sessions.loading ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: 10 }}>
            <Skeleton height={54} radius={t.radius.md} />
            <Skeleton height={54} radius={t.radius.md} />
          </View>
        ) : (
          <RowGroup>
            {rows.length ? rows.map((s: any, i: number) => (
              <ListRow
                /* Not keyed on sid: it is usually absent. */
                key={`${s.sid ?? 'session'}-${i}`}
                title={s.deviceName || s.platform || 'Unknown device'}
                subtitle={[
                  s.ip,
                  s.lastSeenAt ? `last seen ${new Date(s.lastSeenAt).toLocaleDateString()}` : null,
                  s.createdAt ? `signed in ${new Date(s.createdAt).toLocaleDateString()}` : null,
                ].filter(Boolean).join(' · ')}
                icon="devices"
                iconTone={s.trusted ? 'success' : 'neutral'}
                accessory={s.sid
                  ? { kind: 'custom', node: <Chip label="Sign out" tone="danger" size="sm" onPress={() => revoke.open({ sid: s.sid, label: s.deviceName || 'this device' })} /> }
                  : { kind: 'none' }}
              />
            )) : (
              <ListRow title="No other sessions" subtitle="This is the only device signed in." icon="devices" iconTone="neutral" />
            )}
          </RowGroup>
        )}
        {rows.length && !revocable.length ? (
          <GroupFooter>
            These sessions can't be signed out individually yet — use “Sign out
            everywhere” below, then sign back in on the devices you keep.
          </GroupFooter>
        ) : null}

        <View style={{ height: 8 }} />
        <RowGroup>
          <ListRow
            title="Manage sessions"
            icon="devices"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/security/sessions')}
          />
          <ListRow title="Sign out of all devices" icon="logout" destructive onPress={revokeAll.open} />
        </RowGroup>

        <GroupLabel>Recent sign-ins</GroupLabel>
        <RowGroup>
          {(history.data?.items ?? []).length ? (history.data.items as any[]).map((row: any, i: number) => {
            const failed = row.outcome === 'FAILED'
            const noteworthy = row.method === 'PASSWORD+RECOVERY'
            return (
              <ListRow
                key={i}
                title={(LOGIN_OUTCOME_LABELS as any)[row.outcome] ?? row.outcome}
                subtitle={[
                  (LOGIN_METHOD_LABELS as any)[row.method] ?? row.method,
                  row.ip,
                  row.ts ? new Date(row.ts).toLocaleString() : null,
                ].filter(Boolean).join(' · ')}
                icon={failed ? 'warning' : noteworthy ? 'key' : 'checkCircle'}
                iconTone={failed ? 'danger' : noteworthy ? 'warning' : 'success'}
              />
            )
          }) : history.error ? (
            /* A failed read is not an empty history — say so, offer the retry. */
            <ListRow
              title="Couldn't load sign-ins"
              subtitle={errorText(history.error, 'Tap to try again.')}
              icon="warning"
              iconTone="danger"
              onPress={() => void history.reload()}
            />
          ) : (
            <ListRow title="Nothing yet" subtitle="Sign-ins will appear here." icon="history" iconTone="neutral" />
          )}
          <ListRow
            title="See all sign-ins"
            icon="history"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/security/login-history')}
          />
        </RowGroup>
        <GroupFooter>
          A sign-in marked “Password + recovery code” means someone got in without
          your authenticator. If that wasn't you, change your password now.
        </GroupFooter>
      </ScreenScroll>

      <ConfirmSheet
        visible={revoke.visible}
        onClose={revoke.close}
        title="Sign out this device?"
        message={revoke.payload ? `${revoke.payload.label} will need to sign in again.` : undefined}
        confirmLabel="Sign out"
        destructive
        loading={busy}
        onConfirm={() => void doRevoke()}
      />
      <ConfirmSheet
        visible={revokeAll.visible}
        onClose={revokeAll.close}
        title="Sign out everywhere?"
        message="Every device signed in to this account will be signed out, including this one."
        confirmLabel="Sign out everywhere"
        destructive
        loading={busy}
        onConfirm={() => void doRevokeAll()}
      />
    </Screen>
  )
}
