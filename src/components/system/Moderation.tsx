/* =========================================================
   The moderation surface — badge, notice, refusal strip and
   the re-check loop.

   Every string here comes from `@/lib/moderation` or from the
   server. That is not style: the copy is deliberately vague
   ("your content is being checked", never "your text contained
   X"), because naming the label that fired turns the moderation
   endpoint into an oracle a bad actor can tune against. So:

     · never decorate a refusal
     · never highlight the offending phrase
     · never clear the draft
     · never invent a badge for a surface that carries no
       marker — guessing marks clean content as "checking"

   There is no realtime moderation event anywhere in the
   platform, so a held item polls itself back. `useHeldWatch`
   owns that loop, including the two things a naive poll gets
   wrong: it stops when the app backgrounds (when the model is
   unreachable EVERYTHING is held at once, and a tight poll
   turns one outage into two), and it gives up at the kind's
   ceiling, because past that a human owns the case.
   ========================================================= */
import React from 'react'
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { traceRef } from '@/api'
import {
  MODERATION_COPY, ENTITY_LABEL, HOLD_CEILING_MS, recheckDelays,
  moderationState, isHeld, isBlocked, isUnderReview, isModerationError, moderationText,
} from '@/lib/moderation.js'
import { withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, setback, shape, space } from '@/theme/tokens'
import { Button, Icon, Text, Touchable } from '@/ui'

export type HeldState = 'checking' | 'review' | 'removed' | null

/* ---------------------------------------------------------
   ModerationBadge — the quiet setback plate over held content.

   Amber for checking/review, red only for removed. "Checking"
   is not an error and must never wear the destructive colour.
   --------------------------------------------------------- */

export function ModerationBadge({
  state, size = 'sm', style,
}: { state: Exclude<HeldState, null>; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const removed = state === 'removed'
  const spin = useSharedValue(0)

  React.useEffect(() => {
    if (state !== 'checking' || t.prefs.reducedMotion) return
    spin.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(spin)
  }, [state, spin, t.prefs.reducedMotion])

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }))

  const glyph = state === 'checking' ? 'hourglass' : state === 'review' ? 'eyeOff' : 'block'
  const fg = removed ? ramp.red[100] : ramp.amber[100]

  return (
    <View
      style={[
        styles.badge,
        {
          height: size === 'md' ? 26 : 22,
          paddingHorizontal: size === 'md' ? 10 : 8,
          backgroundColor: removed ? withAlpha(ramp.red[900], 0.72) : withAlpha(ramp.amber[900], 0.66),
        },
        style,
      ]}
    >
      <Animated.View style={state === 'checking' ? spinStyle : undefined}>
        <Icon name={glyph as any} size={size === 'md' ? 13 : 12} color={fg} />
      </Animated.View>
      <Text variant={size === 'md' ? 'footnote' : 'caption'} color={fg} align="ui">
        {MODERATION_COPY[state].badge}
      </Text>
    </View>
  )
}

/* ---------------------------------------------------------
   ModerationNotice — the explanatory card under a held item
   on its own detail screen.
   --------------------------------------------------------- */

export function ModerationNotice({
  state, entityType, onLearnMore, style,
}: {
  state: Exclude<HeldState, null>
  entityType?: string
  onLearnMore?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const router = useRouter()
  const c = t.colors
  const removed = state === 'removed'
  const copy = MODERATION_COPY[state]
  const noun = entityType ? (ENTITY_LABEL as Record<string, string>)[entityType] : null

  return (
    <View
      style={[
        styles.notice,
        {
          backgroundColor: removed ? c.dangerSoft : c.warningSoft,
          borderStartColor: removed ? c.danger : c.warning,
          borderRadius: t.radius.md,
        },
        style,
      ]}
    >
      <Text variant="bodyStrong" color={removed ? c.dangerText : c.warningText} align="ui">
        {copy.title}
      </Text>
      <Text variant="callout" tone="secondary" align="ui" style={{ marginTop: space.xs }}>
        {copy.note}
      </Text>
      {noun ? (
        <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
          This applies to your {noun}.
        </Text>
      ) : null}
      {removed ? (
        <Touchable
          onPress={onLearnMore ?? (() => router.push('/settings/safety/moderation'))}
          feedback="dim"
          style={{ marginTop: space.sm2, alignSelf: 'flex-start' }}
        >
          <Text variant="subhead" tone="accent" align="ui">How this works and how to appeal</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   ModerationRefusalNotice — the composer's inline strip.

   Two rules, both absolute: the server's sentence is rendered
   verbatim with nothing added, and the draft is never cleared.

   A blocked submission gets NO retry — resubmitting identical
   text can only fail identically, and a retry button that
   cannot work is a lie. "Under review" DOES get one, because
   that outcome neither applied nor refused the change.
   --------------------------------------------------------- */

export function ModerationRefusalNotice({
  error, onEdit, onRetry, onDismiss, style,
}: {
  error: any
  onEdit?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const router = useRouter()
  const c = t.colors

  const blocked = isBlocked(error)
  const review = isUnderReview(error)
  const [canRetry, setCanRetry] = React.useState(false)

  /* The delay is the point: "try again in a moment" that is tappable
     immediately invites a tight retry loop against a queue that is already
     behind. */
  React.useEffect(() => {
    if (!review) return
    const id = setTimeout(() => setCanRetry(true), 4000)
    return () => clearTimeout(id)
  }, [review])

  /* Below the hooks: `error` is a prop, and a surface that retries can hand
     this instance a non-moderation error next — an early return above the
     hooks would then render fewer hooks than the paint before it. */
  if (!isModerationError(error)) return null

  return (
    <View
      style={[
        styles.notice,
        {
          backgroundColor: blocked ? c.dangerSoft : c.warningSoft,
          borderStartColor: blocked ? c.danger : c.warning,
          borderRadius: t.radius.sm,
        },
        style,
      ]}
    >
      <View style={styles.refusalHead}>
        <Icon name={blocked ? 'block' : 'hourglass'} size={15} color={blocked ? c.dangerText : c.warningText} />
        {/* The server's own sentence. Nothing is added around it. */}
        <Text variant="callout" tone="secondary" align="ui" style={styles.flex}>
          {moderationText(error)}
        </Text>
        {onDismiss ? (
          <Touchable onPress={onDismiss} feedback="dim" accessibilityLabel="Dismiss">
            <Icon name="close" size={14} color={c.textMuted} />
          </Touchable>
        ) : null}
      </View>

      <View style={styles.refusalActions}>
        {onEdit ? <Button label="Edit" onPress={onEdit} variant="ghost" size="sm" /> : null}
        {review && onRetry ? (
          <Button label="Try again" onPress={onRetry} variant="ghost" size="sm" disabled={!canRetry} />
        ) : null}
        <Touchable
          onPress={() => router.push({
            pathname: '/settings/safety/moderation',
            params: { trace: traceRef(error) ?? '' },
          })}
          feedback="dim"
          style={{ paddingHorizontal: space.sm, paddingVertical: space.xs2 }}
        >
          <Text variant="subhead" tone="muted" align="ui">Why?</Text>
        </Touchable>
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   useHeldWatch — the re-check loop.
   --------------------------------------------------------- */

export function useHeldWatch(
  kind: string,
  item: any,
  refetch: () => Promise<any>,
): { state: HeldState; watching: boolean } {
  /* `moderationState` answers 'live' for anything unmarked; the badge and the
     notice both want "nothing to say" spelled as null. */
  const raw = moderationState(item)
  const state: HeldState = raw === 'live' ? null : (raw as Exclude<HeldState, null>)
  const held = isHeld(item)
  const [watching, setWatching] = React.useState(false)

  const refetchRef = React.useRef(refetch)
  refetchRef.current = refetch
  const focused = React.useRef(true)

  useFocusEffect(React.useCallback(() => {
    focused.current = true
    return () => { focused.current = false }
  }, []))

  React.useEffect(() => {
    if (!held) { setWatching(false); return }

    const offsets: number[] = recheckDelays(kind)
    const ceiling: number = (HOLD_CEILING_MS as Record<string, number>)[kind] ?? 30_000
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let i = 0
    setWatching(true)

    const step = () => {
      if (cancelled) return
      /* Past the ceiling a human owns the case — stop, and leave the badge
         exactly as it is rather than implying failure. */
      if (i >= offsets.length) { setWatching(false); return }
      const at = offsets[i]
      const prev = i === 0 ? 0 : offsets[i - 1]
      i += 1
      timer = setTimeout(() => {
        if (cancelled) return
        /* Backgrounded: skip this beat rather than firing a request the user
           cannot see the result of. The next foreground resumes the schedule. */
        if (AppState.currentState !== 'active' || !focused.current) { step(); return }
        refetchRef.current().catch(() => {}).finally(step)
      }, Math.max(400, Math.min(at, ceiling) - prev))
    }
    step()

    return () => { cancelled = true; if (timer) clearTimeout(timer); setWatching(false) }
  }, [held, kind, item?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  return { state, watching }
}

/* ---------------------------------------------------------
   reportHref — the single entry point every long-press and
   overflow menu uses.

   `targetType` must be one of REPORT_TARGET_TYPES exactly; an
   unknown value is a 400 from the server, not a client-side
   no-op — and /report validates it against the same list and
   refuses to submit rather than guessing a "close enough"
   type. A MESSAGE target drops its snippet before navigating,
   because a route param is persisted navigation state and a
   private message body does not belong there.
   --------------------------------------------------------- */

export interface ReportTarget {
  targetType: string
  targetId: string
  name?: string
  snippet?: string
  avatar?: string
  /** The account behind the content, for /report's "Block this account
   *  instead" affordance. Redundant on a USER target — there the target
   *  IS the account and /report falls back to targetId. */
  authorId?: string
}

export function reportHref(target: ReportTarget) {
  const params: Record<string, string> = {
    targetType: target.targetType,
    targetId: String(target.targetId),
  }
  if (target.name) params.name = target.name
  if (target.avatar) params.avatar = target.avatar
  if (target.snippet && target.targetType !== 'MESSAGE') params.snippet = target.snippet
  if (target.authorId) params.authorId = String(target.authorId)
  return { pathname: '/report' as const, params }
}

const styles = StyleSheet.create({
  /* Setback, not a pill: it carries a word ("Checking"), and the two
     sanctioned pills are unread counters and LIVE badges. */
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    alignSelf: 'flex-start',
    ...setback(shape.chip),
    borderCurve: 'continuous',
  },
  notice: { padding: space.md, borderStartWidth: 3 },
  refusalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  refusalActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs2, marginStart: -space.sm },
  flex: { flex: 1 },
})
