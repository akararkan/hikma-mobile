/* =========================================================
   Edit channel.

   Two wire rules drive the whole screen:

   · `settings` is a WHOLE-OBJECT replacement. The seeded blob is
     kept intact and every save sends
     `channelSettingsTo({ ...channel.settings, ...edits })`, or a
     knob nobody touched resets itself.
   · turning `publicChannel` off CLEARS the @handle and the share
     link server-side, and going public again needs a fresh one.
     The form says so the moment Private is selected rather than
     after the fact.

   Images are not batched into Save: they are their own endpoints
   and fire on pick, so their progress is visible and a failed
   upload never blocks a title change.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import {
  api, channelSettingsTo, codeOf, errorText, fieldErrorMap, isConflict, isNetworkError, isNotFound,
} from '@/api'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { isModerationError } from '@/lib/moderation'
import { ModerationRefusalNotice } from '@/components/moderation'
import { isPlatformAdmin, useAuth } from '@/context/AuthContext'
import { useChatActions } from '@/context/ChatContext'
import { toUploadFile } from '@/platform/files.js'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Field, GroupFooter, GroupLabel, Header, ListRow,
  RowGroup, Screen, SegmentedControl, Sheet, Skeleton, Text, Touchable, toast,
  useSheetState,
} from '@/ui'
import {
  AvatarPicker, CategoryRow, CoverPicker, HANDLE_RE, HandleRow, useHandleCheck,
  type PickedAsset,
} from '@/components/channels/ChannelForm'
import { GoneCard, RefusalCard, TopStrip } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

/** The whitelist candidates. An EMPTY selection means null — every emoji is
 *  allowed — which is why the footnote spells that out. */
const REACTION_CANDIDATES = [
  '👍', '👎', '❤️', '🔥', '🎉', '👏', '😂', '😮',
  '😢', '🙏', '💯', '🤝', '✅', '💡', '📌', '⭐',
  '🚀', '🧠', '📚', '🕌', '☪️', '🌙', '✨', '🤲',
]

export default function EditChannelScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { dropConvo } = useChatActions()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel

  const [seeded, setSeeded] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [handle, setHandle] = React.useState('')
  const [isPublic, setIsPublic] = React.useState(true)
  const [category, setCategory] = React.useState('')
  const [settings, setSettings] = React.useState<Record<string, any>>({})
  const [limitReactions, setLimitReactions] = React.useState(false)
  const [localeOpen, setLocaleOpen] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)

  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [imageBusy, setImageBusy] = React.useState<'avatar' | 'cover' | null>(null)

  const discard = useSheetState()
  const confirmDelete = useSheetState()
  const [typed, setTyped] = React.useState('')

  /* Seed once. Re-seeding on every channel refresh would fight the user's
     keystrokes; the 409 path re-seeds deliberately. */
  React.useEffect(() => {
    if (!channel || seeded) return
    setTitle(channel.title || '')
    setDescription(channel.description || '')
    setHandle(channel.handle || '')
    setIsPublic(channel.publicChannel !== false)
    setCategory(channel.category || '')
    setSettings({ ...(channel.settings || {}) })
    setLimitReactions(!!channel.settings?.allowedReactions?.length)
    setSeeded(true)
  }, [channel, seeded])

  const wasPublic = channel?.publicChannel !== false
  const handleStatus = useHandleCheck(handle, { enabled: isPublic, currentHandle: channel?.handle || '' })
  const handleOk = !isPublic || (HANDLE_RE.test(handle) && handleStatus !== 'taken')
  const canSave = dirty && !!title.trim() && handleOk && !saving

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirty, discard.open)

  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true) }
  const setSetting = (k: string, v: any) => { setSettings(s => ({ ...s, [k]: v })); setDirty(true) }

  const toggleEmoji = (e: string) => {
    setSettings(s => {
      const list: string[] = s.allowedReactions || []
      return { ...s, allowedReactions: list.includes(e) ? list.filter(x => x !== e) : [...list, e] }
    })
    setDirty(true)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const fresh = await api.channels.update(id, {
        title: title.trim(),
        description: description.trim(),
        handle: isPublic ? handle : undefined,
        publicChannel: isPublic,
        /* Always sent: the empty string CLEARS the category on the wire, while
           an omitted field leaves the old slug in place. */
        category,
        settings: channelSettingsTo({
          ...settings,
          allowedReactions: limitReactions ? settings.allowedReactions : null,
        }),
      })
      rights.setChannel(fresh)
      setDirty(false)
      toast.ok('Channel updated')
      router.back()
    } catch (e: any) {
      const code = codeOf(e)
      if (isConflict(e)) {
        /* Somebody else edited the same row. Re-read, then let the user
           review — silently replaying the same body would clobber them. */
        setSeeded(false)
        rights.reload()
        setFormError(e)
        toast.warn('Someone else changed this channel — review and save again.')
        return
      }
      if (code === 'VALIDATION_FAILED') {
        const map = fieldErrorMap(e, { handle: 'handle', title: 'title', description: 'description' }) as Record<string, string>
        if (Object.keys(map).length) setFieldErrors(map)
        else setFormError(e)
        return
      }
      if (e?.status === 400 && /handle/i.test(String(e?.message || ''))) {
        setFieldErrors({ handle: errorText(e) })
        return
      }
      setFormError(e)
    } finally {
      setSaving(false)
    }
  }

  const uploadImage = async (kind: 'avatar' | 'cover', asset: PickedAsset) => {
    setImageBusy(kind)
    try {
      const fresh = kind === 'avatar'
        ? await api.channels.photo(id, toUploadFile(asset))
        : await api.channels.cover(id, toUploadFile(asset))
      rights.setChannel(fresh)
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setImageBusy(null)
    }
  }

  const removeImage = async (kind: 'avatar' | 'cover') => {
    setImageBusy(kind)
    try {
      if (kind === 'avatar') await api.channels.removePhoto(id)
      else await api.channels.removeCover(id)
      rights.setChannel((prev: any) => (prev ? { ...prev, [kind === 'avatar' ? 'avatarUrl' : 'coverUrl']: null } : prev))
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setImageBusy(null)
    }
  }

  const setVerified = async (next: boolean) => {
    try {
      const fresh = await api.channels.setVerified(id, next)
      rights.setChannel(fresh)
    } catch (e: any) { toast.error(errorText(e)) }
  }

  const removeChannel = async () => {
    try {
      /* Through the provider: the channel's chat-rail row has to go with it. */
      await dropConvo(id, () => api.channels.remove(id), 'Could not delete this channel')
      router.replace(chRoute.index())
      toast.ok('Channel deleted')
    } catch { /* the provider restored the row and said why */ }
  }

  /* ---- gates ---- */

  if (rights.error && isNotFound(rights.error)) {
    return (
      <Screen background="sunken">
        <Header back title="Edit channel" />
        <GoneCard onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  if (rights.loading && !channel) {
    return (
      <Screen background="sunken">
        <Header back title="Edit channel" />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={120} radius={14} />
          <Skeleton height={160} radius={14} />
          <Skeleton height={160} radius={14} />
        </View>
      </Screen>
    )
  }

  const allowed = !!channel && rights.can('canChangeInfo')
  if (!allowed || codeOf(formError) === 'ADMINS_ONLY') {
    return (
      <Screen background="sunken">
        <Header back title="Edit channel" />
        <RefusalCard
          error={formError}
          title="You can’t edit this channel"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  /* isModerationError covers BOTH outcomes: rejected (final) and held for
     review (not yet). The hand-rolled code list only knew the first, so a held
     name change surfaced as a hard red error when the honest answer is "still
     being checked" — and, per the error guide, a held change is retryable. */
  const moderated = isModerationError(formError)
  const goingPrivate = wasPublic && !isPublic

  return (
    <Screen background="sunken">
      <Header
        back={() => (dirty ? discard.open() : router.back())}
        title="Edit channel"
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: canSave ? 'accent' : 'default' }]}
      />
      {isNetworkError(formError) ? <TopStrip tone="neutral">{errorText(formError)}</TopStrip> : null}

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60, opacity: saving ? 0.6 : 1 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View pointerEvents={saving ? 'none' : 'auto'}>
          <View style={{ padding: t.layout.screenPadding, gap: space.lg }}>
            <AvatarPicker
              uri={channel?.avatarUrl}
              busy={imageBusy === 'avatar'}
              onPick={a => void uploadImage('avatar', a)}
              onClear={() => void removeImage('avatar')}
            />
            <CoverPicker
              uri={channel?.coverUrl}
              busy={imageBusy === 'cover'}
              onPick={a => void uploadImage('cover', a)}
              onClear={() => void removeImage('cover')}
            />
          </View>

          {formError && !moderated && !isNetworkError(formError) ? (
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
              <Callout tone="danger">{errorText(formError)}</Callout>
            </View>
          ) : null}
          {moderated ? (
            <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
              <ModerationRefusalNotice
                error={formError}
                onRetry={() => { setFormError(null); void save() }}
                onDismiss={() => setFormError(null)}
              />
            </View>
          ) : null}

          <GroupLabel>Info</GroupLabel>
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md }}>
            <Field
              label="Title"
              value={title}
              onChangeText={edit(setTitle)}
              error={fieldErrors.title || null}
              maxLength={120}
            />
            <Field
              label="Description"
              value={description}
              onChangeText={edit(setDescription)}
              error={fieldErrors.description || null}
              multiline
              minHeight={110}
              maxLength={500}
            />
          </View>
          <View style={{ marginTop: space.md }}>
            <CategoryRow value={category} onChange={edit(setCategory)} />
          </View>

          <GroupLabel>Visibility</GroupLabel>
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md2 }}>
            <SegmentedControl
              options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]}
              value={isPublic ? 'public' : 'private'}
              onChange={v => {
                const next = v === 'public'
                setIsPublic(next)
                setDirty(true)
                if (!next) setHandle('')
              }}
            />
            {goingPrivate ? (
              <Callout tone="warning">
                Going private clears the @handle and the share link. You’ll need a new handle to go public again.
              </Callout>
            ) : null}
            <HandleRow
              value={handle}
              onChange={edit(setHandle)}
              status={handleStatus}
              disabled={!isPublic}
              error={fieldErrors.handle || null}
            />
            {isPublic && channel?.shareUrl ? (
              <Touchable
                onPress={async () => { await Clipboard.setStringAsync(channel.shareUrl); toast.ok('Link copied') }}
                feedback="dim"
                style={[styles.copyRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}
              >
                <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>{channel.shareUrl}</Text>
                <Text variant="footnote" tone="accent">Copy</Text>
              </Touchable>
            ) : null}
          </View>

          <GroupLabel>Posting</GroupLabel>
          <RowGroup>
            <ListRow
              title="Sign posts"
              subtitle="Show the posting admin’s @username on each post"
              accessory={{ kind: 'switch', value: !!settings.signMessages, onValueChange: v => setSetting('signMessages', v) }}
            />
            <ListRow
              title="Restrict saving"
              subtitle="Subscribers can’t forward, copy or save posts"
              accessory={{ kind: 'switch', value: !!settings.protectedContent, onValueChange: v => setSetting('protectedContent', v) }}
            />
          </RowGroup>

          <GroupLabel>Reactions</GroupLabel>
          <RowGroup>
            <ListRow
              title="Allow reactions"
              accessory={{ kind: 'switch', value: settings.reactionsEnabled !== false, onValueChange: v => setSetting('reactionsEnabled', v) }}
            />
            {settings.reactionsEnabled !== false ? (
              <ListRow
                title="Limit which reactions"
                subtitle="Pick the emoji subscribers may use"
                accessory={{
                  kind: 'switch',
                  value: limitReactions,
                  onValueChange: v => { setLimitReactions(v); setDirty(true); if (!v) setSettings(s => ({ ...s, allowedReactions: [] })) },
                }}
              />
            ) : null}
          </RowGroup>
          {settings.reactionsEnabled !== false && limitReactions ? (
            <>
              <View style={styles.emojiGrid}>
                {REACTION_CANDIDATES.map(e => {
                  const on = (settings.allowedReactions || []).includes(e)
                  return (
                    <Touchable
                      key={e}
                      onPress={() => toggleEmoji(e)}
                      feedback="scale"
                      haptic="select"
                      noAutoHitSlop
                      accessibilityState={{ selected: on }}
                      style={[
                        styles.emoji,
                        { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : 'transparent' },
                      ]}
                    >
                      <Text variant="title3" align="center">{e}</Text>
                    </Touchable>
                  )
                })}
              </View>
              <GroupFooter>
                Leave every emoji unselected to allow all of them.
              </GroupFooter>
            </>
          ) : null}

          <GroupLabel>Members</GroupLabel>
          <RowGroup>
            <ListRow
              title="Hide subscriber list"
              subtitle="The count stays public"
              accessory={{ kind: 'switch', value: !!settings.hiddenSubscribers, onValueChange: v => setSetting('hiddenSubscribers', v) }}
            />
            <ListRow
              title="Approve new subscribers"
              subtitle="Subscribing files a request"
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
              <Field label="Language" value={settings.language || ''} onChangeText={v => setSetting('language', v)} autoCapitalize="none" />
              <Field label="Country" value={settings.country || ''} onChangeText={v => setSetting('country', v)} autoCapitalize="characters" />
              <Field label="Region" value={settings.region || ''} onChangeText={v => setSetting('region', v)} />
              <Field label="Accent colour" value={settings.accentColor || ''} onChangeText={v => setSetting('accentColor', v)} autoCapitalize="none" />
              <Field label="Emoji status" value={settings.emojiStatus || ''} onChangeText={v => setSetting('emojiStatus', v)} />
              <Field label="Wallpaper" value={settings.wallpaper || ''} onChangeText={v => setSetting('wallpaper', v)} autoCapitalize="none" />
            </View>
          ) : null}

          {isPlatformAdmin(user) ? (
            <>
              <GroupLabel>Platform admin</GroupLabel>
              <RowGroup>
                <ListRow
                  title="Verified badge"
                  subtitle="Platform-granted, not owner-settable"
                  accessory={{ kind: 'switch', value: !!channel?.verified, onValueChange: v => void setVerified(v) }}
                />
              </RowGroup>
              <GroupFooter>
                This route is deprecated in favour of the admin console and will be removed.
              </GroupFooter>
            </>
          ) : null}

          {channel?.isOwner ? (
            <>
              <GroupLabel> </GroupLabel>
              <RowGroup>
                <ListRow title="Delete channel" icon="trash" destructive onPress={() => { setTyped(''); confirmDelete.open() }} />
              </RowGroup>
              <GroupFooter>
                Deletes it for everyone. Subscribers lose it from their inbox immediately.
              </GroupFooter>
            </>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard your edits?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { discard.close(); router.back() }}
      />

      <Sheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this channel?"
        subtitle="Deletes it for everyone. Subscribers lose it from their inbox immediately."
        maxHeightRatio={0.6}
        footer={
          <Button
            label="Delete for everyone"
            variant="danger"
            size="lg"
            block
            disabled={typed.trim() !== String(channel?.title || '').trim()}
            onPress={() => { confirmDelete.close(); void removeChannel() }}
          />
        }
      >
        <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
          <Text variant="callout" tone="muted" align="ui">Type the channel’s title to confirm.</Text>
          <Field value={typed} onChangeText={setTyped} placeholder={channel?.title} autoFocus autoCorrect={false} />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  disclosure: { paddingHorizontal: space.lg, paddingVertical: space.lg },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, padding: space.md },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm2 },
  emoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
})
