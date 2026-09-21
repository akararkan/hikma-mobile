/* =========================================================
   Edit profile — the display layer.

   `updateProfile` is a partial write: an omitted or null key
   means "keep the current value", so only DIRTY fields go on
   the wire. Sending the whole form back would look identical
   until two devices edit different fields, at which point the
   second save silently reverts the first.

   The two image endpoints are NOT part of Save. They write
   immediately and return the whole UserResponse, which goes
   straight into setUser so the tab bar avatar, the drawer and
   every list row update in one pass.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useRouter } from 'expo-router'
import { adapters, api, assetUrl, codeOf, errorText, fieldErrorMap, isNetworkError } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { toUploadFile } from '@/platform/files'
import { compressToTier } from '@/lib/mediaTier'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Callout, ConfirmSheet, Divider, ErrorState, Field, GroupLabel,
  Header, Icon, ListRow, RowGroup, Screen, Skeleton, Spinner, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'

type Form = {
  displayName: string
  profileBio: string
  selfDescriber: string
  academicTitle: string
  institutionName: string
  location: string
  websiteUrl: string
  contentLanguage: string
  isForHire: boolean
  isProfileLocked: boolean
}

const LANGUAGES: [string, string][] = [['EN', 'English'], ['AR', 'العربية'], ['CKB', 'کوردی']]

function formOf(me: any): Form {
  return {
    displayName: me?.displayName || me?.full || '',
    profileBio: me?.bio || '',
    selfDescriber: me?.selfDescriber || '',
    academicTitle: me?.academicTitle || '',
    institutionName: me?.institution || '',
    location: me?.location || '',
    websiteUrl: me?.website || '',
    contentLanguage: me?.contentLanguage || '',
    isForHire: !!me?.isForHire,
    isProfileLocked: !!me?.profileLocked,
  }
}

export default function EditProfileScreen() {
  const t = useTheme()
  const router = useRouter()
  const { setUser } = useAuth()

  const me = useAsync<any>(() => api.users.meProfile(), {})

  const [form, setForm] = React.useState<Form>(() => formOf(null))
  const [base, setBase] = React.useState<Form>(() => formOf(null))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)
  const [saving, setSaving] = React.useState(false)
  const [busyImage, setBusyImage] = React.useState<'avatar' | 'cover' | null>(null)
  const [lockNoted, setLockNoted] = React.useState(false)

  const avatarSheet = useSheetState()
  const coverSheet = useSheetState()
  const langSheet = useSheetState()
  const discard = useSheetState()

  /* Re-read on focus: the sub-editors write through their own endpoints, so
     coming back from one with a stale copy here is how a Save reverts it. */
  useFocusEffect(React.useCallback(() => { void me.refresh() }, []))   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!me.data) return
    const next = formOf(me.data)
    setBase(next)
    setForm(prev => (dirtyOf(prev, base).length ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data])

  const dirtyKeys = dirtyOf(form, base)
  const dirty = dirtyKeys.length > 0

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => ({ ...e, [key]: '' }))
    setFormError(null)
  }

  /* ---- images ---- */

  const pickImage = async (kind: 'avatar' | 'cover', from: 'camera' | 'library') => {
    const perm = from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { toast.warn('Hikmah Web needs permission to use your photos.'); return }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [16, 9],
      quality: 0.9,
    }
    const res = from === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts)
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return

    setBusyImage(kind)
    try {
      /* `quality` re-encodes but never resizes, and the crop box does not
         either — a 12MP camera photo cropped square is still 3000px. This is
         the one image every feed row, comment row and chat row fetches, so it
         gets the tightest tier unconditionally: 1080 is still 8x the pixels a
         40pt avatar can show. */
      const ready = await compressToTier(asset, 'DATA_SAVER')
      const raw = kind === 'avatar'
        ? await api.users.uploadAvatar(toUploadFile(ready, 'avatar.jpg'))
        : await api.users.uploadCover(toUploadFile(ready, 'cover.jpg'))
      const view = adapters.meFrom(raw)
      setUser(view)
      me.setData(view)
      fireHaptic('success')
    } catch (e: any) {
      fireHaptic('error')
      toast.error(errorText(e))
    } finally {
      setBusyImage(null)
    }
  }

  const removeImage = async (kind: 'avatar' | 'cover') => {
    setBusyImage(kind)
    try {
      const raw = kind === 'avatar' ? await api.users.removeAvatar() : await api.users.removeCover()
      const view = adapters.meFrom(raw)
      setUser(view)
      me.setData(view)
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setBusyImage(null)
    }
  }

  /* ---- save ---- */

  const save = async () => {
    if (saving) return
    if (!dirty) { router.back(); return }

    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      const body: Record<string, any> = {}
      for (const key of dirtyKeys) body[key] = form[key]
      /* updateProfile already returns a view user; the raw-to-view mapping
         only belongs on the two upload endpoints, which answer with the
         unmapped UserResponse. */
      const view = await api.users.updateProfile(body)
      setUser(view)
      setBase(formOf(view))
      fireHaptic('success')
      toast.ok('Profile updated')
      router.back()
    } catch (e: any) {
      setSaving(false)
      fireHaptic('error')
      if (codeOf(e) === 'VALIDATION_FAILED') {
        setErrors(fieldErrorMap(e) as Record<string, string>)
      } else if (codeOf(e) === 'MADHHAB_NOT_FOUND') {
        /* Only reachable if a stale id leaked in from the expertise editor. */
        setFormError(e)
        toast.warn('That school no longer exists — pick it again.')
        router.push('/profile/edit/expertise')
      } else {
        setFormError(e)
      }
    }
  }

  const leave = () => { if (dirty) discard.open(); else router.back() }

  /* Hardware back runs the same guard as Cancel. */
  useDiscardGuard(dirty, discard.open)

  /* ---- render ---- */

  if (me.loading && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Edit profile" />
        <View style={{ gap: space.md, padding: t.layout.screenPadding }}>
          <Skeleton height={140} radius={t.radius.md} />
          <Skeleton height={190} radius={t.radius.md} />
          <Skeleton height={230} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (me.error && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Edit profile" />
        <ErrorState
          error={me.error}
          onRetry={me.reload}
          title={codeOf(me.error) === 'USERPROFILE_NOT_FOUND' ? 'Your profile could not be loaded' : undefined}
        />
      </Screen>
    )
  }

  const user = me.data
  const cover = user?.coverImage ? assetUrl(user.coverImage) : null

  return (
    <Screen background="sunken">
      <Header
        back={leave}
        title="Edit profile"
        actions={[{
          icon: 'check',
          onPress: save,
          label: 'Save changes',
          tone: dirty ? 'accent' : 'default',
        }]}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---- images ---- */}
        <View>
          <Touchable onPress={() => coverSheet.open()} feedback="dim" noAutoHitSlop>
            <View style={[styles.cover, { backgroundColor: t.colors.surfaceSunken }]}>
              {cover ? (
                <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
              ) : null}
              <View style={[styles.coverBadge, { backgroundColor: t.colors.overlayChip }]}>
                <Icon name="camera" size={14} color={t.colors.overlayText} />
                <Text variant="caption" color={t.colors.overlayText}>{cover ? 'Change cover' : 'Add cover'}</Text>
              </View>
              {busyImage === 'cover' ? <View style={styles.imageBusy}><Spinner /></View> : null}
            </View>
          </Touchable>

          <View style={[styles.avatarRow, { paddingHorizontal: t.layout.screenPadding }]}>
            <Touchable onPress={() => avatarSheet.open()} feedback="scale" noAutoHitSlop>
              <View style={[styles.avatarRing, { backgroundColor: t.colors.bgSunken }]}>
                <Avatar uri={user?.profileImage} name={user?.full} seed={user?.id} size={84} />
                <View style={[styles.cameraFab, { backgroundColor: t.colors.accent, borderColor: t.colors.bgSunken }]}>
                  <Icon name="camera" size={14} color={t.colors.textOnAccent} />
                </View>
                {busyImage === 'avatar' ? <View style={styles.imageBusy}><Spinner /></View> : null}
              </View>
            </Touchable>
          </View>
        </View>

        {formError ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
            <Callout tone="danger">{errorText(formError)}</Callout>
          </View>
        ) : null}
        {isNetworkError(me.error) ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
            <Callout tone="warning" icon="offline">You are offline — changes cannot be saved until you reconnect.</Callout>
          </View>
        ) : null}

        {/* ---- basics ---- */}
        <GroupLabel>Basics</GroupLabel>
        <FormCard>
          <Field
            label="Display name"
            value={form.displayName}
            onChangeText={v => set('displayName', v)}
            error={errors.displayName || null}
            maxLength={120}
            editable={!saving}
          />
          <Field
            label="Bio"
            value={form.profileBio}
            onChangeText={v => set('profileBio', v)}
            error={errors.profileBio || null}
            placeholder="Tell people what you study or teach."
            multiline
            minHeight={120}
            editable={!saving}
          />
          <Field
            label="Self describer"
            value={form.selfDescriber}
            onChangeText={v => set('selfDescriber', v)}
            error={errors.selfDescriber || null}
            placeholder="Scholar | Author | Researcher"
            maxLength={200}
            editable={!saving}
          />
        </FormCard>

        {/* ---- academic ---- */}
        <GroupLabel>Academic</GroupLabel>
        <FormCard>
          <Field
            label="Academic title"
            value={form.academicTitle}
            onChangeText={v => set('academicTitle', v)}
            error={errors.academicTitle || null}
            placeholder="Professor of Islamic Jurisprudence"
            maxLength={150}
            editable={!saving}
          />
          <Field
            label="Institution"
            value={form.institutionName}
            onChangeText={v => set('institutionName', v)}
            error={errors.institutionName || null}
            maxLength={200}
            editable={!saving}
          />
          <Field
            label="Location"
            value={form.location}
            onChangeText={v => set('location', v)}
            error={errors.location || null}
            maxLength={200}
            icon="location"
            editable={!saving}
          />
          <Field
            label="Website"
            value={form.websiteUrl}
            onChangeText={v => set('websiteUrl', v)}
            error={errors.websiteUrl || null}
            placeholder="https://example.org"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            icon="link"
            editable={!saving}
          />
        </FormCard>

        {/* ---- preferences ---- */}
        <GroupLabel>Preferences</GroupLabel>
        <RowGroup inset={0}>
          <ListRow
            title="Content language"
            accessory={{ kind: 'value', text: LANGUAGES.find(l => l[0] === form.contentLanguage)?.[1] || 'Not set' }}
            onPress={langSheet.open}
            subtitle={errors.contentLanguage || undefined}
          />
          <ListRow
            title="Open to work"
            subtitle="Shows an availability mark on your profile."
            accessory={{ kind: 'switch', value: form.isForHire, onValueChange: v => set('isForHire', v), disabled: saving }}
          />
          <ListRow
            title="Lock profile"
            description="While your profile is locked, new people cannot follow you."
            accessory={{
              kind: 'switch',
              value: form.isProfileLocked,
              onValueChange: v => { set('isProfileLocked', v); if (v && !lockNoted) setLockNoted(true) },
              disabled: saving,
            }}
          />
        </RowGroup>
        {lockNoted && form.isProfileLocked ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.sm }}>
            <Callout tone="info">Everyone who already follows you keeps following you.</Callout>
          </View>
        ) : null}

        {/* ---- sub-editors ---- */}
        <GroupLabel>More</GroupLabel>
        <RowGroup inset={0}>
          <ListRow
            title="Name and username"
            accessory={{ kind: 'value', text: `@${user?.handle || ''}` }}
            onPress={() => router.push('/profile/edit/identity')}
          />
          <ListRow
            title="Madhhab and specializations"
            accessory={{
              kind: 'value',
              text: summarise([
                user?.madhhab ? '1 school' : '',
                user?.specializations?.length ? `${user.specializations.length} topics` : '',
              ]),
            }}
            onPress={() => router.push('/profile/edit/expertise')}
          />
          <ListRow
            title="Links and contacts"
            accessory={{
              kind: 'value',
              text: summarise([
                user?.links?.length ? `${user.links.length} link${user.links.length === 1 ? '' : 's'}` : '',
                user?.contacts?.length ? `${user.contacts.length} contact${user.contacts.length === 1 ? '' : 's'}` : '',
              ]),
            }}
            onPress={() => router.push('/profile/edit/links')}
          />
        </RowGroup>

        {saving ? <Spinner label="Saving…" /> : null}
      </KeyboardAwareScrollView>

      <ActionSheet
        visible={avatarSheet.visible}
        onClose={avatarSheet.close}
        title="Profile photo"
        actions={[
          { label: 'Take photo', icon: 'camera', onPress: () => void pickImage('avatar', 'camera') },
          { label: 'Choose from library', icon: 'gallery', onPress: () => void pickImage('avatar', 'library') },
          { label: 'Remove photo', icon: 'trash', destructive: true, hidden: !user?.profileImage, onPress: () => void removeImage('avatar') },
        ]}
      />

      <ActionSheet
        visible={coverSheet.visible}
        onClose={coverSheet.close}
        title="Cover image"
        actions={[
          { label: 'Take photo', icon: 'camera', onPress: () => void pickImage('cover', 'camera') },
          { label: 'Choose from library', icon: 'gallery', onPress: () => void pickImage('cover', 'library') },
          { label: 'Remove cover', icon: 'trash', destructive: true, hidden: !cover, onPress: () => void removeImage('cover') },
        ]}
      />

      <ActionSheet
        visible={langSheet.visible}
        onClose={langSheet.close}
        title="Content language"
        subtitle="The language your posts are written in."
        actions={LANGUAGES.map(([value, label]) => ({
          label,
          icon: form.contentLanguage === value ? ('check' as const) : undefined,
          onPress: () => set('contentLanguage', value),
        }))}
      />

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard changes?"
        message="Your edits are not saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => { discard.close(); router.back() }}
      />
    </Screen>
  )
}

function FormCard({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <View
      style={{
        marginHorizontal: t.layout.screenPadding,
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.borderFaint,
        overflow: 'hidden',
      }}
    >
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          <View style={{ padding: space.md2 }}>{child}</View>
        </View>
      ))}
    </View>
  )
}

function dirtyOf(form: Form, base: Form): (keyof Form)[] {
  return (Object.keys(form) as (keyof Form)[]).filter(k => form[k] !== base[k])
}

function summarise(parts: string[]): string {
  const kept = parts.filter(Boolean)
  return kept.length ? kept.join(' · ') : 'None'
}

const styles = StyleSheet.create({
  cover: { height: 140, overflow: 'hidden' },
  /* "Change cover" carries a label, so it is a chip plate (setback 8/3) on the
     overlayChip fill — not a pill. Chrome on media is a solid plate with
     overlayText ink, never blur (DESIGN.md §6, §8.9). */
  coverBadge: {
    position: 'absolute', bottom: 10, end: 12,
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    paddingHorizontal: space.sm2, paddingVertical: space.xs2,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  imageBusy: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  avatarRow: { marginTop: -42, marginBottom: space.xs2 },
  /* Round on purpose: this is the ring around an 84pt avatar, and faces are
     the one round thing in the language. */
  avatarRing: { padding: space.xs, borderRadius: 46, alignSelf: 'flex-start' },
  cameraFab: {
    position: 'absolute', bottom: 2, end: 2,
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
})
