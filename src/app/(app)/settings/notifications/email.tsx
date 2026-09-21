/* =========================================================
   Email preferences.

   The key set is SERVER-OWNED. A hardcoded list of switches
   would silently hide any preference the backend adds later —
   which is exactly how a user ends up unable to turn off an
   email they keep receiving. So every boolean key in the
   response becomes a row, with a humanised label and a
   description only where one is actually known.

   Two write rules:
     · each toggle sends ONLY its own key, so a stale local copy
       can never clobber a preference changed elsewhere;
     · unsubscribe-all repaints from the RESPONSE rather than
       assuming everything went false — the server decides which
       categories are opt-outable and which are not.
   ========================================================= */
import React from 'react'
import { api, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import {
  ConfirmSheet, ErrorState, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, useSheetState, toast,
} from '@/ui'

/* Descriptions for the keys this client knows about. A key that is not here
   still renders — it just gets its label and nothing else. The five the wire
   documents today: master, social, mentions, system, trending. */
const DESCRIPTIONS: Record<string, string> = {
  master: 'The switch above the others — off means no notification emails of any kind.',
  social: 'Engagement on your content: reactions, comments, replies, shares, follows, stories, research and Q&A.',
  mentions: 'Direct @username mentions, anywhere.',
  system: 'Platform messages, moderation and account warnings.',
  trending: 'The daily trending digest. Its own switch — independent of System.',
  marketing: 'Product news and announcements from Hikmah Web.',
  productUpdates: 'What changed in the app.',
  newsletter: 'The periodic digest.',
  weeklyDigest: 'A weekly summary of what you missed.',
  dailyDigest: 'A daily summary of what you missed.',
  digest: 'A periodic summary of what you missed.',
  socialActivity: 'Follows, mentions and reactions, batched.',
  comments: 'Replies to your posts and research.',
  research: 'Citations, contributor invitations and research activity.',
  messages: 'Emails about unread direct messages.',
  recommendations: 'People and topics we think you would follow.',
  securityAlerts: 'Sign-ins from new places. These always arrive.',
}

/* Preferences the backend does not let you switch off. Rendering them as live
   switches would be a control that silently refuses. */
const LOCKED_KEYS = new Set(['securityAlerts', 'security', 'transactional', 'accountAlerts'])

export default function EmailPrefsScreen() {
  const t = useTheme()
  const { user } = useAuth()
  const confirmAll = useSheetState()
  const [cooldown, startCooldown] = useCooldown() as [number, (e: unknown) => boolean]

  const prefs = useAsync<Record<string, any>>(() => api.users.emailPrefs(), { deps: [] })

  const keys = React.useMemo(() => {
    const data = prefs.data
    if (!data || typeof data !== 'object') return []
    return Object.keys(data).filter(k => typeof data[k] === 'boolean').sort()
  }, [prefs.data])

  const toggle = async (key: string, value: boolean) => {
    const previous = prefs.data
    prefs.setData(prev => ({ ...(prev || {}), [key]: value }))
    try {
      /* Only this key on the wire — never the whole object. */
      const fresh = await api.users.updateEmailPrefs({ [key]: value })
      if (fresh && typeof fresh === 'object') prefs.setData(fresh as any)
    } catch (e) {
      prefs.setData(previous ?? null)
      toast.error(errorText(e, 'Could not save that preference.'))
    }
  }

  const sendTest = useAction(async () => {
    await api.users.testEmail()
    /* Cooldown on this row alone — the send budget is small and shared. */
    startCooldown(30)
    toast.ok('Sent — check your inbox, and your spam folder the first time')
  }, {
    onError: e => {
      if (startCooldown(e)) return
      toast.error(errorText(e, 'Could not send the test email.'))
    },
  })

  const unsubscribeAll = useAction(async () => {
    /* The response is NOT the flag set — it is `{emailNotificationsEnabled:
       false}` alone (the RFC 8058 one-click target answers minimally), so
       adopting it wholesale would erase every switch from the screen. Only the
       master toggle changed; the category flags are left untouched so
       re-enabling master restores the previous setup. */
    await api.users.unsubscribeAll()
    prefs.setData(prev => ({ ...(prev || {}), master: false }))
    toast.ok('Unsubscribed — no more notification emails')
  }, { onError: e => toast.error(errorText(e, 'Could not unsubscribe.')) })

  if (prefs.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Email preferences" />
        <SkeletonList count={5} />
      </Screen>
    )
  }
  if (prefs.error) {
    return (
      <Screen background="sunken">
        <Header back title="Email preferences" />
        <ErrorState error={prefs.error} onRetry={prefs.reload} />
      </Screen>
    )
  }

  const data = prefs.data || {}

  return (
    <Screen background="sunken">
      <Header back title="Email preferences" />
      <ScreenScroll refreshing={prefs.refreshing} onRefresh={prefs.refresh}>
        <GroupLabel>What we email you</GroupLabel>
        <RowGroup inset={t.layout.screenPadding}>
          {keys.length ? keys.map(key => {
            const locked = LOCKED_KEYS.has(key)
            return (
              <ListRow
                key={key}
                title={humanise(key)}
                subtitle={DESCRIPTIONS[key] ?? (locked ? 'Always delivered.' : undefined)}
                disabled={locked}
                accessory={{
                  kind: 'switch',
                  value: locked ? true : !!data[key],
                  disabled: locked,
                  onValueChange: v => void toggle(key, v),
                }}
              />
            )
          }) : (
            <ListRow
              title="No email preferences on this account"
              subtitle="Nothing to configure — the server returned an empty set."
            />
          )}
        </RowGroup>
        <GroupFooter>
          These affect email only — in-app notifications keep arriving either
          way. Per-event email delivery lives in Notifications, under the Email
          channel.
        </GroupFooter>

        <GroupLabel>Test and opt out</GroupLabel>
        <RowGroup>
          <ListRow
            title={cooldown > 0 ? `Send again in ${cooldown}s` : 'Send me a test email'}
            subtitle={user?.email || 'The address on your account'}
            icon="mail"
            iconTone="accent"
            disabled={cooldown > 0 || sendTest.pending}
            onPress={() => void sendTest.run()}
          />
          <ListRow
            title="Unsubscribe from everything"
            icon="mutedBell"
            destructive
            onPress={confirmAll.open}
          />
        </RowGroup>
        <GroupFooter>
          The master switch is absolute: off means no notification emails at
          all. Security and sign-in alerts still reach you in the app either
          way.
        </GroupFooter>
      </ScreenScroll>

      <ConfirmSheet
        visible={confirmAll.visible}
        onClose={confirmAll.close}
        title="Unsubscribe from all email?"
        message="No more notification emails of any kind until you turn the master switch back on. Your per-category choices are kept. In-app notifications keep arriving."
        confirmLabel="Unsubscribe"
        destructive
        icon="mutedBell"
        loading={unsubscribeAll.pending}
        onConfirm={async () => { confirmAll.close(); await unsubscribeAll.run() }}
      />
    </Screen>
  )
}

/** `weeklyDigest` → "Weekly digest". The key set is server-owned, so the label
 *  has to be derivable rather than looked up. */
function humanise(key: string) {
  const spaced = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
