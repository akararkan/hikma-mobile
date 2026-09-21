/* =========================================================
   The vertical pager, and everything a page needs to be live.

   Owns: the active index, the three-player pool, focus and
   AppState pausing, hydration of the active reel, its SSE
   subscription, the follow-status read, watch tracking, and
   every optimistic write. The two screens that use it (the tab
   and /reels/[id]) differ only in their top chrome and where
   their items come from, which is exactly what this split is
   for.

   Subscription discipline matters here: the per-user SSE cap
   is five emitters, so exactly ONE post channel is open at a
   time — the active reel's — and the comments route reuses
   that same channel rather than dialling its own.

   THE INDEX IS SETTLED, NEVER LIVE. Every page is exactly one
   viewport tall, so the settled page is `round(offsetY / h)`
   read at the end of a drag or a fling — no viewability pass,
   no per-frame work. It used to come from an 80%-visibility
   token, which flips at 20% of a DRAG: the source swaps, the
   hydration GET, the SSE resubscribe and the cell mount/unmount
   all fired mid-gesture, and a nudge that snapped back ran the
   whole cascade twice. Nothing derived from the index may move
   until the list has stopped.

   THE CELLS ARE RECYCLED. `getItemType` splits the two page
   kinds into two recycle pools, so the ReelCard that leaves the
   window at index n-2 is the same React subtree that arrives at
   index n+2 — the VideoView, the audio players and the gesture
   handlers are re-used with new props instead of being torn
   down and rebuilt inside every swipe. That is also why the
   card resets its own state on `post.id`.
   ========================================================= */
import {
    api, applyPostDelta, errorText, isNotFound, isTransient,
} from '@/api'
import { applySocialStatus, useSocialStatus } from '@/components/profile/useSocialStatus'
import { useAuth } from '@/context/AuthContext'
import { useRealtime } from '@/hooks/useRealtime'
import { mayAutoLoadPhotos } from '@/lib/mediaPrefs'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Text, Touchable, fireHaptic, toast } from '@/ui'
import { usePostTombstones } from '@/components/feed/postTombstones'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import React from 'react'
import {
    AppState, RefreshControl, Share, StyleSheet, View,
    type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native'
import { useHoldRecheck } from './ModerationBadge'
import { armReelAudioSession, useReelsMute } from './mute'
import { ReelCard, ReelStaticPage } from './ReelCard'
import { ReelMoreSheet } from './ReelMoreSheet'
import { useOverlayDoc, type OverlayDoc } from './ReelOverlayLayer'
import { STAGE } from './skin'
import { clipUrlOf, isStillReel, type ReelSourceKind, type ViewPost } from './types'
import { useReelPlayerPool } from './useReelPlayerPool'
import { useReelWatchTracker } from './useReelWatchTracker'

export interface ReelPagerProps {
  items: ViewPost[]
  setItems: React.Dispatch<React.SetStateAction<ViewPost[]>>
  initialIndex?: number
  source: ReelSourceKind
  onIndexChange?: (index: number, item: ViewPost | undefined) => void
  onEndReached?: () => void
  refreshing?: boolean
  onRefresh?: () => void
  /** Absolute chrome drawn over the pager — segmented control, back chevron. */
  headerSlot?: React.ReactNode
  /** Where the top chrome ends; the mute chip is parked just under it. */
  chromeTop: number
  /** Tab bar + safe area. Everything bottom-anchored is offset by this. */
  bottomInset: number
  /** Continuation still loading — one page only, nothing more to prefetch. */
  locked?: boolean
  footer?: React.ReactNode
}

/** Pages within this distance of the settled index render a full card (the one
 *  further out has no player and shows its poster — the pool window is still
 *  ±1, three decoders and no more).
 *
 *  Two matters more than it looks. With `drawDistance` set to one page,
 *  FlashList's engaged set is {index-1 … index+2} going forward and
 *  {index-2 … index+1} going back — so at ±2 every MOUNTED cell is a card and
 *  a page turn never changes a mounted cell's item type. That is what lets the
 *  recycler hand the whole subtree — VideoView, audio players, gesture
 *  handlers — from the page that left to the page that arrived, instead of
 *  destroying one and building the other inside the swipe. */
const LIVE = 2
/** Ask for the next batch this many pages before the end. */
const PREFETCH_PAGES = 3
/** Covers warmed this many pages ahead of the settled index. */
const PREFETCH_POSTERS = 3

export function ReelPager({
  items, setItems, initialIndex = 0, source, onIndexChange, onEndReached,
  refreshing, onRefresh, headerSlot, chromeTop, bottomInset, locked, footer,
}: ReelPagerProps) {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const listRef = React.useRef<FlashListRef<ViewPost>>(null)

  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const [index, setIndex] = React.useState(() => Math.max(0, initialIndex))
  /* Under a running screen reader nothing may move without being asked
     (ThemeProvider's doctrine; the story viewer already honours it) — reels
     arrive PAUSED and the card's reader-only Play control starts them. */
  const [userPaused, setUserPaused] = React.useState(() => t.a11y.screenReader)
  const [appActive, setAppActive] = React.useState(true)
  const [focused, setFocused] = React.useState(true)
  const [muted, toggleMute] = useReelsMute()
  const [muteFlash, setMuteFlash] = React.useState(false)
  const [moreOpen, setMoreOpen] = React.useState(false)

  const active: ViewPost | undefined = items[index]
  const activeId = active?.id ?? null
  const isMine = !!user?.id && active?.author === user.id
  const signedIn = !!user?.id

  /* Refs, not deps. Everything a card can call has to keep ONE identity for the
     life of the screen: FlashList memoises each cell on the identity of
     `renderItem`, so a callback rebuilt on every counter delta re-renders every
     mounted page — during the swipe, if the delta lands mid-flick. */
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  const activeIdRef = React.useRef(activeId)
  activeIdRef.current = activeId
  const sizeRef = React.useRef(size)
  sizeRef.current = size
  const indexRef = React.useRef(index)

  const postById = React.useCallback(
    (id: string | null | undefined) => (id ? itemsRef.current.find(p => p.id === id) : undefined),
    [],
  )

  /* ---- pausing ---------------------------------------------------------- */

  useFocusEffect(React.useCallback(() => {
    setFocused(true)
    /* Armed on every FOCUS, never once per mount: this pager lives on a tab
       that is mounted for the life of the process, and `setAudioModeAsync` is a
       full replace rather than a merge (mute.ts explains why). A call, a
       ringtone or a voice note taken since the last visit has already handed
       the session back to `mixWithOthers` — so a mount-only arm meant reels
       played under the user's music, and died on the silent switch, for the
       rest of the session. The call is cheap and idempotent. */
    armReelAudioSession()
    return () => setFocused(false)
  }, []))

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'))
    return () => sub.remove()
  }, [])

  /* A sheet over the reel counts as "covered": the more-sheet is a real modal
     and the comments route blurs us, which the focus effect already catches. */
  const paused = userPaused || !focused || !appActive || moreOpen || !size.h

  const pool = useReelPlayerPool(items, index, { muted, paused, focused })

  /* ---- hydration -------------------------------------------------------- */

  const hydrated = React.useRef(new Set<string>())
  const [overlayUrl, setOverlayUrl] = React.useState<string | null>(null)
  const overlayDoc: OverlayDoc | null = useOverlayDoc(overlayUrl)

  const merge = React.useCallback((full: ViewPost) => {
    setItems(prev => prev.map(p => (p.id === full.id
      /* The full read is authoritative for everything EXCEPT the ranking
         metadata, which only a feed row carries. */
      ? { ...p, ...full, media: full.media?.length ? full.media : p.media, source: p.source, rankScore: p.rankScore }
      : p)))
  }, [setItems])

  React.useEffect(() => {
    if (!activeId) { setOverlayUrl(null); return }
    if (hydrated.current.has(activeId)) {
      setOverlayUrl(items[index]?.overlayUrl ?? null)
      return
    }
    /* Clear FIRST. The read below is 150ms away and the state still holds the
       PREVIOUS page's document — without this, swiping onto an un-hydrated reel
       paints somebody else's text over it until its own read lands. */
    setOverlayUrl(null)
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const full = await api.posts.get(activeId)
        if (!alive) return
        hydrated.current.add(activeId)
        merge(full)
        setOverlayUrl(full?.overlayUrl ?? null)
      } catch (e) {
        if (!alive) return
        /* A reel deleted between the feed read and the swipe: drop the page
           rather than leave a permanently blank one in the pager. */
        if (isNotFound(e)) setItems(prev => prev.filter(p => p.id !== activeId))
        else if (!isTransient(e)) toast.error(errorText(e))
      }
    }, 150)
    return () => { alive = false; clearTimeout(timer) }
  }, [activeId])   // eslint-disable-line react-hooks/exhaustive-deps

  useHoldRecheck(active, isMine, merge)
  useReelWatchTracker({ postId: activeId, active: focused && appActive, signedIn })

  /* ---- follow state ------------------------------------------------------
     Never derived from `_author` or meFrom().isFollowing — neither is on the
     wire (USER_API §6.2). The social-status read is the only truth.

     It goes through the SHARED relationship cache rather than the private map
     this used to keep. That map was the third copy of the same idea in the
     app: it never cleared on sign-out (a second account inherited the first's
     edges), it coalesced nothing, and it re-asked for an author whose status a
     profile screen had read one swipe earlier — one request per swipe to a new
     author, paid twice. `null` still means "unknown", which is what keeps the
     pill hidden rather than wrong. */

  const authorId = active?.author ?? null
  /* Self and signed-out both resolve to "no relationship to read"; the hook
     declines the request for the second on its own. */
  const rel = useSocialStatus(authorId && authorId !== user?.id ? authorId : null)

  const isFollowing = !signedIn || !authorId || authorId === user?.id
    ? null
    : (rel.status?.isFollowing ?? null)

  /* ---- realtime ----------------------------------------------------------
     Counter events carry deltas, never values — all the arithmetic is local,
     and the actor's own action is filtered server-side, which is what makes
     the optimistic writes below safe. */

  const reconcile = React.useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    try { merge(await api.posts.get(id)) } catch { /* the next event will do */ }
  }, [merge])

  useRealtime('posts', activeId, {
    onEvent: (evt: any) => {
      if (evt?.eventType === 'POST_DELETED') {
        setItems(prev => prev.filter(p => p.id !== activeIdRef.current))
        toast.info('This reel was deleted')
        return
      }
      if (evt?.eventType === 'POST_UPDATED') { void reconcile(); return }
      setItems(prev => prev.map(p => (p.id === activeIdRef.current ? applyPostDelta(p, evt) : p)))
    },
    /* Every (re)connect means "anything emitted while the socket was down is
       gone" — so it is a refetch, not just a log line. The FIRST connect is
       the exception: the hydration read above is already in flight for this
       exact id, and two GETs of one post per swipe is a swipe tax. */
    onConnected: () => {
      const id = activeIdRef.current
      if (id && hydrated.current.has(id)) void reconcile()
    },
  })

  /* ---- writes ------------------------------------------------------------
     Every one of these takes the id it acts on, so a card acts on ITSELF and
     the callback never has to close over the active row. The id is optional
     only because the more-sheet acts on whatever is on screen. */

  const patch = React.useCallback((id: string, fn: (p: ViewPost) => ViewPost) => {
    setItems(prev => prev.map(p => (p.id === id ? fn(p) : p)))
  }, [setItems])

  const requireAuth = React.useCallback(() => {
    if (signedIn) return true
    router.push('/(auth)/sign-in')
    return false
  }, [signedIn, router])

  const like = React.useCallback(async (id?: string) => {
    const post = postById(id ?? activeIdRef.current)
    if (!post || !requireAuth()) return
    const before = { liked: post.liked, likes: post.likes }
    patch(post.id, p => ({ ...p, liked: !p.liked, likes: Math.max(0, p.likes + (p.liked ? -1 : 1)) }))
    fireHaptic('light')
    try {
      const res: any = await api.posts.toggleReaction(post.id)
      patch(post.id, p => ({ ...p, liked: !!res?.liked }))
    } catch (e) {
      patch(post.id, p => ({ ...p, ...before }))
      toast.error(errorText(e))
    }
  }, [patch, requireAuth, postById])

  const save = React.useCallback(async (id?: string) => {
    const post = postById(id ?? activeIdRef.current)
    if (!post || !requireAuth()) return
    const before = { saved: post.saved, saves: post.saves }
    patch(post.id, p => ({ ...p, saved: !p.saved, saves: Math.max(0, p.saves + (p.saved ? -1 : 1)) }))
    try {
      const res: any = await api.posts.toggleSave(post.id)
      patch(post.id, p => ({ ...p, saved: !!res?.saved }))
    } catch (e) {
      patch(post.id, p => ({ ...p, ...before }))
      toast.error(errorText(e))
    }
  }, [patch, requireAuth, postById])

  const share = React.useCallback(async (id?: string) => {
    const target = id ?? activeIdRef.current
    if (!target) return
    try {
      const link: any = await api.posts.shareLink(target)
      const url = link?.shortUrl || link?.canonicalUrl
      if (!url) return
      const res = await Share.share({ message: url, url })
      /* Only a completed share bumps the counter and notifies the author —
         dismissing the OS sheet is not a share. */
      if (res.action === Share.sharedAction) {
        patch(target, p => ({ ...p, shares: p.shares + 1 }))
        api.posts.recordShare(target).catch(() => {})
      }
    } catch (e) {
      toast.error(errorText(e))
    }
  }, [patch])

  /* Optimistic into the shared cache, then the server's own `updatedStatus`
     over the top — which is what keeps the profile behind this reel agreeing
     without either of them refetching. */
  const follow = React.useCallback(async (id?: string) => {
    const target = id ?? postById(activeIdRef.current)?.author
    if (!target || !requireAuth()) return
    applySocialStatus(target, { isFollowing: true })
    try {
      const res: any = await api.users.follow(target)
      applySocialStatus(target, res?.updatedStatus ?? { isFollowing: true })
    } catch (e: any) {
      applySocialStatus(target, { isFollowing: false })
      toast.error(errorText(e))
    }
  }, [requireAuth, postById])

  const unfollow = React.useCallback(async (id?: string) => {
    const target = id ?? postById(activeIdRef.current)?.author
    if (!target) return
    applySocialStatus(target, { isFollowing: false })
    try {
      const res: any = await api.users.unfollow(target)
      applySocialStatus(target, res?.updatedStatus ?? { isFollowing: false })
    } catch (e) {
      applySocialStatus(target, { isFollowing: true })
      toast.error(errorText(e))
    }
  }, [postById])

  const copySoundName = React.useCallback(async (id?: string) => {
    const name = postById(id ?? activeIdRef.current)?.soundName
    if (!name) return
    await Clipboard.setStringAsync(name)
    toast.ok('Sound name copied')
  }, [postById])

  /* A post read carries `audioTrackName` but no sound id, so there is nothing
     to build /sounds/{id} from. The library, pre-searched on the label, is the
     nearest honest destination. */
  const openSound = React.useCallback((id?: string) => {
    const label = postById(id ?? activeIdRef.current)?.soundName || ''
    router.push(label ? `/sounds?q=${encodeURIComponent(label)}` : '/sounds')
  }, [router, postById])

  const openAuthor = React.useCallback((id?: string) => {
    const author = id ?? postById(activeIdRef.current)?.author
    if (author) router.push(`/u/${author}`)
  }, [router, postById])

  const openComments = React.useCallback((id?: string) => {
    const target = id ?? activeIdRef.current
    if (target) router.push(`/reels/comments/${target}`)
  }, [router])

  const onDeleted = React.useCallback((id: string) => {
    setItems(prev => prev.filter(p => p.id !== id))
  }, [setItems])

  /* Same drop, for a reel deleted somewhere else — its own detail screen, or
     the author's profile grid. A pager holding a deleted reel plays a video
     whose every engagement call 404s. */
  usePostTombstones(onDeleted)

  const togglePlay = React.useCallback(() => setUserPaused(p => !p), [])
  const openMore = React.useCallback(() => setMoreOpen(true), [])
  const openTag = React.useCallback((tag: string) => router.push(`/tags/${encodeURIComponent(tag)}`), [router])
  const openMention = React.useCallback((handle: string) => router.push(`/u/${encodeURIComponent(handle)}`), [router])

  /* ---- paging ------------------------------------------------------------
     One request per list, edge-triggered on the list actually growing.
     FlashList re-arms its own end-reached latch on every `data` identity —
     which here means every like, every save and every hydration merge — so the
     pixel threshold alone would re-ask on each of them. */

  const askedFor = React.useRef('')
  const requestMore = React.useCallback(() => {
    if (!onEndReached || locked) return
    const list = itemsRef.current
    /* Length AND tail id: a refresh can hand back a list of the same length
       made of different reels, and that one deserves its own request. */
    const stamp = `${list.length}:${list[list.length - 1]?.id ?? ''}`
    if (askedFor.current === stamp) return
    askedFor.current = stamp
    onEndReached()
  }, [onEndReached, locked])

  const settle = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const h = sizeRef.current.h
    const count = itemsRef.current.length
    if (!h || !count) return
    const next = Math.max(0, Math.min(count - 1, Math.round(e.nativeEvent.contentOffset.y / h)))
    if (next === indexRef.current) return
    indexRef.current = next
    /* Plain event-handler calls, not a setState updater: an updater runs in the
       render phase, where a haptic fires two or three times and a nested
       dispatch is a "cannot update while rendering" warning at best. */
    fireHaptic('select')
    setUserPaused(false)
    setIndex(next)
    if (next >= count - PREFETCH_PAGES) requestMore()
  }, [requestMore])

  /* A finished clip turns its own page. Settled FIRST, scrolled second: the
     index moves the moment the clip ends (audio hands off, hydration and the
     SSE resubscribe start), while the page glides in behind it — the reel
     grammar, and the same order a fast flick produces anyway. The animated
     scroll's own momentum-end lands in `settle`, which sees an unchanged
     index and does nothing. No haptic: nothing the user did.

     The card already vetoes this during a scrub; here the pager declines it
     when the finishing page is no longer the one being watched (a swipe won
     the race), on the LAST page (the loop plays it again — there is nothing
     to advance to until the next batch lands), and under a screen reader,
     where nothing may move without being asked (ThemeProvider doctrine). */
  const advanceFrom = React.useCallback((fromIndex: number) => {
    if (t.a11y.screenReader) return
    if (fromIndex !== indexRef.current) return
    const count = itemsRef.current.length
    const next = fromIndex + 1
    if (next >= count) { requestMore(); return }
    indexRef.current = next
    setIndex(next)
    listRef.current?.scrollToIndex({ index: next, animated: true })
    if (next >= count - PREFETCH_PAGES) requestMore()
  }, [requestMore, t.a11y.screenReader])

  /* The list can shrink under the index: a POST_DELETED over SSE, the
     more-sheet's delete, a 404 on hydrate, or a refresh that returns a shorter
     feed. Left alone, `items[index]` is undefined — the SSE channel and watch
     tracking go quiet while the pool keeps playing the deleted reel's audio
     over a page nobody can see. */
  React.useEffect(() => {
    if (!items.length) return
    const last = items.length - 1
    if (index <= last) return
    indexRef.current = last
    setIndex(last)
    listRef.current?.scrollToIndex({ index: last, animated: false })
  }, [items.length, index])

  /* A refresh REPLACES the array — for-you re-ranks from scratch — so a tab
     re-tap at reel 12 would otherwise leave the pager parked at offset 12
     inside a list that no longer contains the reel it was showing: a different
     reel appears under the thumb with no transition. Both conditions matter.
     A deleted reel also vanishes from the list, but it takes the head with it
     only if it WAS the head, so this cannot fire on a delete mid-list. */
  const watchingId = React.useRef<string | null>(null)
  const headId = React.useRef<string | null>(null)
  React.useEffect(() => {
    const gone = !!watchingId.current && !items.some(p => p.id === watchingId.current)
    const reseeded = !!headId.current && !!items[0] && items[0].id !== headId.current
    if (gone && reseeded && indexRef.current !== 0) {
      indexRef.current = 0
      setIndex(0)
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
    headId.current = items[0]?.id ?? null
    watchingId.current = items[indexRef.current]?.id ?? null
  }, [items])

  React.useEffect(() => { onIndexChange?.(index, items[index]) }, [index])   // eslint-disable-line react-hooks/exhaustive-deps

  /* The pool pre-attaches the ±1 clips; the COVERS are what every page past
     that shows the instant it scrolls in, and only a warm expo-image cache
     paints on the first frame of a fast flick. Length, not identity, in the
     deps — a like must not walk the window again, and the seen-set makes the
     re-runs that do happen a few Set lookups. Urls only: a reel whose cover
     IS its video file has nothing an image cache can hold. */
  const posterWarm = React.useRef(new Set<string>())
  React.useEffect(() => {
    /* Warming posters is exactly the "download before you asked" the
       auto-download preference governs. Never, or wi-fi-only on mobile data,
       means the poster loads when the page arrives instead. */
    if (!mayAutoLoadPhotos()) return
    const list = itemsRef.current
    for (let i = index + 1; i <= index + PREFETCH_POSTERS && i < list.length; i++) {
      const post = list[i]
      const m = post?.media?.[0]
      const uri = isStillReel(post) ? m?.url : m?.poster
      if (!uri || uri === clipUrlOf(post) || posterWarm.current.has(uri)) continue
      posterWarm.current.add(uri)
      void Image.prefetch(uri, 'memory-disk').catch(() => {})
    }
  }, [index, items.length])

  /* The chip is 34px of glass over moving video — too easy to miss. A 1.2s
     confirmation is what tells the user their tap landed. */
  const firstMuteRender = React.useRef(true)
  React.useEffect(() => {
    if (firstMuteRender.current) { firstMuteRender.current = false; return }
    setMuteFlash(true)
    const id = setTimeout(() => setMuteFlash(false), 1200)
    return () => clearTimeout(id)
  }, [muted])

  /* Two recycle pools, keyed on the same boundary renderItem uses. A cell that
     leaves the window releases its key to the pool of its own type, so the
     page arriving on the other side reuses that subtree. Beyond LIVE nothing
     is ever engaged (see the constant), so the plate is what a programmatic
     jump lands on, not something a swipe passes through. */
  const getItemType = React.useCallback(
    (_item: ViewPost, i: number) => (Math.abs(i - index) <= LIVE ? 'reel' : 'plate'),
    [index],
  )

  const keyOf = React.useCallback((item: ViewPost) => item.id, [])

  const renderItem = React.useCallback(({ item, index: i }: { item: ViewPost; index: number }) => {
    if (!size.h) return <View style={{ width: size.w, height: size.h }} />
    if (Math.abs(i - index) > LIVE) {
      return <ReelStaticPage post={item} width={size.w} height={size.h} bottomInset={bottomInset} />
    }
    const isActive = i === index
    return (
      <ReelCard
        post={item}
        pageIndex={i}
        active={isActive}
        width={size.w}
        height={size.h}
        player={pool.getPlayer(i)}
        clipStatus={pool.statusOf(i)}
        onRetryClip={pool.retry}
        overlayDoc={isActive ? overlayDoc : null}
        muted={muted}
        paused={!isActive || paused}
        isFollowing={isActive ? isFollowing : null}
        isMine={!!user?.id && item.author === user.id}
        signedIn={signedIn}
        bottomInset={bottomInset}
        onEnded={advanceFrom}
        onTogglePlay={togglePlay}
        onLike={like}
        onSave={save}
        onShare={share}
        onComments={openComments}
        onMore={openMore}
        onFollow={follow}
        onAuthor={openAuthor}
        onTag={openTag}
        onMention={openMention}
        onSound={openSound}
        onCopySound={copySoundName}
      />
    )
  }, [
    size, index, pool, overlayDoc, muted, paused, isFollowing, user, signedIn, bottomInset,
    like, save, share, openComments, follow, openAuthor, openSound, copySoundName,
    togglePlay, openMore, openTag, openMention, advanceFrom,
  ])

  /* Mount-time only. A later append must never re-scroll the list. */
  const firstScroll = React.useMemo(
    () => Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)) || undefined,
    [],   // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <View
      style={styles.root}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setSize(s => (s.w === width && s.h === height ? s : { w: width, h: height }))
      }}
    >
      {size.h > 0 ? (
        <FlashList
          ref={listRef}
          data={items}
          extraData={`${index}|${muted}|${paused}|${isFollowing}`}
          renderItem={renderItem}
          keyExtractor={keyOf}
          getItemType={getItemType}
          /* One page of lookahead: the engaged set stays a stable ±1 window
             instead of the default 250px, which lets the previous page leave
             and re-enter it two or three times per swipe. */
          drawDistance={size.h}
          /* pagingEnabled ALONE. `snapToInterval` silently turns native paging
             off on iOS (ScrollView.js forces pagingEnabled false whenever it is
             set) and hands the snap to the interval path, which — with
             disableIntervalMomentum pinning the origin to the release point —
             floors a short upward flick back onto the page you started on. */
          pagingEnabled
          /* Every row is exactly one viewport tall, so there is nothing for
             anchor correction to correct; left on, it applies a native
             contentOffset nudge on every setItems and lands one mid-fling. */
          maintainVisibleContentPosition={{ disabled: true }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onMomentumScrollEnd={settle}
          /* A drag released with no velocity never produces a momentum event. */
          onScrollEndDrag={settle}
          onEndReached={requestMore}
          onEndReachedThreshold={1}
          initialScrollIndex={firstScroll}
          ListFooterComponent={footer as any}
          /* Paging is what makes this safe to keep: a flick moves exactly one
             page, so the only place the scroller can overscroll into the
             refresh control is the first one. Mid-list it can neither fire nor
             shift the page geometry with its ~60pt of transient inset. */
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={STAGE.fgMuted}
                colors={[t.colors.cta]}
                progressBackgroundColor={STAGE.plate}
              />
            ) : undefined
          }
        />
      ) : null}

      {headerSlot}

      <Touchable
        onPress={() => { fireHaptic('light'); toggleMute() }}
        feedback="scale"
        noAutoHitSlop
        accessibilityLabel={muted ? 'Unmute reels' : 'Mute reels'}
        style={[styles.muteChip, { top: chromeTop }]}
      >
        <Icon name={muted ? 'mute' : 'volume'} size={16} color={STAGE.fg} />
      </Touchable>

      {muteFlash ? (
        <View style={styles.muteToast} pointerEvents="none">
          <Icon name={muted ? 'mute' : 'volume'} size={13} color={STAGE.fg} />
          <Text variant="caption" weight="600" color={STAGE.fg}>{muted ? 'Sound off' : 'Sound on'}</Text>
        </View>
      ) : null}

      <ReelMoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        post={active ?? null}
        isMine={isMine}
        isFollowing={isFollowing}
        onDeleted={onDeleted}
        onEdited={merge}
        onShare={share}
        onUnfollow={unfollow}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: STAGE.black },
  muteChip: {
    position: 'absolute',
    end: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: STAGE.glass,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
  muteToast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '44%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.md,
    height: 32,
    /* A chip, not a pill — see DESIGN.md §8.9. The mute BUTTON above stays a
       circle: icon-only round buttons are sanctioned. */
    ...setback(shape.chip),
    borderCurve: 'continuous',
    backgroundColor: STAGE.glassStrong,
    zIndex: 25,
  },
})
