/* =========================================================
   Shared upload policy — mirrors the backend's media.limits +
   media.security config (docs/media/uploads.md in the backend
   repo) so a doomed pick fails fast on-device instead of after
   a two-minute upload. The server re-checks everything; these
   numbers are a courtesy, not the authority.
   ========================================================= */

const MB = 1024 * 1024

/** Backend MediaKind mirror. */
export type FileKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'

export function kindOfMime(mime?: string | null, name?: string | null): FileKind {
  const t = String(mime || '').toLowerCase()
  if (t.startsWith('image/')) return 'IMAGE'
  if (t.startsWith('video/')) return 'VIDEO'
  if (t.startsWith('audio/')) return 'AUDIO'
  const ext = extOf(name)
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'].includes(ext)) return 'IMAGE'
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].includes(ext)) return 'VIDEO'
  if (['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) return 'AUDIO'
  return 'FILE'
}

export function extOf(name?: string | null): string {
  const s = String(name || '')
  const dot = s.lastIndexOf('.')
  return dot > 0 && dot < s.length - 1 ? s.slice(dot + 1).toLowerCase() : ''
}

/* Backend media.security.blocked-extensions mirror — executable/script types
   the server rejects with MEDIA_TYPE_BLOCKED on every surface. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'msi', 'scr', 'com', 'pif', 'cpl',
  'bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'csh',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta',
  'jar', 'class', 'apk', 'app', 'dmg', 'deb', 'rpm', 'run', 'elf',
])

/* Backend media.limits mirror, by kind. */
const KIND_CAPS: Record<FileKind, number> = {
  IMAGE: 25 * MB, VIDEO: 512 * MB, AUDIO: 20 * MB, FILE: 100 * MB,
}
/* Profile-class surfaces cap images at 10MB (MediaSurface.PROFILE_IMAGE_MAX_BYTES). */
const PROFILE_IMAGE_CAP = 10 * MB

export type UploadContext =
  | 'chat' | 'post' | 'story' | 'avatar' | 'cover'
  | 'channelPhoto' | 'channelCover' | 'research' | 'qna'

const PROFILE_CONTEXTS: UploadContext[] = ['avatar', 'cover', 'channelPhoto', 'channelCover']

export function capFor(context: UploadContext, kind: FileKind): number {
  if (kind === 'IMAGE' && PROFILE_CONTEXTS.includes(context)) return PROFILE_IMAGE_CAP
  return KIND_CAPS[kind]
}

/** The minimal slice of a picker asset the checks need — both expo-image-picker
 *  (`fileName`/`fileSize`/`mimeType`) and expo-document-picker (`name`/`size`/
 *  `mimeType`) shapes normalise into this. */
export interface CheckableAsset {
  name?: string | null
  fileName?: string | null
  size?: number | null
  fileSize?: number | null
  mimeType?: string | null
  type?: string | null
}

export interface AssetVerdict {
  asset: CheckableAsset
  reason: string
}

function nameOf(a: CheckableAsset): string {
  return String(a.fileName || a.name || '')
}
function bytesOf(a: CheckableAsset): number | null {
  const n = a.fileSize ?? a.size
  return typeof n === 'number' && n > 0 ? n : null
}
function mimeOf(a: CheckableAsset): string {
  /* image-picker's `type` is the coarse 'image'|'video' — usable as a family
     hint when mimeType is absent. */
  return String(a.mimeType || (a.type ? `${a.type}/*` : ''))
}

/**
 * Fail-fast split of picked assets into accepted + rejected-with-reason.
 * An asset whose size cannot be read locally passes — the server's cap is
 * authoritative and a false rejection is worse than a late one.
 */
export function checkAssets(
  assets: CheckableAsset[],
  context: UploadContext,
): { ok: CheckableAsset[]; rejected: AssetVerdict[] } {
  const ok: CheckableAsset[] = []
  const rejected: AssetVerdict[] = []
  for (const asset of assets || []) {
    const name = nameOf(asset)
    const ext = extOf(name)
    if (ext && BLOCKED_EXTENSIONS.has(ext)) {
      rejected.push({ asset, reason: `.${ext} files are not allowed` })
      continue
    }
    const kind = kindOfMime(mimeOf(asset), name)
    const bytes = bytesOf(asset)
    const cap = capFor(context, kind)
    if (bytes != null && bytes > cap) {
      rejected.push({ asset, reason: `too large — the limit is ${Math.round(cap / MB)} MB` })
      continue
    }
    ok.push(asset)
  }
  return { ok, rejected }
}
