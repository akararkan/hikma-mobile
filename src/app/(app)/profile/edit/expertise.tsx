/* =========================================================
   Madhhab and specializations — the editor.

   The specialization write is REPLACE-ALL and transactional:
   the body is the complete desired list, position IS the
   displayOrder, `[]` clears, and one unknown topicId 404s the
   whole request with nothing applied. So this screen never
   sends a delta, and never reports a partial success.

   The two writes run sequentially, specializations first, so
   whichever one fails owns the message.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText, taxonomyFilter, taxonomyName } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, ErrorState, GroupLabel, Header, Icon,
  ListRow, RowGroup, Screen, SearchField, Skeleton, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'

interface Row { id: number; nameEn: string; nameAr: string; nameCkb: string }

export default function EditExpertiseScreen() {
  const t = useTheme()
  const router = useRouter()
  const { setUser } = useAuth()

  const me = useAsync<any>(() => api.users.meProfile(), {})
  const schools = useAsync<Row[]>(() => api.madhhabs.all(), {})
  const topics = useAsync<Row[]>(() => api.topics.all(), {})

  const [madhhabId, setMadhhabId] = React.useState<number | null>(null)
  const [selected, setSelected] = React.useState<Row[]>([])
  const [seeded, setSeeded] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  const clearAll = useSheetState()
  const confirmSave = useSheetState<number>()

  const baseline = React.useRef<{ madhhabId: number | null; ids: number[] }>({ madhhabId: null, ids: [] })

  React.useEffect(() => {
    if (!me.data || seeded) return
    const rows: Row[] = (me.data.specializations || []).map((s: any) => ({
      id: Number(s.id),
      nameEn: s.nameEn || s.name || '',
      nameAr: s.nameAr || '',
      nameCkb: s.nameCkb || '',
    }))
    const id = me.data.madhhabId != null ? Number(me.data.madhhabId) : null
    setSelected(rows)
    setMadhhabId(id)
    baseline.current = { madhhabId: id, ids: rows.map(r => r.id) }
    setSeeded(true)
  }, [me.data, seeded])

  const filtered = React.useMemo(
    () => (taxonomyFilter(topics.data || [], query) as Row[]).slice(0, 80),
    [topics.data, query],
  )
  const selectedIds = React.useMemo(() => new Set(selected.map(r => r.id)), [selected])

  const specsChanged =
    selected.length !== baseline.current.ids.length
    || selected.some((r, i) => r.id !== baseline.current.ids[i])
  /* PATCH /me/profile treats null as "keep" (verified live), so a school can be
     CHANGED but never removed — a null here must not count as a pending edit,
     or Save would toast success over a write the server ignores. */
  const schoolChanged = madhhabId !== baseline.current.madhhabId && madhhabId != null
  const dirty = specsChanged || schoolChanged
  const removedCount = baseline.current.ids.filter(id => !selectedIds.has(id)).length

  const toggle = (row: Row) => {
    setSelected(prev => (prev.some(r => r.id === row.id) ? prev.filter(r => r.id !== row.id) : [...prev, row]))
    setError(null)
  }

  const move = (index: number, delta: number) => {
    setSelected(prev => {
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(index, 1)
      next.splice(to, 0, row)
      return next
    })
    fireHaptic('select')
  }

  const write = async () => {
    setSaving(true)
    setError(null)
    try {
      if (specsChanged) {
        const raw = selected.length
          ? await api.users.updateSpecializations(selected)
          : await api.users.clearSpecializations()
        setUser(raw)
      }
      if (schoolChanged) {
        const raw = await api.users.updateProfile({ madhhabId })
        setUser(raw)
      }
      fireHaptic('success')
      toast.ok('Expertise updated')
      router.back()
    } catch (e: any) {
      setSaving(false)
      setError(e)
      /* A 404 on either vocabulary means a cached id an operator has since
         removed — drop the cache so the retry reads real rows. */
      if (codeOf(e) === 'TOPIC_NOT_FOUND') { api.topics.forget(); void topics.reload() }
      if (codeOf(e) === 'MADHHAB_NOT_FOUND') { api.madhhabs.forget(); setMadhhabId(null); void schools.reload() }
    }
  }

  const save = () => {
    if (!dirty || saving) { router.back(); return }
    /* Replace-all means a removal is invisible in the request — so a big one
       gets stated out loud before it happens. */
    if (removedCount > 3) { confirmSave.open(removedCount); return }
    void write()
  }

  if (me.loading && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Madhhab and specializations" />
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Skeleton height={160} radius={t.radius.md} />
          <Skeleton height={240} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (me.error && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Madhhab and specializations" />
        <ErrorState error={me.error} onRetry={me.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Madhhab and specializations"
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: dirty ? 'accent' : 'default' }]}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md }}>
            <Callout tone="danger">{errorText(error)}</Callout>
          </View>
        ) : null}

        <GroupLabel>School of jurisprudence</GroupLabel>
        {schools.loading ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}><Skeleton height={180} radius={t.radius.md} /></View>
        ) : schools.error ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={() => { api.madhhabs.forget(); void schools.reload() }}>
              Could not load the list of schools.
            </Callout>
          </View>
        ) : (
          <RowGroup inset={0}>
            <ListRow
              title="None"
              accessory={{ kind: 'radio', checked: madhhabId == null }}
              onPress={() => {
                /* The API can change a school but not remove one (null = keep,
                   verified live) — don't let the radio promise otherwise. */
                if (baseline.current.madhhabId != null) {
                  toast.info('A chosen school can be changed, but not removed.')
                  return
                }
                setMadhhabId(null)
              }}
            />
            {(schools.data || []).map(row => {
              const primary = taxonomyName(row, t.language)
              return (
                <ListRow
                  key={row.id}
                  title={primary}
                  subtitle={primary !== row.nameEn ? row.nameEn : undefined}
                  accessory={{ kind: 'radio', checked: madhhabId === row.id }}
                  onPress={() => setMadhhabId(row.id)}
                />
              )
            })}
          </RowGroup>
        )}

        <View style={styles.sectionHead}>
          <Text variant="caption" tone="muted" align="ui" style={{ flex: 1 }}>
            Specializations · {selected.length} selected
          </Text>
          {selected.length ? (
            <Touchable onPress={() => clearAll.open()} feedback="dim">
              <Text variant="subhead" tone="danger">Clear all</Text>
            </Touchable>
          ) : null}
        </View>

        {selected.length ? (
          <View style={{ marginHorizontal: t.layout.screenPadding, gap: space.xs2 }}>
            <Text variant="footnote" tone="muted" align="ui">
              Order matters — this is how they appear on your profile.
            </Text>
            <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.borderFaint, borderRadius: t.radius.md }]}>
              {selected.map((row, i) => (
                <View key={row.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.orderedRow}>
                    <Text variant="footnote" tone="faint" style={{ width: 18 }}>{i + 1}</Text>
                    <Text variant="callout" align="auto" numberOfLines={1} style={{ flex: 1 }}>
                      {taxonomyName(row, t.language)}
                    </Text>
                    <Touchable onPress={() => move(i, -1)} disabled={i === 0} feedback="dim" accessibilityLabel="Move up">
                      <Icon name="up" size={18} color={i === 0 ? t.colors.textFaint : t.colors.textSecondary} />
                    </Touchable>
                    <Touchable onPress={() => move(i, 1)} disabled={i === selected.length - 1} feedback="dim" accessibilityLabel="Move down">
                      <Icon name="down" size={18} color={i === selected.length - 1 ? t.colors.textFaint : t.colors.textSecondary} />
                    </Touchable>
                    <Touchable onPress={() => toggle(row)} feedback="dim" accessibilityLabel="Remove">
                      <Icon name="close" size={16} color={t.colors.textMuted} />
                    </Touchable>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md2, paddingBottom: space.sm }}>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search topics — fiqh, الفقه, فیقه" />
        </View>

        {topics.loading ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}><Skeleton height={280} radius={t.radius.md} /></View>
        ) : topics.error ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding }}>
            <Callout tone="warning" actionLabel="Retry" onAction={() => { api.topics.forget(); void topics.reload() }}>
              Could not load topics.
            </Callout>
          </View>
        ) : filtered.length ? (
          <RowGroup inset={0}>
            {filtered.map(row => {
              const primary = taxonomyName(row, t.language)
              return (
                <ListRow
                  key={row.id}
                  title={primary}
                  subtitle={primary !== row.nameEn ? row.nameEn : undefined}
                  accessory={{ kind: 'check', checked: selectedIds.has(row.id) }}
                  onPress={() => toggle(row)}
                />
              )
            })}
          </RowGroup>
        ) : (
          <Text variant="callout" tone="muted" align="ui" style={{ paddingHorizontal: t.layout.screenPadding }}>
            No topic matches “{query}”.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: t.colors.bg, borderTopColor: t.colors.separator }]}>
        <Button
          label={saving ? 'Saving…' : dirty ? 'Save changes' : 'Done'}
          onPress={save}
          variant="primary"
          size="lg"
          block
          loading={saving}
          disabled={saving}
        />
      </View>

      <ConfirmSheet
        visible={clearAll.visible}
        onClose={clearAll.close}
        title="Remove every specialization?"
        message="Your profile will show no topics until you add some again."
        confirmLabel="Clear all"
        destructive
        onConfirm={() => { setSelected([]); clearAll.close() }}
      />

      <ConfirmSheet
        visible={confirmSave.visible}
        onClose={confirmSave.close}
        title="Save these changes?"
        message={`This removes ${confirmSave.payload} specialization${confirmSave.payload === 1 ? '' : 's'} from your profile.`}
        confirmLabel="Save"
        loading={saving}
        onConfirm={() => { confirmSave.close(); void write() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingTop: 22, paddingBottom: space.sm,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  orderedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  footer: { padding: space.lg, paddingBottom: space.xxl, borderTopWidth: StyleSheet.hairlineWidth },
})
