/* =========================================================
   Registered devices — the push-token registry.

   The honest headline first: the server's PushSender default is
   a stub, so nothing is delivered yet. Registering now means it
   works the day it ships, and the caption says exactly that
   rather than implying push already arrives.

   Token hygiene is the part worth getting right. `enablePush()`
   short-circuits when the cached token is unchanged, which is
   correct on launch and wrong here — a row deleted from this
   list would never come back, because the client still thinks
   it is registered. So "Register this device" runs
   `disablePush()` first: it clears the local cache and deletes
   the stored row (a 204 even for an unknown id), and the
   re-registration that follows always produces a live row.

   Scroll shape: module-scope keyExtractor, a memoized row fed an
   item-first `onRemove`, and a header passed by stable
   reference — FlashList's ViewHolder memo compares renderItem
   BY IDENTITY, so an inline arrow re-renders every cell.
   ========================================================= */
import React from 'react'
import { Linking, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { api, errorText } from '@/api'
import { useAction, useAsync, useEvent } from '@/hooks/useAsync'
import { disablePush, enablePush, pushPermissionState, type PushState } from '@/lib/pushNotify'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, EmptyState, ErrorState, GroupFooter, Header, Icon, Screen,
  SkeletonRow, Text, Touchable, toast, type IconName,
} from '@/ui'

interface TokenRow {
  id: string
  provider?: string | null
  platform?: string | null
  lastSeenAt?: string | null
  token?: string | null
}

const keyExtractor = (r: TokenRow) => String(r.id)

const DeviceRow = React.memo(function DeviceRow(
  { item, onRemove }: { item: TokenRow; onRemove: (row: TokenRow) => void },
) {
  const t = useTheme()
  const c = t.colors
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: t.layout.screenPadding,
        paddingVertical: space.md,
      }}
    >
      <View
        style={{
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name={platformIcon(item.platform)} size={18} color={c.textSecondary} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" align="ui" numberOfLines={1}>
          {[item.provider || 'Unknown provider', prettyPlatform(item.platform)].filter(Boolean).join(' · ')}
        </Text>
        <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
          {item.lastSeenAt ? `Last seen ${relative(item.lastSeenAt)}` : 'Never used'}
        </Text>
        {item.token ? (
          <Text variant="caption" tone="faint" align="ui" numberOfLines={1}>
            {String(item.token).slice(0, 8)}…
          </Text>
        ) : null}
      </View>

      <Touchable
        onPress={() => onRemove(item)}
        feedback="dim"
        accessibilityLabel="Remove this device"
        style={{ paddingHorizontal: space.xs2, paddingVertical: space.sm }}
      >
        <Text variant="subhead" tone="danger">Remove</Text>
      </Touchable>
    </View>
  )
})

export default function PushDevicesScreen() {
  const t = useTheme()
  const [permission, setPermission] = React.useState<PushState>('undetermined')

  const tokens = useAsync<TokenRow[]>(() => api.settings.notifications.pushTokens(), { deps: [] })

  React.useEffect(() => { void pushPermissionState().then(setPermission) }, [])

  const register = useAction(async () => {
    /* Drop the local cache first — see the header. */
    await disablePush()
    const state = await enablePush()
    setPermission(state)
    if (state === 'denied') { toast.warn('Push is blocked for Hikmah Web in your phone’s settings.'); return }
    if (state === 'unsupported') { toast.warn('A simulator can’t receive push notifications.'); return }
    if (state === 'unregistered') {
      /* The permission is real but no token reached the server, so claiming
         "registered" would be false — and this screen exists precisely to show
         which devices ARE registered. */
      toast.warn('Allowed on this phone, but this build can’t receive push yet.')
      await tokens.reload()
      return
    }
    await tokens.reload()
    toast.ok('This device is registered')
  }, { onError: e => toast.error(errorText(e, 'Could not register this device.')) })

  const remove = useEvent(async (row: TokenRow) => {
    const previous = tokens.data ?? []
    tokens.setData(prev => (prev ?? []).filter(r => String(r.id) !== String(row.id)))
    try {
      await api.settings.notifications.deletePushToken(row.id)
      /* The removed row may have been this device's, and there is no way to
         tell — the raw token is never echoed back. Clearing the local cache
         costs one extra registration and prevents a silent dead end. */
      await disablePush()
      setPermission(await pushPermissionState())
    } catch (e) {
      tokens.setData(previous)
      toast.error(errorText(e, 'Could not remove that device.'))
    }
  })

  const rows = tokens.data ?? []

  const renderItem = React.useCallback(
    ({ item }: { item: TokenRow }) => <DeviceRow item={item} onRemove={remove} />,
    [remove],
  )

  /* The header carries a Button and two Callouts — a fresh element identity
     would re-render the whole block on every list render. */
  const listHeader = React.useMemo(() => (
    <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
      {permission === 'denied' ? (
        <Callout
          tone="warning"
          icon="mutedBell"
          title="Push is blocked"
          actionLabel="Open Settings"
          onAction={() => { void Linking.openSettings() }}
        >
          Hikmah Web can't register this device until notifications are allowed in
          your phone's settings.
        </Callout>
      ) : permission === 'unsupported' ? (
        <Callout tone="neutral" icon="devices">
          Push tokens aren't available on this device — a simulator can't mint
          one. Everything else on this screen still works.
        </Callout>
      ) : (
        <Button
          label="Register this device"
          icon="bell"
          variant="primary"
          size="lg"
          block
          loading={register.pending}
          onPress={() => void register.run()}
        />
      )}

      {tokens.loading ? (
        <View>{Array.from({ length: 2 }, (_, i) => <SkeletonRow key={i} avatarSize={30} lines={2} />)}</View>
      ) : null}
    </View>
  ), [t.layout.screenPadding, permission, register.pending, register.run, tokens.loading])

  return (
    <Screen>
      <Header back title="Registered devices" />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        refreshing={tokens.refreshing}
        onRefresh={tokens.refresh}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          tokens.loading ? null : tokens.error ? (
            <ErrorState error={tokens.error} onRetry={tokens.reload} />
          ) : (
            <EmptyState
              icon="mutedBell"
              title="No devices registered"
              message="Register this phone and it will receive push notifications as soon as delivery is switched on."
              compact
            />
          )
        }
        ListFooterComponent={
          <GroupFooter>
            Push isn't delivered by the server yet — the sender is a stub.
            Registering now means it works the day it ships. Removing a device
            here stops it receiving anything; it does not sign it out.
          </GroupFooter>
        }
        renderItem={renderItem}
      />
    </Screen>
  )
}

function platformIcon(platform?: string | null): IconName {
  const p = String(platform || '').toUpperCase()
  if (p.includes('WEB') || p.includes('BROWSER')) return 'globe'
  if (p.includes('DESKTOP') || p.includes('MAC') || p.includes('WINDOWS')) return 'storage'
  return 'devices'
}

function prettyPlatform(platform?: string | null) {
  const p = String(platform || '').trim()
  if (!p) return ''
  if (p.toUpperCase() === 'IOS') return 'iOS'
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
}

function relative(iso: string) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'recently'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
