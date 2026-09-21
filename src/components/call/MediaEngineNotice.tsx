/* =========================================================
   MediaEngineNotice — the one honest strip.

   Every disabled media control in this domain points here, and
   every variant links to /call/media-support, so the full
   explanation exists in exactly one place and can never drift
   into four half-truths.

   The copy names the missing thing rather than apologising:
   a tester who reads "signalling only" knows what to expect
   from the build; "something went wrong" teaches nobody.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Icon, Text, Touchable } from '@/ui'
import { ROOM } from '@/components/live/skin'
import { space } from '@/theme/tokens'

export type NoticeVariant = 'call' | 'ring' | 'golive' | 'guest' | 'inline'

const COPY: Record<NoticeVariant, string> = {
  call: 'Voice and video need a build with react-native-webrtc — this call is signalling only.',
  ring: "Audio isn't available in this build",
  golive: 'Publishing from the phone camera needs the media engine. Use an external encoder.',
  guest: 'Camera needs the media engine',
  inline: 'The media engine is not installed in this build',
}

export function MediaEngineNotice({
  variant = 'inline', onPress, compact,
}: { variant?: NoticeVariant; onPress?: () => void; compact?: boolean }) {
  const router = useRouter()
  const open = onPress ?? (() => router.push('/call/media-support'))

  if (variant === 'guest') {
    return (
      <View style={styles.chip}>
        <Icon name="videoOff" size={11} color={ROOM.fgFaint} />
        <Text variant="micro" color={ROOM.fgFaint} align="center" numberOfLines={2} weight="600">
          {COPY.guest}
        </Text>
      </View>
    )
  }

  return (
    <Touchable
      onPress={open}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel="Why audio and video are unavailable"
      style={[
        styles.strip,
        { backgroundColor: ROOM.warningSoft, paddingVertical: compact ? 8 : 11 },
      ]}
    >
      <Icon name="warning" size={14} color={ROOM.warning} />
      <Text variant="footnote" color={ROOM.warning} align="ui" style={styles.flex} numberOfLines={2}>
        {COPY[variant]}
      </Text>
      <Text variant="footnote" color={ROOM.warning} weight="700" align="ui">Details</Text>
      <Icon name="forward" size={12} color={ROOM.warning} />
    </Touchable>
  )
}

/** The 40% + lock treatment every dead media control wears. Used by the dock
 *  and by the locked "Camera (in-app)" row on /live/go. */
export function LockedGlyph({ size = 12 }: { size?: number }) {
  return (
    <View style={[styles.lock, { backgroundColor: ROOM.glassStrong }]}>
      <Icon name="lock" size={size} color={ROOM.fgMuted} />
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs2,
  },
  /* An icon-only corner seal — sanctioned circle. */
  lock: {
    position: 'absolute',
    end: -2,
    bottom: -2,
    borderRadius: 999,
    padding: space.xs,
  },
  flex: { flex: 1 },
})
