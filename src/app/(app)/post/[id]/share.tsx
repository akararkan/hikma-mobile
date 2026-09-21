/* =========================================================
   Share sheet.

   The whole design turns on one distinction the API makes and
   most clients get wrong:

     shareLink(id)     PREVIEW. Reads the link, does NOT bump the
                       counter, does not notify anybody.
     recordShare(id)   "the link actually left the app". Bumps
                       shareCount, appends the ledger row,
                       broadcasts SHARE_COUNT_UPDATED and
                       notifies the author.

   So opening this sheet costs nothing, and dismissing it by
   swipe records nothing. Only a completed copy or a completed OS
   share activity is a share.
   ========================================================= */
import React from 'react'
import { ScrollView, Share, StyleSheet, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { api, errorText, isNetworkError, isNotFound, isRateLimited } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, Header, Icon, NumericText, Screen, Skeleton, Text, Touchable,
  fireHaptic, formatCount, toast, type IconName,
} from '@/ui'
import { sharedAssetPath } from '@/components/stories/storyVisual'
import type { PostView } from '@/components/feed/types'

interface ShareLinkInfo {
  shortUrl: string
  canonicalUrl: string
  token: string
  shareCount: number
}

export default function ShareScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const link = useAsync<ShareLinkInfo>(() => api.posts.shareLink(id), { enabled: !!id, deps: [id] })
  const post = useAsync<PostView>(() => api.posts.get(id), { enabled: !!id, deps: [id] })

  const [caption, setCaption] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [shareCount, setShareCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (link.data) setShareCount(link.data.shareCount)
  }, [link.data])

  const offline = isNetworkError(link.error)
  const missing = isNotFound(link.error) || isNotFound(post.error)
  const disabled = cooldown > 0 || offline

  const record = async () => {
    try {
      const res: any = await api.posts.recordShare(id, caption.trim() || undefined)
      /* The SSE frame is actor-skipped for us, so the local bump is the only
         one that will ever arrive — no double count. */
      setShareCount(n => (typeof res?.shareCount === 'number' ? res.shareCount : (n ?? 0) + 1))
    } catch (e) {
      if (isRateLimited(e)) startCooldown(e)
      toast.error(errorText(e))
    }
  }

  const copy = async () => {
    const url = link.data?.shortUrl || link.data?.canonicalUrl
    if (!url) return
    await Clipboard.setStringAsync(url)
    fireHaptic('success')
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
    await record()
  }

  const shareVia = async () => {
    const url = link.data?.shortUrl || link.data?.canonicalUrl
    if (!url) return
    const message = caption.trim() ? `${caption.trim()}\n${url}` : url
    const res = await Share.share({ message, url })
    /* A dismissed OS sheet is not a share. */
    if (res.action === Share.sharedAction) await record()
  }

  const tiles: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }[] = [
    { icon: 'copy', label: copied ? 'Copied' : 'Copy link', onPress: () => { void copy() }, disabled: !link.data },
    { icon: 'share', label: 'Share via…', onPress: () => { void shareVia() }, disabled: disabled || !link.data },
    {
      icon: 'chat',
      label: 'Send in a message',
      /* The chat share sheet does its own recording once a send actually
         lands (one ledger row per share action, not per recipient) — this
         tile records nothing, exactly like a dismissed OS sheet. */
      onPress: () => {
        const url = link.data?.shortUrl || link.data?.canonicalUrl
        if (!url) return
        router.push({
          pathname: '/chat/share',
          params: {
            url,
            kind: 'post',
            recordId: id,
            caption: caption.trim(),
            label: post.data?._author?.full ? `Post by ${post.data._author.full}` : 'Post',
          },
        })
      },
      disabled: offline || !link.data,
    },
    {
      icon: 'repost',
      label: 'Repost',
      onPress: () => { router.back(); setTimeout(() => router.push({ pathname: '/compose', params: { sharedPostId: id } }), 90) },
      disabled: offline,
    },
    {
      icon: 'add',
      label: 'Share to story',
      /* The composer takes a LINKED frame as four loose params — linkType is
         what it uppercases into `storyType`, so it has to spell one of
         stories.md's canonical types. `sharePostId` (what this tile used to
         send) is read by nobody: the composer opened empty and the post was
         silently dropped. Media is optional — a text post shares as a card
         with no thumb. */
      onPress: () => router.push({
        pathname: '/story/compose',
        params: {
          linkType: 'LINKED_POST',
          mediaUrl: sharedAssetPath(post.data?.media?.[0]?.url) ?? '',
          thumbnailUrl: sharedAssetPath(post.data?.media?.[0]?.poster || post.data?.media?.[0]?.url) ?? '',
          title: post.data?.body?.trim() || (post.data?._author?.full ? `Post by ${post.data._author.full}` : 'A post'),
        },
      }),
      /* Waits on the post read, not the link read: the params come from
         post.data. Same guard the Copy tile puts on link.data. */
      disabled: offline || !post.data,
    },
  ]

  return (
    <Screen background="elevated">
      <Header closeButton title="Share" />

      {missing ? (
        <View style={styles.gone}>
          <Text variant="title3" align="center">This post is no longer available</Text>
          <Button label="Close" onPress={() => router.back()} variant="tinted" style={{ marginTop: space.lg }} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* A preview, not a link: the sheet has cost the author nothing yet. */}
          <View style={[styles.preview, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.md }]}>
            <Avatar uri={post.data?._author?.profileImage} name={post.data?._author?.full} seed={post.data?.author} size={32} />
            <View style={styles.flex}>
              <Text variant="subhead" weight="600" numberOfLines={1}>{post.data?._author?.full || '…'}</Text>
              <Text variant="footnote" tone="muted" numberOfLines={1}>{post.data?.body || ' '}</Text>
            </View>
            {post.data?.media?.[0]?.url ? (
              <Image
                source={{ uri: post.data.media[0].poster || post.data.media[0].url }}
                style={[styles.thumb, { borderRadius: t.radius.xs, backgroundColor: c.surface }]}
                contentFit="cover"
              />
            ) : null}
          </View>

          {link.error && !missing ? (
            <Callout tone={offline ? 'warning' : 'danger'} style={styles.strip}>
              {offline ? "You're offline — only Copy link will work." : errorText(link.error)}
            </Callout>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
            {tiles.map(tile => (
              <Touchable
                key={tile.label}
                onPress={tile.onPress}
                disabled={tile.disabled}
                feedback="scale"
                haptic="light"
                style={styles.tile}
              >
                <View style={[styles.tileCircle, { backgroundColor: c.surfaceSunken }]}>
                  <Icon name={tile.icon} size={22} color={c.text} />
                </View>
                <Text variant="caption" tone="secondary" align="center" numberOfLines={2} weight="500">{tile.label}</Text>
              </Touchable>
            ))}
          </ScrollView>

          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Say something about this…"
            placeholderTextColor={c.textFaint}
            multiline
            allowFontScaling={false}
            style={[
              styles.caption,
              {
                color: c.text,
                backgroundColor: c.surfaceSunken,
                borderRadius: t.radius.sm,
                fontSize: t.type.callout.fontSize,
                lineHeight: t.type.callout.lineHeight,
              },
            ]}
          />

          <View style={styles.footer}>
            {shareCount === null ? (
              <Skeleton width={64} height={12} />
            ) : (
              <Text variant="footnote" tone="muted" style={styles.flex}>
                <NumericText variant="footnote" tone="secondary">{formatCount(shareCount)}</NumericText> shares
              </Text>
            )}
            <Touchable onPress={() => router.push(`/post/${id}/shares`)} feedback="dim" noAutoHitSlop>
              <Text variant="footnote" tone="accent">View who shared</Text>
            </Touchable>
          </View>

          {cooldown > 0 ? (
            <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.sm2 }}>
              Wait {cooldown}s before sharing again
            </Text>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gone: { padding: space.xxxl, alignItems: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, margin: space.lg, padding: space.sm2 },
  thumb: { width: 44, height: 44 },
  strip: { marginHorizontal: space.lg, marginBottom: space.xs },
  tiles: { paddingHorizontal: space.lg, gap: space.md2, paddingVertical: space.sm },
  tile: { width: 68, alignItems: 'center', gap: space.sm },
  tileCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  caption: { marginHorizontal: space.lg, marginTop: space.md2, minHeight: 62, padding: space.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg },
})
