/* =========================================================
   The sound library.

   Two ways in, and they are not the same thing:

     search()      BM25 over title/artist, typo-tolerant, scored
                   × log1p(useCount) so popularity breaks TIES
                   without drowning an exact title match. Render
                   the order the server gave; never re-sort.
     byCategory()  plain Cassandra browsing. No query, no
                   ranking, just the catalogue.

   And the trap that shapes the whole empty state: if
   Elasticsearch is down, search returns `[]` rather than a
   5xx. An empty result is therefore ambiguous, so a blank
   search is cross-checked against /search — which DOES report
   `degraded` — before deciding which of two very different
   sentences to show.
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { api, errorText } from '@/api'
import { useDebounced, useEvent } from '@/hooks/useAsync'
import { ReelPlate } from '@/components/reels/FeedStates'
import { SoundRow } from '@/components/reels/SoundRow'
import { PLATE_GRADIENT, STAGE } from '@/components/reels/skin'
import { SOUND_CATEGORIES, type ViewSound } from '@/components/reels/types'
import { useSoundPreview } from '@/components/reels/useSoundPreview'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Chip, ChipRail, Icon, Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { SearchField } from '@/ui'

type Rail = { category: string; label: string; sounds: ViewSound[]; error: any }

/* Module scope. FlashList keeps a cell's React key only while the extractor's
   answer holds still, and ViewHolder's memo compares renderItem BY IDENTITY —
   an arrow declared in the render body re-renders every mounted row on every
   keystroke of the search field. */
const soundKey = (s: ViewSound) => String(s.id)

export default function SoundLibraryScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ q?: string }>()
  const preview = useSoundPreview()
  const menu = useSheetState<ViewSound>()

  const [query, setQuery] = React.useState(params.q ?? '')
  const [category, setCategory] = React.useState<string | null>(null)
  const [rails, setRails] = React.useState<Rail[]>([])
  const [railsLoading, setRailsLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)

  const [results, setResults] = React.useState<ViewSound[]>([])
  const [searching, setSearching] = React.useState(false)
  const [degraded, setDegraded] = React.useState(false)
  const [searchError, setSearchError] = React.useState<any>(null)

  const debounced = useDebounced(query, 300)
  const trimmed = debounced.trim()

  const loadRails = React.useCallback(async () => {
    /* Six calls in parallel, each with its OWN error slot, so one failing
       category cannot blank the page. */
    const settled = await Promise.allSettled(
      SOUND_CATEGORIES.map(([value]) => api.sounds.byCategory(value, { pageSize: 20 })),
    )
    setRails(SOUND_CATEGORIES.map(([value, label], i) => {
      const r = settled[i]
      return {
        category: value,
        label,
        sounds: r.status === 'fulfilled' ? (r.value as ViewSound[]) : [],
        error: r.status === 'rejected' ? r.reason : null,
      }
    }))
    setRailsLoading(false)
  }, [])

  React.useEffect(() => { void loadRails() }, [loadRails])

  React.useEffect(() => {
    if (!trimmed) { setResults([]); setDegraded(false); setSearchError(null); return }
    let alive = true
    setSearching(true)
    setSearchError(null)
    ;(async () => {
      try {
        const rows: ViewSound[] = await api.sounds.search(trimmed, { category: category ?? undefined, limit: 30 } as any)
        if (!alive) return
        setResults(rows)
        if (rows.length) { setDegraded(false); return }
        /* Zero hits: ask the cross-index endpoint whether the index is even up
           before telling the user their spelling is the problem. */
        const probe: any = await api.search.stream(trimmed, { types: ['SOUND'], size: 20 } as any)
        if (alive) setDegraded(!!probe?.degraded)
      } catch (e) {
        if (alive) setSearchError(e)
      } finally {
        if (alive) setSearching(false)
      }
    })()
    return () => { alive = false }
  }, [trimmed, category])

  const refresh = async () => {
    setRefreshing(true)
    await loadRails()
    setRefreshing(false)
  }

  const openSound = (s: ViewSound) => router.push(`/sounds/${s.id}`)
  /* Not `useInReel`: a plain handler whose name starts with "use" reads as a
     hook to the lint rule (and to the next reader). */
  const openInReel = (s: ViewSound) => router.push(`/reels/compose?soundId=${s.id}`)

  const visibleRails = rails.filter(r => (!category || r.category === category))

  /* ---- the results list's stable props ----
     The two row handlers go through useEvent so the renderer's identity does
     not depend on `preview` or `menu`; the only things left in its deps are
     the two scalars a row actually reads. */
  const playSound = useEvent((s: ViewSound) => preview.play(s))
  const openMenu = useEvent((s: ViewSound) => menu.open(s))
  const previewingId = preview.previewingId
  const failedId = preview.failedId

  const renderSound = React.useCallback(({ item }: { item: ViewSound }) => (
    <SoundRow
      sound={item}
      previewing={previewingId === item.id}
      failed={failedId === item.id}
      showUseCount
      trailing="chevron"
      onPress={() => playSound(item)}
      onLongPress={() => openMenu(item)}
    />
  ), [previewingId, failedId, playSound, openMenu])

  const listPad = React.useMemo(() => ({ paddingBottom: insets.bottom + 32 }), [insets.bottom])

  const resultsHead = React.useMemo(() => (
    <Text variant="footnote" color={STAGE.fgFaint} align="ui" style={styles.sectionHead}>
      Results for “{trimmed}”
    </Text>
  ), [trimmed])

  const searchBody = () => {
    if (searching && !results.length) {
      return (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 6 }, (_, i) => <RowSkeleton key={i} />)}
        </View>
      )
    }
    if (searchError) {
      const signedOut = searchError?.status === 401
      return (
        <ReelPlate
          icon={signedOut ? 'person' : 'error'}
          title={signedOut ? 'Sign in to search sounds' : 'Search failed'}
          body={signedOut ? 'Browsing by category works either way.' : errorText(searchError)}
          actionLabel={signedOut ? 'Sign in' : 'Clear search'}
          onAction={() => (signedOut ? router.push('/(auth)/sign-in') : setQuery(''))}
        />
      )
    }
    if (!results.length) {
      return degraded
        ? (
          <ReelPlate
            icon="offline"
            title="Search is temporarily unavailable"
            body="Browse by category instead — the catalogue is still there."
            actionLabel="Browse"
            onAction={() => setQuery('')}
          />
        )
        : (
          <ReelPlate
            icon="search"
            title={`No sounds matched “${trimmed}”`}
            body="Try a different spelling, or browse by category."
            actionLabel="Browse"
            onAction={() => setQuery('')}
          />
        )
    }
    return (
      <FlashList
        data={results}
        keyExtractor={soundKey}
        renderItem={renderSound}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={listPad}
        ListHeaderComponent={resultsHead}
      />
    )
  }

  const browseBody = () => {
    if (railsLoading) {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          {Array.from({ length: 3 }, (_, i) => (
            <View key={i} style={styles.railBlock}>
              <Skeleton width={120} height={13} style={{ marginHorizontal: space.lg, marginBottom: space.md }} />
              <View style={styles.railRow}>
                {Array.from({ length: 4 }, (_, j) => (
                  <Skeleton key={j} width={120} height={150} radius={12} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )
    }

    const nonEmpty = visibleRails.filter(r => r.sounds.length || r.error)
    if (!nonEmpty.length) {
      return <ReelPlate icon="music" title="Nothing in this category yet." actionLabel="Show all" onAction={() => setCategory(null)} />
    }

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={listPad}
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
        {nonEmpty.map(rail => (
          <View key={rail.category} style={styles.railBlock}>
            <View style={styles.railHead}>
              <Text variant="subhead" weight="700" color={STAGE.fg} align="ui">{rail.label}</Text>
              {rail.sounds.length ? (
                <Touchable onPress={() => setCategory(rail.category)} feedback="dim" noAutoHitSlop>
                  <Text variant="caption" weight="600" color={t.colors.cta}>See all</Text>
                </Touchable>
              ) : null}
            </View>

            {rail.error ? (
              <Touchable onPress={() => { void loadRails() }} feedback="dim" style={styles.railError}>
                <Icon name="refresh" size={13} color={STAGE.warn} />
                <Text variant="caption" color={STAGE.warn}>{errorText(rail.error)} · Retry</Text>
              </Touchable>
            ) : !rail.sounds.length ? (
              <Text variant="footnote" color={STAGE.fgFaint} align="ui" style={styles.railEmpty}>Nothing here yet</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railRow}
              >
                {rail.sounds.map(sound => (
                  <SoundCard
                    key={sound.id}
                    sound={sound}
                    previewing={preview.previewingId === sound.id}
                    onPress={() => openSound(sound)}
                    onPlay={() => preview.play(sound)}
                    onLongPress={() => menu.open(sound)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        ))}
      </ScrollView>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Touchable onPress={() => router.back()} feedback="scale" accessibilityLabel="Go back" style={styles.navBtn}>
          <Icon name={t.isRTL ? 'forward' : 'back'} size={24} color={STAGE.fg} />
        </Touchable>
        <Text variant="headline" color={STAGE.fg} align="center" style={{ flex: 1 }}>Sounds</Text>
        <View style={styles.navBtn} />
      </View>

      <View style={styles.searchWrap}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search sounds" />
      </View>

      <ChipRail style={styles.chips}>
        <Chip label="All" selected={!category} onPress={() => setCategory(null)} size="sm" />
        {SOUND_CATEGORIES.map(([value, label]) => (
          <Chip key={value} label={label} selected={category === value} onPress={() => setCategory(value)} size="sm" />
        ))}
      </ChipRail>

      <View style={{ flex: 1 }}>{trimmed ? searchBody() : browseBody()}</View>

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload ? `${menu.payload.title}${menu.payload.artist ? ` · ${menu.payload.artist}` : ''}` : undefined}
        actions={[
          { label: 'Use in a reel', icon: 'video', onPress: () => menu.payload && openInReel(menu.payload) },
          { label: 'Open sound page', icon: 'music', onPress: () => menu.payload && openSound(menu.payload) },
          {
            label: 'Copy title',
            icon: 'copy',
            onPress: async () => {
              if (!menu.payload) return
              await Clipboard.setStringAsync([menu.payload.title, menu.payload.artist].filter(Boolean).join(' · '))
              toast.ok('Copied')
            },
          },
        ]}
      />
    </View>
  )
}

function SoundCard({
  sound, previewing, onPress, onPlay, onLongPress,
}: {
  sound: ViewSound
  previewing: boolean
  onPress: () => void
  onPlay: () => void
  onLongPress: () => void
}) {
  return (
    <Touchable onPress={onPress} onLongPress={onLongPress} feedback="scale" noAutoHitSlop style={styles.card}>
      <View style={styles.cardArt}>
        <LinearGradient colors={PLATE_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        {sound.cover ? (
          <Image
            source={{ uri: sound.cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={sound.id}
          />
        ) : (
          <View style={styles.cardGlyph}><Icon name="music" size={26} color={STAGE.fgFaint} /></View>
        )}
        {/* 24pt pin inside a recycled cell: keep the opt-out (no layout
            listener per tile) but pay the 44pt minimum explicitly — 10 is
            (44 − 24) / 2. */}
        <Touchable onPress={onPlay} feedback="scale" noAutoHitSlop hitSlop={10} accessibilityLabel="Preview" style={styles.cardPlay}>
          <Icon name={previewing ? 'pause' : 'play'} size={13} color={STAGE.fg} filled />
        </Touchable>
      </View>
      <Text variant="caption" weight="600" color={STAGE.fg} numberOfLines={2} style={{ marginTop: space.sm }}>
        {sound.title || 'Untitled'}
      </Text>
      <Text variant="micro" color={STAGE.fgFaint} numberOfLines={1}>{sound.artist || '—'}</Text>
    </Touchable>
  )
}

function RowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <Skeleton width={48} height={48} radius={8} />
      <View style={{ flex: 1, gap: space.sm }}>
        <Skeleton width="58%" height={12} />
        <Skeleton width="34%" height={11} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.plate },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2 },
  navBtn: { width: 44, height: 56, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  chips: { flexGrow: 0, paddingBottom: space.sm2 },
  sectionHead: { paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  railBlock: { paddingBottom: space.lg2 },
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    height: 34,
  },
  railRow: { gap: space.md, paddingHorizontal: space.lg },
  railEmpty: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  railError: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.lg, paddingVertical: space.sm },
  card: { width: 120 },
  cardArt: { width: 120, height: 96, borderRadius: 12, overflow: 'hidden', backgroundColor: STAGE.tile },
  cardGlyph: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  cardPlay: {
    position: 'absolute',
    end: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowSkeleton: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 64 },
})
