/* =========================================================
   Madhhab and specializations.

   Two vocabularies, two very different writes:

     madhhab          one id on the profile PATCH, where an
                      omitted or null key means "keep" (verified
                      live) — a school can be changed, not removed,
                      so this screen only writes when one is picked.
     specializations  REPLACE-ALL and transactional. The array
                      order IS the displayOrder, and one unknown
                      topicId 404s the whole request with nothing
                      applied — so there is never a partial
                      success to report.

   The whole topic vocabulary is read once and filtered in
   memory with the server's own trilingual contains rule, so
   typing never costs a request.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { api, errorText, isNetworkError, taxonomyFilter, taxonomyName } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Chip, Icon, Screen, SearchField, Skeleton, Text, Touchable, toast,
} from '@/ui'
import { OnboardingHeader } from './_layout'

interface Row { id: number; nameEn: string; nameAr: string; nameCkb: string }

export default function OnboardingExpertiseScreen() {
  const t = useTheme()
  const router = useRouter()

  const [madhhabId, setMadhhabId] = React.useState<number | null>(null)
  const [selected, setSelected] = React.useState<Row[]>([])
  const [query, setQuery] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  const schools = useAsync<Row[]>(() => api.madhhabs.all(), {})
  const topics = useAsync<Row[]>(() => api.topics.all(), {})

  const next = React.useCallback(() => router.replace('/(auth)/onboarding/follow'), [router])

  const filtered = React.useMemo(
    () => taxonomyFilter(topics.data || [], query).slice(0, 60) as Row[],
    [topics.data, query],
  )
  const selectedIds = React.useMemo(() => new Set(selected.map(r => r.id)), [selected])

  const toggle = (row: Row) => {
    setSelected(prev => (prev.some(r => r.id === row.id) ? prev.filter(r => r.id !== row.id) : [...prev, row]))
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
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      /* Sequential and specializations first, so a failure message maps to
         exactly one of the two writes. */
      if (selected.length) await api.users.updateSpecializations(selected)
      if (madhhabId != null) await api.users.updateProfile({ madhhabId })
      next()
    } catch (e: any) {
      setSaving(false)
      setError(e)
      /* A 404 here means a stale id from a vocabulary cached before an
         operator changed it — drop the cache so a retry reads fresh rows. */
      if (String(e?.code) === 'TOPIC_NOT_FOUND') { api.topics.forget(); void topics.reload() }
      if (String(e?.code) === 'MADHHAB_NOT_FOUND') { api.madhhabs.forget(); setMadhhabId(null); void schools.reload() }
      toast.error(errorText(e))
    }
  }

  const offline = isNetworkError(topics.error) || isNetworkError(schools.error)

  return (
    <Screen>
      <OnboardingHeader onSkip={next} />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="title1" align="ui">Your madhhab and specializations</Text>
        <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          Both are optional. They help people find the right scholar for a question.
        </Text>

        {/* ---- school ---- */}
        <View style={styles.sectionHead}>
          <Text variant="title3" align="ui" style={{ flex: 1 }}>School of jurisprudence</Text>
          {madhhabId != null ? (
            <Touchable onPress={() => setMadhhabId(null)} feedback="dim">
              <Text variant="subhead" tone="accent">Clear</Text>
            </Touchable>
          ) : null}
        </View>

        {schools.loading ? (
          <ChipSkeletons />
        ) : schools.error ? (
          <RetryRow label="Could not load schools" onRetry={() => { api.madhhabs.forget(); void schools.reload() }} />
        ) : (
          <View style={styles.wrap}>
            {(schools.data || []).map(row => (
              <Chip
                key={row.id}
                label={taxonomyName(row, t.language)}
                selected={madhhabId === row.id}
                icon={madhhabId === row.id ? 'check' : undefined}
                onPress={() => setMadhhabId(id => (id === row.id ? null : row.id))}
              />
            ))}
          </View>
        )}

        {/* ---- specializations ---- */}
        <View style={styles.sectionHead}>
          <Text variant="title3" align="ui" style={{ flex: 1 }}>Specializations</Text>
          <Text variant="footnote" tone="muted">{selected.length} selected</Text>
        </View>

        {selected.length ? (
          <View style={{ gap: space.xs2, marginBottom: space.md }}>
            <Text variant="footnote" tone="muted" align="ui">
              Order matters — the first ones show on your profile.
            </Text>
            {selected.map((row, i) => (
              <View
                key={row.id}
                style={[styles.orderedRow, { backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.sm }]}
              >
                <Text variant="footnote" tone="faint" style={{ width: 18 }}>{i + 1}</Text>
                <Text variant="callout" align="auto" numberOfLines={1} style={{ flex: 1 }}>
                  {taxonomyName(row, t.language)}
                </Text>
                <Touchable onPress={() => move(i, -1)} disabled={i === 0} feedback="dim" accessibilityLabel="Move up">
                  <Icon name="up" size={17} color={i === 0 ? t.colors.textFaint : t.colors.textSecondary} />
                </Touchable>
                <Touchable
                  onPress={() => move(i, 1)}
                  disabled={i === selected.length - 1}
                  feedback="dim"
                  accessibilityLabel="Move down"
                >
                  <Icon name="down" size={17} color={i === selected.length - 1 ? t.colors.textFaint : t.colors.textSecondary} />
                </Touchable>
                <Touchable onPress={() => toggle(row)} feedback="dim" accessibilityLabel="Remove">
                  <Icon name="close" size={16} color={t.colors.textMuted} />
                </Touchable>
              </View>
            ))}
            {selected.length > 10 ? (
              <Text variant="footnote" tone="warning" align="ui">
                Profiles read best with 5–8. You can keep more if you want to.
              </Text>
            ) : null}
          </View>
        ) : null}

        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search topics — fiqh, الفقه, فیقه"
          style={{ marginBottom: space.md }}
        />

        {topics.loading ? (
          <ChipSkeletons />
        ) : topics.error ? (
          <RetryRow label="Could not load topics" onRetry={() => { api.topics.forget(); void topics.reload() }} />
        ) : filtered.length ? (
          <View style={styles.wrap}>
            {filtered.map(row => (
              <Chip
                key={row.id}
                label={taxonomyName(row, t.language)}
                selected={selectedIds.has(row.id)}
                onPress={() => toggle(row)}
              />
            ))}
          </View>
        ) : (
          <Text variant="callout" tone="muted" align="ui">No topic matches “{query}”.</Text>
        )}

        {error ? <Callout tone="danger" style={{ marginTop: space.lg }}>{errorText(error)}</Callout> : null}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { backgroundColor: t.colors.bg, borderTopColor: t.colors.separator }]}>
        <Button
          label={offline ? 'You are offline' : saving ? 'Saving…' : 'Continue'}
          onPress={save}
          variant="primary"
          size="lg"
          block
          loading={saving}
          disabled={saving || offline}
        />
      </View>
    </Screen>
  )
}

function ChipSkeletons() {
  return (
    <View style={styles.wrap}>
      {/* The chips these stand in for are setback plates, not pills — the
          placeholder wears the chip crown so nothing reshapes on load. */}
      {[86, 120, 74, 104, 92, 130].map((w, i) => <Skeleton key={i} width={w} height={32} radius={8} />)}
    </View>
  )
}

function RetryRow({ label, onRetry }: { label: string; onRetry: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.retry, { borderColor: t.colors.border, borderRadius: t.radius.md }]}>
      <Icon name="offline" size={16} color={t.colors.textMuted} />
      <Text variant="footnote" tone="muted" align="ui" style={{ flex: 1 }}>{label}</Text>
      <Button label="Retry" onPress={onRetry} variant="ghost" size="sm" />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: space.xxl, paddingTop: space.sm, paddingBottom: space.xxxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 26, marginBottom: space.sm2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  orderedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md, paddingVertical: space.sm2 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, padding: space.md, borderWidth: StyleSheet.hairlineWidth },
  footer: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
})
