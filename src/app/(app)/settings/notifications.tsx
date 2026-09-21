/* =========================================================
   Notifications.

   The backend's matrix is 42 types × 5 channels. Rendering
   210 switches would be honest and unusable, so this screen
   does what the panel is for: pick a CHANNEL, then toggle the
   types within it. One channel at a time keeps every row a
   single yes/no question.

   Three rules from the settings module, all load-bearing:

   1. The response always carries the WHOLE enum. Any type no
      curated group claims still gets a row, under "Other" —
      hiding a row the server returns is exactly how five types
      became untoggleable on the web.
   2. ACCOUNT_WARNING is BYPASS_ALL. It renders locked on, with
      the reason, rather than as a switch that silently refuses.
   3. DND's PUT is a patch that RE-DERIVES `enabled` from the
      window when you omit it. So `enabled` is always sent
      explicitly, even when it is not what changed.
   ========================================================= */
import React from 'react'
import { Platform, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useRouter } from 'expo-router'
import {
  api, CHANNEL_LABELS, DND_DAYS, errorText, LOCKED_NOTIFICATION_TYPES, NOTIFICATION_GROUPS,
} from '@/api'
/* The barrel does not re-export this one — it exists for exactly this diff. */
import { GROUPED_NOTIFICATION_TYPES } from '@/api/settings.js'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { enablePush, disablePush, pushPermissionState, type PushState } from '@/lib/pushNotify'
import {
  Callout, Chip, ErrorState, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, SkeletonList, Text, Touchable, toast,
} from '@/ui'

type Channel = 'PUSH' | 'IN_APP' | 'EMAIL' | 'SMS' | 'DESKTOP'

/* DESKTOP has no meaning on a phone; SMS is only real once a number is bound.
   Offering either as a headline tab would be a switch with no effect. */
const PHONE_CHANNELS: Channel[] = ['PUSH', 'IN_APP', 'EMAIL']

export default function NotificationSettings() {
  const t = useTheme()
  const router = useRouter()
  const [channel, setChannel] = React.useState<Channel>('PUSH')
  const [pending, setPending] = React.useState<string | null>(null)
  const [push, setPush] = React.useState<PushState>('undetermined')

  const matrix = useAsync<Record<string, Record<string, boolean>>>(
    () => api.settings.notifications.matrix(), { deps: [] },
  )
  const dnd = useAsync<any>(() => api.settings.notifications.dnd(), { deps: [] })

  React.useEffect(() => { void pushPermissionState().then(setPush) }, [])

  /* Any type the server returned that no curated group claims. */
  const otherTypes = React.useMemo(() => {
    if (!matrix.data) return []
    return Object.keys(matrix.data)
      .filter(type => !GROUPED_NOTIFICATION_TYPES.has(type))
      .sort()
  }, [matrix.data])

  const setPref = async (type: string, enabled: boolean) => {
    const key = `${type}:${channel}`
    setPending(key)
    const previous = matrix.data
    matrix.setData(prev => (prev ? { ...prev, [type]: { ...prev[type], [channel]: enabled } } : prev))
    try {
      await api.settings.notifications.setPref(type, channel, enabled)
    } catch (e) {
      matrix.setData(previous ?? null)
      toast.error(errorText(e, 'Could not save that preference.'))
    } finally {
      setPending(null)
    }
  }

  const togglePush = async (on: boolean) => {
    if (!on) { await disablePush(); setPush('undetermined'); toast.ok('Push notifications turned off'); return }
    const state = await enablePush()
    setPush(state)
    if (state === 'denied') {
      toast.warn('Push is blocked for Hikmah Web in your phone’s settings.')
    } else if (state === 'unsupported') {
      toast.warn('This device can’t receive push notifications.')
    } else if (state === 'unregistered') {
      /* Permission granted, token never delivered. Saying "on" here would be
         a lie the user only discovers by never being notified. */
      toast.warn('Allowed on this phone, but this build can’t receive push yet.')
    }
  }

  const writeDnd = async (patch: Record<string, unknown>) => {
    const previous = dnd.data
    const next = { ...(dnd.data || {}), ...patch }
    dnd.setData(next)
    try {
      /* `enabled` always goes on the wire: omitting it makes the server
         re-derive it from the window, which silently turns DND on. */
      await api.settings.notifications.updateDnd({ ...patch, enabled: !!next.enabled })
    } catch (e) {
      dnd.setData(previous ?? null)
      /* BAD_TIME and BAD_TIMEZONE name the offending value; swallowing them
         leaves the user retrying the same rejected window forever. */
      toast.error(errorText(e, 'Could not update Do Not Disturb.'))
    }
  }

  if (matrix.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Notifications" />
        <SkeletonList count={10} />
      </Screen>
    )
  }
  if (matrix.error) {
    return (
      <Screen background="sunken">
        <Header back title="Notifications" />
        <ErrorState error={matrix.error} onRetry={matrix.reload} />
      </Screen>
    )
  }

  const data = matrix.data || {}
  const d = dnd.data || {}
  const daysMask = Number(d.daysMask ?? 0)

  return (
    <Screen background="sunken">
      <Header
        back
        title="Notifications"
        below={
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}>
            <SegmentedControl<Channel>
              value={channel}
              onChange={setChannel}
              options={PHONE_CHANNELS.map(ch => ({
                value: ch,
                label: (CHANNEL_LABELS as Record<string, string>)[ch] ?? ch,
              }))}
            />
          </View>
        }
      />

      <ScreenScroll refreshing={matrix.refreshing} onRefresh={matrix.refresh}>
        {channel === 'PUSH' ? (
          <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
            {push === 'denied' ? (
              <Callout tone="warning" title="Push is blocked" icon="mutedBell">
                Hikmah Web can't send push notifications until you allow them in your phone's
                Settings → Notifications → Hikmah Web. The switches below will have no effect
                until then.
              </Callout>
            ) : push === 'unsupported' ? (
              <Callout tone="neutral" icon="devices">
                Push notifications need a real device — a simulator can't receive them.
              </Callout>
            ) : (
              <RowGroup card={false}>
                <ListRow
                  title="Allow push notifications"
                  subtitle="Register this device to receive push"
                  icon="bell"
                  iconTone="accent"
                  accessory={{
                    kind: 'switch',
                    value: push === 'granted',
                    onValueChange: v => void togglePush(v),
                  }}
                />
              </RowGroup>
            )}
          </View>
        ) : null}

        <GroupLabel>Delivery</GroupLabel>
        <RowGroup>
          <ListRow
            title="Devices"
            subtitle="Where push notifications are being sent"
            icon="devices"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/notifications/devices')}
          />
          <ListRow
            title="Email preferences"
            icon="mail"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/notifications/email')}
          />
        </RowGroup>

        <GroupLabel>Do not disturb</GroupLabel>
        {dnd.error ? (
          /* Empty ≠ error: without this the rows below silently render DEFAULTS
             over an unloaded schedule, and a write from that state would
             overwrite what is stored (messaging.tsx precedent). */
          <Callout tone="warning" actionLabel="Retry" onAction={dnd.reload} style={{ marginHorizontal: t.layout.screenPadding, marginBottom: 10 }}>
            Your quiet-hours schedule could not be loaded — the rows below show
            defaults until it is.
          </Callout>
        ) : null}
        <RowGroup>
          <ListRow
            title="Quiet hours"
            subtitle={d.enabled && d.startTime && d.endTime
              ? `${d.startTime} – ${d.endTime}`
              : 'Silence notifications on a schedule'}
            icon="moon"
            iconTone="accent"
            accessory={{
              kind: 'switch',
              value: !!d.enabled,
              onValueChange: v => void writeDnd({ enabled: v }),
            }}
          />
          {d.enabled ? (
            <ListRow
              title="From"
              accessory={{
                kind: 'custom',
                node: <TimeField value={d.startTime} onChange={v => void writeDnd({ startTime: v })} />,
              }}
            />
          ) : null}
          {d.enabled ? (
            <ListRow
              title="Until"
              accessory={{
                kind: 'custom',
                node: <TimeField value={d.endTime} onChange={v => void writeDnd({ endTime: v })} />,
              }}
            />
          ) : null}
        </RowGroup>

        {d.enabled ? (
          <>
            <RowGroup>
              <ListRow
                title="More quiet-hours options"
                subtitle="Time zone, one-off mute, per-day schedule"
                icon="moon"
                iconTone="neutral"
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push('/settings/notifications/dnd')}
              />
            </RowGroup>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: t.layout.screenPadding, paddingTop: 12 }}>
              {(DND_DAYS as [string, number][]).map(([label, bit]) => {
                /* 0 means every day — render that as all seven selected rather
                   than none, which is what it actually does. */
                const on = daysMask === 0 || (daysMask & bit) !== 0
                return (
                  <Chip
                    key={label}
                    label={label}
                    selected={on}
                    onPress={() => {
                      const base = daysMask === 0 ? 127 : daysMask
                      const next = on ? base & ~bit : base | bit
                      void writeDnd({ daysMask: next === 127 ? 0 : next })
                    }}
                  />
                )
              })}
            </View>
            <GroupFooter>
              Account warnings are always delivered, even during quiet hours.
            </GroupFooter>
          </>
        ) : null}

        {NOTIFICATION_GROUPS.map((group: any) => (
          <View key={group.label}>
            <GroupLabel>{group.label}</GroupLabel>
            <RowGroup inset={t.layout.screenPadding}>
              {(group.rows as string[][]).map(([type, label]) => {
                const locked = LOCKED_NOTIFICATION_TYPES.has(type)
                return (
                  <ListRow
                    key={type}
                    title={label}
                    subtitle={locked ? 'Always delivered — this one can’t be turned off' : undefined}
                    disabled={locked || pending === `${type}:${channel}`}
                    accessory={{
                      kind: 'switch',
                      value: locked ? true : !!data[type]?.[channel],
                      disabled: locked,
                      onValueChange: v => void setPref(type, v),
                    }}
                  />
                )
              })}
            </RowGroup>
          </View>
        ))}

        {otherTypes.length ? (
          <>
            <GroupLabel>Other</GroupLabel>
            <RowGroup inset={t.layout.screenPadding}>
              {otherTypes.map(type => (
                <ListRow
                  key={type}
                  title={humanise(type)}
                  disabled={pending === `${type}:${channel}`}
                  accessory={{
                    kind: 'switch',
                    value: !!data[type]?.[channel],
                    onValueChange: v => void setPref(type, v),
                  }}
                />
              ))}
            </RowGroup>
            <GroupFooter>
              These exist in the system but nothing sends them yet. They are shown
              so a new notification type is never silently untoggleable.
            </GroupFooter>
          </>
        ) : null}
      </ScreenScroll>
    </Screen>
  )
}

/** `HH:mm` in, `HH:mm` out. The native picker speaks Date, so the string is
 *  parsed onto today's date and formatted back. */
function TimeField({ value, onChange }: { value?: string | null; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const parsed = React.useMemo(() => {
    const [h, m] = String(value || '22:00').split(':').map(Number)
    const d = new Date()
    d.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0)
    return d
  }, [value])

  return (
    <>
      <Touchable onPress={() => setOpen(true)} feedback="dim" style={{ paddingVertical: space.xs, paddingHorizontal: space.xs2 }}>
        <Text variant="callout" tone="accent">{value || '22:00'}</Text>
      </Touchable>
      {open ? (
        <DateTimePicker
          value={parsed}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          onChange={(_e, date) => {
            setOpen(Platform.OS === 'ios')
            if (!date) return
            onChange(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
          }}
        />
      ) : null}
    </>
  )
}

/** ENUM_NAME → "Enum name", for the types no curated group has a label for. */
function humanise(type: string) {
  const s = type.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
