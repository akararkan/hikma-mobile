/* =========================================================
   The degraded banner.

   `GET /api/v1/search` soft-fails when Elasticsearch is down:
   200 with `{ results: [], degraded: true }` and an
   `X-Search-Degraded: true` header. That is NOT an error — no
   toast, no ErrorState — and it is NOT an absence either, so
   mounting this must suppress the empty state. `degraded: false`
   plus an empty list is the only genuine "nothing matched".

   Tag and trending surfaces sit on a different datastore and
   keep rendering while this is up.
   ========================================================= */
import React from 'react'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Callout } from '@/ui'

export interface SearchDegradedBannerProps {
  visible: boolean
  onRetry: () => void
}

export function SearchDegradedBanner({ visible, onRetry }: SearchDegradedBannerProps) {
  const t = useTheme()
  if (!visible) return null
  return (
    <Callout
      tone="warning"
      icon="warning"
      actionLabel="Retry"
      onAction={onRetry}
      style={{ marginHorizontal: t.layout.screenPadding, marginTop: space.md }}
    >
      Search is temporarily unavailable. Try again in a moment.
    </Callout>
  )
}
