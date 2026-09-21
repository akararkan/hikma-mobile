/* =========================================================
   A search result row, with the matched terms weighted.

   The highlighting is a case-insensitive token match on the
   body, done client-side: the search endpoints return the
   message, not offsets, and re-querying for offsets would
   double every search. Tokens are escaped before they reach a
   RegExp — a query containing `(` is a normal query, not a
   crash.

   Memoized, and the thumbnail carries a recyclingKey: these are
   FlashList rows, and without one expo-image keeps painting the
   PREVIOUS hit's decoded bitmap until the new source resolves,
   so a fast flick through results shows the wrong pictures.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, TouchableRow } from '@/ui'
import { clockTime, snippetOf } from './format'
import type { UserCard } from './userDirectory'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Highlighted({ text, query, accent }: { text: string; query: string; accent: string }) {
  const parts = React.useMemo(() => {
    const tokens = query.trim().split(/\s+/).filter(w => w.length > 1).map(escape)
    if (!tokens.length) return [{ text, hit: false }]
    const re = new RegExp(`(${tokens.join('|')})`, 'ig')
    return text.split(re).filter(Boolean).map(chunk => ({
      text: chunk,
      hit: tokens.some(tok => new RegExp(`^${tok}$`, 'i').test(chunk)),
    }))
  }, [text, query])

  return (
    <Text variant="footnote" tone="secondary" align="auto" numberOfLines={2}>
      {parts.map((p, i) => (
        p.hit ? <Text key={i} variant="footnote" weight="700" color={accent}>{p.text}</Text> : p.text
      ))}
    </Text>
  )
}

export const SearchHitRow = React.memo(function SearchHitRow({
  message, query, card, subtitle, onPress, onLongPress,
}: {
  message: any
  query: string
  card?: UserCard | null
  subtitle?: string
  onPress: () => void
  onLongPress?: () => void
}) {
  const t = useTheme()
  const thumb = message.media?.find((m: any) => m.thumbnailUrl || m.url)
  const body = message.body || snippetOf(message)

  return (
    <TouchableRow onPress={onPress} onLongPress={onLongPress} style={styles.row}>
      <Avatar
        uri={card?.profileImage ?? message.sender?.profileImage ?? null}
        name={message.sender?.full}
        seed={message.senderId}
        size={32}
      />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text variant="footnote" weight="600" numberOfLines={1} style={styles.shrink}>
            {message.sender?.full || 'Member'}
          </Text>
          <Text variant="caption" tone="faint" align="ui">
            {subtitle || `${clockTime(message.createdAt)} · ${message.time}`}
          </Text>
        </View>
        <Highlighted text={body} query={query} accent={t.colors.accentText} />
      </View>
      {thumb && !message.body ? (
        <View style={[styles.thumb, { backgroundColor: t.colors.surfaceSunken }]}>
          {thumb.thumbnailUrl || thumb.url ? (
            <Image
              source={{ uri: thumb.thumbnailUrl || thumb.url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={String(message.id)}
            />
          ) : (
            <Icon name="image" size={16} color={t.colors.textFaint} />
          )}
        </View>
      ) : null}
    </TouchableRow>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.md },
  body: { flex: 1, gap: space.xxs },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1, flex: 1 },
  thumb: { width: 40, height: 40, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
