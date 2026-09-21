/* =========================================================
   RemoteImage — expo-image with the dead-media contract built in
   (backend docs/moderation/image-moderation-frontend.md).

   A review-band image a moderator later rejects is DELETED server-side:
   the post/story/message row survives and its media URL simply starts
   failing. Cached and optimistic URLs can therefore die at ANY time, on
   every surface, and each render site owes the same three behaviors:

     - onError → a quiet placeholder (a faint glyph, optionally one line
       of copy on full-screen surfaces) — never a stuck blurhash, a black
       frame, or a broken-image state;
     - no retry loop — the URL is dead and re-fetching cannot revive it
       (expo-image gives onError no retry handle, keep it that way);
     - recycling safety — failure is keyed to the SOURCE, not the mounted
       cell, so a recycled FlashList row never inherits a previous item's
       broken state (the ResearchCover idiom: render-phase reset).

   This component is those three behaviors packaged once. Everything else
   (contentFit, placeholder/blurhash, transition, cachePolicy, …) passes
   straight through to expo-image.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image, type ImageProps } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, type IconName } from '@/ui'

export interface RemoteImageProps extends Omit<ImageProps, 'source'> {
  /** The remote URI (or `{ uri }`). null/undefined renders the fallback. */
  source?: string | { uri?: string | null } | null
  /** What a dead URL renders:
      'glyph'   centered faint icon on a sunken ground — in-app surfaces
                (grids, bubbles, cards). The default.
      'overlay' icon + optional label in overlay ink on a transparent
                ground — full-screen viewers and story frames that are
                already on a dark ramp.
      'hidden'  nothing at all — decorative layers (sticker overlays,
                unfurl thumbnails) where absence IS the quiet state. */
  fallback?: 'glyph' | 'overlay' | 'hidden'
  fallbackIcon?: IconName
  fallbackIconSize?: number
  /** One quiet line under the glyph. Full-screen surfaces only — a grid
   *  tile has no room for prose. */
  fallbackLabel?: string
}

function uriOf(source: RemoteImageProps['source']): string | null {
  if (!source) return null
  return typeof source === 'string' ? source : source.uri || null
}

export function RemoteImage({
  source,
  fallback = 'glyph',
  fallbackIcon = 'image',
  fallbackIconSize = 22,
  fallbackLabel,
  style,
  onError,
  recyclingKey,
  ...rest
}: RemoteImageProps) {
  const t = useTheme()
  const c = t.colors
  const uri = uriOf(source)

  /* Source-keyed failure with a render-phase reset: an effect would paint
     the wrong state for one frame on a recycled row. */
  const [failed, setFailed] = React.useState<string | null>(null)
  const [seenUri, setSeenUri] = React.useState(uri)
  if (seenUri !== uri) { setSeenUri(uri); setFailed(null) }
  const dead = !uri || (failed !== null && failed === uri)

  if (!dead) {
    return (
      <Image
        {...rest}
        source={{ uri: uri as string }}
        style={style}
        recyclingKey={recyclingKey ?? uri ?? undefined}
        onError={e => { setFailed(uri); onError?.(e) }}
      />
    )
  }

  if (fallback === 'hidden') return null

  const overlay = fallback === 'overlay'
  return (
    <View
      style={[
        style as StyleProp<ViewStyle>,
        styles.center,
        overlay ? null : { backgroundColor: c.surfaceSunken },
      ]}
    >
      <Icon
        name={fallbackIcon}
        size={fallbackIconSize}
        color={overlay ? c.overlayTextMuted : c.textFaint}
      />
      {fallbackLabel ? (
        <Text
          variant="caption"
          color={overlay ? c.overlayTextMuted : c.textFaint}
          align="center"
          style={styles.label}
        >
          {fallbackLabel}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: space.sm },
})
