/* =========================================================
   Building a chat/channel MediaRefDto from a media-API upload.

   Two APIs meet here and they name the same object differently.
   The media pipeline answers with a MediaStatusResponse whose
   renditions carry a public `url`; chat wants a `storageKey`,
   which nothing in that response spells out.

   media-proxy.md is what closes the gap: the proxy route is
   `GET /api/v1/media/**` and "everything after /api/v1/media/ is
   the storage object key, slashes included". So the key is a
   substring of the url the upload already handed back — derived,
   not guessed.

   `url` is passed along beside it precisely so the derived key is
   never load-bearing for display: ChatMapper prefers the url, and
   the key only has to be right for storage bookkeeping. It also
   travels RAW — never assetUrl()'d — because a persisted absolute
   url pins the row to whichever host this device happened to use.
   ========================================================= */

const PROXY = '/api/v1/media/'

/** The object key behind a media-proxy url, or null when the url did not come
 *  from the proxy (a CDN host, say) and therefore has no derivable key. */
export function storageKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const i = String(url).indexOf(PROXY)
  if (i < 0) return null
  const key = String(url).slice(i + PROXY.length)
  /* Strip a query string: the proxy takes none today, but a signed variant
     would make the key wrong in a way nothing downstream could detect. */
  const clean = key.split('?')[0].split('#')[0]
  return clean || null
}

export interface MediaRef {
  kind: string
  storageKey: string
  url: string
  mime?: string
  bytes?: number
  width?: number
  height?: number
  durationMs?: number
  fileName?: string
  altText?: string
}

/** Fold one completed upload into the ref shape chat accepts. Returns null
 *  when the response carries no usable public url or no derivable key — the
 *  caller must refuse rather than send a ref the server cannot resolve. */
export function mediaRefFrom(
  uploaded: any,
  kind: string,
  file: { type?: string; name?: string } = {},
): MediaRef | null {
  const renditions: any[] = uploaded?.renditions || []
  const main = renditions.find(r => r?.label === 'original') || renditions[0]
  const url: string | null = main?.url || uploaded?.url || null
  const storageKey = storageKeyFromUrl(url) || uploaded?.storageKey || uploaded?.s3Key || null
  if (!url || !storageKey) return null
  return {
    kind,
    storageKey,
    url,
    mime: file.type || main?.mime || undefined,
    bytes: uploaded?.storedBytes ?? main?.bytes ?? undefined,
    width: uploaded?.width ?? main?.width ?? undefined,
    height: uploaded?.height ?? main?.height ?? undefined,
    durationMs: uploaded?.durationMs ?? undefined,
    fileName: file.name || undefined,
  }
}
