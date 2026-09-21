/* =========================================================
   The channel.

   A channel IS a conversation, so the feed is `chat.messages`
   walked backwards from newest with the cursor the server hands
   back — the cursor is the OLDEST snowflake in the page and it
   stays a string the whole way round.

   The realtime rules that shape this file, all from the SSE
   contract: frames carry DELTAS, never totals, so subscriberCount
   and postCount move by ±1 locally; `poll.updated` is
   viewer-neutral and must not overwrite the viewer's own votes;
   `message.comment` carries the POST's id; and every `connected`
   is a reconcile, not a hello — anything emitted while the
   socket was down is gone, so the gap is filled with
   `messages.sync` and the two records are re-read over REST.
   ========================================================= */
import React from 'react'
import { RefreshControl, Share, StyleSheet, View } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { api, codeOf, errorText, isNetworkError, isNotFound } from '@/api'
import { cmpId, gtId } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Callout, ConfirmSheet, EmptyState, ErrorState, Header,
  Icon, ListFooter, Screen, SkeletonCard, Skeleton, Text, Touchable, fireHaptic,
  toast, useSheetState,
} from '@/ui'
import { ChannelHeader } from '@/components/channels/ChannelHeader'
import { ChannelPostCard, applyReactionDelta } from '@/components/channels/ChannelPostCard'
import { PostMenuSheet } from '@/components/channels/PostMenuSheet'
import { useChatActions } from '@/context/ChatContext'
import { ReportSheet } from '@/components/channels/ReportSheet'
import { mergePollFrame } from '@/components/channels/PollCard'
import { GoneCard, TopStrip } from '@/components/channels/states'
import { useChannelRights, useChannelStream, usePostViews } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

type Row =
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'system'; key: string; post: any }
  | { kind: 'post'; key: string; post: any }

/* Module scope. FlashList's ViewHolder memo compares keyExtractor/renderItem
   by identity, and the recycle pools are keyed by item type — three row shapes
   share one pool without this, so an unread divider's React key gets handed to
   a post card and the whole media grid unmounts instead of swapping props. */
const keyExtractor = (r: Row) => r.key
const getItemType = (r: Row) => r.kind

export default function ChannelScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const listRef = React.useRef<FlashListRef<Row>>(null)
  const [scrolled, setScrolled] = React.useState(false)
  const [deleted, setDeleted] = React.useState(false)
  const [frozen, setFrozen] = React.useState<string | null>(null)
  const [pinIndex, setPinIndex] = React.useState(0)

  const rights = useChannelRights(id)
  const channel = rights.channel
  const convo = useAsync<any>(() => api.chat.conversations.get(id), { enabled: !!id, deps: [id] })
  const pinned = useAsync<any[]>(() => api.chat.messages.pinned(id), { enabled: !!id, deps: [id] })

  const feed = usePaged<any>(
    async ({ cursor, pageSize }) => {
      const res = await api.chat.messages.page(id, args({ cursor, limit: pageSize }))
      /* `nextCursor: null` means start-of-history reached (posts.md). usePaged's
         legacy fallback would then derive a createdAt cursor from the last row
         and page for ever with a timestamp where a Snowflake belongs — an empty
         string survives that fallback and still reads as "done". */
      return { ...res, nextCursor: res.hasMore && res.nextCursor != null ? String(res.nextCursor) : '' }
    },
    { mode: 'cursor', pageSize: 30, enabled: !!id, deps: [id], keyOf: (m: any) => String(m.id) },
  )

  const views = usePostViews(id)
  const menu = useSheetState<any>()
  const fabMenu = useSheetState()
  const membership = useSheetState()
  const report = useSheetState<any>()
  const confirmDelete = useSheetState<any>()
  const confirmHide = useSheetState<any>()
  const forward = useSheetState<any>()

  const notMember = feed.error?.status === 403 && !channel?.subscribed
  const offline = isNetworkError(feed.error) || isNetworkError(rights.error)

  const newestId = feed.items.length ? feed.items[0].id : null
  const lastRead = convo.data?.lastReadMessageId ?? null

  /* ---- read marker: the newest row being loaded IS having seen it ---- */
  const markedRead = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!id || !newestId || markedRead.current === newestId) return
    markedRead.current = newestId
    api.chat.conversations.read(id, newestId)
      .then(() => convo.setData((prev: any) => (prev ? { ...prev, unreadCount: 0 } : prev)))
      .catch(() => {})
  }, [id, newestId])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- realtime ---- */

  const patchPost = React.useCallback((messageId: string, fn: (p: any) => any) => {
    feed.patch(String(messageId), fn)
  }, [feed.patch])   // eslint-disable-line react-hooks/exhaustive-deps

  useChannelStream(id, {
    onMessage: e => {
      const msg = e.message
      if (!msg) return
      feed.setItems(prev => {
        if (prev.some(p => p.id === msg.id)) return prev
        /* The sender's own optimistic bubble is matched on clientNonce — the
           echo is the same post, not a second one. */
        const nonce = msg.clientNonce
        const without = nonce ? prev.filter(p => p.clientNonce !== nonce) : prev
        return [msg, ...without]
      })
      rights.setChannel((prev: any) => (prev ? { ...prev, postCount: (prev.postCount || 0) + 1 } : prev))
      if (id) void api.chat.conversations.read(id, msg.id).catch(() => {})
    },
    onEdited: e => patchPost(e.messageId!, p => ({ ...p, body: e.body, editedAt: e.editedAt })),
    onDeleted: e => {
      feed.remove(String(e.messageId))
      rights.setChannel((prev: any) => (prev ? { ...prev, postCount: Math.max(0, (prev.postCount || 1) - 1) } : prev))
      pinned.setData(prev => (prev || []).filter(p => p.id !== e.messageId))
    },
    onReaction: e => patchPost(e.messageId!, p => ({
      ...p,
      reactions: applyReactionDelta(p.reactions, { emoji: e.emoji, added: !!e.added, mine: e.userId === user?.id }),
    })),
    onPoll: e => patchPost(e.messageId!, p => (p.poll ? { ...p, poll: mergePollFrame(p.poll, e.poll) } : p)),
    onComment: e => patchPost(e.messageId!, p => ({
      ...p,
      comments: Math.max(0, (p.comments ?? 0) + (e.added ? 1 : -1)),
    })),
    onMember: e => {
      rights.setChannel((prev: any) => {
        if (!prev) return prev
        /* PROMOTED / DEMOTED ride this same frame but are role changes, not
           membership deltas — only a join/leave moves the count. */
        const delta = e.memberChange === 'UNSUBSCRIBED' ? -1
          : (e.memberChange === 'SUBSCRIBED' || e.memberChange === 'ADDED') ? 1 : 0
        if (!delta) return prev
        return { ...prev, subscriberCount: Math.max(0, (prev.subscriberCount || 0) + delta) }
      })
      if (e.memberChange === 'UNSUBSCRIBED' && e.userId === user?.id) router.replace(chRoute.index())
    },
    onConversation: e => {
      if (e.memberChange === 'DELETED') { setDeleted(true); return }
      rights.reload()
    },
    onReconcile: () => {
      rights.reload()
      void convo.refresh()
      if (id && newestId) {
        api.chat.messages.sync(id, newestId, 100)
          .then((rows: any[]) => {
            if (!rows?.length) return
            feed.setItems(prev => {
              const known = new Set(prev.map(p => String(p.id)))
              const fresh = rows.filter(r => !known.has(String(r.id))).sort((a, b) => cmpId(b.id, a.id))
              return fresh.length ? [...fresh, ...prev] : prev
            })
          })
          .catch(() => {})
      }
    },
  })

  /* ---- post actions ---- */

  const guard = (e: any) => {
    if (codeOf(e) === 'CHANNEL_FROZEN') setFrozen(errorText(e))
    toast.error(errorText(e))
  }

  const react = async (post: any, emoji: string) => {
    try {
      const fresh = await api.chat.messages.react(post.id, emoji)
      patchPost(post.id, p => ({ ...p, reactions: fresh }))
    } catch (e) { guard(e) }
  }
  const unreact = async (post: any) => {
    try {
      const fresh = await api.chat.messages.unreact(post.id)
      patchPost(post.id, p => ({ ...p, reactions: fresh }))
    } catch (e) { guard(e) }
  }
  const vote = async (post: any, indexes: number[]) => {
    try {
      const poll = await api.chat.messages.vote(post.id, indexes)
      patchPost(post.id, p => ({ ...p, poll }))
    } catch (e) { guard(e) }
  }
  const retract = async (post: any) => {
    try {
      const poll = await api.chat.messages.retractVote(post.id)
      patchPost(post.id, p => ({ ...p, poll }))
    } catch (e) { guard(e) }
  }
  const closePoll = async (post: any) => {
    try {
      const poll = await api.chat.messages.closePoll(post.id)
      patchPost(post.id, p => ({ ...p, poll }))
    } catch (e) { guard(e) }
  }
  const togglePin = async (post: any) => {
    const isPinned = (pinned.data || []).some(p => p.id === post.id)
    try {
      if (isPinned) await api.chat.messages.unpin(id, post.id)
      else await api.chat.messages.pin(id, post.id)
      void pinned.reload()
    } catch (e) { guard(e) }
  }
  const toggleStar = async (post: any) => {
    patchPost(post.id, p => ({ ...p, starred: !p.starred }))
    try { post.starred ? await api.chat.messages.unstar(post.id) : await api.chat.messages.star(post.id) }
    catch (e) { patchPost(post.id, p => ({ ...p, starred: post.starred })); guard(e) }
  }
  const remove = async (post: any) => {
    feed.remove(String(post.id))
    try { await api.chat.messages.remove(post.id, 'everyone') }
    catch (e) { void feed.refresh(); guard(e) }
  }
  /* scope=me — a reader's own copy only. The server broadcasts nothing for
     this, so the optimistic drop IS the update and there is nothing to
     reconcile. */
  const hide = async (post: any) => {
    feed.remove(String(post.id))
    try { await api.chat.messages.remove(post.id, 'me') }
    catch (e) { void feed.refresh(); guard(e) }
  }
  const shareLink = async () => {
    if (!channel?.shareUrl) return
    try { await Share.share({ message: channel.shareUrl, url: channel.shareUrl }) } catch { /* dismissed */ }
  }
  /* The header's Share now offers the in-app path too — private channels
     carry no shareUrl (channels/overview.md: null) so the sheet never opens
     for them, same gate the header button already applies. */
  const shareSheet = useSheetState()

  /* ---- rows ---- */

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = []
    const unreadCount = feed.items.filter(p => gtId(p.id, lastRead)).length
    let dividerPlaced = !lastRead || !unreadCount || unreadCount === feed.items.length
    for (const post of feed.items) {
      if (!dividerPlaced && !gtId(post.id, lastRead)) {
        out.push({ kind: 'unread', key: 'unread-divider', count: unreadCount })
        dividerPlaced = true
      }
      out.push({ kind: post.isSystem ? 'system' : 'post', key: String(post.id), post })
    }
    return out
  }, [feed.items, lastRead])

  const pinnedRows = pinned.data || []
  const activePin = pinnedRows[pinIndex % Math.max(1, pinnedRows.length)]
  const hasPin = !!activePin

  /* ---- row plumbing ----
     Every handler below is identity-stable and takes the post as its first
     argument, so ONE function serves the whole feed. That is what keeps
     `renderItem` stable across a realtime frame — and a stable renderItem is
     what stops FlashList re-invoking it for every mounted card. */

  const openPost = useEvent((post: any) => router.push(chRoute.post(id, String(post.id))))
  /* A tap on a picture or a clip opens IT, full-bleed — not the post page
     around it. The post page is one more tap away from the viewer's sheet. */
  const openMedia = useEvent((post: any, index: number) => router.push(chRoute.viewer(id, String(post.id), {
    index, title: channel?.title, protected: !!channel?.settings?.protectedContent,
  })))
  const onTagPress = useEvent((tag: string) => router.push(chRoute.tag(id, tag)))
  const onMentionPress = useEvent((handle: string) => router.push(chRoute.user(handle)))
  const onReactPost = useEvent((post: any, emoji: string) => { void react(post, emoji) })
  const onUnreactPost = useEvent((post: any) => { void unreact(post) })
  const onVotePost = useEvent((post: any, indexes: number[]) => vote(post, indexes))
  const onRetractPost = useEvent((post: any) => retract(post))
  const onClosePollPost = useEvent((post: any) => closePoll(post))
  const onMenuPost = useEvent((post: any) => { fireHaptic('medium'); menu.open(post) })

  const canClosePoll = rights.can('canEditMessages')
  const myAdminRow = rights.myAdminRow

  /* Stable identities for the remaining list props — an inline arrow here is
     a fresh prop on every render, which is exactly what the cell memo tests. */
  const onEndReached = useEvent(() => { if (!offline) feed.loadMore() })
  const onScroll = useEvent((e: any) => {
    const past = e.nativeEvent.contentOffset.y > 150
    if (past !== scrolled) setScrolled(past)
  })
  const listPad = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 96 }),
    [insets.bottom],
  )

  const renderItem = React.useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'unread') {
      return (
        <View style={styles.unreadRow}>
          <View style={[styles.hair, { backgroundColor: c.accent }]} />
          <View style={[styles.unreadPill, { backgroundColor: c.accentSoft }]}>
            <Text variant="caption" tone="accent">{item.count} new {item.count === 1 ? 'post' : 'posts'}</Text>
          </View>
          <View style={[styles.hair, { backgroundColor: c.accent }]} />
        </View>
      )
    }
    if (item.kind === 'system') {
      return (
        <View style={styles.systemRow}>
          <Text variant="caption" tone="faint" align="center">{item.post.body || item.post.systemEvent}</Text>
        </View>
      )
    }
    return (
      <PostRow
        post={item.post}
        channel={channel}
        myAdminRow={myAdminRow}
        canClosePoll={canClosePoll}
        onOpen={openPost}
        onOpenMedia={openMedia}
        onReact={onReactPost}
        onUnreact={onUnreactPost}
        onVote={onVotePost}
        onRetractVote={onRetractPost}
        onClosePoll={onClosePollPost}
        onMenu={onMenuPost}
        onTagPress={onTagPress}
        onMentionPress={onMentionPress}
      />
    )
  }, [
    c, channel, myAdminRow, canClosePoll, openPost, onReactPost, onUnreactPost,
    onVotePost, onRetractPost, onClosePollPost, onMenuPost, onTagPress, onMentionPress,
  ])

  /* The header carries the cover image, the stat row and the subscribe CTA —
     the heaviest thing on the screen. Passed by reference so a scroll tick or
     an unrelated re-render does not rebuild it. */
  const listHeader = React.useMemo(() => (
    <>
      <ChannelHeader
        channel={channel}
        convo={convo.data}
        myAdminRow={myAdminRow}
        onSubscribe={next => rights.setChannel(next)}
        onOpenMembership={() => membership.open()}
        onMute={() => membership.open()}
        onShare={() => shareSheet.open()}
        onPost={() => router.push(chRoute.compose(id))}
        onStats={() => router.push(chRoute.stats(id))}
        onManage={() => router.push(chRoute.info(id))}
        onMedia={() => router.push(chRoute.media(id))}
        onMembers={() => router.push(chRoute.subscribers(id))}
        onPressAvatar={() => router.push(chRoute.info(id))}
        onPressHandle={async () => {
          if (!channel?.shareUrl) return
          await Clipboard.setStringAsync(channel.shareUrl)
          toast.ok('Link copied')
        }}
      />
      {offline ? <TopStrip tone="neutral">You’re offline — showing the last loaded posts.</TopStrip> : null}
      {frozen ? <TopStrip tone="warning">{frozen}</TopStrip> : null}
      {hasPin ? <View style={styles.pinSpacer} /> : null}
    </>
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  ), [channel, convo.data, myAdminRow, offline, frozen, hasPin, id])

  /* ---- terminal states ---- */

  if (deleted) {
    return (
      <Screen>
        <Header back title="Channel" />
        <GoneCard title="This channel was deleted" message="Its posts are no longer available." onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  if (rights.error && isNotFound(rights.error)) {
    return (
      <Screen>
        <Header back title="Channel" />
        <GoneCard onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  if (rights.loading && !channel) {
    return (
      <Screen>
        <Header back title="" />
        <Skeleton height={200} radius={0} />
        <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
          <Skeleton width="55%" height={20} />
          <Skeleton width="35%" height={12} />
        </View>
        <SkeletonCard />
        <SkeletonCard />
      </Screen>
    )
  }

  if (rights.error) {
    return (
      <Screen>
        <Header back title="Channel" />
        <ErrorState error={rights.error} onRetry={rights.reload} />
      </Screen>
    )
  }

  const canPost = rights.can('canPostMessages')

  return (
    <Screen>
      <Header
        floating
        overlay={!scrolled}
        translucent={scrolled}
        border={false}
        back
        titleNode={scrolled ? (
          <View style={styles.miniTitle}>
            <Avatar uri={channel?.avatarUrl} name={channel?.title} seed={channel?.id} size={26} square />
            <Text variant="headline" numberOfLines={1} align="ui" style={styles.shrink}>{channel?.title}</Text>
          </View>
        ) : <View />}
        actions={[
          { icon: 'search', onPress: () => router.push(chRoute.search(id)), label: 'Search in channel' },
          { icon: 'more', onPress: () => membership.open(), label: 'More' },
        ]}
      />

      {/* The pinned bar sits under the nav bar rather than inside the list:
          it must survive the cover scrolling away, and a sticky data row
          would disappear with it. */}
      {activePin ? (
        <View style={[styles.pinBar, { top: insets.top + t.layout.headerHeight, backgroundColor: c.headerBg, borderBottomColor: c.separator }]}>
          <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: c.accent, borderRadius: 2 }} />
          <Icon name="pin" size={15} color={c.accent} />
          <Touchable
            onPress={() => setPinIndex(i => (i + 1) % pinnedRows.length)}
            feedback="dim"
            noAutoHitSlop
            style={styles.flex}
          >
            <Text variant="footnote" numberOfLines={1} align="auto">{previewOf(activePin)}</Text>
          </Touchable>
          <Touchable onPress={() => router.push(chRoute.pinned(id))} feedback="dim" noAutoHitSlop>
            <Text variant="caption" tone="muted">
              {(pinIndex % pinnedRows.length) + 1}/{pinnedRows.length}
            </Text>
          </Touchable>
        </View>
      ) : null}

      <FlashList
        ref={listRef}
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        extraData={`${channel?.settings?.reactionsEnabled}:${pinnedRows.length}`}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          feed.loading ? (
            <View><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></View>
          ) : notMember ? (
            <View style={{ padding: t.layout.screenPadding }}>
              <Callout tone="info" icon="lock" title="Subscribe to read this channel">
                {errorText(feed.error)}
              </Callout>
            </View>
          ) : feed.error && !isNetworkError(feed.error) ? (
            <ErrorState error={feed.error} onRetry={feed.reload} />
          ) : canPost ? (
            <EmptyState
              icon="edit"
              title="Nothing posted yet"
              message="Your first post goes out to every subscriber."
              actionLabel="Write the first post"
              onAction={() => router.push(chRoute.compose(id))}
            />
          ) : (
            <EmptyState icon="channels" title="No posts yet" message="You’ll see them here." />
          )
        }
        ListFooterComponent={
          feed.items.length ? (
            <ListFooter
              loading={feed.loadingMore}
              error={feed.loadingMore ? null : feed.error}
              onRetry={feed.loadMore}
              done={feed.done}
              doneLabel="Beginning of the channel"
            />
          ) : null
        }
        onViewableItemsChanged={views.onViewableItemsChanged}
        viewabilityConfig={views.viewabilityConfig}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        onScroll={onScroll}
        scrollEventThrottle={32}
        /* Channel cards carry media and run 200–400pt tall; the platform
           default of 250px prepares barely one cell ahead of the viewport, so
           a fast fling outruns the render stack. */
        drawDistance={600}
        contentContainerStyle={listPad}
        refreshControl={
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={() => { void feed.refresh(); void rights.refresh(); void convo.refresh(); void pinned.refresh() }}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressViewOffset={insets.top + 40}
          />
        }
      />

      {canPost ? (
        <Touchable
          onPress={() => router.push(chRoute.compose(id))}
          onLongPress={() => { fireHaptic('medium'); fabMenu.open() }}
          disabled={!!frozen || offline}
          feedback="scale"
          haptic="medium"
          accessibilityLabel="Write a post"
          /* ComposeFab (DESIGN §6): setback 18/8 plate, 1px accentPressed
             border, letterpress on press — no glow, no shadow. */
          style={[
            styles.fab,
            { bottom: insets.bottom + 24, backgroundColor: c.accent, borderColor: c.accentPressed },
          ]}
        >
          <Icon name="edit" size={24} color={c.textOnAccent} />
        </Touchable>
      ) : null}

      <ActionSheet
        visible={shareSheet.visible}
        onClose={shareSheet.close}
        title="Share channel"
        actions={[
          {
            label: 'Copy link',
            icon: 'link',
            hidden: !channel?.shareUrl,
            onPress: async () => { await Clipboard.setStringAsync(channel!.shareUrl!); toast.ok('Link copied') },
          },
          {
            label: 'Send in a message',
            icon: 'chat',
            hidden: !channel?.shareUrl,
            onPress: () => router.push({
              pathname: '/chat/share',
              params: { url: channel!.shareUrl!, kind: 'channel', label: channel?.title || 'Channel' },
            }),
          },
          { label: 'Share via…', icon: 'share', hidden: !channel?.shareUrl, onPress: () => { void shareLink() } },
        ]}
      />

      <PostMenuSheet
        visible={menu.visible}
        onClose={menu.close}
        target={{ post: menu.payload, channel, myAdminRow: rights.myAdminRow, meId: user?.id }}
        onComment={() => router.push(chRoute.post(id, String(menu.payload.id)))}
        onCopy={async () => { await Clipboard.setStringAsync(menu.payload?.body || ''); toast.ok('Copied') }}
        onForward={() => forward.open(menu.payload)}
        onShareLink={shareLink}
        onToggleStar={() => void toggleStar(menu.payload)}
        onTogglePin={() => void togglePin(menu.payload)}
        onEdit={() => router.push(chRoute.compose(id, { editId: String(menu.payload.id) }))}
        onDelete={() => confirmDelete.open(menu.payload)}
        onHide={() => confirmHide.open(menu.payload)}
        onReport={() => report.open(menu.payload)}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this post?"
        message="It disappears for every subscriber. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { const p = confirmDelete.payload; confirmDelete.close(); void remove(p) }}
      />

      {/* Deliberately NOT the delete wording: this one takes nothing away from
          anybody else, and saying so is the whole difference. */}
      <ConfirmSheet
        visible={confirmHide.visible}
        onClose={confirmHide.close}
        title="Hide this post?"
        message="It disappears from your view of this channel. Everyone else keeps it."
        confirmLabel="Hide"
        destructive
        onConfirm={() => { const p = confirmHide.payload; confirmHide.close(); void hide(p) }}
      />

      <ActionSheet
        visible={fabMenu.visible}
        onClose={fabMenu.close}
        title="New post"
        actions={[
          { label: 'Photo or video', icon: 'image', onPress: () => router.push(chRoute.compose(id, { preset: 'photo' })) },
          { label: 'Poll', icon: 'poll', onPress: () => router.push(chRoute.compose(id, { preset: 'poll' })) },
          { label: 'Schedule', icon: 'clock', onPress: () => router.push(chRoute.compose(id, { preset: 'schedule' })) },
        ]}
      />

      <MembershipSheet
        visible={membership.visible}
        onClose={membership.close}
        channel={channel}
        convo={convo.data}
        canManage={rights.can('canChangeInfo')}
        onChanged={() => { void convo.refresh(); rights.reload() }}
        onLeft={() => router.replace(chRoute.index())}
        onReport={() => report.open(null)}
      />

      <ForwardSheet
        visible={forward.visible}
        onClose={forward.close}
        post={forward.payload}
      />

      <ReportSheet
        visible={report.visible}
        onClose={report.close}
        targetType={report.payload ? 'MESSAGE' : 'CHANNEL'}
        targetId={report.payload ? String(report.payload.id) : channel?.id}
        subject={report.payload ? 'This post' : channel?.title}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One post row.

   The card's callbacks are all `() => void`, so the per-post
   closures have to be built SOMEWHERE. Building them here, inside
   the memo boundary, means they are rebuilt only when this post
   actually re-renders — instead of once per post on every render
   of the screen, which is what defeats ChannelPostCard's memo.
   --------------------------------------------------------- */

const PostRow = React.memo(function PostRow({
  post, channel, myAdminRow, canClosePoll,
  onOpen, onOpenMedia, onReact, onUnreact, onVote, onRetractVote, onClosePoll, onMenu,
  onTagPress, onMentionPress,
}: {
  post: any
  channel: any
  myAdminRow: any
  canClosePoll: boolean
  onOpen: (post: any) => void
  onOpenMedia: (post: any, index: number) => void
  onReact: (post: any, emoji: string) => void
  onUnreact: (post: any) => void
  onVote: (post: any, indexes: number[]) => void | Promise<void>
  onRetractVote: (post: any) => void | Promise<void>
  onClosePoll: (post: any) => void | Promise<void>
  onMenu: (post: any) => void
  onTagPress: (tag: string) => void
  onMentionPress: (handle: string) => void
}) {
  const open = React.useCallback(() => onOpen(post), [onOpen, post])
  const openMedia = React.useCallback((i: number) => onOpenMedia(post, i), [onOpenMedia, post])
  const react = React.useCallback((emoji: string) => onReact(post, emoji), [onReact, post])
  const unreact = React.useCallback(() => onUnreact(post), [onUnreact, post])
  const vote = React.useCallback((indexes: number[]) => onVote(post, indexes), [onVote, post])
  const retract = React.useCallback(() => onRetractVote(post), [onRetractVote, post])
  const closePoll = React.useCallback(() => onClosePoll(post), [onClosePoll, post])
  const menu = React.useCallback(() => onMenu(post), [onMenu, post])

  return (
    <View style={styles.postWrap}>
      <ChannelPostCard
        post={post}
        channel={channel}
        myAdminRow={myAdminRow}
        canClosePoll={canClosePoll}
        onPress={open}
        onPressComments={open}
        onReact={react}
        onUnreact={unreact}
        onVote={vote}
        onRetractVote={retract}
        onClosePoll={closePoll}
        onMenu={menu}
        onTagPress={onTagPress}
        onMentionPress={onMentionPress}
        onOpenMedia={openMedia}
      />
    </View>
  )
})

/* ---------------------------------------------------------
   The ⋯ / membership menu
   --------------------------------------------------------- */

function MembershipSheet({
  visible, onClose, channel, convo, canManage, onChanged, onLeft, onReport,
}: {
  visible: boolean
  onClose: () => void
  channel: any
  convo: any
  canManage: boolean
  onChanged: () => void
  onLeft: () => void
  onReport: () => void
}) {
  const router = useRouter()
  const { dropConvo } = useChatActions()
  const id = channel?.id

  const mute = async () => {
    const next = convo?.muted ? null : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString()
    try { await api.chat.conversations.mute(id, next); onChanged() }
    catch (e: any) { toast.error(errorText(e)) }
  }

  const unsubscribe = async () => {
    try {
      /* Through the provider so the chat rail drops this channel's row now,
         rather than when the server's `member.changed` echo lands. */
      await dropConvo(String(id), () => api.channels.unsubscribe(id), 'Could not leave this channel')
      onLeft()
    } catch {
      /* The owner cannot leave their own channel — the server says so, the
         provider has already put the row back and repeated it, and the two
         real alternatives live one screen away. */
    }
  }

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={channel?.title}
      subtitle={channel?.handle ? `@${channel.handle}` : undefined}
      actions={[
        { label: 'Channel info', icon: 'info', onPress: () => router.push(chRoute.info(id)) },
        { label: convo?.muted ? 'Unmute' : 'Mute', icon: convo?.muted ? 'bell' : 'mutedBell', onPress: () => void mute() },
        { label: 'Media, files and links', icon: 'gallery', onPress: () => router.push(chRoute.media(id)) },
        { label: 'Pinned posts', icon: 'pin', onPress: () => router.push(chRoute.pinned(id)) },
        canManage && { label: 'Manage channel', icon: 'settings', onPress: () => router.push(chRoute.edit(id)) },
        { label: 'Report channel', icon: 'flag', onPress: onReport },
        !!channel?.subscribed && !channel?.isOwner && {
          label: 'Unsubscribe', icon: 'logout', destructive: true, onPress: () => void unsubscribe(),
        },
      ]}
    />
  )
}

/* ---------------------------------------------------------
   Forwarding — a conversation picker, hidden entirely when the
   channel protects its content.
   --------------------------------------------------------- */

function ForwardSheet({ visible, onClose, post }: { visible: boolean; onClose: () => void; post: any }) {
  const list = useAsync<any>(() => api.chat.conversations.list({ page: 0, size: 50 }), { enabled: visible, deps: [visible] })
  const [busy, setBusy] = React.useState<string | null>(null)

  const send = async (convId: string) => {
    setBusy(convId)
    try {
      await api.chat.messages.forward(post.id, convId, api.chat.newNonce())
      onClose()
      toast.ok('Forwarded')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title="Forward to"
      actions={(list.data?.items || []).slice(0, 30).map((convo: any) => ({
        label: convo.displayTitle,
        icon: convo.isChannel ? ('channels' as const) : convo.type === 'GROUP' ? ('people' as const) : ('person' as const),
        disabled: busy === convo.id,
        onPress: () => void send(convo.id),
      }))}
    />
  )
}

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

function previewOf(post: any): string {
  if (!post) return ''
  if (post.body) return post.body.replace(/\s+/g, ' ').slice(0, 120)
  const kind = post.media?.[0]?.kind
  if (kind === 'IMAGE') return 'Photo'
  if (kind === 'VIDEO') return 'Video'
  if (post.poll) return post.poll.question || 'Poll'
  return 'Post'
}

const styles = StyleSheet.create({
  miniTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  pinBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 19,
  },
  unreadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.md },
  systemRow: { paddingVertical: space.sm2 },
  postWrap: { marginBottom: space.sm },
  pinSpacer: { height: 44 },
  hair: { flex: 1, height: StyleSheet.hairlineWidth },
  /* "N new posts" is a labelled divider plate, not an unread COUNT badge, so
     it takes the chip setback rather than one of the two sanctioned pills. */
  unreadPill: { paddingHorizontal: space.sm2, paddingVertical: space.xs, ...setback(shape.chip), borderCurve: 'continuous' },
  fab: {
    position: 'absolute',
    end: 20,
    width: 56,
    height: 56,
    ...setback(shape.fab),
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shrink: { flexShrink: 1 },
  flex: { flex: 1 },
})
