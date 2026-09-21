/* =========================================================
   The attachment block: 1–10 items in one of three layouts.

   `mediaFrom` has already run every URL through `assetUrl` and
   folded AUDIO (and audio-mime FILE rows) onto kind 'VOICE', so
   nothing here re-prefixes a URL or re-sniffs a mime. A single
   item keeps its own proportions from width/height; anything
   more goes into a grid, because a column of nine full-width
   photos is a scroll, not a post.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { RemoteImage } from '@/components/media/RemoteImage'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { chatVoice, useChatVoiceFor } from '@/components/chat/chatVoicePlayer'

export interface MediaAlbumProps {
  media: any[]
  /** Hides the affordances that `settings.protectedContent` forbids. */
  protectedContent?: boolean
  onOpen?: (index: number) => void
  /** Cap the block's height — the pinned list and the stats rows want this. */
  maxHeight?: number
}

const GAP = 2

export function MediaAlbum({ media, protectedContent, onOpen, maxHeight }: MediaAlbumProps) {
  const t = useTheme()
  const { width: screenW } = useWindowDimensions()
  const items = (media || []).filter(Boolean)
  if (!items.length) return null

  const width = screenW - t.layout.screenPadding * 2
  const docs = items.filter(m => m.kind === 'FILE' || m.kind === 'VOICE')
  const visuals = items.filter(m => m.kind !== 'FILE' && m.kind !== 'VOICE')

  return (
    <View style={{ gap: space.sm }}>
      {visuals.length ? (
        <Grid items={visuals} width={width} maxHeight={maxHeight} onOpen={onOpen} />
      ) : null}
      {docs.map((m, i) => (
        m.kind === 'VOICE'
          ? <VoiceStrip key={m.storageKey || i} media={m} />
          : <FileChip key={m.storageKey || i} media={m} downloadable={!protectedContent} />
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   Layouts
   --------------------------------------------------------- */

function Grid({
  items, width, maxHeight, onOpen,
}: { items: any[]; width: number; maxHeight?: number; onOpen?: (i: number) => void }) {
  const t = useTheme()
  const radius = t.radius.md

  if (items.length === 1) {
    const m = items[0]
    const ratio = m.width && m.height ? m.width / m.height : 4 / 3
    /* Clamp the tall end: a 9:16 screenshot posted full-bleed pushes the
       reaction bar a screen and a half below the fold. */
    const h = Math.min(maxHeight ?? width * 1.25, width / Math.max(0.62, ratio))
    return (
      <Cell media={m} width={width} height={h} radius={radius} onPress={() => onOpen?.(0)} />
    )
  }

  if (items.length === 2 || items.length === 4) {
    const cell = (width - GAP) / 2
    return (
      <View style={styles.wrap}>
        {items.slice(0, 4).map((m, i) => (
          <Cell key={m.storageKey || i} media={m} width={cell} height={cell} radius={radius} onPress={() => onOpen?.(i)} />
        ))}
      </View>
    )
  }

  const cell = (width - GAP * 2) / 3
  const shown = items.slice(0, 9)
  const overflow = items.length - shown.length
  return (
    <View style={styles.wrap}>
      {shown.map((m, i) => (
        <Cell
          key={m.storageKey || i}
          media={m}
          width={cell}
          height={cell}
          radius={t.radius.sm}
          overflow={i === shown.length - 1 && overflow > 0 ? overflow : 0}
          onPress={() => onOpen?.(i)}
        />
      ))}
    </View>
  )
}

function Cell({
  media, width, height, radius, overflow = 0, onPress,
}: { media: any; width: number; height: number; radius: number; overflow?: number; onPress?: () => void }) {
  const t = useTheme()
  const c = t.colors
  const src = media.thumbnailUrl || media.url
  const round = media.kind === 'VIDEO_NOTE'

  return (
    <Touchable
      onPress={onPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={media.altText || 'Attachment'}
      style={{
        width,
        height,
        borderRadius: round ? width / 2 : radius,
        overflow: 'hidden',
        backgroundColor: c.surfaceSunken,
      }}
    >
      {/* MEDIA_NOT_FOUND is a per-asset answer — it must never become the
          screen's error state. RemoteImage keys the failure to the source,
          fixing the recycled-cell bug the old cell-local `broken` had. */}
      <RemoteImage
        source={src}
        fallbackIcon="image"
        fallbackIconSize={22}
        placeholder={media.blurhash ? { blurhash: media.blurhash } : undefined}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={src}
      />

      {media.kind === 'VIDEO' || media.kind === 'VIDEO_NOTE' ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={[styles.playDisc, { backgroundColor: c.overlayChip }]}>
            <Icon name="play" size={18} color={c.overlayText} filled />
          </View>
        </View>
      ) : null}

      {media.kind === 'GIF' ? <Tag label="GIF" /> : null}
      {media.durationMs ? <Tag label={clock(media.durationMs)} /> : null}

      {overflow > 0 ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.overlayBg }]}>
          <Text variant="title2" color={c.overlayText} align="center">+{overflow}</Text>
        </View>
      ) : null}
    </Touchable>
  )
}

function Tag({ label }: { label: string }) {
  const t = useTheme()
  return (
    <View style={[styles.tag, { backgroundColor: t.colors.overlayChip }]}>
      <Text variant="micro" color={t.colors.overlayText}>{label}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Non-visual kinds
   --------------------------------------------------------- */

/** A voice note — a dumb transport over the ONE app-level player
 *  (ChatVoiceHost in the signed-in layout, see chat/chatVoicePlayer.tsx),
 *  keyed by the asset so a strip and a chat bubble can never play over each
 *  other. `waveform` is often absent (the backend does not yet store the part
 *  the sender uploads), so an id-seeded synthetic shape stands in — wrong in
 *  detail, right in feel, and stable across renders. */
function VoiceStrip({ media }: { media: any }) {
  const t = useTheme()
  const c = t.colors
  const id = String(media.storageKey || media.url || '')
  /* Row-scoped: strips off the playing note skip the clock ticks entirely. */
  const live = useChatVoiceFor(id)
  const mine = live.id === id
  const playing = mine && live.playing
  const totalSec = (mine && live.duration) || (media.durationMs || 0) / 1000
  const progress = mine && totalSec > 0 ? Math.min(1, live.position / totalSec) : 0
  const bars = React.useMemo(() => waveformOf(media), [media])
  return (
    <Touchable
      onPress={() => chatVoice.toggle(id, media.url, media.durationMs)}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
      style={[styles.docRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.md }]}
    >
      <View style={[styles.playDisc, { backgroundColor: c.accent, width: 36, height: 36, borderRadius: 18 }]}>
        <Icon name={playing ? 'pause' : 'play'} size={16} color={c.textOnAccent} filled />
      </View>
      <View style={[styles.flex, styles.wave]}>
        {bars.map((v, i) => (
          <View
            key={i}
            style={{
              width: 2.5, height: 4 + v * 22, borderRadius: 2,
              /* Played bars take the accent — the chat bubble's progress
                 grammar without its scrubber chrome. */
              backgroundColor: progress > 0 && i / bars.length <= progress ? c.accent : c.borderStrong,
            }}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {mine ? `${clock(live.position * 1000)} / ${clock(totalSec * 1000)}` : clock(media.durationMs || 0)}
      </Text>
    </Touchable>
  )
}

function FileChip({ media, downloadable }: { media: any; downloadable?: boolean }) {
  const t = useTheme()
  const c = t.colors
  const ext = String(media.fileName || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'
  return (
    <View style={[styles.docRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.md }]}>
      <View style={[styles.extTile, { backgroundColor: c.accentSoft }]}>
        <Text variant="micro" tone="accent" align="center">{ext}</Text>
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" numberOfLines={1} align="auto">{media.fileName || 'Attachment'}</Text>
        <Text variant="caption" tone="muted" align="ui">{bytes(media.bytes)}</Text>
      </View>
      {downloadable ? <Icon name="download" size={17} color={c.textMuted} /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Formatting
   --------------------------------------------------------- */

export function clock(ms: number): string {
  const total = Math.max(0, Math.round((ms || 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function bytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function waveformOf(media: any): number[] {
  const raw = media?.waveform
  if (typeof raw === 'string' && raw.length) {
    return raw.split(/[,\s]+/).filter(Boolean).slice(0, 40).map(v => Math.min(1, Math.max(0, Number(v) / 100)))
  }
  if (Array.isArray(raw) && raw.length) {
    const max = Math.max(...raw.map(Number), 1)
    return raw.slice(0, 40).map((v: number) => Math.min(1, Number(v) / max))
  }
  let h = 0
  const seed = String(media?.storageKey || media?.url || 'voice')
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return Array.from({ length: 34 }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    return 0.25 + ((h >>> 16) % 100) / 133 + Math.sin(i / 3) * 0.05
  })
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  center: { alignItems: 'center', justifyContent: 'center' },
  playDisc: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', start: 6, bottom: 6, paddingHorizontal: space.xs2, paddingVertical: space.xxs, borderRadius: 5 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, padding: space.sm2 },
  extTile: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, height: 28 },
  flex: { flex: 1 },
})
