/* =========================================================
   One author's frames, played.

   The transport is a Reanimated SharedValue driven with
   withTiming and read inside a worklet, so the segment bar
   never touches the JS thread — a bar animated from JS is the
   first thing to stutter when a video decodes, which is
   exactly when someone is watching it.

   Timing durations here are DELIBERATELY not passed through
   t.ms(): reduced motion turns transitions into cuts, and a
   frame timer that becomes a cut is a story that plays itself
   in one frame. Only the chrome's fades honour the setting.
   ========================================================= */
import {
    adapters, api, errorText, isClientBug, isNetworkError, isNotFound, isUnhydratedParam, logApiError,
} from '@/api'
import { armReelAudioSession } from '@/components/reels/mute'
import { mayAutoLoadPhotos } from '@/lib/mediaPrefs'
import { isHeld, recheckDelays } from '@/lib/moderation'
import { markMyStorySeen, markStorySeen } from '@/lib/storySeen'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
    Button, ConfirmSheet, Icon, Spinner, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import * as Linking from 'expo-linking'
import { useFocusEffect, useRouter } from 'expo-router'
import React from 'react'
import { AppState, Share, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import Animated, {
    Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AddToHighlightSheet } from './AddToHighlightSheet'
import { ExpiryChip } from './ExpiryChip'
import { HELD_NOTE, ModerationBadge } from './ModerationBadge'
import { ReportStorySheet, StoryActionsSheet } from './StoryActionsSheet'
import { StoryFrame } from './StoryFrame'
import { StoryPollCard } from './StoryPollCard'
import { StoryProgressBar } from './StoryProgressBar'
import { StoryReplyBar, useStoryDM } from './StoryReplyBar'
import { StoryRing } from './StoryRing'
import { placeholderPerson, type ViewerPerson } from './ViewerRow'
import { BLACK, ink, night, shade } from './night'
import {
    EMPTY_TALLY, STILL_MS, VIDEO_FALLBACK_MS, isVideoFrame, newestAt, posterOf,
    type StoryPoll, type StoryRow, type Tally,
} from './storyVisual'
import { invalidateStories, usePollTally, type TrayEntry } from './trayStore'
import { VISIBILITY_GLYPH } from './visibility'

export interface StoryAuthorPageProps {
  authorId: string
  /** This page is the one on screen. Only the active page plays. */
  active: boolean
  /** One page either side of the active one: load, but do not play. A page
   *  that is neither active nor prefetched costs nothing at all — no read, no
   *  frame, no player. See the note on the load effect. */
  prefetch?: boolean
  /** Deep link into a particular frame (the manager's grid does this). */
  startStoryId?: string | null
  /** Arrived by going BACK from the next author: land on the last frame, the
   *  way rewinding past the start of a track lands at the end of the one
   *  before it. */
  enterAtEnd?: boolean
  /** Already hydrated by the tray — skips a users.get. */
  trayAuthor?: TrayEntry['author'] | null
  viewerId: string | null
  /** The owner pauses everything while a drag or a background is in progress. */
  paused?: boolean
  onClose: () => void
  onNextAuthor: () => void
  onPrevAuthor: () => void
}

export function StoryAuthorPage({
  authorId, active, prefetch = false, startStoryId, enterAtEnd, trayAuthor, viewerId, paused = false,
  onClose, onNextAuthor, onPrevAuthor,
}: StoryAuthorPageProps) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const sendDM = useStoryDM()

  const isOwn = !!viewerId && String(viewerId) === String(authorId)

  /* ---- frames ------------------------------------------------------- */
  const [frames, setFrames] = React.useState<StoryRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<any>(null)
  const [index, setIndex] = React.useState(0)
  const [author, setAuthor] = React.useState<any>(trayAuthor ?? null)

  const framesRef = React.useRef(frames)
  framesRef.current = frames
  const indexRef = React.useRef(index)
  indexRef.current = index

  /* Once warm, always warm: a page the reader has already been on keeps its
     frames so swiping back to it is instant rather than a second read. */
  const wasActive = React.useRef(false)
  if (active) wasActive.current = true
  const warm = active || prefetch || wasActive.current

  const load = React.useCallback(async (mode: 'first' | 'reconcile' = 'first') => {
    if (!authorId) return
    if (mode === 'first') setLoading(true)
    try {
      const rows: StoryRow[] = (await api.stories.byAuthor(authorId)) || []
      /* Playback is oldest→newest — a stack plays in the order it was told.
         Sorted EXPLICITLY on createdAt rather than reversing the wire order:
         byAuthor's order is not contractual (it flipped on us once, which put
         a fresh poll/text frame BEFORE the stories posted earlier), and a
         sort is deterministic whatever the server does. */
      const ordered = [...rows].sort(
        (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      )
      setFrames(ordered)
      setError(null)
      if (mode === 'first') {
        const at = startStoryId ? ordered.findIndex(s => String(s.storyId) === String(startStoryId)) : -1
        setIndex(at >= 0 ? at : 0)
      } else {
        /* A reconcile must not throw the viewer back to frame 0. */
        setIndex(i => Math.min(i, Math.max(0, ordered.length - 1)))
      }
    } catch (e: any) {
      if (isUnhydratedParam(e) || isClientBug(e)) { logApiError(e, 'GET', 'stories/by-author'); onClose(); return }
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [authorId, startStoryId, onClose])

  /* Gated on `warm`, and this is the whole point of `warm`: PagerView mounts
     every author in the deck, so an ungated read here is one GET per author in
     the tray fired the instant the viewer opens — and then one video player
     per author whose first frame is a clip, competing for decoders with the
     single frame anyone is actually looking at. */
  React.useEffect(() => { if (warm) void load('first') }, [load, warm])

  /* The tray hands over a hydrated author; a deep link does not. */
  React.useEffect(() => {
    if (!warm || trayAuthor || !authorId) return
    let alive = true
    api.users.get(authorId).then((u: any) => { if (alive) setAuthor(u) }).catch(() => {})
    return () => { alive = false }
  }, [authorId, trayAuthor, warm])

  const current: StoryRow | null = frames[index] ?? null
  const currentId = current ? String(current.storyId) : null
  const currentIdRef = React.useRef<string | null>(currentId)
  currentIdRef.current = currentId

  React.useEffect(() => {
    if (active && enterAtEnd && frames.length) setIndex(frames.length - 1)
  }, [active, enterAtEnd, frames.length])

  /* Ring goes dark the moment the page opens, not when it finishes. */
  React.useEffect(() => {
    if (!active || !frames.length) return
    markStorySeen(authorId, newestAt(frames))
  }, [active, authorId, frames])

  /* An empty array is deliberately indistinguishable from "not visible to
     you" — there is no empty viewer to render. */
  React.useEffect(() => {
    if (!active || loading || error || frames.length) return
    toast.info('No stories to show')
    onClose()
  }, [active, loading, error, frames.length, onClose])

  /* ---- holds -------------------------------------------------------- */
  const heldSeen = React.useRef(false)
  React.useEffect(() => {
    if (!active || !frames.some(isHeld)) return undefined
    if (heldSeen.current) return undefined
    heldSeen.current = true
    /* A hold clears on its own and nothing is pushed when it does, so the row
       re-reads itself on the server's own back-off schedule. */
    const timers = recheckDelays('STORY').map((ms: number) => setTimeout(() => void load('reconcile'), ms))
    return () => timers.forEach(clearTimeout)
  }, [active, frames, load])

  /* ---- playback ----------------------------------------------------- */
  const progress = useSharedValue(0)
  const chrome = useSharedValue(1)
  const [holding, setHolding] = React.useState(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [replyFocused, setReplyFocused] = React.useState(false)
  const [appActive, setAppActive] = React.useState(true)
  const [videoMs, setVideoMs] = React.useState<number | null>(null)
  const [muted, setMuted] = React.useState(false)

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'))
    return () => sub.remove()
  }, [])

  /* `setAudioModeAsync` is a full REPLACE, not a merge (see mute.ts): a call, a
     ringtone or a voice note that set the mode without naming `interruptionMode`
     hands the session back to `mixWithOthers`, and a story video then plays
     under the user's music and dies on the silent switch. The reels helper is
     borrowed rather than copied — same mode, same reason — and re-asserted on
     every focus AND every page change, because it is cheap and idempotent and a
     once-per-mount flag is exactly what left the session stale. */
  useFocusEffect(React.useCallback(() => {
    if (active) armReelAudioSession()
  }, [active]))

  const duration = current && isVideoFrame(current) ? (videoMs ?? VIDEO_FALLBACK_MS) : STILL_MS
  /* A running screen reader freezes the transport for the same reason a held
     finger does: VoiceOver and TalkBack read a frame at their own pace, and a
     bar that expires after STILL_MS moves the story out from under the
     narration and drags focus with it. WCAG 2.2.2 asks for auto-advancing
     content to be pausable; with a reader running the honest default is
     paused, and the tap zones already make the story navigable by hand. */
  const frozen = paused || holding || sheetOpen || replyFocused || !appActive || !active || !current
    || t.a11y.screenReader

  /* `frozen` stops the clock; it does NOT give back a decoder. PagerView keeps
     every warm face mounted, so a deck of paused-but-mounted VideoViews is a
     deck of held MediaCodec instances — the device has about three, shared with
     the feed and reels, and the frame the reader actually asked for queues
     behind them. `onStage` is the mount gate: only the page on stage builds a
     player, everything else gets StoryFrame's poster.

     Sticky across the dismiss drag, and that is the whole reason it is a latch
     rather than `active`: the deck folds its drag flag INTO `active` (it also
     hands it over as `paused`), so a page reads inactive from the moment a
     finger lands on it. Tearing the player down on touch-down and rebuilding it
     on release would stutter the one gesture the viewer is judged on. A page
     the deck has genuinely moved past sees `active` false with `paused` false
     and drops out on the same commit. */
  const stage = React.useRef(false)
  const onStage = active || (stage.current && paused)
  stage.current = onStage

  /* Both of these are stable for the life of the page and read everything they
     need from refs. That matters twice: the progress timing's completion
     callback is a worklet, which can only reach a JS function it captured
     directly, and re-arming the bar whenever the parent re-rendered would
     restart the frame. */
  const hop = React.useRef({ onNextAuthor, onPrevAuthor })
  hop.current = { onNextAuthor, onPrevAuthor }

  const next = React.useCallback(() => {
    const i = indexRef.current
    if (i + 1 < framesRef.current.length) setIndex(i + 1)
    else hop.current.onNextAuthor()
  }, [])

  const prev = React.useCallback(() => {
    if (indexRef.current > 0) setIndex(i => i - 1)
    else hop.current.onPrevAuthor()
  }, [])

  /* A video can finish at the same moment the fallback timer expires. Both
     signals are useful, but one frame must produce exactly one advance. */
  const advancedFrame = React.useRef<string | null>(null)
  const advanceOnce = React.useCallback(() => {
    const id = currentIdRef.current
    if (!id || advancedFrame.current === id) return
    advancedFrame.current = id
    next()
  }, [next])
  React.useEffect(() => { advancedFrame.current = null }, [currentId])

  /* Reset before arm: declaration order is what guarantees a frame change
     rewinds the bar before the timing that reads it starts. */
  React.useEffect(() => { progress.value = 0; setVideoMs(null) }, [currentId, active, progress])

  React.useEffect(() => {
    if (frozen) { cancelAnimation(progress); return undefined }
    const remaining = Math.max(120, duration * (1 - progress.value))
    progress.value = withTiming(1, { duration: remaining, easing: Easing.linear }, finished => {
      if (finished) runOnJS(advanceOnce)()
    })
    return () => cancelAnimation(progress)
  }, [frozen, duration, currentId, progress, advanceOnce])

  /* Warm the next still while this one plays. Five seconds is plenty of time
     to fetch an image and nowhere near enough to fetch one on demand. */
  React.useEffect(() => {
    if (!active) return
    /* Same rule as the reels pager: warming the NEXT frame is a download the
       reader did not ask for, so it obeys auto-download. The current frame is
       never gated — that one they did ask for. */
    if (!mayAutoLoadPhotos()) return
    const upcoming = frames[index + 1]
    if (!upcoming) return
    /* posterOf falls back to mediaUrl, and prefetching a VIDEO through the
       image cache downloads bytes that can never decode there — for a clip,
       warm only its real thumbnail. (The clip itself is deliberately NOT
       pre-attached: a neighbour's player would hold one of the ~3 hardware
       decoders — see StoryFrame's header.) */
    const uri = isVideoFrame(upcoming) ? (upcoming.thumbnailUrl || null) : posterOf(upcoming)
    if (uri) void Image.prefetch(uri, 'memory-disk').catch(() => {})
  }, [active, frames, index])

  /* ---- view log ----------------------------------------------------- */
  const viewed = React.useRef(new Set<string>())
  React.useEffect(() => {
    if (!active || !currentId || isOwn) return undefined
    if (viewed.current.has(currentId)) return undefined
    const id = setTimeout(() => {
      viewed.current.add(currentId)
      /* 202 and silent: gone, yours, or invisible are all "nothing to do". */
      api.stories.recordView(currentId).catch(() => {})
    }, 500)
    return () => clearTimeout(id)
  }, [active, currentId, isOwn])

  /* ---- poll --------------------------------------------------------- */
  const [poll, setPoll] = React.useState<StoryPoll | null>(null)
  const [tally, setTally] = React.useState<Tally>(EMPTY_TALLY)
  const [myChoice, setMyChoice] = React.useState<'A' | 'B' | null>(null)
  const [voting, setVoting] = React.useState(false)
  const pushedTally = usePollTally(isOwn ? poll?.pollId : null)

  React.useEffect(() => { if (pushedTally) setTally(pushedTally) }, [pushedTally])

  const readResults = React.useCallback(async (pollId: string) => {
    try {
      const r = await api.stories.results(pollId)
      setTally({ voteA: Number(r?.voteA) || 0, voteB: Number(r?.voteB) || 0 })
    } catch (e) { logApiError(e, 'GET', 'polls/results') }
  }, [])

  React.useEffect(() => {
    if (!active || !currentId) return undefined
    let alive = true
    setPoll(null); setTally(EMPTY_TALLY); setMyChoice(null)
    void (async () => {
      let found: StoryPoll | null = null
      try {
        found = await api.stories.getPoll(currentId)
      } catch {
        /* A story without a poll is a documented 404 with an empty body —
           marked quiet at the api layer; real failures were already logged
           by http.js. Either way, no poll UI. */
        return
      }
      if (!alive || !found?.pollId) return
      setPoll(found)
      if (viewerId) {
        try {
          const mine = await api.stories.myVote(found.pollId)
          if (alive && (mine?.choice === 'A' || mine?.choice === 'B')) setMyChoice(mine.choice)
        } catch (e) { logApiError(e, 'GET', 'polls/vote/me') }
      }
      if (alive) await readResults(found.pollId)
    })()
    return () => { alive = false }
  }, [active, currentId, viewerId, readResults])

  const vote = async (choice: 'A' | 'B') => {
    if (!poll || voting || myChoice === choice) return
    const before = { choice: myChoice, tally }
    /* Optimistic: move the side under the finger now, replace with the
       server's authoritative pair when it lands. */
    setMyChoice(choice)
    setTally(prevT => {
      const nextT = { ...prevT }
      if (before.choice === 'A') nextT.voteA = Math.max(0, nextT.voteA - 1)
      if (before.choice === 'B') nextT.voteB = Math.max(0, nextT.voteB - 1)
      if (choice === 'A') nextT.voteA += 1
      else nextT.voteB += 1
      return nextT
    })
    setVoting(true)
    fireHaptic('light')
    try {
      const res = await api.stories.vote(poll.pollId, choice)
      setTally({ voteA: Number(res?.voteA) || 0, voteB: Number(res?.voteB) || 0 })
    } catch (e: any) {
      setMyChoice(before.choice)
      setTally(before.tally)
      /* "Choice must be A or B" can only be our bug — the value is a literal. */
      if (isClientBug(e) || String(e?.code) === 'ILLEGAL_ARGUMENT') logApiError(e, 'POST', 'polls/vote')
      else toast.error(errorText(e))
    } finally {
      setVoting(false)
    }
  }

  /* ---- splicing ------------------------------------------------------ */
  const dropFrame = React.useCallback((storyId: string, announce: boolean) => {
    const remaining = framesRef.current.filter(s => String(s.storyId) !== String(storyId))
    if (remaining.length === framesRef.current.length) return
    setFrames(remaining)
    if (!remaining.length) { onNextAuthor(); return }
    /* Keep the index so playback lands on whatever came next. */
    setIndex(i => Math.min(i, remaining.length - 1))
    if (announce) toast.info('This story is no longer available')
  }, [onNextAuthor])

  /* ---- your own frame: viewers + the per-story stream ---------------- */
  const [viewers, setViewers] = React.useState<ViewerPerson[] | null>(null)
  const [viewCount, setViewCount] = React.useState<number | null>(null)

  const readViewers = React.useCallback(async (storyId: string) => {
    try {
      const rows: { viewerId: string }[] = (await api.stories.viewers(storyId, 50)) || []
      const ids = [...new Set(rows.map(r => String(r.viewerId)).filter(Boolean))]
      setViewCount(ids.length)
      const settled = await Promise.allSettled(ids.slice(0, 3).map(id => api.users.get(id)))
      setViewers(settled.map((s, i) => (s.status === 'fulfilled' ? s.value : placeholderPerson(ids[i]))) as ViewerPerson[])
    } catch (e) {
      /* null is UNKNOWN, never zero — a failed probe must not read as
         "nobody has seen this". */
      setViewCount(null)
      setViewers(null)
      logApiError(e, 'GET', 'stories/views')
    }
  }, [])

  React.useEffect(() => {
    if (!active || !isOwn || !currentId) { setViewers(null); setViewCount(null); return }
    void readViewers(currentId)
  }, [active, isOwn, currentId, readViewers])

  React.useEffect(() => {
    if (!active || !isOwn || !currentId) return undefined
    /* One per-story socket at a time, and only where there is live data you
       can act on: your own view count. */
    return api.stories.storyStream(currentId, {
      onViewed: () => setViewCount(c => (c == null ? 1 : c + 1)),
      onPollVoted: (ev: any) => {
        const a = ev?.pollVoteACount
        const b = ev?.pollVoteBCount
        if (a != null && b != null) setTally({ voteA: Number(a) || 0, voteB: Number(b) || 0 })
        else if (poll?.pollId) void readResults(poll.pollId)
      },
      onRemoved: () => dropFrame(currentId, true),
      onConnected: () => {
        void load('reconcile')
        if (poll?.pollId) void readResults(poll.pollId)
      },
    })
  }, [active, isOwn, currentId, poll?.pollId, load, readResults])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Your own ring means "nobody has watched this yet", so it is acknowledged
     against the count we actually saw — on the way out, not on the way in.
     `viewCount` is per-FRAME, but the rail compares against the distinct count
     across ALL frames — so ack the highest count witnessed this session, or
     closing on a fresh zero-view frame would out-write the older frame's
     viewers and relight the ring you just cleared. */
  const ackRef = React.useRef({ at: 0, views: null as number | null })
  ackRef.current = {
    at: newestAt(frames),
    views: viewCount == null
      ? ackRef.current.views
      : Math.max(ackRef.current.views ?? 0, viewCount),
  }
  React.useEffect(() => {
    if (!isOwn) return undefined
    /* `at` 0 means the frames never loaded — backing out of an empty viewer
       must not acknowledge frames that were never shown. */
    return () => { if (ackRef.current.at > 0) markMyStorySeen(ackRef.current.at, ackRef.current.views) }
  }, [isOwn])

  /* ---- mutations ---------------------------------------------------- */
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const doDelete = async () => {
    if (!current) return
    const victim = current
    setDeleting(true)
    setConfirmDelete(false)
    dropFrame(String(victim.storyId), false)
    try {
      await api.stories.remove(victim.storyId)
      invalidateStories()
      toast.ok('Story deleted')
    } catch (e: any) {
      /* There is no restore endpoint, so the rollback is local re-insertion —
         which is also why the confirm has to be explicit. */
      setFrames(list => {
        const back = [...list, victim]
        back.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        return back
      })
      toast.error(errorText(e))
    } finally {
      setDeleting(false)
    }
  }

  /* ---- sheets ------------------------------------------------------- */
  const [actions, setActions] = React.useState(false)
  const [reporting, setReporting] = React.useState(false)
  const [highlightSheet, setHighlightSheet] = React.useState(false)

  React.useEffect(() => {
    setSheetOpen(actions || reporting || highlightSheet || confirmDelete)
  }, [actions, reporting, highlightSheet, confirmDelete])

  const storyLink = currentId ? Linking.createURL(`/story/${authorId}`) : ''

  /* ---- gestures ----------------------------------------------------- */
  const [hearts, setHearts] = React.useState<number[]>([])

  const heartBurst = React.useCallback(() => {
    fireHaptic('light')
    /* Three, staggered — one heart reads as a bug, three read as a reaction.
       Reduce Motion gets none of them: they float 140pt up the screen, which
       is the motion DESIGN.md §7 names outright. The ❤️ that leaves as a
       message is the confirmation, the same way the reel rail's heart is. */
    if (!t.prefs.reducedMotion) {
      const at = Date.now()
      setHearts(h => [...h, at, at + 1, at + 2])
    }
    if (!isOwn && author?.id) void sendDM(String(author.id), '❤️')
  }, [author, isOwn, sendDM, t.prefs.reducedMotion])

  const zoneTap = React.useCallback((x: number) => {
    if (x < width * 0.3) prev()
    else next()
  }, [next, prev, width])

  /* Swipe up is "say something" on someone else's frame and "do something" on
     your own — the two things the bottom bar already offers. */
  const [focusSignal, setFocusSignal] = React.useState(0)
  const openActions = React.useCallback(() => setActions(true), [])
  const bumpFocus = React.useCallback(() => setFocusSignal(n => n + 1), [])

  /* One memoized composition, not five objects a render. GestureDetector diffs
     the tree by handler identity and re-registers the whole config with the
     native module when it changes — and this component re-renders on every
     progress tick, every seen-receipt and every realtime tally. */
  const gestures = React.useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(250)
      .onEnd((e, success) => { if (success) runOnJS(zoneTap)(e.absoluteX) })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      /* Exclusive() makes every SINGLE tap wait for this to fail, and tap-to-
         advance has to feel instant — so the window is cut well below the 500ms
         default rather than left at it. */
      .maxDelay(180)
      .onEnd((e, success) => {
        if (!success) return
        /* Only the middle band is a heart; the edges stay navigation. */
        if (e.absoluteX > width * 0.3 && e.absoluteX < width * 0.7) runOnJS(heartBurst)()
        else runOnJS(zoneTap)(e.absoluteX)
      })

    const hold = Gesture.LongPress()
      .minDuration(180)
      .maxDistance(9999)
      .onBegin(() => {
        chrome.value = withTiming(0, { duration: 150 })
        runOnJS(setHolding)(true)
      })
      .onFinalize(() => {
        chrome.value = withTiming(1, { duration: 150 })
        runOnJS(setHolding)(false)
      })

    const swipeUp = Gesture.Pan()
      .activeOffsetY(-24)
      .failOffsetX([-20, 20])
      .onEnd(e => {
        if (e.translationY >= -60) return
        if (isOwn) runOnJS(openActions)()
        else runOnJS(bumpFocus)()
      })

    return Gesture.Simultaneous(
      swipeUp,
      Gesture.Race(hold, Gesture.Exclusive(doubleTap, tap)),
    )
  }, [zoneTap, heartBurst, width, chrome, setHolding, isOwn, openActions, bumpFocus])

  const chromeStyle = useAnimatedStyle(() => ({ opacity: t.prefs.reducedMotion ? 1 : chrome.value }))

  /* ---- render ------------------------------------------------------- */
  /* A cold page is a black plate and nothing else — not even the loading
     spinner, because it has not asked for anything to load. The cube only ever
     reveals a neighbour, and neighbours are warm. */
  if (!warm) return <View style={[styles.fill, { backgroundColor: BLACK }]} />

  if (loading) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: BLACK }]}>
        <StoryProgressBar count={1} index={0} progress={progress} style={[styles.progress, { top: insets.top + 8 }]} />
        {/* The plate is BLACK, where `accent` is all but invisible — the arc
            rides the night ink instead (State.tsx documents the exception). */}
        <Spinner size="large" color={ink.full} />
      </View>
    )
  }

  if (error) return <ViewerError error={error} onRetry={() => void load('first')} onClose={onClose} />

  if (!current) return <View style={[styles.fill, { backgroundColor: BLACK }]} />

  const held = isHeld(current)
  const pollTop = height * 0.62

  const who = isOwn ? 'Your story' : author?.full || 'Member'

  return (
    <View style={[styles.fill, { backgroundColor: BLACK }]}>
      {/* The frame is a picture with no text of its own — without a label a
          reader announces nothing at all where the story is. */}
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityLabel={[`${who}, ${index + 1} of ${frames.length}`, current.textContent].filter(Boolean).join('. ')}
      >
        <StoryFrame
          story={current}
          muted={muted}
          paused={frozen}
          active={onStage}
          onDuration={setVideoMs}
          onPlaybackEnd={advanceOnce}
          onError={() => {}}
        />
      </View>

      {/* The gesture layer sits UNDER the chrome, so the poll card, the header
          buttons and the reply bar keep their own taps without a single
          gesture composition between them. */}
      <GestureDetector gesture={gestures}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>

      {/* A running screen reader freezes the transport (see `frozen`) AND
          swallows the tap on the gesture layer — that View is not an
          accessibility element, so `zoneTap` never fires. Without these two the
          story stops on frame 1 forever and no author past the first can be
          reached. Reader-only: sighted users keep the gesture, which is inert
          under a reader anyway. */}
      {t.a11y.screenReader ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.zones} pointerEvents="box-none">
            <Touchable
              feedback="none"
              noAutoHitSlop
              style={styles.zone}
              accessibilityLabel="Previous"
              onPress={prev}
            >
              <View style={StyleSheet.absoluteFill} />
            </Touchable>
            <Touchable
              feedback="none"
              noAutoHitSlop
              style={[styles.zone, { flex: 2 }]}
              accessibilityLabel="Next"
              onPress={next}
            >
              <View style={StyleSheet.absoluteFill} />
            </Touchable>
          </View>
        </View>
      ) : null}

      {hearts.map((id, i) => (
        <Heart key={id} index={i % 3} onDone={() => setHearts(h => h.filter(x => x !== id))} />
      ))}

      <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
        <LinearGradient
          colors={[shade.scrimTop, shade.clear]}
          style={[styles.scrimTop]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[shade.clear, shade.scrimBottom]}
          style={[styles.scrimBottom]}
          pointerEvents="none"
        />

        <StoryProgressBar
          count={frames.length}
          index={index}
          progress={progress}
          style={[styles.progress, { top: insets.top + 8 }]}
        />

        <View style={[styles.header, { top: insets.top + 22 }]} pointerEvents="box-none">
          <Touchable
            onPress={() => author?.id && router.push(`/u/${author.handle || author.id}` as any)}
            feedback="dim"
            noAutoHitSlop
            style={styles.headerWho}
          >
            <StoryRing uri={author?.profileImage || null} initials={author?.initials || '··'} avc={author?.avc} size={32} state="none" />
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text variant="bodyStrong" color={ink.full} numberOfLines={1}>
                {isOwn ? 'Your story' : author?.full || 'Member'}
              </Text>
              <View style={styles.metaRow}>
                <Text variant="caption" color={ink.muted}>{adapters.timeAgo(current.createdAt)}</Text>
                {current.expiresAt ? (
                  <>
                    <Text variant="caption" color={ink.muted}> · </Text>
                    <ExpiryChip expiresAt={current.expiresAt} plain />
                  </>
                ) : null}
              </View>
            </View>
          </Touchable>

          {isVideoFrame(current) ? (
            <Touchable onPress={() => setMuted(m => !m)} feedback="scale" style={styles.headerBtn} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
              <Icon name={muted ? 'mute' : 'speaker'} size={20} color={ink.full} />
            </Touchable>
          ) : null}

          {isOwn && current.visibility ? (
            <View style={styles.headerBtn}>
              <Icon
                name={VISIBILITY_GLYPH[String(current.visibility)] ?? 'globe'}
                size={16}
                color={ink.muted}
                filled={current.visibility === 'CLOSE_FRIENDS'}
              />
            </View>
          ) : null}

          <Touchable onPress={() => setActions(true)} feedback="scale" style={styles.headerBtn} accessibilityLabel="More">
            <Icon name="more" size={20} color={ink.full} />
          </Touchable>
          <Touchable onPress={onClose} feedback="scale" style={styles.headerBtn} accessibilityLabel="Close">
            <Icon name="close" size={22} color={ink.full} />
          </Touchable>
        </View>

        {held ? (
          <View style={[styles.heldRow, { top: insets.top + 74 }]} pointerEvents="none">
            <ModerationBadge item={current} size="chip" />
            <Text variant="caption" color={ink.muted} align="ui">{HELD_NOTE}</Text>
          </View>
        ) : null}

        {poll ? (
          <View style={[styles.pollWrap, { top: pollTop }]} pointerEvents="box-none">
            <StoryPollCard
              poll={poll}
              tally={tally}
              myChoice={myChoice}
              isAuthor={isOwn}
              busy={voting || !viewerId}
              onVote={vote}
            />
          </View>
        ) : null}

        {/* Sticky, not merely bottom-anchored: an absolutely positioned bar is
            never moved by the keyboard on iOS and is not resized under Android
            edge-to-edge either, so the reply field — which swipe-up focuses
            for you — would sit behind the keyboard you just opened. The
            `opened` offset gives back the safe-area inset baked into the
            padding, leaving the 10pt breath above the keyboard rather than
            inset + 10. */}
        <KeyboardStickyView
          offset={{ closed: 0, opened: insets.bottom }}
          style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]}
          pointerEvents="box-none"
        >
          {isOwn ? (
            <View style={styles.ownBar}>
              <Touchable
                onPress={() => currentId && router.push(`/story/insights/${currentId}` as any)}
                feedback="dim"
                noAutoHitSlop
                style={styles.viewerCluster}
                accessibilityLabel="Story insights"
              >
                {viewers?.length ? (
                  <View style={styles.stack}>
                    {viewers.slice(0, 3).map((v, i) => (
                      <View key={v.id} style={{ marginStart: i === 0 ? 0 : -6, borderRadius: 12, borderWidth: 1.5, borderColor: BLACK }}>
                        <StoryRing uri={v.profileImage || null} initials={v.initials || '?'} avc={v.avc} size={20} state="none" />
                      </View>
                    ))}
                  </View>
                ) : null}
                <Icon name="eye" size={19} color={ink.full} />
                {viewCount != null ? (
                  <Text variant="callout" weight="600" color={ink.full}>{viewCount}</Text>
                ) : null}
              </Touchable>

              <View style={styles.ownActions}>
                <Touchable onPress={() => setHighlightSheet(true)} feedback="scale" accessibilityLabel="Add to highlight" style={styles.ownBtn}>
                  <Icon name="bookmark" size={22} color={ink.full} />
                </Touchable>
                <Touchable onPress={() => setConfirmDelete(true)} feedback="scale" accessibilityLabel="Delete story" style={styles.ownBtn}>
                  <Icon name="trash" size={21} color={ink.full} />
                </Touchable>
                <Touchable onPress={() => setActions(true)} feedback="scale" accessibilityLabel="More" style={styles.ownBtn}>
                  <Icon name="more" size={22} color={ink.full} />
                </Touchable>
              </View>
            </View>
          ) : viewerId ? (
            <StoryReplyBar
              author={author ? { id: String(author.id), full: author.full } : null}
              onSend={text => { if (author?.id) void sendDM(String(author.id), text, storyLink || undefined) }}
              onReact={emoji => { if (author?.id) void sendDM(String(author.id), emoji) }}
              onFocusChange={setReplyFocused}
              focusSignal={focusSignal}
            />
          ) : (
            <Text variant="footnote" color={ink.muted} align="center">Sign in to reply</Text>
          )}
        </KeyboardStickyView>
      </Animated.View>

      <StoryActionsSheet
        visible={actions}
        onClose={() => setActions(false)}
        story={current}
        isOwner={isOwn}
        onInsights={() => currentId && router.push(`/story/insights/${currentId}` as any)}
        onAddToHighlight={() => setHighlightSheet(true)}
        onDelete={() => setConfirmDelete(true)}
        onProfile={() => author?.id && router.push(`/u/${author.handle || author.id}` as any)}
        onMute={async () => {
          try {
            await api.settings.privacy.muted.mute(authorId)
            toast.ok('Stories muted')
          } catch (e: any) { toast.error(errorText(e)) }
        }}
        onReport={() => setReporting(true)}
        onShare={() => { void Share.share({ message: storyLink }) }}
        onCopyLink={async () => { await Clipboard.setStringAsync(storyLink); toast.ok('Link copied') }}
        onSendMessage={() => router.push({
          pathname: '/chat/share',
          params: {
            url: storyLink,
            kind: 'story',
            label: author?.handle ? `Story by @${author.handle}` : 'Story',
          },
        })}
      />

      <ReportStorySheet visible={reporting} onClose={() => setReporting(false)} storyId={currentId} />

      <AddToHighlightSheet
        visible={highlightSheet}
        onClose={() => setHighlightSheet(false)}
        viewerId={viewerId}
        story={current}
      />

      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this story?"
        message="People who haven't seen it won't be able to. This can't be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
      />
    </View>
  )
}

/* ---------------------------------------------------------
   Failure, and the one hearted frame.
   --------------------------------------------------------- */

function ViewerError({ error, onRetry, onClose }: { error: any; onRetry: () => void; onClose: () => void }) {
  const gone = isNotFound(error)
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: BLACK, padding: space.xxxl, gap: space.sm2 }]}>
      <Icon name={isNetworkError(error) ? 'offline' : 'error'} size={40} color={ink.muted} />
      <Text variant="title3" color={ink.full} align="center">
        {gone ? 'This story is no longer available.' : errorText(error)}
      </Text>
      {!gone ? <Button label="Try again" onPress={onRetry} variant="tinted" style={{ marginTop: space.sm2 }} /> : null}
      <Touchable onPress={onClose} feedback="dim" style={{ padding: space.md }}>
        <Text variant="subhead" color={ink.muted} align="center">Close</Text>
      </Touchable>
    </View>
  )
}

function Heart({ index, onDone }: { index: number; onDone: () => void }) {
  const { ms } = useTheme()
  const y = useSharedValue(0)
  const scale = useSharedValue(0)
  const opacity = useSharedValue(1)
  /* The parent re-renders constantly while a story plays; a burst that
     restarted every time would never finish. */
  const done = React.useRef(onDone)
  done.current = onDone
  /* Stable, and reads `done.current` at call time — a worklet captures the ref
     object by value, so dereferencing it on the UI thread would freeze on
     whichever `onDone` existed when the chain was built. */
  const finish = React.useCallback(() => done.current(), [])

  React.useEffect(() => {
    /* One UI-thread chain instead of two JS timers: the burst fires while a
       video is decoding, which is exactly the moment a setTimeout lands late
       and the stagger falls apart. The fade's completion is what unmounts the
       heart, so a cut-short chain leaves nothing behind. */
    /* Resolved here, not inside the callbacks: `ms` is a JS closure and a
       withTiming completion is a worklet — calling it from the UI thread
       throws. Numbers cross the boundary; functions do not. */
    const stagger = ms(index * 60)
    const rise = ms(900)
    const pop = ms(220)
    const settle = ms(680)
    y.value = withDelay(stagger, withTiming(-140, { duration: rise, easing: Easing.out(Easing.quad) }))
    scale.value = withDelay(stagger, withTiming(1.4, { duration: pop }, finished => {
      if (finished) scale.value = withTiming(0.9, { duration: settle })
    }))
    opacity.value = withDelay(stagger, withTiming(0, { duration: rise }, finished => {
      if (finished) runOnJS(finish)()
    }))
    return () => { cancelAnimation(y); cancelAnimation(scale); cancelAnimation(opacity) }
  }, [index, opacity, scale, y, ms, finish])

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { translateX: (index - 1) * 26 }, { scale: scale.value }],
    opacity: opacity.value,
  }))

  return (
    <Animated.View style={[styles.heart, anim]} pointerEvents="none">
      <Icon name="heart" size={46} color={night.danger} filled />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', left: 10, right: 10 },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 },
  header: { position: 'absolute', left: 0, right: 0, height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, gap: space.xs },
  headerWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  heldRow: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pollWrap: { position: 'absolute', left: 24, right: 24 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  ownBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 },
  viewerCluster: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stack: { flexDirection: 'row', alignItems: 'center' },
  ownActions: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  ownBtn: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' },
  heart: { position: 'absolute', bottom: '38%', left: 0, right: 0, alignItems: 'center' },
  /* The reader-only tap zones — the same 30/70 split `zoneTap` uses. */
  zones: { flex: 1, flexDirection: 'row' },
  zone: { flex: 1 },
})
