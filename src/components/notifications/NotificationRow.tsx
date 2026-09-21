/* =========================================================
   The inbox row.

   Purely presentational: every mutation is delegated upward,
   because the same row is rendered inside a swipeable, inside
   selection mode, and inside a long-press sheet's preview, and
   only the screen knows which of those is in play.

   `title` and `body` are printed verbatim. They are composed
   server-side and already read "Ali and 3 others reacted…",
   so re-templating them here would both duplicate the backend's
   copy table and break the moment aggregation changes.

   MEMOIZED, and the props are the reason it can be: every
   handler is item-first (`onPress(row)`) so the screen hands one
   identity-stable function to every row, and `selected` arrives
   as a BOOLEAN rather than the Set it came from. Hand it a fresh
   lambda or the Set itself and the memo never hits — which on
   this screen means repainting the viewport on every SSE frame.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
/* Deep import: the barrel does not re-export moderationKindOf, and it is the
   one sanctioned place in the whole client where notification COPY may be
   read (three exact SYSTEM_MESSAGE titles — see api/notifications.js). */
import { moderationKindOf } from '@/api/notifications.js'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'
import { kindOf, toneColors } from './constants'
import type { NotifRow } from './types'

export const ROW_INSET = 72          // avatar block + gutter — the separator inset

export interface NotificationRowProps {
  row: NotifRow
  selectionMode?: boolean
  selected?: boolean
  onPress: (row: NotifRow) => void
  onLongPress: (row: NotifRow) => void
  onModerationPress?: (row: NotifRow) => void
}

export const NotificationRow = React.memo(function NotificationRow({
  row, selectionMode, selected, onPress, onLongPress, onModerationPress,
}: NotificationRowProps) {
  const t = useTheme()
  const c = t.colors

  const moderation = moderationKindOf(row)
  const kind = kindOf(row.type, moderation)
  const tint = toneColors(c, kind.tone)
  const human = !!row._actor?.id && !moderation

  return (
    <View style={{ backgroundColor: row.unread ? c.accentSofter : c.bg }}>
      {/* A row with no deep link is deliberately inert — it still marks read
          on tap, so it keeps a press, but a scale rather than the
          navigational tint that promises a destination. */}
      <Touchable
        onPress={() => onPress(row)}
        onLongPress={() => onLongPress(row)}
        delayLongPress={500}
        feedback={row.deepLink || selectionMode ? 'tint' : 'scale'}
        noAutoHitSlop
        accessibilityLabel={`${row.title}. ${row.body}`}
        accessibilityState={{ selected: !!selected }}
        style={[styles.row, { paddingVertical: space.md * t.densityScale }]}
      >
        {selectionMode ? (
          <View style={styles.checkbox}>
            {selected
              ? <Icon name="checkCircle" size={22} filled color={c.accent} />
              : <View style={[styles.emptyCheck, { borderColor: c.borderStrong }]} />}
          </View>
        ) : null}

        <View style={styles.leading}>
          {human ? (
            <>
              <Avatar uri={row._actor.profileImage} name={row._actor.full} seed={row._actor.id} size={44} />
              {/* The kind badge only makes sense on a face — a system tile is
                  already the glyph, and stacking two would say it twice. */}
              <View style={[styles.badge, { backgroundColor: tint.fg, borderColor: c.bg }]}>
                <Icon name={kind.icon} size={11} color={c.textOnAccent} filled />
              </View>
            </>
          ) : (
            <View style={[styles.tile, { backgroundColor: tint.soft }]}>
              <Icon name={kind.icon} size={22} color={tint.fg} />
            </View>
          )}
        </View>

        <View style={styles.middle}>
          <Text variant="body" weight={row.unread ? '600' : '500'} numberOfLines={1} ellipsizeMode="tail">
            {row.title}
          </Text>
          {row.body ? (
            <Text variant="callout" tone="secondary" numberOfLines={2} style={styles.body}>
              {row.body}
            </Text>
          ) : null}

          <View style={styles.meta}>
            <Text variant="footnote" tone="faint" align="ui">{row.time}</Text>
            {row.aggregateCount > 1 ? (
              <>
                <Text variant="footnote" tone="faint" align="ui">·</Text>
                {/* A count PLATE, not the sanctioned unread pill: it carries a
                    label ("3×"), so it wears the chip setback. */}
                <View style={[styles.countPlate, { backgroundColor: tint.soft }]}>
                  <Text variant="caption" color={tint.fg} align="ui">{`${row.aggregateCount}×`}</Text>
                </View>
              </>
            ) : null}
          </View>

          {moderation ? (
            <Touchable
              onPress={() => onModerationPress?.(row)}
              feedback="dim"
              style={styles.learnMore}
              accessibilityLabel="Learn more about this decision"
            >
              <Text variant="footnote" tone="accent" align="ui">Learn more</Text>
            </Touchable>
          ) : null}
        </View>

        {row.unread && !selectionMode ? (
          /* (body lineHeight − dot 8) / 2 — centred on the title's first
             line. Computed from the LIVE token, because the theme scales the
             type ramp by the user's fontScale; densityScale only moves the
             row padding, which flex-start alignment already rides. */
          <View style={[styles.dot, { backgroundColor: c.accent, marginTop: (t.type.body.lineHeight - 8) / 2 }]} />
        ) : null}
      </Touchable>

      <View style={[styles.separator, { backgroundColor: c.separator, marginStart: ROW_INSET }]} />
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    minHeight: 76,
  },
  checkbox: { width: 34, paddingTop: space.md, alignItems: 'flex-start' },
  emptyCheck: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5 },
  leading: { width: 44, height: 44 },
  badge: {
    position: 'absolute',
    end: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, marginStart: space.md, marginEnd: space.sm },
  body: { marginTop: space.xxs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs },
  countPlate: {
    height: 18,
    minWidth: 26,
    paddingHorizontal: space.xs2,
    alignItems: 'center',
    justifyContent: 'center',
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  learnMore: { marginTop: space.xs2, alignSelf: 'flex-start' },
  /* marginTop lives at the call site — it depends on the fontScale-scaled
     body lineHeight, which a static sheet cannot know. */
  dot: { width: 8, height: 8, borderRadius: 4 },
  separator: { height: StyleSheet.hairlineWidth },
})
