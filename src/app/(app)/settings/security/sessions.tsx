/* =========================================================
   Active sessions.

   The login path now persists the whole display row — sid,
   deviceName, platform, ip, lastSeenAt — so NEW sessions arrive
   fully populated (verified live). The sparsity caveat is for
   LEGACY rows only: sessions minted before the migration can
   still carry a null sid and blank display fields.

   Two consequences run through the whole file:

   1. Rows are NEVER keyed on sid — a null key on an old row is
      a duplicate key, which is a hard crash in a virtualised
      list.
   2. Revoke and trust are sid-addressed, so they are only
      offered when a sid is actually present. A "sign out" button
      that 404s is worse than no button, and the row says why
      instead of hiding the fact.

   Trusting a device is recorded and then read by nothing — it
   does not skip the two-factor prompt. The closing card says so
   rather than letting the label imply a shortcut that isn't
   there.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, ConfirmSheet, EmptyState, ErrorState, GroupFooter,
  Header, Icon, ListRow, RowGroup, Screen, ScreenScroll, Skeleton, Text,
  useSheetState, toast, type IconName,
} from '@/ui'

interface SessionRow {
  sid?: string | null
  deviceName?: string | null
  platform?: string | null
  ip?: string | null
  lastSeenAt?: string | null
  createdAt?: string | null
  trusted?: boolean | null
  trustedUntil?: string | null
}

export default function SessionsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { logoutEverywhere } = useAuth()

  const sessions = useAsync<SessionRow[]>(() => api.security.sessions.list(), { deps: [] })
  const menu = useSheetState<SessionRow>()
  const revoke = useSheetState<SessionRow>()
  const revokeAll = useSheetState()
  const [busy, setBusy] = React.useState(false)

  const first = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (first.current) { first.current = false; return }
    void sessions.refresh()
  }, [sessions.refresh]))   // eslint-disable-line react-hooks/exhaustive-deps

  const doRevoke = async () => {
    const row = revoke.payload
    if (!row?.sid) return
    setBusy(true)
    const previous = sessions.data ?? []
    sessions.setData(prev => (prev ?? []).filter(s => s.sid !== row.sid))
    try {
      await api.security.sessions.revoke(row.sid)
      toast.ok('Signed out of that device')
    } catch (e) {
      /* Already gone is the outcome the user wanted, so the row stays removed
         and the copy says what happened rather than crying failure. */
      if (isNotFound(e)) toast.info('That session had already ended.')
      else {
        sessions.setData(previous)
        toast.error(errorText(e, 'Could not sign that session out.'))
      }
    } finally {
      setBusy(false)
      revoke.close()
    }
  }

  const doTrust = async (row: SessionRow) => {
    if (!row.sid) return
    try {
      await api.security.sessions.trust(row.sid, 30)
      sessions.setData(prev => (prev ?? []).map(s => (s.sid === row.sid ? { ...s, trusted: true } : s)))
      toast.ok('Marked as trusted for 30 days')
    } catch (e) {
      toast.error(errorText(e, 'Could not mark that device trusted.'))
    }
  }

  const doRevokeAll = async () => {
    setBusy(true)
    try {
      await logoutEverywhere()
      /* No navigation: dropping the user makes the (app) gate redirect. */
    } catch (e) {
      toast.error(errorText(e, 'Could not sign out everywhere.'))
      setBusy(false)
      revokeAll.close()
    }
  }

  const rows = sessions.data ?? []
  const anyAddressable = rows.some(s => !!s.sid)

  return (
    <Screen background="sunken">
      <Header back title="Active sessions" />
      <ScreenScroll refreshing={sessions.refreshing} onRefresh={sessions.refresh}>
        <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
          <Callout tone="neutral" icon="info">
            Sessions started before an app update may be missing their device
            name or IP — recent sign-ins record the full picture.
          </Callout>
        </View>

        {sessions.loading ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.lg, gap: space.sm2 }}>
            <Skeleton height={62} radius={t.radius.md} />
            <Skeleton height={62} radius={t.radius.md} />
            <Skeleton height={62} radius={t.radius.md} />
          </View>
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={sessions.reload} />
        ) : !rows.length ? (
          <EmptyState
            icon="devices"
            title="No other sessions"
            message="This device is the only one holding a live sign-in."
            compact
          />
        ) : (
          <>
            <View style={{ height: 16 }} />
            <RowGroup>
              {rows.map((s, i) => (
                <ListRow
                  /* sid is frequently null — a composite key is the only one
                     that is guaranteed unique here. */
                  key={`${s.sid ?? 'nosid'}-${s.createdAt ?? ''}-${i}`}
                  title={s.deviceName || prettyPlatform(s.platform) || 'Unknown device'}
                  subtitle={[
                    s.ip || 'IP not recorded',
                    relative(s.lastSeenAt || s.createdAt),
                  ].filter(Boolean).join(' · ')}
                  description={s.trusted
                    ? `Trusted${s.trustedUntil ? ` until ${new Date(s.trustedUntil).toLocaleDateString()}` : ''}`
                    : !s.sid
                      ? 'Actions unavailable for this session'
                      : undefined}
                  icon={platformIcon(s.platform)}
                  iconTone={s.trusted ? 'success' : 'neutral'}
                  accessory={s.sid
                    ? { kind: 'custom', node: <Icon name="more" size={20} color={t.colors.textMuted} /> }
                    : { kind: 'none' }}
                  onPress={s.sid ? () => menu.open(s) : undefined}
                />
              ))}
            </RowGroup>
            {!anyAddressable ? (
              <GroupFooter>
                None of these sessions carries an identifier, so they can't be
                ended one at a time. Sign out everywhere below, then sign back in
                on the devices you keep.
              </GroupFooter>
            ) : null}
          </>
        )}

        <View style={{ padding: t.layout.screenPadding, paddingTop: 20 }}>
          <Button
            label="Sign out of all devices"
            icon="logout"
            variant="danger"
            size="lg"
            block
            onPress={revokeAll.open}
          />
        </View>

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: 8 }}>
          <Callout tone="warning" icon="shield" title="Trusted is a note, not a shortcut">
            Marking a device trusted is recorded, but nothing reads it yet — it
            does not skip the two-factor prompt on that device.
          </Callout>
        </View>

        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Text variant="footnote" tone="muted" align="ui">
            Every sign-in attempt, including the failed ones, is in your{' '}
            <Text
              variant="footnote"
              tone="accent"
              underline
              onPress={() => router.push('/settings/security/login-history')}
            >
              login history
            </Text>
            .
          </Text>
        </View>
      </ScreenScroll>

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.deviceName || prettyPlatform(menu.payload?.platform) || 'This session'}
        subtitle={menu.payload?.createdAt ? `Signed in ${relative(menu.payload.createdAt)}` : undefined}
        actions={[
          {
            label: menu.payload?.trusted ? 'Trusted for 30 days' : 'Trust this device for 30 days',
            icon: 'shield',
            disabled: !!menu.payload?.trusted,
            onPress: () => { if (menu.payload) void doTrust(menu.payload) },
          },
          {
            label: 'Sign out of this device',
            icon: 'logout',
            destructive: true,
            onPress: () => { if (menu.payload) revoke.open(menu.payload) },
          },
        ]}
      />

      <ConfirmSheet
        visible={revoke.visible}
        onClose={revoke.close}
        title="Sign out this device?"
        message={`${revoke.payload?.deviceName || prettyPlatform(revoke.payload?.platform) || 'That device'} will need to sign in again.`}
        confirmLabel="Sign out"
        destructive
        loading={busy}
        icon="logout"
        onConfirm={() => void doRevoke()}
      />

      <ConfirmSheet
        visible={revokeAll.visible}
        onClose={revokeAll.close}
        title="Sign out everywhere?"
        message="This signs you out everywhere, including this phone. Use it if you think someone else has access."
        confirmLabel="Sign out everywhere"
        destructive
        loading={busy}
        icon="logout"
        onConfirm={() => void doRevokeAll()}
      />
    </Screen>
  )
}

function platformIcon(platform?: string | null): IconName {
  const p = String(platform || '').toUpperCase()
  if (p.includes('WEB') || p.includes('BROWSER')) return 'globe'
  if (p.includes('DESKTOP') || p.includes('MAC') || p.includes('WINDOWS') || p.includes('LINUX')) return 'storage'
  return 'devices'
}

function prettyPlatform(platform?: string | null) {
  const p = String(platform || '').trim()
  if (!p) return ''
  if (p.toUpperCase() === 'IOS') return 'iPhone'
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

/** Sparse rows mean this is often the only fact a session carries, so it is
 *  worth spelling out rather than printing a bare date. */
function relative(iso?: string | null) {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
