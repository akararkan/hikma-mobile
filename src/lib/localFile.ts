/* =========================================================
   Remote URL → local file URI.

   expo-sharing and expo-media-library take FILE URIs; handing
   them the media proxy's http(s) URL throws on iOS and no-ops
   on Android. The proxy is public and honours Range (see the
   note atop chat/[id]/viewer.tsx), so a plain download with no
   auth plumbing is the whole job.
   ========================================================= */
import * as FileSystem from 'expo-file-system/legacy'

/** Download `url` into the app cache and return a file URI that native
 *  share/save APIs accept. Local URIs pass through untouched. */
export async function toLocalFile(url: string, fallbackName = 'file'): Promise<string> {
  if (!/^https?:/i.test(url)) return url
  /* A server-supplied name lands in a path — strip anything that could climb
     out of the cache directory (same rule as platform/files.js). */
  const name = (url.split('/').pop()?.split('?')[0] || fallbackName)
    .replace(/[/\\]/g, '_').replace(/^\.+/, '') || fallbackName
  const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}`)
  return uri
}
