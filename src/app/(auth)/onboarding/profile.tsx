/* =========================================================
   First-run profile polish.

   Everything here is optional and everything here uses the
   same endpoints the full editor uses — the avatar upload is
   `users.uploadAvatar`, not a special onboarding variant, so
   there is exactly one code path that can be wrong.

   Two RN specifics worth knowing at the call site: a FormData
   part must be `{ uri, name, type }` (a browser File uploads
   nothing), and the PATCH takes only the keys that changed —
   an omitted key means "keep", so sending the whole form back
   would overwrite fields the user never touched.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import { adapters, api, assetUrl, codeOf, errorText, fieldErrorMap } from '@/api'
import { toUploadFile } from '@/platform/files'
import { compressToTier } from '@/lib/mediaTier'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, Callout, Field, Icon, Screen, Spinner, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'
import { OnboardingHeader } from './_layout'

export default function OnboardingProfileScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user, setUser } = useAuth()

  const [displayName, setDisplayName] = React.useState(() => user?.displayName || user?.full || '')
  const [bio, setBio] = React.useState(() => user?.bio || '')
  const [location, setLocation] = React.useState(() => user?.location || '')
  const [selfDescriber, setSelfDescriber] = React.useState(() => user?.selfDescriber || '')

  const [preview, setPreview] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)
  const [permissionDenied, setPermissionDenied] = React.useState(false)

  const photoSheet = useSheetState()
  const next = React.useCallback(() => router.replace('/(auth)/onboarding/expertise'), [router])

  const avatarUri = preview ?? (user?.profileImage ? assetUrl(user.profileImage) : null)

  /* ---- avatar ---- */

  const upload = async (asset: ImagePicker.ImagePickerAsset) => {
    setPreview(asset.uri)              // optimistic; rolled back on failure
    setUploading(true)
    try {
      /* Same tier the full editor uses — the avatar is the most-fetched image
         in the app and the crop box resizes nothing on its own. */
      const ready = await compressToTier(asset, 'DATA_SAVER')
      const raw = await api.users.uploadAvatar(toUploadFile(ready, 'avatar.jpg'))
      setUser(adapters.meFrom(raw))
      setPreview(null)
      fireHaptic('success')
    } catch (e: any) {
      setPreview(null)
      fireHaptic('error')
      toast.error(errorText(e))
    } finally {
      setUploading(false)
    }
  }

  const pick = async (from: 'camera' | 'library') => {
    const perm = from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { setPermissionDenied(true); return }
    setPermissionDenied(false)

    const res = from === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.9 })
    const asset = res.canceled ? null : res.assets?.[0]
    if (asset) await upload(asset)
  }

  const removePhoto = async () => {
    setUploading(true)
    try {
      const raw = await api.users.removeAvatar()
      setUser(adapters.meFrom(raw))
      setPreview(null)
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setUploading(false)
    }
  }

  /* ---- save ---- */

  const changed = () => {
    const body: Record<string, string> = {}
    if (displayName.trim() !== (user?.displayName || user?.full || '')) body.displayName = displayName.trim()
    if (bio !== (user?.bio || '')) body.profileBio = bio
    if (location.trim() !== (user?.location || '')) body.location = location.trim()
    if (selfDescriber.trim() !== (user?.selfDescriber || '')) body.selfDescriber = selfDescriber.trim()
    return body
  }

  const submit = async () => {
    if (saving) return
    const body = changed()
    if (!Object.keys(body).length) { next(); return }

    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      /* updateProfile maps its own response; only the upload endpoints hand
         back a raw UserResponse. */
      setUser(await api.users.updateProfile(body))
      next()
    } catch (e: any) {
      setSaving(false)
      /* Stay on the screen: navigating away on a failed write would lose the
         text the user just typed to fix nothing. */
      if (codeOf(e) === 'VALIDATION_FAILED') setErrors(fieldErrorMap(e) as Record<string, string>)
      else setFormError(e)
    }
  }

  return (
    <Screen>
      <OnboardingHeader onSkip={next} />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <Text variant="title1" align="ui">Set up your profile</Text>
          <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
            All optional — you can change any of it later.
          </Text>

          <View style={styles.avatarWell}>
            <View style={[styles.disc, { backgroundColor: t.colors.surfaceSunken }]}>
              <Touchable
                onPress={() => photoSheet.open()}
                onLongPress={avatarUri ? () => void removePhoto() : undefined}
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel="Change profile photo"
              >
                <View style={{ opacity: uploading ? 0.4 : 1 }}>
                  {avatarUri ? (
                    <Image
                      source={{ uri: avatarUri }}
                      style={[styles.avatarImg, { backgroundColor: t.colors.surface }]}
                      contentFit="cover"
                      transition={160}
                    />
                  ) : (
                    <Avatar name={user?.full} seed={user?.id} size={96} />
                  )}
                </View>
                {uploading ? (
                  <View style={styles.uploadOverlay}><Spinner /></View>
                ) : null}
                <View style={[styles.cameraFab, { backgroundColor: t.colors.accent, borderColor: t.colors.bg }]}>
                  <Icon name="camera" size={15} color={t.colors.textOnAccent} />
                </View>
              </Touchable>
            </View>
          </View>

          {permissionDenied ? (
            <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(200))}>
              <Callout
                tone="warning"
                icon="lock"
                actionLabel="Open Settings"
                onAction={() => { void Linking.openSettings() }}
                style={{ marginTop: space.xs }}
              >
                Hikmah Web does not have permission to use your photos or camera. Grant it in Settings and try again.
              </Callout>
            </Animated.View>
          ) : null}

          <View style={{ gap: space.md2, marginTop: 22 }}>
            <Field
              label="Display name"
              value={displayName}
              onChangeText={v => { setDisplayName(v); setErrors(e => ({ ...e, displayName: '' })) }}
              error={errors.displayName || null}
              hint="Shown on your profile and posts."
              maxLength={120}
              icon="person"
              editable={!saving}
            />
            <Field
              label="Bio"
              value={bio}
              onChangeText={v => { setBio(v); setErrors(e => ({ ...e, profileBio: '' })) }}
              error={errors.profileBio || null}
              placeholder="Tell people what you study or teach."
              multiline
              minHeight={104}
              editable={!saving}
              hint={bio.length >= 300 ? `${bio.length} characters` : undefined}
            />
            <Field
              label="Location"
              value={location}
              onChangeText={v => { setLocation(v); setErrors(e => ({ ...e, location: '' })) }}
              error={errors.location || null}
              placeholder="Erbil, Iraq"
              maxLength={200}
              icon="location"
              editable={!saving}
            />
            <Field
              label="Self describer"
              value={selfDescriber}
              onChangeText={v => { setSelfDescriber(v); setErrors(e => ({ ...e, selfDescriber: '' })) }}
              error={errors.selfDescriber || null}
              placeholder="Scholar | Author | Researcher"
              maxLength={200}
              icon="star"
              editable={!saving}
            />
          </View>

          {formError ? (
            <Callout tone="danger" style={{ marginTop: space.lg }}>{errorText(formError)}</Callout>
          ) : null}

          <Button
            label={saving ? 'Saving…' : 'Continue'}
            onPress={submit}
            variant="primary"
            size="lg"
            block
            loading={saving}
            style={{ marginTop: space.xxl }}
          />
          <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.sm2 }}>
            You can change all of this later in Settings.
          </Text>
        </View>
      </KeyboardAwareScrollView>

      <ActionSheet
        visible={photoSheet.visible}
        onClose={photoSheet.close}
        title="Profile photo"
        actions={[
          { label: 'Take photo', icon: 'camera', onPress: () => void pick('camera') },
          { label: 'Choose from library', icon: 'gallery', onPress: () => void pick('library') },
          {
            label: 'Remove photo',
            icon: 'trash',
            destructive: true,
            hidden: !user?.profileImage && !preview,
            onPress: () => void removePhoto(),
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xxl, paddingBottom: space.huge },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  avatarWell: { alignItems: 'center', marginTop: space.xxl },
  disc: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 96, height: 96, borderRadius: 48 },
  uploadOverlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  cameraFab: {
    position: 'absolute', bottom: 0, end: 0,
    width: 30, height: 30, borderRadius: 15, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
})
