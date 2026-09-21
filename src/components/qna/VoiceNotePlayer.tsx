/* =========================================================
   The voice note on an answer — a dumb transport, not a player.

   There is no native player in this file any more. Audio belongs
   to the ONE app-level host (ChatVoiceHost, mounted in the
   signed-in layout — see chat/chatVoicePlayer.tsx), for the two
   reasons that host exists. An answer lives in a FlashList, so a
   player owned by the row is killed mid-sentence the moment the
   ViewHolder recycles; and playback is app-wide exclusive, so
   tapping a second note — here, in a chat bubble, on a research
   comment, anywhere — silences the first instead of reciting over
   it. The old module-level `stoppers` set only ever arbitrated
   between two QnA rows, which is why a chat note and an answer
   could still overlap.

   The lazy VoicePill/ActiveVoiceNote split goes with it: it
   existed only to keep expo-audio from constructing N players
   and N downloads for a list of notes nobody had asked to hear.
   With no player in the row at all, the resting cost is already
   nothing, and the host constructs exactly one — on the tap.

   The host key is namespaced. Its registry spans domains, and an
   answer id and a chat message id are minted by different
   tables. Keying on the URL rather than an id is deliberate:
   four call sites pass this component a url and a duration and
   nothing else, and the url is what actually identifies the
   audio — two rows pointing at the same recording SHOULD share
   a transport.

   The face is the shared VoiceTransport, so the plate, the
   scrubbable waveform and the glide are the same object the
   voice post and the chat bubble render. The backend sends no
   waveform for an answer, so the transport falls back to its
   seeded synthetic envelope — seeded by the url, the same string
   the old local hash used, so a given note keeps its shape.
   ========================================================= */
import React from 'react'
import { useEvent } from '@/hooks/useAsync'
import { VoiceTransport } from '@/components/media/VoiceTransport'
import { chatVoice, useChatVoiceFor } from '@/components/chat/chatVoicePlayer'

export function VoiceNotePlayer({
  url, durationSeconds, compact,
}: { url: string; durationSeconds: number | null; compact?: boolean }) {
  const key = `qna:${url}`
  /* Row-scoped subscription: while a note plays the clock re-renders this
     answer alone, not every voice row on screen. */
  const live = useChatVoiceFor(key)
  const mine = live.id === key
  const wireSec = durationSeconds || 0
  const hintMs = wireSec ? wireSec * 1000 : null

  const onToggle = () => chatVoice.toggle(key, url, hintMs)
  /* Stable identity: the waveform's gesture closes over this, and a callback
     reborn on every store tick would re-register the native gesture config
     four times a second — the churn the memoised gesture exists to avoid. */
  const onSeek = useEvent((sec: number) => chatVoice.seek(key, url, sec, hintMs))

  return (
    <VoiceTransport
      seed={url}
      playing={mine && live.playing}
      position={mine ? live.position : 0}
      duration={mine ? (live.duration || wireSec) : wireSec}
      rate={live.rate}
      compact={compact}
      onToggle={onToggle}
      onSeek={onSeek}
      accessibilityLabel={mine && live.playing ? 'Pause voice note' : 'Play voice note'}
    />
  )
}
