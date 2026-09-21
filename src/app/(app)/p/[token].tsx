/* =========================================================
   Land a post short link.

   The backend mints every post share link as {base}/p/{token}
   (post/engagement.md §5.3), and the token IS the post id — so
   this route exists purely so a tapped short link resolves
   file-based, the same way /r, /c, /u and /join mirror their
   web paths. No lookup to do: hand the id straight to the post
   screen, whose own 404 state covers a dead link.
   ========================================================= */
import React from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function PostShortLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  return <Redirect href={`/post/${decodeURIComponent(String(token || ''))}`} />
}
