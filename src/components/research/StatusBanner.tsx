/* =========================================================
   StatusBanner — the full-bleed band under the detail hero.

   The retraction copy is fixed and deliberate: a retracted
   paper stays readable because citations pointing at it must
   keep resolving. Saying so is the difference between "this
   was withdrawn" and "this was deleted and something is
   broken".
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, type IconName } from '@/ui'
import { heldEdit } from '@/lib/moderation'
import { ModerationNotice } from './states'
import { formatDateTime } from './format'
import { isScheduled } from './StatusPill'
import type { ResearchStatus } from './types'

export function StatusBanner({
  status, scheduledPublishAt, publishedAt, isOwner, heldState, onPublish, onEditSchedule,
}: {
  status: ResearchStatus | string
  scheduledPublishAt?: string | null
  isOwner: boolean
  heldState?: 'checking' | 'review' | null
  /** Needed to tell a paper moderation pulled back into draft from an ordinary
   *  draft — see heldEdit in src/lib/moderation.js. */
  publishedAt?: string | null
  onPublish?: () => void
  onEditSchedule?: () => void
}) {
  const t = useTheme()
  const c = t.colors

  if (heldState) {
    return <ModerationNotice state={heldState} style={{ marginHorizontal: space.lg, marginTop: space.md }} />
  }

  /* An edit to a published paper that is still being checked takes the paper
     back to draft until it clears. Telling the author "Draft — only you can
     see this. [Publish]" would be wrong twice over: it was published, and
     pressing Publish is not what makes it come back. */
  if (isOwner && heldEdit({ status, publishedAt })) {
    return <ModerationNotice state="checking" style={{ marginHorizontal: space.lg, marginTop: space.md }} />
  }

  const s = String(status || '').toUpperCase()
  const scheduled = isScheduled(s, scheduledPublishAt)

  let skin: { bg: string; fg: string; icon: IconName } | null = null
  let title = ''
  let body = ''
  let action: { label: string; onPress?: () => void } | null = null

  if (s === 'RETRACTED') {
    skin = { bg: c.dangerSoft, fg: c.dangerText, icon: 'warning' }
    title = 'RETRACTED'
    body = 'This paper was retracted by its corresponding researcher. It remains readable for citation integrity.'
  } else if (s === 'ARCHIVED') {
    skin = { bg: c.surfaceSunken, fg: c.textSecondary, icon: 'archive' }
    title = 'Archived'
    body = 'No longer listed in feeds or search.'
  } else if (s === 'DRAFT' && isOwner) {
    skin = { bg: c.warningSoft, fg: c.warningText, icon: scheduled ? 'clock' : 'edit' }
    title = scheduled ? `Scheduled for ${formatDateTime(scheduledPublishAt)}` : 'Draft'
    body = scheduled
      ? 'It publishes itself within about a minute of that time.'
      : 'Only you can see this.'
    action = scheduled
      ? { label: 'Change', onPress: onEditSchedule }
      : { label: 'Publish', onPress: onPublish }
  }

  if (!skin) return null

  return (
    <View style={[styles.band, { backgroundColor: skin.bg }]}>
      <Icon name={skin.icon} size={17} color={skin.fg} style={{ marginTop: space.xxs }} />
      <View style={styles.flex}>
        <Text variant="subhead" weight="700" color={skin.fg} align="ui">{title}</Text>
        <Text variant="footnote" color={skin.fg} align="ui" style={{ marginTop: space.xxs, opacity: 0.92 }}>{body}</Text>
      </View>
      {action?.onPress ? (
        <Touchable onPress={action.onPress} feedback="dim" style={styles.action}>
          <Text variant="subhead" weight="700" color={skin.fg} align="ui" underline>{action.label}</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', gap: space.sm2, alignItems: 'flex-start', paddingHorizontal: space.lg, paddingVertical: space.md },
  action: { paddingVertical: space.xxs, paddingHorizontal: space.xxs },
  flex: { flex: 1 },
})
