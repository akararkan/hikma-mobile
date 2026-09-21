/* =========================================================
   MentionAutocomplete — the composer @-typeahead.

   Every composer in the app imports this (post, comment, reply,
   question, answer, research, research comment, chat message,
   channel post), so the surface is deliberately three props:
   `value`, `onChange`, `onPick`. Everything else has a default.

   THE DETECTION MIRRORS THE SERVER'S GRAMMAR, not a convenient
   approximation of it. Scan back from the caret for an `@`
   preceded by start-of-string or a non-word, non-`@` character;
   handle characters are `[a-zA-Z0-9_.]`; whitespace ends the
   token. That is what keeps `foo@bar.com` and `@@bob` from
   opening a popover the server would never have parsed.

   `api.mentions.suggest` takes NO AbortSignal, so stale replies
   are dropped by a monotonic sequence number instead. The
   server caches ~30s per (q, limit, viewerId), which is why a
   200ms debounce is cheap even for a fast typer — and why the
   client must NOT add caching on top: a brand-new account would
   then stay invisible for far longer than the server intends.

   Errors close the popover silently. A composer never toasts.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, space } from '@/theme/tokens'
import { Avatar, Chip, Icon, Text, Touchable } from '@/ui'

export interface MentionUser {
  id: string
  full: string
  handle: string
  initials: string
  avc: string
  profileImage: string | null
  verified: boolean
  role: string
}

/** The `@followers` row is never fetched and has no account behind it. Pickers
 *  that care can branch on this id; everyone else just splices the handle. */
export const FOLLOWERS_SENTINEL_ID = '__followers__'

export interface Selection { start: number; end: number }

export interface MentionAutocompleteProps {
  value: string
  /** Called with the whole spliced text when a row is picked. */
  onChange: (text: string) => void
  /** The picked account, after `onChange`. Optional — most composers only
   *  need the text back. */
  onPick?: (user: MentionUser, selection: Selection) => void
  /** The live caret. Defaults to the end of `value`, which is where a
   *  composer's caret is unless the user moved it. */
  selection?: Selection
  limit?: number
  /** Only legal on top-level post / research / question creates. */
  allowFollowers?: boolean
  anchor?: 'above' | 'below'
  disabled?: boolean
}

export function MentionAutocomplete({
  value, onChange, onPick, selection, limit = 6, allowFollowers = false,
  anchor = 'above', disabled = false,
}: MentionAutocompleteProps) {
  const t = useTheme()
  const c = t.colors
  const { active, rows, loading, insert } = useMentionSuggest(value, selection, {
    limit, enabled: !disabled, allowFollowers,
  })

  if (!active || (!rows.length && !loading)) return null

  return (
    /* A popover, so it wears the popover setback (12/4) and a 1px
       borderStrong rule. Depth is the border weight, never a shadow
       (DESIGN.md §6 "Surface raised"). */
    <View
      style={[
        styles.card,
        anchor === 'above' ? styles.above : styles.below,
        {
          backgroundColor: c.surfaceRaised,
          ...setback(t.shape.popover),
          borderWidth: rule.course,
          borderColor: c.borderStrong,
          zIndex: t.zIndex.sticky,
        },
      ]}
      pointerEvents="box-none"
    >
      <ScrollView
        bounces={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {rows.map(user => (
          <Touchable
            key={user.id}
            onPress={() => {
              const next = insert(user)
              onChange(next.text)
              onPick?.(user, next.selection)
            }}
            feedback="tint"
            noAutoHitSlop
            style={styles.row}
          >
            {user.id === FOLLOWERS_SENTINEL_ID ? (
              <View style={[styles.sentinel, { backgroundColor: c.warningSoft }]}>
                <Icon name="people" size={17} color={c.warningText} />
              </View>
            ) : (
              <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={32} />
            )}

            <View style={styles.flex}>
              <Text variant="subhead" weight="600" numberOfLines={1}>{user.full}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>@{user.handle}</Text>
            </View>

            <RoleTag role={user.role} />
          </Touchable>
        ))}
      </ScrollView>
    </View>
  )
}

/* The toUpperCase normalizes the wire value for COMPARISON — the three labels
   below are written out, so nothing here transforms displayed text. */
function RoleTag({ role }: { role: string }) {
  const r = String(role || '').toUpperCase()
  if (r !== 'SCHOLAR' && r !== 'RESEARCHER' && r !== 'ADMIN') return null
  return (
    <Chip
      label={r === 'SCHOLAR' ? 'Scholar' : r === 'RESEARCHER' ? 'Researcher' : 'Admin'}
      tone={r === 'SCHOLAR' ? 'scholar' : r === 'RESEARCHER' ? 'accent' : 'neutral'}
      size="sm"
    />
  )
}

/* ---------------------------------------------------------
   useMentionSuggest — the headless half.

   A chat composer with a different visual shell reuses this so
   the grammar, the debounce, the sequence guard and the splice
   maths exist exactly once.
   --------------------------------------------------------- */

const HANDLE_CHAR = /[a-zA-Z0-9_.]/
/* The server's look-behind is Unicode `\w` (UNICODE_CHARACTER_CLASS): an
   Arabic letter before the `@` blocks the mention just like an ASCII one. */
const WORD_CHAR = /[\p{L}\p{N}_]/u
/** Usernames are short; a runaway backscan over a long body is wasted work. */
const MAX_PARTIAL = 40

export interface MentionToken { active: boolean; query: string; start: number; end: number }

export function detectMention(text: string, caret: number): MentionToken {
  const idle: MentionToken = { active: false, query: '', start: -1, end: -1 }
  const at = Math.max(0, Math.min(caret, text.length))
  let i = at - 1
  let seen = 0
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      const prev = i > 0 ? text[i - 1] : ''
      /* start-of-string, or a non-word non-@ character. This single check is
         what excludes emails and doubled sigils. */
      if (i === 0 || (!WORD_CHAR.test(prev) && prev !== '@')) {
        return { active: true, query: text.slice(i + 1, at), start: i, end: at }
      }
      return idle
    }
    if (!HANDLE_CHAR.test(ch)) return idle
    if (++seen > MAX_PARTIAL) return idle
    i--
  }
  return idle
}

export interface UseMentionSuggestOptions {
  limit?: number
  enabled?: boolean
  allowFollowers?: boolean
}

export function useMentionSuggest(
  text: string,
  selection?: Selection,
  { limit = 6, enabled = true, allowFollowers = false }: UseMentionSuggestOptions = {},
) {
  const caret = selection?.start ?? text.length
  const token = React.useMemo(() => (enabled ? detectMention(text, caret) : { active: false, query: '', start: -1, end: -1 }), [text, caret, enabled])

  const [rows, setRows] = React.useState<MentionUser[]>([])
  const [loading, setLoading] = React.useState(false)
  const seq = React.useRef(0)
  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])

  React.useEffect(() => {
    if (!token.active) { seq.current++; setRows([]); setLoading(false); return }

    const q = token.query
    setLoading(true)
    const id = setTimeout(async () => {
      const mine = ++seq.current
      try {
        const res = await api.mentions.suggest(q, limit) as MentionUser[]
        if (!alive.current || mine !== seq.current) return
        setRows(res || [])
      } catch {
        /* Silence is the contract: a failed lookup closes the card, it never
           interrupts someone mid-sentence with a toast. */
        if (alive.current && mine === seq.current) setRows([])
      } finally {
        if (alive.current && mine === seq.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(id)
  }, [token.active, token.query, limit])

  const withSentinel = React.useMemo(() => {
    if (!allowFollowers || !token.active) return rows
    const q = token.query.toLowerCase()
    if (!'followers'.startsWith(q)) return rows
    const sentinel: MentionUser = {
      id: FOLLOWERS_SENTINEL_ID,
      full: 'All your followers',
      handle: 'followers',
      initials: '@',
      avc: '',
      profileImage: null,
      verified: false,
      role: '',
    }
    return [sentinel, ...rows]
  }, [rows, allowFollowers, token.active, token.query])

  /** Replace `@partial` with `@username ` and put the caret after the space. */
  const insert = React.useCallback((user: MentionUser) => {
    if (!token.active) return { text, selection: { start: caret, end: caret } }
    const replacement = `@${user.handle} `
    const next = text.slice(0, token.start) + replacement + text.slice(token.end)
    const pos = token.start + replacement.length
    /* Records the pick as a MENTION_LOOKUP activity row. It does NOT notify —
       notifications fire server-side when the composed text is saved. */
    if (user.id && user.id !== FOLLOWERS_SENTINEL_ID) {
      void api.mentions.click(token.query, user.id).catch(() => {})
    }
    return { text: next, selection: { start: pos, end: pos } }
  }, [text, caret, token])

  return { active: token.active, query: token.query, rows: withSentinel, loading, insert }
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 0, right: 0, maxHeight: 220, overflow: 'hidden', borderCurve: 'continuous' },
  above: { bottom: '100%', marginBottom: space.sm },
  below: { top: '100%', marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, height: 44, paddingHorizontal: space.md },
  flex: { flex: 1 },
  sentinel: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
})
