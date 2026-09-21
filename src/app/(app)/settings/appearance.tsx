/* =========================================================
   Appearance.

   `appearance` is stored verbatim by the backend and
   interpreted by nobody, so this screen is the whole feature:
   what it writes here is what the app looks like.

   Two rules the theme layer depends on:

   1. Apply locally FIRST, then write. A theme toggle that waits
      on a round trip feels broken, and the round trip can fail.
      `setThemeChoice` paints immediately; the PATCH follows and
      only matters for the next device.
   2. Send only what changed. `patchSection` is a merge, so a
      whole-block write here would stamp this device's idea of
      every other cosmetic field over the server's.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { notifyPrefsChanged, type ThemeChoice } from '@/theme/prefs'
import { useAsync } from '@/hooks/useAsync'
import {
  Callout, Card, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, Text, Touchable, toast,
} from '@/ui'
import { ACCENT_SWATCHES, DEFAULT_ACCENT_SWATCH } from '@/theme/accents'

const FONT_SIZES: [string, string][] = [
  ['SMALL', 'Small'], ['MEDIUM', 'Default'], ['LARGE', 'Large'], ['XLARGE', 'Extra large'],
]

/* The swatch list is deliberately short and lives in src/theme/accents.ts, not
   here: a hex in a screen is a hex `scripts/check-contrast.mjs` cannot reach,
   and the whole claim of this picker is that every entry clears AA in both
   schemes. */

export default function AppearanceSettings() {
  const t = useTheme()
  const c = t.colors

  /* The server block is the source of truth for everything except the theme
     choice, which ThemeProvider already holds so the toggle can be instant. */
  const block = useAsync<any>(() => api.settings.section('appearance'), { deps: [] })
  const [saving, setSaving] = React.useState(false)

  const write = React.useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.settings.patchSection('appearance', patch)
      block.setData((prev: any) => ({ ...(prev || {}), ...patch }))
      /* Tell ThemeProvider (and mediaTier, and chatPrefs) to re-read. */
      notifyPrefsChanged()
    } catch (e) {
      toast.error(errorText(e, 'Could not save that. Check your connection.'))
      void block.reload()
    } finally {
      setSaving(false)
    }
  }, [block])

  const setTheme = (choice: ThemeChoice) => {
    t.setThemeChoice(choice)          // paint now
    void write({ theme: choice })     // persist for the next device
  }

  const data = (block.data || {}) as any
  const fontSize = String(data.fontSize || 'MEDIUM').toUpperCase()
  const density = String(data.density || 'COMFORTABLE').toUpperCase()
  const accent = typeof data.accentColor === 'string' ? data.accentColor : ''

  return (
    <Screen background="sunken">
      <Header back title="Theme & display" />
      <ScreenScroll refreshing={block.refreshing} onRefresh={block.refresh}>
        {/* Above the controls, not below them: the warning is only useful to a
            user who has not yet tapped anything, and at the foot of a
            four-screen form nobody reads it before overwriting their real
            settings with these fallbacks. */}
        {block.error ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md2 }}>
            <Callout tone="warning" actionLabel="Retry" onAction={block.reload}>
              Your saved appearance settings could not be loaded, so this screen is
              showing defaults. Changing something here would overwrite what is stored.
            </Callout>
          </View>
        ) : null}

        <Preview />

        {/* The theme choice is ThemeProvider's, not the server's, so it is
            never wrong and never waits — everything BELOW it is server data
            and gets a skeleton rather than an invented radio selection. */}
        <GroupLabel>Theme</GroupLabel>
        <RowGroup>
          <ListRow
            title="System"
            subtitle="Follow your phone's setting"
            icon="devices"
            iconTone="neutral"
            accessory={{ kind: 'radio', checked: t.themeChoice === 'SYSTEM' }}
            onPress={() => setTheme('SYSTEM')}
          />
          <ListRow
            title="Light"
            icon="sun"
            iconTone="warning"
            accessory={{ kind: 'radio', checked: t.themeChoice === 'LIGHT' }}
            onPress={() => setTheme('LIGHT')}
          />
          <ListRow
            title="Dark"
            icon="moon"
            iconTone="accent"
            accessory={{ kind: 'radio', checked: t.themeChoice === 'DARK' }}
            onPress={() => setTheme('DARK')}
          />
        </RowGroup>

        {block.loading && !block.data ? <SkeletonList count={8} /> : (
          <>
            <GroupLabel>Accent</GroupLabel>
            <View style={{ paddingHorizontal: t.layout.screenPadding }}>
              <Card variant="outlined" padding={14}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                  {ACCENT_SWATCHES.map(([hex, label]) => {
                    const active = (accent || '') === hex
                    const swatch = hex || DEFAULT_ACCENT_SWATCH
                    return (
                      <Touchable
                        key={label}
                        onPress={() => void write({ accentColor: hex || null })}
                        haptic="select"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: active }}
                        style={{ alignItems: 'center', gap: space.xs2, width: 58 }}
                      >
                        <View
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 999,
                            backgroundColor: swatch,
                            borderWidth: active ? 3 : 0,
                            borderColor: c.bg,
                            outlineWidth: active ? 2 : 0,
                            outlineColor: swatch,
                          }}
                        />
                        <Text variant="micro" tone={active ? 'default' : 'muted'} align="center" numberOfLines={1}>
                          {label}
                        </Text>
                      </Touchable>
                    )
                  })}
                </View>
              </Card>
            </View>
            <GroupFooter>
              The accent colours navigation, primary buttons and your own chat bubbles.
            </GroupFooter>

            <GroupLabel>Text size</GroupLabel>
            <RowGroup>
              {FONT_SIZES.map(([value, label]) => (
                <ListRow
                  key={value}
                  title={label}
                  accessory={{ kind: 'radio', checked: fontSize === value }}
                  onPress={() => void write({ fontSize: value })}
                  disabled={saving}
                />
              ))}
            </RowGroup>
            <GroupFooter>
              Applies across the app. Accessibility → Larger text adds a further step
              on top of this.
            </GroupFooter>

            <GroupLabel>Density</GroupLabel>
            <RowGroup>
              <ListRow
                title="Comfortable"
                subtitle="More breathing room between rows"
                accessory={{ kind: 'radio', checked: density !== 'COMPACT' }}
                onPress={() => void write({ density: 'COMFORTABLE' })}
              />
              <ListRow
                title="Compact"
                subtitle="Fit more on screen"
                accessory={{ kind: 'radio', checked: density === 'COMPACT' }}
                onPress={() => void write({ density: 'COMPACT' })}
              />
            </RowGroup>

            <GroupLabel>Motion</GroupLabel>
            <RowGroup>
              <ListRow
                title="Reduce motion"
                subtitle="Replace animations with instant changes"
                icon="bolt"
                iconTone="neutral"
                accessory={{
                  kind: 'switch',
                  value: !!data.reducedMotion,
                  onValueChange: v => void write({ reducedMotion: v }),
                }}
              />
            </RowGroup>
          </>
        )}
      </ScreenScroll>
    </Screen>
  )
}

/** A live sample of the current theme, so a change is visible without leaving
 *  the screen. It reads the same tokens every other surface does, so it can
 *  never drift from the real thing. */
function Preview() {
  const t = useTheme()
  const c = t.colors
  return (
    <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md2 }}>
      <Card variant="outlined" padding={14}>
        <View style={{ flexDirection: 'row', gap: space.sm2, alignItems: 'center' }}>
          <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: c.accentSoft }} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" align="ui">Preview</Text>
            <Text variant="footnote" tone="muted" align="ui">This is how body text reads.</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <View style={{ backgroundColor: c.bubbleIn, borderRadius: 14, padding: space.sm2, maxWidth: '62%' }}>
            <Text variant="callout" color={c.bubbleInText} align="ui">Incoming message</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs2, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bubbleOut, borderRadius: 14, padding: space.sm2, maxWidth: '62%' }}>
            <Text variant="callout" color={c.bubbleOutText} align="ui">Yours</Text>
          </View>
        </View>
      </Card>
    </View>
  )
}
