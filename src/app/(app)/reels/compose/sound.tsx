/* =========================================================
   The sound picker.

   Search and browse are different systems and the UI has to
   say so. Search is Elasticsearch and returns `[]` when it is
   DOWN as well as when nothing matched — so a blank result is
   cross-checked against /search, which does report `degraded`,
   before choosing between "no matches" and "search is
   unavailable". Browse is Cassandra: cursor-paged, unranked,
   and it carries no status at all, which is why 'Use'
   re-reads the sound before attaching it. Neither wire
   carries useCount — only /sounds/{id}/usage does — so the
   row hides the count column when the number is absent.

   "All" is not a wire concept: /by-category is the only
   browse endpoint and blank search is `[]` by contract. So
   the All filter (the default) fans out one page per category
   in parallel and interleaves newest-first, each category
   keeping its own cursor — the same emulation the sound
   library screen ships. Search under All simply drops the
   category param: that one IS supported cross-category.
   ========================================================= */
import { api, errorText } from '@/api'
import { ReelPlate } from '@/components/reels/FeedStates'
import { useReelDraft } from '@/components/reels/ReelDraft'
import { SoundRow } from '@/components/reels/SoundRow'
import { STAGE } from '@/components/reels/skin'
import { SOUND_CATEGORIES, soundCategoryLabel, type ViewSound } from '@/components/reels/types'
import { useSoundPreview } from '@/components/reels/useSoundPreview'
import { useDebounced, useEvent } from '@/hooks/useAsync'
import { setback, shape, space } from '@/theme/tokens'
import {
    ActionSheet, Button, Chip, ChipRail, Icon, SearchField, Skeleton, Spinner, Text, Touchable,
    toast, useSheetState,
} from '@/ui'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { ComposerHeader, useComposerInsets } from '@/components/reels/ComposerChrome'

const PAGE = 30
/* All-mode fans out one page per category; a smaller page keeps the first
   paint near ninety rows while still stocking every shelf. */
const ALL_PAGE = 12

const ALL_CATEGORY_VALUES = SOUND_CATEGORIES.map(([value]) => value)

/* Newest-first across the interleaved shelves. ISO-8601 orders as text; a
   row with no createdAt sinks to the end instead of corrupting the order. */
const byNewest = (a: ViewSound, b: ViewSound) =>
  String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))

/* Module scope — a keyExtractor rebuilt in the screen body would re-render
   every mounted row on every keystroke in the search field. */
const keyExtractor = (s: ViewSound) => String(s.id)

export default function SoundPickerScreen() {
  const router = useRouter()
  const insets = useComposerInsets()
  const { draft, patch } = useReelDraft()
  const preview = useSoundPreview()
  const menu = useSheetState<ViewSound>()

  const [query, setQuery] = React.useState('')
  /* null = All — the whole approved library, not one shelf of it. */
  const [category, setCategory] = React.useState<string | null>(null)

  const [browse, setBrowse] = React.useState<ViewSound[]>([])
  const [browseLoading, setBrowseLoading] = React.useState(true)
  const [browseMore, setBrowseMore] = React.useState(false)
  const [browseDone, setBrowseDone] = React.useState(false)
  const [browseError, setBrowseError] = React.useState<any>(null)
  /* One cursor per category ('done' when that shelf is exhausted) — All-mode
     pages every open shelf together; a single category is just a one-key map. */
  const cursors = React.useRef<Record<string, string | 'done' | null>>({})
  /* Fan-outs settle at the speed of the slowest shelf, so a category switch
     mid-flight is routine — every fresh load bumps the generation and a
     flight that comes home to a different number writes nothing. */
  const browseGen = React.useRef(0)

  const [results, setResults] = React.useState<ViewSound[]>([])
  const [searching, setSearching] = React.useState(false)
  const [degraded, setDegraded] = React.useState(false)
  const [searchError, setSearchError] = React.useState<any>(null)
  const [attaching, setAttaching] = React.useState<string | null>(null)

  const debounced = useDebounced(query, 300)
  const trimmed = debounced.trim()

  const loadBrowse = React.useCallback(async (more = false) => {
    if (more && (browseDone || browseMore)) return
    if (more) setBrowseMore(true)
    /* A fresh load also releases `browseMore`: it orphans any in-flight page
       (the generation bump below), and an orphan can no longer release the
       flag itself. */
    else { setBrowseLoading(true); setBrowseMore(false); setBrowseError(null); cursors.current = {}; setBrowseDone(false) }
    const gen = more ? browseGen.current : ++browseGen.current
    const cats = category ? [category] : ALL_CATEGORY_VALUES
    const open = cats.filter(c => cursors.current[c] !== 'done')
    try {
      const settled = await Promise.allSettled(open.map(c =>
        api.sounds.byCategory(c, {
          pageSize: category ? PAGE : ALL_PAGE,
          cursor: more ? cursors.current[c] ?? undefined : undefined,
        } as any) as Promise<ViewSound[]>,
      ))
      /* A stale flight writes NOTHING — not rows, not cursors, not the done
         flag: the guard sits before the first side effect. */
      if (gen !== browseGen.current) return
      const fresh: ViewSound[] = []
      settled.forEach((res, i) => {
        if (res.status === 'rejected') return
        const rows = res.value || []
        /* Same cursor convention as ever — the last row's createdAt. An empty
           page, or a tail row that can't carry a cursor, closes that shelf. */
        const next = rows.length ? rows[rows.length - 1]?.createdAt ?? null : null
        cursors.current[open[i]] = next ?? 'done'
        fresh.push(...rows)
      })
      /* Every shelf failing is a failure, and so is a FRESH load that failed
         its way to zero rows — "the library is empty" must never be a network
         error wearing an empty plate. A partial fan-out that still brought
         rows renders them; a failed later page just retries on the next
         scroll. */
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (rejected.length && (rejected.length === settled.length || (!more && !fresh.length))) {
        throw rejected[0].reason
      }
      setBrowse(prev => {
        const base = more ? prev : []
        const seen = new Set(base.map(s => String(s.id)))
        const merged = [...base]
        for (const row of fresh) {
          const id = String(row.id)
          if (seen.has(id)) continue
          seen.add(id)
          merged.push(row)
        }
        /* All-mode interleaves six shelves — order them newest-first. A
           single category keeps the wire's own clustering order. */
        return category ? merged : merged.sort(byNewest)
      })
      setBrowseDone(cats.every(c => cursors.current[c] === 'done'))
    } catch (e) {
      if (gen !== browseGen.current) return
      /* A failed fresh load DROPS the old rows: they belong to the previous
         filter, and rows on screen gate the error plate (and its Retry) off. */
      if (!more) setBrowse([])
      setBrowseError(e)
    } finally {
      if (gen === browseGen.current) {
        setBrowseLoading(false)
        setBrowseMore(false)
      }
    }
  }, [category, browseDone, browseMore])

  React.useEffect(() => { void loadBrowse(false) }, [category])   // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!trimmed) { setResults([]); setDegraded(false); setSearchError(null); return }
    let alive = true
    setSearching(true)
    setSearchError(null)
    ;(async () => {
      try {
        /* Under All the category param is simply dropped — cross-category
           search is the one thing the wire supports directly. */
        const rows: ViewSound[] = await api.sounds.search(trimmed, { category: category ?? undefined, limit: PAGE } as any)
        if (!alive) return
        setResults(rows)
        if (rows.length) { setDegraded(false); return }
        const probe: any = await api.search.stream(trimmed, { types: ['SOUND'], size: 1 } as any)
        if (alive) setDegraded(!!probe?.degraded)
      } catch (e) {
        if (alive) setSearchError(e)
      } finally {
        if (alive) setSearching(false)
      }
    })()
    return () => { alive = false }
  }, [trimmed, category])

  /* Browse rows carry no `status`, so the only way to know a sound is still
     approved is to read it back before attaching. */
  const attach = React.useCallback(async (row: ViewSound) => {
    setAttaching(row.id)
    try {
      const full = await api.sounds.get(row.id) as ViewSound | null
      if (!full || full.status !== 'APPROVED') {
        toast.warn('That sound is no longer available.')
        return
      }
      preview.stop()
      patch({ sound: full })
      router.back()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setAttaching(null)
    }
  }, [patch, router, preview])

  const rows = trimmed ? results : browse
  const heading = trimmed
    ? `Results for “${trimmed}”`
    : category ? soundCategoryLabel(category) : 'All sounds'

  /* Sound-taking and identity-stable, so SoundRow's memo survives a keystroke,
     a preview starting and a 'Use' round trip. */
  const playRow = useEvent((s: ViewSound) => preview.play(s))
  const menuRow = useEvent((s: ViewSound) => menu.open(s))
  const useRow = useEvent((s: ViewSound) => { void attach(s) })

  /* Only the per-row scalars are in the deps: the previewing id, the
     failed id, and the busy id. */
  const renderItem = React.useCallback(({ item }: { item: ViewSound }) => (
    <SoundRow
      sound={item}
      previewing={preview.previewingId === item.id}
      failed={preview.failedId === item.id}
      /* No row — search or browse — has useCount on the wire; the row itself
         hides the column when the number is null, so this costs nothing today
         and lights up without a client change if the wire ever grows it. */
      showUseCount
      trailing="use"
      busy={attaching === item.id}
      onPress={playRow}
      onLongPress={menuRow}
      onUse={useRow}
    />
  ), [preview.previewingId, preview.failedId, attaching, playRow, menuRow, useRow])

  const listHeader = React.useMemo(() => (
    <Text variant="footnote" color={STAGE.fgFaint} align="ui" style={styles.sectionHead}>{heading}</Text>
  ), [heading])

  const emptyState = () => {
    if (trimmed) {
      if (searchError) {
        const signedOut = searchError?.status === 401
        return (
          <ReelPlate
            icon={signedOut ? 'person' : 'error'}
            title={signedOut ? 'Sign in to search sounds' : 'Search failed'}
            body={signedOut ? 'Browsing by category works either way.' : errorText(searchError)}
            actionLabel="Browse"
            onAction={() => setQuery('')}
          />
        )
      }
      return degraded
        ? (
          <ReelPlate
            icon="offline"
            title="Search is temporarily unavailable"
            body="Browse by category instead."
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
    if (browseError) {
      return (
        <ReelPlate
          icon="error"
          title={category ? 'Couldn’t load this category' : 'Couldn’t load sounds'}
          body={errorText(browseError)}
          actionLabel="Retry"
          onAction={() => { void loadBrowse(false) }}
        />
      )
    }
    return <ReelPlate icon="music" title={category ? 'Nothing in this category yet.' : 'No sounds in the library yet.'} />
  }

  const loading = trimmed ? (searching && !results.length) : browseLoading

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <ComposerHeader
        title="Sounds"
        backText="Cancel"
        onBack={() => router.back()}
        /* Same rule as the edit stage: on a dark plate the action is the
           bright thing, never the paper accent (DESIGN.md §2). */
        action={<Button label="Done" onPress={() => router.back()} variant="onDark" size="sm" />}
      />

      <View style={styles.searchWrap}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search sounds" />
        {searching ? <Spinner style={styles.searchSpinner} /> : null}
      </View>

      <ChipRail style={styles.chips}>
        <Chip label="All" selected={!category} onPress={() => setCategory(null)} size="sm" />
        {SOUND_CATEGORIES.map(([value, label]) => (
          <Chip key={value} label={label} selected={category === value} onPress={() => setCategory(value)} size="sm" />
        ))}
      </ChipRail>

      {draft.sound ? (
        <View style={styles.attached}>
          <Icon name="music" size={13} color={STAGE.fg} />
          <Text variant="caption" color={STAGE.fgMuted} numberOfLines={1} style={{ flex: 1 }}>
            Attached: {draft.sound.title}{draft.sound.artist ? ` · ${draft.sound.artist}` : ''}
          </Text>
          <Touchable onPress={() => patch({ sound: null })} feedback="dim" noAutoHitSlop accessibilityLabel="Detach sound">
            <Icon name="close" size={13} color={STAGE.fgMuted} />
          </Touchable>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingTop: space.sm }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={styles.rowSkeleton}>
              <Skeleton width={48} height={48} radius={8} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width="58%" height={12} />
                <Skeleton width="34%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : !rows.length ? (
        emptyState()
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onEndReached={() => { if (!trimmed) void loadBrowse(true) }}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            <View style={styles.footer}>
              {browseMore ? <Spinner /> : null}
              <Text variant="caption" color={STAGE.fgFaint} align="center">Only approved sounds appear here.</Text>
            </View>
          }
        />
      )}

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload ? `${menu.payload.title}${menu.payload.artist ? ` · ${menu.payload.artist}` : ''}` : undefined}
        actions={[
          { label: 'Open sound page', icon: 'music', onPress: () => menu.payload && router.push(`/sounds/${menu.payload.id}`) },
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.plate },
  headerBtn: { paddingHorizontal: space.md, height: 44, justifyContent: 'center' },
  searchWrap: { paddingHorizontal: space.lg, paddingBottom: space.sm2, justifyContent: 'center' },
  searchSpinner: { position: 'absolute', end: 26, top: 0, bottom: 10, padding: 0 },
  chips: { flexGrow: 0, paddingBottom: space.sm2 },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    height: 32,
    /* A chip, not a pill (DESIGN.md §8.9). */
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sectionHead: { paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  rowSkeleton: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 64 },
  footer: { paddingVertical: space.xl, gap: space.md },
})
