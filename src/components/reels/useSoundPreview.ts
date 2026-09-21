/* =========================================================
   One preview player for the whole app.

   The picker, the library and a sound's hero all offer a play
   button, and two of them sounding at once is the single worst
   thing an audio browser can do. So there is exactly one
   AudioPlayer, it lives outside React (createAudioPlayer, not
   useAudioPlayer), and starting a preview always stops the
   previous one.

   It also stops on blur and on background: a sound that keeps
   playing after you leave the screen you started it from is
   indistinguishable from a bug. And it stops at the END of the
   track, which is the same rule seen from the other side: a row
   left showing its equaliser over silence is a lie, and the tap
   that should have replayed the sound would spend itself
   clearing the state instead.
   ========================================================= */
import React from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio'
import { armReelAudioSession } from './mute'
import { bareUrl, type ViewSound } from './types'

let player: AudioPlayer | null = null
let ended: { remove: () => void } | null = null
let currentId: string | null = null
let failedId: string | null = null
const subs = new Set<() => void>()

const emit = () => { for (const fn of [...subs]) fn() }

function release() {
  try { ended?.remove() } catch { /* already gone */ }
  ended = null
  try { player?.pause() } catch { /* already gone */ }
  try { player?.remove() } catch { /* already gone */ }
  player = null
}

export function stopPreview() {
  if (!currentId && !player) return
  release()
  currentId = null
  emit()
}

export function startPreview(sound: Pick<ViewSound, 'id' | 'audioUrl'>) {
  if (!sound?.id) return
  if (currentId === sound.id) { stopPreview(); return }

  release()
  const url = bareUrl(sound.audioUrl)
  if (!url) { failedId = sound.id; currentId = null; emit(); return }

  armReelAudioSession()
  try {
    player = createAudioPlayer(url, { updateInterval: 400 })
    player.loop = false
    /* The track ending is the same event as the user pressing stop, so it runs
       the same path — the row drops back to its play glyph on its own. */
    ended = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status?.didJustFinish) stopPreview()
    })
    player.play()
    currentId = sound.id
    failedId = null
  } catch {
    /* A preview that will not decode greys its own play glyph; the row can
       still be used, because the server plays the file, not this device. */
    failedId = sound.id
    currentId = null
  }
  emit()
}

export interface SoundPreview {
  previewingId: string | null
  failedId: string | null
  play: (sound: Pick<ViewSound, 'id' | 'audioUrl'>) => void
  stop: () => void
}

export function useSoundPreview(): SoundPreview {
  const [, force] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    subs.add(force)
    return () => { subs.delete(force) }
  }, [])

  useFocusEffect(React.useCallback(() => stopPreview, []))

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') stopPreview() })
    return () => sub.remove()
  }, [])

  return { previewingId: currentId, failedId, play: startPreview, stop: stopPreview }
}
