/* =========================================================
   Reels — the tab.

   Three feeds behind one pager, and they page in three
   different ways (see useReelFeed): For You re-requests a
   fresh ranking every time, Following walks a cursor, Latest
   walks UTC day buckets backwards. Switching tabs empties the
   list and resets the dedupe set — showing the previous feed's
   reels under the new label for the length of a request is
   worse than a skeleton.

   No SafeAreaView anywhere: the video is full-bleed and the
   insets are applied to the CHROME only. A safe-area frame
   here would letterbox every reel on a notched phone.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isNetworkError } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useTabRetap } from '@/components/nav/tabEvents'
import { OfflinePill, ReelErrorPlate, ReelPlate, ReelSkeleton } from '@/components/reels/FeedStates'
import { ReelPager } from '@/components/reels/ReelPager'
import { takeCreatedReel } from '@/components/reels/reelInbox'
import { ReelTopTabs } from '@/components/reels/ReelTopTabs'
import { STAGE } from '@/components/reels/skin'
import { useReelFeed } from '@/components/reels/useReelFeed'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Touchable } from '@/ui'

type Tab = 'for-you' | 'following' | 'latest'

const TABS: { value: Tab; label: string }[] = [
  { value: 'for-you', label: 'For You' },
  { value: 'following', label: 'Following' },
  { value: 'latest', label: 'Latest' },
]

export default function ReelsTabScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { signedIn } = useAuth()
  const [tab, setTab] = React.useState<Tab>('for-you')
  /* Bumped to force the pager back to the top — see the publish hand-off. */
  const [pagerNonce, setPagerNonce] = React.useState(0)

  const feed = useReelFeed({ kind: tab })
  const { items, setItems, loading, refreshing, error, refresh, reload, loadMore } = feed

  /* A reel you just published is prepended rather than waited for. For You is
     engagement-ranked over three day buckets, so a reel with no engagement yet
     has no reliable position in it, and Following excludes your own by
     construction — refetching alone would leave you staring at a feed that
     does not contain the thing you just made. Jumping to it also makes the
     publish feel finished. */
  useFocusEffect(React.useCallback(() => {
    const fresh = takeCreatedReel()
    if (!fresh?.id) return
    setItems(prev => (prev.some(p => p.id === fresh.id) ? prev : [fresh, ...prev]))
    /* Remount the pager so it lands on the prepended reel. Its `initialIndex`
       is read once at mount, and a bare prepend would shift every row under a
       reader who was mid-scroll. Cheap here: this fires only on a publish. */
    setPagerNonce(n => n + 1)
  }, [setItems]))

  useTabRetap('reels', () => refresh())

  const tabBar = t.layout.tabBarHeight + Math.max(insets.bottom, 8)
  const bottomInset = tabBar + 12
  const chromeTop = insets.top + 6

  const chrome = (
    <View style={[styles.topChrome, { top: chromeTop, zIndex: t.zIndex.header }]} pointerEvents="box-none">
      {/* A pure spacer that balances the camera button, and an `auto` View would
          swallow taps meant for the reel in the top-left corner — the same
          fix reels/[id].tsx made for its own spacer. */}
      <View style={styles.leftSlot} pointerEvents="none" />
      <ReelTopTabs options={TABS} value={tab} onChange={setTab} />
      <Touchable
        onPress={() => router.push('/reels/compose')}
        feedback="scale"
        haptic="light"
        noAutoHitSlop
        accessibilityLabel="Create a reel"
        style={styles.glassButton}
      >
        <Icon name="camera" size={19} color={STAGE.fg} />
      </Touchable>
    </View>
  )

  const body = () => {
    if (loading && !items.length) return <ReelSkeletonScreen />
    if (error && !items.length) return <ReelErrorPlate error={error} onRetry={reload} />
    if (!items.length) return <EmptyForTab tab={tab} signedIn={signedIn} onBrowseLatest={() => setTab('latest')} />
    return (
      <ReelPager
        key={`${tab}:${pagerNonce}`}
        items={items}
        setItems={setItems}
        source={tab}
        onEndReached={loadMore}
        refreshing={refreshing}
        onRefresh={refresh}
        chromeTop={chromeTop + 46}
        bottomInset={bottomInset}
      />
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {body()}
      {chrome}
      {error && isNetworkError(error) && items.length ? <OfflinePill top={chromeTop + 46} /> : null}
    </View>
  )
}

function ReelSkeletonScreen() {
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  return (
    <View
      style={styles.root}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setSize(s => (s.w === width && s.h === height ? s : { w: width, h: height }))
      }}
    >
      {size.h ? <ReelSkeleton width={size.w} height={size.h} /> : null}
    </View>
  )
}

function EmptyForTab({
  tab, signedIn, onBrowseLatest,
}: { tab: Tab; signedIn: boolean; onBrowseLatest: () => void }) {
  const router = useRouter()

  if (tab === 'following') {
    /* The endpoint answers 200 [] for anonymous callers rather than 401, so an
       empty Following tab is ambiguous — branch on the session, not the list. */
    if (!signedIn) {
      return (
        <ReelPlate
          icon="person"
          title="Sign in to see reels from people you follow"
          body="Your Following feed is built from the accounts you follow."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/sign-in')}
        />
      )
    }
    return (
      <ReelPlate
        icon="people"
        title="Nothing from your circle yet"
        body="Reels from people you follow show up here."
        actionLabel="Find people to follow"
        onAction={() => router.push('/explore')}
      />
    )
  }

  if (tab === 'latest') {
    return (
      <ReelPlate
        icon="clock"
        title="No reels in the last week."
        body="The Latest feed walks back one day at a time — nothing has been posted since."
        actionLabel="Create a reel"
        onAction={() => router.push('/reels/compose')}
      />
    )
  }

  return (
    <ReelPlate
      icon="sparkle"
      title="Nothing here yet — check back soon"
      body="For You fills up as people post. In the meantime, everything new is one tab away."
      actionLabel="Browse latest"
      onAction={onBrowseLatest}
      secondaryLabel="Create a reel"
      onSecondary={() => router.push('/reels/compose')}
    />
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.black },
  topChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  leftSlot: { width: 40, height: 40 },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: STAGE.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
