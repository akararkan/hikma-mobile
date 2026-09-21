/* =========================================================
   ModerationSystemRow — the inbox row for the three automated
   moderation system messages.

   `title` and `body` are printed VERBATIM. They already carry
   the ENTITY_LABEL noun interpolated server-side ("Your story
   cleared review…"), so re-templating them here would both
   duplicate the backend's copy table and let the badge and the
   bell disagree about what was held.

   These rows carry no resourceId, no resourceType and no deep
   link of any kind — the entity behind "was removed" is gone,
   and "is live" never says which post it was. `linkOf()` sends
   all three to the literal string '/settings/safety#moderation';
   expo-router cannot route a fragment, so the press handler
   strips it and passes `section` as a param instead.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { moderationKindOf } from '@/api/notifications.js'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable, type IconName } from '@/ui'

export type ModerationNotifKind = 'removed' | 'review' | 'live'

/** The destination `linkOf()` means when it returns
 *  '/settings/safety#moderation'. Exported so the inbox can route the row
 *  without re-deriving the fragment split. */
export const MODERATION_NOTIF_HREF = {
  pathname: '/settings/safety' as const,
  params: { section: 'moderation' },
}

export interface ModerationSystemRowProps {
  /** A `notifFrom()` row — carries `type`, `title`, `body`, `time`, `unread`. */
  notification: any
  onPress?: () => void
  onLongPress?: () => void
  selected?: boolean
}

export function ModerationSystemRow({
  notification, onPress, onLongPress, selected,
}: ModerationSystemRowProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()

  /* null falls straight through: every other SYSTEM_MESSAGE keeps rendering as
     the ordinary system row, so an upstream title tweak costs a bespoke icon,
     never a wrong one. */
  const kind = moderationKindOf(notification) as ModerationNotifKind | null
  if (!kind) return null

  const skin = kind === 'removed'
    ? { icon: 'block' as IconName, fg: c.dangerText, bg: c.dangerSoft }
    : kind === 'review'
      ? { icon: 'eyeOff' as IconName, fg: c.warningText, bg: c.warningSoft }
      : { icon: 'checkCircle' as IconName, fg: c.successText, bg: c.successSoft }

  return (
    <View style={{ backgroundColor: notification?.unread ? c.accentSofter : c.bg }}>
      {notification?.unread ? <View style={[styles.unreadBar, { backgroundColor: c.accent }]} /> : null}
      <Touchable
        onPress={onPress ?? (() => router.push(MODERATION_NOTIF_HREF))}
        onLongPress={onLongPress}
        delayLongPress={500}
        feedback="tint"
        noAutoHitSlop
        accessibilityLabel={`${notification?.title ?? ''}. ${notification?.body ?? ''}`}
        accessibilityState={{ selected: !!selected }}
        style={[styles.row, { paddingVertical: space.md * t.densityScale }]}
      >
        <View style={[styles.tile, { backgroundColor: skin.bg }]}>
          <Icon name={skin.icon} size={19} color={skin.fg} />
        </View>

        <View style={styles.flex}>
          <Text variant="bodyStrong" align="auto" numberOfLines={2}>{notification?.title}</Text>
          {notification?.body ? (
            <Text variant="footnote" tone="secondary" align="auto" style={{ marginTop: space.xxs }}>
              {notification.body}
            </Text>
          ) : null}
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
            {notification?.time}
          </Text>
        </View>
      </Touchable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg },
  tile: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  unreadBar: { position: 'absolute', top: 0, bottom: 0, start: 0, width: 3 },
  flex: { flex: 1 },
})
