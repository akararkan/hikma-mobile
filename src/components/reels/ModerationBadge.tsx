/* =========================================================
   The "Checking…" chip, and the poll that retires it.

   There is no realtime moderation event anywhere on this
   platform, so a held reel has to re-fetch itself. The
   schedule comes from lib/moderation — front-loaded, because
   almost everything clears in the first second or two, then
   spaced out, because when the classifier is unreachable
   EVERYTHING is held at once and that is the worst possible
   moment for a tight poll.

   Nothing here guesses. A surface that carries no moderation
   marker gets no badge: guessing wrong would brand clean
   content as under review.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { api } from '@/api'
import { MODERATION_COPY, isHeld, moderationState, recheckDelays } from '@/lib/moderation'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, Text } from '@/ui'
import { STAGE } from './skin'
import type { ViewPost } from './types'

export function ModerationBadge({ item, compact }: { item: { status?: string } | null; compact?: boolean }) {
  const state = moderationState(item)
  if (state === 'live') return null
  const copy = state === 'removed'
    ? MODERATION_COPY.removed
    : state === 'review' ? MODERATION_COPY.review : MODERATION_COPY.checking
  const removed = state === 'removed'

  return (
    <View style={[styles.pill, { backgroundColor: removed ? 'rgba(194,72,61,0.22)' : STAGE.warnSoft }]}>
      <Icon name={removed ? 'warning' : 'hourglass'} size={compact ? 11 : 12} color={removed ? STAGE.danger : STAGE.warn} />
      <Text variant="caption" weight="600" color={removed ? STAGE.danger : STAGE.warn}>{copy.badge}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   The re-check.

   Only ever runs for MY OWN held reel — nobody else can see it
   anyway, and polling somebody else's post for a verdict is
   both useless and rude to the datastore.
   --------------------------------------------------------- */

export function useHoldRecheck(
  post: ViewPost | null | undefined,
  isMine: boolean,
  onFresh: (next: ViewPost) => void,
) {
  const held = !!post && isMine && isHeld(post)
  const id = post?.id
  const cb = React.useRef(onFresh)
  cb.current = onFresh

  React.useEffect(() => {
    if (!held || !id) return
    let alive = true
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const at of recheckDelays('POST')) {
      timers.push(setTimeout(async () => {
        if (!alive) return
        try {
          const fresh = await api.posts.get(id)
          if (alive && fresh) cb.current(fresh)
        } catch { /* the badge simply stays until the next attempt */ }
      }, at))
    }
    return () => { alive = false; for (const tm of timers) clearTimeout(tm) }
  }, [held, id])
}

const styles = StyleSheet.create({
  /* A chip, not a pill: pills are reserved for unread counters and the LIVE
     badge (DESIGN.md §8.9). */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    height: 22,
    paddingHorizontal: space.sm,
    ...setback(shape.chip),
    borderCurve: 'continuous',
    alignSelf: 'flex-start',
  },
})
