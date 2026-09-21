/* =========================================================
   RichBody — the single body renderer for abstracts, paper
   bodies and previews.

   The rule the backend documents: `descriptionHtml` and
   `abstractHtml` are already OWASP-sanitised server-side, so
   when one is present it is what we render. `description` and
   `abstractText` are the AUTHOR'S source in whatever
   BodyFormat they chose and must never be treated as HTML.

   `@/lib/richtext` owns the actual parse and paint (and never
   uses a WebView), so this file is only the choice between the
   two inputs — but that choice is the whole safety contract,
   which is why it lives in one place.
   ========================================================= */
import React from 'react'
import { useRouter } from 'expo-router'
import type { StyleProp, ViewStyle } from 'react-native'
import { RichText, toPlainText } from '@/lib/richtext'
import { isRedactedText } from '@/api'
import { Callout, Text } from '@/ui'
import type { BodyFormat } from './types'
import { to } from './nav'

export interface RichBodyProps {
  html?: string | null
  plain?: string | null
  bodyFormat?: BodyFormat | string | null
  reading?: boolean
  selectable?: boolean
  /** Feed previews cap the paint; the reader never does. */
  maxBlocks?: number
  style?: StyleProp<ViewStyle>
}

export function RichBody({ html, plain, bodyFormat, reading = false, selectable, maxBlocks, style }: RichBodyProps) {
  const router = useRouter()
  const source = html && html.trim() ? html : (plain || '')
  const format = html && html.trim() ? 'HTML' : (bodyFormat || 'PLAIN')

  if (!source.trim()) return null

  /* A held or redacted body comes back as a sentinel string, not as an error —
     render the explanation in place rather than an empty screen. */
  if (isRedactedText(source)) {
    return (
      <Callout tone="warning" icon="shield" style={style}>
        This text is not available while it is being reviewed.
      </Callout>
    )
  }

  return (
    <RichText
      body={source}
      format={format}
      reading={reading}
      selectable={selectable}
      maxBlocks={maxBlocks}
      style={style}
      onPressMention={h => router.push(to(`/u/${h}`))}
      onPressTag={tag => router.push(to(`/research/tag/${encodeURIComponent(tag)}`))}
    />
  )
}

/** A clamped plain-text preview of a rich body — card abstracts, list rows. */
export function BodyPreview({
  html, plain, bodyFormat, lines = 2, style,
}: RichBodyProps & { lines?: number }) {
  const text = React.useMemo(
    () => toPlainText(html && html.trim() ? html : plain, html && html.trim() ? 'HTML' : bodyFormat),
    [html, plain, bodyFormat],
  )
  if (!text) return null
  return (
    <Text variant="footnote" tone="muted" align="auto" numberOfLines={lines} style={style as any}>
      {text}
    </Text>
  )
}
