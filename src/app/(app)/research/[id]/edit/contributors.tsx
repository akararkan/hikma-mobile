/* =========================================================
   Manage contributors.

   Two write paths, deliberately:

     addContributor    one new person — this is the path that
                       NOTIFIES them, which is why the picker
                       says so
     replaceContributors  a reorder or a multi-row edit — one
                       atomic write, and it does NOT re-notify

   Using replace for a single addition would silently swallow
   the notification; using add for a reorder would need N calls
   and could half-apply.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useDebounced } from '@/hooks/useAsync'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, Field, Header, Icon, Screen, Sheet, Skeleton,
  Text, Touchable, toast, useSheetState,
} from '@/ui'
import { plateOf } from '@/components/research/ContributorRow'
import { ErrorPanel, RefusalState } from '@/components/research/states'
import { CONTRIBUTOR_ROLE_LABEL } from '@/components/research/format'
import type { Author, ContributorRole, ContributorRow as ContributorData } from '@/components/research/types'

const ROLES: ContributorRole[] = ['CO_AUTHOR', 'ADVISOR', 'REVIEWER', 'TRANSLATOR', 'EDITOR', 'CONTRIBUTOR']

interface Row extends ContributorData { _error?: string | null }

export default function EditContributorsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  const load = useAsync<ContributorData[]>(() => api.research.contributors(id), { enabled: !!id, deps: [id] })
  const [rows, setRows] = React.useState<Row[]>([])
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  const picker = useSheetState()
  const removing = useSheetState<Row>()
  const leaving = useSheetState()

  /* Hardware back runs the same guard as the header's back chevron —
     a reordered contributor list is unsaved work like any other. */
  useDiscardGuard(dirty, leaving.open)

  React.useEffect(() => {
    if (load.data) {
      setRows([...load.data].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)))
      setDirty(false)
    }
  }, [load.data])

  const patchRow = (rowId: string, patch: Partial<Row>) => {
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch, _error: null } : r)))
    setDirty(true)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    setRows(next)
    setDirty(true)
  }

  const add = async (who: Author) => {
    if (rows.some(r => r.userId === who.id)) return
    try {
      const raw: any = await api.research.addContributor(id, {
        userId: who.id,
        role: 'CO_AUTHOR',
        displayOrder: rows.length,
        contributionNote: '',
      })
      setRows(prev => [...prev, raw as ContributorData])
      picker.close()
      toast.ok('Added. They will be notified.')
    } catch (e: any) {
      const code = codeOf(e)
      /* Already on the table is the outcome we wanted — merge quietly. */
      if (code === 'RESOURCE_CONFLICT' || e?.status === 409) { void load.reload(); picker.close(); return }
      if (code === 'USER_NOT_FOUND') { toast.error(errorText(e)); return }
      setNotice(errorText(e))
    }
  }

  const commitRow = async (row: Row) => {
    try {
      await api.research.editContributor(id, row.id, {
        role: row.role,
        displayOrder: row.displayOrder,
        contributionNote: row.contributionNote,
      })
    } catch (e: any) {
      patchRow(row.id, { _error: errorText(e) })
    }
  }

  const drop = async (row: Row) => {
    removing.close()
    try {
      await api.research.deleteContributor(id, row.id)
      setRows(prev => prev.filter(r => r.id !== row.id))
      toast.ok('Contributor removed')
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  const saveAll = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      /* One atomic write for the whole table — displayOrder comes from array
         position, and nobody gets re-notified. */
      const fresh: any = await api.research.replaceContributors(
        id,
        rows.map((r, i) => ({
          userId: r.userId,
          role: r.role,
          displayOrder: i,
          contributionNote: r.contributionNote,
        })),
      )
      setRows((fresh || []).sort((a: ContributorData, b: ContributorData) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)))
      setDirty(false)
      toast.ok('Contributors saved')
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'CONTRIBUTOR_RESEARCH_MISMATCH') { setNotice(errorText(e)); void load.reload(); return }
      if (['CONTRIBUTOR_IS_OWNER', 'CONTRIBUTOR_NOT_ELIGIBLE', 'CONTRIBUTOR_DELETED', 'DUPLICATE_CONTRIBUTOR'].includes(code)) {
        setNotice(errorText(e))
        return
      }
      setNotice(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (load.error?.status === 403) {
    return (
      <Screen>
        <Header back title="Contributors" />
        <RefusalState title="You do not own this paper." body="Only the corresponding researcher can manage authorship." />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        title="Contributors"
        back={() => (dirty ? leaving.open() : router.back())}
        actions={[{ icon: 'check', onPress: saveAll, label: 'Save', tone: dirty ? 'accent' : 'default' }]}
      />

      {load.loading ? (
        <View style={{ padding: space.lg, gap: space.md2 }}>
          <Skeleton height={92} radius={16} />
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={110} radius={16} />)}
        </View>
      ) : load.error ? (
        <ErrorPanel error={load.error} onRetry={load.reload} />
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={styles.body} bottomOffset={40} keyboardShouldPersistTaps="handled">
          {notice ? <Callout tone="danger" style={{ marginBottom: space.md2 }}>{notice}</Callout> : null}

          {/* `micro` uppercases Latin INSIDE the Text primitive — which is what
    leaves an Arabic or Kurdish run alone — so the eyebrow is written in
    sentence case and takes the variant's own tracking. */}
          <Text variant="micro" tone="muted" align="ui" style={styles.label}>Corresponding researcher</Text>
          <View style={[styles.ownerCard, { backgroundColor: c.surface }]}>
            <Avatar uri={user?.profileImage} name={user?.displayName || user?.handle} seed={user?.id} size={44} />
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" align="auto" numberOfLines={1}>
                {user?.displayName || user?.handle || 'You'}
              </Text>
              <Text variant="caption" tone="faint" align="ui">
                The corresponding researcher is never listed as a contributor.
              </Text>
            </View>
          </View>

          {rows.map((row, i) => {
            const who = plateOf(row)
            return (
              <View key={row.id} style={[styles.card, { backgroundColor: c.surface }]}>
                <View style={styles.cardHead}>
                  <View style={styles.handle}>
                    <Touchable onPress={() => move(i, -1)} feedback="dim" accessibilityLabel="Move up">
                      <Icon name="up" size={16} color={c.textFaint} />
                    </Touchable>
                    <Touchable onPress={() => move(i, 1)} feedback="dim" accessibilityLabel="Move down">
                      <Icon name="down" size={16} color={c.textFaint} />
                    </Touchable>
                  </View>
                  <Avatar uri={who.profileImage} name={who.full} seed={who.id} size={44} />
                  <View style={styles.flex}>
                    <Text variant="subhead" weight="600" align="auto" numberOfLines={1}>{who.full}</Text>
                    <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>@{who.handle}</Text>
                  </View>
                  <Touchable onPress={() => removing.open(row)} feedback="dim" accessibilityLabel="Remove contributor">
                    <Icon name="close" size={17} color={c.textMuted} />
                  </Touchable>
                </View>

                <View style={styles.roleRow}>
                  {ROLES.map(role => (
                    <Touchable
                      key={role}
                      onPress={() => { patchRow(row.id, { role }); void commitRow({ ...row, role }) }}
                      feedback="scale"
                      haptic="select"
                      style={[
                        styles.rolePill,
                        {
                          backgroundColor: row.role === role ? c.accent : c.surfaceSunken,
                          borderColor: row.role === role ? c.accent : c.borderFaint,
                        },
                      ]}
                    >
                      <Text variant="caption" color={row.role === role ? c.textOnAccent : c.textSecondary}>
                        {CONTRIBUTOR_ROLE_LABEL[role]}
                      </Text>
                    </Touchable>
                  ))}
                </View>

                <Field
                  value={row.contributionNote || ''}
                  onChangeText={v => patchRow(row.id, { contributionNote: v })}
                  onBlur={() => void commitRow(row)}
                  placeholder="What they contributed"
                  maxLength={500}
                  error={row._error}
                  containerStyle={{ marginTop: space.sm2 }}
                />
              </View>
            )
          })}

          {!rows.length ? (
            <Text variant="footnote" tone="muted" align="ui" style={{ paddingVertical: space.sm2 }}>
              No contributors yet.
            </Text>
          ) : null}

          <Button
            label="Add contributor"
            icon="personAdd"
            variant="secondary"
            block
            onPress={() => picker.open()}
            style={{ marginTop: space.xs2 }}
          />

          <Button
            label="Save order and roles"
            block
            size="lg"
            loading={busy}
            disabled={busy || !dirty}
            onPress={saveAll}
            style={{ marginTop: space.lg }}
          />
        </KeyboardAwareScrollView>
      )}

      <ContributorPicker
        visible={picker.visible}
        onClose={picker.close}
        onAdd={add}
        taken={rows.map(r => r.userId).concat(user?.id ? [user.id] : [])}
      />

      <ConfirmSheet
        visible={removing.visible}
        onClose={removing.close}
        title="Remove this contributor?"
        message="This happens immediately and is not batched with Save."
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (removing.payload) void drop(removing.payload) }}
      />

      <ConfirmSheet
        visible={leaving.visible}
        onClose={leaving.close}
        title="Discard the new order?"
        message="Role and note edits were already saved; the order was not."
        confirmLabel="Discard"
        destructive
        onConfirm={() => { leaving.close(); router.back() }}
      />
    </Screen>
  )
}

function ContributorPicker({
  visible, onClose, onAdd, taken,
}: { visible: boolean; onClose: () => void; onAdd: (u: Author) => void; taken: string[] }) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Author[]>([])
  const [searching, setSearching] = React.useState(false)
  const debounced = useDebounced(query.trim(), 250)
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    abort.current?.abort()
    if (!visible || !debounced) { setResults([]); return }
    const ctl = new AbortController()
    abort.current = ctl
    setSearching(true)
    void api.users.search(debounced, { page: 0, size: 20, eligibleContributor: true, signal: ctl.signal } as any)
      .then((res: any) => setResults(res.items || []))
      .catch((e: any) => { if (e?.name !== 'AbortError') setResults([]) })
      .finally(() => setSearching(false))
    return () => ctl.abort()
  }, [debounced, visible])

  return (
    <Sheet visible={visible} onClose={onClose} title="Add contributor" maxHeightRatio={0.9}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Search researchers and scholars"
          icon="search"
          autoFocus
          hint="Only researchers and scholars can be listed. They will be notified."
        />
        {searching ? <Text variant="footnote" tone="faint" align="ui">Searching…</Text> : null}
        {results.map(user => {
          const already = taken.includes(user.id)
          return (
            <View key={user.id} style={styles.pickerRow}>
              <Avatar uri={user.profileImage} name={user.full} seed={user.id} size={38} />
              <View style={styles.flex}>
                <Text variant="subhead" align="auto" numberOfLines={1}>{user.full}</Text>
                <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>@{user.handle}</Text>
              </View>
              <Button label={already ? 'Added' : 'Add'} size="sm" disabled={already} onPress={() => onAdd(user)} />
            </View>
          )
        })}
        {debounced && !searching && !results.length ? (
          <Text variant="footnote" tone="muted" align="ui">No eligible researchers match “{debounced}”.</Text>
        ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingBottom: 60, gap: space.md },
  label: { paddingBottom: space.xs2 },
  ownerCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: 16, padding: space.md2, opacity: 0.75 },
  card: { borderRadius: 16, padding: space.md2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  handle: { gap: space.xxs },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs2, marginTop: space.sm2 },
  /* A text-bearing filter plate is a CHIP, not a pill — pills are only
     unread counters and LIVE badges (DESIGN.md §8.9). */
  rolePill: {
    paddingHorizontal: space.sm2, height: 28, ...setback(shape.chip), borderCurve: 'continuous',
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth,
  },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  flex: { flex: 1 },
})
