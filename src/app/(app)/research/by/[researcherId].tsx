/* =========================================================
   Papers by one researcher.

   The identity strip and the list fail independently on
   purpose: a 404 from users.get must not blank a list that
   loaded fine, so the header falls back to the first card's
   `_author`, which carries the same name and avatar.

   No sort control — the endpoint exposes no sort parameter,
   and a picker that silently does nothing is worse than none.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Divider, EmptyState, Header, Icon, ListFooter, RoleBadge, Screen, Skeleton,
  Text, Touchable, VerifiedMark,
} from '@/ui'
import { ResearchCard, ResearchCardListSkeleton, useResearchMenu } from '@/components/research/ResearchCard'
import { ErrorPanel, GoneState, useTransientRetry } from '@/components/research/states'
import { useResearchList } from '@/components/research/hooks'
import { to } from '@/components/research/nav'
import type { Author, ResearchCardData } from '@/components/research/types'

/* Module scope: FlashList's cell memo compares renderItem and
   ItemSeparatorComponent by identity, and an inline separator arrow is a new
   component TYPE each render — every visible divider would remount. */
const keyExtractor = (item: ResearchCardData) => String(item.id)
const Sep = () => <Divider style={styles.sep} />

export default function ResearcherPapersScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { researcherId } = useLocalSearchParams<{ researcherId: string }>()
  const { user } = useAuth()
  const isMe = !!user?.id && user.id === researcherId

  const profile = useAsync<Author>(
    async () => (await api.users.get(researcherId)) as Author,
    { enabled: !!researcherId, deps: [researcherId] },
  )
  const papers = useResearchList(
    ({ page, size }) => api.research.byResearcher(researcherId, { page, size }),
    { enabled: !!researcherId, deps: [researcherId] },
  )
  useTransientRetry(papers.error, papers.reload)
  const menu = useResearchMenu({ onPatch: (id, patch) => papers.patch(id, row => ({ ...row, ...patch })) })

  /* Either source is enough to draw a name. */
  const who: Author | null = profile.data ?? papers.items[0]?._author ?? null

  /* One item-first handler for the whole list, so `renderItem` keeps a single
     identity — declared above the gone-state return, as hooks must be. */
  const openMenu = useEvent((item: ResearchCardData) => menu.open(item))
  const renderItem = React.useCallback(
    ({ item }: { item: ResearchCardData }) => <ResearchCard item={item} onLongPress={openMenu} />,
    [openMenu],
  )

  if (isNotFound(profile.error) && !papers.items.length && !papers.loading) {
    return (
      <Screen>
        <Header back title="Researcher" />
        <GoneState
          title="This researcher is not available."
          body="The account may have been removed, or you and they cannot see each other."
          onAction={() => router.replace(to('/research'))}
        />
      </Screen>
    )
  }

  const header = (
    <View>
      <Touchable
        onPress={() => router.push(to(`/u/${researcherId}`))}
        feedback="tint"
        noAutoHitSlop
        style={[styles.strip, { backgroundColor: c.surfaceSunken }]}
      >
        {profile.loading && !who ? (
          <>
            <Skeleton circle width={56} height={56} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Skeleton width="52%" height={16} />
              <Skeleton width="34%" height={12} />
            </View>
          </>
        ) : (
          <>
            <Avatar uri={who?.profileImage} name={who?.full} seed={who?.id ?? researcherId} size={56} />
            <View style={styles.flex}>
              <View style={styles.nameLine}>
                <Text variant="title3" serif align="auto" numberOfLines={1} style={styles.shrink}>
                  {who?.full || 'Researcher'}
                </Text>
                {who?.verified ? <VerifiedMark size={15} /> : null}
              </View>
              <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>{who?.handle || ''}</Text>
              <View style={{ marginTop: space.xs2, alignSelf: 'flex-start' }}>
                <RoleBadge role={who?.role} />
              </View>
            </View>
            <Icon name="forward" size={18} color={c.textFaint} />
          </>
        )}
      </Touchable>
      <Text variant="footnote" tone="muted" align="ui" style={styles.statLine}>
        {papers.items.length}{papers.done ? '' : '+'} published paper{papers.items.length === 1 ? '' : 's'}
      </Text>
    </View>
  )

  return (
    <Screen>
      <Header back title="Papers" />
      <FlashList
        data={papers.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={header}
        ListEmptyComponent={
          papers.loading ? <ResearchCardListSkeleton />
            : papers.error ? <ErrorPanel error={papers.error} onRetry={papers.reload} />
              : (
                <EmptyState
                  icon="research"
                  title="No published papers yet."
                  message={isMe ? 'Your drafts are in the dashboard.' : undefined}
                  actionLabel={isMe ? 'Open dashboard' : undefined}
                  onAction={isMe ? () => router.push(to('/research/dashboard')) : undefined}
                />
              )
        }
        ListFooterComponent={
          <View>
            {papers.items.length ? <ListFooter loading={papers.loadingMore} done={papers.done} /> : null}
            {isMe ? (
              <Touchable
                onPress={() => router.push(to('/research/dashboard'))}
                feedback="tint"
                noAutoHitSlop
                style={styles.footerRow}
              >
                <Icon name="library" size={18} color={c.textSecondary} />
                <Text variant="subhead" align="ui" style={styles.flex}>
                  Drafts and archived papers live in your dashboard
                </Text>
                <Icon name="forward" size={16} color={c.textFaint} />
              </Touchable>
            ) : null}
          </View>
        }
        onEndReached={papers.loadMore}
        onEndReachedThreshold={0.6}
        /* Full research plates are 300pt+; the default 250 prepares barely one
           cell ahead of the viewport. */
        drawDistance={500}
        refreshControl={
          <RefreshControl
            refreshing={papers.refreshing}
            onRefresh={() => { void papers.refresh(); void profile.refresh() }}
            tintColor={c.textMuted}
          />
        }
        showsVerticalScrollIndicator={false}
      />
      {menu.element}
    </Screen>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.md2, padding: space.lg, minHeight: 120 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  statLine: { paddingHorizontal: space.lg, paddingVertical: space.md },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56 },
  sep: { marginHorizontal: space.lg },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
})
