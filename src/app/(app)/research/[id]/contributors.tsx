/* =========================================================
   Authorship.

   Two calls, because the contributors endpoint deliberately
   does not include the corresponding researcher: they are the
   paper's owner, not a contributor to it. The footer says so —
   an authorship list that silently omits the main author reads
   as a bug otherwise.

   Ordering is server-supplied via displayOrder and is never
   re-sorted: author order is a claim about credit.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Card, Divider, EmptyState, Header, Icon, RoleBadge, Screen, SkeletonRow,
  Text, Touchable, VerifiedMark, toast, useSheetState,
} from '@/ui'
import { ContributorRow, plateOf } from '@/components/research/ContributorRow'
import { ErrorPanel, GoneState } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { ContributorRow as ContributorData } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a
   fresh component TYPE each render — every visible divider would remount. */
const keyExtractor = (row: ContributorData) => String(row.id)
const Sep = () => <Divider inset={72} />

export default function ContributorsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  const { detail, error: detailError } = useResearchDetail(id, { subscribe: false, recordView: false })
  const isOwner = !!user?.id && detail?.author === user.id

  const list = useAsync<ContributorData[]>(
    () => api.research.contributors(id),
    { enabled: !!id, deps: [id] },
  )
  const menu = useSheetState<ContributorData>()

  const rows = [...(list.data || [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))

  /* Item-first handlers, so one function serves every row and `renderItem`
     keeps a single identity. Above the gone-state return: hooks cannot be
     conditional. */
  const openProfile = useEvent((row: ContributorData) => router.push(to(`/u/${row.userId}`)))
  const openMenu = useEvent((row: ContributorData) => menu.open(row))
  const renderItem = React.useCallback(({ item }: { item: ContributorData }) => (
    <ContributorRow contributor={item} onPress={openProfile} onLongPress={openMenu} />
  ), [openProfile, openMenu])

  if (isNotFound(detailError)) {
    return (
      <Screen>
        <Header back title="Authorship" />
        <GoneState onAction={() => router.replace(to('/research'))} />
      </Screen>
    )
  }

  const owner = detail?._author

  return (
    <Screen background="sunken">
      <Header
        back
        title="Authorship"
        actions={isOwner
          ? [{ icon: 'edit', onPress: () => router.push(to(`/research/${id}/edit/contributors`)), label: 'Manage' }]
          : []}
      />

      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={
          <View>
            {/* `micro` uppercases Latin INSIDE the Text primitive — which is
                what protects an Arabic or Kurdish run — so the label is
                written in sentence case and carries no tracking of its own. */}
            <Text variant="micro" tone="muted" align="ui" style={styles.label}>Corresponding researcher</Text>
            <Card variant="raised" style={styles.ownerCard} padding={16}>
              {owner ? (
                <Touchable
                  onPress={() => router.push(to(`/u/${owner.id}`))}
                  feedback="dim"
                  noAutoHitSlop
                  style={styles.ownerRow}
                >
                  <Avatar uri={owner.profileImage} name={owner.full} seed={owner.id} size={56} />
                  <View style={styles.flex}>
                    <View style={styles.nameLine}>
                      <Text variant="title3" serif align="auto" numberOfLines={1} style={styles.shrink}>
                        {owner.full}
                      </Text>
                      {owner.verified ? <VerifiedMark size={15} /> : null}
                    </View>
                    <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{owner.handle}</Text>
                    <View style={{ marginTop: space.xs2, alignSelf: 'flex-start' }}>
                      <RoleBadge role={owner.role} />
                    </View>
                  </View>
                  <Icon name="forward" size={18} color={c.textFaint} />
                </Touchable>
              ) : (
                <SkeletonRow avatarSize={56} lines={2} />
              )}
            </Card>

            <Text variant="micro" tone="muted" align="ui" style={styles.label}>
              Contributors{rows.length ? ` (${rows.length})` : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={
          list.loading ? (
            <View>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} avatarSize={44} lines={2} />)}</View>
          ) : list.error ? (
            <ErrorPanel error={list.error} onRetry={list.reload} compact />
          ) : (
            <EmptyState icon="people" title="This paper has no additional contributors." compact />
          )
        }
        ListFooterComponent={
          <Text variant="footnote" tone="faint" align="ui" style={styles.footnote}>
            The corresponding researcher is never listed as a contributor.
          </Text>
        }
        refreshControl={
          <RefreshControl refreshing={list.refreshing} onRefresh={() => { void list.refresh() }} tintColor={c.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      />

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload ? plateOf(menu.payload).full : undefined}
        actions={[
          {
            label: 'Copy name',
            icon: 'copy',
            onPress: async () => {
              if (!menu.payload) return
              await Clipboard.setStringAsync(plateOf(menu.payload).full)
              toast.ok('Name copied')
            },
          },
          {
            label: 'View profile',
            icon: 'person',
            onPress: () => { if (menu.payload) router.push(to(`/u/${menu.payload.userId}`)) },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: space.lg, paddingTop: space.lg2, paddingBottom: space.sm },
  ownerCard: { marginHorizontal: space.lg },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  footnote: { paddingHorizontal: space.lg, paddingVertical: 22 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
