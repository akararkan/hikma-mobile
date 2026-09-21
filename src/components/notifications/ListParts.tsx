/* =========================================================
   The small shared list furniture: the sticky date header, the
   floating "{n} new" pill, the scan-window footnote and the
   domain's skeletons.

   They live together because they are all one-screenful of
   markup each and all four are used by both the inbox and the
   activity list — splitting them into four files would cost
   more imports than it saves.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Skeleton, Text, Touchable } from '@/ui'

/* ---------------------------------------------------------
   Sticky section header.

   The eyebrow is `caption`, which uppercases and tracks LATIN
   ONLY inside the Text primitive. A call-site .toUpperCase()
   would also hit Arabic and Kurdish, which have no case — hence
   neither the transform nor the letterSpacing lives here.
   --------------------------------------------------------- */

export const SECTION_HEADER_HEIGHT = 32

/* Module scope: it is passed straight to a FlashList renderItem, and a
   component type re-created per render remounts every sticky header. */
export function DateSectionHeader({ title }: { title: string }) {
  const t = useTheme()
  return (
    <View style={[styles.sectionHeader, { backgroundColor: t.colors.bgSunken, borderColor: t.colors.separator }]}>
      <Text variant="caption" tone="faint" align="ui">{title}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   "{n} new" pill.
   --------------------------------------------------------- */

export function NewItemsPill({
  count, onPress, top,
}: { count: number; onPress: () => void; top: number }) {
  const t = useTheme()
  if (count <= 0) return null
  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeInDown.springify().damping(18)}
      exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(140))}
      style={[styles.pillWrap, { top }]}
      pointerEvents="box-none"
    >
      <Touchable
        onPress={onPress}
        haptic="light"
        feedback="scale"
        accessibilityLabel={`${count} new. Scroll to top`}
        /* A button-sized setback plate, not a pill: the only sanctioned pills
           are unread counters and LIVE badges. It floats over the list, so the
           1px border in accentPressed is what separates it — never a shadow. */
        style={[styles.plate, { backgroundColor: t.colors.accent, borderColor: t.colors.accentPressed }]}
      >
        <Icon name="up" size={15} color={t.colors.textOnAccent} />
        <Text variant="subhead" weight="600" color={t.colors.textOnAccent} align="ui">
          {count === 1 ? '1 new' : `${count} new`}
        </Text>
      </Touchable>
    </Animated.View>
  )
}

/* ---------------------------------------------------------
   The scan-window note.

   Exists so the server's documented limits (the inbox's 200-row
   filter window, the activity clear's 10k cap, the reel
   history's 240-row ceiling) are said out loud instead of
   looking like a list that mysteriously stops.
   --------------------------------------------------------- */

export function ScanWindowNote({ text }: { text: string }) {
  const t = useTheme()
  return (
    <View style={[styles.note, { backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.borderFaint }]}>
      <Icon name="info" size={15} color={t.colors.textFaint} />
      <Text variant="footnote" tone="faint" align="ui" style={styles.flex}>{text}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Skeletons. One component per screen shape so every surface
   in the domain shimmers at the same cadence.
   --------------------------------------------------------- */

export function NotificationSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton circle width={44} height={44} />
          <View style={styles.skelBody}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="88%" height={10} />
            <Skeleton width={40} height={9} />
          </View>
        </View>
      ))}
    </View>
  )
}

export function ActivitySkeleton({ count = 10 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skelActivityRow}>
          <Skeleton width={36} height={36} radius={11} />
          <View style={styles.skelBody}>
            <Skeleton width="55%" height={12} />
            <Skeleton width="75%" height={10} />
          </View>
          <Skeleton width={28} height={9} />
        </View>
      ))}
    </View>
  )
}

export function ReelGridSkeleton({ count = 12, cellWidth }: { count?: number; cellWidth: number }) {
  const t = useTheme()
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View
          key={i}
          entering={t.prefs.reducedMotion ? undefined : FadeIn.delay(i * 18)}
          style={styles.gridCell}
        >
          <Skeleton width={cellWidth} height={cellWidth * (16 / 9)} radius={0} />
        </Animated.View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    height: SECTION_HEADER_HEIGHT,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    /* Ruled on both edges: rows slide beneath the pinned copy, and the fill
       alone doesn't draw that boundary. */
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  plate: {
    height: 34,
    paddingHorizontal: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    borderWidth: 1,
    ...setback(shape.buttonMd),
    borderCurve: 'continuous',
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginVertical: space.md2,
    padding: space.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },

  skelRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 76 },
  skelActivityRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md2, alignItems: 'center' },
  skelBody: { flex: 1, gap: space.sm, paddingTop: space.xxs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { padding: space.xxs },
})
