/* =========================================================
   Create a channel.

   `settings` is a WHOLE-OBJECT replacement on the wire, so the
   full blob goes out through `channelSettingsTo` even at
   creation — a partial object is how a knob silently resets.

   The image uploads are deliberately AFTER the create and
   deliberately non-fatal: the channel exists the moment the
   POST returns, and failing the whole flow because a photo did
   not upload would strand the user with a channel they were
   told they did not make.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  api, channelSettingsTo, codeOf, errorText, fieldErrorMap, isNetworkError,
} from '@/api'
import { toUploadFile } from '@/platform/files.js'
import { useCooldown } from '@/hooks/useCooldown'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Field, GroupFooter, GroupLabel, Header, ListRow,
  RowGroup, Screen, SegmentedControl, Text, Touchable, toast, useSheetState,
} from '@/ui'
import {
  AvatarPicker, CategoryRow, CoverPicker, HANDLE_RE, HandleRow, useHandleCheck,
  type PickedAsset,
} from '@/components/channels/ChannelForm'
import { TopStrip } from '@/components/channels/states'
import { args } from '@/components/channels/apiArgs'
import { chRoute } from '@/components/channels/routes'

const DEFAULT_SETTINGS = {
  signMessages: false,
  reactionsEnabled: true,
  protectedContent: false,
  hiddenSubscribers: false,
  joinByRequest: false,
  language: '',
  country: '',
  region: '',
}

export default function NewChannelScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [handle, setHandle] = React.useState('')
  const [isPublic, setIsPublic] = React.useState(true)
  const [category, setCategory] = React.useState('')
  const [settings, setSettings] = React.useState<Record<string, any>>(DEFAULT_SETTINGS)
  const [localeOpen, setLocaleOpen] = React.useState(false)

  const [avatar, setAvatar] = React.useState<PickedAsset | null>(null)
  const [cover, setCover] = React.useState<PickedAsset | null>(null)

  const [busy, setBusy] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [cooldown, startCooldown] = useCooldown()
  const discard = useSheetState()

  const handleStatus = useHandleCheck(handle, { enabled: isPublic })
  const dirty = !!(title || description || handle || avatar || cover || category)

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirty, discard.open)

  const handleOk = !isPublic || (HANDLE_RE.test(handle) && handleStatus !== 'taken')
  const canSubmit = !!title.trim() && handleOk && !busy && cooldown === 0

  const setSetting = (k: string, v: any) => setSettings(s => ({ ...s, [k]: v }))

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const created = await api.channels.create(args({
        title: title.trim(),
        description: description.trim() || undefined,
        handle: isPublic ? handle : undefined,
        publicChannel: isPublic,
        category: category || undefined,
        settings: channelSettingsTo(settings),
      }))
      if (!created) throw new Error('Channel was not created')

      /* Both uploads are best-effort. A failure here costs an image, not the
         channel — so it toasts and the navigation happens either way. */
      let imageFailed = false
      if (avatar) {
        try { await api.channels.photo(created.id, toUploadFile(avatar)) } catch { imageFailed = true }
      }
      if (cover) {
        try { await api.channels.cover(created.id, toUploadFile(cover)) } catch { imageFailed = true }
      }

      router.replace(chRoute.channel(created.id))
      toast.ok(imageFailed ? 'Channel created — the image didn’t upload' : 'Channel created')
    } catch (e: any) {
      setBusy(false)
      const code = codeOf(e)
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { handle: 'handle', title: 'title', description: 'description' }) as Record<string, string>
        if (Object.keys(map).length) setFieldErrors(map)
        else setFormError(e)
        return
      }
      /* The handle 400s are complete sentences written for the user; they
         belong on the handle row verbatim, not re-worded in a banner. */
      if (e?.status === 400 && /handle/i.test(String(e?.message || ''))) {
        setFieldErrors({ handle: errorText(e) })
        return
      }
      startCooldown(e)
      setFormError(e)
    }
  }

  const blocked = ['CONTENT_BLOCKED_BY_POLICY', 'CONTENT_REJECTED'].includes(codeOf(formError))
  const offline = isNetworkError(formError)

  return (
    <Screen background="sunken">
      <Header
        closeButton
        title="New channel"
        back={() => (dirty ? discard.open() : router.back())}
        actions={[{
          icon: 'check',
          onPress: submit,
          label: 'Create',
          tone: canSubmit ? 'accent' : 'default',
        }]}
      />

      {offline ? <TopStrip tone="neutral">You’re offline — creating a channel needs a connection.</TopStrip> : null}

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140, opacity: busy ? 0.6 : 1 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={!busy}
      >
        <View pointerEvents={busy ? 'none' : 'auto'}>
          <View style={{ padding: t.layout.screenPadding, gap: space.lg }}>
            <AvatarPicker uri={avatar?.uri} onPick={setAvatar} onClear={() => setAvatar(null)} />
            <CoverPicker uri={cover?.uri} onPick={setCover} onClear={() => setCover(null)} />
          </View>

          {formError && !blocked ? (
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
              <Callout tone="danger">{errorText(formError)}</Callout>
            </View>
          ) : null}
          {blocked ? (
            /* No retry button: the same body will be refused again. The way
               forward is an edit, so the form stays exactly as typed. */
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
              <Callout tone="danger" title="This can’t be published">{errorText(formError)}</Callout>
            </View>
          ) : null}

          <GroupLabel>Basics</GroupLabel>
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md }}>
            <Field
              label="Title"
              value={title}
              onChangeText={v => { setTitle(v); setFieldErrors(f => ({ ...f, title: '' })) }}
              error={fieldErrors.title || null}
              placeholder="What is this channel about?"
              maxLength={120}
              required
            />
            <Field
              label="Description"
              value={description}
              onChangeText={v => { setDescription(v); setFieldErrors(f => ({ ...f, description: '' })) }}
              error={fieldErrors.description || null}
              placeholder="Tell people what they’ll get"
              multiline
              minHeight={110}
              maxLength={500}
            />
          </View>

          <GroupLabel>Visibility</GroupLabel>
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md2 }}>
            <SegmentedControl
              options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]}
              value={isPublic ? 'public' : 'private'}
              onChange={v => {
                const next = v === 'public'
                setIsPublic(next)
                /* Going private clears the handle: the server ignores it there,
                   and a field that keeps a value it will not use is a lie. */
                if (!next) { setHandle(''); setFieldErrors(f => ({ ...f, handle: '' })) }
              }}
            />
            <HandleRow
              value={handle}
              onChange={v => { setHandle(v); setFieldErrors(f => ({ ...f, handle: '' })) }}
              status={handleStatus}
              disabled={!isPublic}
              error={fieldErrors.handle || null}
            />
          </View>
          <GroupFooter>
            {isPublic
              ? 'Anyone can find and subscribe to this channel. It gets a shareable link.'
              : 'Only people with an invite link can join. No @handle, no share link.'}
          </GroupFooter>

          <GroupLabel>Category</GroupLabel>
          <CategoryRow value={category} onChange={setCategory} />

          <GroupLabel>How it works</GroupLabel>
          <RowGroup>
            <ListRow
              title="Sign posts"
              subtitle="Show the posting admin’s @username on each post"
              accessory={{ kind: 'switch', value: !!settings.signMessages, onValueChange: v => setSetting('signMessages', v) }}
            />
            <ListRow
              title="Reactions"
              subtitle="Let subscribers react to posts"
              accessory={{ kind: 'switch', value: settings.reactionsEnabled !== false, onValueChange: v => setSetting('reactionsEnabled', v) }}
            />
            <ListRow
              title="Restrict saving"
              subtitle="Subscribers can’t forward, copy or save posts"
              accessory={{ kind: 'switch', value: !!settings.protectedContent, onValueChange: v => setSetting('protectedContent', v) }}
            />
            <ListRow
              title="Hide subscribers"
              subtitle="Only admins can see who subscribed"
              accessory={{ kind: 'switch', value: !!settings.hiddenSubscribers, onValueChange: v => setSetting('hiddenSubscribers', v) }}
            />
            <ListRow
              title="Approve new subscribers"
              subtitle="Subscribing files a request you approve"
              accessory={{ kind: 'switch', value: !!settings.joinByRequest, onValueChange: v => setSetting('joinByRequest', v) }}
            />
          </RowGroup>

          <Touchable onPress={() => setLocaleOpen(o => !o)} feedback="dim" style={styles.disclosure}>
            <Text variant="subhead" tone="accent" align="ui">
              {localeOpen ? 'Hide appearance & locale' : 'Appearance & locale'}
            </Text>
          </Touchable>
          {localeOpen ? (
            <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md }}>
              <Field label="Language" value={settings.language} onChangeText={v => setSetting('language', v)} placeholder="en" autoCapitalize="none" />
              <Field label="Country" value={settings.country} onChangeText={v => setSetting('country', v)} placeholder="IQ" autoCapitalize="characters" />
              <Field label="Region" value={settings.region} onChangeText={v => setSetting('region', v)} placeholder="Kurdistan" />
            </View>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 12,
            backgroundColor: t.colors.bg,
            borderTopColor: t.colors.separator,
          },
        ]}
      >
        <Button
          label={cooldown > 0 ? `Wait ${cooldown}s` : 'Create channel'}
          onPress={submit}
          disabled={!canSubmit}
          loading={busy}
          size="lg"
          block
        />
      </View>

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard this channel?"
        message="Nothing you have typed will be kept."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { discard.close(); router.back() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  disclosure: { paddingHorizontal: space.lg, paddingVertical: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth },
})
