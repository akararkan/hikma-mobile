/* =========================================================
   Resolve a research share-token short link.

   The backend mints `shareUrl` as https://…/r/{token}
   (research.md "Get by share token"), so this route sits at
   /r/[token] to match that path shape — a tapped short link
   lands here file-based, the same way /u, /c and /join mirror
   their web paths. Resolution and failure UI are the slug
   landing's ResolveSplash; only the lookup differs.

   The token is minted at creation and never regenerated — a
   dead link means the paper is gone or hidden (a block edge
   answers 404 exactly like a deletion), not that the link
   went stale. Archived and retracted papers resolve by
   design; the detail screen renders their banners.
   ========================================================= */
import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { adapters, api } from '@/api'
import { ResolveSplash } from '@/app/(app)/research/slug/[slug]'
import type { ResearchDetail } from '@/components/research/types'

export default function ShareTokenLandingScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const decoded = decodeURIComponent(String(token || ''))
  return (
    <ResolveSplash
      resolve={async () => adapters.researchDetailFrom(await api.research.byShareToken(decoded)) as ResearchDetail}
      enabled={!!decoded}
      title="This paper could not be found."
      body="The share link may be broken, or the paper may have been removed."
    />
  )
}
