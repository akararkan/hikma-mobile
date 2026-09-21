/* =========================================================
   Language.

   One field — `appearance.language` — with a consequence the
   label does not carry: choosing Arabic or Kurdish flips the
   app's reading direction.

   The design system handles that without a reload. Every
   component uses logical properties and reads `dir` off the
   theme, so the layout mirrors the moment this is written.
   `I18nManager.forceRTL` is the OTHER kind of mirroring — it
   changes React Native's own flexbox resolution and only takes
   effect after a full restart, which would leave the tree half
   flipped if it were applied silently. So it is offered as an
   explicit, separate action that says a restart is needed,
   rather than being bundled into the language tap.

   What this does NOT do is translate the interface. The
   trilingual vocabularies (topics, madhhabs, policy documents)
   answer in the chosen language; the app's own strings are
   still English. Saying so here is better than letting people
   discover it by switching.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { notifyPrefsChanged } from '@/theme/prefs'
import { nativeRTL, useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Callout, ConfirmSheet, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, useSheetState, toast,
} from '@/ui'

/** [wire value, English name, endonym, RTL] */
const LANGUAGES: [string, string, string, boolean][] = [
  ['EN', 'English', 'English', false],
  ['AR', 'Arabic', 'العربية', true],
  ['KU', 'Kurdish (Sorani)', 'کوردیی ناوەندی', true],
]

export default function LanguageSettings() {
  const t = useTheme()
  const mirror = useSheetState<boolean>()

  const block = useAsync<any>(() => api.settings.section('appearance'), { deps: [] })
  const [saving, setSaving] = React.useState<string | null>(null)

  const write = async (value: string) => {
    setSaving(value)
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), language: value }))
    try {
      /* Merge patch — the appearance block carries theme, accent and density
         too, and a whole-block write here would stamp this screen's idea of
         all of them over the server's. */
      await api.settings.patchSection('appearance', { language: value })
      notifyPrefsChanged()
    } catch (e) {
      block.setData(previous ?? null)
      toast.error(errorText(e, 'Could not change the language.'))
    } finally {
      setSaving(null)
    }
  }

  if (block.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Language" />
        <SkeletonList count={4} />
      </Screen>
    )
  }

  /* The theme is the applied truth; the block is what is stored. They agree
     except in the moment between a failed write and its revert. */
  const current = String(block.data?.language || t.language || 'EN').toUpperCase()
  const rtlChosen = current === 'AR' || current === 'KU'
  const nativeForced = nativeRTL.isForced()

  return (
    <Screen background="sunken">
      <Header back title="Language" />
      <ScreenScroll refreshing={block.refreshing} onRefresh={block.refresh}>
        <GroupLabel>Content language</GroupLabel>
        <RowGroup>
          {LANGUAGES.map(([value, name, endonym, rtl]) => (
            <ListRow
              key={value}
              title={name}
              subtitle={`${endonym}${rtl ? ' · right-to-left' : ''}`}
              disabled={!!saving}
              accessory={{ kind: 'radio', checked: current === value }}
              onPress={() => { if (current !== value) void write(value) }}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          Topics, schools of thought and the policy documents are served in this
          language where a translation exists, and fall back to English where one
          doesn't. The app's own buttons and labels are still English.
        </GroupFooter>

        {rtlChosen ? (
          <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
            <Callout tone="info" icon="language" title="The layout now reads right to left">
              Rows, chevrons and swipes have mirrored. Your own posts and messages
              keep their own direction — an English sentence stays left-aligned
              inside an Arabic interface, and the other way round.
            </Callout>

            {!nativeForced ? (
              <Callout
                tone="neutral"
                icon="devices"
                title="Deeper mirroring needs a restart"
                actionLabel="Mirror everything and restart"
                onAction={() => mirror.open(true)}
              >
                A few native pieces — the keyboard's return key, some system
                dialogs — only mirror after the app is fully restarted. Everything
                Hikmah Web draws is already mirrored.
              </Callout>
            ) : (
              <Callout
                tone="success"
                icon="check"
                title="Native mirroring is on"
                actionLabel="Turn it off"
                onAction={() => mirror.open(false)}
              >
                System components mirror along with the app.
              </Callout>
            )}
          </View>
        ) : nativeForced ? (
          <View style={{ padding: t.layout.screenPadding }}>
            <Callout
              tone="warning"
              icon="warning"
              title="Native mirroring is still on"
              actionLabel="Turn it off"
              onAction={() => mirror.open(false)}
            >
              You're on a left-to-right language but the system is still mirrored
              from an earlier choice. Turning it off needs a restart.
            </Callout>
          </View>
        ) : null}

        {block.error ? (
          <View style={{ padding: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={block.reload}>
              Your saved language could not be loaded, so this screen is showing a
              default. Choosing one now would overwrite what is stored.
            </Callout>
          </View>
        ) : null}
      </ScreenScroll>

      <ConfirmSheet
        visible={mirror.visible}
        onClose={mirror.close}
        title={mirror.payload ? 'Mirror the whole app?' : 'Stop mirroring the system?'}
        message="This changes how React Native itself lays out, so it only takes effect after you close and reopen Hikmah Web. Nothing you have saved is affected."
        confirmLabel="Apply"
        icon="refresh"
        onConfirm={() => {
          const wanted = !!mirror.payload
          mirror.close()
          const needsReload = nativeRTL.force(wanted)
          toast.info(needsReload
            ? 'Close and reopen Hikmah Web for the change to take effect.'
            : 'Already set that way.')
        }}
      />
    </Screen>
  )
}
