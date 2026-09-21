/* =========================================================
   Edit post.

   PATCH semantics: only CHANGED fields go on the wire, and
   every omitted field is left untouched. A body with no
   recognised key is a server-side no-op that returns the post
   unchanged — which looks exactly like a successful save and is
   why the diff happens here rather than being sent blind.

   Media saves on a different wire. PATCH cannot touch the
   album — the post-media carousel endpoints (GET/POST/PUT/
   DELETE /posts/{id}/media, author-only — post/media.md) live
   at api.posts.media — so this screen edits only the PATCHable
   text / visibility / location fields and hands the album off
   to ./media. The tray below is a read-only preview, not a
   lock.

   Edits are moderated exactly like creates, so the composer's
   rejection contract applies verbatim: the server's message,
   the draft kept, no retry button.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { api, codeOf, errorText, fieldErrorMap, isNotFound, isRateLimited } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Avatar, Callout, DisclosureIcon, EmptyState, ErrorState, Header, Icon, Screen, Sheet,
  Skeleton, Spinner, Text, Touchable, fireHaptic, toast, type IconName,
} from '@/ui'
import { putEditedPost } from '@/components/feed/feedInbox'
import { isBlocked, isUnderReview, moderationText } from '@/lib/moderation'
import type { PostView } from '@/components/feed/types'

/* One formatter for the life of the app: `toLocaleString` with an options bag
   builds a fresh Intl.DateTimeFormat on every call. */
const STAMP = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
})

type Visibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'ONLY_ME'

const VISIBILITY: { value: Visibility; label: string; note: string; icon: IconName }[] = [
  { value: 'PUBLIC', label: 'Public', note: 'Anyone on Hikmah Web can see this post.', icon: 'globe' },
  { value: 'FOLLOWERS_ONLY', label: 'Followers', note: 'Only people who follow you.', icon: 'people' },
  { value: 'ONLY_ME', label: 'Only me', note: 'Visible to you alone — a private note.', icon: 'lock' },
]

/* The adapter maps FOLLOWERS_ONLY → FOLLOWERS on read; the wire wants the
   long spelling back. */
const toWire = (v: string): Visibility =>
  v === 'FOLLOWERS' || v === 'FOLLOWERS_ONLY' ? 'FOLLOWERS_ONLY' : v === 'ONLY_ME' ? 'ONLY_ME' : 'PUBLIC'

export default function EditPostScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()

  /* Seed from the canonical row, not from a possibly-stale feed row. */
  const post = useAsync<PostView>(() => api.posts.get(id), { enabled: !!id, deps: [id] })

  const [text, setText] = React.useState<string | null>(null)
  const [visibility, setVisibility] = React.useState<Visibility>('PUBLIC')
  const [locationName, setLocationName] = React.useState('')
  const [visOpen, setVisOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [blockedCopy, setBlockedCopy] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]

  React.useEffect(() => {
    const p = post.data
    if (!p) return
    setText(p.body ?? '')
    setVisibility(toWire(p.visibility))
    setLocationName(p.location ?? '')
  }, [post.data])

  const original = post.data
  const notAuthor = !!original && !!user?.id && String(original.author) !== String(user.id)

  const changed = React.useMemo(() => {
    if (!original || text === null) return {}
    const out: Record<string, unknown> = {}
    if (text !== (original.body ?? '')) out.textContent = text
    if (visibility !== toWire(original.visibility)) out.visibility = visibility
    if (locationName.trim() !== (original.location ?? '')) out.locationName = locationName.trim()
    return out
  }, [original, text, visibility, locationName])

  const dirty = Object.keys(changed).length > 0
  const canSave = dirty && !saving && cooldown === 0

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setBlockedCopy(null)
    setFieldErrors({})
    try {
      const updated: PostView = await api.posts.edit(id, changed)
      /* The server also broadcasts POST_UPDATED on the post's SSE channel, so
         any open viewer reconciles on its own; this is for the caller. */
      putEditedPost(updated)
      fireHaptic('success')
      toast.ok('Saved')
      router.back()
    } catch (e: any) {
      fireHaptic('error')
      if (isBlocked(e) || isUnderReview(e)) setBlockedCopy(moderationText(e))
      else if (isRateLimited(e)) { startCooldown(e); setError(e) }
      else if (codeOf(e) === 'VALIDATION_FAILED') setFieldErrors(fieldErrorMap(e, { textContent: 'text' }) as Record<string, string>)
      else setError(e)
    } finally {
      setSaving(false)
    }
  }

  if (post.loading || text === null) {
    return (
      <Screen background="elevated">
        <Header closeButton title="Edit post" />
        <View style={styles.skeleton}>
          <View style={styles.skelRow}>
            <Skeleton circle width={36} height={36} />
            <Skeleton width="40%" height={12} />
          </View>
          <Skeleton width="92%" height={13} style={{ marginTop: space.lg2 }} />
          <Skeleton width="78%" height={13} style={{ marginTop: space.sm2 }} />
          <Skeleton width="55%" height={13} style={{ marginTop: space.sm2 }} />
        </View>
      </Screen>
    )
  }

  if (post.error && isNotFound(post.error)) {
    return (
      <Screen background="elevated">
        <Header closeButton title="Edit post" />
        <EmptyState
          icon="search"
          title="This post is no longer available"
          message="It may have been deleted."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  if (post.error || !original) {
    return (
      <Screen background="elevated">
        <Header closeButton title="Edit post" />
        <ErrorState error={post.error} onRetry={() => { void post.reload() }} />
      </Screen>
    )
  }

  if (notAuthor) {
    /* The entry points already gate on ownership; this is the belt for the
       deep link that slipped through. */
    return (
      <Screen background="elevated">
        <Header closeButton title="Edit post" />
        <EmptyState
          icon="lock"
          title="You can’t edit this post"
          message="Only its author can make changes."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    )
  }

  const posted = original.createdAt ? STAMP.format(new Date(original.createdAt)) : ''

  return (
    <Screen background="elevated">
      <Header
        titleNode={
          <View style={styles.headerRow}>
            <Touchable onPress={() => router.back()} feedback="dim" noAutoHitSlop style={styles.headerBtn}>
              <Text variant="callout" tone="accent">Cancel</Text>
            </Touchable>
            <View style={styles.headerTitle}>
              <Text variant="headline" align="center">Edit post</Text>
            </View>
            <Touchable
              onPress={() => { void save() }}
              disabled={!canSave}
              feedback="scale"
              haptic="light"
              accessibilityLabel="Save"
              style={[styles.savePlate, { backgroundColor: canSave ? c.accent : c.surfaceSunken }]}
            >
              {saving ? (
                <Spinner color={c.textOnAccent} />
              ) : (
                <Text variant="subhead" weight="700" color={canSave ? c.textOnAccent : c.textFaint}>
                  {cooldown > 0 ? `Wait ${cooldown}s` : 'Save'}
                </Text>
              )}
            </Touchable>
          </View>
        }
      />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {blockedCopy ? <Callout tone="danger" style={styles.banner}>{blockedCopy}</Callout> : null}
        {error ? <Callout tone="danger" style={styles.banner}>{errorText(error)}</Callout> : null}

        <View style={styles.authorStrip}>
          <Avatar uri={original._author?.profileImage} name={original._author?.full} seed={original.author} size={36} />
          <Text variant="subhead" weight="600" numberOfLines={1} style={styles.flex}>{original._author?.full}</Text>
          <Touchable
            onPress={() => setVisOpen(true)}
            feedback="scale"
            style={[styles.visChip, { backgroundColor: c.surfaceSunken }]}
          >
            <Icon name={VISIBILITY.find(v => v.value === visibility)!.icon} size={13} color={c.textSecondary} />
            <Text variant="footnote" tone="secondary">{VISIBILITY.find(v => v.value === visibility)!.label}</Text>
            <Icon name="down" size={12} color={c.textFaint} />
          </Touchable>
        </View>

        {visibility === 'ONLY_ME' && toWire(original.visibility) === 'PUBLIC' ? (
          <Text variant="footnote" tone="warning" align="ui" style={styles.caution}>
            Only you will see this post.
          </Text>
        ) : null}

        <TextInput
          value={text}
          onChangeText={v => { setText(v); if (blockedCopy) setBlockedCopy(null) }}
          multiline
          allowFontScaling={false}
          editable={!saving}
          placeholder="Say something…"
          placeholderTextColor={c.textFaint}
          style={[styles.editor, { color: c.text, writingDirection: t.isRTL ? 'rtl' : 'ltr' }]}
        />
        {fieldErrors.text ? (
          <Text variant="footnote" tone="danger" align="ui" style={styles.gutter}>{fieldErrors.text}</Text>
        ) : null}

        {/[#][\p{L}\p{N}_]/u.test(text) ? (
          <Text variant="caption" tone="faint" align="ui" style={styles.gutter}>
            Changing #tags moves this post between tag feeds.
          </Text>
        ) : null}

        {original.media?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray}>
            {original.media.map((m, i) => (
              <View key={`${m.url}:${i}`} style={[styles.tile, { borderRadius: t.radius.sm, backgroundColor: c.surfaceSunken }]}>
                {m.url ? (
                  <Image
                    source={{ uri: m.type === 'VIDEO' ? (m.poster || m.url) : m.url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={120}
                  />
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}

        {/* The album is not PATCHable — it hands off to the carousel editor.
            A text post may grow an album the same way: the POST just appends
            (post/media.md §2), so the row is offered either way. */}
        <Touchable
          onPress={() => router.push(`/post/${id}/edit/media`)}
          feedback="dim"
          noAutoHitSlop
          style={styles.albumRow}
        >
          <Icon name="gallery" size={16} color={c.textMuted} />
          <Text variant="callout" tone="accent" style={styles.flex}>
            {original.media?.length ? 'Edit album' : 'Add media'}
          </Text>
          <DisclosureIcon />
        </Touchable>

        <View style={[styles.locationRow, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}>
          <Icon name="location" size={16} color={c.textMuted} />
          <TextInput
            value={locationName}
            onChangeText={setLocationName}
            placeholder="Add a location"
            placeholderTextColor={c.textFaint}
            allowFontScaling={false}
            editable={!saving}
            style={[styles.locationInput, { color: c.text, fontSize: t.type.callout.fontSize }]}
          />
          {locationName ? (
            <Touchable onPress={() => setLocationName('')} feedback="dim" hitSlop={8} accessibilityLabel="Clear location">
              <Icon name="close" size={15} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>

        <Text variant="caption" tone="faint" align="ui" style={styles.footer}>
          Posted {posted}
        </Text>
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={{ height: insets.bottom }} />
      </KeyboardStickyView>

      <Sheet visible={visOpen} onClose={() => setVisOpen(false)} title="Who can see this?">
        <View style={{ paddingBottom: space.sm }}>
          {VISIBILITY.map(opt => (
            <Touchable
              key={opt.value}
              onPress={() => { setVisibility(opt.value); setVisOpen(false) }}
              feedback="tint"
              noAutoHitSlop
              style={styles.visRow}
            >
              <Icon name={opt.icon} size={20} color={visibility === opt.value ? c.accent : c.textSecondary} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">{opt.label}</Text>
                <Text variant="footnote" tone="muted" style={{ marginTop: space.xxs }}>{opt.note}</Text>
              </View>
              {visibility === opt.value ? <Icon name="checkCircle" size={20} color={c.accent} filled /> : null}
            </Touchable>
          ))}
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gutter: { paddingHorizontal: space.lg, paddingTop: space.xs2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerBtn: { paddingVertical: space.xs2, paddingHorizontal: space.xs },
  headerTitle: { flex: 1, alignItems: 'center' },
  /* A sm-button setback, not a pill (DON'T #9). */
  savePlate: {
    ...setback(shape.buttonSm),
    borderCurve: 'continuous',
    height: 32, minWidth: 68, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center',
  },
  body: { paddingBottom: space.xxxl },
  banner: { margin: space.lg, marginBottom: space.xs },
  authorStrip: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingTop: space.md2 },
  /* The visibility marker is a CHIP (setback 8/3), never a pill. */
  visChip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 28, paddingHorizontal: space.sm2,
  },
  caution: { paddingHorizontal: space.lg, paddingTop: space.sm },
  editor: { minHeight: 140, paddingHorizontal: space.lg, paddingTop: space.md2, fontSize: 17, lineHeight: 24 },
  tray: { paddingHorizontal: space.lg, paddingTop: space.md2, gap: space.sm },
  tile: { width: 84, height: 84, overflow: 'hidden' },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginTop: space.lg, paddingHorizontal: space.md, height: 44 },
  locationInput: { flex: 1 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.lg2 },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: space.md2, paddingHorizontal: space.xl, paddingVertical: space.md2 },
  skeleton: { padding: space.lg },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
})
