/* =========================================================
   MentionHighlightedText — body text with pressable @handles.

   Two modes, and the difference is exactness:

     local     a regex that mirrors the server's grammar. Good
               enough for a feed row, and free.
     parsed    `api.mentions.parse(text)` offsets, for the places
               where parity with the pipeline is visible — a
               publish preview, an edit diff. Offsets are `start`
               inclusive at the `@`, `end` exclusive.

   `followersSentinel` tokens are an announcement, not a person:
   they render in the warning tint and are not pressable.
   ========================================================= */
import React from 'react'
import { mentionSpans } from '@/lib/richtext'
import { useTheme } from '@/theme/ThemeProvider'
import { Text, type TextProps } from '@/ui'

export interface ParsedToken { handle: string; start: number; end: number; followersSentinel?: boolean }
export interface ParsedTokens { usernames?: string[]; followers?: boolean; tokens?: ParsedToken[] }

export interface MentionHighlightedTextProps extends Omit<TextProps, 'children'> {
  text: string
  /** The `api.mentions.parse` result, when exact parity matters. */
  tokens?: ParsedTokens | null
  onPressHandle?: (handle: string) => void
}

/* The grammar itself lives in @/lib/richtext — one copy for the whole app, so
   a body, a chat bubble and a search result can never disagree about what is
   a mention. */

export function MentionHighlightedText({
  text, tokens, onPressHandle, ...rest
}: MentionHighlightedTextProps) {
  const t = useTheme()
  const body = text || ''

  const spans = React.useMemo<ParsedToken[]>(() => {
    const given = tokens?.tokens
    if (given?.length) return [...given].sort((a, b) => a.start - b.start)
    return mentionSpans(body)
  }, [body, tokens])

  /* Built once per (body, spans, ink, variant), not per render: this renders
     inside feed and comment rows, and the slicing plus one <Text> per handle
     is real work to repeat when nothing about the string moved. */
  const variant = rest.variant
  const parts = React.useMemo<React.ReactNode[] | null>(() => {
    if (!spans.length) return null
    const out: React.ReactNode[] = []
    let cursor = 0
    spans.forEach((tok, i) => {
      if (tok.start > cursor) out.push(body.slice(cursor, tok.start))
      const label = body.slice(tok.start, tok.end) || `@${tok.handle}`
      out.push(
        <Text
          key={`m${i}`}
          variant={variant}
          color={tok.followersSentinel ? t.colors.warningText : t.colors.accentText}
          weight="600"
          onPress={tok.followersSentinel || !onPressHandle ? undefined : () => onPressHandle(tok.handle)}
          suppressHighlighting
        >
          {label}
        </Text>,
      )
      cursor = tok.end
    })
    if (cursor < body.length) out.push(body.slice(cursor))
    return out
  }, [spans, body, variant, onPressHandle, t.colors.warningText, t.colors.accentText])

  if (!parts) return <Text {...rest}>{body}</Text>
  return <Text {...rest}>{parts}</Text>
}
