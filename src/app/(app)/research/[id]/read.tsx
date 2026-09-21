/* =========================================================
   Reader — the paper's body, and nothing else.

   Deliberately does NOT open the SSE stream. The per-user cap
   is five emitters and there is not a single live counter on
   this screen, so a socket here would evict a chat or a
   notification stream to animate nothing.

   The typography choices are per-device and persist in MMKV:
   a reading preference is not something to re-make on every
   paper.
   ========================================================= */
import React from 'react'
import { Linking, RefreshControl, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Share } from 'react-native'
import { api, errorText, isNotFound } from '@/api'
import { storage } from '@/platform/storage'
import { useTheme } from '@/theme/ThemeProvider'
import { palettes, withAlpha, type Palette } from '@/theme/colors'
import { motion, ramp, setback, space } from '@/theme/tokens'
import {
  Button, Divider, Icon, IconButton, Screen, ScreenScroll, SealBand, SegmentedControl, Selvedge,
  Sheet, Skeleton, Text, Touchable, formatCount, toast, useSheetState,
} from '@/ui'
import { parseRich, type Block, type Inline } from '@/lib/richtext'
import { ResearchCover } from '@/components/research/ResearchCover'
import { SourceRow } from '@/components/research/SourceRow'
import { ErrorPanel, GoneState, useTransientRetry } from '@/components/research/states'
import { useResearchDetail, toggleSaveRemote } from '@/components/research/hooks'
import type { ResearchDetail } from '@/components/research/types'
import { to } from '@/components/research/nav'

type ReaderTheme = 'paper' | 'sepia' | 'night'
const SIZES = [15, 16, 17, 19, 21]
const PREFS_KEY = 'research.reader.prefs'
/* The floating bar's own height: the 48pt control row plus the 2pt progress
   course under it. Everything that must clear the bar adds this to insets.top. */
const CHROME = 50

/* Masonry ease (motion.out): fast arrival, dead stop. */
const masonry = Easing.bezier(...motion.out)

interface ReaderPrefs { step: number; serif: boolean; theme: ReaderTheme }

function loadPrefs(): ReaderPrefs {
  try {
    const raw = storage.getItem(PREFS_KEY)
    const p = raw ? JSON.parse(raw) : null
    if (p && typeof p.step === 'number') return { step: p.step, serif: p.serif !== false, theme: p.theme || 'paper' }
  } catch { /* a corrupt preference is not worth a crash */ }
  return { step: 2, serif: true, theme: 'paper' }
}

export default function ReaderScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  /* Full-bleed reader: nothing here sits inside a <Screen edges>, so every
     window-anchored offset is measured from the inset, never from a
     hand-picked 44. `chromeTop` is the bottom edge of the floating bar — the
     retraction band and the first line of body text hang off it, so all three
     move together on a Dynamic Island exactly as they do on a 20pt status
     bar. */
  const chromeTop = insets.top + CHROME

  /* No stream, and no second view record: the detail screen almost always ran
     first and the server dedupes per user forever anyway. */
  const { detail, error, loading, reload, patch } = useResearchDetail(id, { subscribe: false })
  useTransientRetry(error, reload)

  const typography = useSheetState()
  const [prefs, setPrefs] = React.useState<ReaderPrefs>(loadPrefs)
  const [sourcesOpen, setSourcesOpen] = React.useState(false)
  const [progress, setProgress] = React.useState(0)

  const write = (next: ReaderPrefs) => {
    setPrefs(next)
    try { storage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const chrome = useSharedValue(1)
  const lastY = React.useRef(0)
  const scroller = React.useRef<ScrollView>(null)
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: chrome.value,
    transform: [{ translateY: (1 - chrome.value) * -18 }],
    /* An invisible bar must not swallow taps: release the top band as soon
       as the hide animation is underway (opacity 0 keeps hit-testing on). */
    pointerEvents: (chrome.value < 0.5 ? 'none' : 'auto') as 'none' | 'auto',
  }))

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    const y = contentOffset.y
    const span = Math.max(1, contentSize.height - layoutMeasurement.height)
    setProgress(Math.min(1, Math.max(0, y / span)))
    const down = y > lastY.current + 6
    const up = y < lastY.current - 6
    if (down && chrome.value === 1 && y > 40) chrome.value = withTiming(0, { duration: t.ms(t.motion.fast), easing: masonry })
    if (up && chrome.value === 0) chrome.value = withTiming(1, { duration: t.ms(t.motion.fast), easing: masonry })
    lastY.current = y
  }

  /* The three reading grounds come from the theme's own ramps rather than from
     literals here: sepia has no semantic role (nothing else in the app is
     sepia), so the warm end of the scholar ramp stands in for it, and night
     borrows the dark palette regardless of the app's current scheme. */
  const surface =
    prefs.theme === 'night' ? palettes.dark.bgSunken
      : prefs.theme === 'sepia' ? ramp.scholar[50]
        : c.bg
  const ink =
    prefs.theme === 'night' ? palettes.dark.text
      : prefs.theme === 'sepia' ? ramp.slate[900]
        : c.text
  /* Accent/status roles must follow the READER ground, not the app scheme:
     with the app light and the reader on night, the light accent #002147 on
     the night ground reads 1.2:1 — invisible. Night borrows the dark
     palette's roles wholesale, sepia's warm-light ground takes the light
     palette's, and paper follows the app. */
  const rc: Palette =
    prefs.theme === 'night' ? palettes.dark
      : prefs.theme === 'sepia' ? palettes.light
        : c

  const toggleSave = async () => {
    if (!detail) return
    const next = !detail.saved
    patch(d => ({ ...d, saved: next }))
    try {
      const res = await toggleSaveRemote(id, next)
      patch(d => ({ ...d, saved: res.saved, metrics: { ...d.metrics, saves: res.saves } }))
    } catch (e: any) {
      patch(d => ({ ...d, saved: !next }))
      toast.error(errorText(e))
    }
  }

  const shareQuote = async () => {
    if (!detail) return
    /* Quote attribution is the AUTHOR — the title is already the quote. */
    const line = `"${detail.title}" — ${detail._author.full}${detail.irc ? `, ${detail.irc}` : ''}${detail.shareUrl ? `, ${detail.shareUrl}` : ''}`
    const res = await Share.share({ message: line })
    /* The share count only moves on a COMPLETED share, not a dismissed sheet. */
    if (res.action === Share.sharedAction) {
      try { await api.research.recordShare(id) } catch { /* a missed count is not worth a toast */ }
    }
  }

  if (loading) return <ReaderSkeleton />
  if (error && isNotFound(error)) {
    return (
      <Screen><GoneState onAction={() => router.replace(to('/research'))} /></Screen>
    )
  }
  if (error || !detail) {
    return (
      <Screen>
        <ErrorPanel error={error} onRetry={reload} />
      </Screen>
    )
  }

  const hasBody = !!(detail.descriptionHtml?.trim() || detail.description?.trim())

  return (
    <View style={[styles.fill, { backgroundColor: surface }]}>
      <Animated.View style={[styles.topBar, { paddingTop: insets.top, backgroundColor: withAlpha(surface, 0.94) }, chromeStyle]}>
        <View style={styles.topRow}>
          <IconButton name="back" onPress={() => router.back()} accessibilityLabel="Back" size={22} color={ink} />
          <Text variant="caption" tone="muted" align="center" numberOfLines={1} style={styles.flex} color={ink}>
            {detail.title}
          </Text>
          <Touchable onPress={() => typography.open()} feedback="scale" accessibilityLabel="Reading options" style={styles.aa}>
            <Text variant="subhead" weight="700" color={ink}>Aa</Text>
          </Touchable>
          <IconButton
            name="bookmark"
            filled={detail.saved}
            onPress={toggleSave}
            accessibilityLabel={detail.saved ? 'Remove from saved' : 'Save paper'}
            size={20}
            color={detail.saved ? rc.scholar : ink}
          />
        </View>
        <View style={[styles.progressTrack, { backgroundColor: withAlpha(ink, 0.12) }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: rc.accent }]} />
        </View>
      </Animated.View>

      {detail.status === 'RETRACTED' ? (
        <View style={[styles.retracted, { top: chromeTop - 2, backgroundColor: c.dangerSoft }]}>
          <Selvedge color={c.danger} />
          <Icon name="warning" size={14} color={c.dangerText} />
          <Text variant="caption" tone="danger" align="ui">RETRACTED — kept readable for citation integrity.</Text>
        </View>
      ) : null}

      <ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.body, { paddingTop: chromeTop + 28 }]}
        style={styles.fill}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void reload() }} tintColor={c.textMuted} />}
      >
        {/* Gilt seal impression atop the reader header — the SEAL BAND's
            second sanctioned home (§5.2). */}
        <SealBand style={{ marginBottom: space.lg }} />

        {/* The title is Lora through the display variant (§4) — never
            hand-set. The serif/sans preference governs the body only. */}
        <Text variant="title1" align="auto" color={ink} style={{ marginBottom: space.lg2 }}>
          {detail.title}
        </Text>

        {hasBody ? (
          <View style={{ marginBottom: 28 }}>
            <ReaderBody detail={detail} prefs={prefs} ink={ink} rc={rc} />
          </View>
        ) : (
          <View style={styles.emptyBody}>
            <Text variant="title3" align="center" color={ink}>This paper has no body text yet.</Text>
            <Button
              label="Read the abstract instead"
              variant="tinted"
              onPress={() => router.back()}
              style={{ marginTop: space.md2 }}
            />
          </View>
        )}

        <Divider />

        {detail.citation ? (
          <View style={[styles.citation, { backgroundColor: withAlpha(ink, 0.06), ...setback(t.shape.popover) }]}>
            {/* The ledger voice resolves in the primitive (`mono` → IBM Plex
                Mono) — never a raw fontFamily at the call site (§4). */}
            <Text variant="footnote" mono color={ink} align="auto" selectable style={{ lineHeight: 20 }}>
              {detail.citation}
            </Text>
            <Touchable
              onPress={async () => { await Clipboard.setStringAsync(detail.citation); toast.ok('Citation copied') }}
              feedback="dim"
              style={styles.copy}
            >
              <Icon name="copy" size={15} color={rc.accentText} />
              <Text variant="caption" color={rc.accentText}>Copy</Text>
            </Touchable>
          </View>
        ) : null}

        {detail.sources.length ? (
          <View style={{ marginTop: space.xl }}>
            <Touchable onPress={() => setSourcesOpen(v => !v)} feedback="dim" style={styles.accordion}>
              <Text variant="title3" align="ui" color={ink} style={styles.flex}>Sources ({detail.sources.length})</Text>
              <Icon name={sourcesOpen ? 'up' : 'down'} size={18} color={ink} />
            </Touchable>
            {sourcesOpen ? (
              <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn} exiting={t.prefs.reducedMotion ? undefined : FadeOut}>
                {detail.sources.map((s, i) => <SourceRow key={s.id} source={s} index={i + 1} />)}
              </Animated.View>
            ) : null}
          </View>
        ) : null}

        {detail.contributors.length ? (
          <View style={{ marginTop: space.xxl }}>
            {/* `micro` uppercases Latin INSIDE the Text primitive — which is what
    leaves an Arabic or Kurdish run alone — so the eyebrow is written in
    sentence case and takes the variant's own tracking. */}
            <Text variant="micro" tone="muted" align="ui" style={styles.label}>Contributors</Text>
            {detail.contributors.map((row, i) => (
              <Text key={row._user.id || i} variant="footnote" color={ink} align="ui" style={{ marginTop: space.xs2 }}>
                {row._user.full} — {row.role.replace(/_/g, ' ').toLowerCase()}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.footerButtons}>
          <Button
            label="Cite this paper"
            icon="cite"
            variant="secondary"
            style={styles.flex}
            onPress={() => router.push(to(`/research/${id}/share?tab=cite`))}
          />
          <Button
            label={`Discuss (${formatCount(detail.metrics.comments)})`}
            icon="comment"
            variant="tinted"
            style={styles.flex}
            onPress={() => router.push(to(`/research/${id}/comments`))}
          />
        </View>

        <Touchable onPress={shareQuote} feedback="dim" style={styles.shareQuote}>
          <Icon name="quote" size={15} color={rc.accentText} />
          <Text variant="subhead" color={rc.accentText} align="center">Share a quote from this paper</Text>
        </Touchable>
      </ScrollView>

      {progress > 0.3 ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn}
          /* Floating over a bare View, so the plate owns the gesture bar
             itself — at bottom: 28 its lower third sat behind a 48pt
             3-button nav exactly when the scroll finally offered it. */
          style={[styles.toTop, { bottom: Math.max(insets.bottom, 12) + 16 }]}
        >
          <Touchable
            onPress={() => scroller.current?.scrollTo({ y: 0, animated: !t.prefs.reducedMotion })}
            feedback="scale"
            accessibilityLabel="Back to top"
            style={[
              styles.toTopPlate,
              {
                backgroundColor: c.surfaceRaised,
                borderWidth: t.rule.course,
                borderColor: c.borderStrong,
                ...setback(t.shape.buttonSm),
              },
            ]}
          >
            <Icon name="up" size={15} color={c.text} />
            <Text variant="caption" weight="600">Top</Text>
          </Touchable>
        </Animated.View>
      ) : null}

      <Sheet visible={typography.visible} onClose={typography.close} title="Reading">
        <View style={{ padding: space.lg, gap: space.xl }}>
          <View style={{ gap: space.sm }}>
            <Text variant="subhead" tone="secondary" align="ui">Text size</Text>
            <View style={styles.stepper}>
              <IconButton
                name="minus"
                onPress={() => write({ ...prefs, step: Math.max(0, prefs.step - 1) })}
                accessibilityLabel="Smaller text"
                size={16}
                surface="soft"
              />
              <View style={styles.stepTrack}>
                {SIZES.map((_, i) => (
                  <View
                    key={i}
                    /* Square-ended courses, not lozenges — the meter is
                       drawn line-work (THE LOOM). */
                    style={{
                      flex: 1,
                      height: 4,
                      backgroundColor: i <= prefs.step ? c.accent : c.borderFaint,
                    }}
                  />
                ))}
              </View>
              <IconButton
                name="add"
                onPress={() => write({ ...prefs, step: Math.min(SIZES.length - 1, prefs.step + 1) })}
                accessibilityLabel="Larger text"
                size={16}
                surface="soft"
              />
            </View>
          </View>

          <SegmentedControl
            options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]}
            value={prefs.serif ? 'serif' : 'sans'}
            onChange={v => write({ ...prefs, serif: v === 'serif' })}
          />

          <SegmentedControl
            options={[
              { value: 'paper', label: 'Paper' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'night', label: 'Night' },
            ]}
            value={prefs.theme}
            onChange={v => write({ ...prefs, theme: v as ReaderTheme })}
          />

          <Text variant="footnote" tone="muted" align="ui">
            These apply to the reader only, on this device.
          </Text>
        </View>
      </Sheet>
    </View>
  )
}

/* ---------------------------------------------------------
   The body.

   `RichBody` (and the shared <RichText> underneath it) paints
   at the app's global reading size, which is exactly right
   everywhere else and exactly wrong here: this screen owns a
   five-step size control, a serif/sans switch and three inks.
   So the PARSE still comes from '@/lib/richtext' — that parser
   is the safety contract, and nothing here re-sanitises or
   re-implements it — and only the paint is local.
   --------------------------------------------------------- */

function ReaderBody({ detail, prefs, ink, rc }: { detail: ResearchDetail; prefs: ReaderPrefs; ink: string; rc: Palette }) {
  const size = SIZES[prefs.step] ?? 17
  /* The Serif toggle maps to the primitive's `serif` prop — the family
     (Lora, with the §4 Arabic swap) resolves inside Text, never here. */
  const serif = prefs.serif
  const html = detail.descriptionHtml?.trim()
  const blocks = React.useMemo(
    () => parseRich(html || detail.description, html ? 'HTML' : detail.bodyFormat),
    [html, detail.description, detail.bodyFormat],
  )
  return (
    <View>
      {blocks.map((b, i) => (
        <ReaderBlock key={i} block={b} size={size} serif={serif} ink={ink} rc={rc} first={i === 0} />
      ))}
    </View>
  )
}

function ReaderBlock({
  block, size, serif, ink, rc, first, depth = 0,
}: { block: Block; size: number; serif: boolean; ink: string; rc: Palette; first: boolean; depth?: number }) {
  const t = useTheme()
  const router = useRouter()
  const gap = first ? 0 : 14
  const base = { fontSize: size, lineHeight: Math.round(size * 1.65) }

  const run = (nodes: Inline[]) => <ReaderInline nodes={nodes} ink={ink} rc={rc} router={router} />

  switch (block.t) {
    case 'p':
      return <Text variant="body" serif={serif} align="auto" selectable color={ink} style={[base, { marginTop: gap }]}>{run(block.c)}</Text>

    case 'h': {
      const scale = block.level <= 1 ? 1.35 : block.level === 2 ? 1.2 : 1.08
      return (
        <Text
          variant="body"
          serif={serif}
          align="auto"
          selectable
          color={ink}
          weight="600"
          style={{
            fontSize: Math.round(size * scale),
            lineHeight: Math.round(size * scale * 1.35),
            marginTop: first ? 0 : 24,
          }}
        >
          {run(block.c)}
        </Text>
      )
    }

    case 'quote':
      return (
        <View style={[styles.quote, { borderStartColor: rc.accent, marginTop: gap }]}>
          {block.c.map((b, i) => (
            <ReaderBlock key={i} block={b} size={size} serif={serif} ink={ink} rc={rc} first={i === 0} depth={depth + 1} />
          ))}
        </View>
      )

    case 'pre':
      /* buttonMd's 10/3 setback stands in for the code well — it keeps the
         old 10pt crown while rooting the base (there is no `pre` shape). */
      return (
        <View style={[styles.pre, { backgroundColor: withAlpha(ink, 0.07), marginTop: gap, ...setback(t.shape.buttonMd) }]}>
          <ScreenScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.preInner}>
            <Text variant="footnote" mono align="left" selectable color={ink} style={{ lineHeight: 20 }}>
              {block.v}
            </Text>
          </ScreenScroll>
        </View>
      )

    case 'ul':
    case 'ol':
      return (
        <View style={{ marginTop: gap, gap: space.xs2 }}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.bulletCol}>
                {block.t === 'ol'
                  ? <Text variant="footnote" serif={serif} color={ink}>{block.start + i}.</Text>
                  : <View style={[styles.bullet, { backgroundColor: withAlpha(ink, 0.5) }]} />}
              </View>
              <View style={styles.flex}>
                {item.map((b, j) => (
                  <ReaderBlock key={j} block={b} size={size} serif={serif} ink={ink} rc={rc} first depth={depth + 1} />
                ))}
              </View>
            </View>
          ))}
        </View>
      )

    case 'hr':
      return <View style={[styles.rule, { backgroundColor: withAlpha(ink, 0.18) }]} />

    case 'img':
      return (
        <View style={{ marginTop: gap + 6 }}>
          <ResearchCover uri={block.src} ratio={16 / 10} radius={12} />
          {block.alt ? (
            <Text variant="caption" italic align="center" color={withAlpha(ink, 0.7)} style={{ marginTop: space.sm }}>
              {block.alt}
            </Text>
          ) : null}
        </View>
      )

    case 'table':
      return (
        <View style={{ marginTop: gap, gap: space.xs2 }}>
          {[block.head, ...block.rows.map(r => r.flat())].map((cells, i) => (
            <Text key={i} variant="footnote" serif={serif} align="auto" color={ink} selectable>
              {(cells as Inline[][]).flat ? '' : ''}
              <ReaderInline nodes={(Array.isArray(cells) ? cells.flat() : []) as Inline[]} ink={ink} rc={rc} router={router} />
            </Text>
          ))}
        </View>
      )

    default:
      return null
  }
}

function ReaderInline({ nodes, ink, rc, router }: { nodes: Inline[]; ink: string; rc: Palette; router: ReturnType<typeof useRouter> }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <Text key={i} style={styles.inherit}>{n.v}</Text>
          case 'b': return <Text key={i} weight="700" style={styles.inherit}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 'i': return <Text key={i} italic style={styles.inherit}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 'u': return <Text key={i} underline style={styles.inherit}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 's': return <Text key={i} strike style={styles.inherit}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 'mark': return <Text key={i} style={[styles.inherit, { backgroundColor: rc.warningSoft }]}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 'sup':
          case 'sub': return <Text key={i} variant="caption" color={ink}><ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} /></Text>
          case 'code': return <Text key={i} mono color={rc.scholarText} style={styles.inherit}>{n.v}</Text>
          case 'br': return <Text key={i} style={styles.inherit}>{'\n'}</Text>
          case 'a':
            return (
              <Text key={i} color={rc.accentText} style={styles.inherit} onPress={() => void Linking.openURL(n.href)}>
                <ReaderInline nodes={n.c} ink={ink} rc={rc} router={router} />
              </Text>
            )
          case 'mention':
            return (
              <Text key={i} color={rc.accentText} style={styles.inherit} onPress={() => router.push(to(`/u/${n.handle}`))}>
                @{n.handle}
              </Text>
            )
          case 'tag':
            return (
              <Text
                key={i}
                color={rc.scholarText}
                style={styles.inherit}
                onPress={() => router.push(to(`/research/tag/${encodeURIComponent(n.tag)}`))}
              >
                #{n.tag}
              </Text>
            )
          default: return null
        }
      })}
    </>
  )
}

function ReaderSkeleton() {
  const widths = ['100%', '95%', '80%', '100%', '60%', '100%', '90%', '45%'] as const
  return (
    <Screen>
      <View style={{ padding: space.xl, paddingTop: 80, gap: space.md2 }}>
        <Skeleton width="70%" height={26} />
        <View style={{ height: 10 }} />
        {widths.map((w, i) => <Skeleton key={i} width={w} height={13} />)}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs2, height: 48 },
  aa: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 2, width: '100%' },
  progressFill: { height: 2 },
  /* `top` is supplied per-render from insets — see chromeTop. */
  retracted: {
    position: 'absolute', left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.xl, paddingVertical: space.xs2,
  },
  body: { paddingHorizontal: space.xl, paddingBottom: 80 },
  emptyBody: { alignItems: 'center', paddingVertical: space.huge },
  citation: { padding: space.md2, marginTop: space.xl, borderCurve: 'continuous' },
  copy: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.sm2, alignSelf: 'flex-start' },
  accordion: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm2 },
  label: {},
  footerButtons: { flexDirection: 'row', gap: space.sm2, marginTop: 28 },
  shareQuote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, paddingVertical: space.lg2 },
  toTop: { position: 'absolute', alignSelf: 'center' },
  toTopPlate: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.md2, height: 34, borderCurve: 'continuous' },
  quote: { borderStartWidth: 3, paddingStart: space.lg, paddingVertical: space.xxs },
  pre: { paddingVertical: space.sm2, borderCurve: 'continuous', overflow: 'hidden' },
  preInner: { paddingHorizontal: space.md, paddingBottom: 0 },
  listItem: { flexDirection: 'row', gap: space.sm },
  bulletCol: { width: 22, alignItems: 'center', paddingTop: space.sm2 },
  /* The list marker is QELAT's diamond (a turned square), not a disc. */
  bullet: { width: 5, height: 5, transform: [{ rotate: '45deg' }] },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 22 },
  /* Nested <Text> inherits its parent's metrics unless it redeclares them. */
  inherit: {},
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepTrack: { flexDirection: 'row', gap: space.xs, flex: 1, alignItems: 'center' },
  flex: { flex: 1 },
})
