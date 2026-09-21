/* =========================================================
   The three media preferences that are about the CONNECTION
   rather than about quality.

   core-settings.md lists them beside uploadQuality in the same
   `media` block, and the backend stores and returns them — but
   the app only ever read uploadQuality, so setting the others
   (on the web, say) changed nothing here. These are the ones
   with teeth:

     uploadOverCellular   SAME_AS_WIFI | DATA_SAVER_ONLY
     autoDownloadPhotos   NEVER | WIFI | WIFI_AND_CELLULAR
     autoDownloadVideos   NEVER | WIFI | WIFI_AND_CELLULAR

   (playbackQuality is deliberately NOT honoured yet: it would
   need a rendition ladder the server does not serve, so a
   control for it would promise something nothing can deliver.)

   Shaped exactly like mediaTier.ts next door — module cache,
   one in-flight read, a synchronous reader for render paths, a
   local setter so the settings screen never has to wait for a
   round trip, and PREFS_EVENT invalidation.
   ========================================================= */
import { api } from '@/api'
import { storage } from '@/platform/storage'
import { isMeteredSync } from '@/platform/network'
import { on, PREFS_EVENT } from '@/platform/appEvents'

export type UploadOverCellular = 'SAME_AS_WIFI' | 'DATA_SAVER_ONLY'
export type AutoDownload = 'NEVER' | 'WIFI' | 'WIFI_AND_CELLULAR'

export interface MediaPrefs {
  uploadOverCellular: UploadOverCellular
  autoDownloadPhotos: AutoDownload
  autoDownloadVideos: AutoDownload
}

/** The server's own defaults, verified against a live GET /settings/media. */
const DEFAULTS: MediaPrefs = {
  uploadOverCellular: 'SAME_AS_WIFI',
  autoDownloadPhotos: 'WIFI',
  autoDownloadVideos: 'WIFI',
}

const CACHE_KEY = 'ika_media_prefs'
const UPLOAD_VALUES = new Set(['SAME_AS_WIFI', 'DATA_SAVER_ONLY'])
const DOWNLOAD_VALUES = new Set(['NEVER', 'WIFI', 'WIFI_AND_CELLULAR'])

let cached: MediaPrefs | null = null
let inflight: Promise<MediaPrefs> | null = null

/** Unknown values fall back rather than propagate: a server that grows a
 *  fourth enum member must not make this client refuse to autoplay. */
function normalize(block: any): MediaPrefs {
  const up = String(block?.uploadOverCellular || '').toUpperCase()
  const photos = String(block?.autoDownloadPhotos || '').toUpperCase()
  const videos = String(block?.autoDownloadVideos || '').toUpperCase()
  return {
    uploadOverCellular: UPLOAD_VALUES.has(up) ? (up as UploadOverCellular) : DEFAULTS.uploadOverCellular,
    autoDownloadPhotos: DOWNLOAD_VALUES.has(photos) ? (photos as AutoDownload) : DEFAULTS.autoDownloadPhotos,
    autoDownloadVideos: DOWNLOAD_VALUES.has(videos) ? (videos as AutoDownload) : DEFAULTS.autoDownloadVideos,
  }
}

function readCache(): MediaPrefs | null {
  if (cached) return cached
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (raw) { cached = normalize(JSON.parse(raw)); return cached }
  } catch { /* corrupt or unavailable storage → treat as cold */ }
  return null
}

function writeCache(prefs: MediaPrefs) {
  cached = prefs
  try { storage.setItem(CACHE_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
}

on(PREFS_EVENT, () => { cached = null; inflight = null })

/** Fresh preferences, one in-flight read shared by every caller. */
export function getMediaPrefs(): Promise<MediaPrefs> {
  const memo = readCache()
  if (memo) return Promise.resolve(memo)
  if (!inflight) {
    inflight = api.settings.section('media')
      .then((b: any) => { const p = normalize(b); writeCache(p); return p })
      .catch(() => DEFAULTS)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** For render paths, which cannot await. Defaults until the first read lands
 *  — and the defaults are the permissive ones, so nothing is withheld while
 *  the answer is unknown. */
export function readCachedMediaPrefs(): MediaPrefs {
  return readCache() || DEFAULTS
}

/** Let the settings screen keep this cache honest without a round trip — the
 *  same contract setTierLocal keeps for the tier. */
export function setMediaPrefsLocal(patch: Partial<MediaPrefs>) {
  writeCache(normalize({ ...readCachedMediaPrefs(), ...patch }))
}

/* ---- the questions callers actually ask ------------------------------- */

/** Should this upload be squeezed to the data-saver cap regardless of the
 *  chosen quality? Only on a metered connection, and only if asked. */
export function shouldSaveUploadData(): boolean {
  return readCachedMediaPrefs().uploadOverCellular === 'DATA_SAVER_ONLY' && isMeteredSync()
}

function allows(rule: AutoDownload): boolean {
  if (rule === 'NEVER') return false
  if (rule === 'WIFI_AND_CELLULAR') return true
  return !isMeteredSync()
}

/** May a photo be fetched before the reader asks for it (prefetch, poster)? */
export function mayAutoLoadPhotos(): boolean {
  return allows(readCachedMediaPrefs().autoDownloadPhotos)
}

/** May a video start on its own? */
export function mayAutoPlayVideos(): boolean {
  return allows(readCachedMediaPrefs().autoDownloadVideos)
}
