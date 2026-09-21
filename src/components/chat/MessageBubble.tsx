/* =========================================================
   The bubble.

   Everything a message can be, in one component, because the
   alternative is a tombstone that forgets its reply strip and a
   forward that forgets its ticks.

   The pieces that are contract rather than taste:

   · TOMBSTONES. `deletedBy` is knowable only from the live
     `message.deleted` frame — the REST row does not carry one.
     So the copy is impersonal when it is null: in a group an
     admin very often did the deleting, and "You deleted this"
     under someone else's name is worse than saying less.
   · RUNS. Consecutive bubbles from one sender inside five
     minutes collapse: the name rides the FIRST, the avatar the
     LAST. Putting the avatar on the first leaves it floating
     beside nothing when the run is three bubbles tall.
   · THE FONT SCALE. Message text is the one place in the app
     that reads a size off chatPrefs rather than a type variant
     — that setting exists to scale exactly this text, and
     nothing else on the screen.
   · THE SKIN TINT touches the INCOMING bubble only. The own
     bubble is the brand fill with a whole family of
     light-on-dark children (meta, ticks, waveform, file glyph)
     hanging off it; repainting it from a user preference would
     leave every one of them illegible.
   · THE TAIL (web chat.css §5). Bubbles hold the crown on every
     corner; only the LAST bubble of a run squares its tail-side
     bottom corner to the grouped 6 — bottom-start incoming,
     bottom-end outgoing — the web's `.ch-row.run-end` treatment.
     Mid-run bubbles stay fully crowned. All logical Start/End
     props, so RTL mirrors the tail free.
   · SCALARS ONLY. A thread renders hundreds of these under
     React.memo and the screen re-renders on every arriving
     frame, so nothing object-shaped is allowed through the
     props: the conversation arrives as the three fields this
     component actually reads, and the bubble's width arrives
     measured rather than through a per-bubble
     useWindowDimensions subscription. The composed gesture is
     memoized for the same reason — GestureDetector diffs it by
     identity and re-registers the whole handler config with the
     native module when it changes.
   ========================================================= */
import { isTmpId } from '@/api'
import { isNsfwBlocked, moderationText } from '@/lib/moderation'
import { mentionSpans } from '@/lib/richtext'
import { mixHex, withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, setback, shape, space } from '@/theme/tokens'
import { Avatar, Icon, NumericText, Text, Touchable, fireHaptic } from '@/ui'
import { LinearGradient } from 'expo-linear-gradient'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { splitShareBody } from '@/lib/shareLinks'
import { clockTime, snippetOf } from './format'
import { MediaGrid } from './MediaGrid'
import { ContactCard, FileTile, LocationCard, PollCard } from './Payloads'
import { ShareCard } from './ShareCard'
import { ReactionChips, type Reaction } from './ReactionChips'
import { Ticks } from './Ticks'
import { VoiceNote } from './VoiceNote'

const REPLY_THRESHOLD = 64

export interface MessageBubbleProps {
  message: any
  mine: boolean
  myId: string | null
  /* The conversation, as the three SCALARS this component reads. The row object
     itself gets a new identity on every `message.new` and every `receipt.read`
     frame (ChatContext patches it in place), so passing it would miss the memo
     for every visible bubble on a purely cosmetic realtime frame. */
  isGroup: boolean
  peerLastReadMessageId?: string | null
  peerLastDeliveredMessageId?: string | null
  /** The bubble's own width cap, measured once by the screen. */
  maxWidth: number
  chatSettings: { readReceiptsEnabled: boolean }
  skin: { bubbleIn: string; bubbleInText: string; bubbleOut: string; bubbleOutText: string; fontScale: number }
  /** First of a run — carries the sender name in a group. */
  runStart: boolean
  /** Last of a run — carries the avatar. */
  runEnd: boolean
  authorName: string
  authorAvatar?: string | null
  /** Emoji this device applied while the row still lacks `reactedByMe`. */
  localReaction?: string | null
  highlighted?: boolean
  selectMode?: boolean
  selected?: boolean
  /* Every callback receives the MESSAGE first. The thread renders hundreds of
     these under React.memo, and message-first handlers are what let the screen
     pass ONE stable function to every row instead of a per-row closure — the
     difference between the memo holding and every visible bubble re-rendering
     on each screen render. */
  onLongPress: (message: any, layout: { y: number; height: number }) => void
  /** Plain-text bubble, quick tap: the reaction bar only, never the action sheet. */
  onTapReact: (message: any, layout: { y: number; height: number }) => void
  onReply: (message: any) => void
  onQuickReact: (message: any) => void
  onReplyPress: (messageId: string) => void
  onMediaPress: (message: any, index: number) => void
  onFilePress: (media: any) => void
  onToggleReaction: (message: any, emoji: string) => void
  onOpenReactionDetail: (message: any) => void
  onRetry: (message: any) => void
  /** Drops a failed optimistic bubble whose send can never succeed (the image
   *  gate's terminal refusal) — the affordance the retry chip is replaced by. */
  onDiscard?: (message: any) => void
  onVote: (message: any, indexes: number[]) => void
  onRetractVote: (message: any) => void
  onClosePoll?: (message: any) => void
  onSelectToggle?: (message: any) => void
  onAvatarPress?: (message: any) => void
  /** The contact card's actions — absent handlers hide the buttons rather
   *  than render dead ones. */
  onContactMessage?: (userId: string) => void
  onContactSave?: (contact: any) => void
}

/** @mentions get the accent; nothing else in a chat body is linkified, because
 *  a chat message is not a post and a WebView is never an option here. */
function Body({ text, color, accent, size, lineHeight }: {
  text: string; color: string; accent: string; size: number; lineHeight: number
}) {
  /* The shared server grammar (@/lib/richtext), not a local one: the old
     pattern capped handles at 30 and guarded nothing before the `@`, so a
     40-character handle went unmarked while `you@example.com` lit up as a
     mention of "example". Deliberately not pressable — a chat message is not
     a post. */
  const parts = React.useMemo(() => {
    const body = String(text)
    const out: { key: string; text: string; mention: boolean }[] = []
    let at = 0
    for (const m of mentionSpans(body)) {
      if (m.start > at) out.push({ key: `t${at}`, text: body.slice(at, m.start), mention: false })
      out.push({ key: `m${m.start}`, text: body.slice(m.start, m.end), mention: true })
      at = m.end
    }
    if (at < body.length) out.push({ key: `t${at}`, text: body.slice(at), mention: false })
    return out
  }, [text])
  return (
    <Text align="auto" color={color} style={{ fontSize: size, lineHeight }} selectable>
      {parts.map(p => (
        p.mention
          ? <Text key={p.key} color={accent} weight="600" style={{ fontSize: size, lineHeight }}>{p.text}</Text>
          : p.text
      ))}
    </Text>
  )
}

function MessageBubbleInner(props: MessageBubbleProps) {
  const {
    message, mine, myId, isGroup, peerLastReadMessageId, peerLastDeliveredMessageId, maxWidth,
    chatSettings, skin, runStart, runEnd, authorName, authorAvatar,
    localReaction, highlighted, selectMode, selected,
    onLongPress, onTapReact, onReply, onQuickReact, onReplyPress, onMediaPress, onFilePress,
    onToggleReaction, onOpenReactionDetail, onRetry, onDiscard, onVote, onRetractVote, onClosePoll,
    onSelectToggle, onAvatarPress, onContactMessage, onContactSave,
  } = props

  const t = useTheme()
  const c = t.colors
  const rowRef = React.useRef<View>(null)

  const pending = isTmpId(message.id) && !message.failed
  const failed = !!message.failed
  const dead = !!message.deleted

  const bg = mine ? skin.bubbleOut : skin.bubbleIn
  const fg = mine ? skin.bubbleOutText : skin.bubbleInText
  const fgMuted = withAlpha(fg, 0.62)
  /* `sky` is the fixed on-navy accent (colors.ts): mentions, reply titles
     and the reply bar inside own bubbles. Incoming keeps accentText. */
  const accentOn = mine ? c.sky : c.accentText
  /* Reply-quote start bar (web .ch-quote): link blue inside incoming, the
     light on-navy accent inside own — the web goes white-alpha there; sky IS
     this system's on-dark accent, so sky it is. */
  const replyBar = mine ? c.sky : c.link
  /* The quote's caption ink (web .ch-quote-who): scholar mid-blue incoming,
     sky on the navy plate. */
  const quoteWho = mine ? c.sky : c.scholarText

  const fontSize = Math.round(t.type.body.fontSize * skin.fontScale * 10) / 10
  const lineHeight = Math.round(t.type.body.lineHeight * skin.fontScale * 10) / 10

  /* ---- swipe to reply ---- */
  /* JS-side wrappers for the worklets: `message` can carry non-serialisable
     fields (a failed send keeps its Error), so it must never cross the
     runOnJS boundary as an argument. */
  const replyThis = React.useCallback(() => onReply(message), [onReply, message])
  const quickReactThis = React.useCallback(() => onQuickReact(message), [onQuickReact, message])

  const dx = useSharedValue(0)
  /* UI-thread mirror of `armed`: the threshold check runs per pan frame, but
     the runOnJS hop happens only on a TRANSITION across it — two hops per
     swipe instead of one per frame. */
  const armedSV = useSharedValue(false)
  const armed = React.useRef(false)

  const arm = React.useCallback((on: boolean) => {
    if (armed.current === on) return
    armed.current = on
    if (on) fireHaptic('light')
  }, [])

  const measureAndOpen = React.useCallback(() => {
    rowRef.current?.measureInWindow((_x, y, _w, h) => onLongPress(message, { y, height: h }))
  }, [onLongPress, message])

  const measureAndOpenReactPicker = React.useCallback(() => {
    rowRef.current?.measureInWindow((_x, y, _w, h) => onTapReact(message, { y, height: h }))
  }, [onTapReact, message])

  /* Every per-message affordance below is a raw gesture (pan, long-press,
     double-tap) and gestures never receive accessibility activations — so
     without these, a screen-reader user could not reply to, react to, or open
     the menu on any message (the menu is also the ONLY door into select
     mode). Same pattern as qna/DraggableRows. The row collapses into one
     accessible element only for PLAIN TEXT bubbles under a running reader:
     media grids, voice transports and poll options carry their own reachable
     children, and swallowing those would trade one gap for another. */
  const screenReader = t.a11y.screenReader
  const a11yActions = React.useMemo(() => (
    dead || pending || !screenReader ? undefined : [
      { name: 'reply', label: 'Reply' },
      { name: 'react', label: 'React with a heart' },
      { name: 'menu', label: 'Message actions' },
    ]
  ), [dead, pending, screenReader])
  const onA11yAction = React.useCallback((e: any) => {
    const name = e?.nativeEvent?.actionName
    if (name === 'reply') replyThis()
    else if (name === 'react') quickReactThis()
    else if (name === 'menu') measureAndOpen()
  }, [replyThis, quickReactThis, measureAndOpen])

  /* ONE object per (enabled-ness, direction, handlers). GestureDetector diffs
     the composed gesture by identity and re-registers its whole handler config
     with the native gesture-handler module when it changes — rebuilding four
     of these per render meant every arriving message re-registered gestures
     for the entire visible thread. */
  /* One of our short links in a TEXT body IS a share (lib/shareLinks): the
     card takes the link, the caption keeps the Body. Media messages keep
     their body untouched — a link under a photo is just prose. */
  const share = React.useMemo(
    () => (!dead && message.body && !(message.media || []).length && !message.poll
      ? splitShareBody(message.body)
      : null),
    [dead, message.body, message.media, message.poll],
  )

  /* Single-tap-shows-reactions is TEXT-ONLY: media grids, file tiles, voice
     transports, poll options and share cards all carry their own tappable
     children, and a bubble-level tap firing beside them would open the menu
     on every play press. A plain text bubble has no child claims, so the tap
     is free. */
  const plainText = !dead && !pending && !(message.media || []).length && !message.poll && !share

  const gesture = React.useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(!selectMode && !dead && !pending)
      .activeOffsetX(t.isRTL ? [-18, 9999] : [-9999, 18])
      .failOffsetY([-14, 14])
      .onUpdate(e => {
        const raw = t.isRTL ? -e.translationX : e.translationX
        dx.value = Math.max(0, Math.min(REPLY_THRESHOLD + 16, raw)) * (t.isRTL ? -1 : 1)
        const on = Math.abs(dx.value) >= REPLY_THRESHOLD
        if (on !== armedSV.value) { armedSV.value = on; runOnJS(arm)(on) }
      })
      .onEnd(() => {
        if (Math.abs(dx.value) >= REPLY_THRESHOLD) runOnJS(replyThis)()
        if (armedSV.value) { armedSV.value = false; runOnJS(arm)(false) }
        dx.value = withSpring(0, t.motion.spring)
      })

    const press = Gesture.LongPress()
      .minDuration(320)
      .onStart(() => {
        runOnJS(fireHaptic)('medium')
        runOnJS(measureAndOpen)()
      })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(240)
      .onEnd((_e, ok) => { if (ok) runOnJS(quickReactThis)() })

    /* One tap shows ONLY the quick-reaction bar — never the action sheet,
       that is what a hold is for. maxDuration under the long-press threshold
       so a hold is never eaten, and Exclusive ordering makes it wait out the
       double-tap window first. */
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(280)
      .enabled(plainText && !selectMode)
      .onEnd((_e, ok) => { if (ok) runOnJS(measureAndOpenReactPicker)() })

    return Gesture.Simultaneous(pan, Gesture.Exclusive(doubleTap, press, singleTap))
  }, [selectMode, dead, pending, plainText, t.isRTL, t.motion.spring, dx, armedSV, arm,
    replyThis, quickReactThis, measureAndOpen, measureAndOpenReactPicker])

  /* ---- send landing ---- */
  /* A fresh optimistic send lands with the brick spring (DESIGN.md §7): one
     1pt over-drop from +6 while the opacity rides in. Only a still-pending
     own message on FIRST mount animates — history rows and recycled mounts
     start settled, and the ref keeps re-renders from replaying it. Reduced
     motion degrades to a cut via t.ms(). */
  const landing = React.useRef(mine && pending)
  const drop = useSharedValue(landing.current ? 6 : 0)
  const settle = useSharedValue(landing.current ? 0 : 1)
  React.useEffect(() => {
    if (!landing.current) return
    landing.current = false
    drop.value = t.ms(1) ? withSpring(0, t.motion.spring) : 0
    settle.value = withTiming(1, { duration: t.ms(t.motion.fast) })
  }, [drop, settle, t])

  /* Inbound arrivals take the same landing: the spring existed but was gated
     to my own pending sends, so the other side's messages appeared as a
     jump-cut. FRESHNESS-gated, not mount-gated — recycling a history row
     while scrolling must never replay it, and only a message seconds old is
     an arrival. */
  React.useEffect(() => {
    if (mine) return
    const at = new Date(message.createdAt || 0).getTime()
    if (!Number.isFinite(at) || Date.now() - at > 3000) return
    drop.value = 6
    settle.value = 0
    drop.value = t.ms(1) ? withSpring(0, t.motion.spring) : 0
    settle.value = withTiming(1, { duration: t.ms(t.motion.fast) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: drop.value }],
    opacity: settle.value,
  }))

  /* A 900ms flash when a reply strip or a search hit jumps here. */
  const flash = useSharedValue(0)
  React.useEffect(() => {
    if (!highlighted) return
    flash.value = 1
    flash.value = withTiming(0, { duration: t.ms(900) })
  }, [highlighted, flash, t])
  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: flash.value > 0 ? withAlpha(c.accent, 0.14 * flash.value) : 'transparent',
  }))

  /* ---- content ---- */

  const reactions: Reaction[] = message.reactions || []
  /* Three passes over the attachment array, memoized on it: a re-render caused
     by a sibling bubble must not re-split this one's media. */
  const { voice, files, visual } = React.useMemo(() => {
    const media = message.media || []
    return {
      voice: media.find((m: any) => m.kind === 'VOICE'),
      files: media.filter((m: any) => m.kind === 'FILE'),
      visual: media.filter((m: any) => m.kind === 'IMAGE' || m.kind === 'VIDEO'),
    }
  }, [message.media])

  /* A voice message is bubble content like any other now: the transport
     renders bare (see ./VoiceNote.tsx) and the bubble is its container, so
     there is no longer a plate for the shell to get out of the way of. */
  const shellPadding = 13
  const contentWidth = maxWidth - shellPadding * 2

  /* One ICU format per message, not per render — see ./format.ts. */
  const clock = React.useMemo(() => clockTime(message.createdAt), [message.createdAt])

  /* Meta ink (DESIGN.md §6): textFaint inside incoming bubbles, the bubble's
     warm white at 0.72 on the navy plate. Over full-bleed media the meta
     rides an overlay chip and takes the fixed overlay ink instead. A
     tombstone is a LIGHT plate whichever side it sits on, so its meta drops
     to the quiet slate too — the web restates exactly this (§14). */
  const metaOnMedia = visual.length > 0 && !message.body
  const metaColor = metaOnMedia ? c.overlayTextMuted
    : dead ? c.textFaint
      : mine ? withAlpha(fg, 0.72) : c.textFaint

  /* The tail — only the run's LAST bubble squares its tail-side corner. */
  const { crown, grouped } = t.shape.bubble
  const tailBottom = runEnd ? grouped : crown

  /* The tombstone plate is off-white with a dashed stone course on BOTH
     sides (web .ch-bubble.deleted), so its ink is the fixed muted slate —
     the bubble's own light-on-navy family would vanish on it. */
  const tombstone = (
    <View style={styles.tombstone}>
      <Icon name="block" size={13} color={c.textMuted} />
      <Text variant="footnote" italic color={c.textMuted} align="auto">
        {message.deletedBy && myId && String(message.deletedBy) === String(myId)
          ? 'You deleted this message'
          : message.deletedBy
            ? 'Deleted by an admin'
            /* Nobody told us who: stay impersonal rather than guess. */
            : 'This message was deleted'}
      </Text>
    </View>
  )

  return (
    <Animated.View style={[styles.wrap, flashStyle, selected ? { backgroundColor: c.accentSofter } : null]}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.row,
            { justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: runStart ? 12 : 2 },
            slide,
          ]}
          accessible={screenReader && plainText && !selectMode ? true : undefined}
          accessibilityActions={a11yActions}
          onAccessibilityAction={a11yActions ? onA11yAction : undefined}
        >
          {selectMode ? (
            /* Pure glyph now — the WHOLE ROW is the tap target (the overlay
               at the bottom of this view), so nobody has to aim for a 22px
               circle to pick a message. This just shows the answer. */
            <View style={styles.checkbox}>
              <Icon
                name={selected ? 'checkCircle' : 'addCircle'}
                size={22}
                color={selected ? c.accent : c.textFaint}
                filled={selected}
              />
            </View>
          ) : null}

          {!mine ? (
            <View style={styles.avatarSlot}>
              {runEnd ? (
                <Avatar
                  uri={authorAvatar}
                  name={authorName}
                  seed={message.senderId}
                  size={28}
                  onPress={onAvatarPress ? () => onAvatarPress(message) : undefined}
                />
              ) : null}
            </View>
          ) : null}

          <View ref={rowRef} collapsable={false} style={{ maxWidth, alignItems: mine ? 'flex-end' : 'flex-start' }}>
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: dead ? c.bgSunken : bg,
                  opacity: failed ? 0.55 : 1,
                  /* The crown holds everywhere; only the run's LAST bubble
                     squares its tail-side bottom corner — bottom-start
                     incoming, bottom-end outgoing (web .ch-row.run-end). */
                  borderTopStartRadius: crown,
                  borderTopEndRadius: crown,
                  borderBottomStartRadius: mine ? crown : tailBottom,
                  borderBottomEndRadius: mine ? tailBottom : crown,
                  /* Incoming plates are drawn — 1px course; the navy plate
                     carries none. A tombstone is dashed stone on BOTH sides
                     (web .ch-bubble.deleted). */
                  borderWidth: dead || !mine ? rule.course : 0,
                  borderColor: c.border,
                  borderStyle: dead ? 'dashed' : 'solid',
                  /* Web .ch-bubble: 9px 13px 8px; media-only collapses to a
                     4pt frame around the album. */
                  paddingHorizontal: visual.length && !message.body ? 4 : shellPadding,
                  paddingTop: visual.length && !message.body ? 4 : 9,
                  paddingBottom: visual.length && !message.body ? 4 : 8,
                },
              ]}
            >
              {mine && !dead && t.scheme === 'dark' && skin.bubbleOut === c.bubbleOut ? (
                /* The one sanctioned decorative gradient in the app (DESIGN.md
                   §5): the dark own-bubble plate, bubbleOut lifted faintly
                   toward sky, vertical, clipped by the bubble's overflow. */
                <LinearGradient
                  pointerEvents="none"
                  colors={[c.bubbleOut, mixHex(c.sky, c.bubbleOut, 0.05)]}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {dead ? tombstone : (
                <>
                  {runStart && !mine && isGroup ? (
                    /* The sender signature (web .ch-sender): scholar blue —
                       navy by day, Sky by night, exactly the web's --navy —
                       bold and NEVER shouted, so no caps variant here. */
                    <Text variant="footnote" weight="700" color={c.scholar} align="auto" numberOfLines={1} style={styles.sender}>
                      {authorName}
                    </Text>
                  ) : null}

                  {message.forwardedFrom ? (
                    <View style={styles.forwardRow}>
                      <Icon name="forwardMsg" size={12} color={fgMuted} />
                      {/* Sentence case, like the web's italic marker — the
                          micro variant's caps are undone at the call site. */}
                      <Text variant="micro" italic color={fgMuted} align="ui" style={styles.noCaps}>Forwarded</Text>
                    </View>
                  ) : null}

                  {message.replyTo ? (
                    <Touchable
                      onPress={() => onReplyPress(message.replyTo.messageId)}
                      feedback="dim"
                      noAutoHitSlop
                      style={[styles.replyStrip, { backgroundColor: withAlpha(fg, mine ? 0.12 : 0.08), borderStartColor: replyBar }]}
                    >
                      <Text variant="micro" weight="700" color={quoteWho} align="auto" numberOfLines={1} style={styles.noCaps}>
                        {message.replyTo.senderId === message.senderId ? authorName : 'Reply'}
                      </Text>
                      <Text variant="micro" italic={message.replyTo.deleted} color={fgMuted} align="auto" numberOfLines={2} style={styles.noCaps}>
                        {message.replyTo.deleted
                          ? 'Message deleted'
                          /* The wire snippet is the raw body — run it through
                             snippetOf so a reply to a share quotes "Shared a
                             post", not the bare short link. */
                          : snippetOf(message.replyTo.snippet ? { ...message.replyTo, body: message.replyTo.snippet, deleted: false } : message.replyTo)}
                      </Text>
                    </Touchable>
                  ) : null}

                  {visual.length ? (
                    <MediaGrid
                      media={visual}
                      maxWidth={contentWidth}
                      pending={pending}
                      onPress={index => onMediaPress(message, index)}
                      style={message.body ? { marginBottom: space.xs2 } : undefined}
                    />
                  ) : null}

                  {voice ? (
                    <View style={{ width: contentWidth, marginVertical: space.xxs }}>
                      {/* The same control the voice POST renders (see
                          @/components/media/VoiceTransport), minus its plate:
                          the bubble is the container, so the transport takes
                          the bubble's ink — the run of this file's own
                          per-side palette, which is why fg and accentOn are
                          handed over rather than a second ground. */}
                      <VoiceNote
                        media={voice}
                        messageId={String(message.id)}
                        fg={fg}
                        accent={accentOn}
                        onDark={mine}
                      />
                    </View>
                  ) : null}

                  {files.map((f: any, i: number) => (
                    <View key={String(f.storageKey || i)} style={{ marginVertical: space.xs }}>
                      <FileTile media={f} fg={fg} fgMuted={fgMuted} onPress={() => onFilePress(f)} />
                    </View>
                  ))}

                  {message.location ? (
                    <LocationCard location={message.location} fg={fg} fgMuted={fgMuted} width={contentWidth} />
                  ) : null}

                  {message.contact ? (
                    <ContactCard
                      contact={message.contact}
                      fg={fg}
                      fgMuted={fgMuted}
                      onMessage={onContactMessage}
                      onSave={onContactSave ? () => onContactSave(message.contact) : undefined}
                    />
                  ) : null}

                  {message.poll ? (
                    <PollCard
                      poll={message.poll}
                      fg={fg}
                      fgMuted={fgMuted}
                      accent={mine ? withAlpha(fg, 0.85) : c.accent}
                      width={contentWidth}
                      onVote={indexes => onVote(message, indexes)}
                      onRetract={() => onRetractVote(message)}
                      onClose={onClosePoll ? () => onClosePoll(message) : undefined}
                      canClose={!!onClosePoll}
                    />
                  ) : null}

                  {share ? (
                    <ShareCard
                      share={share.share}
                      fg={fg}
                      fgMuted={fgMuted}
                      accent={quoteWho}
                      width={contentWidth}
                      onDark={mine}
                    />
                  ) : null}

                  {share ? (
                    share.rest ? (
                      <Body text={share.rest} color={fg} accent={accentOn} size={fontSize} lineHeight={lineHeight} />
                    ) : null
                  ) : message.body ? (
                    <Body text={message.body} color={fg} accent={accentOn} size={fontSize} lineHeight={lineHeight} />
                  ) : null}

                  {!message.body && !visual.length && !voice && !files.length
                    && !message.location && !message.contact && !message.poll ? (
                    /* A type this build doesn't render (the channel enum is
                       wider than the DM one) must say so — a blank bubble
                       reads as a bug, not a message. */
                      <Text variant="footnote" italic color={fgMuted} align="auto">
                        This message can’t be shown here
                      </Text>
                    ) : null}
                </>
              )}

              <View
                style={[
                  styles.meta,
                  metaOnMedia ? [styles.metaOverlay, { backgroundColor: c.overlayChip }] : null,
                ]}
              >
                {message.editedAt && !dead ? (
                  <Text variant="micro" italic color={metaColor} style={styles.noCaps}>edited</Text>
                ) : null}
                <NumericText variant="micro" color={metaColor}>{clock}</NumericText>
                {mine && !dead ? (
                  <Ticks
                    messageId={String(message.id)}
                    peerLastReadMessageId={peerLastReadMessageId}
                    peerLastDeliveredMessageId={peerLastDeliveredMessageId}
                    pending={pending}
                    failed={failed}
                    receiptsEnabled={chatSettings.readReceiptsEnabled}
                    color={metaColor}
                    size={13}
                  />
                ) : null}
              </View>
            </View>

            {failed ? (
              isNsfwBlocked(message._error) ? (
                /* The image gate refused this upload — terminal, so no retry
                   chip: the same bytes score the same. The server's own copy,
                   verbatim, and a Remove that drops the pending bubble
                   (image-moderation-frontend.md). Never a blocking Alert over
                   the conversation. */
                <View style={[styles.retry, { backgroundColor: c.dangerSoft, maxWidth }]}>
                  <Text variant="micro" tone="danger" align="ui" style={[styles.noCaps, styles.blockCopy]}>
                    {moderationText(message._error)}
                  </Text>
                  {onDiscard ? (
                    <Touchable onPress={() => onDiscard(message)} feedback="dim" noAutoHitSlop hitSlop={6} accessibilityLabel="Remove this message">
                      <Text variant="micro" weight="700" tone="danger" align="ui" style={styles.noCaps}>Remove</Text>
                    </Touchable>
                  ) : null}
                </View>
              ) : (
                /* Danger on its wash (web .ch-retry) — the status-pill grammar,
                   as a chip rather than a lozenge. */
                <Touchable onPress={() => onRetry(message)} feedback="dim" noAutoHitSlop style={[styles.retry, { backgroundColor: c.dangerSoft }]}>
                  <Icon name="refresh" size={12} color={c.danger} />
                  <Text variant="micro" tone="danger" align="ui" style={styles.noCaps}>Tap to retry</Text>
                </Touchable>
              )
            ) : null}

            {!dead && reactions.length ? (
              <ReactionChips
                reactions={reactions}
                authoritative={!!message._reactionsAuthoritative}
                localMine={localReaction}
                mine={mine}
                onToggle={emoji => onToggleReaction(message, emoji)}
                onOpenDetail={() => onOpenReactionDetail(message)}
              />
            ) : null}
          </View>
        </Animated.View>
      </GestureDetector>

      {selectMode ? (
        /* Selection is modal: while it is on, the WHOLE ROW is one big
           checkbox. The overlay sits on top of every inner control (play
           buttons, media, polls), which is exactly right — a tap in select
           mode means "this one", never "play this". It carries the checkbox
           semantics the glyph used to, so a screen reader still hears a named,
           stateful checkbox per row instead of a scatter of buttons. */
        <Touchable
          onPress={() => { fireHaptic('select'); onSelectToggle?.(message) }}
          feedback="none"
          noAutoHitSlop
          accessibilityRole="checkbox"
          accessibilityLabel="Select message"
          accessibilityState={{ checked: !!selected }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </Animated.View>
  )
}

export const MessageBubble = React.memo(MessageBubbleInner)

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.sm2 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs2 },
  avatarSlot: { width: 28 },
  checkbox: { paddingEnd: space.xs, alignSelf: 'center' },
  /* Corner radii live inline (they depend on mine/run position);
     borderCurve is a no-op off iOS. */
  bubble: { overflow: 'hidden', borderCurve: 'continuous' },
  /* Web .ch-sender: bold blue signature with a breath before the body. */
  sender: { marginBottom: space.xxs },
  /* The caps variants shout; chat quotes these strings in the web's sentence
     case, so the transform (and its tracking) is undone where they meet. */
  noCaps: { textTransform: 'none', letterSpacing: 0.2 },
  forwardRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xxs },
  /* The 3pt quote spine (web .ch-quote border-inline-start); the strip is a
     10pt plate — the web's quote radius, the field shape here. */
  replyStrip: {
    borderStartWidth: rule.selvedge,
    paddingStart: space.sm2, paddingEnd: space.sm2, paddingTop: space.xs2, paddingBottom: space.xs2,
    ...setback(shape.field), borderCurve: 'continuous',
    marginBottom: space.xs2, gap: space.xxs,
  },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: space.xs, marginTop: space.xxs },
  /* Over a full-bleed photo the meta needs its own plate or the clock lands on
     whatever the photo happens to be. */
  metaOverlay: {
    position: 'absolute', end: 9, bottom: 9,
    paddingHorizontal: space.xs2, paddingVertical: space.xxs,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  tombstone: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingVertical: space.xxs },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs,
    paddingHorizontal: space.sm2, paddingVertical: space.xs,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  /* The gate's sentence is longer than "Tap to retry" — let it wrap inside
     the chip instead of pushing Remove off the bubble. */
  blockCopy: { flexShrink: 1 },
})
