/* =========================================================
   The three hooks every channel screen leans on.

   · useChannelRights — `channel.myRole` gives OWNER/ADMIN/MEMBER
     but not the nine granular flags. Those only exist on the
     admins list (any member may read it), so every admin
     affordance in this domain resolves through `can(key)` here
     rather than off `isAdmin`.

   · useChannelStream — there is NO channel socket. Everything
     multiplexes onto the single per-user chat stream that
     RealtimeContext already owns; opening a second EventSource
     would evict the app's own connection against the per-user
     cap of five emitters. Frames are filtered to one channel,
     and every `connected` is a reconcile rather than a hello.

   · usePostViews — the RN replacement for the web's channel-view
     tracker, which is IntersectionObserver-based and cannot run here.
   ========================================================= */
import React from 'react'
import { api, canRight } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents, useReconcile, type ChatEvent } from '@/context/RealtimeContext'
import { useAsync } from '@/hooks/useAsync'

/* ---------------------------------------------------------
   Rights
   --------------------------------------------------------- */

export interface ChannelRights {
  channel: any | null
  admins: any[]
  myAdminRow: any | null
  /** canRight(myAdminRow, key), with the owner always allowed. */
  can: (key: string) => boolean
  loading: boolean
  error: any
  reload: () => void
  refresh: () => Promise<void>
  setChannel: React.Dispatch<React.SetStateAction<any | null>>
}

export function useChannelRights(channelId?: string | null): ChannelRights {
  const { user } = useAuth()
  const enabled = !!channelId

  const channel = useAsync<any>(() => api.channels.get(channelId as string), { enabled, deps: [channelId] })

  /* A non-member is refused this list. That is an answer, not a failure —
     they hold no rights either way, so an empty roster is the correct shape. */
  const admins = useAsync<any[]>(async () => {
    try { return await api.channels.admins.list(channelId as string) }
    catch (e: any) { if (e?.status === 403) return []; throw e }
  }, { enabled, deps: [channelId] })

  const myAdminRow = React.useMemo(
    () => (admins.data || []).find((r: any) => r.userId === user?.id) ?? null,
    [admins.data, user?.id],
  )

  const isOwner = !!channel.data?.isOwner
  const can = React.useCallback(
    (key: string) => (isOwner ? true : canRight(myAdminRow, key)),
    [isOwner, myAdminRow],
  )

  const reload = React.useCallback(() => { void channel.reload(); void admins.reload() }, [channel.reload, admins.reload])
  const refresh = React.useCallback(async () => { await Promise.all([channel.refresh(), admins.refresh()]) }, [channel.refresh, admins.refresh])

  return {
    channel: channel.data,
    admins: admins.data || [],
    myAdminRow,
    can,
    loading: channel.loading,
    error: channel.error,
    reload,
    refresh,
    setChannel: channel.setData,
  }
}

/* ---------------------------------------------------------
   Realtime
   --------------------------------------------------------- */

export interface ChannelStreamHandlers {
  /** message.new for this conversation. */
  onMessage?: (e: ChatEvent) => void
  onEdited?: (e: ChatEvent) => void
  onDeleted?: (e: ChatEvent) => void
  onReaction?: (e: ChatEvent) => void
  /** poll.updated — VIEWER-NEUTRAL, and its conversationId may be null. */
  onPoll?: (e: ChatEvent) => void
  /** message.comment — `messageId` is the POST's id, never the comment's. */
  onComment?: (e: ChatEvent) => void
  onMember?: (e: ChatEvent) => void
  onConversation?: (e: ChatEvent) => void
  onJoinRequest?: (e: ChatEvent) => void
  /** Every frame, unfiltered — the post detail also watches the linked group. */
  onAny?: (e: ChatEvent) => void
  /** Fired on every (re)connect: re-read via REST, because frames are deltas. */
  onReconcile?: () => void
}

export function useChannelStream(channelId: string | null | undefined, handlers: ChannelStreamHandlers) {
  const ref = React.useRef(handlers)
  ref.current = handlers

  useChatEvents(e => {
    const h = ref.current
    h.onAny?.(e)
    if (!channelId) return
    /* poll.updated and message.comment can arrive with a null conversationId,
       so they are matched on a messageId the screen already holds instead. */
    const loose = e.type === 'poll.updated' || e.type === 'message.comment'
    if (!loose && e.conversationId !== channelId) return
    if (loose && e.conversationId && e.conversationId !== channelId) return

    switch (e.type) {
      case 'message.new': h.onMessage?.(e); break
      case 'message.edited': h.onEdited?.(e); break
      case 'message.deleted': h.onDeleted?.(e); break
      case 'message.reaction': h.onReaction?.(e); break
      case 'poll.updated': h.onPoll?.(e); break
      case 'message.comment': h.onComment?.(e); break
      case 'member.changed': h.onMember?.(e); break
      case 'conversation.updated': h.onConversation?.(e); break
      case 'channel.join_request': h.onJoinRequest?.(e); break
      default: break
    }
  }, !!channelId)

  useReconcile(() => ref.current.onReconcile?.(), !!channelId)
}

/* ---------------------------------------------------------
   View markers
   --------------------------------------------------------- */

export const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50, minimumViewTime: 400 }

/** Collects post ids from list viewability and reports them in batches.
 *  Every failure is swallowed: a view is not worth a toast, and the server
 *  dedupes each (post, viewer) pair anyway, so re-reporting costs nothing. */
export function usePostViews(channelId?: string | null) {
  const seen = React.useRef(new Set<string>())
  const queued = React.useRef<string[]>([])
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = React.useRef(channelId)
  idRef.current = channelId

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const flush = React.useCallback(() => {
    timer.current = null
    const id = idRef.current
    const batch = queued.current.splice(0, 100)
    if (!id || !batch.length) return
    void api.channels.markViews(id, batch).catch(() => {})
  }, [])

  const report = React.useCallback((ids: (string | null | undefined)[]) => {
    let added = false
    for (const raw of ids) {
      const key = raw == null ? '' : String(raw)
      if (!key || seen.current.has(key)) continue
      seen.current.add(key)
      queued.current.push(key)
      added = true
    }
    if (!added || timer.current) return
    timer.current = setTimeout(flush, 900)
  }, [flush])

  /* FlashList treats onViewableItemsChanged as immutable after mount, so it
     has to be one stable function for the life of the list. The row may be a
     post or a wrapper around one (the feed interleaves dividers and system
     lines), so both shapes are read. */
  const reportRef = React.useRef(report)
  reportRef.current = report
  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: { item: any }[] }) => {
      reportRef.current(viewableItems.map(v => v?.item?.post?.id ?? v?.item?.id))
    },
  ).current

  return { onViewableItemsChanged, viewabilityConfig: VIEWABILITY_CONFIG, report }
}
