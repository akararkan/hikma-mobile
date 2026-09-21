/* =========================================================
   Edit group info.

   `conversations.update` treats a null field as "leave this
   alone", so only the fields that actually changed are sent —
   posting the whole form back would re-announce a title change
   in the chat every time someone fixed a typo in the
   description.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { api, codeOf, errorText, fieldErrorMap } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { isModerationError } from '@/lib/moderation'
import { ModerationRefusalNotice } from '@/components/moderation'
import { prepareUpload } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { useAsync } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, Field, Header, Icon, Screen, SkeletonList,
  Text, Touchable, toast, useSheetState,
} from '@/ui'

export default function EditGroupScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const convoQ = useAsync<any>(() => api.chat.conversations.get(convId), { deps: [convId] })
  const discard = useSheetState()

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [photo, setPhoto] = React.useState<any>(null)
  const [removePhoto, setRemovePhoto] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [denied, setDenied] = React.useState<string | null>(null)
  const [modError, setModError] = React.useState<any>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const seeded = React.useRef(false)

  React.useEffect(() => {
    const convo = convoQ.data
    if (!convo || seeded.current) return
    seeded.current = true
    setTitle(convo.title || '')
    setDescription(convo.description || '')
    /* This endpoint is group-only; on a DM the server answers 400 and the
       screen has no business existing. */
    if (!convo.isGroup) router.back()
  }, [convoQ.data, router])

  const convo = convoQ.data
  const dirty = !!convo && (
    title !== (convo.title || '')
    || description !== (convo.description || '')
    || !!photo
    || removePhoto
  )

  /* Hardware back runs the same guard as the header's back chevron. */
  useDiscardGuard(dirty, discard.open)

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1,
    })
    if (res.canceled || !res.assets?.length) return
    setRemovePhoto(false)
    setPhoto(await prepareUpload(res.assets[0] as any))
  }

  const save = async () => {
    setModError(null)
    if (!dirty || saving || !convo) return
    setSaving(true)
    setFieldErrors({})
    try {
      const body: any = {}
      if (title !== (convo.title || '')) body.title = title.trim()
      if (description !== (convo.description || '')) body.description = description.trim()

      if (photo) {
        try {
          const uploaded: any = await api.media.upload(toUploadFile(photo), { type: 'IMAGE' })
          /* NOTE: MediaStatusResponse documents `mediaId`; `storageKey` is read
             first for deploys that return one. */
          body.avatarKey = uploaded?.storageKey || uploaded?.key || uploaded?.mediaId
        } catch {
          toast.warn('Photo could not be uploaded — your text changes were saved.')
        }
      } else if (removePhoto) {
        body.avatarKey = ''
      }

      await api.chat.conversations.update(convId, body)
      router.back()
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'ADMINS_ONLY') {
        setDenied(errorText(e, 'You cannot edit this group’s info.'))
      } else if (isModerationError(e)) {
        /* A refused or held name/description keeps the DRAFT and says why, in
           the server's own words. This has to be tested BEFORE the 400 arm
           below, which used to swallow both moderation codes and silently
           navigate away — the user's edit vanished with no explanation. */
        setModError(e)
      } else if (e?.status === 400 && code !== 'VALIDATION_FAILED' && code !== 'ILLEGAL_ARGUMENT') {
        /* "This action applies only to group conversations." — the screen was
           opened on a DM, so leaving is the only sane response. */
        router.back()
      } else {
        const map = fieldErrorMap(e) as Record<string, string>
        if (Object.keys(map).length) setFieldErrors(map)
        else toast.error(chatError(e, 'Could not save these changes'))
      }
      setSaving(false)
    }
  }

  if (convoQ.loading && !convo) {
    return (
      <Screen>
        <Header back title="Edit info" />
        <SkeletonList count={4} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        title="Edit info"
        back={() => { if (dirty) discard.open(); else router.back() }}
        closeButton
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: 'accent' }]}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        {denied ? <Callout tone="danger">{denied}</Callout> : null}

        {/* Verbatim server sentence, the draft left alone, and a retry that
            only appears for a HELD change (a rejected one would fail the same
            way). */}
        <ModerationRefusalNotice
          error={modError}
          onRetry={() => { setModError(null); void save() }}
          onDismiss={() => setModError(null)}
        />

        <View style={styles.avatarBlock}>
          <Touchable onPress={pickPhoto} feedback="scale" accessibilityLabel="Change group photo" disabled={!!denied}>
            <Avatar
              uri={removePhoto ? null : (photo?.uri ?? convo?.avatarUrl)}
              name={title || convo?.displayTitle}
              seed={convId}
              size={96}
              square
            />
            <View style={[styles.cameraBadge, { backgroundColor: c.accent, borderColor: c.bg }]}>
              <Icon name="camera" size={14} color={c.textOnAccent} filled />
            </View>
          </Touchable>
          {(convo?.avatarUrl || photo) && !removePhoto ? (
            <Touchable
              onPress={() => { setPhoto(null); setRemovePhoto(true) }}
              feedback="dim"
              noAutoHitSlop
              style={styles.removeBtn}
            >
              <Text variant="footnote" tone="danger" align="center">Remove photo</Text>
            </Touchable>
          ) : null}
        </View>

        <Field
          label="Group name"
          value={title}
          onChangeText={v => { setTitle(v); setFieldErrors(f => ({ ...f, title: '' })) }}
          error={fieldErrors.title || null}
          maxLength={120}
          required
          editable={!saving && !denied}
        />

        <Field
          label="Description"
          value={description}
          onChangeText={v => { setDescription(v); setFieldErrors(f => ({ ...f, description: '' })) }}
          error={fieldErrors.description || null}
          placeholder="Add a description so people know what this group is about"
          maxLength={500}
          multiline
          minHeight={120}
          editable={!saving && !denied}
        />

        <Text variant="footnote" tone="muted" align="ui">Changes are announced in the chat.</Text>

        <Button
          label="Save changes"
          onPress={save}
          loading={saving}
          disabled={!dirty || saving || !!denied || !title.trim()}
          size="lg"
          block
        />
      </KeyboardAwareScrollView>

      <ConfirmSheet
        visible={discard.visible}
        onClose={discard.close}
        title="Discard changes?"
        message="Your edits will not be saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { discard.close(); router.back() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  form: { padding: space.lg, gap: space.lg, paddingBottom: space.huge },
  avatarBlock: { alignItems: 'center', gap: space.sm },
  cameraBadge: {
    position: 'absolute', end: -2, bottom: -2,
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: { paddingVertical: space.xs },
})
