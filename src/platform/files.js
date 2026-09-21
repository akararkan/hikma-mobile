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
     api/http.js       withTierApplied() re-packs a FormData by iterating
                       `.entries()`, which RN's FormData does not implement —
                       it is a pass-through here until the image resize is
                       re-implemented on expo-image-manipulator
     lib/mediaTier.js  canvas-based downscale → expo-image-manipulator

   ---------------------------------------------------------
   EXPO SDK 57 NOTE — verified against
   https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/

   SDK 57's `expo-file-system` root export is the NEW class-based API
   (`File`, `Directory`, `Paths`). `getInfoAsync` / `readAsStringAsync` /
   `createUploadTask` / `EncodingType` / `FileSystemUploadType` all moved to
   the compatibility entry point:

       import * as FileSystem from 'expo-file-system/legacy'

   The legacy entry is what this shim imports, because `createUploadTask` is
   the only API that streams a PUT from disk with progress — the new `File`
   class has `.upload()` but no progress callback yet. Revisit if that lands.
   ========================================================= */
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
/* The NEW File class (root export) — used only to hand expo/fetch a byte
   reader for a local uri; everything else in this file stays on legacy. */
import { File as FSFile } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import * as Sharing from 'expo-sharing'

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

/**
 * SDK 57 TRAP — the global `fetch` on native is expo/fetch (the winter
 * runtime swaps it in unless EXPO_PUBLIC_USE_RN_FETCH is set), and its
 * multipart serializer (expo/src/winter/fetch/convertFormData.ts) knows
 * three part shapes only: string, Blob, and "object with a bytes() method".
 * React Native's proprietary `{uri, name, type}` file part is NOT one of
 * them — its own comment says "`uri` is not supported" — so the serializer
 * throws `Unsupported FormDataPart implementation` BEFORE anything touches
 * the network. The thrown error has no `.status`, which errorText() can
 * only render as the offline copy ("Could not reach the server") while the
 * server is perfectly reachable. JSON bodies (strings) are unaffected,
 * which is exactly the "JSON works, uploads die" split.
 *
 * The cure: give every `{uri}` part a `bytes()` reader backed by the new
 * File API, IN PLACE. `name`/`type` are left exactly as the call site set
 * them — expo/fetch turns them into the part's filename= and content-type,
 * which the backend's mime classifier (audio/* → VOICE) depends on. The
 * property is deliberately NON-ENUMERABLE: if the app is ever flipped back
 * to RN's fetch, getParts() spreads the part over the bridge, where an
 * enumerable function would break the native serializer — a spread skips
 * it, while expo/fetch's `'bytes' in part` check still finds it.
 *
 * Web is untouched (and needs nothing): the browser's FormData/fetch pair
 * handles file parts itself.
 */
export function withFetchableFileParts(formData) {
  if (Platform.OS === 'web' || !formData) return formData
  /* The winter runtime patches RN's FormData with entries() at boot; the
     _parts fallback covers a bare RN FormData (tests, early boot). Both
     yield [name, value] pairs with the RAW appended value — getParts()
     would hand back copies, which an in-place fix cannot use. */
  const pairs = typeof formData.entries === 'function' ? formData.entries() : (formData._parts || [])
  for (const pair of pairs) {
    const value = pair?.[1]
    if (value && typeof value === 'object' && typeof value.uri === 'string' && typeof value.bytes !== 'function') {
      Object.defineProperty(value, 'bytes', {
        value: () => new FSFile(value.uri).bytes(),
        enumerable: false,
      })
    }
  }
  return formData
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
 *  base64-reading a large file on native is worse than it is on web.
 *
 *  CAVEAT carried over from the kit: this hashes the BASE64 TEXT, not the
 *  raw bytes, so it will not match a server-side digest of the file. It is
 *  still a stable content fingerprint (same bytes → same hash), which is all
 *  the dedup shortcut needs — but if the backend compares against its own
 *  binary SHA-256, this has to hash bytes instead. Verify once against the
 *  live server when step 5 (media) lands. */
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
 * `createUploadTask` streams from disk, which is the reason to use it over
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

/* media.js threw `new DOMException('Aborted','AbortError')`; RN has no
   DOMException, and the poll loop only ever checks `.name`. */
function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

/* ---------- 5. "save this to disk" ---------- */

/**
 * The native replacement for `saveBlob()` in api/http.js.
 *
 * The web version handed the Blob to the browser's downloader via an object
 * URL and a synthetic `<a download>`. A phone has no Downloads folder to drop
 * a file into behind the user's back, so the native equivalent is: write the
 * bytes into the app's cache, then hand the file to the OS share sheet, which
 * is where "Save to Files" / "Save to Photos" actually live.
 *
 * Called with what `http.download` returns: `{ blob, filename, type }`.
 *
 * IMPORTANT — this one is genuinely async where the web one was fire-and-forget,
 * and it must be AWAITED. Two share sheets cannot be open at once, so a caller
 * saving a multi-part recording has to sequence them (chat.js does).
 *
 * @returns {Promise<boolean>} false when sharing is unavailable on the device.
 */
export async function saveBlob({ blob, filename, type } = {}, fallbackName = 'download') {
  if (!blob) return false

  const name = sanitizeFilename(filename || fallbackName)
  const target = `${FileSystem.cacheDirectory}${name}`

  /* Blob → base64 → disk. RN's FileReader is the only bridge from a Blob to
     something writable; `readAsDataURL` yields `data:<mime>;base64,<payload>`
     and only the payload goes to the file. */
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the downloaded file.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)

  await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 })

  if (!(await Sharing.isAvailableAsync())) return false
  await Sharing.shareAsync(target, {
    mimeType: type || guessMime(name),
    UTI: type === 'video/mp4' ? 'public.mpeg-4' : undefined,
  })
  return true
}

/* A server-supplied Content-Disposition filename lands straight in a path, so
   strip anything that could climb out of the cache directory. */
function sanitizeFilename(name) {
  return String(name).replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'download'
}
