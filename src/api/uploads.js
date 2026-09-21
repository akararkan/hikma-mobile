/* =========================================================
   Chunked/resumable uploads — client for the backend's
   /api/v1/uploads/sessions (backend docs/media/uploads.md).

   Big files ride 5MB chunks so a dropped connection resumes
   from the last received chunk (GET /{id} says which landed)
   instead of restarting a 100MB PDF from zero. complete()
   pushes the assembled file through the same server ingest
   path as an inline multipart upload and answers with the
   same media-ref shape (IngestResult), which `refFrom` folds
   into the chat MediaRefDto for a JSON send.

   Transport per chunk: the slice is read with the LEGACY
   expo-file-system string API (the only one with position/
   length reads — AGENTS.md), staged as a cache file, and PUT
   with `FileSystem.uploadAsync` BINARY_CONTENT so the bytes
   stream natively instead of transiting the JS heap.
   ========================================================= */
import * as FileSystem from 'expo-file-system/legacy'
import { http, errorFromText, refreshSession } from './http.js'
import { API_BASE, session } from './config.js'
import { toUploadFile, sizeOf } from '../platform/files.js'

/** Files at or above this take the chunked path (below it, multipart wins). */
export const CHUNK_THRESHOLD = 24 * 1024 * 1024

const ROUND_RETRIES = 3

function abortError() {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

/** One chunk: read slice → stage → authed binary PUT. 401 refreshes once. */
async function putChunk(sessionId, index, uri, position, length, retried) {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64, position, length,
  })
  const staged = `${FileSystem.cacheDirectory}ika-chunk-${sessionId}-${index}`
  await FileSystem.writeAsStringAsync(staged, b64, { encoding: FileSystem.EncodingType.Base64 })
  try {
    const res = await FileSystem.uploadAsync(
      `${API_BASE}/api/v1/uploads/sessions/${sessionId}/chunks/${index}`,
      staged,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${session.getToken() || ''}`,
          'Content-Type': 'application/octet-stream',
        },
      },
    )
    if (res.status === 401 && !retried) {
      const refreshed = await refreshSession()
      if (refreshed.ok) return putChunk(sessionId, index, uri, position, length, true)
    }
    if (res.status < 200 || res.status >= 300) {
      throw errorFromText(res.status, res.body || '', NaN)
    }
  } finally {
    FileSystem.deleteAsync(staged, { idempotent: true }).catch(() => {})
  }
}

/**
 * Upload one picked asset through a resumable session.
 * @param asset  expo-image-picker / expo-document-picker asset (or {uri,name,type})
 * @param surface backend MediaSurface name, e.g. 'CHAT_MEDIA'
 * @param onProgress fraction 0..1 across the whole file (chunk granularity)
 * @param signal AbortController.signal — aborting also cancels the session server-side
 * @returns IngestResult {assetId, kind, url, thumbnailUrl, storageKey, variants,
 *                        width, height, durationSeconds, bytes, mime, fileName, processing}
 */
export async function uploadChunked(asset, { surface, onProgress, signal } = {}) {
  const file = toUploadFile(asset, 'file')
  const totalBytes = await sizeOf(asset)
  if (!totalBytes) throw new Error('File size unavailable')

  const init = await http.post('/api/v1/uploads/sessions', {
    surface,
    fileName: file.name || 'file',
    mime: file.type || null,
    totalBytes,
  }, { signal })
  const { id, chunkBytes, totalChunks } = init

  let done = new Set()
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        for (let i = 0; i < totalChunks; i++) {
          if (signal?.aborted) throw abortError()
          if (done.has(i)) continue
          const position = i * chunkBytes
          const length = Math.min(chunkBytes, totalBytes - position)
          await putChunk(id, i, file.uri, position, length, false)
          done.add(i)
          onProgress?.(Math.min(1, (position + length) / totalBytes))
        }
        break
      } catch (e) {
        if (e?.name === 'AbortError' || e?.status || attempt >= ROUND_RETRIES) throw e
        // Network drop mid-chunk: ask the server what actually landed, resume.
        const status = await http.get(`/api/v1/uploads/sessions/${id}`, undefined, { signal })
        done = new Set(status?.receivedChunks || [])
      }
    }
    return await http.post(`/api/v1/uploads/sessions/${id}/complete`, undefined, { signal })
  } catch (e) {
    if (e?.name === 'AbortError') {
      http.del(`/api/v1/uploads/sessions/${id}`).catch(() => {})   // best-effort server cleanup
    }
    throw e
  }
}

/** IngestResult → the chat MediaRefDto shape (SendMessageRequest.media[]). */
export function refFrom(r, file = {}) {
  const gif = String(r.mime || file.type || '').toLowerCase() === 'image/gif'
  return {
    kind: gif ? 'GIF' : r.kind,
    storageKey: r.storageKey,
    url: r.url,
    thumbnailUrl: r.thumbnailUrl || null,
    mime: r.mime || file.type || undefined,
    bytes: r.bytes ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    durationMs: r.durationSeconds != null ? r.durationSeconds * 1000 : undefined,
    fileName: r.fileName || file.name || undefined,
  }
}
