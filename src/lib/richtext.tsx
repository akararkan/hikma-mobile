/* =========================================================
   Rich text — the RN port of lib/richtext.js.

   The web version was `marked` + DOMPurify + innerHTML. None
   of those three exist here, and a WebView per body is not an
   option: a feed can hold forty of them.

   So this is a real native renderer. It parses the backend's
   three BodyFormats into a block tree and paints that tree
   with RN primitives.

   WHAT IS PRESERVED, exactly:
     · the BodyFormat PLAIN | MARKDOWN | HTML contract
     · `detectFormat`, character for character — the server
       uses the same heuristic, and the two must agree or an
       omitted format renders differently on each client
     · the URL whitelist. The web build's protection was
       DOMPurify; here nothing is ever executed, so the risk is
       narrower — but a `javascript:` link must still not be
       tappable, so the same regexp gates every href
     · per-block direction resolution, which `applyAutoDir`
       did with dir="auto". Arabic and Kurdish blocks inside an
       English document have to resolve individually.

   WHAT IS DELIBERATELY NOT SUPPORTED: raw <script>/<style>/
   <iframe> (dropped, as the whitelist always did), and CSS.
   Class attributes are ignored rather than interpreted.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { RemoteImage } from '@/components/media/RemoteImage'
import { assetUrl } from '@/api'
import { useTheme, autoAlign } from '@/theme/ThemeProvider'
import { Text } from '@/ui/Text'

export type BodyFormat = 'PLAIN' | 'MARKDOWN' | 'HTML'

/* Only http(s), mailto and in-app paths are ever tappable — the same rule the
   web build enforced through DOMPurify's ALLOWED_URI_REGEXP. */
const SAFE_URI = /^(?:(?:https?|mailto):|\/|#|\?)/i

/** Server-side heuristic, mirrored exactly (RichTextService.detectFormat). */
export function detectFormat(src: string | null | undefined): BodyFormat {
  if (!src) return 'PLAIN'
  if (/<\w+(\s[^>]*)?>/.test(src)) return 'HTML'
  if (/(?:^|\n)#{1,6}\s|(?:^|\n)[-*+]\s|(?:^|\n)\d+\.\s|(?:^|\n)>\s|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|(?:^|\n)```/m.test(src)) return 'MARKDOWN'
  return 'PLAIN'
}

/* ---------------------------------------------------------
   The tree.
   --------------------------------------------------------- */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'u'; c: Inline[] }
  | { t: 's'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'mark'; c: Inline[] }
  | { t: 'sup'; c: Inline[] }
  | { t: 'sub'; c: Inline[] }
  | { t: 'a'; href: string; c: Inline[] }
  | { t: 'mention'; handle: string }
  | { t: 'tag'; tag: string }
  | { t: 'br' }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'pre'; v: string; lang?: string }
  | { t: 'ul'; items: Block[][] }
  | { t: 'ol'; items: Block[][]; start: number }
  | { t: 'hr' }
  | { t: 'img'; src: string; alt: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/* =========================================================
   Inline parsing — shared by the markdown and HTML paths.
   ========================================================= */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', middot: '·', times: '×', copy: '©', reg: '®', trade: '™',
}

export function decodeEntities(s: string): string {
  return String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase()
    if (ENTITIES[key]) return ENTITIES[key]
    if (key.startsWith('#x')) {
      const n = parseInt(key.slice(2), 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    if (key.startsWith('#')) {
      const n = parseInt(key.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    return whole
  })
}

/* ---- the mention grammar, in ONE place ---------------------------------
   mentions.md §5 is titled "one grammar everywhere", and §3 says the
   extraction rules "must match server behaviour exactly". They had drifted:
   four surfaces each carried their own regex, differing in the handle length
   cap (30 vs 50) and in whether anything guarded the character BEFORE the
   `@` — so `you@example.com` highlighted a mention of "example" in a post
   body but not in a search result, and a 40-character handle highlighted
   nowhere while pinging server-side.

   The server's rule is `(?<![\w@])@([a-zA-Z0-9_.]{2,50})` with
   UNICODE_CHARACTER_CLASS. This is written as a leading CAPTURE rather than a
   lookbehind deliberately — Hermes lookbehind support is not something to bet
   the feed on — which means the matched text includes one preceding
   character, and every consumer has to put it back. `start` below is already
   corrected for it.

   2 characters is the floor because a 1-character token never pings
   server-side, so highlighting one would promise a notification that never
   arrives. */
export const MENTION_RE = /(^|[^\p{L}\p{N}_@])@([a-zA-Z0-9_.]{2,50})/gu

export interface MentionSpan {
  handle: string
  /** Index of the `@`, i.e. already past the guard character. */
  start: number
  end: number
  /** `@followers` is a broadcast sentinel, not a person — never a link. */
  followersSentinel: boolean
}

/** Every mention in a string, server grammar, left to right. */
export function mentionSpans(text: string): MentionSpan[] {
  const out: MentionSpan[] = []
  if (!text) return out
  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(text))) {
    const start = m.index + m[1].length
    out.push({
      handle: m[2],
      start,
      end: start + m[2].length + 1,
      followersSentinel: m[2].toLowerCase() === 'followers',
    })
  }
  return out
}

/** Split plain text into text / @mention / #tag / bare-URL runs. Applied at
 *  the leaves of every format, because a mention in a markdown paragraph and
 *  a mention in a plain post must behave identically. */
function autoLink(text: string): Inline[] {
  const out: Inline[] = []
  /* The mention arm carries the same leading guard as MENTION_RE, so m[1] is
     that guard character and must be pushed back as text — consuming it
     silently would eat a space (or a whole letter) out of the body. */
  const re = /(^|[^\p{L}\p{N}_@])@([a-zA-Z0-9_.]{2,50})|(#[\p{L}\p{N}_]{1,60})|(https?:\/\/[^\s<>()]+)/gu
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) })
    if (m[2] !== undefined) {
      if (m[1]) out.push({ t: 'text', v: m[1] })
      out.push({ t: 'mention', handle: m[2] })
    } else if (m[3]) out.push({ t: 'tag', tag: m[3].slice(1) })
    else if (m[4]) out.push({ t: 'a', href: m[4], c: [{ t: 'text', v: m[4] }] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out.length ? out : [{ t: 'text', v: text }]
}

/** Markdown inline: `code`, **bold**, *italic*, ~~strike~~, [text](href), ![alt](src). */
function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  let buf = ''

  const flush = () => { if (buf) { out.push(...autoLink(buf)); buf = '' } }

  while (i < src.length) {
    const rest = src.slice(i)

    /* Inline code wins over everything — its contents are literal. */
    const code = /^`([^`]+)`/.exec(rest)
    if (code) { flush(); out.push({ t: 'code', v: code[1] }); i += code[0].length; continue }

    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (link) {
      flush()
      const href = link[2]
      if (SAFE_URI.test(href)) out.push({ t: 'a', href, c: parseInline(link[1]) })
      else out.push(...autoLink(link[1]))
      i += link[0].length
      continue
    }

    const bold = /^\*\*([\s\S]+?)\*\*/.exec(rest) || /^__([\s\S]+?)__/.exec(rest)
    if (bold) { flush(); out.push({ t: 'b', c: parseInline(bold[1]) }); i += bold[0].length; continue }

    const strike = /^~~([\s\S]+?)~~/.exec(rest)
    if (strike) { flush(); out.push({ t: 's', c: parseInline(strike[1]) }); i += strike[0].length; continue }

    const italic = /^\*([^*\n]+)\*/.exec(rest) || /^_([^_\n]+)_/.exec(rest)
    if (italic) { flush(); out.push({ t: 'i', c: parseInline(italic[1]) }); i += italic[0].length; continue }

    buf += src[i]
    i += 1
  }
  flush()
  return out
}

/* =========================================================
   Markdown → blocks. A small block-level parser: headings,
   fenced code, quotes, lists, rules, tables, paragraphs.
   ========================================================= */

export function parseMarkdown(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const paragraph: string[] = []
  const flushParagraph = () => {
    if (!paragraph.length) return
    const text = paragraph.join('\n').trim()
    paragraph.length = 0
    if (text) blocks.push({ t: 'p', c: parseInline(text) })
  }

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { flushParagraph(); i++; continue }

    /* Fenced code. */
    const fence = /^\s*```\s*(\S*)\s*$/.exec(line)
    if (fence) {
      flushParagraph()
      const lang = fence[1] || undefined
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      blocks.push({ t: 'pre', v: body.join('\n'), lang })
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ t: 'h', level: heading[1].length as 1, c: parseInline(heading[2].trim()) })
      i++
      continue
    }

    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) { flushParagraph(); blocks.push({ t: 'hr' }); i++; continue }

    /* Blockquote — collect the run, strip the markers, recurse. */
    if (/^\s{0,3}>\s?/.test(line)) {
      flushParagraph()
      const inner: string[] = []
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
        i++
      }
      blocks.push({ t: 'quote', c: parseMarkdown(inner.join('\n')) })
      continue
    }

    /* Tables — a header row, a separator, then body rows. */
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushParagraph()
      const cells = (row: string) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => parseInline(c.trim()))
      const head = cells(line)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++ }
      blocks.push({ t: 'table', head, rows })
      continue
    }

    /* Lists — one run of same-kind items; nesting collapses to one level,
       which is all the composer can produce. */
    const bullet = /^\s{0,3}([-*+])\s+(.*)$/.exec(line)
    const numbered = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      const start = numbered ? Math.max(1, parseInt(numbered[1], 10) || 1) : 1
      const items: Block[][] = []
      while (i < lines.length) {
        const b = /^\s{0,3}([-*+])\s+(.*)$/.exec(lines[i])
        const n = /^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(lines[i])
        if (ordered ? !n : !b) break
        const content = (ordered ? n![2] : b![2])
        /* Continuation lines: indented, non-blank, not a new item. */
        const parts = [content]
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s{0,3}([-*+]|\d+[.)])\s/.test(lines[i])) {
          parts.push(lines[i].trim())
          i++
        }
        items.push([{ t: 'p', c: parseInline(parts.join(' ')) }])
      }
      blocks.push(ordered ? { t: 'ol', items, start } : { t: 'ul', items })
      continue
    }

    /* A standalone image line becomes a real image block rather than an
       inline glyph — a research figure is not a word. */
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line)
    if (img && SAFE_URI.test(img[2])) {
      flushParagraph()
      blocks.push({ t: 'img', src: img[2], alt: img[1] })
      i++
      continue
    }

    paragraph.push(line)
    i++
  }
  flushParagraph()
  return blocks
}

/* =========================================================
   HTML → blocks.

   A tolerant tag scanner, not a spec parser: the input is the
   backend's own OWASP-whitelisted output or the composer's
   execCommand markup, both of which are shallow and
   well-formed. Unknown tags degrade to their text content,
   which is the correct failure for a renderer.
   ========================================================= */

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br'])
const DROP_TAGS = /<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1\s*>|<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi

interface Tag { name: string; attrs: Record<string, string>; close: boolean; self: boolean }

function parseTag(raw: string): Tag | null {
  const m = /^<\s*(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)>$/.exec(raw)
  if (!m) return null
  const attrs: Record<string, string> = {}
  const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let a: RegExpExecArray | null
  while ((a = attrRe.exec(m[3]))) attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '')
  return { name: m[2].toLowerCase(), attrs, close: m[1] === '/', self: m[4] === '/' }
}

export function parseHtml(src: string): Block[] {
  const clean = String(src ?? '').replace(DROP_TAGS, '')
  const tokens = clean.split(/(<[^>]+>)/).filter(t => t !== '')

  const blocks: Block[] = []
  /* Inline accumulation for the current block, and a stack of open inline
     wrappers so <strong><em>x</em></strong> nests correctly. */
  let inlineBuf: Inline[] = []
  const inlineStack: { tag: string; node: any }[] = []
  let listStack: { ordered: boolean; items: Block[][]; start: number }[] = []
  let currentItem: Inline[] | null = null
  let quoteDepth = 0
  let quoteBuf: Block[] = []
  let pending: { tag: string; level?: number } | null = null
  let preBuf: string | null = null
  let table: { head: Inline[][]; rows: Inline[][][]; row: Inline[][] | null; inHead: boolean } | null = null

  const push = (n: Inline) => {
    const top = inlineStack[inlineStack.length - 1]
    if (top) top.node.c.push(n)
    else if (currentItem) currentItem.push(n)
    else inlineBuf.push(n)
  }

  const takeInline = () => {
    const v = currentItem ?? inlineBuf
    if (currentItem) currentItem = []
    else inlineBuf = []
    return v
  }

  const emit = (b: Block) => {
    if (quoteDepth > 0) quoteBuf.push(b)
    else blocks.push(b)
  }

  const closeBlock = () => {
    const content = takeInline()
    const trimmed = trimInline(content)
    if (!trimmed.length) { pending = null; return }
    if (pending?.tag === 'h') emit({ t: 'h', level: (pending.level || 2) as 1, c: trimmed })
    else emit({ t: 'p', c: trimmed })
    pending = null
  }

  for (const tok of tokens) {
    if (preBuf !== null && !/^<\s*\/\s*pre\s*>/i.test(tok)) { preBuf += tok.startsWith('<') ? '' : decodeEntities(tok); continue }

    if (!tok.startsWith('<')) {
      const text = decodeEntities(tok)
      if (!text.trim() && !inlineBuf.length && !currentItem) continue
      if (table?.row) { table.row.push(autoLink(text)); continue }
      push({ t: 'text', v: text })
      continue
    }

    const tag = parseTag(tok)
    if (!tag) continue
    const { name, attrs, close } = tag

    /* --- inline wrappers --- */
    const INLINE_MAP: Record<string, Inline['t']> = {
      strong: 'b', b: 'b', em: 'i', i: 'i', u: 'u', s: 's', del: 's', strike: 's',
      mark: 'mark', sup: 'sup', sub: 'sub', code: 'code' as any, a: 'a', span: 'text' as any,
    }
    if (INLINE_MAP[name] !== undefined && name !== 'code') {
      if (close) {
        for (let k = inlineStack.length - 1; k >= 0; k--) {
          if (inlineStack[k].tag === name) { inlineStack.splice(k, 1); break }
        }
      } else if (name === 'span') {
        /* No styling model — a span is transparent. */
      } else if (name === 'a') {
        const href = attrs.href || ''
        const node: any = SAFE_URI.test(href) ? { t: 'a', href, c: [] } : { t: 'b', c: [] }
        push(node)
        inlineStack.push({ tag: name, node })
      } else {
        const node: any = { t: INLINE_MAP[name], c: [] }
        push(node)
        inlineStack.push({ tag: name, node })
      }
      continue
    }
    if (name === 'code' && !close) {
      /* <code> inside <pre> is handled by the pre branch; standalone is inline. */
      continue
    }
    if (name === 'br') { push({ t: 'br' }); continue }

    /* --- block tags --- */
    if (!BLOCK_TAGS.has(name)) continue

    if (name === 'pre') {
      if (close) { emit({ t: 'pre', v: (preBuf ?? '').replace(/^\n+|\n+$/g, '') }); preBuf = null }
      else { closeBlock(); preBuf = '' }
      continue
    }

    if (name === 'hr') { closeBlock(); emit({ t: 'hr' }); continue }

    if (name === 'img') {
      const src2 = attrs.src || ''
      if (SAFE_URI.test(src2)) { closeBlock(); emit({ t: 'img', src: src2, alt: attrs.alt || '' }) }
      continue
    }

    if (/^h[1-6]$/.test(name)) {
      if (close) closeBlock()
      else { closeBlock(); pending = { tag: 'h', level: Number(name[1]) } }
      continue
    }

    if (name === 'p' || name === 'div') { closeBlock(); continue }

    if (name === 'blockquote') {
      closeBlock()
      if (close) {
        quoteDepth = Math.max(0, quoteDepth - 1)
        if (quoteDepth === 0) { blocks.push({ t: 'quote', c: quoteBuf }); quoteBuf = [] }
      } else quoteDepth += 1
      continue
    }

    if (name === 'ul' || name === 'ol') {
      closeBlock()
      if (close) {
        const list = listStack.pop()
        if (list) emit(list.ordered ? { t: 'ol', items: list.items, start: list.start } : { t: 'ul', items: list.items })
      } else {
        listStack.push({ ordered: name === 'ol', items: [], start: Number(attrs.start) || 1 })
      }
      continue
    }

    if (name === 'li') {
      const list = listStack[listStack.length - 1]
      if (close) {
        if (list && currentItem) list.items.push([{ t: 'p', c: trimInline(currentItem) }])
        currentItem = null
      } else {
        if (list && currentItem) list.items.push([{ t: 'p', c: trimInline(currentItem) }])
        currentItem = []
      }
      continue
    }

    if (name === 'table') {
      closeBlock()
      if (close) {
        if (table) emit({ t: 'table', head: table.head, rows: table.rows })
        table = null
      } else table = { head: [], rows: [], row: null, inHead: false }
      continue
    }
    if (name === 'thead' && table) { table.inHead = !close; continue }
    if (name === 'tr' && table) {
      if (close) {
        if (table.row) { if (table.inHead && !table.head.length) table.head = table.row; else table.rows.push(table.row) }
        table.row = null
      } else table.row = []
      continue
    }
    if ((name === 'th' || name === 'td') && table) {
      if (!close && !table.row) table.row = []
      if (name === 'th' && !close) table.inHead = true
      continue
    }
  }

  /* Anything still open at EOF becomes its own block. */
  if (preBuf !== null) blocks.push({ t: 'pre', v: preBuf })
  closeBlock()
  while (listStack.length) {
    const list = listStack.pop()!
    blocks.push(list.ordered ? { t: 'ol', items: list.items, start: list.start } : { t: 'ul', items: list.items })
  }
  if (quoteBuf.length) blocks.push({ t: 'quote', c: quoteBuf })

  return blocks
}

function trimInline(list: Inline[]): Inline[] {
  const out = [...list]
  while (out.length && out[0].t === 'text' && !(out[0] as any).v.trim()) out.shift()
  while (out.length && out[out.length - 1].t === 'text' && !(out[out.length - 1] as any).v.trim()) out.pop()
  return out
}

/* =========================================================
   PLAIN → blocks. Blank lines split paragraphs; single
   newlines become breaks, exactly as `renderPlain` did.
   ========================================================= */

export function parsePlain(src: string): Block[] {
  return String(src ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const c: Inline[] = []
      p.split('\n').forEach((line, i) => {
        if (i) c.push({ t: 'br' })
        c.push(...autoLink(line))
      })
      return { t: 'p', c } as Block
    })
}

/** Dispatch by format. Anything unknown falls back to PLAIN. */
export function parseRich(src: string | null | undefined, format?: string | null): Block[] {
  if (!src) return []
  switch (String(format || detectFormat(src)).toUpperCase()) {
    case 'MARKDOWN': return parseMarkdown(src)
    case 'HTML': return parseHtml(src)
    default: return parsePlain(src)
  }
}

/** Plain-text projection — feed previews, notification bodies, search
 *  snippets. The web version used `textContent`; this walks the tree. */
export function toPlainText(src: string | null | undefined, format?: string | null): string {
  const blocks = parseRich(src, format)
  const out: string[] = []
  const walkInline = (list: Inline[]): string => list.map(n => {
    switch (n.t) {
      case 'text': return n.v
      case 'code': return n.v
      case 'br': return ' '
      case 'mention': return `@${n.handle}`
      case 'tag': return `#${n.tag}`
      case 'a': return walkInline(n.c)
      default: return walkInline((n as any).c || [])
    }
  }).join('')
  const walk = (list: Block[]) => {
    for (const b of list) {
      switch (b.t) {
        case 'p': case 'h': out.push(walkInline(b.c)); break
        case 'pre': out.push(b.v); break
        case 'quote': walk(b.c); break
        case 'ul': case 'ol': b.items.forEach(walk); break
        case 'table':
          out.push(b.head.map(walkInline).join(' '))
          b.rows.forEach(r => out.push(r.map(walkInline).join(' ')))
          break
        default: break
      }
    }
  }
  walk(blocks)
  return out.join('\n').replace(/[ \t]+/g, ' ').trim()
}

/* =========================================================
   The renderer.
   ========================================================= */

export interface RichTextProps {
  body?: string | null
  format?: string | null
  /** Pre-parsed tree — the composer's live preview passes this. */
  blocks?: Block[]
  /** Long-form sizing (research reader). Off for feed bodies. */
  reading?: boolean
  /** Serif paragraphs — the editorial voice post bodies use. Headings and
   *  code stay sans/mono. */
  serif?: boolean
  onPressMention?: (handle: string) => void
  onPressTag?: (tag: string) => void
  onPressLink?: (href: string) => void
  /** Cap the rendered blocks — feed previews. */
  maxBlocks?: number
  style?: StyleProp<ViewStyle>
  /** Selectable text for the reader; off in lists (it eats the row's press). */
  selectable?: boolean
}

export function RichText({
  body, format, blocks, reading = false, serif = false,
  onPressMention, onPressTag, onPressLink, maxBlocks, style, selectable,
}: RichTextProps) {
  const tree = React.useMemo(() => blocks ?? parseRich(body, format), [blocks, body, format])
  const shown = maxBlocks ? tree.slice(0, maxBlocks) : tree
  const handlers = { onPressMention, onPressTag, onPressLink, selectable, serif }
  return (
    <View style={style}>
      {shown.map((b, i) => (
        <BlockView key={i} block={b} reading={reading} first={i === 0} handlers={handlers} />
      ))}
    </View>
  )
}

interface Handlers {
  onPressMention?: (h: string) => void
  onPressTag?: (t: string) => void
  onPressLink?: (href: string) => void
  selectable?: boolean
  serif?: boolean
}

/* An inline figure in a body has no wire ratio to work from, so 16/10 is a
   placeholder that holds the scroll position until the decoder answers. The
   clamp is what stops a 9:21 screenshot from pushing the rest of the abstract
   off the screen; the floor stops a wide banner collapsing to a hairline.
   Same onLoad idiom as PostMedia.ImageMedia — url-keyed, because a body can
   re-render with a different figure in the same slot. */
const FIGURE_MIN_RATIO = 1 / 2
const FIGURE_MAX_RATIO = 16 / 9

function InlineFigure({ uri, alt, marginTop }: { uri: string; alt: string; marginTop: number }) {
  const t = useTheme()
  const c = t.colors
  const [decoded, setDecoded] = React.useState<{ uri: string; natural: number | null }>({ uri, natural: null })
  /* Render-phase reset on source change — React's derived-state idiom. */
  if (decoded.uri !== uri) setDecoded({ uri, natural: null })
  const natural = decoded.uri === uri ? decoded.natural : null
  const ratio = natural && Number.isFinite(natural) && natural > 0
    ? Math.min(FIGURE_MAX_RATIO, Math.max(FIGURE_MIN_RATIO, natural))
    : 16 / 10

  return (
    <View style={{ marginTop }}>
      <RemoteImage
        source={uri}
        /* A dead figure (moderation deleted the asset) keeps its plate and
           caption; the glyph says why the picture is missing. */
        fallbackIcon="image"
        style={{ width: '100%', aspectRatio: ratio, borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }}
        contentFit="contain"
        transition={t.ms(160)}
        cachePolicy="memory-disk"
        recyclingKey={uri}
        onLoad={e => {
          const { width, height } = e.source ?? {}
          /* Guarded by uri: a late onLoad from a source that has already been
             swapped out must not stamp its ratio onto the new figure. */
          if (width && height) setDecoded(prev => (prev.uri === uri ? { uri, natural: width / height } : prev))
        }}
      />
      {alt ? (
        <Text variant="caption" tone="muted" align="center" style={{ marginTop: 6 }}>{alt}</Text>
      ) : null}
    </View>
  )
}

function BlockView({
  block, reading, first, handlers, depth = 0,
}: { block: Block; reading: boolean; first: boolean; handlers: Handlers; depth?: number }) {
  const t = useTheme()
  const c = t.colors
  const gap = first ? 0 : reading ? 14 : 9

  switch (block.t) {
    case 'p':
      return (
        <Text reading={reading} serif={handlers.serif} variant="body" selectable={handlers.selectable} style={{ marginTop: gap }}>
          <InlineRun nodes={block.c} handlers={handlers} />
        </Text>
      )

    case 'h': {
      const variant = block.level <= 1 ? 'title1' : block.level === 2 ? 'title2' : block.level === 3 ? 'title3' : 'headline'
      return (
        <Text variant={variant as any} selectable={handlers.selectable} style={{ marginTop: first ? 0 : reading ? 22 : 14, marginBottom: 2 }}>
          <InlineRun nodes={block.c} handlers={handlers} />
        </Text>
      )
    }

    case 'hr':
      return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 18 }} />

    case 'pre':
      return (
        <View
          style={{
            marginTop: gap,
            backgroundColor: c.surfaceSunken,
            borderRadius: t.radius.sm,
            padding: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.borderFaint,
          }}
        >
          <Text
            variant="footnote"
            align="left"
            selectable
            mono
            style={{ lineHeight: 19 }}
          >
            {block.v}
          </Text>
        </View>
      )

    case 'quote':
      return (
        <View
          style={{
            marginTop: gap,
            borderStartWidth: 3,
            borderStartColor: c.accent,
            paddingStart: 12,
            paddingVertical: 2,
          }}
        >
          {block.c.map((b, i) => (
            <BlockView key={i} block={b} reading={reading} first={i === 0} handlers={handlers} depth={depth + 1} />
          ))}
        </View>
      )

    case 'ul':
    case 'ol':
      return (
        <View style={{ marginTop: gap, gap: 5 }}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <View style={{ width: 24, alignItems: block.t === 'ol' ? 'flex-end' : 'center', paddingTop: reading ? 5 : 3 }}>
                {block.t === 'ol' ? (
                  <Text variant="footnote" tone="muted">{block.start + i}.</Text>
                ) : (
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.textMuted }} />
                )}
              </View>
              <View style={styles.flex}>
                {item.map((b, j) => (
                  <BlockView key={j} block={b} reading={reading} first handlers={handlers} depth={depth + 1} />
                ))}
              </View>
            </View>
          ))}
        </View>
      )

    case 'img':
      return <InlineFigure uri={assetUrl(block.src)} alt={block.alt} marginTop={gap + 4} />

    case 'table':
      return (
        <View
          style={{
            marginTop: gap + 4,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            borderRadius: t.radius.sm,
            overflow: 'hidden',
          }}
        >
          {block.head.length ? (
            <View style={[styles.tr, { backgroundColor: c.surfaceSunken }]}>
              {block.head.map((cell, i) => (
                <View key={i} style={styles.td}>
                  <Text variant="footnote" weight="700"><InlineRun nodes={cell} handlers={handlers} /></Text>
                </View>
              ))}
            </View>
          ) : null}
          {block.rows.map((row, i) => (
            <View key={i} style={[styles.tr, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator }]}>
              {row.map((cell, j) => (
                <View key={j} style={styles.td}>
                  <Text variant="footnote"><InlineRun nodes={cell} handlers={handlers} /></Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )

    default:
      return null
  }
}

function InlineRun({ nodes, handlers }: { nodes: Inline[]; handlers: Handlers }) {
  const t = useTheme()
  const c = t.colors

  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Text key={i} variant="body" style={styles.inherit}>{n.v}</Text>
          case 'br':
            return <Text key={i}>{'\n'}</Text>
          case 'b':
            return <Text key={i} weight="700" style={styles.inherit}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 'i':
            return <Text key={i} italic style={styles.inherit}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 'u':
            return <Text key={i} underline style={styles.inherit}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 's':
            return <Text key={i} strike tone="muted" style={styles.inherit}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 'sup':
            return <Text key={i} variant="caption" style={styles.sup}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 'sub':
            return <Text key={i} variant="caption" style={styles.sub}><InlineRun nodes={n.c} handlers={handlers} /></Text>
          case 'mark':
            return (
              <Text key={i} style={[styles.inherit, { backgroundColor: c.warningSoft }]}>
                <InlineRun nodes={n.c} handlers={handlers} />
              </Text>
            )
          case 'code':
            return (
              <Text key={i} mono style={[styles.inherit, { backgroundColor: c.surfaceSunken, color: c.scholarText }]}>
                {` ${n.v} `}
              </Text>
            )
          case 'mention':
            return (
              <Text
                key={i}
                color={c.accentText}
                weight="600"
                style={styles.inherit}
                onPress={handlers.onPressMention ? () => handlers.onPressMention!(n.handle) : undefined}
              >
                @{n.handle}
              </Text>
            )
          case 'tag':
            return (
              <Text
                key={i}
                color={c.accentText}
                weight="600"
                style={styles.inherit}
                onPress={handlers.onPressTag ? () => handlers.onPressTag!(n.tag) : undefined}
              >
                #{n.tag}
              </Text>
            )
          case 'a':
            return (
              <Text
                key={i}
                color={c.accentText}
                style={styles.inherit}
                onPress={() => {
                  if (handlers.onPressLink) handlers.onPressLink(n.href)
                  else if (/^https?:|^mailto:/i.test(n.href)) void Linking.openURL(n.href).catch(() => {})
                }}
              >
                <InlineRun nodes={n.c} handlers={handlers} />
              </Text>
            )
          default:
            return null
        }
      })}
    </>
  )
}

const styles = StyleSheet.create({
  /* Nested <Text> inherits size/colour from its parent unless overridden;
     these keep the child from re-declaring the parent's metrics. */
  inherit: { fontSize: undefined as any, lineHeight: undefined as any },
  sup: { lineHeight: undefined as any, textAlignVertical: 'top' },
  sub: { lineHeight: undefined as any, textAlignVertical: 'bottom' },
  listItem: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  tr: { flexDirection: 'row' },
  td: { flex: 1, padding: 8 },
})

/* Re-exported for parity with the web module's surface, so a caller that
   imported `escapeHtml` still compiles. Escaping is meaningless in a tree
   renderer — nothing is ever interpolated into markup — but the contract
   stays honest rather than silently disappearing. */
export function escapeHtml(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export { autoAlign }
