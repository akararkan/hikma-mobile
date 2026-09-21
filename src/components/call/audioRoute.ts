/* =========================================================
   Where a call's sound comes out.

   expo-audio owns the app's audio session, so earpiece ⇄
   speaker goes through `setAudioModeAsync` rather than through
   AVAudioSession or AudioManager directly. Two owners of one
   session is how a call ends up silent on exactly one handset.

   The platforms differ, and the difference is worth knowing
   before reading the toggle:

   · iOS — `shouldRouteThroughEarpiece` is the `.defaultToSpeaker`
     option on a `.playAndRecord` session, so it only bites when
     `allowsRecording` is true. That is why the call mode always
     carries both. WebRTC configures the same session for
     capture, and its own configuration can be re-applied on a
     route change (headphones in, headphones out), which puts
     the sound back on the default route — the toggle is
     re-applied on every change rather than set once.
   · Android — expo-audio couples the route to `AudioManager.mode`:
     earpiece is MODE_IN_COMMUNICATION, speaker is MODE_NORMAL
     with speakerphone forced on. Speakerphone therefore leaves
     the VoIP mode and gives up the platform echo canceller. It
     is loud and it works; a dedicated routing module is the
     real fix, and a second owner of the session is not.

   Either call can reject — another app can hold the session —
   so the caller puts its button back rather than claiming the
   sound moved.
   ========================================================= */
import { setAudioModeAsync } from 'expo-audio'

/** Configure the session for a live call and point it at one output. */
export function setCallAudioRoute(speaker: boolean): Promise<void> {
  return setAudioModeAsync({
    /* A call is not playback: the silent switch must never mute the person
       on the other end. */
    playsInSilentMode: true,
    allowsRecording: true,
    interruptionMode: 'doNotMix',
    /* `UIBackgroundModes` carries `audio` and `voip`, so the call survives the
       home button — which it must, because the user is on it. */
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: !speaker,
  })
}

/** Hand the session back. A call session left up keeps the recording
 *  indicator lit and keeps every other app ducked long after the hang-up. */
export function releaseCallAudio(): Promise<void> {
  return setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  })
}
