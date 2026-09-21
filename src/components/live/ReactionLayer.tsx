/* =========================================================
   ReactionLayer — the floating hearts.

   Two rules, both from the wire contract:

   1. A tap spawns a floater LOCALLY and immediately. The
      network call is throttled to one per 180ms (the server
      caps 30/10s) but the animation is never throttled — a
      heart that appears 200ms after the finger lifts feels
      broken, and the frame is the payload anyway.
   2. `stream.reaction` frames from OTHER users spawn a
      floater; your own echo does not, because your tap already
      did. Otherwise every tap shows two hearts.

   The array is capped at 40 and drops from the front: a
   popular stream can emit faster than the animations retire.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { Text } from '@/ui'
import { emojiFor } from './types'

export interface Floater { id: string; type: string; x: number }

const CAP = 40
const DURATION = 2200

/** Owns the floater array and the network throttle. One per room. */
export function useReactions(send: (type: string) => Promise<any> | void) {
  const [floaters, setFloaters] = React.useState<Floater[]>([])
  const lastSent = React.useRef(0)
  const seq = React.useRef(0)

  const spawn = React.useCallback((type: string, x = 0) => {
    const id = `f${++seq.current}`
    setFloaters(prev => {
      const next = [...prev, { id, type, x }]
      return next.length > CAP ? next.slice(next.length - CAP) : next
    })
    setTimeout(() => setFloaters(prev => prev.filter(f => f.id !== id)), DURATION + 60)
  }, [])

  const react = React.useCallback((type = 'LIKE', x = 0) => {
    spawn(type, x)
    const now = Date.now()
    if (now - lastSent.current < 180) return
    lastSent.current = now
    void Promise.resolve(send(type)).catch(() => { /* a dropped reaction is not worth a message */ })
  }, [spawn, send])

  return { floaters, react, spawn }
}

export function ReactionLayer({
  floaters, origin,
}: { floaters: Floater[]; origin?: { bottom: number; end: number } }) {
  const anchor = origin ?? { bottom: 120, end: 26 }
  return (
    <View pointerEvents="none" style={[styles.layer, { bottom: anchor.bottom, end: anchor.end }]}>
      {floaters.map(f => <FloatingEmoji key={f.id} floater={f} />)}
    </View>
  )
}

function FloatingEmoji({ floater }: { floater: Floater }) {
  const t = useTheme()
  const { width } = useWindowDimensions()
  const p = useSharedValue(0)
  /* A fixed drift per floater, seeded off its id, so a burst fans out instead
     of stacking into one thick column. */
  const drift = React.useMemo(() => (Math.random() * 2 - 1) * 28, [])
  const rise = Math.min(260, width * 0.7)

  React.useEffect(() => {
    p.value = withTiming(1, { duration: t.ms(DURATION) || 1, easing: Easing.out(Easing.quad) })
  }, [p, t])

  const anim = useAnimatedStyle(() => {
    const v = p.value
    return {
      transform: [
        { translateY: -rise * v },
        { translateX: floater.x + Math.sin(v * Math.PI * 2) * drift },
        { scale: v < 0.2 ? 0.7 + v * 2.25 : v < 0.6 ? 1.15 : 1.15 - (v - 0.6) * 0.625 },
      ],
      opacity: v > 0.7 ? (1 - v) / 0.3 : 1,
    }
  })

  return (
    <Animated.View style={[styles.floater, anim]}>
      <Text variant="title2" align="center">{emojiFor(floater.type)}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', width: 60, height: 300, alignItems: 'center', justifyContent: 'flex-end' },
  floater: { position: 'absolute', bottom: 0 },
})
