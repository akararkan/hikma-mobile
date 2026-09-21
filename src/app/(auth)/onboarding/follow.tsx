/* =========================================================
   People to follow — cold-starting the graph.

   A brand-new account has no mutuals, so /me/suggestions falls
   back to the who-to-follow ranking on its own. The explicit
   fallback below covers the other case: the endpoint answering
   with an empty array rather than falling back, which reads to
   the user as "there is nobody here".

   The follow writes are optimistic and idempotent — a second
   follow is a 200, not an error — so the button never sits in
   a spinner waiting for a round trip.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, EmptyState, ErrorState, Icon, Screen, Text, Touchable, formatCount, toast,
} from '@/ui'
import { UserRow, UserRowSkeletonList } from '@/components/profile/UserRow'
import { OnboardingHeader } from './_layout'

interface Suggestion {
  id: string
  full: string
  handle: string
  profileImage: string | null
  verified: boolean
  role: string
  followers: number
  mutual: number
  reason: string
  isFollowing: boolean
}

/* Module scope: FlashList compares keyExtractor by identity, so an inline
   arrow re-renders every mounted row on every screen render. */
const keyExtractor = (item: Suggestion) => String(item.id)

export default function OnboardingFollowScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [rows, setRows] = React.useState<Suggestion[]>([])
  const [following, setFollowing] = React.useState<Record<string, boolean>>({})

  const people = useAsync<Suggestion[]>(async () => {
    const primary = await api.users.suggestions({ limit: 20 }).catch(() => [])
    if (primary?.length) return primary
    return api.users.whoToFollow({ limit: 20 })
  }, { onSuccess: (v: Suggestion[]) => setRows(v || []) })

  const next = React.useCallback(() => router.replace('/(app)/(tabs)'), [router])

  const count = Object.values(following).filter(Boolean).length

  /* Suggestion rows carry a real `isFollowing` (social.md) — unlike the
     UserResponse lists, this surface's flag is trustworthy, so it seeds the
     button state and local toggles override from there. */
  const isOn = (row: Suggestion) => following[row.id] ?? row.isFollowing

  const toggleFollow = async (row: Suggestion) => {
    const wasFollowing = isOn(row)
    setFollowing(f => ({ ...f, [row.id]: !wasFollowing }))
    try {
      if (wasFollowing) await api.users.unfollow(row.id)
      else await api.users.follow(row.id)
    } catch (e: any) {
      setFollowing(f => ({ ...f, [row.id]: wasFollowing }))
      if (isNotFound(e)) { setRows(r => r.filter(x => x.id !== row.id)); return }
      /* FOLLOW_PROFILE_LOCKED and FOLLOW_BLOCKED_RELATIONSHIP both arrive here
         with copy written to be shown. */
      toast.error(errorText(e))
    }
  }

  const dismiss = async (row: Suggestion) => {
    setRows(r => r.filter(x => x.id !== row.id))
    try { await api.users.dismissSuggestion(row.id) } catch { /* the row is gone locally either way */ }
  }

  /* Re-created only when the follow map moves — UserRow's press handlers are
     zero-argument by contract, so the per-row closures stay inside, but a
     stable renderItem is what keeps FlashList from re-invoking it for every
     mounted row on every screen render. */
  const renderItem = React.useCallback(({ item }: { item: Suggestion }) => (
    <UserRow
      user={item}
      subtitle={`@${item.handle}${item.followers ? ` · ${formatCount(item.followers)} followers` : ''}`}
      meta={item.reason || (item.mutual ? `${item.mutual} mutual follows` : null)}
      avatarSize={56}
      onPress={() => router.push({ pathname: '/user/[id]', params: { id: String(item.id) } })}
      right={
        <View style={styles.rowActions}>
          <Button
            label={isOn(item) ? 'Following' : 'Follow'}
            icon={isOn(item) ? 'check' : undefined}
            onPress={() => void toggleFollow(item)}
            variant={isOn(item) ? 'secondary' : 'primary'}
            size="sm"
            style={{ minWidth: 92 }}
          />
          <Touchable
            onPress={() => void dismiss(item)}
            feedback="dim"
            accessibilityLabel={`Dismiss ${item.full}`}
            style={{ padding: space.xs }}
          >
            <Icon name="close" size={15} color={t.colors.textFaint} />
          </Touchable>
        </View>
      }
    />
  ), [following, router, t.colors.textFaint])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen>
      <OnboardingHeader onSkip={next} />

      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm2 }}>
        <Text variant="title1" align="ui">Follow a few people</Text>
        <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          Your feed fills up as soon as you do.
        </Text>
      </View>

      {people.loading ? (
        <UserRowSkeletonList count={6} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          extraData={following}
          renderItem={renderItem}
          ListEmptyComponent={
            people.error ? (
              /* The real ErrorState, not an EmptyState wearing its copy — it
                 brings the 404/429/network branches for free. */
              <ErrorState error={people.error} onRetry={people.reload} />
            ) : (
              <EmptyState
                icon="people"
                title="Nothing to suggest yet"
                message="Once there are people to recommend, they show up here. You can always search for someone."
                actionLabel="Find people"
                onAction={() => router.push('/search/people')}
              />
            )
          }
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={people.refreshing}
              onRefresh={() => { void people.refresh() }}
              tintColor={t.colors.textMuted}
              colors={[t.colors.accent]}
            />
          }
        />
      )}

      <View
        style={[
          styles.footer,
          { backgroundColor: t.colors.bg, borderTopColor: t.colors.separator, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <Button
          label={count ? `Continue with ${count} follow${count === 1 ? '' : 's'}` : 'Continue'}
          onPress={next}
          variant="primary"
          size="lg"
          block
        />
        <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.sm }}>
          You can find more people later in Search.
        </Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
})
