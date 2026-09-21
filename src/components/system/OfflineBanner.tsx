/* =========================================================
   OfflineBanner — "you are not receiving live updates".

   Deliberately driven by the SSE connection rather than by a
   network-reachability API. Reachability answers "is there a
   route to the internet", which is not the question a user of
   this app has: they want to know whether messages will still
   arrive. A captive-portal wifi is reachable and useless; a
   backgrounded socket on a good connection is unreachable and
   about to heal itself.

   So the banner appears only when the always-on chat stream
   has been down for long enough that it is not a blink, and
   disappears the moment it reconnects.
   ========================================================= */
import React from 'react'
import { StyleSheet } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { announce } from '@/theme/announce'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { useAuth } from '@/context/AuthContext'
import { useRealtimeConnection } from '@/context/RealtimeContext'
import { Text, Icon } from '@/ui'

/* A reconnect normally lands inside 3s (the server's own `retry: 3000`), so
   anything shorter than this is noise the user should never see. */
const GRACE_MS = 6000

/* The plate says "Reconnecting…" because a strip has no room to explain
   itself; the spoken form does, and a screen-reader user gets no colour cue
   to fill the gap. */
const SPOKEN = 'Reconnecting. Live updates are paused.'

export function OfflineBanner() {
  const t = useTheme()
  const { signedIn } = useAuth()
  const { connected } = useRealtimeConnection()
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    if (!signedIn || connected) { setShow(false); return }
    const id = setTimeout(() => {
      setShow(true)
      /* The plate's live region covers Android; iOS needs to be told, and a
         banner that fades in behind VoiceOver's focus is otherwise silent. */
      announce(SPOKEN)
    }, GRACE_MS)
    return () => clearTimeout(id)
  }, [signedIn, connected])

  const insets = useSafeAreaInsets()
  if (!show) return null

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeInUp.duration(220)}
      exiting={t.prefs.reducedMotion ? undefined : FadeOutUp.duration(180)}
      pointerEvents="none"
      /* `pointerEvents="none"` only takes the strip out of the TOUCH tree —
         it stays an accessibility element, and without these it was one that
         announced nothing at all. Grouped into a single utterance
         (the glyph beside it is chrome) and polite, because losing the
         stream is news, not an emergency. */
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={SPOKEN}
      style={[
        styles.banner,
        {
          top: insets.top,
          backgroundColor: t.colors.surfaceInverse,
          zIndex: t.zIndex.toast - 1,
        },
      ]}
    >
      <Icon name="offline" size={14} color={t.colors.textInverse} />
      <Text variant="caption" tone="inverse" align="center">Reconnecting…</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  /* A labelled plate, so it wears the chip setback — the only sanctioned
     pills in the app are unread counters and LIVE badges (DESIGN.md §6). */
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs2,
    marginTop: space.xs2,
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
})
