/* =========================================================
   video-composer — the JS face of the local native module.

   `hasVideoComposer` is the gate every editing surface reads
   (the hasWebRTC pattern): a dev client built BEFORE this
   module existed simply keeps the single-clip flow, and no
   button lies. requireNativeModule throws when the native side
   is absent, so the probe is a try/catch, not a feature flag
   anyone has to remember to flip.
   ========================================================= */
import { requireNativeModule } from 'expo-modules-core'

export interface ComposeClip {
  /** file:// uri of the source clip. */
  uri: string
  /** Trim in-point, ms into the source. Omit for 0. */
  startMs?: number
  /** Trim out-point, ms into the source. Omit for the clip's end. */
  endMs?: number
  /** Playback rate baked into the file (0.5 = slow-mo, 2 = fast).
   *  Audio pitch shifts with the rate on both platforms. */
  speed?: number
}

export interface ComposeResult {
  uri: string
  durationMs: number
}

interface NativeApi {
  compose(clips: ComposeClip[]): Promise<ComposeResult>
}

let native: NativeApi | null = null
try {
  native = requireNativeModule<NativeApi>('VideoComposer')
} catch {
  native = null
}

/** False in a dev client built before the module existed — every editing
 *  affordance gates on this and degrades to the single-clip flow. */
export const hasVideoComposer = !!native

/** Trim/retime/concat the clips into ONE mp4 in the app cache.
 *  Throws when the native module is absent — check `hasVideoComposer`. */
export function composeVideo(clips: ComposeClip[]): Promise<ComposeResult> {
  if (!native) return Promise.reject(new Error('Video editing needs an updated app build.'))
  return native.compose(clips)
}
