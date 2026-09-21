/* =========================================================
   Voice notes, in a chat bubble.

   This is a THIN WRAPPER now. The control itself is
   @/components/media/VoiceTransport — the same component the
   voice POST renders — because a voice message and a voice post
   are the same object to a listener, and two faces for one
   thing is a difference nobody asked for. Everything visual,
   including the glide that makes the trace move continuously
   between status ticks, lives there.

   Chat renders it BARE. A post needs the transport to bring its
   own navy plate, because it lands on a white card with nothing
   to hold it; a message already has the bubble, and a plate
   inside a bubble is one container too many. So the coin, the
   trace and the clock sit straight on the bubble and take its
   ink — that is what the tint below is.

   What stays here is the part that is genuinely chat's:

     · NO player. The bubble is a dumb transport over the ONE
       screen-level player (ChatVoiceHost, ./chatVoicePlayer.tsx):
       a row draws nothing native by existing, FlashList
       recycling cannot kill audio mid-listen, and starting a
       second note silences the first — the Messenger grammar.
       The tap sends a command; the store sends back the clock.
     · the speed chip, which only a message has.

   Known backend gap, verified live: the multipart send DROPS
   the `durationMs` and `waveform` parts, so a received note
   arrives with neither. The waveform is therefore SYNTHESISED
   from the message id — same shape on every device for the same
   message, where a random shape would shimmer and a flat bar
   would look like a failed load — and the clock reads the
   player's own duration once it has one. Both become correct
   for free when the backend learns the parts.
   ========================================================= */
import React from 'react'
import { StyleSheet } from 'react-native'
import { withAlpha } from '@/theme/colors'
import { setback, shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { useEvent } from '@/hooks/useAsync'
import { NumericText, Touchable } from '@/ui'
import { VoiceTransport, parseWaveform } from '@/components/media/VoiceTransport'
import { chatVoice, useChatVoiceFor } from './chatVoicePlayer'

export interface VoiceNoteProps {
  media: any
  messageId: string
  /** The bubble's ink and its accent. Omitted — the pinned, starred and media
   *  screens — the transport falls back to the page's own ink, which is what
   *  a white row wants anyway. */
  fg?: string
  accent?: string
  /** This bubble is the navy own-side plate, so the coin is cerulean with
   *  navy ink rather than Oxford Blue with white (DESIGN.md §2). */
  onDark?: boolean
  compact?: boolean
}

export function VoiceNote({ media, messageId, fg, accent, onDark, compact }: VoiceNoteProps) {
  const t = useTheme()
  const c = t.colors
  const id = String(messageId)
  /* Row-scoped subscription: while a note plays, the clock re-renders this
     bubble alone, not every voice bubble on screen. */
  const live = useChatVoiceFor(id)
  const mine = live.id === id

  const wireSec = media?.durationMs ? media.durationMs / 1000 : 0
  const duration = mine ? (live.duration || wireSec) : wireSec
  const position = mine ? live.position : 0

  const bars = React.useMemo(
    () => parseWaveform(media?.waveform, compact ? 24 : 32),
    [media?.waveform, compact],
  )

  /* The bubble's own colours, in the shape the transport draws with. The
     played trace is the bubble's accent — sky inside the navy bubble, the
     darker blue inside the light one — and the rest bars are that side's ink
     held back far enough to read as unplayed. */
  const tint = React.useMemo(() => {
    const ink = fg || c.text
    /* Cerulean only ever on a dark plate: the own-side navy bubble always,
       and by night the incoming bubble too, since that one is dark as well. */
    const dark = onDark || t.scheme === 'dark'
    return {
      coin: dark ? c.cta : c.accent,
      coinInk: dark ? c.textOnCta : c.textOnAccent,
      wave: withAlpha(ink, 0.26),
      played: accent || c.accent,
      ink,
      inkMuted: withAlpha(ink, 0.62),
    }
  }, [fg, accent, onDark, t.scheme, c])

  const onToggle = () => chatVoice.toggle(id, media?.url, media?.durationMs)
  /* Stable identity: the waveform gesture closes over this, and a callback
     reborn on every store tick would re-register the native gesture config
     per tick — the exact churn the memoised gesture exists to avoid. */
  const onSeek = useEvent((sec: number) => chatVoice.seek(id, media?.url, sec, media?.durationMs))

  return (
    <VoiceTransport
      seed={id}
      bars={bars}
      playing={mine && live.playing}
      position={position}
      duration={duration}
      rate={live.rate}
      compact={compact}
      bare
      tint={tint}
      onToggle={onToggle}
      onSeek={onSeek}
      accessibilityLabel={mine && live.playing ? 'Pause voice message' : 'Play voice message'}
      /* The speed chip sits on the bubble like everything else here, so it
         takes the bubble's ink — and only where there is room for it. */
      trailing={compact ? null : (
        <Touchable
          /* ALWAYS the speed, never a secret play button. This used to fall
             back to toggle() when the note wasn't the active one — so tapping
             "1x" started playback instead of changing it, which reads as the
             chip being broken. The store carries the session rate whether or
             not this row owns the player, so cycling from idle simply decides
             what the next play sounds like. Default hit slop stays on: the
             chip is well under 44pt on its own. */
          onPress={chatVoice.cycleRate}
          feedback="scale"
          accessibilityLabel="Playback speed"
          style={[
            styles.speed,
            {
              backgroundColor: withAlpha(tint.ink, 0.10),
              borderColor: withAlpha(tint.ink, 0.22),
            },
          ]}
        >
          <NumericText variant="micro" color={tint.ink} style={styles.rateLabel}>
            {`${live.rate}x`}
          </NumericText>
        </Touchable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  /* A text-bearing plate, so it takes the chip setback — pills are only ever
     unread counters and LIVE badges (DESIGN.md §8.9). */
  speed: {
    minWidth: 38,
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  rateLabel: { textTransform: 'none', letterSpacing: 0.2 },
})
