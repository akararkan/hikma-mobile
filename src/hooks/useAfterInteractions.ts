/* =========================================================
   useAfterInteractions — "wait until the screen has arrived".

   A push costs 240ms of slide_from_right (see (app)/_layout),
   and every frame of it is drawn while the JS thread is doing
   the incoming screen's mount work: a FlashList measuring, two
   or three useAsync calls firing, an adapter parsing a page of
   rows. The transition is a native animation, but the render
   work it competes with is not — the slide is what stutters.

   `onIdle` (lib/idle) is what waits it out: the callback runs
   on the first frame with slack in it — which, during a push,
   is the frame after the incoming screen has finished its
   mount work — and no later than its timeout either way.

   It used to be `InteractionManager.runAfterInteractions`.
   RN 0.86 reduced that to a deprecated `setImmediate` shim
   (see lib/idle), so the deferral this hook promises had
   stopped happening at all: `done` was flipping true on the
   tick right after mount, inside the transition it exists to
   protect.

   USE IT FOR SECOND-TIER WORK ONLY:

     · below-the-fold lists (the comments under a post, the
       "more from this author" rail)
     · secondary fetches — anything the screen can render a
       complete-looking first screenful without
     · heavy one-shot computation: charts, waveform decoding,
       big adapter passes

   NEVER gate the primary content on it. A screen whose subject
   is blank for 240ms has not traded jank for smoothness, it has
   traded jank for looking broken — and the skeleton you were
   going to show instead is itself mount work.

   Pairs with `useAsync`'s `enabled` and with a list's
   conditional render:

     const ready = useAfterInteractions()
     const comments = useAsync(loadComments, { enabled: ready })
     ...
     {ready ? <CommentList … /> : null}

   REDUCED MOTION SHORT-CIRCUITS IT. With `prefs.reducedMotion`
   the stack animation is 'none', so there is no transition to
   protect and deferring would be pure added latency — the hook
   returns true on the very first render, before any handle is
   scheduled. Same law as `t.ms()`: the motion collapses to a
   cut and everything downstream collapses with it.
   ========================================================= */
import React from 'react'
import { onIdle } from '@/lib/idle'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * `false` until the navigation transition has finished, then `true` — or
 * `true` immediately when the user has asked for reduced motion.
 */
export function useAfterInteractions(): boolean {
  const reducedMotion = useTheme().prefs.reducedMotion
  /* Seeded from the pref rather than corrected in an effect: a first render of
     `false` under reduced motion would make every consumer mount its gated
     subtree one render late, which is the latency this is meant to avoid. */
  const [done, setDone] = React.useState(reducedMotion)

  React.useEffect(() => {
    if (done) return undefined
    /* Cancel on unmount: a screen popped mid-transition must not come back
       through a setState on a component that is gone. */
    return onIdle(() => setDone(true))
  }, [done])

  /* The pref can flip while a screen is mounted (Settings › Accessibility is a
     route, and the OS switch reaches us through foldOsA11y). Flipping it ON
     must release anything still waiting. */
  React.useEffect(() => {
    if (reducedMotion) setDone(true)
  }, [reducedMotion])

  return done
}
