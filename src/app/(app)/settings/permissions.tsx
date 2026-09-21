/* =========================================================
   Permissions & consent.

   Two different things that people conflate, side by side so
   the difference is visible:

     device permissions  what the OS lets Hikmah Web reach. We can ask
                         once; after a refusal only the system
                         settings can change it, which is why a
                         denied row offers Open Settings rather
                         than a button that would do nothing.
     consent record      the append-only log of what you allowed
                         us to HOLD. Only CONTACTS is a
                         documented scope, so the list renders
                         whatever scopes come back rather than
                         a hardcoded set.

   Permission state is re-read on every focus: the user can
   leave for the system settings, change something, and come
   back — and a stale "Denied" pill next to a working camera is
   the fastest way to lose their trust in this screen.
   ========================================================= */
import React from 'react'
import { Linking, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as Contacts from 'expo-contacts'
import * as ImagePicker from 'expo-image-picker'
import * as Notifications from 'expo-notifications'
import { Camera } from 'expo-camera'
import { api, errorText } from '@/api'
import { usePaged } from '@/hooks/usePaged'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Callout, ConfirmSheet, GroupFooter, GroupLabel, Header, ListFooter, ListRow,
  RowGroup, Screen, ScreenScroll, SkeletonList, Text, useSheetState, toast,
  type IconName,
} from '@/ui'

type Status = 'granted' | 'denied' | 'undetermined'
/** `askable` is Android's soft denial: refused once, but the OS will still let
 *  us prompt. Collapsing it into "denied" sends people to system settings for
 *  something a single tap could fix. */
interface State { status: Status; askable: boolean }

interface Permission {
  key: string
  label: string
  why: string
  icon: IconName
  read: () => Promise<State>
  request: () => Promise<State>
}

const normalise = (r: any): State => ({
  status: r?.granted ? 'granted' : r?.status === 'denied' ? 'denied' : 'undetermined',
  askable: r?.canAskAgain !== false,
})

const PERMISSIONS: Permission[] = [
  {
    key: 'contacts',
    label: 'Contacts',
    why: 'Only used to find people you already know, and only as hashes.',
    icon: 'contacts',
    read: async () => normalise(await Contacts.getPermissionsAsync()),
    request: async () => normalise(await Contacts.requestPermissionsAsync()),
  },
  {
    key: 'camera',
    label: 'Camera',
    why: 'Photos, video, and scanning someone else\'s QR code.',
    icon: 'camera',
    read: async () => normalise(await Camera.getCameraPermissionsAsync()),
    request: async () => normalise(await Camera.requestCameraPermissionsAsync()),
  },
  {
    key: 'microphone',
    label: 'Microphone',
    why: 'Voice messages, voice notes and calls.',
    icon: 'mic',
    read: async () => normalise(await Camera.getMicrophonePermissionsAsync()),
    request: async () => normalise(await Camera.requestMicrophonePermissionsAsync()),
  },
  {
    key: 'photos',
    label: 'Photos',
    why: 'Choosing images and videos to post or send.',
    icon: 'gallery',
    read: async () => normalise(await ImagePicker.getMediaLibraryPermissionsAsync()),
    request: async () => normalise(await ImagePicker.requestMediaLibraryPermissionsAsync()),
  },
  {
    key: 'notifications',
    label: 'Notifications',
    why: 'Messages, mentions and security alerts while the app is closed.',
    icon: 'bell',
    read: async () => normalise(await Notifications.getPermissionsAsync()),
    request: async () => normalise(await Notifications.requestPermissionsAsync()),
  },
]

export default function PermissionsScreen() {
  const t = useTheme()
  const c = t.colors
  const revoke = useSheetState()

  const [states, setStates] = React.useState<Record<string, State | null>>({})
  const [asking, setAsking] = React.useState<string | null>(null)

  const consent = useAsync<any>(() => api.settings.consent.state('CONTACTS'), { deps: [] })
  const history = usePaged<any>(
    ({ page, pageSize, signal }) => api.settings.consent.history({ page, size: pageSize, signal }),
    {
      mode: 'page',
      pageSize: 30,
      /* Consent rows are events, not entities — no id on the wire. */
      keyOf: r => `${r?.scope ?? ''}|${r?.occurredAt ?? ''}|${r?.granted}`,
    },
  )

  const readAll = React.useCallback(async () => {
    const pairs = await Promise.all(PERMISSIONS.map(async p => {
      try { return [p.key, await p.read()] as const }
      /* A module missing from this build is not a denial — it is unknowable,
         and an unknown row is dropped rather than shown as "Not asked". */
      catch { return [p.key, null] as const }
    }))
    setStates(Object.fromEntries(pairs))
  }, [])

  /* Every focus, because the user may have changed something in the OS. */
  useFocusEffect(React.useCallback(() => { void readAll() }, [readAll]))

  const ask = async (p: Permission) => {
    setAsking(p.key)
    try {
      const next = await p.request()
      setStates(prev => ({ ...prev, [p.key]: next }))
      if (next.status === 'denied' && !next.askable) {
        toast.info(`${p.label} is off. Only your phone's settings can turn it back on now.`)
      }
    } catch {
      toast.error(`Could not request ${p.label.toLowerCase()} access.`)
    } finally {
      setAsking(null)
    }
  }

  const withdrawContacts = async () => {
    revoke.close()
    try {
      /* One call does both: DELETE /contacts/sync wipes the uploaded hashes
         AND records the consent revocation server-side. Posting a second
         explicit withdrawal here would double-write the append-only log. */
      await api.settings.contactsSync.clear()
      await consent.reload()
      await history.reload()
      toast.ok('Uploaded contacts deleted and consent withdrawn')
    } catch (e) {
      toast.error(errorText(e, 'Could not withdraw that consent.'))
    }
  }

  return (
    <Screen background="sunken">
      <Header back title="Permissions & consent" />
      <ScreenScroll
        refreshing={history.refreshing}
        onRefresh={() => { void readAll(); void history.refresh(); void consent.refresh() }}
      >
        <GroupLabel>On this device</GroupLabel>
        <RowGroup>
          {PERMISSIONS.map(p => {
            const state = states[p.key]
            if (state === undefined) {
              return (
                <ListRow key={p.key} title={p.label} subtitle={p.why} icon={p.icon} iconTone="neutral" />
              )
            }
            if (state === null) {
              return (
                <ListRow
                  key={p.key}
                  title={p.label}
                  subtitle="Not available in this build"
                  icon={p.icon}
                  iconTone="neutral"
                  accessory={{ kind: 'none' }}
                />
              )
            }
            const granted = state.status === 'granted'
            const denied = state.status === 'denied'
            /* A soft denial can still be re-prompted; a hard one cannot, and
               sending someone to system settings for the first is a wasted trip. */
            const canPrompt = !granted && state.askable
            return (
              <ListRow
                key={p.key}
                title={p.label}
                subtitle={denied && !state.askable
                  ? `${p.why} Turn it on in your phone's settings.`
                  : p.why}
                icon={p.icon}
                iconTone={granted ? 'success' : denied ? 'danger' : 'neutral'}
                disabled={asking === p.key}
                accessory={{
                  kind: 'custom',
                  node: (
                    /* A text-bearing status plate is a SETBACK chip, never a
                       pill — the only pills in the app are unread counters
                       and LIVE badges. */
                    <View
                      style={{
                        ...setback(t.shape.chip),
                        borderCurve: 'continuous',
                        paddingHorizontal: space.sm2,
                        paddingVertical: space.xs,
                        backgroundColor: granted ? c.successSoft : denied ? c.dangerSoft : c.surfaceSunken,
                      }}
                    >
                      <Text
                        variant="caption"
                        color={granted ? c.successText : denied ? c.dangerText : c.textMuted}
                      >
                        {granted ? 'Granted' : denied ? 'Denied' : 'Not asked'}
                      </Text>
                    </View>
                  ),
                }}
                onPress={granted
                  ? undefined
                  : canPrompt
                    ? () => void ask(p)
                    : () => { void Linking.openSettings() }}
              />
            )
          })}
        </RowGroup>
        <GroupFooter>
          Once you refuse something for good, only your phone's settings can turn
          it back on — the app is not allowed to keep asking.
        </GroupFooter>

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: 12 }}>
          <Callout
            tone="neutral"
            icon="settings"
            title="Open Hikmah Web in system settings"
            actionLabel="Open Settings"
            onAction={() => { void Linking.openSettings() }}
          >
            Every permission above can also be changed there, including the ones
            already refused.
          </Callout>
        </View>

        <GroupLabel>Contact data</GroupLabel>
        <RowGroup>
          <ListRow
            title="Contact sync"
            subtitle={consent.data?.granted
              ? 'Your address book hashes are stored on our servers'
              : 'Nothing from your address book is stored'}
            icon="contacts"
            iconTone={consent.data?.granted ? 'accent' : 'neutral'}
            accessory={{
              kind: 'switch',
              value: !!consent.data?.granted,
              /* Turning it ON here would be consent without an upload, which is
                 meaningless — the sync screen owns that flow. */
              onValueChange: v => { if (!v) revoke.open() },
            }}
          />
        </RowGroup>
        <GroupFooter>
          Deleting your uploaded contacts removes your address book from our
          servers. It does NOT hide you from other people's syncs — the phone and
          email switches under Discovery do that.
        </GroupFooter>

        <GroupLabel>Your consent record</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
          <Text variant="footnote" tone="muted" align="ui">
            This is the log we keep so we can show we only held your data while
            you allowed it. It is append-only — a withdrawal adds a row, it never
            erases one.
          </Text>
        </View>

        {history.loading ? (
          <SkeletonList count={4} />
        ) : history.error && !history.items.length ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={history.reload}>
              {errorText(history.error, 'Your consent history could not be loaded.')}
            </Callout>
          </View>
        ) : !history.items.length ? (
          <RowGroup>
            <ListRow title="No consent events recorded yet" subtitle="Nothing has been asked for, or granted, on this account." />
          </RowGroup>
        ) : (
          <>
            <RowGroup>
              {history.items.map((row: any, i: number) => (
                <ListRow
                  key={`${row?.scope ?? ''}-${row?.occurredAt ?? ''}-${i}`}
                  title={humanise(row?.scope)}
                  subtitle={[
                    row?.occurredAt ? new Date(row.occurredAt).toLocaleString() : null,
                    row?.appVersion ? `v${row.appVersion}` : null,
                  ].filter(Boolean).join(' · ')}
                  icon={row?.granted ? 'check' : 'close'}
                  iconTone={row?.granted ? 'success' : 'danger'}
                  accessory={{
                    kind: 'value',
                    text: row?.granted ? 'Granted' : 'Withdrawn',
                    chevron: false,
                  }}
                />
              ))}
            </RowGroup>
            <ListFooter
              loading={history.loadingMore}
              error={history.items.length ? history.error : null}
              onRetry={history.loadMore}
              done={history.done}
              doneLabel=""
            />
            {!history.done ? (
              <View style={{ paddingHorizontal: t.layout.screenPadding }}>
                <Text
                  variant="subhead"
                  tone="accent"
                  align="center"
                  onPress={history.loadMore}
                  style={{ paddingVertical: space.md }}
                >
                  Load more
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScreenScroll>

      <ConfirmSheet
        visible={revoke.visible}
        onClose={revoke.close}
        title="Delete your uploaded contacts?"
        message="The hashes we hold are deleted and your consent is withdrawn. This does NOT hide you from other people's syncs — use the Discovery switches for that."
        confirmLabel="Delete"
        destructive
        icon="trash"
        onConfirm={() => void withdrawContacts()}
      />
    </Screen>
  )
}

/** CONTACTS → "Contacts". Only CONTACTS is documented, so anything else the
 *  server returns still gets a readable row rather than being dropped. */
function humanise(scope: unknown) {
  const s = String(scope || 'Unknown').replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
