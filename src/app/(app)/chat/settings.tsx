/* =========================================================
   Chat privacy.

   Two of the three switches are RECIPROCAL, and that is the
   whole reason this screen needs explanatory copy at all: with
   read receipts off you neither send blue ticks nor see
   anyone's, and hiding your last seen hides everyone else's
   from you. A switch labelled only "Read receipts" reads as
   one-way, which is the opposite of what it does.

   The appearance block is CLIENT-owned: the backend stores
   wallpaper / chatTheme / fontSize / enterToSend verbatim and
   interprets none of them, so it is patched (never PUT — a
   whole-block replace nulls anything omitted) and applied
   locally on the tap so the preview moves before the round trip
   lands.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from '@/api'
import { useChatActions, useChatSettings } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import {
  CHAT_FONT_SCALE, CHAT_THEMES, WALLPAPER_PRESETS, setChatPrefsLocal, useChatSkin,
} from '@/lib/chatPrefs'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Callout, ConfirmSheet, GroupFooter, GroupLabel, Header, Icon, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, Text, Touchable, toast, useSheetState,
} from '@/ui'

const FONT_SIZES = [
  { value: 'SMALL', label: 'Small' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LARGE', label: 'Large' },
] as const

export default function ChatSettingsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const chatSettings = useChatSettings()
  const { setChatPrivacy } = useChatActions()
  const skin = useChatSkin()

  const confirmReceipts = useSheetState()
  const [saving, setSaving] = React.useState<string | null>(null)

  const blocked = useAsync<any[]>(() => api.users.blocked(), { deps: [] })

  const flip = React.useCallback(async (key: keyof typeof chatSettings, next: boolean) => {
    setSaving(key)
    /* setChatPrivacy is optimistic and rolls itself back with a toast; the only
       thing left here is the disabled window while it settles. */
    await setChatPrivacy({ [key]: next } as any)
    setSaving(null)
  }, [setChatPrivacy])

  const patchAppearance = React.useCallback(async (patch: Record<string, any>) => {
    /* Local first: the preview has to move on the tap, not on the round trip. */
    setChatPrefsLocal(patch as any)
    try { await api.settings.patchSection('messages', patch) }
    catch (e) { toast.warn(chatError(e, 'Could not save your chat appearance')) }
  }, [])

  const wallpaperKey = skin.prefs.wallpaper
  const themeKey = skin.prefs.chatTheme

  return (
    <Screen background="sunken">
      <Header back title="Chat privacy" />
      <ScreenScroll>
        <GroupLabel>Privacy</GroupLabel>
        <RowGroup inset={16}>
          <ListRow
            title="Read receipts"
            description="If you turn this off, you won’t send blue ticks and you won’t see anyone else’s. You’ll also disappear from “Seen by” lists in groups."
            accessory={{
              kind: 'switch',
              value: chatSettings.readReceiptsEnabled,
              disabled: saving === 'readReceiptsEnabled',
              onValueChange: next => {
                /* Turning it OFF costs the user a signal they may not realise
                   they are giving up, so it confirms. Turning it on does not. */
                if (!next) confirmReceipts.open()
                else void flip('readReceiptsEnabled', true)
              },
            }}
          />
          <ListRow
            title="Last seen"
            description="If you hide your last seen, you stop seeing everyone else’s. Your online dot still shows."
            accessory={{
              kind: 'switch',
              value: chatSettings.lastSeenVisible,
              disabled: saving === 'lastSeenVisible',
              onValueChange: next => { void flip('lastSeenVisible', next) },
            }}
          />
          <ListRow
            title="Typing indicators"
            description="Turn this off to stop broadcasting “typing…”. You’ll still see when others type."
            accessory={{
              kind: 'switch',
              value: chatSettings.typingIndicatorsEnabled,
              disabled: saving === 'typingIndicatorsEnabled',
              onValueChange: next => { void flip('typingIndicatorsEnabled', next) },
            }}
          />
        </RowGroup>
        <View style={styles.reciprocal}>
          <Callout tone="warning" icon="info">
            Read receipts and last seen are reciprocal — you can’t take a signal you don’t give.
          </Callout>
        </View>

        <GroupLabel>Chat appearance</GroupLabel>

        <View style={[styles.preview, { backgroundColor: skin.wallpaper, borderColor: c.border }]}>
          <View style={[styles.previewIn, { backgroundColor: skin.bubbleIn }]}>
            <Text
              color={skin.bubbleInText}
              align="ui"
              style={{ fontSize: t.type.body.fontSize * skin.fontScale, lineHeight: t.type.body.lineHeight * skin.fontScale }}
            >
              How does this look?
            </Text>
          </View>
          <View style={[styles.previewOut, { backgroundColor: skin.bubbleOut }]}>
            <Text
              color={skin.bubbleOutText}
              align="ui"
              style={{ fontSize: t.type.body.fontSize * skin.fontScale, lineHeight: t.type.body.lineHeight * skin.fontScale }}
            >
              Just right.
            </Text>
          </View>
        </View>

        <RowGroup inset={16}>
          <View style={styles.swatchRow}>
            <Text variant="body" align="ui" style={styles.swatchLabel}>Wallpaper</Text>
            <View style={styles.swatches}>
              <Swatch
                label="Default"
                color={c.chatWallpaper}
                selected={wallpaperKey === 'DEFAULT'}
                onPress={() => void patchAppearance({ wallpaper: 'DEFAULT' })}
              />
              {WALLPAPER_PRESETS.map(([key, light, dark, label]) => (
                <Swatch
                  key={key}
                  label={label}
                  color={t.scheme === 'dark' ? dark : light}
                  selected={wallpaperKey === key}
                  onPress={() => void patchAppearance({ wallpaper: key })}
                />
              ))}
            </View>
          </View>

          <View style={styles.swatchRow}>
            <Text variant="body" align="ui" style={styles.swatchLabel}>Bubble theme</Text>
            <View style={styles.swatches}>
              {Object.entries(CHAT_THEMES).map(([key, def]) => (
                <Swatch
                  key={key}
                  label={def.label}
                  color={(t.scheme === 'dark' ? def.dark : def.light) || c.bubbleIn}
                  selected={themeKey === key}
                  onPress={() => void patchAppearance({ chatTheme: key })}
                />
              ))}
            </View>
          </View>

          <View style={styles.segmentRow}>
            <Text variant="body" align="ui">Text size</Text>
            <SegmentedControl
              options={FONT_SIZES.map(f => ({ value: f.value, label: f.label }))}
              value={(CHAT_FONT_SCALE[skin.prefs.fontSize] ? skin.prefs.fontSize : 'MEDIUM') as 'SMALL' | 'MEDIUM' | 'LARGE'}
              onChange={v => void patchAppearance({ fontSize: v })}
              style={{ marginTop: space.sm }}
            />
          </View>

          <ListRow
            title="Enter to send"
            subtitle="Return sends the message instead of adding a line"
            accessory={{
              kind: 'switch',
              value: skin.enterToSend,
              onValueChange: next => { void patchAppearance({ enterToSend: next }) },
            }}
          />
        </RowGroup>
        <GroupFooter>
          Appearance is stored on your account and applied by this device.
        </GroupFooter>

        <GroupLabel>Safety</GroupLabel>
        <RowGroup>
          <ListRow
            title="Blocked accounts"
            subtitle="They can’t message you or find you"
            icon="block"
            iconTone="danger"
            accessory={{ kind: 'value', text: String(blocked.data?.length ?? 0) }}
            onPress={() => router.push('/settings/privacy/blocked')}
          />
        </RowGroup>
      </ScreenScroll>

      <ConfirmSheet
        visible={confirmReceipts.visible}
        onClose={confirmReceipts.close}
        title="Turn off read receipts?"
        message="You will also stop seeing when others read your messages."
        confirmLabel="Turn off"
        destructive
        onConfirm={() => { confirmReceipts.close(); void flip('readReceiptsEnabled', false) }}
      />
    </Screen>
  )
}

function Swatch({
  label, color, selected, onPress,
}: { label: string; color: string; selected: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <Touchable onPress={onPress} feedback="scale" haptic="select" accessibilityLabel={label} accessibilityState={{ selected }}>
      <View
        style={[
          styles.swatch,
          { backgroundColor: color, borderColor: selected ? t.colors.accent : t.colors.border, borderWidth: selected ? 2.5 : StyleSheet.hairlineWidth },
        ]}
      >
        {selected ? <Icon name="check" size={14} color={t.colors.accent} /> : null}
      </View>
      <Text variant="micro" tone="muted" align="center" numberOfLines={1} style={styles.swatchCaption}>{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  reciprocal: { paddingHorizontal: space.lg, paddingTop: space.sm2 },
  preview: {
    marginHorizontal: space.lg, marginBottom: space.sm2, padding: space.md, gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth, minHeight: 110, justifyContent: 'center',
    ...setback(shape.card), borderCurve: 'continuous',
  },
  /* The real bubbles' shape, so the preview is not lying about it: crowned at
     14 with the 4pt tail on the sender's side (logical, RTL-safe). */
  previewIn: {
    alignSelf: 'flex-start', maxWidth: '78%', paddingHorizontal: space.md, paddingVertical: space.sm,
    borderTopStartRadius: shape.bubble.crown,
    borderTopEndRadius: shape.bubble.crown,
    borderBottomStartRadius: shape.bubble.tail,
    borderBottomEndRadius: shape.bubble.crown,
    borderCurve: 'continuous',
  },
  previewOut: {
    alignSelf: 'flex-end', maxWidth: '78%', paddingHorizontal: space.md, paddingVertical: space.sm,
    borderTopStartRadius: shape.bubble.crown,
    borderTopEndRadius: shape.bubble.crown,
    borderBottomStartRadius: shape.bubble.crown,
    borderBottomEndRadius: shape.bubble.tail,
    borderCurve: 'continuous',
  },
  swatchRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm2 },
  swatchLabel: {},
  swatch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', ...setback(shape.buttonLg), borderCurve: 'continuous' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatchCaption: { width: 44, marginTop: space.xs },
  segmentRow: { paddingHorizontal: space.lg, paddingVertical: space.md },
})
