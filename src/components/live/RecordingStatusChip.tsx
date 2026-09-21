/* =========================================================
   RecordingStatusChip — seven states, one vocabulary.

   The API's seven `recordingStatus` values are engineering
   words. A host wants to know one of a few different things:
   is it running, is it paused, is the file being prepared, can
   I download it, was anything captured, did I turn it off, did
   I already delete it. The mapping lives
   here so /live/mine, /live/[id]/manage and the recording
   manifest can never phrase the same state three ways.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, type IconName } from '@/ui'
import { ROOM } from './skin'
import type { RecordingStatus } from './types'

/* Tones resolve through the ACTIVE palette, not the pinned-dark ROOM skin:
   every surface this chip mounts on (/live/mine rows, the settings hero, the
   recording manifest) is ordinary paper, where ROOM's white-alpha fill and
   night inks were nearly invisible in light mode. The washes are the web's
   `.lv-rec-chip` grammar — recording on the live-red wash, ready on the
   scholar (old gold) wash, the dormant states on the sunken neutral. */
type ChipTone = 'live' | 'warning' | 'scholar' | 'neutral'

interface Skin { label: string; sentence: string; tone: ChipTone; icon: IconName; pulse?: boolean }

const MAP: Record<RecordingStatus, Skin> = {
  RECORDING: { label: 'REC', sentence: 'Recording now', tone: 'live', icon: 'reels', pulse: true },
  /* Wire states the streaming doc omits (backend RecordingStatus.java):
     PAUSED = the host stopped a take mid-broadcast; PROCESSING = the stream
     ended and its takes are being joined into one file. */
  PAUSED: { label: 'Paused', sentence: 'Recording paused', tone: 'warning', icon: 'pause' },
  PROCESSING: { label: 'Processing', sentence: 'Joining your takes', tone: 'warning', icon: 'hourglass' },
  AVAILABLE: { label: 'Ready', sentence: 'Ready to download', tone: 'scholar', icon: 'download' },
  EMPTY: { label: 'Empty', sentence: 'Nothing was captured', tone: 'neutral', icon: 'file' },
  DISABLED: { label: 'Off', sentence: 'Not recorded', tone: 'neutral', icon: 'eyeOff' },
  DELETED: { label: 'Deleted', sentence: 'Deleted', tone: 'neutral', icon: 'trash' },
}

export function recordingSentence(status: RecordingStatus | null | undefined): string {
  return status ? (MAP[status]?.sentence ?? 'Not recorded') : 'Not recorded'
}

/** React.memo'd: it rides in the /live/mine row, whose list re-renders on
 *  every `stream.ended` frame, and both props are scalars. */
export const RecordingStatusChip = React.memo(function RecordingStatusChip({
  status, size = 'md',
}: { status: RecordingStatus | null | undefined; size?: 'sm' | 'md' }) {
  const t = useTheme()
  const c = t.colors
  const skin = status ? MAP[status] : null
  if (!skin) return null

  const { bg, ink } =
    skin.tone === 'live' ? { bg: c.dangerSoft, ink: c.danger }
      : skin.tone === 'warning' ? { bg: c.warningSoft, ink: c.warningText }
        : skin.tone === 'scholar' ? { bg: c.scholarSoft, ink: c.scholarText }
          : { bg: c.surfaceSunken, ink: c.textMuted }

  return (
    /* 8pt corners — the web chip is a pill, but chips here are setback
       rectangles by law (§3: pills are the unread Badge and the LIVE tag). */
    <View
      style={[
        styles.chip,
        {
          height: size === 'sm' ? 20 : 24,
          paddingHorizontal: size === 'sm' ? 7 : 9,
          borderRadius: t.radius.xs,
          backgroundColor: bg,
        },
      ]}
    >
      {skin.pulse ? <PulseDot color={ink} /> : <Icon name={skin.icon} size={size === 'sm' ? 10 : 12} color={ink} />}
      <Text variant="micro" color={ink} weight="700">{skin.label}</Text>
    </View>
  )
})

/** The one dot that has to read as "live" from across a room. */
export function PulseDot({ color, size = 8 }: { color?: string; size?: number }) {
  const t = useTheme()
  const p = useSharedValue(1)
  const tint = color ?? ROOM.live

  React.useEffect(() => {
    if (t.prefs.reducedMotion) { p.value = 1; return }
    p.value = withRepeat(withTiming(0.35, { duration: 760, easing: Easing.inOut(Easing.quad) }), -1, true)
    return () => cancelAnimation(p)
  }, [p, t.prefs.reducedMotion])

  const anim = useAnimatedStyle(() => ({ opacity: p.value }))
  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint }, anim]}
    />
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, alignSelf: 'flex-start' },
})
