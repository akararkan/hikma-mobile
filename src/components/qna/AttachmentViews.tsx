/* =========================================================
   Attachment rendering: a tile for the visual types, a row for
   everything else.

   A broken thumbnail is a placeholder, never an error state —
   MEDIA_NOT_FOUND on one derivative must not take down a page
   whose text is perfectly fine.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, IconButton, Text, Touchable, type IconName } from '@/ui'
import { formatBytes, formatDuration, type AttachmentView, type MediaKind } from './types'

export function isVisual(a: { mediaType: MediaKind }) {
  return a.mediaType === 'IMAGE' || a.mediaType === 'VIDEO'
}

const MIME_GLYPH: Record<MediaKind, IconName> = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'music',
  DOCUMENT: 'file',
  SPREADSHEET: 'stats',
  ARCHIVE: 'storage',
  OTHER: 'attachment',
}

function mimeSkin(t: ReturnType<typeof useTheme>, kind: MediaKind) {
  const c = t.colors
  switch (kind) {
    case 'DOCUMENT': return { fg: c.danger, bg: c.dangerSoft }
    case 'SPREADSHEET': return { fg: c.success, bg: c.successSoft }
    case 'ARCHIVE': return { fg: c.scholar, bg: c.scholarSoft }
    case 'AUDIO': return { fg: c.warning, bg: c.warningSoft }
    case 'IMAGE':
    case 'VIDEO': return { fg: c.accent, bg: c.accentSoft }
    default: return { fg: c.textMuted, bg: c.surfaceSunken }
  }
}

function extensionOf(name: string): string {
  const ext = String(name).split('.').pop() || ''
  return ext.length && ext.length <= 4 ? ext.toUpperCase() : 'FILE'
}

export function AttachmentTile({
  attachment, index, editable, uploadProgress, onPress, onOverflow, size,
}: {
  attachment: AttachmentView
  index?: number
  editable?: boolean
  uploadProgress?: number | null
  onPress?: () => void
  onOverflow?: () => void
  size?: number
}) {
  const t = useTheme()
  const c = t.colors
  const [broken, setBroken] = React.useState(false)
  const src = attachment.thumbnailUrl || attachment.url

  /* A recycled tile keeps its mounted instance, so a `broken` flag from the
     PREVIOUS attachment would stick to the next one. Reset in the render
     phase when the source moves. */
  const [seenSrc, setSeenSrc] = React.useState(src)
  if (seenSrc !== src) { setSeenSrc(src); setBroken(false) }

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onOverflow}
      feedback="scale"
      noAutoHitSlop
      style={[
        styles.tile,
        size ? { width: size, height: size } : null,
        { borderRadius: 10, backgroundColor: c.surfaceSunken },
      ]}
      accessibilityLabel={attachment.name}
    >
      {src && !broken ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={140}
          cachePolicy="memory-disk"
          recyclingKey={src}
          onError={() => setBroken(true)}
        />
      ) : (
        <View style={styles.center}>
          <Icon name={broken ? 'error' : MIME_GLYPH[attachment.mediaType]} size={22} color={c.textFaint} />
        </View>
      )}

      {attachment.mediaType === 'VIDEO' ? (
        <View style={[styles.playBadge, { backgroundColor: c.overlayChip }]}>
          <Icon name="play" size={12} color={c.overlayText} filled />
        </View>
      ) : null}

      {attachment.duration ? (
        <View style={[styles.durationPill, { backgroundColor: c.overlayChip }]}>
          <Text variant="micro" color={c.overlayText}>{formatDuration(attachment.duration)}</Text>
        </View>
      ) : null}

      {index != null ? (
        <View style={[styles.ordinalPill, { backgroundColor: c.overlayChip }]}>
          <Text variant="micro" color={c.overlayText}>{index + 1}</Text>
        </View>
      ) : null}

      {editable && onOverflow ? (
        <View style={styles.tileOverflow}>
          <IconButton
            name="more"
            onPress={onOverflow}
            size={15}
            surface="overlay"
            color={c.overlayText}
            accessibilityLabel="File options"
          />
        </View>
      ) : null}

      {uploadProgress != null ? (
        <View style={[styles.progressTrack, { backgroundColor: c.overlayChip }]}>
          <View style={{ width: `${Math.round(uploadProgress * 100)}%`, height: '100%', backgroundColor: c.accent }} />
        </View>
      ) : null}
    </Touchable>
  )
}

export function AttachmentRow({
  attachment, index, editable, uploadProgress, uploadError, onPress, onOverflow, onRetry, onRemove,
}: {
  attachment: AttachmentView
  index?: number
  editable?: boolean
  uploadProgress?: number | null
  uploadError?: boolean
  onPress?: () => void
  onOverflow?: () => void
  onRetry?: () => void
  onRemove?: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const skin = mimeSkin(t, attachment.mediaType)

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onOverflow}
      feedback="tint"
      noAutoHitSlop
      style={[styles.fileRow, { paddingHorizontal: t.layout.screenPadding }]}
    >
      {index != null ? <Text variant="caption" tone="faint" style={styles.ordinal}>{index + 1}.</Text> : null}

      <View style={[styles.mimeBadge, { backgroundColor: skin.bg }]}>
        <Icon name={MIME_GLYPH[attachment.mediaType]} size={18} color={skin.fg} />
        <Text variant="micro" color={skin.fg} align="center" style={{ marginTop: space.xxs }}>{extensionOf(attachment.name)}</Text>
      </View>

      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={1} align="auto">{attachment.name}</Text>
        <Text variant="footnote" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
          {attachment.mediaType.charAt(0) + attachment.mediaType.slice(1).toLowerCase()} · {formatBytes(attachment.size)}
          {attachment.duration ? ` · ${formatDuration(attachment.duration)}` : ''}
        </Text>
        {attachment.caption ? (
          <Text variant="footnote" tone="faint" italic numberOfLines={2} align="auto" style={{ marginTop: space.xxs }}>
            {attachment.caption}
          </Text>
        ) : null}
        {uploadProgress != null ? (
          <View style={[styles.inlineTrack, { backgroundColor: c.surfaceSunken }]}>
            <View style={{ width: `${Math.round(uploadProgress * 100)}%`, height: '100%', backgroundColor: c.accent, borderRadius: 2 }} />
          </View>
        ) : null}
        {uploadError ? (
          <View style={[styles.row, { gap: space.md, marginTop: space.xs2 }]}>
            <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>Upload failed</Text>
            {onRetry ? (
              <Touchable onPress={onRetry} feedback="dim"><Text variant="footnote" tone="accent">Retry</Text></Touchable>
            ) : null}
            {onRemove ? (
              <Touchable onPress={onRemove} feedback="dim"><Text variant="footnote" tone="muted">Remove</Text></Touchable>
            ) : null}
          </View>
        ) : null}
      </View>

      {editable && onOverflow ? (
        <IconButton name="more" onPress={onOverflow} size={18} color={c.textFaint} accessibilityLabel="File options" />
      ) : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 96, height: 96, overflow: 'hidden' },
  /* Icon-only round badge — sanctioned circle; logical start/marginStart so
     the centring survives RTL. */
  playBadge: {
    position: 'absolute', top: '50%', start: '50%',
    marginTop: -space.md2, marginStart: -space.md2,
    width: 26, height: 26, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  durationPill: { position: 'absolute', bottom: 5, right: 5, paddingHorizontal: space.xs2, paddingVertical: space.xxs, borderRadius: 5 },
  ordinalPill: { position: 'absolute', top: 5, left: 5, minWidth: 17, paddingHorizontal: space.xs, paddingVertical: space.xxs, borderRadius: 5, alignItems: 'center' },
  tileOverflow: { position: 'absolute', top: 0, right: 0 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  inlineTrack: { height: 3, borderRadius: 2, marginTop: space.sm, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 72 },
  mimeBadge: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ordinal: { width: 18 },
})
