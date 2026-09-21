/* =========================================================
   ModerationBadge — the "Checking…" chip, plus the poll that
   makes it go away.

   Held content clears on its own and the platform emits NO
   realtime event for it, so a held item has to re-fetch itself.
   `recheckDelays(kind)` is the server's own back-off, ending at
   the entity's hard ceiling; past that a human owns the case and
   more polling cannot change the answer.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Callout, Icon, Text } from '@/ui'
import { MODERATION_COPY, moderationState, recheckDelays } from '@/lib/moderation'

type Kind = 'POST' | 'POST_COMMENT'

export interface ModerationBadgeProps {
  /** Anything carrying a `status` / `moderationStatus` marker. */
  item: any
  kind?: Kind
  /** Re-read the entity. Return the fresh row; a falsy return keeps polling. */
  refetch?: () => Promise<any>
  /** Called with the fresh row once its state flips to live. */
  onCleared?: (fresh: any) => void
  /** `chip` overlays media; `strip` is the full-width detail banner. */
  variant?: 'chip' | 'strip'
  style?: StyleProp<ViewStyle>
}

export function ModerationBadge({
  item, kind = 'POST', refetch, onCleared, variant = 'chip', style,
}: ModerationBadgeProps) {
  const t = useTheme()
  const state = moderationState(item) as 'live' | 'checking' | 'review' | 'removed'
  const held = state === 'checking' || state === 'review'

  const cbRef = React.useRef({ refetch, onCleared })
  cbRef.current = { refetch, onCleared }

  React.useEffect(() => {
    if (!held || !cbRef.current.refetch) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    /* Offsets from the first sighting, not gaps — the schedule is expressed
       as absolute delays so a slow response cannot stretch the whole plan. */
    for (const at of recheckDelays(kind) as number[]) {
      timers.push(setTimeout(async () => {
        if (cancelled) return
        try {
          const fresh = await cbRef.current.refetch?.()
          if (cancelled || !fresh) return
          if (moderationState(fresh) === 'live') {
            cancelled = true
            cbRef.current.onCleared?.(fresh)
          }
        } catch { /* a failed recheck is just a missed slot */ }
      }, at))
    }

    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [held, kind, item?.id])

  if (state === 'live') return null

  const copy = state === 'removed' ? MODERATION_COPY.removed
    : state === 'review' ? MODERATION_COPY.review
      : MODERATION_COPY.checking

  if (variant === 'strip') {
    return (
      <Callout tone={state === 'removed' ? 'danger' : 'warning'} icon="clock" title={copy.title} style={style}>
        {copy.note}
      </Callout>
    )
  }

  return (
    <View
      style={[
        styles.chip,
        {
          height: 28,
          backgroundColor: state === 'removed' ? t.colors.dangerSoft : t.colors.warningSoft,
        },
        style,
      ]}
    >
      <Icon name="clock" size={13} color={state === 'removed' ? t.colors.dangerText : t.colors.warningText} />
      <Text variant="caption" color={state === 'removed' ? t.colors.dangerText : t.colors.warningText}>
        {copy.badge}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  /* A CHIP, not a pill (DON'T #9): the two sanctioned pills are unread
     counters and LIVE badges, and this is neither. */
  chip: {
    ...setback(shape.chip),
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.sm2,
    alignSelf: 'flex-start',
  },
})
