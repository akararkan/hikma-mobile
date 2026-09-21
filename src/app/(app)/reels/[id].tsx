/* =========================================================
   One reel by id — a notification, an activity row, a share
   link, a search hit or a grid tile lands here.

   A deep link must never be a dead end, so the screen shows
   the requested reel immediately and then back-fills the list
   the user came FROM (`?src=`), which is what lets them keep
   swiping in the same feed. While that continuation is in
   flight the pager is locked to one page — a swipe that lands
   on nothing reads as a bug.

   A tap inside the app is better than a deep link: the surface
   hands over the rows it was showing (reelInbox's open slot,
   via openReelIn), the pager opens ON the tapped reel with its
   neighbours in place, nothing is re-read, and the continuation
   resumes from the tail of those rows. Either way the feed
   continues AFTER the reel, never from its head — that restart
   is what made "open this reel" feel like "open reels".
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { api, codeOf, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { ReelErrorPlate, ReelPlate, ReelSkeleton } from '@/components/reels/FeedStates'
import { isReelPost } from '@/components/reels/openReel'
import { clearReelOpen, takeReelOpen } from '@/components/reels/reelInbox'
import { ReelPager } from '@/components/reels/ReelPager'
import { STAGE } from '@/components/reels/skin'
import { useReelFeed, utcDay } from '@/components/reels/useReelFeed'
import type { ReelSourceKind, ViewPost } from '@/components/reels/types'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, Text, Touchable, toast } from '@/ui'

const SOURCES: ReelSourceKind[] = ['for-you', 'following', 'latest', 'author', 'sound', 'watched', 'none']

export default function ReelViewerScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    id: string; src?: string; authorId?: string; soundId?: string; day?: string; handle?: string; focus?: string
  }>()

  const id = params.id
  const src = (SOURCES.includes(params.src as ReelSourceKind) ? params.src : 'for-you') as ReelSourceKind

  /* The rows the tap happened in, when a surface handed them over. Read once
     at mount and released on unmount — the slot is keyed by id and aged, so a
     later tap on the same reel from somewhere else cannot inherit it. */
  const [handoff] = React.useState(() => (id ? takeReelOpen(String(id)) : null))
  React.useEffect(() => () => { if (id) clearReelOpen(String(id)) }, [id])

  /* The id is the only thing a deep link carries, so this read is unconditional
     — but never with an unhydrated param: /posts/undefined answers 400
     TYPE_MISMATCH and http.js logs it as our bug. A hand-off already holds
     the reel, so it is not read again. */
  const seedState = useAsync<ViewPost>(() => api.posts.get(id), { enabled: !!id && !handoff, deps: [id] })
  const seed: ViewPost | null = handoff ? (handoff.items[handoff.index] ?? null) : seedState.data
  const isReel = !!seed && isReelPost(seed)

  /* A shared link can point at any post. If it turns out not to be a reel, hand
     it to the post screen before a single frame of pager chrome is painted.
     Same normalisation as the post screen's own check, or the two bounce. */
  React.useEffect(() => {
    if (seed && !isReel) router.replace(`/posts/${seed.id}`)
  }, [seed, isReel, router])

  /* A comment-button tap on a reel arrives as `?focus=comment` (the post
     screen forwards it when it hands a reel over). Open the thread on top of
     the viewer once the seed is known — once, not on every re-render. */
  const focusedComments = React.useRef(false)
  React.useEffect(() => {
    if (params.focus !== 'comment' || !seed || !isReel || focusedComments.current) return
    focusedComments.current = true
    router.push(`/reels/comments/${seed.id}`)
  }, [params.focus, seed, isReel, router])

  const continuation = useReelFeed({
    kind: src,
    authorId: params.authorId ?? seed?.author ?? null,
    soundId: params.soundId ?? null,
    startDay: params.day ?? (seed?.createdAt ? utcDay(seed.createdAt) : null),
    seed: seed ?? null,
    initialItems: handoff?.items ?? null,
    enabled: isReel && src !== 'none',
  })

  /* A failed continuation is NOT fatal — the seed reel stays playable. Say so
     once and never again. */
  const warned = React.useRef(false)
  React.useEffect(() => {
    if (continuation.error && !warned.current && continuation.items.length <= 1) {
      warned.current = true
      toast.warn("Couldn't load more reels")
    }
  }, [continuation.error, continuation.items.length])

  const items = continuation.items
  const locked = !!seed && continuation.loading && items.length <= 1

  const goBack = React.useCallback(() => {
    /* Opened cold from a push or a share link: there is no history to pop, so
       "back" has to mean "into the app" rather than "out of it". */
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/(tabs)/reels')
  }, [router])

  const title = src === 'author'
    ? `@${params.handle || seed?._author.handle || ''}'s reels`
    : src === 'sound' ? 'Sound'
      : src === 'watched' ? 'Watch history' : 'Reels'

  const bottomInset = Math.max(insets.bottom, 8) + 16
  const chromeTop = insets.top + 6

  const chrome = (
    <View style={[styles.topChrome, { top: chromeTop, zIndex: t.zIndex.header }]} pointerEvents="box-none">
      <Touchable
        onPress={goBack}
        feedback="scale"
        noAutoHitSlop
        accessibilityLabel="Go back"
        style={styles.glassButton}
      >
        <Icon name={t.isRTL ? 'forward' : 'back'} size={22} color={STAGE.fg} />
      </Touchable>
      <Text variant="headline" color={STAGE.fg} align="center" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {/* A pure spacer, and an `auto` View would swallow taps meant for the
          reel in the top-right corner. */}
      <View style={styles.glassSpacer} pointerEvents="none" />
    </View>
  )

  const body = () => {
    if (seedState.loading) return <SeedSkeleton bottomInset={bottomInset} />
    if (seedState.error) {
      if (isNotFound(seedState.error)) {
        return (
          <ReelPlate
            icon="videoOff"
            title="This reel is no longer available."
            body="It may have been deleted by its author."
            actionLabel="Browse reels"
            onAction={() => router.replace('/(app)/(tabs)/reels')}
            secondaryLabel="Go back"
            onSecondary={goBack}
          />
        )
      }
      if (isForbidden(seedState.error)) return <ForbiddenPlate onBack={goBack} />
      return <ReelErrorPlate error={seedState.error} onRetry={seedState.reload} />
    }
    if (!seed) return <ReelPlate icon="videoOff" title="This reel is no longer available." onAction={goBack} actionLabel="Go back" />
    if (!isReel || !items.length) return <SeedSkeleton bottomInset={bottomInset} />

    return (
      <ReelPager
        items={items}
        setItems={continuation.setItems}
        /* Inside handed-over rows the pager opens on the tapped one. */
        initialIndex={handoff?.index ?? 0}
        source={src}
        onEndReached={continuation.loadMore}
        refreshing={continuation.refreshing}
        /* Pulling down at the top re-reads the SEED, so a reel opened from a
           three-day-old notification shows today's counters. */
        onRefresh={() => { if (!handoff) void seedState.refresh(); continuation.refresh() }}
        chromeTop={chromeTop + 46}
        bottomInset={bottomInset}
        locked={locked}
      />
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {body()}
      {chrome}
      {locked ? <IndeterminateBar top={chromeTop + 40} /> : null}
    </View>
  )
}

/** 403 on a FOLLOWERS_ONLY reel. Not an error state — a closed door with a key
 *  next to it. */
function isForbidden(e: any): boolean {
  const code = codeOf(e)
  return e?.status === 403 || code === 'FORBIDDEN' || code === 'ACCESS_FORBIDDEN'
}

function ForbiddenPlate({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.centre}>
      <Icon name="lock" size={38} color={STAGE.fgFaint} />
      <Text variant="title3" color={STAGE.fg} align="center" style={{ marginTop: space.md2 }}>
        This reel isn&rsquo;t shared with you.
      </Text>
      <Text variant="callout" color={STAGE.fgMuted} align="center" style={{ marginTop: space.xs, maxWidth: 300 }}>
        Its author limited who can see it.
      </Text>
      <Button label="Go back" onPress={onBack} variant="secondary" size="md" style={{ marginTop: space.xl }} />
    </View>
  )
}

function SeedSkeleton({ bottomInset }: { bottomInset: number }) {
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  return (
    <View
      style={styles.root}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setSize(s => (s.w === width && s.h === height ? s : { w: width, h: height }))
      }}
    >
      {size.h ? <ReelSkeleton width={size.w} height={size.h} bottomInset={bottomInset} /> : null}
    </View>
  )
}

/** The 2px bar under the header while the continuation fills in behind the
 *  seed reel. Determinate progress would be a lie — the list is one request. */
function IndeterminateBar({ top }: { top: number }) {
  const t = useTheme()
  const p = useSharedValue(0)
  /* The percentage this used to animate has to become pixels before it can be a
     transform, and the track sits under the header rather than across the whole
     screen — so it is measured, never guessed from Dimensions. */
  const w = useSharedValue(0)
  React.useEffect(() => {
    if (t.prefs.reducedMotion) { p.value = 0.5; return }
    p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
  }, [p, t.prefs.reducedMotion])
  /* translateX, not left: an animated `left` re-runs layout for the track every
     frame, and this bar exists precisely while a full-screen reel is decoding
     behind it. The travel is physical (as `left` was), so RTL is unchanged.
     Held invisible until the first onLayout, or the sweep starts mid-track. */
  const anim = useAnimatedStyle(() => ({
    opacity: w.value > 0 ? 1 : 0,
    transform: [{ translateX: (p.value - 0.3) * w.value }],
  }))
  return (
    <View
      style={[styles.barTrack, { top }]}
      pointerEvents="none"
      onLayout={e => { w.value = e.nativeEvent.layout.width }}
    >
      <Animated.View style={[styles.barFill, anim]} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.black },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 34 },
  topChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  title: { flex: 1 },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: STAGE.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassSpacer: { width: 40, height: 40 },
  barTrack: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: STAGE.fgGhost, overflow: 'hidden', zIndex: 24 },
  /* left is now static; the sweep is a transform. The 30% must stay in step with
     the -0.3 in IndeterminateBar's translate. */
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '30%', backgroundColor: STAGE.fg },
})
