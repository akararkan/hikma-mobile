/* =========================================================
   Messaging.

   Two halves with different owners, which is why they are
   different cards.

   The privacy half is enforced server-side and is RECIPROCAL:
   turning read receipts off stops you sending them AND stops
   you receiving them. Same for last seen. Typing is the odd one
   out — off means you emit none, but you still see other
   people's — so the copy says so rather than lumping all three
   together. (NOTE: the spec called all three symmetric. The
   chat module documents typing as one-way and it is the
   authority on what the backend does, so the copy follows it.)

   The appearance half is [C] client-owned: the backend stores
   wallpaper / chatTheme / fontSize / enterToSend verbatim and
   interprets none of them, so `lib/chatPrefs` is the entire
   feature. Every change writes twice — `setChatPrefsLocal` so
   the preview and any open conversation repaint on the tap, and
   `patchSection('messages')` so the next device agrees.

   PATCH, never replaceSection: a PUT nulls every key the body
   omits, and MESSAGE_DEFAULTS is only complete by accident once
   a newer client adds a field.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import {
  CHAT_FONT_SCALE, CHAT_THEMES, WALLPAPER_PRESETS, setChatPrefsLocal, useChatSkin,
} from '@/lib/chatPrefs'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Callout, Card, GroupFooter, GroupLabel, Header, Icon, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, Text, Touchable, toast,
} from '@/ui'

const FONT_SIZES: { value: string; label: string }[] = [
  { value: 'SMALL', label: 'Small' },
  { value: 'MEDIUM', label: 'Default' },
  { value: 'LARGE', label: 'Large' },
]

export default function MessagingSettings() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const skin = useChatSkin()

  const privacy = useAsync<any>(() => api.chat.settings.get(), { deps: [] })
  const usage = useAsync<any>(() => api.settings.storage.usage(), { deps: [] })

  const writePrivacy = async (patch: Record<string, boolean>) => {
    const previous = privacy.data
    privacy.setData((prev: any) => ({ ...(prev || {}), ...patch }))
    try {
      /* The PUT is partial — an omitted field is left unchanged — and it
         answers with the full state, so adopt the response. */
      const fresh = await api.chat.settings.update(patch)
      if (fresh && typeof fresh === 'object') privacy.setData(fresh)
    } catch (e) {
      privacy.setData(previous ?? null)
      toast.error(errorText(e, 'Could not change that setting.'))
    }
  }

  const writeSkin = async (patch: Record<string, unknown>) => {
    const previous = { ...skin.prefs }
    /* Paint first: a wallpaper that waits on a round trip feels broken. */
    setChatPrefsLocal(patch as any)
    try { await api.settings.patchSection('messages', patch) }
    catch (e) {
      setChatPrefsLocal(previous)
      toast.error(errorText(e, 'Could not save that. Check your connection.'))
    }
  }

  const p = privacy.data || {}
  const busy = privacy.loading
  const dark = t.scheme === 'dark'

  return (
    <Screen background="sunken">
      <Header back title="Messaging" />
      <ScreenScroll
        refreshing={privacy.refreshing}
        onRefresh={() => { void privacy.refresh(); void usage.refresh() }}
      >
        {/* A live sample under the pending settings, so a choice is visible
            without opening a conversation. */}
        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md2 }}>
          <View
            style={{
              backgroundColor: skin.wallpaper,
              borderRadius: t.radius.card,
              padding: space.md2,
              gap: space.sm,
              borderWidth: 1,
              borderColor: c.borderFaint,
            }}
          >
            <View style={{ alignSelf: 'flex-start', maxWidth: '76%', backgroundColor: skin.bubbleIn, borderRadius: 16, paddingHorizontal: space.md, paddingVertical: space.sm2 }}>
              <Text
                variant="callout"
                color={skin.bubbleInText}
                align="ui"
                style={{ fontSize: t.type.callout.fontSize * skin.fontScale }}
              >
                Does this size read comfortably?
              </Text>
            </View>
            <View style={{ alignSelf: 'flex-end', maxWidth: '76%', backgroundColor: skin.bubbleOut, borderRadius: 16, paddingHorizontal: space.md, paddingVertical: space.sm2 }}>
              <Text
                variant="callout"
                color={skin.bubbleOutText}
                align="ui"
                style={{ fontSize: t.type.callout.fontSize * skin.fontScale }}
              >
                Yes — this is the preview.
              </Text>
            </View>
          </View>
        </View>

        <GroupLabel>Chat privacy</GroupLabel>
        <RowGroup>
          <ListRow
            title="Read receipts"
            subtitle="Both ways: turn this off and you stop seeing when others read yours"
            icon="tickDouble"
            iconTone="accent"
            disabled={busy}
            accessory={{
              kind: 'switch',
              value: p.readReceiptsEnabled !== false,
              disabled: busy,
              onValueChange: v => void writePrivacy({ readReceiptsEnabled: v }),
            }}
          />
          <ListRow
            title="Last seen"
            subtitle="Also reciprocal — hiding yours hides everyone else's from you"
            icon="clock"
            iconTone="neutral"
            disabled={busy}
            accessory={{
              kind: 'switch',
              value: p.lastSeenVisible !== false,
              disabled: busy,
              onValueChange: v => void writePrivacy({ lastSeenVisible: v }),
            }}
          />
          <ListRow
            title="Typing indicator"
            subtitle="One-way: off means you send none, but you still see theirs"
            icon="keyboard"
            iconTone="neutral"
            disabled={busy}
            accessory={{
              kind: 'switch',
              value: p.typingIndicatorsEnabled !== false,
              disabled: busy,
              onValueChange: v => void writePrivacy({ typingIndicatorsEnabled: v }),
            }}
          />
        </RowGroup>
        <GroupFooter>
          These are enforced on our servers, so a signal you switch off never
          leaves this device in the first place.
        </GroupFooter>

        {privacy.error ? (
          <View style={{ padding: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={privacy.reload}>
              Your chat privacy settings could not be loaded, so the switches above
              are showing defaults. Changing one now would overwrite what is stored.
            </Callout>
          </View>
        ) : null}

        <GroupLabel>Wallpaper</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Card variant="outlined" padding={14}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <Swatch
                label="Default"
                colour={c.chatWallpaper}
                active={skin.prefs.wallpaper === 'DEFAULT'}
                onPress={() => void writeSkin({ wallpaper: 'DEFAULT' })}
              />
              {WALLPAPER_PRESETS.map(([key, light, darkHex, label]) => (
                <Swatch
                  key={key}
                  label={label}
                  colour={dark ? darkHex : light}
                  active={skin.prefs.wallpaper === key}
                  onPress={() => void writeSkin({ wallpaper: key })}
                />
              ))}
            </View>
          </Card>
        </View>
        <GroupFooter>
          Presets follow your light/dark setting, so a wallpaper picked in
          daylight still reads at night. Photo wallpapers aren't offered yet —
          the field stores a preset key or a colour, not an image.
        </GroupFooter>

        <GroupLabel>Bubble colour</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Card variant="outlined" padding={14}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {Object.entries(CHAT_THEMES).map(([key, theme]) => (
                <Swatch
                  key={key}
                  label={theme.label}
                  colour={(dark ? theme.dark : theme.light) || c.bubbleIn}
                  active={skin.prefs.chatTheme === key}
                  onPress={() => void writeSkin({ chatTheme: key })}
                />
              ))}
            </View>
          </Card>
        </View>
        <GroupFooter>
          This tints incoming bubbles only. Your own stay the accent colour — a
          whole family of light-on-dark details hangs off them.
        </GroupFooter>

        <GroupLabel>Message text size</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <SegmentedControl<string>
            value={CHAT_FONT_SCALE[skin.prefs.fontSize] != null ? skin.prefs.fontSize : 'MEDIUM'}
            onChange={v => void writeSkin({ fontSize: v })}
            options={FONT_SIZES}
          />
        </View>
        <GroupFooter>
          Chat only. The app-wide size lives under Appearance, and the two
          multiply.
        </GroupFooter>

        <GroupLabel>Composing</GroupLabel>
        <RowGroup>
          <ListRow
            title="Enter sends the message"
            subtitle={skin.prefs.enterToSend
              ? 'Return sends. Use the newline key for a line break.'
              : 'Return adds a line break. Tap the send button to send.'}
            icon="send"
            iconTone="accent"
            accessory={{
              kind: 'switch',
              value: skin.prefs.enterToSend,
              onValueChange: v => void writeSkin({ enterToSend: v }),
            }}
          />
        </RowGroup>

        <GroupLabel>Storage</GroupLabel>
        <RowGroup>
          <ListRow
            title="Storage used"
            subtitle="Photos, videos and files you've uploaded"
            icon="storage"
            iconTone="neutral"
            accessory={usage.data
              ? { kind: 'value', text: humanBytes(Number(usage.data?.totalBytes ?? 0)) }
              : { kind: 'chevron' }}
            onPress={() => router.push('/settings/storage')}
          />
          <ListRow
            title="Upload quality & auto-download"
            icon="image"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/media')}
          />
        </RowGroup>
      </ScreenScroll>
    </Screen>
  )
}

function Swatch({
  label, colour, active, onPress,
}: { label: string; colour: string; active: boolean; onPress: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      haptic="select"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ alignItems: 'center', gap: 5, width: 62 }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: t.radius.sm,
          backgroundColor: colour,
          borderWidth: 1,
          borderColor: c.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {active ? <Icon name="check" size={18} color={c.accent} /> : null}
      </View>
      <Text variant="micro" tone={active ? 'default' : 'muted'} align="center" numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  )
}

function humanBytes(n: number): string {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`
}
