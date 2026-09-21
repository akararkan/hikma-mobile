/* =========================================================
   StatusPill — the lifecycle chip.

   SCHEDULED is not a status on the wire: it is a DRAFT with a
   future `scheduledPublishAt`. Deriving it here means no screen
   has to remember that, and no screen can accidentally read a
   DRAFT as a moderation hold — those are different states with
   different copy.
   ========================================================= */
import React from 'react'
import { Chip, type ChipTone } from '@/ui'
import { formatDateTime } from './format'
import type { ResearchStatus } from './types'

export function isScheduled(status: string | null | undefined, at: string | null | undefined): boolean {
  if (String(status || '').toUpperCase() !== 'DRAFT' || !at) return false
  const when = new Date(at).getTime()
  return !isNaN(when) && when > Date.now()
}

export function statusTone(status: ResearchStatus | string, scheduled = false): ChipTone {
  if (scheduled) return 'warning'
  switch (String(status || '').toUpperCase()) {
    case 'PUBLISHED': return 'success'
    case 'RETRACTED': return 'danger'
    case 'ARCHIVED': return 'neutral'
    default: return 'neutral'
  }
}

export function statusLabel(status: ResearchStatus | string, scheduled = false): string {
  if (scheduled) return 'Scheduled'
  switch (String(status || '').toUpperCase()) {
    case 'PUBLISHED': return 'Published'
    case 'RETRACTED': return 'Retracted'
    case 'ARCHIVED': return 'Archived'
    default: return 'Draft'
  }
}

export function StatusPill({
  status, scheduledPublishAt, size = 'sm', withTime = false,
}: {
  status: ResearchStatus | string
  scheduledPublishAt?: string | null
  size?: 'sm' | 'md'
  withTime?: boolean
}) {
  const scheduled = isScheduled(status, scheduledPublishAt)
  const base = statusLabel(status, scheduled)
  const label = scheduled && withTime ? `${base} · ${formatDateTime(scheduledPublishAt)}` : base
  return <Chip label={label} tone={statusTone(status, scheduled)} size={size} icon={scheduled ? 'clock' : undefined} />
}
