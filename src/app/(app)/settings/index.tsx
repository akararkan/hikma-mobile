/* =========================================================
   Settings — the hub.

   The tree is large (the backend's settings module alone spans
   seventeen documents), so the root's only job is to make it
   navigable: grouped rows, an icon per destination, and a live
   value on the rows whose current state is worth seeing before
   you tap — the theme, the presence policy, the number of
   blocked accounts, whether 2FA is on.

   Those live values load lazily and fail silently. A settings
   index that cannot open because one summary call 500'd is a
   worse failure than a row without its subtitle.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { isPlatformAdmin } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useAsync } from '@/hooks/useAsync'
import {
  Avatar, ConfirmSheet, EmptyState, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SearchField, Text, Touchable, useSheetState, toast,
} from '@/ui'
import { filterSettings } from '@/lib/settingsSearch'
import { CLIENT_VERSION, CLIENT_BUILD } from '@/lib/version.js'

export default function SettingsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user, logout, logoutEverywhere } = useAuth()
  const signOut = useSheetState()
  const signOutAll = useSheetState()
  const [busy, setBusy] = React.useState(false)

  /* One summary read per row that shows a live value. Each is independent so
     a single failure costs one subtitle, not the screen. */
  const twoFa = useAsync(() => api.security.twofa.status(), { deps: [] })
  const blocks = useAsync(() => api.settings.blocks.list({ page: 0, size: 1 }), { deps: [] })
  const presence = useAsync(() => api.settings.presence.get(), { deps: [] })
  const storage = useAsync(() => api.settings.storage.usage(), { deps: [] })

  const themeLabel =
    t.themeChoice === 'DARK' ? 'Dark' : t.themeChoice === 'LIGHT' ? 'Light' : 'System'

  const presenceLabel = (() => {
    /* The block is {onlineStatusPolicy, lastSeenPolicy}; the row summarises the
       stricter-feeling one, which is who can see you online. */
    const p = (presence.data as any)?.onlineStatusPolicy
    if (!p) return undefined
    return ({ EVERYONE: 'Everyone', FRIENDS: 'Friends', NOBODY: 'Nobody' } as Record<string, string>)[String(p)] ?? String(p)
  })()

  const blockedCount = (blocks.data as any)?.total ?? null

  /* Client-side settings search over the static index (see lib/settingsSearch —
     the docs have no settings-search endpoint, and forty screens don't need
     one). Any query swaps the grouped body for the flat hits. */
  const [q, setQ] = React.useState('')
  const searching = !!q.trim()
  const hits = React.useMemo(() => filterSettings(q), [q])

  const storageLabel = (() => {
    const bytes = Number((storage.data as any)?.totalBytes ?? (storage.data as any)?.usedBytes ?? 0)
    if (!bytes) return undefined
    const mb = bytes / (1024 * 1024)
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
  })()

  const doSignOut = async (everywhere: boolean) => {
    setBusy(true)
    try {
      await (everywhere ? logoutEverywhere() : logout())
      /* No navigation: dropping the user makes the (app) gate redirect. */
    } catch (e) {
      /* The server has its own words for a refused sign-out (a stale refresh
         token, a session already revoked elsewhere); say them rather than the
         generic line, which hid the reason on the one screen you reach when
         something is already wrong. */
      toast.error(errorText(e, 'Could not sign out. Try again.'))
    } finally {
      setBusy(false)
      signOut.close()
      signOutAll.close()
    }
  }

  return (
    <Screen background="sunken">
      <Header back title="Settings" />
      <ScreenScroll keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
          <SearchField value={q} onChangeText={setQ} placeholder="Search settings" />
        </View>

        {searching ? (
          hits.length ? (
            <>
              <GroupLabel>Results</GroupLabel>
              <RowGroup>
                {hits.map(e => (
                  <ListRow
                    key={e.route}
                    title={e.title}
                    subtitle={e.subtitle}
                    accessory={{ kind: 'value', text: e.section }}
                    onPress={() => { setQ(''); router.push(e.route as any) }}
                  />
                ))}
              </RowGroup>
            </>
          ) : (
            <EmptyState
              icon="search"
              title="No setting matches"
              message={'Try another word \u2014 \u201cpassword\u201d, \u201cdark mode\u201d, \u201cblocked\u201d.'}
            />
          )
        ) : (
          <>
        {/* The account card doubles as the way into "edit your profile", which
            is what most people open Settings looking for. */}
        <Touchable
          onPress={() => router.push('/profile/edit')}
          feedback="tint"
          noAutoHitSlop
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md2,
            margin: t.layout.screenPadding,
            padding: space.md2,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.surface,
          }}
        >
          <Avatar uri={user?.profileImage} name={user?.displayName || user?.full} seed={user?.id} size="lg" />
          <View style={{ flex: 1 }}>
            <Text variant="title3" align="ui" numberOfLines={1}>
              {user?.displayName || user?.handle || 'Your account'}
            </Text>
            <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
              @{user?.handle || user?.handle} · Edit profile
            </Text>
          </View>
        </Touchable>

        <GroupLabel>Account</GroupLabel>
        <RowGroup>
          <ListRow
            title="Account"
            subtitle="Email, phone, password, deletion"
            icon="person"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/account')}
          />
          <ListRow
            title="Security"
            icon="shield"
            iconTone="success"
            accessory={{
              kind: 'value',
              text: (twoFa.data as any)?.enabled ? 'Two-factor on' : 'Sessions, 2FA',
            }}
            onPress={() => router.push('/settings/security')}
          />
          <ListRow
            title="Privacy"
            subtitle="Who can see and reach you"
            icon="lock"
            iconTone="accent"
            accessory={blockedCount ? { kind: 'value', text: `${blockedCount} blocked` } : { kind: 'chevron' }}
            onPress={() => router.push('/settings/privacy')}
          />
          <ListRow
            title="Presence"
            icon="eye"
            iconTone="neutral"
            accessory={presenceLabel ? { kind: 'value', text: presenceLabel } : { kind: 'chevron' }}
            onPress={() => router.push('/settings/presence')}
          />
        </RowGroup>

        <GroupLabel>Notifications & messaging</GroupLabel>
        <RowGroup>
          <ListRow
            title="Notifications"
            subtitle="What reaches you, and how"
            icon="bell"
            iconTone="warning"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/notifications')}
          />
          <ListRow
            title="Messaging"
            subtitle="Read receipts, typing, wallpaper"
            icon="chat"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/messaging')}
          />
          <ListRow
            title="Media & storage"
            icon="storage"
            iconTone="neutral"
            accessory={storageLabel ? { kind: 'value', text: storageLabel } : { kind: 'chevron' }}
            onPress={() => router.push('/settings/media')}
          />
        </RowGroup>

        <GroupLabel>Discovery</GroupLabel>
        <RowGroup>
          <ListRow
            title="Discovery & contacts"
            subtitle="Who can find you, contact sync, your QR"
            icon="contacts"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/discovery')}
          />
          <ListRow
            title="Communities"
            icon="people"
            iconTone="scholar"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/communities')}
          />
        </RowGroup>

        <GroupLabel>Safety</GroupLabel>
        <RowGroup>
          <ListRow
            title="Safety Center"
            subtitle="Reports, strikes, your security score"
            icon="shield"
            iconTone="warning"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/safety')}
          />
        </RowGroup>

        <GroupLabel>Appearance</GroupLabel>
        <RowGroup>
          <ListRow
            title="Theme & display"
            icon="palette"
            iconTone="accent"
            accessory={{ kind: 'value', text: themeLabel }}
            onPress={() => router.push('/settings/appearance')}
          />
          <ListRow
            title="Language & region"
            icon="language"
            iconTone="neutral"
            accessory={{ kind: 'value', text: t.language }}
            onPress={() => router.push('/settings/language')}
          />
          <ListRow
            title="Accessibility"
            icon="help"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/accessibility')}
          />
          <ListRow
            title="App permissions"
            subtitle="Camera, microphone, contacts, notifications"
            icon="lock"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/permissions')}
          />
        </RowGroup>

        <GroupLabel>Your data</GroupLabel>
        <RowGroup>
          <ListRow
            title="Your activity"
            icon="history"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/activity')}
          />
          <ListRow
            title="Saved"
            subtitle="Posts and collections you kept"
            icon="bookmark"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/saved')}
          />
          <ListRow
            title="Posts you liked"
            icon="heart"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/liked')}
          />
          <ListRow
            title="Reels you've watched"
            icon="reels"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/reels/watched')}
          />
          <ListRow
            title="Download your data"
            icon="download"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/data')}
          />
        </RowGroup>

        {isPlatformAdmin(user) ? (
          <>
            <GroupLabel>Staff</GroupLabel>
            <RowGroup>
              <ListRow
                title="Moderation console"
                subtitle="Review queue, model, blocklist"
                icon="gavel"
                iconTone="danger"
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push('/admin/moderation')}
              />
            </RowGroup>
          </>
        ) : null}

        <GroupLabel>About</GroupLabel>
        <RowGroup>
          <ListRow
            title="About Hikmah Web"
            icon="info"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/about')}
          />
          <ListRow
            title="Terms, privacy & guidelines"
            icon="book"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/policies')}
          />
        </RowGroup>

        <View style={{ height: 18 }} />
        <RowGroup>
          <ListRow
            title="Sign out"
            icon="logout"
            destructive
            onPress={signOut.open}
          />
          <ListRow
            title="Sign out of all devices"
            icon="devices"
            destructive
            onPress={signOutAll.open}
          />
        </RowGroup>

        <GroupFooter>
          Hikmah Web {CLIENT_VERSION}{CLIENT_BUILD ? ` (${CLIENT_BUILD})` : ''}
        </GroupFooter>
        </>
        )}
      </ScreenScroll>

      <ConfirmSheet
        visible={signOut.visible}
        onClose={signOut.close}
        title="Sign out?"
        message="You'll need your password to sign back in."
        confirmLabel="Sign out"
        destructive
        loading={busy}
        onConfirm={() => void doSignOut(false)}
      />
      <ConfirmSheet
        visible={signOutAll.visible}
        onClose={signOutAll.close}
        title="Sign out everywhere?"
        message="Every device signed in to this account will be signed out, including this one. Use this if you think someone else has access."
        confirmLabel="Sign out everywhere"
        destructive
        loading={busy}
        onConfirm={() => void doSignOut(true)}
      />
    </Screen>
  )
}
