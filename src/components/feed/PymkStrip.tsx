/* =========================================================
   PymkStrip — People you may know, in the middle of the feed.

   An interruption in a timeline earns its slot at most once per
   cooldown, and `pymkTimer` owns that clock. Two rules the
   caller has to honour and this component assumes:

   · the due/not-due decision is made ONCE, at mount, and frozen
     — re-evaluating it per render would make the strip vanish
     mid-scroll as the clock ticked past;
   · `markPymkShown()` fires when the strip actually RENDERS or
     is dismissed, never when the suggestion read came back
     empty, or a user whose graph was briefly cold would go
     hours without seeing one.

   Dismissing a person is PERMANENT — there is no un-dismiss
   endpoint — and the ✕ fires in ONE tap, no confirm, no undo
   (the full suggestions screen confirms; the strip trades that
   for not interrupting the feed — an accidental dismiss costs
   one suggestion, not data).
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Button, Icon, Text, Touchable, VerifiedMark } from '@/ui'
import type { SuggestionView } from './types'
import { FEED_GUTTER } from './plate'

const CARD_W = 150
const GAP = 10

export interface PymkStripProps {
  suggestions: SuggestionView[]
  followedIds?: Set<string>
  onFollow?: (s: SuggestionView) => void
  onUnfollow?: (s: SuggestionView) => void
  onDismiss?: (s: SuggestionView) => void
  onPressPerson?: (candidateId: string) => void
  onSeeAll?: () => void
  onClose?: () => void
}

export function PymkStrip({
  suggestions, followedIds, onFollow, onUnfollow, onDismiss, onPressPerson, onSeeAll, onClose,
}: PymkStripProps) {
  const t = useTheme()
  const c = t.colors
  if (!suggestions.length) return null

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderColor: c.separator }]}>
      <View style={styles.head}>
        <Text variant="headline" style={styles.flex}>People you may know</Text>
        {onSeeAll ? (
          <Touchable onPress={onSeeAll} feedback="dim" noAutoHitSlop style={styles.seeAll}>
            <Text variant="footnote" tone="accent">See all</Text>
          </Touchable>
        ) : null}
        {onClose ? (
          <Touchable onPress={onClose} feedback="dim" accessibilityLabel="Hide suggestions" hitSlop={10} style={styles.close}>
            <Icon name="close" size={16} color={c.textMuted} />
          </Touchable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.rail}
      >
        {suggestions.map(s => {
          const following = followedIds?.has(String(s.candidateId)) ?? s.isFollowing
          return (
            <Touchable
              key={s.candidateId}
              onPress={() => onPressPerson?.(s.candidateId)}
              feedback="scale"
              noAutoHitSlop
              style={[styles.card, { backgroundColor: c.surfaceSunken, borderColor: c.borderFaint, borderRadius: t.radius.md }]}
            >
              {onDismiss ? (
                <Touchable
                  onPress={() => onDismiss(s)}
                  feedback="dim"
                  accessibilityLabel={`Don't show ${s.full} again`}
                  hitSlop={8}
                  style={styles.cardClose}
                >
                  <Icon name="close" size={13} color={c.textFaint} />
                </Touchable>
              ) : null}

              <Avatar uri={s.profileImage} name={s.full} seed={s.candidateId} size={64} />

              <View style={styles.nameLine}>
                <Text variant="subhead" weight="600" align="center" numberOfLines={2} style={styles.shrink}>
                  {s.full}
                </Text>
                {s.verified ? <VerifiedMark size={12} /> : null}
              </View>
              <Text variant="caption" caps={false} tone="muted" align="center" numberOfLines={1} weight="400">@{s.handle}</Text>

              <View style={styles.reasons}>
                {s.reasons.slice(0, 2).map((r, i) => (
                  <View key={i} style={[styles.reasonChip, { backgroundColor: c.surface }]}>
                    {/* "Followed by Ali" is a sentence, not chrome. */}
                    <Text variant="micro" caps={false} tone="muted" align="center" numberOfLines={1} weight="600">{r}</Text>
                  </View>
                ))}
              </View>

              <Button
                label={following ? 'Following' : 'Follow'}
                onPress={() => (following ? onUnfollow?.(s) : onFollow?.(s))}
                variant={following ? 'secondary' : 'primary'}
                size="sm"
                block
                style={styles.follow}
              />
            </Touchable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  /* THE FULL-BLEED PLATE (feed/plate.ts): the timeline's own dress — white
     ground, a stone hairline at the crown and the root, no side border and
     no radius. The seam to the next row is the only ground the column
     shows. */
  wrap: {
    paddingTop: space.md2,
    paddingBottom: space.md2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: FEED_GUTTER, paddingBottom: space.md },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  seeAll: { paddingVertical: space.xxs },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rail: { paddingHorizontal: FEED_GUTTER, gap: GAP },
  card: {
    width: CARD_W,
    height: 214,
    alignItems: 'center',
    paddingTop: space.xl,
    paddingHorizontal: space.sm2,
    paddingBottom: space.sm2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardClose: { position: 'absolute', top: 4, end: 4, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm2 },
  reasons: { flexDirection: 'row', gap: space.xs, marginTop: space.xs2, flexWrap: 'nowrap', maxWidth: '100%' },
  /* A reason is a CHIP (setback 8/3), not a pill. */
  reasonChip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    paddingHorizontal: space.xs2,
    paddingVertical: 2.5,
    flexShrink: 1,
  },
  /* No borderRadius here: the Button primitive owns the sm button setback,
     and overriding it flattened one control's corners against every other. */
  follow: { marginTop: 'auto', height: 32 },
})
