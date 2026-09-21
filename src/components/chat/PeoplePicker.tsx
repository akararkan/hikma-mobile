/* =========================================================
   The people-search primitives shared by New chat, New group,
   Add members and Forward.

   The abort rule is the reason this is a hook rather than four
   copies: `users.search` is fired per keystroke, and without
   aborting the previous request a slow answer for "ah" lands
   after the fast answer for "ahmad" and silently replaces the
   right results with the wrong ones. Every one of those four
   screens would have had to remember that.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Chip, Icon, Spinner, Text, TouchableRow, VerifiedMark } from '@/ui'

const DEBOUNCE_MS = 250

export interface PeopleSearchState {
  query: string
  setQuery: (q: string) => void
  results: any[]
  suggestions: any[]
  searching: boolean
  error: any
  /** True once a query has been typed — swaps `Suggested` for `Results`. */
  active: boolean
}

export function usePeopleSearch(
  { excludeIds, withSuggestions = true }: { excludeIds?: Set<string>; withSuggestions?: boolean } = {},
): PeopleSearchState {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<any[]>([])
  const [suggestions, setSuggestions] = React.useState<any[]>([])
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const ctl = React.useRef<AbortController | null>(null)
  const alive = React.useRef(true)

  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; ctl.current?.abort() }
  }, [])

  React.useEffect(() => {
    if (!withSuggestions) return
    api.users.suggestions({ limit: 20 })
      .then((rows: any) => { if (alive.current) setSuggestions(rows || []) })
      /* Suggestions are a nicety — a failure just omits the section. */
      .catch(() => {})
  }, [withSuggestions])

  React.useEffect(() => {
    const q = query.trim()
    if (!q) { ctl.current?.abort(); setResults([]); setSearching(false); setError(null); return }

    const id = setTimeout(() => {
      ctl.current?.abort()
      const next = new AbortController()
      ctl.current = next
      setSearching(true)
      setError(null)
      api.users.search(q, { page: 0, size: 20, signal: next.signal } as any)
        .then((res: any) => { if (alive.current && !next.signal.aborted) setResults(res.items || []) })
        .catch(e => {
          /* An abort is the caller's own doing, never a failure to render. */
          if (e?.name !== 'AbortError' && alive.current) setError(e)
        })
        .finally(() => { if (alive.current && !next.signal.aborted) setSearching(false) })
    }, DEBOUNCE_MS)

    return () => clearTimeout(id)
  }, [query])

  const filter = React.useCallback(
    (rows: any[]) => (excludeIds ? rows.filter(u => !excludeIds.has(String(u.id))) : rows),
    [excludeIds],
  )

  return {
    query,
    setQuery,
    results: filter(results),
    suggestions: filter(suggestions),
    searching,
    error,
    active: query.trim().length > 0,
  }
}

/* ---------------------------------------------------------
   Rows.
   --------------------------------------------------------- */

export function PersonRow({
  user, selected, disabled, disabledNote, checkbox, busy, presence, onPress, onLongPress,
}: {
  user: any
  selected?: boolean
  disabled?: boolean
  disabledNote?: string
  checkbox?: boolean
  busy?: boolean
  presence?: { status: string } | null
  onPress: () => void
  onLongPress?: () => void
}) {
  const t = useTheme()
  const c = t.colors

  return (
    <TouchableRow onPress={onPress} onLongPress={onLongPress} disabled={disabled} style={styles.person}>
      <Avatar
        uri={user.profileImage ?? user.profileImage ?? null}
        name={user.full || user.displayName}
        seed={user.id}
        size={44}
        presence={presence ? (presence.status === 'online' ? 'online' : 'offline') : undefined}
      />
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text variant="subhead" weight="600" numberOfLines={1} style={styles.shrink}>
            {user.full || user.displayName || user.handle}
          </Text>
          {user.verified ? <VerifiedMark size={12} /> : null}
        </View>
        {user.handle ? <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>@{user.handle}</Text> : null}
        {disabledNote ? <Text variant="caption" tone="faint" align="ui">{disabledNote}</Text> : null}
      </View>

      {busy ? <Spinner style={styles.trailing} />
        : checkbox ? (
          <Icon
            name={selected ? 'checkCircle' : 'addCircle'}
            size={22}
            color={selected ? c.accent : c.textFaint}
            filled={selected}
          />
        ) : null}
    </TouchableRow>
  )
}

/** The removable chips above a multi-select picker. */
export function SelectionChips({ users, onRemove }: { users: any[]; onRemove: (id: string) => void }) {
  if (!users.length) return null
  return (
    <View style={styles.chips}>
      {users.map(u => (
        <Chip
          key={String(u.id)}
          label={String(u.full || u.username || '').split(' ')[0] || 'Member'}
          size="sm"
          tone="accent"
          onRemove={() => onRemove(String(u.id))}
        />
      ))}
    </View>
  )
}

/** The 12px uppercase section rule above `Suggested` / `Results`. */
export function PickerSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text variant="micro" tone="muted" align="ui">{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 64 },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
  trailing: { padding: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, paddingHorizontal: space.lg, paddingBottom: space.sm },
  sectionLabel: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs2 },
})
