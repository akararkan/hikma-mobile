/* =========================================================
   files — the File/Blob model, translated to React Native
   ---------------------------------------------------------
   Web `File` objects do not exist on native. A picker hands back
   a URI and some metadata instead, and the three things the api
   layer does with a file all have to be re-expressed:

     1. `formData.append(k, file)`   → append `{uri, name, type}`
     2. `file.size`                  → asset.fileSize, or stat the URI
     3. `file.arrayBuffer()`         → read the file with expo-file-system

   WHERE THIS BITES IN THE COPIED SOURCE
     api/media.js      sha256Of(file) uses file.arrayBuffer() + crypto.subtle
                       putBytes() does xhr.send(file) to the presigned URL
     api/http.js       withTierApplied() checks `instanceof File` and
                       re-packs a FormData — the instanceof is always
                       false on native, so it becomes a harmless pass-
                       through until the image resize is re-implemented
     lib/mediaTier.js  canvas-based downscale → expo-image-manipulator

   Install (Expo):  expo-file-system  expo-crypto  expo-image-manipulator
   Install (bare):  react-native-blob-util  react-native-quick-crypto
   ========================================================= */
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'

/* ---------- 1. the FormData part ---------- */

/**
 * Normalise whatever the picker returned into the shape RN's FormData
 * understands. Pass the RESULT to `formData.append(...)`.
 *
 * expo-image-picker  → { uri, fileName, mimeType, fileSize }
 * react-native-image-picker → { uri, fileName, type, fileSize }
 * expo-document-picker → { uri, name, mimeType, size }
 */
export function toUploadFile(asset, fallbackName = 'upload') {
  const uri = asset.uri || asset.path || ''
  const name = asset.fileName || asset.name || uri.split('/').pop() || fallbackName
  const type = asset.mimeType || asset.type || guessMime(name)
  return { uri, name, type }
}

function guessMime(name) {
  const ext = String(name).split('.').pop()?.toLowerCase()
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'video/webm',
    pdf: 'application/pdf',
  }[ext] || 'application/octet-stream'
}

/* ---------- 2. size ---------- */

/** Bytes. media.js refuses an oversize upload BEFORE hashing, so this has
 *  to work without reading the file. Prefer the picker's own number. */
export async function sizeOf(asset) {
  if (typeof asset.fileSize === 'number') return asset.fileSize
  if (typeof asset.size === 'number') return asset.size
  try {
    const info = await FileSystem.getInfoAsync(asset.uri || asset.path, { size: true })
    return info.size || 0
  } catch { return 0 }
}

/* ---------- 3. sha256 (upload dedup) ---------- */

/** Hex SHA-256, or null. The digest is OPTIONAL — it only enables the
 *  server's dedup shortcut (presignedPutUrl:null + status READY), so
 *  every failure path here returns null rather than throwing, exactly
 *  like the web version did in a non-secure context.
 *
 *  media.js already skips this above 64 MB; keep that guard, because
 *  base64-reading a large file on native is worse than it is on web. */
export async function sha256Of(asset) {
  try {
    const uri = asset.uri || asset.path
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, b64, {
      encoding: Crypto.CryptoEncoding.HEX,
    })
  } catch { return null }
}

/* ---------- 4. the presigned PUT ---------- */

/**
 * Replaces `putBytes()` in api/media.js.
 *
 * The presigned URL is a FOREIGN origin and the URL itself is the auth —
 * never send the app's Authorization header there (the web comment says
 * the same thing, and it is just as true here). Content-Type must match
 * the mime the upload-intent was issued for, or storage rejects the PUT.
 *
 * `uploadAsync` streams from disk, which is the reason to use it over
 * fetch: it never holds a 512 MB video in JS memory.
 */
export async function putBytes(url, asset, onProgress, signal) {
  const uri = asset.uri || asset.path
  const task = FileSystem.createUploadTask(
    url,
    uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': asset.type || asset.mimeType || 'application/octet-stream' },
    },
    (p) => {
      if (onProgress && p.totalBytesExpectedToSend > 0) {
        onProgress(p.totalBytesSent / p.totalBytesExpectedToSend)
      }
    },
  )

  if (signal) {
    if (signal.aborted) throw abortError()
    signal.addEventListener('abort', () => { task.cancelAsync().catch(() => {}) }, { once: true })
  }

  const res = await task.uploadAsync()
  if (!res || res.status < 200 || res.status >= 300) {
    throw new Error(`Storage PUT failed (${res?.status ?? 'network'})`)
  }
}

/* media.js throws `new DOMException('Aborted','AbortError')`; RN has no
   DOMException, and the poll loop only ever checks `.name`. */
function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}
