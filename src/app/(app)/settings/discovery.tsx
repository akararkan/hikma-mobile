/* =========================================================
   Discovery & contacts.

   Contact sync is the one place in the app where the client
   sends data ABOUT people who are not users, so the consent
   story has to be visible rather than buried:

     · phone numbers and emails are hashed on the device
       (lib/contactHash.js) and only the hashes are sent
     · the sync endpoint is rate-limited to 3 per 24h and
       writes a consent record — the deprecated alias that
       bypassed both is deliberately not used
     · "Stop syncing" both clears the stored hashes and revokes
       the consent, in one call

   The QR code deliberately encodes the WEB link, not a deep
   link: whoever scans it is usually a stranger without the app,
   and a bare `ikamobileapp://` code is inert on their phone.
   `qrWebLink` returns null when no web origin is configured,
   and a missing QR beats one that scans to nothing.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
/* SDK 57 moved the classic API: `getContactsAsync`/`Fields` on the ROOT
   export now THROW (legacyWarnings.ts) — the working set is at /legacy,
   exactly like expo-file-system. */
import * as Contacts from 'expo-contacts/legacy'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api, errorText, isRateLimited, cooldownSecondsFrom } from '@/api'
import { digestOfHashes, hashContacts, MAX_HASHES_PER_SYNC } from '@/lib/contactHash.js'
import { storage } from '@/platform/storage'
import { qrAppLink, qrWebLink } from '@/lib/qrToken.js'
import { CLIENT_VERSION } from '@/lib/version.js'

/* A fingerprint of the last batch this device uploaded — see sync() below. */
const CONTACTS_DIGEST_KEY = 'ika_contacts_digest'
import { useAsync, useAction } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, GroupFooter, GroupLabel, Header, ListRow,
  RowGroup, Screen, ScreenScroll, Text, useSheetState, toast,
} from '@/ui'

export default function DiscoverySettings() {
  const t = useTheme()
  const router = useRouter()

  const block = useAsync<any>(() => api.settings.discovery.get(), { deps: [] })
  const qr = useAsync<any>(() => api.settings.discovery.qr(), { deps: [] })
  const consent = useAsync<any>(() => api.settings.consent.state('CONTACTS'), { deps: [] })

  const stopSync = useSheetState()
  const [lastSync, setLastSync] = React.useState<{ stored: number; skipped: number; matched: number } | null>(null)

  const write = async (patch: Record<string, boolean>) => {
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), ...patch }))
    try {
      /* PUT is merge-style — only what changed goes on the wire. */
      const fresh = await api.settings.discovery.update(patch)
      if (fresh && typeof fresh === 'object') block.setData(fresh)
    } catch (e) {
      block.setData(previous ?? null)
      toast.error(errorText(e, 'Could not change that setting.'))
    }
  }

  const sync = useAction(async () => {
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') {
      toast.warn('Hikmah Web needs contacts permission to find people you know.')
      return
    }
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    })

    /* `hashContacts` does the normalising, deduping and capping itself — and it
       has to, because the normalisation contract IS the interop surface: a
       number hashed here must join against one hashed by the web client. */
    const entries: { phone?: string; email?: string }[] = []
    for (const c of data) {
      for (const p of c.phoneNumbers ?? []) entries.push({ phone: p.number })
      for (const e of c.emails ?? []) entries.push({ email: e.email })
      if (entries.length >= MAX_HASHES_PER_SYNC) break
    }

    if (!entries.length) { toast.info('No phone numbers or emails found in your contacts.'); return }

    const { hashes, skipped: localSkipped } = await hashContacts(entries)
    if (!hashes.length) { toast.info('Nothing in your contacts could be matched.'); return }

    /* An unchanged address book uploads nothing. The sync is rate-limited to
       roughly once a day, so spending that allowance re-sending a batch the
       server already has means a genuine change later gets refused. Only a
       fingerprint is kept — never the hashes, which would be an address book
       on disk. Suggestions are still recomputed, since that is what the user
       pressed the button for. */
    const digest = await digestOfHashes(hashes)
    if (storage.getItem(CONTACTS_DIGEST_KEY) === digest) {
      await api.posts.recomputeSuggestions().catch(() => {})
      toast.ok('Your contacts are already up to date')
      return
    }

    const res: any = await api.settings.contactsSync.sync(hashes, CLIENT_VERSION)
    try { storage.setItem(CONTACTS_DIGEST_KEY, digest) } catch { /* storage blocked — just sync again next time */ }
    setLastSync({
      stored: Number(res?.stored ?? 0),
      /* Two sources of "skipped": entries this device could not normalise, and
         hashes the server refused. Both mean "your batch was trimmed", which is
         a different message from "nobody you know is here". */
      skipped: Number(res?.skipped ?? 0) + localSkipped,
      matched: Number(res?.matched ?? 0),
    })
    void consent.reload()
    toast.ok(res?.matched ? `Found ${res.matched} people you know` : 'Synced — nobody in your contacts is here yet')
  }, {
    onError: e => {
      toast.error(isRateLimited(e)
        ? `You can sync again in ${Math.ceil(cooldownSecondsFrom(e) / 3600) || 24} hours.`
        : errorText(e, 'Could not sync your contacts.'))
    },
  })

  const clearSync = useAction(async () => {
    await api.settings.contactsSync.clear()
    /* The server no longer holds the batch, so the next sync must actually
       upload one — a stale fingerprint here would short-circuit it. */
    try { storage.removeItem(CONTACTS_DIGEST_KEY) } catch { /* nothing to forget */ }
    setLastSync(null)
    void consent.reload()
    toast.ok('Contacts removed and consent withdrawn')
  }, { onError: e => toast.error(errorText(e, 'Could not remove your contacts.')) })

  const rotate = useAction(async () => {
    await api.settings.discovery.rotateQr()
    await qr.reload()
    toast.ok('Your code was replaced — the old one no longer works')
  }, { onError: e => toast.error(errorText(e, 'Could not replace your code.')) })

  const d = block.data || {}
  const token = qr.data?.opaqueToken
  const webLink = token ? qrWebLink(token) : null
  const appLink = token ? qrAppLink(token) : null
  const synced = consent.data?.granted === true

  return (
    <Screen background="sunken">
      <Header back title="Discovery & contacts" />
      <ScreenScroll refreshing={block.refreshing} onRefresh={() => { void block.refresh(); void qr.refresh() }}>
        <GroupLabel>How people can find you</GroupLabel>
        <RowGroup>
          <ListRow
            title="By username"
            subtitle="Anyone who knows your @handle"
            icon="at"
            iconTone="accent"
            accessory={{ kind: 'switch', value: d.byUsername !== false, onValueChange: v => void write({ byUsername: v }) }}
          />
          <ListRow
            title="By phone number"
            subtitle="People with your number in their contacts"
            icon="phone"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: !!d.byPhone, onValueChange: v => void write({ byPhone: v }) }}
          />
          <ListRow
            title="By email address"
            icon="mail"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: !!d.byEmail, onValueChange: v => void write({ byEmail: v }) }}
          />
          <ListRow
            title="By QR code"
            subtitle="People who scan the code below"
            icon="qr"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: d.byQr !== false, onValueChange: v => void write({ byQr: v }) }}
          />
          <ListRow
            title="Appear in search engines"
            subtitle="Let your public profile be indexed"
            icon="globe"
            iconTone="neutral"
            accessory={{ kind: 'switch', value: !!d.indexable, onValueChange: v => void write({ indexable: v }) }}
          />
        </RowGroup>
        <GroupFooter>
          Turning something off here does not hide you from people who already
          follow you — use Privacy for that.
        </GroupFooter>

        <GroupLabel>Your code</GroupLabel>
        <RowGroup>
          <ListRow
            title="Show my QR code"
            subtitle="Let someone add you by scanning"
            icon="qr"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/qr')}
          />
          <ListRow
            title="Scan a code"
            icon="scan"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/scan')}
          />
          {webLink || appLink ? (
            <ListRow
              title="Copy my link"
              icon="link"
              iconTone="neutral"
              onPress={async () => {
                await Clipboard.setStringAsync(webLink || appLink!)
                toast.ok('Link copied')
              }}
            />
          ) : null}
          <ListRow
            title="Replace my code"
            subtitle="The current one stops working immediately"
            icon="refresh"
            iconTone="warning"
            disabled={rotate.pending}
            onPress={() => void rotate.run()}
          />
        </RowGroup>
        {!webLink && appLink ? (
          <GroupFooter>
            Your link opens Hikmah Web directly. Anyone without the app installed will need
            to install it first.
          </GroupFooter>
        ) : null}

        <GroupLabel>Contacts</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.md }}>
          {/* No irreversibility claim: the doc is explicit that unsalted
              SHA-256 over phone numbers is brute-forceable and product copy
              must not promise otherwise. */}
          <Callout tone="neutral" icon="lock" title="Your address book stays on your phone">
            Numbers and email addresses are turned into hashes on this device,
            and only the hashes are uploaded and compared — we never receive
            your contacts themselves. You can delete the hashes at any time.
          </Callout>
        </View>
        <RowGroup>
          <ListRow
            title={synced ? 'Sync again' : 'Find people I know'}
            subtitle={lastSync
              ? `${lastSync.matched} matched · ${lastSync.stored} stored${lastSync.skipped ? ` · ${lastSync.skipped} skipped` : ''}`
              : 'Up to three times a day'}
            icon="contacts"
            iconTone="accent"
            disabled={sync.pending}
            onPress={() => void sync.run()}
          />
          {synced ? (
            <ListRow
              title="Stop syncing and delete"
              subtitle="Removes the stored hashes and withdraws consent"
              icon="trash"
              destructive
              onPress={stopSync.open}
            />
          ) : null}
        </RowGroup>
        {lastSync && lastSync.skipped > 0 ? (
          <GroupFooter>
            {lastSync.skipped} entries were skipped — usually duplicates or numbers
            that aren't in a recognisable format.
          </GroupFooter>
        ) : null}
      </ScreenScroll>

      <ConfirmSheet
        visible={stopSync.visible}
        onClose={stopSync.close}
        title="Delete your synced contacts?"
        message="This deletes your address book's hashes from our servers and withdraws consent. It does not stop other people finding you by your number or email — the switches above control that."
        confirmLabel="Delete"
        destructive
        loading={clearSync.pending}
        onConfirm={async () => { await clearSync.run(); stopSync.close() }}
      />
    </Screen>
  )
}
