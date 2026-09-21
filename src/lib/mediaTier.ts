/* =========================================================
   Upload quality — the RN port of lib/mediaTier.js.

   Same contract, same caps, same fail-open rule. The only
   change is the engine: canvas + createImageBitmap becomes
   expo-image-manipulator, which is the native equivalent and
   also handles EXIF rotation for us (the web version had to
   ask for `imageOrientation: 'from-image'` explicitly).

   What it still does NOT do: upscale, touch GIF/SVG/HEIC, or
   transcode video. The server owns the 1080 hard cap.
   ========================================================= */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { api } from '@/api'
import { storage } from '@/platform/storage'
import { sizeOf as statSize } from '@/platform/files'
import { on, PREFS_EVENT } from '@/platform/appEvents'
import { shouldSaveUploadData } from './mediaPrefs'

/** Long-edge caps, mirroring MediaTier.imageLongEdge() on the server. */
export const TIER_EDGE: Record<string, number> = { DATA_SAVER: 1080, STANDARD: 1440, HIGH: 1920 }
const DEFAULT_TIER = 'HIGH'
const CACHE_KEY = 'ika_media_tier'
const JPEG_QUALITY = 0.82        // matches media.image.jpeg-quality server-side

/* Re-encoding these is a downgrade, not a saving. */
const SKIP_MIME = /^image\/(gif|svg\+xml|avif|heic|heif)$/i

export interface PickedAsset {
  uri: string
  mimeType?: string | null
  type?: string | null
  fileName?: string | null
  name?: string | null
  width?: number | null
  height?: number | null
  fileSize?: number | null
  size?: number | null
  [k: string]: any
}

let cached: string | null = null
let inflight: Promise<string> | null = null

function readCache(): string | null {
  if (cached) return cached
  try {
    const v = storage.getItem(CACHE_KEY)
    if (v && TIER_EDGE[v]) { cached = v; return v }
  } catch { /* ignore */ }
  return null
}

function writeCache(tier: string) {
  cached = tier
  try { storage.setItem(CACHE_KEY, tier) } catch { /* ignore */ }
}

/* A cosmetic write anywhere in Settings emits PREFS_EVENT; the tier may have
   been one of them, so drop the memo and re-read on next use. */
on(PREFS_EVENT, () => { cached = null; inflight = null })

/** The user's chosen tier. Resolves from cache when possible so an upload
 *  never waits on a settings round trip; falls back to HIGH (the server's own
 *  fallback for a missing/garbage header). */
export async function getTier(): Promise<string> {
  const memo = readCache()
  if (memo) return memo
  if (!inflight) {
    inflight = api.settings.section('media')
      .then((b: any) => {
        const t = b?.uploadQuality
        const tier = TIER_EDGE[t] ? t : DEFAULT_TIER
        writeCache(tier)
        return tier
      })
      .catch(() => DEFAULT_TIER)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Synchronous best guess, for call sites that cannot await (render paths). */
export function getTierSync(): string { return readCache() || DEFAULT_TIER }

/** Let the settings screen keep the cache honest without a round trip. */
export function setTierLocal(tier: string) { if (TIER_EDGE[tier]) writeCache(tier) }

const mimeOf = (a: PickedAsset) => String(a.mimeType || a.type || '')
const sizeOf = (a: PickedAsset) => Number(a.fileSize ?? a.size ?? 0) || 0

/** Downscale one picked image to the tier's long-edge cap. Returns the
 *  ORIGINAL asset whenever compressing would not help or is not possible. */
export async function compressToTier(asset: PickedAsset, tier: string): Promise<PickedAsset> {
  if (!asset?.uri) return asset
  const mime = mimeOf(asset)
  /* The picker sometimes omits the mime; an `image/*` guess from the asset's
     own `type` field is the only other signal, and a wrong guess here just
     means we skip compression — which is the safe direction. */
  if (mime && (!mime.startsWith('image/') || SKIP_MIME.test(mime))) return asset
  if (!mime && asset.type && asset.type !== 'image') return asset

  const cap = TIER_EDGE[tier] || TIER_EDGE[DEFAULT_TIER]
  const long = Math.max(Number(asset.width) || 0, Number(asset.height) || 0)
  /* Never upscale. When the picker did not report dimensions we still run the
     manipulator, because rendering is the only way to learn them — the cap is
     then applied in a second pass below once the render has measured. */
  if (long && long <= cap) return asset

  try {
    const ctx = ImageManipulator.manipulate(asset.uri)
    if (long > cap) {
      const portrait = (Number(asset.height) || 0) > (Number(asset.width) || 0)
      ctx.resize(portrait ? { height: cap } : { width: cap })
    }
    let image = await ctx.renderAsync()
    /* Unknown-dimensions path: without this a camera/share-sheet asset that
       reported no size was re-encoded but never downscaled, and uploaded at
       full resolution even on DATA_SAVER. */
    if (!long && Math.max(image.width || 0, image.height || 0) > cap) {
      const ctx2 = ImageManipulator.manipulate(asset.uri)
      ctx2.resize((image.height || 0) > (image.width || 0) ? { height: cap } : { width: cap })
      image = await ctx2.renderAsync()
    }
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })

    /* No saving → keep the original, exactly as the web version did when
       toBlob came back no smaller. `ImageResult` carries no byte count, so
       the written file has to be stat'd. */
    const before = sizeOf(asset)
    const after = before ? await statSize({ uri: out.uri }).catch(() => 0) : 0
    if (before && after && after >= before) return asset

    return {
      ...asset,
      uri: out.uri,
      width: out.width,
      height: out.height,
      mimeType: 'image/jpeg',
      fileName: (asset.fileName || asset.name || 'upload').replace(/\.[^.]+$/, '') + '.jpg',
      fileSize: after || asset.fileSize,
    }
  } catch {
    /* Fail open. A compression helper must never be the reason an upload
       cannot happen. */
    return asset
  }
}

/** The one call an upload path needs: resolve the tier and pre-compress. */
/* "Use less data on mobile" clamps the tier for the duration of a metered
   connection. It cannot RAISE the tier — someone on DATA_SAVER who joins
   wi-fi still gets DATA_SAVER, because that is what they chose. Read through
   the prefs module's sync cache so this stays a single await. */
async function effectiveTier(): Promise<string> {
  const tier = await getTier()
  if (!shouldSaveUploadData()) return tier
  return TIER_EDGE[tier] > TIER_EDGE.DATA_SAVER ? 'DATA_SAVER' : tier
}

export async function prepareUpload(asset: PickedAsset): Promise<PickedAsset> {
  try { return await compressToTier(asset, await effectiveTier()) }
  catch { return asset }
}

/** Same, for a list (chat attachments, research figures, a gallery post). */
export async function prepareUploads(assets: PickedAsset[]): Promise<PickedAsset[]> {
  const tier = await effectiveTier()
  return Promise.all((assets || []).map(a => compressToTier(a, tier).catch(() => a)))
}
