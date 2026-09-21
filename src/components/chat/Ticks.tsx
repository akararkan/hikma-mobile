/* =========================================================
   Delivery ticks.

   Two rules, both easy to get subtly wrong:

   1. The comparison is `gteId(peerMarker, messageId)` — a
      high-water mark, not equality, and never `>=` on the raw
      strings. Message ids are 18-digit Snowflakes; `'9' >= '10'`
      is true in JavaScript and false in reality.
   2. Null markers do NOT mean "draw nothing". A fresh thread —
      or a peer who simply has not opened it yet — has both
      markers null, and drawing nothing there made every sent
      message look unacknowledged, which read as "receipts are
      not implemented". A server-acked message has been SENT,
      and the single grey tick says exactly that much, whatever
      the peer's settings. Only MY OWN receipts toggle hides the
      ticks entirely: with it off the signal is disabled by
      choice, not pending.
   3. The ticks are the sender's ONLY answer to "did it land?",
      and they were silent to a screen reader: five icons with
      no label between them. Each state now says its word, so
      the receipt survives with the picture switched off.

      Note on colour: `delivered` and `seen` share the double
      tick and differ only in ink (muted vs Sky). That is the
      universal messenger convention and the difference is one
      of LIGHTNESS, not hue, so it survives every common colour
      vision deficiency — unlike the presence dot, which was
      green-vs-grey and got a shape. Changing the tick's shape
      would break a signal every user already reads; the label
      below is what closes the accessibility gap instead.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { gteId } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { Icon } from '@/ui'

export interface TicksProps {
  messageId: string
  peerLastReadMessageId?: string | null
  peerLastDeliveredMessageId?: string | null
  pending?: boolean
  failed?: boolean
  receiptsEnabled?: boolean
  /** Own bubbles are the brand fill — the tick has to read on it. */
  color: string
  size?: number
}

/** What each state says out loud. Plain sender-side words, not the wire's
 *  enum — "Read" is what the tick means, `seen` is what the marker is called. */
const TICK_LABEL = {
  failed: 'Not sent',
  pending: 'Sending',
  seen: 'Read',
  delivered: 'Delivered',
  sent: 'Sent',
  off: '',
} as const

export function Ticks({
  messageId, peerLastReadMessageId, peerLastDeliveredMessageId,
  pending, failed, receiptsEnabled = true, color, size = 14,
}: TicksProps) {
  const t = useTheme()

  const state = failed ? 'failed'
    : pending ? 'pending'
    : !receiptsEnabled ? 'off'
    : gteId(peerLastReadMessageId, messageId) ? 'seen'
    : gteId(peerLastDeliveredMessageId, messageId) ? 'delivered'
    : 'sent'

  /* Fade on the TRANSITION only, never on mount — this sits in a recycled
     row, and a mount entrance would flash every tick on a fast scroll (§9:
     no entrance work in rows). Pending→sent→delivered→seen is a state the
     sender actively watches for; the cut read as a glitch. */
  const fade = useSharedValue(1)
  const prev = React.useRef(state)
  React.useEffect(() => {
    if (prev.current === state) return
    prev.current = state
    if (t.prefs.reducedMotion) return
    fade.value = 0
    fade.value = withTiming(1, { duration: t.ms(t.motion.fast) })
  }, [state, fade, t])
  const anim = useAnimatedStyle(() => ({ opacity: fade.value }))

  if (state === 'off') return <View style={{ width: 2 }} />

  return (
    <Animated.View style={anim} accessible accessibilityLabel={TICK_LABEL[state]}>
      {state === 'failed' ? <Icon name="error" size={size} color={t.colors.danger} />
        : state === 'pending' ? <Icon name="clock" size={size} color={color} />
        : state === 'seen' ? (
          /* The lit "seen" pair (web .ch-tick.seen): Sky, the one accent that
             reads on the navy plate these ticks always sit on — accent navy
             would vanish into its own bubble. */
          <Icon name="tickDouble" size={size} color={t.colors.sky} />
        )
        : state === 'delivered' ? <Icon name="tickDouble" size={size} color={color} />
        : <Icon name="tickSingle" size={size} color={color} />}
    </Animated.View>
  )
}
