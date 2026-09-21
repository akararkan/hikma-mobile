/* =========================================================
   People you may know.

   Read from `suggestionsDetailed`: identity is join-fetched,
   deleted candidates are dropped, and `score` is the true
   double. The legacy `suggestions()` shape stores score as a
   ×10 fixed-point int and hydrates nothing — debug only.

   Two behaviours that look like bugs and are not:

   · A followed row STAYS, flipped to "Following". A follow
     triggers a server-side recompute, so the row would vanish
     on the next read anyway — removing it under the thumb makes
     the list jump while the user is still reading it.
   · Dismissal is PERMANENT across every future recompute and
     there is no un-dismiss endpoint. So the confirm dialog is
     the only guard, and no undo is offered — an undo that
     cannot undo is a lie.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { api, errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, ConfirmSheet, Divider, EmptyState, ErrorState, Header, Icon, Screen,
  Text, Touchable, VerifiedMark, fireHaptic, toast,
} from '@/ui'
import { RowSkeleton } from '@/components/feed/FeedSkeleton'
import type { SuggestionView } from '@/components/feed/types'

/* The recompute is 202/async and returns no rows — a re-read has to wait a
   beat rather than be chained onto the (empty) response. */
const RECOMPUTE_SETTLE_MS = 1500

/* Module scope, all three. FlashList's ViewHolder memo compares renderItem AND
   ItemSeparatorComponent by identity, and an inline separator is a brand-new
   COMPONENT TYPE each render — React unmounts and remounts every visible
   separator rather than reconciling it. */
const keyExtractor = (s: SuggestionView) => s.candidateId
const Separator = () => <Divider inset={84} />

export default function SuggestionsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const gate = useAuthGate()

  const [followed, setFollowed] = React.useState<Set<string>>(() => new Set())
  const [pendingDismiss, setPendingDismiss] = React.useState<SuggestionView | null>(null)
  const [recomputing, setRecomputing] = React.useState(false)
  /* Rows from whoToFollow are a DIFFERENT surface with a different dismiss
     endpoint; the flag rides with the data so a dismiss cannot hit the wrong
     one. */
  const [fallback, setFallback] = React.useState(false)

  const load = React.useCallback(async () => {
    const rows: SuggestionView[] = await api.posts.suggestionsDetailed({ limit: 50 })
    if (rows.length >= 3) { setFallback(false); return rows }
    const alt: any[] = await api.users.whoToFollow({ limit: 20 }).catch(() => [])
    if (!alt.length) { setFallback(false); return rows }
    setFallback(true)
    return alt.map(u => ({
      id: String(u.id),
      candidateId: String(u.id),
      _author: u,
      full: u.full || 'Member',
      handle: u.handle || '',
      initials: u.initials || '',
      avc: u.avc || '',
      profileImage: u.profileImage ?? null,
      verified: !!u.verified,
      role: u.role || 'MEMBER',
      score: 0,
      reason: 'Popular on Hikmah Web',
      reasons: ['Popular on Hikmah Web'],
      computedAt: null,
      time: '',
      isFollowing: !!u.isFollowing,
    })) as SuggestionView[]
  }, [])

  const list = useAsync<SuggestionView[]>(load, { enabled: gate === 'allow' })
  const rows = list.data || []

  /* useEvent, not useCallback: `list.refresh` is re-created when the auth gate
     flips, and a handler frozen at first render would call the disabled one. */
  const recompute = useEvent(async () => {
    setRecomputing(true)
    try { await api.posts.recomputeSuggestions() } catch { /* 202 Accepted, empty body */ }
    setTimeout(() => {
      void list.refresh().finally(() => setRecomputing(false))
    }, RECOMPUTE_SETTLE_MS)
  })

  const toggleFollow = async (s: SuggestionView) => {
    const already = followed.has(s.candidateId) || s.isFollowing
    setFollowed(prev => {
      const next = new Set(prev)
      already ? next.delete(s.candidateId) : next.add(s.candidateId)
      return next
    })
    fireHaptic('light')
    try {
      if (already) await api.users.unfollow(s.candidateId)
      else await api.users.follow(s.candidateId)
    } catch (e) {
      setFollowed(prev => {
        const next = new Set(prev)
        already ? next.add(s.candidateId) : next.delete(s.candidateId)
        return next
      })
      toast.error(errorText(e))
    }
  }

  const dismiss = async (s: SuggestionView) => {
    setPendingDismiss(null)
    list.setData(prev => (prev || []).filter(r => r.candidateId !== s.candidateId))
    try {
      if (fallback) await api.users.dismissSuggestion(s.candidateId)
      else await api.posts.dismissSuggestion(s.candidateId)
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* ---------- row plumbing ----------
     Item-first and identity-stable, so one function serves every row and
     renderItem's identity survives a follow toggle — FlashList's ViewHolder
     memo compares renderItem by reference. */

  const onPressPerson = useEvent((s: SuggestionView) => router.push(`/u/${s.candidateId}`))
  const onToggleFollow = useEvent((s: SuggestionView) => { void toggleFollow(s) })
  const onDismiss = useEvent((s: SuggestionView) => setPendingDismiss(s))

  const renderItem = React.useCallback(({ item }: { item: SuggestionView }) => (
    <SuggestionRow
      item={item}
      following={followed.has(item.candidateId) || item.isFollowing}
      onPress={onPressPerson}
      onToggleFollow={onToggleFollow}
      onDismiss={onDismiss}
    />
  ), [followed, onPressPerson, onToggleFollow, onDismiss])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 24 }),
    [insets.bottom],
  )

  if (gate === 'deny') {
    return (
      <Screen>
        <Header back title="People you may know" />
        <EmptyState
          icon="people"
          title="Sign in to see suggestions"
          message="Suggestions are built from your own graph."
          actionLabel="Sign in"
          onAction={() => router.replace('/sign-in')}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <Header
        back
        title="People you may know"
        actions={[{ icon: 'refresh', label: 'Refresh suggestions', onPress: () => { void recompute() } }]}
        below={recomputing ? <IndeterminateBar /> : undefined}
      />

      <Text variant="footnote" tone="muted" align="ui" style={styles.explainer}>
        Based on people you follow, your contacts, groups and what you engage with.
      </Text>

      {list.loading ? (
        <RowSkeleton count={8} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => { void list.reload() }} />
      ) : !rows.length ? (
        <EmptyState
          icon="people"
          title="No suggestions right now"
          message="Follow a few people or sync your contacts and we’ll find more."
          actionLabel="Find people"
          onAction={() => router.push('/search/people')}
          secondaryLabel="Sync contacts"
          onSecondary={() => router.push('/settings/discovery')}
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentStyle}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl
              refreshing={list.refreshing}
              onRefresh={() => { void recompute() }}
              tintColor={c.textMuted}
              colors={[c.accent]}
            />
          }
          renderItem={renderItem}
          ListFooterComponent={LIST_FOOTER}
        />
      )}

      <ConfirmSheet
        visible={!!pendingDismiss}
        onClose={() => setPendingDismiss(null)}
        title={`Don’t show ${pendingDismiss?.full ?? 'this person'} again?`}
        message="This is permanent."
        confirmLabel="Don’t show"
        destructive
        onConfirm={() => { if (pendingDismiss) void dismiss(pendingDismiss) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One suggestion row.

   Memoized, and `following` arrives as a BOOLEAN rather than
   the followed Set it is derived from — hand it the Set and the
   memo never hits, because a follow anywhere in the list mints
   a new Set and every row repaints.
   --------------------------------------------------------- */

const SuggestionRow = React.memo(function SuggestionRow({
  item, following, onPress, onToggleFollow, onDismiss,
}: {
  item: SuggestionView
  following: boolean
  onPress: (s: SuggestionView) => void
  onToggleFollow: (s: SuggestionView) => void
  onDismiss: (s: SuggestionView) => void
}) {
  const c = useTheme().colors

  return (
    <Touchable
      onPress={() => onPress(item)}
      feedback="tint"
      noAutoHitSlop
      style={styles.row}
    >
      <Avatar uri={item.profileImage} name={item.full} seed={item.candidateId} size={56} />

      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>{item.full}</Text>
          {item.verified ? <VerifiedMark size={14} /> : null}
        </View>
        <Text variant="subhead" tone="muted" numberOfLines={1} weight="400">@{item.handle}</Text>
        {item.reasons.length ? (
          <View style={styles.reasons}>
            {item.reasons.slice(0, 3).map((r, i) => (
              <View key={i} style={[styles.reasonChip, { backgroundColor: c.surfaceSunken }]}>
                <Text variant="micro" tone="muted" numberOfLines={1}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          label={following ? 'Following' : 'Follow'}
          onPress={() => onToggleFollow(item)}
          variant={following ? 'secondary' : 'primary'}
          size="sm"
        />
        <Touchable
          onPress={() => onDismiss(item)}
          feedback="dim"
          accessibilityLabel={`Don't show ${item.full} again`}
          hitSlop={8}
          style={styles.dismiss}
        >
          <Icon name="close" size={15} color={c.textFaint} />
        </Touchable>
      </View>
    </Touchable>
  )
})

/** The 2px bar under the header while an async recompute settles.
 *
 *  It used to animate `left: '%'`, which is a LAYOUT property: every frame of
 *  the barber-pole re-laid-out the track on the JS thread, and it is on screen
 *  precisely while the recompute round-trip is competing for that thread.
 *  Translated instead — same travel (a fifth of the track in front of the
 *  start edge, off the end at the finish), entirely on the UI thread. The
 *  track is measured because a percentage translation is not portable across
 *  every RN pairing; the story composer's bar reads the same way. */
function IndeterminateBar() {
  const t = useTheme()
  const x = useSharedValue(0)
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    if (!width) return undefined
    /* Reduce Motion parks it where the old `left` value rested — a fifth in. */
    if (t.prefs.reducedMotion) { x.value = width * 0.2; return undefined }
    x.value = -width * 0.3
    x.value = withRepeat(withTiming(width * 0.7, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
    return () => cancelAnimation(x)
  }, [width, x, t.prefs.reducedMotion])

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={[styles.barTrack, { backgroundColor: t.colors.accentSofter }]}
    >
      <Animated.View style={[styles.barFill, { backgroundColor: t.colors.accent }, anim]} />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  explainer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 84 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  reasons: { flexDirection: 'row', gap: space.xs, marginTop: space.xs2 },
  reasonChip: { paddingHorizontal: space.xs2, paddingVertical: 2.5, borderRadius: 8, flexShrink: 1 },
  actions: { alignItems: 'center', gap: space.xs },
  dismiss: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  footnote: { paddingVertical: 22, paddingHorizontal: space.xxxl },
  barTrack: { height: 2, overflow: 'hidden' },
  /* `left`, not `start`: the travel is a fixed left-to-right sweep in both
     directions (it reads as progress, not as reading order), and it is the
     anchor translateX moves from. */
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '30%' },
})

/* Built once, below `styles` so it can read it: a freshly-created element
   here re-renders the footer ViewHolder on every screen render. */
const LIST_FOOTER = (
  <Text variant="caption" tone="faint" align="center" style={styles.footnote}>
    Suggestions refresh when you follow someone or sync contacts.
  </Text>
)
