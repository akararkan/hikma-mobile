/* =========================================================
   Accessibility.

   The block is stored verbatim and interpreted by nobody
   server-side, so `theme/prefs` is the whole feature: it turns
   these booleans into a font scale, a hardened palette, a
   duration multiplier and two synchronous readers (haptics,
   captions). Which means every write here has to be followed by
   `notifyPrefsChanged()` — without it the switch flips and the
   app looks identical until the next cold start.

   `reducedMotion` exists in BOTH the appearance and
   accessibility blocks, and `resolvePrefs` ORs them. Writing
   only one lets the two drift into a state where the switch
   says off and the app still refuses to animate, so this screen
   always writes both in the same interaction.

   The second card is read-only on purpose. These toggles ADD to
   the phone's own settings; they do not override them, and a
   user who turns "Large text" off here and finds the app still
   large needs to see why.

   That card reads `t.a11y`, the same folded source the whole app
   renders from (theme/osA11y → ThemeProvider.foldOsA11y), rather
   than calling AccessibilityInfo itself. When this screen owned a
   private copy it was the ONLY consumer of the phone's settings —
   it displayed values nothing else honoured, which made the
   footer below ("we follow these too") a claim the app did not
   keep. Reading the shared state is what makes it a report.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { notifyPrefsChanged } from '@/theme/prefs'
import { useTheme } from '@/theme/ThemeProvider'
import {
  Callout, GroupFooter, GroupLabel, Header, ListRow, RowGroup, Screen,
  ScreenScroll, SkeletonList, toast, type IconName,
} from '@/ui'

interface Row {
  key: string
  label: string
  description: string
  icon: IconName
  /** Default when the key is absent — Jackson NON_NULL drops it entirely. */
  defaultOn?: boolean
}

const ROWS: Row[] = [
  { key: 'largeText', label: 'Larger text', description: 'Increases type size across the app, on top of your phone\'s setting.', icon: 'language' },
  { key: 'highContrast', label: 'High contrast', description: 'Stronger borders and darker text.', icon: 'palette' },
  { key: 'reducedMotion', label: 'Reduce motion', description: 'Fewer animations, no parallax, and instant transitions.', icon: 'bolt' },
  { key: 'screenReader', label: 'Screen-reader optimisations', description: 'Extra labels and grouping for VoiceOver and TalkBack.', icon: 'speaker' },
  { key: 'closedCaptions', label: 'Closed captions', description: 'Shown by default on videos that have a caption track.', icon: 'video' },
  { key: 'voiceNavigation', label: 'Voice navigation', description: 'Voice control hints where the app supports them.', icon: 'mic' },
  { key: 'hapticFeedback', label: 'Haptic feedback', description: 'Small vibrations on taps, sends and errors.', icon: 'bolt', defaultOn: true },
]

export default function AccessibilitySettings() {
  const t = useTheme()

  const block = useAsync<any>(() => api.settings.section('accessibility'), { deps: [] })
  const [saving, setSaving] = React.useState<string | null>(null)

  /* The phone's side of the fold, live. */
  const os = t.a11y
  const pct = (n: number) => `${Math.round(n * 100)}%`

  const write = async (key: string, value: boolean) => {
    setSaving(key)
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), [key]: value }))
    try {
      await api.settings.patchSection('accessibility', { [key]: value })
      /* The one key that lives in two blocks — write both or they drift. */
      if (key === 'reducedMotion') {
        await api.settings.patchSection('appearance', { reducedMotion: value })
      }
      /* Tell ThemeProvider, chatPrefs and mediaTier to re-read. Without this
         the switch flips and nothing on screen changes. */
      notifyPrefsChanged()
    } catch (e) {
      block.setData(previous ?? null)
      toast.error(errorText(e, 'Could not save that setting.'))
    } finally {
      setSaving(null)
    }
  }

  if (block.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Accessibility" />
        <SkeletonList count={7} />
      </Screen>
    )
  }

  const data = block.data || {}

  return (
    <Screen background="sunken">
      <Header back title="Accessibility" />
      <ScreenScroll refreshing={block.refreshing} onRefresh={block.refresh}>
        <GroupLabel>In Hikmah Web</GroupLabel>
        <RowGroup>
          {ROWS.map(row => (
            <ListRow
              key={row.key}
              title={row.label}
              subtitle={row.description}
              icon={row.icon}
              iconTone="accent"
              disabled={saving === row.key}
              accessory={{
                kind: 'switch',
                value: row.defaultOn ? data[row.key] !== false : !!data[row.key],
                disabled: saving === row.key,
                onValueChange: v => void write(row.key, v),
              }}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          Saved to your account, so a new phone starts the way this one is set.
          Captions are served per video — this only decides whether an available
          track is shown by default.
        </GroupFooter>

        <GroupLabel>From your phone</GroupLabel>
        <RowGroup>
          <ListRow
            title="Reduce motion"
            subtitle="Set in your phone's accessibility settings"
            icon="bolt"
            iconTone="neutral"
            accessory={{ kind: 'value', text: os.reduceMotion ? 'On' : 'Off', chevron: false }}
          />
          <ListRow
            title="VoiceOver / TalkBack"
            subtitle="Set in your phone's accessibility settings"
            icon="speaker"
            iconTone="neutral"
            accessory={{ kind: 'value', text: os.screenReader ? 'Running' : 'Off', chevron: false }}
          />
          {os.boldText ? (
            <ListRow
              title="Bold text"
              subtitle="Set in your phone's display settings"
              icon="language"
              iconTone="neutral"
              accessory={{ kind: 'value', text: 'On', chevron: false }}
            />
          ) : null}
          <ListRow
            title="System text size"
            subtitle="Set in your phone's display settings"
            icon="language"
            iconTone="neutral"
            accessory={{ kind: 'value', text: pct(os.fontScale), chevron: false }}
          />
        </RowGroup>
        <GroupFooter>
          We follow these too — turning something on above adds to your phone&apos;s
          setting rather than replacing it. Your phone asks for {pct(os.fontScale)}{' '}
          text; combined with your account setting, Hikmah Web is rendering at{' '}
          {pct(t.fontScale)}.
        </GroupFooter>

        {block.error ? (
          <View style={{ padding: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={block.reload}>
              Your saved accessibility settings could not be loaded, so the switches
              above are showing defaults. Changing one now would overwrite what is
              stored.
            </Callout>
          </View>
        ) : null}
      </ScreenScroll>
    </Screen>
  )
}
