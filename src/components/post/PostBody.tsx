/* =========================================================
   PostBody — a post or comment body with live #tags and
   @mentions, and a collapsed height with a "Show more".

   Two renderers, on purpose:

   · collapsed  a single <Text> with numberOfLines, because
                that is the only thing RN can actually truncate.
                Tokens are nested <Text> spans, which stay
                pressable inside the truncation.
   · expanded   <RichText>, which honours the PLAIN | MARKDOWN |
                HTML contract (headings, quotes, lists) that a
                flat string cannot.

   Truncation is measured once by an absolutely-positioned copy
   with no line cap: `onTextLayout` on a capped <Text> reports
   the capped count on Android, so asking it directly would
   either never offer "Show more" or always offer it.

   That measure is the expensive half of a feed card (two text
   layouts, the second one uncapped), so it is paid at most once
   per (text, width, voice): the answer goes into a module-scope
   LRU and a recycled row that has seen this body before renders
   straight from it with no hidden copy at all. Everything the
   measure produces is also RESET when `plain` changes —
   FlashList hands a mounted instance the next item's props, so a
   `useState` line count would otherwise describe the previous
   post and an expanded body would stay open onto the next one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text, Touchable } from '@/ui'
import { RichText, mentionSpans, toPlainText } from '@/lib/richtext'

export interface PostBodyProps {
  text?: string | null
  /** PLAIN | MARKDOWN | HTML. Absent → detected by the richtext parser. */
  format?: string | null
  /** Collapse past this many lines and offer "Show more". 0 = never collapse. */
  numberOfLines?: number
  variant?: 'body' | 'callout' | 'subhead'
  reading?: boolean
  /** Post bodies read in the web app's serif voice; pass false for the odd
   *  chrome-adjacent use. */
  serif?: boolean
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  /** A tap anywhere that is not a token — the card's own press target. */
  onPress?: () => void
  onLongPress?: () => void
  selectable?: boolean
  style?: StyleProp<ViewStyle>
}

/* Tags only. Kurdish and Arabic tags are ordinary letters to \p{L}, so this
   matches the server's tag grammar closely enough for a preview — the
   authoritative extraction happens server-side.

   Mentions are NOT here: their grammar lives in @/lib/richtext (MENTION_RE)
   because the server's rule guards the character before the `@`, which a
   split-and-keep pattern cannot express. */
const TAG_RE = /#[\p{L}\p{N}_]+/gu

/* ---------------------------------------------------------
   The line-count cache. Keyed by everything that can change the
   answer — the rendered width, the type voice, and the text —
   so two surfaces at different gutters never share a count.
   Capped and FIFO-evicted: a long session scrolls past thousands
   of bodies and an unbounded map would hold every one of them
   alive for the life of the app.
   --------------------------------------------------------- */
const LINE_CACHE = new Map<string, number>()
const LINE_CACHE_MAX = 400

function readLines(key: string | null): number | null {
  if (!key) return null
  return LINE_CACHE.get(key) ?? null
}

function writeLines(key: string | null, lines: number) {
  if (!key) return
  if (LINE_CACHE.size >= LINE_CACHE_MAX) {
    const oldest = LINE_CACHE.keys().next().value
    if (oldest !== undefined) LINE_CACHE.delete(oldest)
  }
  LINE_CACHE.set(key, lines)
}

export function PostBody({
  text, format, numberOfLines = 0, variant = 'body', reading, serif = true,
  onPressTag, onPressMention, onPress, onLongPress, selectable, style,
}: PostBodyProps) {
  const t = useTheme()
  const plain = React.useMemo(() => toPlainText(text, format), [text, format])

  /* The width this instance was last laid out at, captured in onLayout and
     read only from the measure callback — a setState there would add a render
     to the very pass this whole mechanism exists to remove. */
  const widthRef = React.useRef(0)
  const keyAt = (w: number) => (w > 0 ? `${w}|${variant}|${reading ? 'r' : '-'}${serif ? 's' : '-'}|${plain}` : null)

  /* The width rides in the state, not read off the ref at render time: the
     reset below runs during render, and a ref is not a render input. */
  const [measured, setMeasured] = React.useState<{ text: string; lines: number | null; width: number }>(
    () => ({ text: plain, lines: null, width: 0 }),
  )
  const [expanded, setExpanded] = React.useState(false)

  /* Render-phase reset on item change — React's derived-state idiom, the same
     one ImageMedia uses (PostMedia.tsx:124). FlashList swaps props on a
     mounted instance, so without this a recycled row keeps the previous post's
     line count (and never re-measures, because it is no longer null) and an
     expanded body stays expanded onto the next one. */
  if (measured.text !== plain) {
    setMeasured(prev => ({ text: plain, lines: readLines(keyAt(prev.width)), width: prev.width }))
    if (expanded) setExpanded(false)
  }

  const lineCount = measured.text === plain ? measured.lines : null
  const collapsible = numberOfLines > 0
  const collapsed = collapsible && !expanded

  if (!plain.trim()) return null

  const spans = (
    <Tokens
      text={plain}
      onPressTag={onPressTag}
      onPressMention={onPressMention}
      accent={t.colors.accentText}
    />
  )

  const truncated = lineCount !== null && lineCount > numberOfLines

  return (
    <View
      style={style}
      onLayout={e => { widthRef.current = Math.round(e.nativeEvent.layout.width) }}
    >
      {collapsed ? (
        <>
          <Text
            variant={variant}
            reading={reading}
            serif={serif}
            numberOfLines={numberOfLines}
            onPress={onPress}
            onLongPress={onLongPress}
            suppressHighlighting
          >
            {spans}
          </Text>

          {/* One-shot measurement. Absolute so it never occupies layout,
              unmounted the moment the answer is in, and skipped entirely when
              the cache already knows this body at this width. Must share the
              rendered copy's font — a sans measure of a serif body miscounts
              lines. */}
          {lineCount === null ? (
            <Text
              variant={variant}
              reading={reading}
              serif={serif}
              style={styles.measure}
              onTextLayout={e => {
                const lines = e.nativeEvent.lines.length
                /* The width is read here, in an event: the wrapper's onLayout
                   and this callback land in the same commit and their order is
                   not guaranteed, so a 0 just means the next item at this row
                   measures once more instead of reading the cache. */
                const width = widthRef.current
                writeLines(keyAt(width), lines)
                setMeasured({ text: plain, lines, width })
              }}
            >
              {plain}
            </Text>
          ) : null}

          {truncated ? (
            <Touchable
              onPress={() => setExpanded(true)}
              feedback="dim"
              noAutoHitSlop
              accessibilityState={{ expanded: false }}
              style={styles.more}
            >
              <Text variant="subhead" tone="muted" align="ui">Show more</Text>
            </Touchable>
          ) : null}
        </>
      ) : (
        <RichText
          body={text}
          format={format}
          reading={reading}
          serif={serif}
          selectable={selectable}
          onPressTag={onPressTag}
          onPressMention={onPressMention}
        />
      )}
    </View>
  )
}

/* Nested <Text> rather than a wrapper <View>: only a text child survives the
   parent's numberOfLines, and only a text child flows inline with the run.
   That constraint is why the shared GRAMMAR is imported rather than the
   shared component — MentionHighlightedText renders its own tree and would
   break truncation here, and it knows nothing about #tags.
   One pass, spans merged in order, so a body with both kinds stays a single
   run of nested text children. */
function Tokens({
  text, onPressTag, onPressMention, accent,
}: {
  text: string
  onPressTag?: (tag: string) => void
  onPressMention?: (handle: string) => void
  accent: string
}) {
  const t = useTheme()
  const parts = React.useMemo(() => {
    type Span = { start: number; end: number; kind: 'tag' | 'mention'; value: string; inert?: boolean }
    const spans: Span[] = mentionSpans(text).map(m => ({
      start: m.start,
      end: m.end,
      kind: 'mention' as const,
      value: m.handle,
      /* @followers is a broadcast sentinel, not a person: nothing to open. */
      inert: m.followersSentinel,
    }))
    TAG_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TAG_RE.exec(text))) {
      spans.push({ start: m.index, end: m.index + m[0].length, kind: 'tag', value: m[0].slice(1) })
    }
    spans.sort((a, b) => a.start - b.start)

    const out: { key: string; text: string; span?: Span }[] = []
    let at = 0
    for (const s of spans) {
      /* Overlaps cannot happen between the two grammars, but a defensive skip
         costs nothing and keeps the slice arithmetic monotonic. */
      if (s.start < at) continue
      if (s.start > at) out.push({ key: `t${at}`, text: text.slice(at, s.start) })
      out.push({ key: `s${s.start}`, text: text.slice(s.start, s.end), span: s })
      at = s.end
    }
    if (at < text.length) out.push({ key: `t${at}`, text: text.slice(at) })
    return out
  }, [text])

  return (
    <>
      {parts.map(part => {
        if (!part.text) return null
        const s = part.span
        if (!s) return <Text key={part.key}>{part.text}</Text>
        /* Tokens carry the web's weight (tk-tag/tk-mention are 600). */
        if (s.inert) return <Text key={part.key} color={t.colors.warningText} weight="600">{part.text}</Text>
        const handler = s.kind === 'tag' ? onPressTag : onPressMention
        if (!handler) return <Text key={part.key} color={accent} weight="600">{part.text}</Text>
        return (
          <Text key={part.key} color={accent} weight="600" onPress={() => handler(s.value)} suppressHighlighting>
            {part.text}
          </Text>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, right: 0, opacity: 0, pointerEvents: 'none' },
  more: { alignSelf: 'flex-start', paddingTop: space.xs, paddingBottom: space.xxs },
})
