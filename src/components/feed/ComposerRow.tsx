/* =========================================================
   ComposerRow — the first plate in the timeline.

   A feed that opens with somebody else's post tells you what
   the app is for; a feed that opens with YOUR OWN face and an
   invitation tells you what you can do in it. That is the whole
   argument for this row, and it is why it sits above the story
   tray rather than below it.

   It does not duplicate the FAB. The FAB is the full chooser
   (six things this app makes, each named); this is the three
   the timeline itself is made of — a post, a reel, a story —
   plus the well, which is the same door as "Post".

   The quick actions carry the Oxford mark rather than a colour
   each: one accent per element (DESIGN.md §10.10), and a row of
   traffic-light glyphs is a different app's identity.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, type IconName } from '@/ui'
import { FEED_GUTTER, feedPlate, feedRule } from './plate'

/** First name only — "What's on your mind, Ahmed?" reads as a person
 *  speaking; the full legal name reads as a form. */
function firstName(full?: string | null): string {
  const s = String(full || '').trim()
  if (!s) return ''
  return s.split(/\s+/)[0]
}

export const ComposerRow = React.memo(function ComposerRow() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()

  const name = firstName(user?.displayName || user?.full)
  const invite = name ? `What's on your mind, ${name}?` : "What's on your mind?"

  return (
    <View style={[feedPlate, styles.plate, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <View style={styles.row}>
        <Avatar
          uri={user?.profileImage}
          name={user?.displayName || user?.full}
          seed={user?.id}
          size={38}
          onPress={() => router.push('/profile')}
          accessibilityLabel="Your profile"
        />
        <Touchable
          onPress={() => router.push('/compose')}
          feedback="tint"
          noAutoHitSlop
          accessibilityLabel={invite}
          accessibilityRole="button"
          style={[styles.well, {
            backgroundColor: c.surfaceSunken,
            borderColor: c.border,
            borderRadius: t.radius.field,
          }]}
        >
          <Text variant="subhead" tone="muted" numberOfLines={1} align="auto">{invite}</Text>
        </Touchable>
      </View>

      <View style={[feedRule, styles.rule, { backgroundColor: c.separator }]} />

      <View style={styles.quick}>
        <Quick icon="image" label="Photo" onPress={() => router.push('/compose?pick=library')} />
        <Quick icon="reels" label="Reel" onPress={() => router.push('/reels/compose')} />
        <Quick icon="camera" label="Story" onPress={() => router.push('/story/compose')} />
      </View>
    </View>
  )
})

function Quick({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      feedback="tint"
      haptic="light"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.quickCell, { borderRadius: t.radius.xs }]}
    >
      <Icon name={icon} size={18} color={c.accent} />
      <Text variant="footnote" weight="600" tone="secondary" numberOfLines={1}>{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  plate: { paddingTop: space.sm2, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: FEED_GUTTER },
  /* A field-shaped well (radius 10), never a pill — DESIGN.md §3 sanctions
     exactly two of those and this is not one of them. */
  well: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: space.md2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rule: { marginTop: space.sm2 },
  quick: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingTop: space.xxs },
  quickCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 42,
  },
})
