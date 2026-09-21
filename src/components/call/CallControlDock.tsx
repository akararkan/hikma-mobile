/* =========================================================
   CallControlDock — the circles at the bottom of a call.

   Every button here drives the real media engine: Mic and
   Camera flip a track on the capture that is being sent,
   Speaker moves the audio session between earpiece and
   loudspeaker, Flip switches the camera without renegotiating.

   `hasMedia` is still the gate. A build without
   react-native-webrtc has nothing to mute, no route to switch
   and no capture to show, so those controls RENDER dimmed and
   locked rather than vanishing — a dock that silently omits
   Mute teaches the user that this app has no mute — and
   tapping one opens the explainer instead of doing nothing.

   Camera and Flip belong to a video call only. There is no
   mid-call upgrade: adding a track to a live mesh needs a
   renegotiation the blind relay's engine deliberately does not
   do, so on a voice call the pair is absent rather than dead.

   QELAT: the dock is a SOLID setback plate over the picture —
   `ROOM.glassStrong` fill with a drawn hairline, never a blur.
   The circles inside stay circles: icon-only round buttons are
   the sanctioned exception to the no-pills law.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Icon, Text, Touchable, type IconName } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { ROOM } from '@/components/live/skin'
import { LockedGlyph } from './MediaEngineNotice'

export type DockKey = 'mic' | 'speaker' | 'camera' | 'flip' | 'end'

export interface CallControlDockProps {
  hasMedia: boolean
  micOn: boolean
  speakerOn: boolean
  /** The local camera track is enabled and being sent. */
  cameraOn: boolean
  /** This call carries video at all — a VOICE call has no camera controls. */
  video: boolean
  /** Ringing outgoing: the dock collapses to one red Cancel. */
  cancelOnly?: boolean
  onToggle: (key: DockKey) => void
  onEnd: () => void
  onExplain: () => void
}

export function CallControlDock({
  hasMedia, micOn, speakerOn, cameraOn, video, cancelOnly, onToggle, onEnd, onExplain,
}: CallControlDockProps) {
  if (cancelOnly) {
    return (
      <View style={styles.cancelWrap}>
        <DockButton
          icon="callEnd"
          label="Cancel"
          tone="danger"
          onPress={onEnd}
          accessibilityLabel="Cancel the call"
        />
      </View>
    )
  }

  return (
    <View style={[styles.dock, { borderColor: ROOM.hairline }]}>
      {/* The three toggles are SWITCHES with a spoken checked state — a
          static "Toggle microphone" told a blind caller nothing about whether
          they were currently muted. */}
      <DockButton
        icon={micOn ? 'mic' : 'micOff'}
        label={micOn ? 'Mute' : 'Unmute'}
        off={!micOn}
        locked={!hasMedia}
        onPress={() => (hasMedia ? onToggle('mic') : onExplain())}
        accessibilityLabel={hasMedia ? 'Microphone' : 'Microphone unavailable in this build'}
        switchState={hasMedia ? micOn : undefined}
      />
      <DockButton
        icon={speakerOn ? 'speaker' : 'mute'}
        label="Speaker"
        active={speakerOn}
        locked={!hasMedia}
        onPress={() => (hasMedia ? onToggle('speaker') : onExplain())}
        accessibilityLabel={hasMedia ? 'Speaker' : 'Speaker routing unavailable in this build'}
        switchState={hasMedia ? speakerOn : undefined}
      />
      {video ? (
        <DockButton
          icon={cameraOn ? 'video' : 'videoOff'}
          label="Camera"
          off={!cameraOn}
          locked={!hasMedia}
          onPress={() => (hasMedia ? onToggle('camera') : onExplain())}
          accessibilityLabel={hasMedia ? 'Your camera' : 'Camera unavailable in this build'}
          switchState={hasMedia ? cameraOn : undefined}
        />
      ) : null}
      {video && cameraOn ? (
        <DockButton
          icon="camera"
          label="Flip"
          onPress={() => onToggle('flip')}
          accessibilityLabel="Switch camera"
        />
      ) : null}
      <DockButton
        icon="callEnd"
        label="End"
        tone="danger"
        onPress={onEnd}
        accessibilityLabel="End the call"
      />
    </View>
  )
}

/* The web's three control faces, translated (chat-extras.css §8 `.cl-ctl`):
   resting is a ghost fill on a hairline ring, `off` INVERTS to a white plate
   with dark ink — a muted mic has to be unmistakable at a glance, and a dimmed
   icon reads as "disabled" instead — and a positive `active` state (speaker)
   reads Sky-on-ghost, the on-dark accent, where the web reads gold. */
function DockButton({
  icon, label, onPress, tone, locked, off, active, accessibilityLabel, switchState,
}: {
  icon: IconName
  label: string
  onPress: () => void
  tone?: 'danger'
  locked?: boolean
  off?: boolean
  active?: boolean
  accessibilityLabel: string
  /** When set, the button announces as a switch carrying this checked state. */
  switchState?: boolean
}) {
  const bg = tone === 'danger' ? ROOM.live : off ? ROOM.fg : active ? ROOM.accentGhost : ROOM.fillStrong
  const fg = tone === 'danger' ? ROOM.fg : off ? ROOM.bg : active ? ROOM.accent : ROOM.fg
  const ring = !tone && !off && !active ? ROOM.hairline : ROOM.transparent

  return (
    <Touchable
      onPress={onPress}
      haptic={tone === 'danger' ? 'heavy' : 'light'}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
      /* Spread, not `role={undefined}` — Touchable defaults to "button"
         BEFORE its rest props, and an explicit undefined would erase it. */
      {...(switchState === undefined ? null : { accessibilityRole: 'switch' as const })}
      accessibilityState={switchState === undefined
        ? { disabled: !!locked }
        : { disabled: !!locked, checked: switchState }}
      style={styles.slot}
    >
      <View style={[styles.circle, { backgroundColor: bg, borderColor: ring, opacity: locked ? 0.4 : 1 }]}>
        <Icon name={icon} size={24} color={fg} />
        {locked ? <LockedGlyph /> : null}
      </View>
      <Text
        variant="micro"
        weight="600"
        align="center"
        color={locked ? ROOM.fgGhost : ROOM.fgMuted}
        style={styles.label}
      >
        {label}
      </Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 88,
    paddingHorizontal: space.sm,
    backgroundColor: ROOM.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    ...setback(shape.card),
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  cancelWrap: { alignItems: 'center', height: 88, justifyContent: 'center' },
  slot: { alignItems: 'center', width: 62 },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { marginTop: space.xs2 },
})
