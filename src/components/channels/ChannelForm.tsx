/* =========================================================
   The pieces /channels/new and /channels/[id]/edit share.

   Handle availability is a 404-means-free check: `byHandle`
   answers with the channel when the name is taken and throws a
   404 when nobody holds it, so `isNotFound(err)` is the success
   path and anything else is a real failure that must not be
   reported as "available".
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { api, isNotFound } from '@/api'
import { compressToTier } from '@/lib/mediaTier'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useDebounced } from '@/hooks/useAsync'
import {
  ActionSheet, Field, Icon, ListRow, RowGroup, Spinner, Text, Touchable, toast,
} from '@/ui'

export const CHANNEL_CATEGORIES = [
  'science', 'technology', 'religion', 'news', 'education',
  'business', 'health', 'arts', 'sports',
]

export const HANDLE_RE = /^[a-z0-9_]{3,32}$/

export type HandleStatus = 'idle' | 'invalid' | 'checking' | 'free' | 'taken' | 'unknown'

/** Debounced availability probe. `currentHandle` short-circuits the channel's
 *  own name so editing a title never reports "taken" against itself. */
export function useHandleCheck(handle: string, { enabled = true, currentHandle = '' } = {}) {
  const debounced = useDebounced(handle.trim().toLowerCase(), 600)
  const [status, setStatus] = React.useState<HandleStatus>('idle')

  React.useEffect(() => {
    if (!enabled || !debounced) { setStatus('idle'); return }
    if (debounced === currentHandle.toLowerCase()) { setStatus('free'); return }
    if (!HANDLE_RE.test(debounced)) { setStatus('invalid'); return }

    let alive = true
    setStatus('checking')
    api.channels.byHandle(debounced)
      .then(() => { if (alive) setStatus('taken') })
      .catch((e: any) => {
        if (!alive) return
        /* Only a 404 proves the name is free. A 503 or an offline fetch says
           nothing, and calling that "available" sets the user up for a 400. */
        setStatus(isNotFound(e) ? 'free' : 'unknown')
      })
    return () => { alive = false }
  }, [debounced, enabled, currentHandle])

  return status
}

export function HandleRow({
  value, onChange, status, disabled, error,
}: {
  value: string
  onChange: (v: string) => void
  status: HandleStatus
  disabled?: boolean
  error?: string | null
}) {
  const t = useTheme()
  const c = t.colors

  const hint =
    error ? null
      : status === 'invalid' ? '3–32 characters of a–z, 0–9 or _'
        : status === 'taken' ? 'That @handle is already taken.'
          : status === 'free' ? 'Available'
            : status === 'unknown' ? "Couldn't check that handle right now."
              : undefined

  const tone =
    status === 'free' ? c.successText
      : status === 'taken' || status === 'invalid' ? c.dangerText
        : c.textMuted

  return (
    <View style={{ opacity: disabled ? t.alpha.disabled : 1 }}>
      <Field
        label="Handle"
        value={value}
        onChangeText={v => onChange(v.replace(/^@/, '').toLowerCase())}
        editable={!disabled}
        icon="at"
        placeholder="ai_research"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={32}
        error={error || (status === 'taken' || status === 'invalid' ? hint : null)}
        action={
          status === 'checking'
            ? { icon: 'refresh', onPress: () => {}, label: 'Checking' }
            : status === 'free'
              ? { icon: 'checkCircle', onPress: () => {}, label: 'Available' }
              : null
        }
      />
      {!error && hint && status !== 'taken' && status !== 'invalid' ? (
        <Text variant="footnote" color={tone} align="ui" style={{ marginTop: space.xs2, paddingHorizontal: space.xxs }}>{hint}</Text>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Category
   --------------------------------------------------------- */

export function CategoryRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [custom, setCustom] = React.useState(false)
  return (
    <>
      <RowGroup>
        <ListRow
          title="Category"
          icon="tag"
          iconTone="accent"
          accessory={{ kind: 'value', text: value || 'None' }}
          onPress={() => setOpen(true)}
        />
        {custom ? (
          <View style={{ padding: space.md }}>
            <Field
              value={value}
              onChangeText={v => onChange(v.slice(0, 48))}
              placeholder="Something else"
              maxLength={48}
              autoFocus
            />
          </View>
        ) : null}
      </RowGroup>

      <ActionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Category"
        subtitle="Helps people find the channel in the directory"
        actions={[
          ...CHANNEL_CATEGORIES.map(slug => ({
            label: slug.charAt(0).toUpperCase() + slug.slice(1),
            subtitle: value === slug ? 'Current' : undefined,
            onPress: () => { setCustom(false); onChange(slug) },
          })),
          { label: 'Other…', icon: 'edit' as const, onPress: () => { setCustom(true); onChange('') } },
        ]}
      />
    </>
  )
}

/* ---------------------------------------------------------
   Photo + cover pickers
   --------------------------------------------------------- */

export interface PickedAsset { uri: string; fileName?: string | null; mimeType?: string | null }

async function pick(aspect: [number, number]) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) { toast.warn('Photo access is off — enable it in Settings.'); return null }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    aspect,
    quality: 0.9,
  })
  if (res.canceled || !res.assets?.length) return null
  /* `quality` re-encodes without resizing and the crop box does not resize
     either, so a camera original arrives here at full sensor size. A channel
     avatar/cover is a list-row image on every screen that mentions the
     channel — DATA_SAVER's 1080 cap is still far more than any of them show. */
  const ready = await compressToTier(res.assets[0], 'DATA_SAVER')
  return ready as unknown as PickedAsset
}

export function AvatarPicker({
  uri, onPick, onClear, busy, size = 104,
}: { uri?: string | null; onPick: (a: PickedAsset) => void; onClear?: () => void; busy?: boolean; size?: number }) {
  const t = useTheme()
  const c = t.colors
  return (
    <View style={{ alignItems: 'center', gap: space.xs2 }}>
      <Touchable
        onPress={async () => { const a = await pick([1, 1]); if (a) onPick(a) }}
        disabled={busy}
        feedback="scale"
        accessibilityLabel="Choose a channel photo"
        noAutoHitSlop
        style={[
          styles.avatarBox,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: uri ? 'transparent' : c.borderStrong,
            borderStyle: uri ? 'solid' : 'dashed',
            backgroundColor: c.surfaceSunken,
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} />
        ) : (
          <Icon name="camera" size={26} color={c.textFaint} />
        )}
        {busy ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.overlayBg }]}>
            <Spinner />
          </View>
        ) : null}
      </Touchable>
      {uri && onClear ? (
        <Touchable onPress={onClear} feedback="dim">
          <Text variant="footnote" tone="danger" align="center">Remove photo</Text>
        </Touchable>
      ) : (
        <Text variant="footnote" tone="muted" align="center">Add a channel photo</Text>
      )}
    </View>
  )
}

export function CoverPicker({
  uri, onPick, onClear, busy,
}: { uri?: string | null; onPick: (a: PickedAsset) => void; onClear?: () => void; busy?: boolean }) {
  const t = useTheme()
  const c = t.colors
  return (
    <View style={{ gap: space.xs2 }}>
      <Touchable
        onPress={async () => { const a = await pick([16, 9]); if (a) onPick(a) }}
        disabled={busy}
        feedback="scale"
        accessibilityLabel="Choose a cover image"
        noAutoHitSlop
        style={[
          styles.coverBox,
          {
            borderRadius: t.radius.md,
            borderColor: uri ? 'transparent' : c.borderStrong,
            borderStyle: uri ? 'solid' : 'dashed',
            backgroundColor: c.surfaceSunken,
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} />
        ) : (
          <>
            <Icon name="image" size={22} color={c.textFaint} />
            <Text variant="footnote" tone="muted" align="center">Add a cover</Text>
          </>
        )}
        {busy ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.overlayBg }]}>
            <Spinner />
          </View>
        ) : null}
      </Touchable>
      {uri && onClear ? (
        <Touchable onPress={onClear} feedback="dim" style={{ alignSelf: 'center' }}>
          <Text variant="footnote" tone="danger" align="center">Remove cover</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  avatarBox: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
    overflow: 'hidden',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
})
