/* =========================================================
   @mention autocomplete.

   `api.mentions.suggest` and nothing else: it is block-aware in
   both directions, excludes you, and drops deleted and locked
   accounts. A generic user search filters none of that, so a
   composer built on it offers handles the save will refuse.

   `mentions.click` is fire-and-forget — a lock-in signal for
   ranking. Notifications fire server-side when the TEXT is
   saved, never from here, so a picked-then-deleted mention
   notifies nobody.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { mentionsApi } from './api'
import { useDebounced } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Text, Touchable, VerifiedMark } from '@/ui'
import type { QnaAuthor } from './types'

/** The open '@token' at the caret, or null. Only a token at the very end of
 *  the typed text counts — mid-string editing would otherwise re-open the
 *  list every time the user moved the caret past an old mention. */
export function activeMentionQuery(text: string, selectionEnd?: number): string | null {
  const upto = selectionEnd == null ? text : text.slice(0, selectionEnd)
  const m = /(?:^|[\s(])@([A-Za-z0-9_.]{0,30})$/.exec(upto)
  return m ? m[1] : null
}

/** Replace the open token with the picked handle. */
export function applyMention(text: string, handle: string, selectionEnd?: number): string {
  const end = selectionEnd == null ? text.length : selectionEnd
  const head = text.slice(0, end)
  const tail = text.slice(end)
  const replaced = head.replace(/@([A-Za-z0-9_.]{0,30})$/, `@${handle} `)
  return replaced + tail
}

export function MentionAutocomplete({
  query, maxRows = 6, onPick,
}: { query: string | null; maxRows?: number; onPick: (author: QnaAuthor) => void }) {
  const t = useTheme()
  const debounced = useDebounced(query ?? '', 200)
  const [rows, setRows] = React.useState<QnaAuthor[]>([])
  const seq = React.useRef(0)

  React.useEffect(() => {
    if (query == null) { setRows([]); return }
    const mine = ++seq.current
    let alive = true
    mentionsApi.suggest(debounced, maxRows)
      .then((res: QnaAuthor[]) => { if (alive && mine === seq.current) setRows(res || []) })
      .catch(() => { if (alive && mine === seq.current) setRows([]) })
    return () => { alive = false }
  }, [debounced, maxRows, query])

  if (query == null || !rows.length) return null

  return (
    <View style={[styles.dock, { backgroundColor: t.colors.bgElevated, borderTopColor: t.colors.separator }]}>
      {rows.slice(0, maxRows).map(a => (
        <Touchable
          key={a.id}
          onPress={() => {
            /* Fire-and-forget: a failed signal must never block the pick. */
            void mentionsApi.click(debounced, a.id).catch(() => {})
            onPick(a)
          }}
          feedback="tint"
          noAutoHitSlop
          style={styles.row}
        >
          <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={28} />
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <Text variant="subhead" weight="600" numberOfLines={1} align="ui">{a.full}</Text>
              {a.verified ? <VerifiedMark size={12} /> : null}
            </View>
            <Text variant="footnote" tone="muted" numberOfLines={1} align="ui">@{a.handle}</Text>
          </View>
        </Touchable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, height: 44 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
})
