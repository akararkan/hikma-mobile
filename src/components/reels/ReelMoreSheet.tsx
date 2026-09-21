/* =========================================================
   The '⋯' menu.

   Deliberately has NO "not interested": the platform exposes
   no reel-level negative-feedback endpoint, and a control that
   quietly does nothing is worse than its absence.

   "Why am I seeing this?" is not a placeholder either — the
   ranking formula is documented, so the explainer states it
   rather than waving at "your activity".
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { REPORT_REASONS, api, errorText } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { ActionSheet, Button, ConfirmSheet, Sheet, Text, toast, useSheetState } from '@/ui'
import { notePostDeleted } from '@/components/feed/postTombstones'
import { setback, shape, space } from '@/theme/tokens'
import { useTheme } from '@/theme/ThemeProvider'
import { sharedAssetPath } from '@/components/stories/storyVisual'
import type { ViewPost } from './types'

export interface ReelMoreSheetProps {
  visible: boolean
  onClose: () => void
  post: ViewPost | null
  isMine: boolean
  isFollowing: boolean | null
  onDeleted: (id: string) => void
  /** The edited post, merged back into the pager's list. */
  onEdited: (post: ViewPost) => void
  onShare: () => void
  onUnfollow: () => void
}

export function ReelMoreSheet({
  visible, onClose, post, isMine, isFollowing, onDeleted, onEdited, onShare, onUnfollow,
}: ReelMoreSheetProps) {
  const t = useTheme()
  const router = useRouter()
  const report = useSheetState()
  const why = useSheetState()
  const confirmDelete = useSheetState()
  const editSheet = useSheetState()
  const [deleting, setDeleting] = React.useState(false)
  const [reporting, setReporting] = React.useState<string | null>(null)
  const [caption, setCaption] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [blocked, setBlocked] = React.useState<string | null>(null)

  const openEditor = () => {
    setCaption(post?.body ?? '')
    setBlocked(null)
    editSheet.open()
  }

  const saveCaption = async () => {
    if (!post) return
    setSaving(true)
    setBlocked(null)
    try {
      const updated = await api.posts.edit(post.id, { textContent: caption.trim() })
      onEdited(updated as ViewPost)
      editSheet.close()
      toast.ok('Caption updated')
    } catch (e: any) {
      /* A refusal keeps the draft and offers no retry — resubmitting the same
         words can only fail the same way. */
      if (isBlocked(e)) setBlocked(moderationText(e))
      else toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  /* The sheet and /story/compose are both modals, so the sheet has to be gone
     before the composer is pushed — the same close-then-push beat the post
     share sheet uses for Repost. The composer takes the frame as four loose
     params; sharedAssetPath keeps the url the backend's own relative path so
     every viewer resolves it against their own host. */
  const shareToStory = () => {
    if (!post) return
    onClose()
    setTimeout(() => {
      router.push({
        pathname: '/story/compose',
        params: {
          linkType: 'LINKED_REEL',
          mediaUrl: sharedAssetPath(post.media?.[0]?.url) ?? '',
          thumbnailUrl: sharedAssetPath(post.media?.[0]?.poster || post.media?.[0]?.url) ?? '',
          title: post.body?.trim() || (post._author?.full ? `Reel by ${post._author.full}` : 'A reel'),
        },
      } as any)
    }, 90)
  }

  const copyLink = async () => {
    if (!post) return
    try {
      const link = await api.posts.shareLink(post.id)
      await Clipboard.setStringAsync(link?.shortUrl || link?.canonicalUrl || '')
      toast.ok('Link copied')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  /* Into the chat share sheet — reels are posts, so the post short link is
     the reel short link, and the sheet's own recordShare covers the ledger. */
  const sendInMessage = async () => {
    if (!post) return
    try {
      const link = await api.posts.shareLink(post.id)
      const url = link?.shortUrl || link?.canonicalUrl
      if (!url) return
      router.push({
        pathname: '/chat/share',
        params: {
          url,
          kind: 'post',
          recordId: post.id,
          label: post._author?.full ? `Reel by ${post._author.full}` : 'Reel',
        },
      })
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const submitReport = async (reason: string) => {
    if (!post) return
    setReporting(reason)
    try {
      /* targetRef is the MESSAGE-only Snowflake channel — a POST id is a UUID
         and rides in targetId (settings.js safety.report). */
      await api.settings.safety.report({ targetType: 'POST', targetId: post.id, targetRef: undefined, reason, details: undefined })
      report.close()
      /* An existing open report for the same (target, reason) comes back as-is,
         so the confirmation is identical either way — by design. */
      toast.ok("Thanks, we'll review it")
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setReporting(null)
    }
  }

  const remove = async () => {
    if (!post) return
    setDeleting(true)
    try {
      await api.posts.remove(post.id)
      confirmDelete.close()
      /* A reel IS a post, so the feed, the profile grid and the saved lists
         are all holding this row too — the pager's own onDeleted reaches
         none of them. */
      notePostDeleted(post.id)
      onDeleted(post.id)
      toast.ok('Reel deleted')
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <ActionSheet
        visible={visible}
        onClose={onClose}
        actions={[
          { label: 'Copy link', icon: 'link', onPress: copyLink },
          { label: 'Send in a message', icon: 'chat', onPress: () => { void sendInMessage() } },
          { label: 'Share to…', icon: 'share', onPress: onShare },
          post ? { label: 'Share to story', icon: 'add', onPress: shareToStory } : null,
          { label: 'Why am I seeing this?', icon: 'info', onPress: () => why.open() },
          !isMine && isFollowing
            ? { label: `Unfollow @${post?._author.handle ?? ''}`, icon: 'personRemove', onPress: onUnfollow }
            : null,
          !isMine ? { label: 'Report', icon: 'flag', destructive: true, onPress: () => report.open() } : null,
          isMine ? { label: 'Edit caption', icon: 'edit', onPress: openEditor } : null,
          isMine
            ? { label: 'Delete reel', icon: 'trash', destructive: true, onPress: () => confirmDelete.open() }
            : null,
        ]}
      />

      <ActionSheet
        visible={report.visible}
        onClose={report.close}
        title="Report this reel"
        subtitle="Reports are confidential. The author is never told who reported them."
        actions={(REPORT_REASONS as string[][]).map(([value, label]) => ({
          label,
          disabled: !!reporting,
          onPress: () => { void submitReport(value) },
        }))}
      />

      <Sheet visible={why.visible} onClose={why.close} title="Why am I seeing this?">
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.xs2, gap: space.md }}>
          <Text variant="callout" tone="secondary" align="ui">
            For You ranks every reel by how people engaged with it — a reaction counts three times,
            a comment twice, and a view once.
          </Text>
          <Text variant="callout" tone="secondary" align="ui">
            That score decays over 48 hours, so a reel posted this morning outranks a reel with the
            same engagement from last week.
          </Text>
          <Text variant="callout" tone="secondary" align="ui">
            Reels from accounts you follow get a 1.5× boost. Nothing else — no interests profile,
            no watch-time model.
          </Text>
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs, marginBottom: space.sm }}>
            {post?.source === 'EXPLORE'
              ? 'This one came from Explore: you don’t follow the author.'
              : post?.source === 'FOLLOWING'
                ? 'This one is from someone you follow.'
                : 'Ranking data for this reel is not available.'}
          </Text>
          <Button label="Done" onPress={why.close} variant="secondary" block size="lg" style={{ marginBottom: t.space.sm }} />
        </View>
      </Sheet>

      <Sheet visible={editSheet.visible} onClose={editSheet.close} title="Edit caption" maxHeightRatio={0.7}>
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm2, gap: space.md }}>
          <TextInput
            value={caption}
            onChangeText={v => { setCaption(v.slice(0, 2200)); if (blocked) setBlocked(null) }}
            placeholder="Write a caption…"
            placeholderTextColor={t.colors.textFaint}
            selectionColor={t.colors.cta}
            multiline
            autoFocus
            style={[
              styles.editInput,
              {
                color: t.colors.text,
                backgroundColor: t.colors.surfaceSunken,
                fontSize: t.type.body.fontSize,
                lineHeight: t.type.body.lineHeight,
              },
            ]}
          />
          <Text variant="caption" tone="faint" align={t.isRTL ? 'left' : 'right'}>{caption.length}/2200</Text>
          {blocked ? <Text variant="footnote" tone="danger" align="ui">{blocked}</Text> : null}
          <Button label="Save" onPress={saveCaption} variant="onDark" size="lg" block loading={saving} />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this reel?"
        message="It disappears for everyone, and its views, likes and comments go with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </>
  )
}

const styles = StyleSheet.create({
  /* A field well, so it wears the field setback (10/0) rather than a uniform
     radius — the flat base is what the baseline rule sits on. */
  editInput: {
    minHeight: 120,
    ...setback(shape.field),
    borderCurve: 'continuous',
    padding: space.md2,
    textAlignVertical: 'top',
  },
})
