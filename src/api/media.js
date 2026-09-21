/* =========================================================
   Media pipeline — /api/v1/media (settings module §20)
   upload-intent → client PUTs bytes STRAIGHT to storage →
   complete → poll status until READY / FAILED_*.

   Wire truths:
   - `X-Media-Tier` header carries the user's tier; any garbage
     resolves to HIGH server-side, so we just pass it through.
   - sha256 is optional but enables dedup: a hit answers with
     presignedPutUrl:null + status READY — nothing to upload.
   - The presigned PUT binds the Content-Type to the intent's
     mime, and it is a FOREIGN origin: never send the app's
     Authorization header there (hence the bare XHR below).
   - complete/delete answer 202 with empty bodies.
   ---------------------------------------------------------
   RN PORT — the pipeline logic is unchanged. Two primitives moved
   to ../platform/files.js because they were the only web-shaped
   things in here:

     sha256Of  crypto.subtle + file.arrayBuffer()  → expo-crypto
     putBytes  XHR .send(File)                     → expo-file-system

   "A file" is no longer a `File`/`Blob` but whatever the picker
   handed back — `{ uri, name, type, fileSize }`. Normalise a picker
   asset with `toUploadFile()` from ../platform/files.js before
   passing it here. `size`/`type` are read through the two helpers
   below so both shapes work.
   ========================================================= */
import { http } from './http.js'
import { sha256Of as hashFile, sizeOf, putBytes } from '../platform/files.js'

export const MEDIA_STATUS_FAILED = new Set(['FAILED_VALIDATION', 'FAILED_MODERATION', 'FAILED_PROCESSING'])

/** The server's own caps (MediaProperties.Limits), mirrored so the client can
 *  refuse an impossible upload BEFORE reading half a gigabyte into a tab.
 *  The server stays the authority — this is a courtesy, not a contract. */
export const MEDIA_LIMITS = {
  IMAGE: 26_214_400,        // 25 MB
  AUDIO: 26_214_400,
  VIDEO: 536_870_912,       // 512 MB
  FILM: 536_870_912,
  VIDEO_CLIP: 536_870_912,
}

/** Above this we skip the SHA-256 entirely: the digest needs the whole file in
 *  an ArrayBuffer, and dedup is an optimisation, not a requirement. */
const HASH_MAX_BYTES = 64 * 1024 * 1024

export const media = {
  /* ---- primitives ---- */
  uploadIntent({ mime, sizeBytes, sha256, type = 'IMAGE' }, tier) {
    return http.post('/api/v1/media/upload-intent',
      { mime, sizeBytes, sha256: sha256 || undefined, type },
      { headers: tier ? { 'X-Media-Tier': tier } : {} })
  },
  complete(id) { return http.post(`/api/v1/media/${id}/complete`) },     // 202
  status(id) { return http.get(`/api/v1/media/${id}`) },                 // {mediaId,type,status,width,height,durationMs,blurhash,storedBytes,errorMessage,renditions[]}
  remove(id) { return http.del(`/api/v1/media/${id}`) },                 // 202; hard delete, second call 404

  /** SHA-256 hex of the file at `asset.uri`, via expo-crypto. Returns null on
   *  any failure — the hash is optional (it only unlocks the server's dedup
   *  shortcut), exactly as on web where a non-secure context returned null. */
  sha256Of(asset) { return hashFile(asset) },

  /** The whole pipeline in one call.
   *  upload(file, { type, tier, onProgress, signal }) → final MediaStatusResponse.
   *  onProgress(fraction 0..1) covers the byte transfer only; after that the
   *  poll loop runs until READY or a FAILED_* status (which rejects with an
   *  Error carrying .status = the failed state). */
  /* The @param JSDoc is load-bearing: without it TS's JS inference drops the
     un-defaulted keys (tier/onProgress/signal) from the options type and
     typed callers cannot pass them. */
  /**
   * @param {any} file
   * @param {{ type?: string, tier?: string, onProgress?: (fraction: number) => void,
   *           signal?: AbortSignal, pollMs?: number, maxPolls?: number }} [opts]
   */
  async upload(file, { type = 'IMAGE', tier, onProgress, signal, pollMs = 1200, maxPolls = 150 } = {}) {
    /* RN: `file.size` / `file.type` were `File` properties. A picker asset
       spells them differently per library (fileSize/size, mimeType/type), so
       both are resolved through the shim — `sizeOf` prefers the picker's own
       number and only stats the URI as a fallback, which matters because the
       size check has to happen WITHOUT reading the file. */
    const sizeBytes = await sizeOf(file)
    const mime = file.type || file.mimeType || 'application/octet-stream'

    /* Refuse an oversize file up front. Doing this after sha256Of would mean
       reading the entire 512 MB just to be told MEDIA_TOO_LARGE. */
    const cap = MEDIA_LIMITS[type]
    if (cap && sizeBytes > cap) {
      const err = new Error(`That file is too large — the limit is ${Math.round(cap / 1024 / 1024)} MB.`)
      err.code = 'MEDIA_TOO_LARGE'
      throw err
    }
    // Dedup is optional; a huge file skips the digest rather than the upload.
    const sha256 = sizeBytes <= HASH_MAX_BYTES ? await media.sha256Of(file) : null
    const intent = await media.uploadIntent({ mime, sizeBytes, sha256, type }, tier)

    if (!intent.deduped) {
      await putBytes(intent.presignedPutUrl, file, onProgress, signal)
      await media.complete(intent.mediaId)
    } else onProgress?.(1)

    /* Poll until the worker settles. Deduped assets are READY immediately. */
    let last = null
    for (let i = 0; i < maxPolls; i++) {
      /* RN: no DOMException on native. The loop and every caller only ever
         read `.name`, which this preserves. */
      if (signal?.aborted) throw abortError()
      last = await media.status(intent.mediaId)
      if (last.status === 'READY') return last
      if (MEDIA_STATUS_FAILED.has(last.status)) {
        const err = new Error(last.errorMessage || `Upload failed (${last.status})`)
        err.status = last.status
        throw err
      }
      await new Promise(r => setTimeout(r, pollMs))
    }
    const err = new Error('Timed out waiting for media processing')
    err.status = last?.status || 'TIMEOUT'
    throw err
  },
}

/* RN: `putBytes` moved to ../platform/files.js and is imported at the top.
   The web version was a bare XHR purely for upload-progress events; the native
   one is expo-file-system's `createUploadTask`, which gives the same progress
   callback AND streams from disk — the reason to prefer it, since buffering a
   512 MB video into JS memory is not survivable on a phone.

   Both properties the web comment called out still hold: no credentials and no
   app headers go to the presigned URL (it is a FOREIGN origin and the URL
   itself is the auth), and Content-Type must match the mime the intent was
   issued for or storage rejects the PUT. */

function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}
