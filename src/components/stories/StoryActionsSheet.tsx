/* =========================================================
   StoryActionsSheet — the ⋯ menu.

   Owner rows and non-owner rows are disjoint on purpose: no
   Delete for someone else's frame, no Report for your own. The
   error guide's rule is that you should never see an ownership
   403, because the control that produces one was never
   rendered.
   ========================================================= */
import React from 'react'
import { ActionSheet, Sheet, Text, Touchable, toast } from '@/ui'
import { StyleSheet, View } from 'react-native'
import { REPORT_REASONS, api, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { useAction } from '@/hooks/useAsync'
import type { StoryRow } from './storyVisual'

export interface StoryActionsSheetProps {
  visible: boolean
  onClose: () => void
  story: StoryRow | null
  isOwner: boolean
  onInsights?: () => void
  onAddToHighlight?: () => void
  onDelete?: () => void
  onProfile?: () => void
  onMute?: () => void
  onReport?: () => void
  onShare?: () => void
  onCopyLink?: () => void
  onSendMessage?: () => void
}

export function StoryActionsSheet({
  visible, onClose, story, isOwner,
  onInsights, onAddToHighlight, onDelete,
  onProfile, onMute, onReport, onShare, onCopyLink, onSendMessage,
}: StoryActionsSheetProps) {
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      actions={isOwner ? [
        { label: 'Insights', icon: 'stats', onPress: () => onInsights?.() },
        { label: 'Add to highlight', icon: 'bookmark', onPress: () => onAddToHighlight?.() },
        { label: 'Send in a message', icon: 'chat', onPress: () => onSendMessage?.(), hidden: !onSendMessage },
        { label: 'Share', icon: 'share', onPress: () => onShare?.(), hidden: !onShare },
        { label: 'Delete', icon: 'trash', destructive: true, onPress: () => onDelete?.() },
      ] : [
        { label: 'View profile', icon: 'person', onPress: () => onProfile?.() },
        { label: 'Mute stories', icon: 'mutedBell', onPress: () => onMute?.() },
        { label: 'Send in a message', icon: 'chat', onPress: () => onSendMessage?.(), hidden: !onSendMessage },
        { label: 'Share', icon: 'share', onPress: () => onShare?.(), hidden: !onShare },
        { label: 'Copy link', icon: 'link', onPress: () => onCopyLink?.(), hidden: !onCopyLink },
        { label: 'Report', icon: 'flag', destructive: true, onPress: () => onReport?.() },
      ]}
    />
  )
}

/* ---------------------------------------------------------
   Report — reason first, then one call.

   Deduped server-side: an open report for the same target and
   reason comes back as-is, so a second report is a success,
   not a conflict.
   --------------------------------------------------------- */

export function ReportStorySheet({
  visible, onClose, storyId,
}: { visible: boolean; onClose: () => void; storyId: string | null }) {
  const t = useTheme()
  const { run, pending } = useAction(
    /* targetRef is the MESSAGE-only Snowflake channel (settings.js safety.report)
       — a STORY id is a UUID and rides in targetId. */
    (reason: string) => api.settings.safety.report({ targetType: 'STORY', targetId: storyId, targetRef: undefined, reason, details: undefined }),
    {
      onSuccess: () => { onClose(); toast.ok('Thanks — our team will take a look.') },
      onError: (e: any) => toast.error(errorText(e)),
    },
  )

  return (
    <Sheet visible={visible} onClose={onClose} title="Report story" subtitle="What's wrong with it?">
      <View style={{ paddingBottom: space.sm }}>
        {(REPORT_REASONS as [string, string][]).map(([value, label]) => (
          <Touchable
            key={value}
            onPress={() => { if (storyId) void run(value) }}
            disabled={pending || !storyId}
            feedback="tint"
            noAutoHitSlop
            style={[styles.reason, { borderBottomColor: t.colors.separator }]}
          >
            <Text variant="body" align="ui">{label}</Text>
          </Touchable>
        ))}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  reason: { paddingHorizontal: space.xl, height: 52, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
})
