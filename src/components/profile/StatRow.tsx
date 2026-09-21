/* =========================================================
   StatRow — the six live counts.

   `users.stats` degrades rather than lying: when its single
   cross-store request fails, the four content counts come back
   NULL (not 0) and followers/following are recovered from the
   list endpoints' totals. So every cell renders `value ?? '—'`.
   Printing 0 there is the exact bug the null fallback exists to
   prevent — a profile with two followers reading "0 Followers"
   with nothing on screen admitting anything had failed.

   And never source these from profile.followerCount & co: the
   API documents those columns as denormalized, unmaintained,
   and free to read 0.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { NumericText, Text, Touchable, formatCount } from '@/ui'

export type StatKey = 'posts' | 'reels' | 'research' | 'questions' | 'followers' | 'following'

export interface Stats {
  posts: number | null
  reels: number | null
  research: number | null
  questions: number | null
  followers: number | null
  following: number | null
}

const LABELS: Record<StatKey, string> = {
  posts: 'Posts',
  reels: 'Reels',
  research: 'Research',
  questions: 'Questions',
  followers: 'Followers',
  following: 'Following',
}

export interface StatRowProps {
  stats: Stats | null
  keys?: StatKey[]
  onPress?: (key: StatKey) => void
  /** True when the read failed outright — adds the honest footnote. */
  degraded?: boolean
}

export function StatRow({
  stats,
  keys = ['posts', 'reels', 'research', 'questions', 'followers', 'following'],
  onPress,
  degraded,
}: StatRowProps) {
  const t = useTheme()

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: t.layout.screenPadding, gap: space.xs }}
      >
        {keys.map(key => {
          const value = stats ? stats[key] : null
          return (
            <Touchable
              key={key}
              onPress={onPress ? () => onPress(key) : undefined}
              disabled={!onPress}
              feedback={onPress ? 'dim' : 'none'}
              noAutoHitSlop
              accessibilityLabel={`${value ?? 'unknown'} ${LABELS[key]}`}
              style={styles.cell}
            >
              <NumericText variant="title3" align="center">
                {value == null ? '—' : formatCount(value)}
              </NumericText>
              <Text variant="micro" tone="muted" align="center">
                {LABELS[key]}
              </Text>
            </Touchable>
          )
        })}
      </ScrollView>

      {degraded ? (
        <Text variant="caption" tone="faint" align="ui" style={{ paddingHorizontal: t.layout.screenPadding, marginTop: space.xs2 }}>
          Counts unavailable right now.
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  cell: { minWidth: 74, paddingVertical: space.sm, paddingHorizontal: space.xs2, alignItems: 'center', gap: space.xxs },
})
