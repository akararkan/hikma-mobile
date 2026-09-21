/* =========================================================
   Everything tagged with one tag.

   `api.tags.content` returns a MIXED cursor page — posts, reels,
   questions and research together — so the "Questions" filter
   is applied client-side after mapping. That means a page can
   legitimately render two rows out of twenty, which reads like
   the end of the tag; the footnote under the list says so
   explicitly rather than leaving the user to guess.

   The cursor token is opaque. It goes straight back to the
   server, never decoded.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useEvent } from '@/hooks/useAsync'
import { avatarGradient } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Header, Icon, ListFooter, Screen, SegmentedControl, Skeleton, Text, Touchable,
  toast, type IconName,
} from '@/ui'
import { tagsApi } from '@/components/qna/api'
import { QnaEmptyState, QnaErrorView, QnaSkeletons } from '@/components/qna/QnaState'
import { qnaHref } from '@/components/qna/routes'
import type { TagContentRow } from '@/components/qna/types'

type Mode = 'questions' | 'all'

const TYPE_GLYPH: Record<string, IconName> = {
  QUESTION: 'qna', RESEARCH: 'research', POST: 'home', REEL: 'reels',
}

/* Module scope: FlashList compares renderItem by identity, and the page mixes
   four content types — `getItemType` keys the recycle pool by type so a
   QUESTION row's React key is never handed to a REEL row's subtree. */
const keyExtractor = (r: TagContentRow) => `${r.contentType}:${r.contentId}`
const getItemType = (r: TagContentRow) => r.contentType

export default function TagScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ tag: string }>()
  const tag = safeDecode(params.tag)

  const [mode, setMode] = React.useState<Mode>('questions')
  const [rows, setRows] = React.useState<TagContentRow[]>([])
  const [cursor, setCursor] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [usage, setUsage] = React.useState<{ questions: number; all: number } | null>(null)
  const autoRetried = React.useRef(false)

  const load = React.useCallback(async (kind: 'first' | 'more' | 'refresh') => {
    if (!tag) return
    if (kind === 'more') setLoadingMore(true)
    else if (kind === 'refresh') setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await tagsApi.content(tag, { cursor: kind === 'more' ? cursor : undefined, pageSize: 20 })
      setRows(prev => {
        const next = kind === 'more' ? [...prev, ...res.items] : res.items
        const seen = new Set<string>()
        return next.filter(r => {
          const k = `${r.contentType}:${r.contentId}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
      })
      setCursor(res.nextCursor || '')
    } catch (e: any) {
      setError(e)
    } finally {
      setLoading(false); setLoadingMore(false); setRefreshing(false)
    }
  }, [tag, cursor])

  React.useEffect(() => {
    if (!tag) { setLoading(false); return }
    setCursor('')
    void load('first')
    /* One round trip for every scope instead of four. */
    tagsApi.usage(tag, { scope: '*' })
      .then(res => setUsage({
        questions: Number(res?.scopes?.QUESTION ?? 0),
        all: Number(res?.scopes?.ALL ?? 0),
      }))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag])

  /* isTransient reads get exactly one delayed automatic retry. */
  React.useEffect(() => {
    if (!error || autoRetried.current) return
    if (error.status !== 503) return
    autoRetried.current = true
    const id = setTimeout(() => void load('first'), 3000)
    return () => clearTimeout(id)
  }, [error, load])

  const questions = React.useMemo(() => rows.filter(r => r.contentType === 'QUESTION'), [rows])

  /* Rows exist but none are questions: switch to All rather than show a blank
     page over data that is right there. */
  React.useEffect(() => {
    if (mode === 'questions' && !loading && rows.length && !questions.length && !cursor) setMode('all')
  }, [mode, loading, rows.length, questions.length, cursor])

  const shown = mode === 'questions' ? questions : rows
  const filteredOut = mode === 'questions' && rows.length > questions.length
  const [g0, g1] = avatarGradient(tag)

  const openRow = (row: TagContentRow) => {
    switch (row.contentType) {
      case 'QUESTION': router.push(qnaHref.question(row.contentId)); return
      case 'RESEARCH': router.push(qnaHref.research(row.contentId)); return
      case 'POST':
      case 'REEL': router.push(qnaHref.post(row.contentId)); return
      default:
    }
  }

  /* Item-first and identity-stable, so `renderItem` only moves when the mode
     does — the one value a row actually renders differently. */
  const open = useEvent((row: TagContentRow) => openRow(row))
  const renderItem = React.useCallback(({ item }: { item: TagContentRow }) => (
    <Touchable
      onPress={() => open(item)}
      feedback="tint"
      noAutoHitSlop
      style={[styles.row, { borderBottomColor: c.separator }]}
    >
      <View style={[styles.badge, { backgroundColor: c.surfaceSunken }]}>
        <Icon name={TYPE_GLYPH[item.contentType] ?? 'file'} size={16} color={c.textSecondary} />
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={2} align="auto">
          {item.titlePreview || 'Untitled'}
        </Text>
        <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }}>
          {mode === 'all' ? `${label(item.contentType)} · ` : ''}{item.time}
        </Text>
      </View>
    </Touchable>
  ), [c, mode, open])

  if (!tag) {
    return (
      <Screen edges={['top']}>
        <Header back title="Tag" />
        <QnaErrorView error={{ status: 404, code: 'TAG_NOT_FOUND' }} onBack={() => router.replace(qnaHref.home())} />
      </Screen>
    )
  }

  return (
    <Screen edges={['top']}>
      <Header back title={`#${tag}`} border={false} />

      <FlashList
        data={shown}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        onEndReached={() => { if (cursor && !loadingMore && !loading) void load('more') }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setCursor(''); void load('refresh') }}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <Touchable
              onLongPress={async () => { await Clipboard.setStringAsync(`#${tag}`); toast.ok('Tag copied') }}
              feedback="none"
              noAutoHitSlop
              accessibilityLabel={`Tag ${tag}`}
            >
              <LinearGradient colors={[g0, g1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
                <Text variant="display" color={t.colors.overlayText} numberOfLines={2} align="auto">
                  <Text variant="display" color={t.colors.overlayTextMuted}>#</Text>{tag}
                </Text>
                {usage ? (
                  <Text variant="footnote" color={t.colors.overlayTextMuted} align="ui" style={{ marginTop: space.xs }}>
                    {usage.questions} {usage.questions === 1 ? 'question' : 'questions'} · {usage.all} items overall
                  </Text>
                ) : (
                  <Skeleton width={160} height={11} style={{ marginTop: space.sm }} />
                )}
              </LinearGradient>
            </Touchable>

            <View style={[styles.filterRow, { borderBottomColor: c.separator, backgroundColor: c.bg }]}>
              <SegmentedControl
                options={[{ value: 'questions', label: 'Questions' }, { value: 'all', label: 'All content' }]}
                value={mode}
                onChange={v => setMode(v as Mode)}
                style={styles.flex}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <QnaSkeletons kind="searchRow" count={5} />
          ) : error ? (
            <QnaErrorView error={error} onRetry={() => void load('first')} />
          ) : (
            <QnaEmptyState
              glyph="hash"
              title={`Nothing tagged #${tag} yet`}
              body="Tags fill up as scholars publish. Check back soon."
              actionLabel="Browse Q&A"
              onAction={() => router.replace(qnaHref.home())}
            />
          )
        }
        ListFooterComponent={
          shown.length ? (
            <View>
              {filteredOut ? (
                <Text variant="footnote" tone="faint" align="center" style={{ paddingTop: space.md }}>
                  Filtered from the tag feed
                </Text>
              ) : null}
              <ListFooter
                loading={loadingMore}
                error={error && shown.length ? error : null}
                onRetry={() => void load('more')}
                done={!cursor}
                doneLabel={`That is everything tagged #${tag}`}
              />
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

function label(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase()
}

function safeDecode(v: string | undefined): string {
  if (!v) return ''
  try { return decodeURIComponent(v).trim() } catch { return String(v).trim() }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { minHeight: 120, justifyContent: 'flex-end', padding: space.lg },
  filterRow: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
