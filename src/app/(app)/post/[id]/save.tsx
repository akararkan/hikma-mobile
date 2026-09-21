/* =========================================================
   Save to collection.

   There is no collections API. A "collection" is nothing but
   the free-text `collection` query param on the save toggle, so
   the list here is DERIVED by grouping `savedCollectionName`
   over the viewer's own saved posts — and a collection ceases
   to exist the moment its last post is unsaved.

   Two consequences the UI has to be honest about:

   · Creating a collection does not call anything. The name only
     becomes real when a post is saved into it, so "Create"
     performs the save.
   · Moving between collections is UNSAVE-then-SAVE. `toggleSave`
     on an already-saved post would silently unsave it, which is
     the exact opposite of what the tap meant.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText, isRateLimited } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Divider, Header, Icon, Screen, Skeleton, Text, Touchable, toast,
} from '@/ui'
import { Image } from 'expo-image'
import type { PostView } from '@/components/feed/types'

/** The default bucket — `collection` omitted on the wire. */
const DEFAULT_BUCKET = '__all__'

interface Bucket {
  key: string
  name: string
  count: number
  cover: string | null
}

export default function SaveToCollectionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  const saved = useAsync<PostView[]>(
    () => api.posts.savedPosts(user!.id, { pageSize: 100 }),
    { enabled: !!user?.id, deps: [user?.id] },
  )
  const mine = useAsync<{ saved: boolean }>(() => api.posts.savedByMe(id), { enabled: !!id, deps: [id] })

  const [current, setCurrent] = React.useState<string | null>(null)
  const [isSaved, setIsSaved] = React.useState<boolean | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  React.useEffect(() => {
    if (mine.data) setIsSaved(!!mine.data.saved)
  }, [mine.data])

  React.useEffect(() => {
    const row = (saved.data || []).find(p => String(p.id) === String(id))
    if (row) setCurrent(row.savedCollectionName ?? DEFAULT_BUCKET)
  }, [saved.data, id])

  const buckets = React.useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>()
    map.set(DEFAULT_BUCKET, { key: DEFAULT_BUCKET, name: 'All saved', count: 0, cover: null })
    for (const p of saved.data || []) {
      const key = p.savedCollectionName ?? DEFAULT_BUCKET
      const existing = map.get(key)
      const cover = p.media?.[0]?.poster || p.media?.[0]?.url || null
      if (existing) {
        existing.count += 1
        /* The list is newest-saved first, so the first cover we see is the
           newest one — keep it. */
        if (!existing.cover) existing.cover = cover
      } else {
        map.set(key, { key, name: key, count: 1, cover })
      }
    }
    const all = map.get(DEFAULT_BUCKET)!
    all.count = (saved.data || []).filter(p => !p.savedCollectionName).length
    return [...map.values()]
  }, [saved.data])

  const pick = async (bucket: string) => {
    if (busy || cooldown > 0) return
    setBusy(true)
    setError(null)
    const collection = bucket === DEFAULT_BUCKET ? undefined : bucket
    const previous = current
    setCurrent(bucket)
    try {
      /* Unsave first when the post is already in a bucket, or the toggle would
         read as "second tap" and quietly remove it. */
      if (isSaved) await api.posts.unsave(id)
      const res: any = await api.posts.toggleSave(id, collection)
      setIsSaved(!!res?.saved)
      if (previous && previous !== bucket) {
        toast.info('Moved', {
          label: 'Undo',
          onPress: () => { void pick(previous) },
        })
      }
      void saved.refresh()
    } catch (e) {
      setCurrent(previous)
      if (isRateLimited(e)) startCooldown(e)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const name = newName.trim().slice(0, 40)
    if (!name) return
    setCreating(false)
    setNewName('')
    await pick(name)
    router.back()
  }

  const removeAll = async () => {
    setBusy(true)
    try {
      await api.posts.unsave(id)
      setIsSaved(false)
      setCurrent(null)
      toast.ok('Removed from Saved')
      router.back()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen background="elevated">
      <Header
        closeButton
        title="Save to"
        actions={[{ icon: 'check', label: 'Done', onPress: () => router.back(), tone: 'accent' }]}
      />

      <View style={{ paddingBottom: insets.bottom + 12 }}>
        {error ? (
          <Callout tone="danger" style={styles.strip}>{errorText(error)}</Callout>
        ) : null}
        {cooldown > 0 ? (
          <Callout tone="warning" style={styles.strip}>Wait {cooldown}s before changing this again.</Callout>
        ) : null}

        {creating ? (
          <View style={styles.createRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Collection name"
              placeholderTextColor={c.textFaint}
              maxLength={40}
              autoFocus
              allowFontScaling={false}
              onSubmitEditing={() => { void create() }}
              style={[
                styles.input,
                { color: c.text, backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm, fontSize: t.type.body.fontSize },
              ]}
            />
            <Button label="Create" onPress={() => { void create() }} variant="ghost" size="sm" disabled={!newName.trim()} />
          </View>
        ) : (
          <Touchable onPress={() => setCreating(true)} feedback="tint" noAutoHitSlop style={styles.row}>
            <View style={[styles.plus, { borderColor: c.borderStrong, borderRadius: t.radius.xs }]}>
              <Icon name="add" size={17} color={c.textMuted} />
            </View>
            <Text variant="body" weight="600" style={styles.flex}>New collection</Text>
          </Touchable>
        )}

        <Divider inset={16} />

        {saved.loading ? (
          <View style={{ paddingVertical: space.sm }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={styles.row}>
                <Skeleton width={40} height={40} radius={10} />
                <View style={styles.flex}>
                  <Skeleton width="42%" height={12} />
                  <Skeleton width="24%" height={10} style={{ marginTop: space.sm }} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <>
            {buckets.map(b => (
              <Touchable
                key={b.key}
                onPress={() => { void pick(b.key) }}
                disabled={busy || cooldown > 0}
                feedback="tint"
                noAutoHitSlop
                style={styles.row}
              >
                {b.cover ? (
                  <Image
                    source={{ uri: b.cover }}
                    style={[styles.cover, { borderRadius: t.radius.xs, backgroundColor: c.surfaceSunken }]}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.cover, styles.center, { borderRadius: t.radius.xs, backgroundColor: c.accentSoft }]}>
                    <Text variant="headline" color={c.accentText}>
                      {b.key === DEFAULT_BUCKET ? '★' : b.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>{b.name}</Text>
                  <Text variant="footnote" tone="muted">{b.count} saved</Text>
                </View>
                <Icon
                  name={current === b.key ? 'checkCircle' : 'add'}
                  size={22}
                  filled={current === b.key}
                  color={current === b.key ? c.accent : c.textFaint}
                />
              </Touchable>
            ))}

            {buckets.length <= 1 ? (
              <Text variant="footnote" tone="muted" align="ui" style={styles.hint}>
                Collections help you find things later.
              </Text>
            ) : null}
          </>
        )}

        {isSaved ? (
          <>
            <Divider inset={16} style={{ marginTop: space.sm }} />
            <Touchable onPress={() => { void removeAll() }} disabled={busy} feedback="tint" noAutoHitSlop style={styles.row}>
              <View style={[styles.plus, styles.center, { borderColor: c.dangerSoft, borderRadius: t.radius.xs }]}>
                <Icon name="bookmark" size={17} color={c.danger} filled />
              </View>
              <Text variant="body" tone="danger" style={styles.flex}>Remove from saved</Text>
            </Touchable>
          </>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  strip: { margin: space.lg, marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm2, minHeight: 56 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  input: { flex: 1, height: 40, paddingHorizontal: space.md },
  plus: { width: 32, height: 32, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  cover: { width: 40, height: 40 },
  hint: { paddingHorizontal: space.lg, paddingTop: space.sm2 },
})
