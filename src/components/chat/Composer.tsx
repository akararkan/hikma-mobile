/* =========================================================
   The composer.

   It owns three contracts that are easy to break silently:

   TYPING. One start per three seconds per conversation, an
   activity CHANGE fires immediately (going from typing to
   recording is news; typing for the ninth second is not), a
   stop is sent only when a start actually went out, and nothing
   at all is sent when the user turned typing indicators off.
   ChatContext.sendTyping enforces the throttle and the privacy
   gate; this file's job is to call it at the right moments and
   to always send the stop.

   SLOW MODE. `slowModeSeconds` throttles NON-ADMIN members
   only, so the number alone never says whether to count down —
   the caller pairs it with myRole and passes 0 for the exempt.

   DISABLED. A restricted member, an admins-only group and a
   blocked DM all lose the whole bar, replaced by a strip that
   says which. Leaving a live-looking input that 403s on send is
   the worst of the three options.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { ZoomIn, ZoomOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useEvent } from '@/hooks/useAsync'
import { useDockInset } from '@/hooks/useDockInset'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, NumericText, Text, Touchable, fireHaptic } from '@/ui'
import { snippetOf } from './format'
import { RecordingOverlay, useVoiceRecorder, type RecordingResult } from './VoiceRecorder'

const CANCEL_SLIDE = 90
const LOCK_SLIDE = 64

export type AttachKind = 'photos' | 'camera' | 'document' | 'location' | 'contact' | 'poll' | 'schedule'

export interface ComposerProps {
  disabledReason?: string | null
  reply?: any | null
  editing?: any | null
  /** Restored server-side draft, applied once. */
  initialBody?: string
  /** 429 countdown — the send button says how long, the draft is kept. */
  cooldown?: number
  /** 0 when exempt (owner/admin) or off. */
  slowModeSeconds?: number
  /** Epoch ms of my last successful send in this conversation. */
  lastSentAt?: number | null
  sending?: boolean
  enterToSend?: boolean
  /** A server message that must sit under the bar with no retry offered
   *  (CONTENT_BLOCKED_BY_POLICY, CONTENT_REJECTED). */
  notice?: string | null
  onSend: (body: string) => void
  onConfirmEdit: (body: string) => void
  onSendVoice: (rec: RecordingResult) => void
  onCancelReply: () => void
  onCancelEdit: () => void
  onDraftChange: (body: string) => void
  onTyping: (active: boolean, activity?: string) => void
  onAttach: () => void
  onSchedule: (body: string) => void
  onEmoji?: () => void
}

/* React.memo: this component re-renders with its parent screen, and the chat
   screen renders on every inbox mutation app-wide. The call site keeps every
   function prop useEvent-stable so the memo actually holds. */
export const Composer = React.memo(function Composer({
  disabledReason, reply, editing, initialBody, cooldown = 0, slowModeSeconds = 0,
  lastSentAt, sending, enterToSend, notice,
  onSend, onConfirmEdit, onSendVoice, onCancelReply, onCancelEdit,
  onDraftChange, onTyping, onAttach, onSchedule, onEmoji,
}: ComposerProps) {
  const t = useTheme()
  const c = t.colors
  /* Collapses to 0 while the keyboard is up — the screen's
     KeyboardAvoidingView already pays the overlap, and paying it twice was
     the dead band above the keys in the app's busiest screen. */
  const dock = useDockInset()
  const inputRef = React.useRef<TextInput>(null)

  const [text, setText] = React.useState('')
  const [slowLeft, setSlowLeft] = React.useState(0)
  const typingStarted = React.useRef(false)
  const seededDraft = React.useRef(false)

  const rec = useVoiceRecorder()
  const recRef = React.useRef(rec)
  recRef.current = rec
  const slide = useSharedValue(0)

  /* The server draft arrives after the first render. Apply it once, and never
     over something the user has already typed. */
  React.useEffect(() => {
    if (seededDraft.current || !initialBody) return
    seededDraft.current = true
    setText(prev => (prev ? prev : initialBody))
  }, [initialBody])

  React.useEffect(() => {
    if (!editing) return
    setText(editing.body || '')
    inputRef.current?.focus()
  }, [editing])

  React.useEffect(() => { if (reply) inputRef.current?.focus() }, [reply])

  /* Slow mode is a client-side courtesy: the 429 is authoritative, but a
     countdown the user can see beats a rejection they cannot predict. */
  React.useEffect(() => {
    if (!slowModeSeconds || !lastSentAt) { setSlowLeft(0); return }
    const tick = () => {
      const left = Math.ceil((lastSentAt + slowModeSeconds * 1000 - Date.now()) / 1000)
      setSlowLeft(Math.max(0, left))
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [slowModeSeconds, lastSentAt])

  /* Always send the stop on unmount. Without it the peer's "typing…" hangs
     around for the full Redis TTL after the user has already left. */
  React.useEffect(() => () => {
    if (typingStarted.current) onTyping(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* The recorder must not outlive the composer: 'select' mode and navigation
     both swap this component out, and useAudioRecorder alone leaves the iOS
     session in record mode. Same guard as channels/[id]/compose.tsx. */
  React.useEffect(() => () => {
    if (recRef.current.active) void recRef.current.cancel().catch(() => {})
  }, [])

  /* A member.changed frame can restrict the conversation mid-recording — the
     blocked strip replaces the overlay below, so the mic has to stop with it
     or it keeps capturing with zero indication. */
  React.useEffect(() => {
    if (disabledReason && recRef.current.active) void recRef.current.cancel().catch(() => {})
  }, [disabledReason])

  const signalTyping = React.useCallback((activity: string) => {
    typingStarted.current = true
    onTyping(true, activity)
  }, [onTyping])

  /* Keystrokes re-signal typing as a side effect of happening, but a locked
     voice recording runs for minutes with no keystrokes — and the one-shot
     signal from beginRecord dies on the peer at the ~6s TTL, mid-recording.
     Re-signal under the TTL for as long as the mic is live; the provider's
     3s throttle keeps the wire quiet. */
  React.useEffect(() => {
    if (!rec.active) return
    const id = setInterval(() => signalTyping('RECORDING_VOICE'), 4000)
    return () => clearInterval(id)
  }, [rec.active, signalTyping])

  const stopTyping = React.useCallback(() => {
    if (!typingStarted.current) return
    typingStarted.current = false
    onTyping(false)
  }, [onTyping])

  const change = (v: string) => {
    setText(v)
    onDraftChange(v)
    if (v.trim()) signalTyping('TYPING')
    else stopTyping()
  }

  const blocked = !!disabledReason
  const busy = !!sending || cooldown > 0 || slowLeft > 0
  const canSend = text.trim().length > 0 && !blocked && !busy

  const submit = () => {
    const body = text.trim()
    if (!body || blocked) return
    if (editing) { onConfirmEdit(body); setText(''); return }
    if (busy) return
    stopTyping()
    setText('')
    onDraftChange('')
    onSend(body)
  }

  /* ---- hold to record ---- */

  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  /* UI-thread latches — the armedSV rule from MessageBubble: the threshold
     test runs per move event, the runOnJS hop fires only on the false→true
     crossing. Without them the lock haptic buzzes at event rate and the
     cancel path re-runs finish() once per move until the finger lifts. */
  const cancelledSV = useSharedValue(false)
  const lockedSV = useSharedValue(false)

  /* Synchronous mirror of rec.locked: the lift's endRecord can land in the
     same JS task drain as lockRecord, BEFORE React commits setLocked — the
     render value would still read false and send the clip the user just
     locked. The ref is readable the instant the lock fires. */
  const lockedRef = React.useRef(false)

  /* useEvent, not useCallback: `rec` is a fresh object every render, and these
     feed the memoized gesture below — its identity must survive keystrokes and
     SSE frames or the memo is decorative. */
  const beginRecord = useEvent(() => {
    lockedRef.current = false
    void rec.start().then(ok => { if (ok) signalTyping('RECORDING_VOICE') }).catch(() => {})
  })

  const endRecord = useEvent(() => {
    if (lockedRef.current) return
    stopTyping()
    void rec.finish().then(result => { if (result) { signalTyping('SENDING_VOICE'); onSendVoice(result) } })
  })

  const abortRecord = useEvent(() => { stopTyping(); void rec.cancel() })
  const lockRecord = useEvent(() => { lockedRef.current = true; rec.setLocked(true); fireHaptic('success') })

  /* One TAP starts a hands-free recording: the recorder opens already LOCKED,
     so the overlay comes up with the send button showing and the clip goes
     out on the second tap. Hold-to-talk stays for press-and-release clips.
     `lockedRef` arms BEFORE start so a stray hold-lift racing the tap cannot
     reach endRecord's send; `setLocked(true)` lands after start() resolves
     because start resets the lock — both state writes batch into the same
     commit, so the overlay never flashes its unlocked (slide-to-cancel)
     dress. */
  const tapRecord = useEvent(() => {
    lockedRef.current = true
    fireHaptic('light')
    void rec.start().then(ok => {
      if (!ok) { lockedRef.current = false; return }
      rec.setLocked(true)
      signalTyping('RECORDING_VOICE')
    }).catch(() => { lockedRef.current = false })
  })

  const hasText = !!text.trim()

  /* ONE object per (enabled-ness, direction) — the MessageBubble rule: the
     composed gesture is diffed by identity and GestureDetector re-registers
     its whole native config when it moves, so a per-render rebuild meant a
     native round-trip on every keystroke and every screen render. The slide
     rides the shared value straight into the overlay — no JS hop per frame. */
  const micGesture = React.useMemo(() => {
    const hold = Gesture.LongPress()
      .minDuration(260)
      .maxDistance(10_000)
      .enabled(!blocked && !hasText)
      .onStart(e => {
        startX.value = e.absoluteX
        startY.value = e.absoluteY
        cancelledSV.value = false
        lockedSV.value = false
        runOnJS(beginRecord)()
      })
      .onTouchesMove(e => {
        const touch = e.changedTouches[0]
        if (!touch) return
        const dx = (touch.absoluteX - startX.value) * (t.isRTL ? 1 : -1)
        const dy = startY.value - touch.absoluteY
        slide.value = Math.max(0, Math.min(1, dx / CANCEL_SLIDE))
        if (dx > CANCEL_SLIDE && !cancelledSV.value) {
          cancelledSV.value = true
          runOnJS(abortRecord)()
        } else if (dy > LOCK_SLIDE && !lockedSV.value && !cancelledSV.value) {
          lockedSV.value = true
          runOnJS(lockRecord)()
        }
      })
      .onEnd(() => {
        slide.value = withSpring(0, t.motion.spring)
        runOnJS(endRecord)()
      })

    const tap = Gesture.Tap()
      .maxDuration(240)
      .enabled(!blocked && !hasText)
      .onEnd(() => { runOnJS(tapRecord)() })

    return Gesture.Exclusive(hold, tap)
  }, [blocked, hasText, t.isRTL, t.motion.spring,
    beginRecord, endRecord, abortRecord, lockRecord, tapRecord,
    slide, startX, startY, cancelledSV, lockedSV])

  const micStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + slide.value * 0.1 }] }))

  /* ---- render ---- */

  if (blocked) {
    return (
      <View style={[styles.blocked, { backgroundColor: c.surfaceSunken, paddingBottom: dock + 12, borderTopColor: c.separator }]}>
        <Icon name="lock" size={15} color={c.textMuted} />
        <Text variant="footnote" tone="muted" align="center" style={styles.flexShrink}>{disabledReason}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: dock + 6 }]}>
      {/* The recorder's poll engine — null until a recording starts. */}
      {rec.engine}
      {/* The recording UI is an OVERLAY, not a replacement. Swapping the row
          out would unmount the mic's GestureDetector mid-gesture, which
          cancels the very long-press that started the recording — the
          recording would then end on the frame it began. */}
      {rec.active ? (
        <View style={[styles.recordCover, { backgroundColor: c.bg }]}>
          <RecordingOverlay
            seconds={rec.seconds}
            meter={rec.meter}
            locked={rec.locked}
            slide={slide}
            onCancel={abortRecord}
            onSend={() => {
              stopTyping()
              void rec.finish().then(result => { if (result) onSendVoice(result) })
            }}
          />
        </View>
      ) : null}

      {reply || editing ? (
        <View style={[styles.strip, { backgroundColor: c.surfaceSunken }]}>
          <View style={[styles.stripRule, { backgroundColor: c.accent }]} />
          <View style={styles.flex}>
            <Text variant="micro" tone="accent" align="ui">
              {editing ? 'Editing message' : `Replying to ${reply?.sender?.full || 'message'}`}
            </Text>
            <Text variant="footnote" tone="muted" align="auto" numberOfLines={1}>
              {snippetOf(editing || reply)}
            </Text>
          </View>
          <Touchable
            onPress={() => { if (editing) { onCancelEdit(); setText('') } else onCancelReply() }}
            feedback="dim"
            accessibilityLabel="Cancel"
            style={styles.stripClose}
          >
            <Icon name="close" size={16} color={c.textMuted} />
          </Touchable>
        </View>
      ) : null}

      {notice ? (
        <View style={[styles.notice, { backgroundColor: c.dangerSoft }]}>
          <Icon name="warning" size={13} color={c.danger} />
          <Text variant="caption" tone="danger" align="auto" style={styles.flexShrink}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.row}>
        {/* The attach + mic wear the quiet accent wash so they read as
            buttons at rest — grey-on-grey was the "where are the buttons?"
            complaint (§6 IconButton, same treatment as header actions). */}
        <Touchable onPress={onAttach} feedback="scale" accessibilityLabel="Attach" style={[styles.iconBtn, { backgroundColor: c.accentSoft }]}>
          <Icon name="add" size={24} color={c.accentText} />
        </Touchable>

        <View style={[styles.well, { backgroundColor: c.surfaceSunken }]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={change}
            onBlur={stopTyping}
            placeholder={editing ? 'Edit message' : 'Message'}
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            cursorColor={c.accent}
            multiline
            submitBehavior={enterToSend ? 'submit' : 'newline'}
            onSubmitEditing={enterToSend ? submit : undefined}
            style={[
              styles.input,
              {
                color: c.text,
                fontSize: t.type.body.fontSize,
                lineHeight: t.type.body.lineHeight,
                textAlign: t.isRTL ? 'right' : 'left',
              },
            ]}
          />
          {onEmoji ? (
            <Touchable onPress={onEmoji} feedback="dim" accessibilityLabel="Emoji" style={styles.emojiBtn}>
              <Icon name="emoji" size={22} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>

        {cooldown > 0 || slowLeft > 0 ? (
          <View style={[styles.actionCount, { backgroundColor: c.surfaceSunken }]}>
            <NumericText variant="caption" tone="muted" align="center">
              {cooldown > 0 ? cooldown : slowLeft}s
            </NumericText>
          </View>
        ) : canSend || editing ? (
          /* The highest-traffic state change in the app — first character in,
             last character out — arrives on a quick scale/fade instead of a
             one-frame jump-cut. Reduced motion keeps the cut. */
          <Animated.View
            entering={t.prefs.reducedMotion ? undefined : ZoomIn.duration(t.ms(t.motion.fast))}
            exiting={t.prefs.reducedMotion ? undefined : ZoomOut.duration(t.ms(t.motion.instant))}
          >
            <Touchable
              onPress={submit}
              onLongPress={editing ? undefined : () => onSchedule(text.trim())}
              feedback="scale"
              haptic="light"
              disabled={!text.trim()}
              accessibilityLabel={editing ? 'Save edit' : 'Send'}
              style={[styles.action, { backgroundColor: c.accent }]}
            >
              <Icon name={editing ? 'check' : 'send'} size={18} color={c.textOnAccent} filled />
            </Touchable>
          </Animated.View>
        ) : (
          <GestureDetector gesture={micGesture}>
            {/* Two views on purpose, exactly as ui/Toast does it: ZoomIn and
                ZoomOut animate `transform` themselves, so they live on this
                bare wrapper while the hold-to-talk swell (`micStyle`, also a
                transform) keeps the view inside. Sharing one view let the
                entrance overwrite the gesture's scale — and made Reanimated
                say so on every mount. */}
            <Animated.View
              entering={t.prefs.reducedMotion ? undefined : ZoomIn.duration(t.ms(t.motion.fast))}
              exiting={t.prefs.reducedMotion ? undefined : ZoomOut.duration(t.ms(t.motion.instant))}
            >
            <Animated.View style={micStyle}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Record a voice message"
                accessibilityHint="Tap to start recording, then tap send. Or hold to talk."
                style={[styles.action, { backgroundColor: c.accentSoft }]}
              >
                <Icon name="mic" size={21} color={c.accentText} />
              </View>
            </Animated.View>
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm, paddingTop: space.xs2 },
  recordCover: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, zIndex: 2, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  /* THE LEDGER LINE (DESIGN.md §6, Field): a sunken well with the field
     setback — crowned 10, dead flat at the baseline. Never a lozenge; the
     composer is a field, and fields are setback plates. */
  well: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-end',
    minHeight: 40, maxHeight: 120, paddingHorizontal: space.md2, paddingVertical: space.xs,
    ...setback(shape.field), borderCurve: 'continuous',
  },
  input: { flex: 1, padding: 0, margin: 0, maxHeight: 112, paddingTop: space.sm, paddingBottom: space.sm },
  emojiBtn: { paddingStart: space.xs2, paddingBottom: space.sm },
  /* Send and mic are icon-only, so the circle is sanctioned. */
  action: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  /* The countdown that replaces them carries a numeral, so it takes the
     button setback instead. */
  actionCount: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    ...setback(shape.buttonMd), borderCurve: 'continuous',
  },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, marginBottom: space.xs2,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  stripRule: { width: 3, height: 28, borderRadius: 2 },
  stripClose: { padding: space.xs },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2, padding: space.sm, marginBottom: space.xs2,
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  blocked: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    paddingTop: space.md2, paddingHorizontal: space.xxl, borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
})
