/* =========================================================
   ContributorRow.

   ContributorResponse is the one payload in this module with
   no adapter, so the identity plate is built here with
   `adapters.authorFrom` — the same function every other author
   line in the app goes through, which is what keeps a
   contributor's avatar and initials identical to the same
   person's avatar on their profile.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { adapters } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, DisclosureIcon, Text, Touchable, VerifiedMark } from '@/ui'
import { CONTRIBUTOR_ROLE_LABEL, contributorTint } from './format'
import type { Author, ContributorRow as ContributorData } from './types'

export function plateOf(c: ContributorData): Author {
  return adapters.authorFrom({
    id: c.userId,
    username: c.username,
    fullName: c.fullName,
    profileImage: c.profileImage,
    role: c.userRole,
  }) as Author
}

/* Item-first callbacks: one function serves every row, so the list's
   renderItem keeps a single identity and FlashList's ViewHolder memo (which
   compares renderItem by reference) actually holds. */
function ContributorRowBase({
  contributor, onPress, onLongPress, trailing, avatarSize = 44,
}: {
  contributor: ContributorData
  onPress?: (contributor: ContributorData) => void
  onLongPress?: (contributor: ContributorData) => void
  /** Edit mode swaps the role pill for a dropdown and a remove control. */
  trailing?: React.ReactNode
  avatarSize?: number
}) {
  const t = useTheme()
  const c = t.colors
  const who = plateOf(contributor)
  const tint = contributorTint(c, contributor.role)

  const body = (
    <View style={styles.row}>
      <Avatar uri={who.profileImage} name={who.full} seed={who.id} size={avatarSize} />
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text variant="subhead" weight="600" align="auto" numberOfLines={1} style={styles.shrink}>{who.full}</Text>
          {who.verified ? <VerifiedMark size={13} /> : null}
        </View>
        <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>@{who.handle}</Text>
        {contributor.contributionNote ? (
          <View style={[styles.note, { borderStartColor: c.border }]}>
            <Text variant="caption" tone="muted" italic align="auto" numberOfLines={3}>
              {contributor.contributionNote}
            </Text>
          </View>
        ) : null}
      </View>
      {trailing ?? (
        <View style={styles.trailing}>
          <Chip
            label={CONTRIBUTOR_ROLE_LABEL[contributor.role] || 'Contributor'}
            size="sm"
            style={{ backgroundColor: tint.bg }}
          />
          {onPress ? <DisclosureIcon /> : null}
        </View>
      )}
    </View>
  )

  if (!onPress && !onLongPress) return body
  return (
    <Touchable
      onPress={onPress ? () => onPress(contributor) : undefined}
      onLongPress={onLongPress ? () => onLongPress(contributor) : undefined}
      feedback="tint"
      noAutoHitSlop
    >
      {body}
    </Touchable>
  )
}

export const ContributorRow = React.memo(ContributorRowBase)

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  note: { borderStartWidth: 2, paddingStart: space.sm, marginTop: space.xs2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
