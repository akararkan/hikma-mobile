/* =========================================================
   The long-press menu.

   One Modal rather than a quick-reaction popover plus a
   separate action sheet: they are opened by the same gesture
   and dismissed by the same tap, and two stacked modals on
   Android produce two back-button presses to close one menu.

   `mode` decides how much of it shows: a quick tap opens
   'reactOnly' (the bar, nothing else — a hold is what reaches
   the action list), a hold opens 'full' (bar + sheet, unchanged).

   The action list is computed from the permission matrix
   BEFORE it renders (see ./permissions.ts), so an entry the
   server would refuse is absent rather than present-and-failing.
   ========================================================= */
import React from 'react'
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, shape, space } from '@/theme/tokens'
import { ActionRow, Touchable, ZigguratCrown } from '@/ui'
import { QuickReactions } from './ReactionChips'
import { messageRights } from './permissions'

export type MessageAction =
  | 'reply' | 'copy' | 'forward' | 'star' | 'unstar' | 'pin' | 'unpin'
  | 'edit' | 'deleteMe' | 'deleteAll' | 'info' | 'select' | 'report'

export interface MessageMenuProps {
  visible: boolean
  onClose: () => void
  message: any
  convo: any
  myId: string | null
  /** Window-space top edge of the bubble, so the reaction bar lands on it. */
  anchorY: number
  anchorHeight: number
  /** 'reactOnly': quick tap, the bar alone. 'full': hold, bar + action sheet. */
  mode: 'full' | 'reactOnly'
  onReact: (emoji: string) => void
  onAction: (action: MessageAction) => void
}

const QUICK_BAR_H = 52

export function MessageMenu({
  visible, onClose, message, convo, myId, anchorY, anchorHeight, mode, onReact, onAction,
}: MessageMenuProps) {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()

  if (!visible || !message) return null

  const rights = messageRights(convo, message, myId)
  /* A tap with nothing to react with (reactions off, message dead/pending)
     has nothing to show — unlike 'full' it has no action list to fall back
     to, so it is a no-op rather than an empty overlay. */
  if (mode === 'reactOnly' && !rights.react) return null
  const pinned = !!message._pinned
  const mine = !!myId && String(message.senderId) === String(myId)

  /* Sit the bar above the bubble; flip below when the bubble is at the very
     top of the list and there is no room. */
  const above = anchorY - QUICK_BAR_H - 10
  const barTop = above > insets.top + 8 ? above : Math.min(anchorY + anchorHeight + 10, screenH * 0.5)

  const run = (a: MessageAction) => () => { onClose(); setTimeout(() => onAction(a), 90) }

  const entries: { label: string; icon: any; onPress: () => void; destructive?: boolean; hidden?: boolean }[] = [
    { label: 'Reply', icon: 'reply', onPress: run('reply'), hidden: !rights.reply },
    { label: 'Copy', icon: 'copy', onPress: run('copy'), hidden: !rights.copy },
    { label: 'Forward', icon: 'forwardMsg', onPress: run('forward'), hidden: !rights.forward },
    {
      label: message.starred ? 'Unstar' : 'Star',
      icon: 'star',
      onPress: run(message.starred ? 'unstar' : 'star'),
      hidden: !rights.star,
    },
    {
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? 'unpin' : 'pin',
      onPress: run(pinned ? 'unpin' : 'pin'),
      hidden: !rights.pin,
    },
    { label: 'Edit', icon: 'edit', onPress: run('edit'), hidden: !rights.edit },
    { label: 'Message info', icon: 'info', onPress: run('info'), hidden: !rights.info },
    { label: 'Select', icon: 'checkCircle', onPress: run('select'), hidden: false },
    /* Hidden, not disabled, on your own messages — the same rule as the
       permission-matrix entries: an action the server would refuse is absent.
       The reason picker and the write live on the screen (MESSAGE reports
       never route through /report — a body in route params is persisted
       navigation state). */
    { label: 'Report', icon: 'flag', onPress: run('report'), destructive: true, hidden: mine },
    {
      label: 'Delete for everyone',
      icon: 'trash',
      onPress: run('deleteAll'),
      destructive: true,
      hidden: !rights.deleteForEveryone,
    },
    {
      label: mine || !rights.deleteForEveryone ? 'Delete for me' : 'Delete for me only',
      icon: 'trash',
      onPress: run('deleteMe'),
      destructive: true,
      hidden: !rights.deleteForMe,
    },
  ].filter(e => !e.hidden)

  const enter = t.prefs.reducedMotion ? undefined : FadeInDown.duration(t.ms(200))

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(160))}
        exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(120))}
        style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
      >
        <Touchable onPress={onClose} feedback="none" noAutoHitSlop style={StyleSheet.absoluteFill} accessibilityLabel="Close menu">
          <View />
        </Touchable>
      </Animated.View>

      {rights.react ? (
        <Animated.View entering={enter} style={[styles.bar, { top: barTop }]}>
          <QuickReactions
            current={(message.reactions || []).find((r: any) => r.reactedByMe)?.emoji}
            onPick={e => { onClose(); setTimeout(() => onReact(e), 60) }}
          />
        </Animated.View>
      ) : null}

      {mode === 'full' ? (
        <Animated.View
          entering={enter}
          /* Sheet setback (18 crowned / 0 rooted) and a drawn top course for
             separation — QELAT has no shadows, so depth is the border weight
             (DESIGN.md §6, Sheet). */
          style={[
            styles.sheet,
            {
              backgroundColor: c.bgElevated,
              borderTopColor: c.borderStrong,
              paddingBottom: Math.max(insets.bottom, 10),
              maxHeight: screenH * 0.6,
            },
          ]}
        >
          <View style={styles.grabberWrap}>
            <ZigguratCrown />
          </View>
          {/* The entry list can run to eleven rows (an admin's own pinned
              message), which overruns the 0.6-screen cap on small phones — the
              deletes were unreachable. The rows scroll inside the cap. */}
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={styles.entryScroll}>
            {entries.map(e => (
              <ActionRow key={e.label} label={e.label} icon={e.icon} destructive={e.destructive} onPress={e.onPress} />
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', alignSelf: 'center' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: rule.course,
    ...setback(shape.sheet), borderCurve: 'continuous',
  },
  grabberWrap: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
  /* Yoga's default flexShrink is 0 — without this the ScrollView keeps its
     full content height inside the maxHeight plate and clips exactly like
     the bare View it replaced. */
  entryScroll: { flexShrink: 1 },
})
