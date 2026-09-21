/* =========================================================
   Search inside one channel.

   Three different endpoints answer this screen, and the query
   picks which one:

   · a plain query   → `messages.search`, full-text, aborting the
     previous request so a slow earlier response cannot land on
     top of a newer one
   · a '#tag' query  → `messages.byTag`, an EXACT keyword lookup;
     `#ml` and `#machinelearning` are different tags, so this is
     not a prefix search and the banner says so
   · a media chip    → the gallery index; 'Pinned' → the pin list

   Recents are per channel and live on the device: there is no
   endpoint that writes a search.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isTransient } from '@/api'
import { storage } from '@/platform/storage'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Chip, ChipRail, EmptyState, Header, Icon, Screen, SearchField, Skeleton, Text,
  Touchable, TouchableRow, formatCount,
} from '@/ui'
import { TopStrip } from '@/components/channels/states'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'IMAGE', label: 'Photos' },
  { value: 'VIDEO', label: 'Videos' },
  { value: 'FILE', label: 'Files' },
  { value: 'LINK', label: 'Links' },
  { value: 'pinned', label: 'Pinned' },
]

/* Module scope — FlashList compares keyExtractor by identity. */
const keyExtractor = (m: any) => String(m.id)

const RECENTS_CAP = 8
const recentsKey = (id: string) => `ika:channel:${id}:recents`

function readRecents(id: string): string[] {
  try {
    const raw = storage.getItem(recentsKey(id))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x: any) => typeof x === 'string').slice(0, RECENTS_CAP) : []
  } catch {
    /* A corrupt blob is not worth a crash on the way into search. */
    return []
  }
}

function writeRecents(id: string, list: string[]) {
  try { storage.setItem(recentsKey(id), JSON.stringify(list.slice(0, RECENTS_CAP))) } catch { /* noop */ }
}

export default function ChannelSearchScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [q, setQ] = React.useState('')
  const [committed, setCommitted] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [recents, setRecents] = React.useState<string[]>(() => readRecents(id))
  const [rows, setRows] = React.useState<any[]>([])
  const [tags, setTags] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => setCommitted(q.trim()), 300)
    return () => clearTimeout(timer)
  }, [q])

  const isTag = committed.startsWith('#')
  const tagName = isTag ? committed.slice(1).trim() : ''
  const mediaFilter = filter !== 'all' && filter !== 'pinned' ? filter : ''

  React.useEffect(() => {
    if (!id) return
    if (!committed && filter === 'all') { setRows([]); setError(null); return }

    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setBusy(true)
    setError(null)

    const run = async () => {
      if (filter === 'pinned') return api.chat.messages.pinned(id)
      if (mediaFilter) return api.chat.messages.media(id, args({ kind: mediaFilter, limit: 40 }))
      if (isTag) return tagName ? api.chat.messages.byTag(id, tagName) : []
      return api.chat.messages.search(id, committed, 30, { signal: ctl.signal })
    }

    run()
      .then(res => { if (!ctl.signal.aborted) { setRows(res || []); setBusy(false) } })
      .catch((e: any) => {
        /* An aborted request is the expected outcome of typing, not a
           failure — it must never reach the UI. */
        if (e?.name === 'AbortError' || ctl.signal.aborted) return
        setError(e)
        setBusy(false)
      })

    return () => ctl.abort()
  }, [id, committed, filter, mediaFilter, isTag, tagName])

  /* The tag cloud is built from whatever posts this session has seen — there
     is no per-channel tag endpoint, so an honest "tags on the loaded posts"
     beats an empty section. */
  React.useEffect(() => {
    if (!id) return
    api.chat.messages.page(id, args({ limit: 40 }))
      .then((res: any) => {
        const counts = new Map<string, number>()
        for (const m of res.items || []) for (const tag of m.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1)
        setTags([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([tag]) => tag))
      })
      .catch(() => {})
  }, [id])

  const submit = (value: string) => {
    const term = value.trim()
    if (!term) return
    setCommitted(term)
    setRecents(prev => {
      const next = [term, ...prev.filter(x => x.toLowerCase() !== term.toLowerCase())].slice(0, RECENTS_CAP)
      writeRecents(id, next)
      return next
    })
  }

  const notMember = error?.status === 403
  const idle = !committed && filter === 'all'

  /* Identity-stable: this screen re-renders on every keystroke, and an inline
     renderItem would re-render every mounted result with it. */
  const openResult = useEvent((message: any) => router.push(chRoute.post(id, String(message.id))))
  const query = isTag ? '' : committed
  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <ResultRow message={item} query={query} onPress={openResult} />,
    [query, openResult],
  )

  return (
    <Screen>
      <Header
        back={false}
        titleNode={
          <SearchField
            value={q}
            onChangeText={setQ}
            onSubmit={() => submit(q)}
            onCancel={() => router.back()}
            placeholder="Search posts"
            autoFocus
          />
        }
        border={false}
        below={
          !isTag ? (
            <ChipRail style={{ paddingBottom: space.sm2 }}>
              {FILTERS.map(f => (
                <Chip
                  key={f.value}
                  label={f.label}
                  selected={filter === f.value}
                  onPress={() => setFilter(filter === f.value ? 'all' : f.value)}
                />
              ))}
            </ChipRail>
          ) : (
            <View style={[styles.tagBanner, { backgroundColor: c.accentSofter }]}>
              <Icon name="hash" size={16} color={c.accent} />
              <View style={styles.flex}>
                <Text variant="subhead" tone="accent" align="ui">Exact tag: #{tagName}</Text>
                <Text variant="caption" tone="muted" align="ui">#ml and #machinelearning are different tags.</Text>
              </View>
            </View>
          )
        }
      />

      {busy ? <View style={[styles.progress, { backgroundColor: c.accent }]} /> : null}
      {error && isTransient(error) ? <TopStrip>Search is temporarily unavailable.</TopStrip> : null}

      {notMember ? (
        <EmptyState icon="lock" title="Subscribe to search this channel" message={errorText(error)} />
      ) : idle ? (
        <IdleState
          recents={recents}
          tags={tags}
          onPick={term => { setQ(term); submit(term) }}
          onRemove={term => setRecents(prev => { const next = prev.filter(x => x !== term); writeRecents(id, next); return next })}
          onTag={tag => { setQ(`#${tag}`); submit(`#${tag}`) }}
        />
      ) : busy && !rows.length ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={56} radius={12} />)}
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={keyExtractor}
          extraData={committed}
          renderItem={renderItem}
          ListEmptyComponent={
            error && !isTransient(error) ? (
              <EmptyState icon="error" title="That search didn’t work" message={errorText(error)} />
            ) : isTag ? (
              <EmptyState icon="hash" title={`No posts tagged #${tagName} yet.`} message="Tags are re-extracted whenever a post is edited, so this can change." />
            ) : (
              <EmptyState icon="search" title={`No posts match “${committed}”`} message="Try fewer words, or search a #tag." />
            )
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: space.huge }}
        />
      )}
    </Screen>
  )
}

/* ---------------------------------------------------------
   Idle
   --------------------------------------------------------- */

function IdleState({
  recents, tags, onPick, onRemove, onTag,
}: {
  recents: string[]
  tags: string[]
  onPick: (term: string) => void
  onRemove: (term: string) => void
  onTag: (tag: string) => void
}) {
  const t = useTheme()
  const c = t.colors
  if (!recents.length && !tags.length) {
    return <EmptyState icon="search" title="Search this channel" message="Find a post by its words, or by an exact #tag." />
  }
  return (
    <View style={{ paddingTop: space.sm }}>
      {recents.length ? (
        <>
          <Text variant="caption" tone="muted" align="ui" style={styles.groupLabel}>Recent searches</Text>
          {recents.map(term => (
            <TouchableRow key={term} onPress={() => onPick(term)}>
              <View style={styles.recentRow}>
                <Icon name="history" size={17} color={c.textMuted} />
                <Text variant="callout" align="auto" style={styles.flex} numberOfLines={1}>{term}</Text>
                <Touchable onPress={() => onRemove(term)} feedback="dim" accessibilityLabel={`Remove ${term}`}>
                  <Icon name="close" size={15} color={c.textFaint} />
                </Touchable>
              </View>
            </TouchableRow>
          ))}
        </>
      ) : null}

      {tags.length ? (
        <>
          <Text variant="caption" tone="muted" align="ui" style={styles.groupLabel}>Popular tags in this channel</Text>
          <View style={styles.cloud}>
            {tags.map(tag => <Chip key={tag} label={`#${tag}`} tone="accent" size="sm" onPress={() => onTag(tag)} />)}
          </View>
        </>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   A result
   --------------------------------------------------------- */

const ResultRow = React.memo(function ResultRow({
  message, query, onPress,
}: { message: any; query: string; onPress: (message: any) => void }) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => onPress(message), [onPress, message])
  const media = message.media?.[0]
  const meta = [
    message.authorSignature || null,
    message.time,
    message.views != null ? `${formatCount(message.views)} views` : null,
  ].filter(Boolean).join(' · ')

  return (
    <TouchableRow onPress={press}>
      <View style={[styles.resultRow, { paddingHorizontal: t.layout.screenPadding }]}>
        <View style={[styles.thumb, { backgroundColor: c.surfaceSunken }]}>
          <Icon name={media ? (media.kind === 'VIDEO' ? 'video' : 'image') : message.poll ? 'poll' : 'chat'} size={18} color={c.textMuted} />
        </View>
        <View style={styles.flex}>
          <Text variant="callout" numberOfLines={2} align="auto">
            {highlight(message.body || '', query, c.accentText)}
          </Text>
          <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>{meta}</Text>
        </View>
        <Icon name={t.isRTL ? 'back' : 'forward'} size={16} color={c.textFaint} />
      </View>
    </TouchableRow>
  )
})

/** Client-side highlight of the literal query substring. The server does not
 *  send offsets, so this is a display nicety and never changes the text. */
function highlight(body: string, query: string, color: string): React.ReactNode {
  const q = query.trim()
  if (!q) return body
  const i = body.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return body
  return (
    <>
      {body.slice(0, i)}
      <Text variant="callout" color={color} weight="700">{body.slice(i, i + q.length)}</Text>
      {body.slice(i + q.length)}
    </>
  )
}

const styles = StyleSheet.create({
  progress: { height: 2 },
  tagBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm },
  /* No textTransform: `caption` uppercases LATIN ONLY inside the Text
     primitive, which is what protects an Arabic or Kurdish label. */
  groupLabel: { paddingHorizontal: space.lg, paddingTop: space.lg2, paddingBottom: space.xs2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 44 },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 72 },
  thumb: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
})
