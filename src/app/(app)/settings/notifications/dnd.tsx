/* =========================================================
   Do Not Disturb.

   Three traps live in this one endpoint and all three are
   handled here rather than discovered in production:

   1. `enabled` must go on EVERY write. The PUT is patch-style
      for everything else, but omitting `enabled` makes the
      server re-derive it from the window — which silently turns
      quiet hours on because you changed a timezone.
   2. Times are strictly 'HH:mm'. Anything else is 400 BAD_TIME.
   3. `daysMask` bit 0 (1) is Monday … bit 6 (64) is Sunday, and
      0 means EVERY day. Rendering 0 as "no days selected" is
      backwards, so a zero mask paints all seven pills on and the
      caption says "Every day".

   Writes are debounced because a time picker fires on every
   spin, and each write drops the module's 5-minute prefs cache —
   twenty PUTs would also mean twenty cache misses on the SSE
   delivery path.
   ========================================================= */
import React from 'react'
import { Platform, View } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as Localization from 'expo-localization'
import { api, DND_DAYS, codeOf, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Chip, ErrorState, GroupFooter, GroupLabel, Header, Icon,
  ListRow, RowGroup, Screen, ScreenScroll, SearchField, Sheet, SkeletonList,
  Text, Touchable, useSheetState, toast,
} from '@/ui'

const WRITE_DEBOUNCE_MS = 600
const ALL_DAYS = 127

/* A curated set, plus whatever the device reports. `Intl.supportedValuesOf` is
   not in Hermes, so an exhaustive list is not available at runtime — and a
   thousand-row picker is worse than fifty relevant ones anyway. */
const COMMON_ZONES = [
  'Asia/Baghdad', 'Asia/Erbil', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Tehran',
  'Asia/Istanbul', 'Asia/Amman', 'Asia/Beirut', 'Asia/Jerusalem', 'Asia/Kuwait',
  'Asia/Qatar', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Jakarta',
  'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Rome',
  'Europe/Vienna', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Bucharest',
  'Europe/Kyiv', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Khartoum', 'Africa/Lagos',
  'Africa/Nairobi', 'Africa/Casablanca', 'Africa/Johannesburg',
  'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Vancouver', 'America/Mexico_City', 'America/Bogota',
  'America/Sao_Paulo', 'America/Buenos_Aires', 'Australia/Perth', 'Australia/Sydney',
  'Australia/Melbourne', 'Pacific/Auckland', 'UTC',
]

export default function DndScreen() {
  const t = useTheme()
  const c = t.colors
  const zoneSheet = useSheetState()

  const dnd = useAsync<any>(() => api.settings.notifications.dnd(), { deps: [] })

  const [draft, setDraft] = React.useState<any>(null)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle')
  const [timeError, setTimeError] = React.useState<string | null>(null)
  const [zoneError, setZoneError] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState<'start' | 'end' | null>(null)
  const [muteStage, setMuteStage] = React.useState<'date' | 'time' | null>(null)
  const [muteDraft, setMuteDraft] = React.useState<Date | null>(null)
  const [now, setNow] = React.useState(() => Date.now())

  /* The last state the server accepted — the target of every revert. */
  const accepted = React.useRef<any>(null)
  const draftRef = React.useRef<any>(null)
  const queued = React.useRef<Record<string, unknown>>({})
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  draftRef.current = draft

  React.useEffect(() => {
    if (!dnd.data) return
    accepted.current = dnd.data
    setDraft(dnd.data)
  }, [dnd.data])

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /* Keeps the "muted until" banner honest as the clock passes it. */
  React.useEffect(() => {
    if (!draft?.muteUntil) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [draft?.muteUntil])

  const flush = React.useCallback(async () => {
    const patch = queued.current
    queued.current = {}
    if (!Object.keys(patch).length) return

    const snapshot = accepted.current
    setSaveState('saving')
    try {
      /* `enabled` always, even when it is not what changed — see the header. */
      const fresh: any = await api.settings.notifications.updateDnd({
        ...patch,
        enabled: !!draftRef.current?.enabled,
      })
      const next = fresh && typeof fresh === 'object' ? fresh : { ...(draftRef.current || {}) }
      accepted.current = next
      setDraft(next)
      setTimeError(null)
      setZoneError(null)
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1500)
    } catch (e) {
      setSaveState('idle')
      setDraft(snapshot)
      const err = codeOf(e)
      if (err === 'BAD_TIME') setTimeError(errorText(e, 'Time must be HH:mm.'))
      else if (err === 'BAD_TIMEZONE') setZoneError(errorText(e, 'That is not a valid time zone.'))
      else toast.error(errorText(e, 'Could not save Do Not Disturb.'))
    }
  }, [])

  const queue = React.useCallback((patch: Record<string, unknown>) => {
    setDraft((prev: any) => ({ ...(prev || {}), ...patch }))
    queued.current = { ...queued.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, WRITE_DEBOUNCE_MS)
  }, [flush])

  if (dnd.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Do Not Disturb" />
        <SkeletonList count={5} />
      </Screen>
    )
  }
  if (dnd.error && !draft) {
    return (
      <Screen background="sunken">
        <Header back title="Do Not Disturb" />
        <ErrorState error={dnd.error} onRetry={dnd.reload} />
      </Screen>
    )
  }

  const d = draft || {}
  const enabled = !!d.enabled
  const start = timeOf(d.startTime, '22:00')
  const end = timeOf(d.endTime, '07:00')
  const mask = Number(d.daysMask ?? 0)
  /* A zone is prefilled from the device but NOT written until something else
     changes — a silent PUT on open would be a write the user never made. */
  const zone = String(d.timezone || deviceZone())
  /* Compared against a ticking `now` so the banner clears itself when the mute
     lapses, rather than sitting there until the screen is re-entered. */
  const mutedUntil = futureDate(d.muteUntil, now)

  return (
    <Screen background="sunken">
      <Header
        back
        title="Do Not Disturb"
        subtitle={saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : undefined}
      />
      <ScreenScroll refreshing={dnd.refreshing} onRefresh={dnd.refresh}>
        {mutedUntil ? (
          <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
            <Callout
              tone="danger"
              icon="mutedBell"
              title={`All notifications muted until ${stamp(mutedUntil)}`}
              actionLabel="Clear"
              onAction={() => queue({ muteUntil: UNMUTE_STAMP })}
            >
              This overrides the schedule below entirely.
            </Callout>
          </View>
        ) : null}

        <GroupLabel>Quiet hours</GroupLabel>
        <RowGroup>
          <ListRow
            title="Do Not Disturb"
            subtitle={enabled ? undefined : 'Silence notifications on a schedule'}
            icon="moon"
            iconTone="accent"
            accessory={{
              kind: 'switch',
              value: enabled,
              /* Flip the local value first so `enabled` in the body is the new
                 one — the flush reads the draft, not the server copy. */
              onValueChange: v => queue({ enabled: v }),
            }}
          />
          {enabled ? (
            <ListRow
              title="From"
              accessory={{
                kind: 'custom',
                node: (
                  <Touchable onPress={() => setPicking('start')} feedback="dim" style={{ paddingHorizontal: space.xs2, paddingVertical: space.xs }}>
                    <Text variant="callout" tone="accent">{start}</Text>
                  </Touchable>
                ),
              }}
            />
          ) : null}
          {enabled ? (
            <ListRow
              title="Until"
              accessory={{
                kind: 'custom',
                node: (
                  <Touchable onPress={() => setPicking('end')} feedback="dim" style={{ paddingHorizontal: space.xs2, paddingVertical: space.xs }}>
                    <Text variant="callout" tone="accent">{end}</Text>
                  </Touchable>
                ),
              }}
            />
          ) : null}
        </RowGroup>

        {timeError ? (
          <View style={{ flexDirection: 'row', gap: space.xs2, alignItems: 'center', paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
            <Icon name="error" size={13} color={c.danger} />
            <Text variant="footnote" tone="danger" align="ui" style={{ flex: 1 }}>{timeError}</Text>
          </View>
        ) : enabled ? (
          <GroupFooter>{windowSentence(start, end)}</GroupFooter>
        ) : null}

        {enabled ? (
          <>
            <GroupLabel>Days</GroupLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: t.layout.screenPadding }}>
              {(DND_DAYS as [string, number][]).map(([label, bit]) => {
                const on = mask === 0 || (mask & bit) !== 0
                return (
                  <Chip
                    key={label}
                    label={label}
                    selected={on}
                    onPress={() => {
                      const base = mask === 0 ? ALL_DAYS : mask
                      const next = on ? base & ~bit : base | bit
                      /* All seven, or none at all, both mean "every day" on the
                         wire — there is no such thing as a DND window that runs
                         on no days. */
                      queue({ daysMask: next === ALL_DAYS || next === 0 ? 0 : next })
                    }}
                  />
                )
              })}
            </View>
            <GroupFooter>
              {mask === 0 ? 'Every day.' : `Only on ${dayNames(mask)}.`}
            </GroupFooter>

            <GroupLabel>Time zone</GroupLabel>
            <RowGroup>
              <ListRow
                title="Time zone"
                subtitle="Quiet hours are evaluated in this zone, not your phone's"
                icon="globe"
                iconTone="neutral"
                accessory={{ kind: 'value', text: zone }}
                onPress={zoneSheet.open}
              />
            </RowGroup>
            {zoneError ? (
              <View style={{ flexDirection: 'row', gap: space.xs2, alignItems: 'center', paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
                <Icon name="error" size={13} color={c.danger} />
                <Text variant="footnote" tone="danger" align="ui" style={{ flex: 1 }}>{zoneError}</Text>
              </View>
            ) : !d.timezone ? (
              <GroupFooter>
                Prefilled from this phone. It is saved the first time you change
                anything on this screen.
              </GroupFooter>
            ) : null}
          </>
        ) : null}

        <GroupLabel>Mute everything until…</GroupLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: t.layout.screenPadding }}>
          {/* The zone rides along so the wall-clock sent and the zone the
              evaluator reads it in can never disagree — see wallClockIn. */}
          <Chip label="1 hour" onPress={() => queue({ muteUntil: wallClockIn(zone, Date.now() + 3600_000), timezone: zone })} />
          <Chip label="8 hours" onPress={() => queue({ muteUntil: wallClockIn(zone, Date.now() + 8 * 3600_000), timezone: zone })} />
          <Chip label="Tomorrow morning" onPress={() => queue({ muteUntil: tomorrowMorningIn(zone), timezone: zone })} />
          <Chip
            label="Pick a time"
            icon="calendar"
            onPress={() => { setMuteDraft(new Date(Date.now() + 3600_000)); setMuteStage('date') }}
          />
        </View>
        {mutedUntil ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
            <Button label="Unmute now" variant="secondary" size="md" block onPress={() => queue({ muteUntil: UNMUTE_STAMP })} />
          </View>
        ) : null}

        <GroupFooter>
          Security and login alerts always come through — they bypass Do Not
          Disturb and every switch in Notifications.
        </GroupFooter>
      </ScreenScroll>

      {/* Android's picker IS a native dialog, so wrapping it in a sheet would
          stack two overlays. iOS's is an inline spinner and needs the frame. */}
      {picking && Platform.OS === 'ios' ? (
        <Sheet
          visible
          onClose={() => setPicking(null)}
          title={picking === 'start' ? 'Quiet hours start' : 'Quiet hours end'}
          scrollable={false}
          maxHeightRatio={0.55}
          footer={<Button label="Done" variant="primary" size="lg" block onPress={() => setPicking(null)} />}
        >
          <View style={{ alignItems: 'center' }}>
            <DateTimePicker
              value={parseTime(picking === 'start' ? start : end)}
              mode="time"
              display="spinner"
              onChange={(_e, date) => {
                if (!date) return
                queue(picking === 'start' ? { startTime: hhmm(date) } : { endTime: hhmm(date) })
              }}
            />
          </View>
        </Sheet>
      ) : picking ? (
        <DateTimePicker
          value={parseTime(picking === 'start' ? start : end)}
          mode="time"
          display="clock"
          onChange={(_e, date) => {
            const which = picking
            setPicking(null)
            if (!date) return
            queue(which === 'start' ? { startTime: hhmm(date) } : { endTime: hhmm(date) })
          }}
        />
      ) : null}

      {muteStage && Platform.OS === 'ios' ? (
        <Sheet
          visible
          onClose={() => setMuteStage(null)}
          title="Mute until"
          scrollable={false}
          maxHeightRatio={0.6}
          footer={
            <Button
              label="Mute until then"
              variant="primary"
              size="lg"
              block
              onPress={() => {
                if (muteDraft) queue({ muteUntil: wallClockIn(zone, muteDraft.getTime()), timezone: zone })
                setMuteStage(null)
              }}
            />
          }
        >
          <View style={{ alignItems: 'center' }}>
            <DateTimePicker
              value={muteDraft ?? new Date()}
              mode="datetime"
              minimumDate={new Date()}
              display="spinner"
              onChange={(_e, date) => { if (date) setMuteDraft(date) }}
            />
          </View>
        </Sheet>
      ) : muteStage ? (
        /* Android has no datetime mode — date, then time, then merge. */
        <DateTimePicker
          value={muteDraft ?? new Date()}
          mode={muteStage}
          minimumDate={muteStage === 'date' ? new Date() : undefined}
          display="default"
          onChange={(_e, date) => {
            if (!date) { setMuteStage(null); return }
            if (muteStage === 'date') { setMuteDraft(date); setMuteStage('time'); return }
            const merged = new Date(muteDraft ?? date)
            merged.setHours(date.getHours(), date.getMinutes(), 0, 0)
            setMuteStage(null)
            queue({ muteUntil: wallClockIn(zone, merged.getTime()), timezone: zone })
          }}
        />
      ) : null}

      <ZoneSheet
        visible={zoneSheet.visible}
        onClose={zoneSheet.close}
        selected={zone}
        onSelect={id => {
          zoneSheet.close()
          /* Validated here so a typo never costs a round trip that comes back
             400 BAD_TIMEZONE. */
          if (!isValidZone(id)) { setZoneError('That is not a valid time zone.'); return }
          setZoneError(null)
          queue({ timezone: id })
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Time-zone picker.
   --------------------------------------------------------- */

function ZoneSheet({
  visible, onClose, selected, onSelect,
}: {
  visible: boolean
  onClose: () => void
  selected: string
  onSelect: (id: string) => void
}) {
  const t = useTheme()
  const [q, setQ] = React.useState('')

  React.useEffect(() => { if (!visible) setQ('') }, [visible])

  const all = React.useMemo(() => {
    const device = deviceZone()
    const set = new Set<string>([device, selected, ...COMMON_ZONES].filter(Boolean))
    return Array.from(set)
  }, [selected])

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, '_')
    if (!needle) return all
    return all.filter(z => z.toLowerCase().includes(needle))
  }, [q, all])

  return (
    <Sheet visible={visible} onClose={onClose} title="Time zone" maxHeightRatio={0.88}>
      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md, paddingBottom: space.sm }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search zones" />
      </View>
      {rows.map(id => (
        <Touchable
          key={id}
          onPress={() => onSelect(id)}
          feedback="tint"
          noAutoHitSlop
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: t.layout.screenPadding,
            paddingVertical: space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="body" align="ui">{id.replace(/_/g, ' ')}</Text>
            <Text variant="caption" tone="faint" align="ui">{nowIn(id)}</Text>
          </View>
          {id === selected ? <Icon name="check" size={18} color={t.colors.accent} /> : null}
        </Touchable>
      ))}
      {!rows.length ? (
        <Text variant="footnote" tone="muted" align="center" style={{ padding: space.xxl }}>
          No zone matches that. Zones are named Region/City, like Asia/Baghdad.
        </Text>
      ) : null}
    </Sheet>
  )
}

/* ---------------------------------------------------------
   Time helpers. The wire format is exactly 'HH:mm'.
   --------------------------------------------------------- */

function deviceZone() {
  try { return Localization.getCalendars()[0]?.timeZone || 'UTC' }
  catch { return 'UTC' }
}

function isValidZone(id: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: id }).format(new Date()); return true }
  catch { return false }
}

function nowIn(id: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: id, hour: '2-digit', minute: '2-digit' }).format(new Date())
  } catch { return '' }
}

function timeOf(value: unknown, fallback: string) {
  const s = String(value || '')
  return /^\d{2}:\d{2}$/.test(s) ? s : fallback
}

function parseTime(hm: string) {
  const [h, m] = hm.split(':').map(Number)
  const d = new Date()
  d.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0)
  return d
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** The cross-midnight case is the one people get wrong, so the sentence names
 *  it instead of leaving two numbers to be interpreted. */
function windowSentence(start: string, end: string) {
  if (start === end) return 'Quiet all day — the window covers every hour.'
  const crosses = start > end
  return crosses
    ? `Quiet from ${start} until ${end} the next morning.`
    : `Quiet from ${start} until ${end} the same day.`
}

function dayNames(mask: number) {
  const on = (DND_DAYS as [string, number][]).filter(([, bit]) => (mask & bit) !== 0).map(([label]) => label)
  return on.length ? on.join(', ') : 'no days'
}

/* ---------------------------------------------------------
   muteUntil — the wire's one LocalDateTime, and a trap twice
   over (both verified against the live backend):

   · The accepted format is exactly `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`
     — the 'Z' is a LITERAL in the server's date pattern, not an
     offset. What is stored is the WALL-CLOCK inside the string,
     and DndEvaluator reads it in the user's DND timezone. So a
     raw `toISOString()` (UTC wall-clock) lands early by the whole
     UTC offset — "mute 1 hour" in Baghdad unmuted 2 hours ago.
     The stamp must be the wall-clock IN THE DND ZONE.
   · `muteUntil: null` is patch-ignored like every other field —
     there is no way to clear it on the wire. Unmuting therefore
     writes a stamp in the past, which the evaluator treats
     identically to no mute.
   --------------------------------------------------------- */

const UNMUTE_STAMP = '1970-01-01T00:00:00.000Z'

/** The wall-clock in `zone` at instant `atMs`, in the wire's exact pattern. */
function wallClockIn(zone: string, atMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(atMs))
    const p: Record<string, string> = {}
    for (const { type, value } of parts) p[type] = value
    const hour = p.hour === '24' ? '00' : p.hour       // midnight quirk on some engines
    return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}.000Z`
  } catch {
    /* Unknown zone on this engine — UTC wall-clock is the least-wrong stamp. */
    return new Date(atMs).toISOString().replace(/\.\d{3}Z$/, '.000Z')
  }
}

function tomorrowMorningIn(zone: string): string {
  const tomorrow = wallClockIn(zone, Date.now() + 86_400_000)
  return `${tomorrow.slice(0, 10)}T08:00:00.000Z`
}

function futureDate(value: unknown, nowMs: number): Date | null {
  if (!value) return null
  /* The trailing 'Z' is decorative (see above): read the wall-clock as this
     phone's local time, which is exact whenever the DND zone is the device's
     zone — the default this screen prefills. */
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value))
  const d = m
    ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
    : new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  return d.getTime() > nowMs ? d : null
}

/* Built once: `toLocale*` with an options bag constructs a fresh
   Intl.DateTimeFormat on every call, which on Hermes is full ICU pattern
   resolution — and `stamp` runs per schedule row on every render. */
const STAMP_TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const STAMP_DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

function stamp(d: Date) {
  const sameDay = new Date().toDateString() === d.toDateString()
  const time = STAMP_TIME.format(d)
  return sameDay ? time : `${STAMP_DAY.format(d)} ${time}`
}
