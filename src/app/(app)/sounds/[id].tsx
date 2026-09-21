/* =========================================================
   One sound.

   The header count and the grid length deliberately disagree.
   `usage()` is the authoritative live counter; the adopter
   grid silently drops reels that have since been deleted, so
   quoting the grid's length would tell the author their sound
   is less used than it is. The counter wins, and the grid is
   just what is left to look at.

   The hero ground is the STAGE plate gradient in every case.
   It used to be a scaled, blurred copy of the cover; QELAT has
   no blur (DESIGN.md §8.7), and the cover already reads at
   full sharpness on the turntable plate a few points below.
   ========================================================= */
import React from 'react'
import {
  RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { Share } from 'react-native'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { api, isNotFound } from '@/api'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { useAuthGate } from '@/context/AuthContext'
import { ReelErrorPlate, ReelPlate } from '@/components/reels/FeedStates'
import { ReelGridSkeleton, ReelGridTile } from '@/components/reels/ReelGridTile'
import { useReduceMotion } from '@/components/reels/ReelOverlayLayer'
import { PLATE_GRADIENT, STAGE } from '@/components/reels/skin'
import { clock, soundCategoryLabel, type ViewPost, type ViewSound } from '@/components/reels/types'
import { useSoundPreview } from '@/components/reels/useSoundPreview'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Chip, Icon, Skeleton, Text, Touchable, formatCount, toast } from '@/ui'

const WINDOW = 30
const GUTTER = 2
const COLUMNS = 3
const HERO_HEIGHT = 280

export default function SoundDetailScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const gate = useAuthGate()
  const { id } = useLocalSearchParams<{ id: string }>()
  const preview = useSoundPreview()

  const [collapsed, setCollapsed] = React.useState(false)
  const [tiles, setTiles] = React.useState<ViewPost[]>([])
  const [tilesLoading, setTilesLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)

  const sound = useAsync<ViewSound>(() => api.sounds.get(id) as Promise<ViewSound>, { enabled: !!id, deps: [id] })
  /* No read endpoint carries useCount — only /usage knows the live counter. */
  const usage = useAsync<any>(() => api.sounds.usage(id), { enabled: !!id, deps: [id] })

  const loadTiles = React.useCallback(async () => {
    if (!id) return
    try {
      const rows: any[] = await api.sounds.posts(id, WINDOW)
      const settled = await Promise.allSettled((rows || []).map(r => api.posts.get(r.postId)))
      setTiles(settled
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<ViewPost>).value)
        .filter(Boolean))
    } catch {
      /* The grid is secondary — a failure here leaves the hero and the CTA. */
      setTiles([])
    } finally {
      setTilesLoading(false)
    }
  }, [id])

  React.useEffect(() => { void loadTiles() }, [loadTiles])

  /* "Use this sound" pushes the composer; coming back should show the reel
     that was just posted. Skip the mount focus — the load above owns it. */
  const firstFocus = React.useRef(true)
  useFocusEffect(React.useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return }
    if (!id) return
    void usage.refresh()
    void loadTiles()
  }, [id, usage.refresh, loadTiles]))   // eslint-disable-line react-hooks/exhaustive-deps

  /* The scroll handler crosses to JS at 16ms; the ref makes it cross into
     React only on the flip, so a fling is one re-render instead of sixty. */
  const collapsedRef = React.useRef(false)
  const onScroll = useEvent((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > 240
    if (next === collapsedRef.current) return
    collapsedRef.current = next
    setCollapsed(next)
  })

  const data = sound.data
  const unavailable = !!data && data.status !== 'APPROVED'
  const useCount = usage.data?.useCount ?? data?.useCount ?? null
  const tileWidth = Math.floor((width - GUTTER * (COLUMNS - 1)) / COLUMNS)
  const previewing = preview.previewingId === id

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([sound.refresh(), usage.refresh(), loadTiles()])
    setRefreshing(false)
  }

  const share = async () => {
    if (!data) return
    try {
      await Share.share({ message: `${data.title}${data.artist ? ` · ${data.artist}` : ''}` })
    } catch { /* a dismissed share sheet is not an error */ }
  }

  const useThisSound = () => {
    if (gate === 'deny') { router.push('/(auth)/sign-in'); return }
    router.push(`/reels/compose?soundId=${id}`)
  }

  if (sound.loading) return <SoundSkeleton insets={insets.top} tileWidth={tileWidth} />

  if (sound.error) {
    if (isNotFound(sound.error)) return <UnavailablePlate onBack={() => router.back()} />
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ReelErrorPlate error={sound.error} onRetry={sound.reload} />
      </View>
    )
  }

  if (!data || unavailable) return <UnavailablePlate onBack={() => router.back()} />

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={STAGE.fgMuted}
            colors={[t.colors.cta]}
            progressBackgroundColor={STAGE.plate}
          />
        }
      >
        <View style={[styles.hero, { paddingTop: insets.top + 52 }]}>
          <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={styles.heroWash} />

          <CoverPlate cover={data.cover} previewing={previewing} onPress={() => preview.play(data)} />

          <Touchable
            onLongPress={async () => {
              await Clipboard.setStringAsync([data.title, data.artist].filter(Boolean).join(' · '))
              toast.ok('Copied')
            }}
            feedback="none"
            noAutoHitSlop
            accessibilityLabel={data.title}
          >
            <Text variant="title2" color={STAGE.fg} align="center" numberOfLines={2} style={styles.heroTitle}>
              {data.title || 'Untitled sound'}
            </Text>
          </Touchable>
          <Text variant="subhead" color={STAGE.fgMuted} align="center" numberOfLines={1}>
            {data.artist || 'Unknown artist'}
          </Text>

          <View style={styles.heroChips}>
            {data.category ? <Chip label={soundCategoryLabel(data.category)} tone="overlay" size="sm" /> : null}
            {data.duration ? <Chip label={clock(data.duration)} tone="overlay" size="sm" /> : null}
            {useCount != null ? <Chip label={`${formatCount(useCount)} reels`} tone="overlay" size="sm" /> : null}
          </View>

          {preview.failedId === id ? (
            <Text variant="caption" color={STAGE.warn} align="center" style={{ marginTop: space.sm }}>
              Preview unavailable
            </Text>
          ) : null}
        </View>

        <View style={styles.ctaBar}>
          <Button label="Use this sound" icon="music" onPress={useThisSound} variant="onDark" size="lg" block />
        </View>

        <View style={styles.gridHead}>
          <Text variant="subhead" weight="700" color={STAGE.fg} align="ui">Reels using this sound</Text>
          <Text variant="caption" color={STAGE.fgFaint}>{useCount != null ? formatCount(useCount) : '—'}</Text>
        </View>

        {tilesLoading ? (
          <View style={styles.grid}>
            {Array.from({ length: 9 }, (_, i) => <ReelGridSkeleton key={i} width={tileWidth - GUTTER} />)}
          </View>
        ) : !tiles.length ? (
          <ReelPlate
            icon="reels"
            title="No reels use this sound yet"
            body="Be the first — tap “Use this sound”."
            actionLabel="Use this sound"
            onAction={useThisSound}
          />
        ) : (
          <View style={styles.grid}>
            {tiles.map(tile => (
              <ReelGridTile
                key={tile.id}
                post={tile}
                width={tileWidth - GUTTER}
                onPress={() => router.push(`/reels/${tile.id}?src=sound&soundId=${id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.floatChrome, { top: insets.top + 6 }]} pointerEvents="box-none">
        <Touchable onPress={() => router.back()} feedback="scale" noAutoHitSlop accessibilityLabel="Go back" style={styles.glassButton}>
          <Icon name={t.isRTL ? 'forward' : 'back'} size={22} color={STAGE.fg} />
        </Touchable>
        {collapsed ? (
          <View style={styles.collapsedTitle} pointerEvents="none">
            <Text variant="subhead" weight="600" color={STAGE.fg} numberOfLines={1} align="center">
              {data.title}
            </Text>
          </View>
        ) : <View style={{ flex: 1 }} />}
        <Touchable onPress={share} feedback="scale" noAutoHitSlop accessibilityLabel="Share sound" style={styles.glassButton}>
          <Icon name="share" size={19} color={STAGE.fg} />
        </Touchable>
      </View>
    </View>
  )
}

function CoverPlate({ cover, previewing, onPress }: { cover: string | null; previewing: boolean; onPress: () => void }) {
  const still = useReduceMotion()
  const spin = useSharedValue(0)

  React.useEffect(() => {
    if (!previewing || still) { cancelAnimation(spin); return }
    spin.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(spin)
  }, [spin, previewing, still])

  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }))

  return (
    <Touchable onPress={onPress} feedback="scale" noAutoHitSlop accessibilityLabel={previewing ? 'Pause preview' : 'Play preview'}>
      <Animated.View style={[styles.plate, anim]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        )}
      </Animated.View>
      <View style={styles.platePlay} pointerEvents="none">
        <Icon name={previewing ? 'pause' : 'play'} size={20} color={STAGE.fg} filled />
      </View>
    </Touchable>
  )
}

function UnavailablePlate({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ReelPlate
        icon="music"
        title="This sound isn’t available"
        body="It may have been removed from the library."
        actionLabel="Back"
        onAction={onBack}
      />
    </View>
  )
}

function SoundSkeleton({ insets, tileWidth }: { insets: number; tileWidth: number }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.hero, { paddingTop: insets + 52 }]}>
        <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }} />
        <Skeleton width={104} height={104} radius={12} />
        <Skeleton width={180} height={18} style={{ marginTop: space.lg }} />
        <Skeleton width={110} height={13} style={{ marginTop: space.sm2 }} />
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => <ReelGridSkeleton key={i} width={tileWidth - GUTTER} />)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.plate },
  hero: { minHeight: HERO_HEIGHT, alignItems: 'center', paddingBottom: 22, paddingHorizontal: space.xxl, overflow: 'hidden' },
  heroWash: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: STAGE.wash },
  plate: { width: 104, height: 104, borderRadius: 12, overflow: 'hidden', backgroundColor: STAGE.tile },
  platePlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { marginTop: space.lg },
  heroChips: { flexDirection: 'row', gap: space.sm, marginTop: space.md2, flexWrap: 'wrap', justifyContent: 'center' },
  ctaBar: { paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: STAGE.plate },
  gridHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    height: 40,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER, paddingHorizontal: 0 },
  floatChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  collapsedTitle: { flex: 1 },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: STAGE.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
