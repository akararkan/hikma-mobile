/* =========================================================
   The four states, shaped for this domain.

   `QnaErrorView` is the only error renderer the Q&A screens
   use, and it branches strictly on the errors.js predicates in
   a fixed order. Two of those branches are load-bearing:

     · isNotFound → the QUIET panel with no retry. A block edge
       in either direction 404s a question, so this copy must
       never say "blocked" — existence is deliberately hidden.
     · isBlocked  → moderationText VERBATIM, no retry, nothing
       decorated. Naming a rule or highlighting a phrase would
       be an oracle for probing the classifier.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  cooldownSecondsFrom, errorText, isNetworkError, isNotFound, isRateLimited, isTransient,
} from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { Button, Callout, Icon, Skeleton, Text, type IconName } from '@/ui'
import type { GateReason } from './gate'

/* ---------------------------------------------------------
   Skeletons. Every loading state in the domain is one of
   these — never a spinner, because the shapes here are tall
   and a centred spinner reads as "broken" on a tall screen.
   --------------------------------------------------------- */

export type SkeletonKind = 'questionCard' | 'answerCard' | 'hero' | 'sourceRow' | 'attachmentGrid' | 'searchRow'

export function QnaSkeletons({ kind, count = 4 }: { kind: SkeletonKind; count?: number }) {
  const t = useTheme()

  if (kind === 'attachmentGrid') {
    return (
      <View style={[styles.grid, { padding: t.layout.screenPadding }]}>
        {Array.from({ length: count * 3 }, (_, i) => (
          <Skeleton key={i} height={104} radius={10} style={styles.tile} />
        ))}
      </View>
    )
  }

  return (
    <View>
      {kind === 'hero' ? <HeroSkeleton /> : null}
      {Array.from({ length: count }, (_, i) => {
        if (kind === 'questionCard') return <QuestionCardSkeleton key={i} />
        if (kind === 'sourceRow') return <SourceRowSkeleton key={i} />
        if (kind === 'searchRow') return <SearchRowSkeleton key={i} />
        return <AnswerCardSkeleton key={i} />
      })}
    </View>
  )
}

function QuestionCardSkeleton() {
  const t = useTheme()
  return (
    <View
      style={[
        styles.card,
        { marginHorizontal: t.layout.screenPadding, borderColor: t.colors.border, borderRadius: t.radius.lg },
      ]}
    >
      <View style={styles.rowCenter}>
        <Skeleton circle width={32} height={32} />
        <View style={{ flex: 1, gap: space.xs2, marginStart: space.sm2 }}>
          <Skeleton width="38%" height={11} />
          <Skeleton width="24%" height={9} />
        </View>
      </View>
      <Skeleton width="88%" height={15} style={{ marginTop: space.md2 }} />
      <Skeleton width="60%" height={15} style={{ marginTop: space.sm }} />
      <Skeleton width="96%" height={10} style={{ marginTop: space.md }} />
      <Skeleton width="72%" height={10} style={{ marginTop: space.xs2 }} />
      <View style={[styles.rowCenter, { marginTop: space.md2, gap: space.sm }]}>
        <Skeleton width={62} height={22} radius={999} />
        <Skeleton width={78} height={22} radius={999} />
        <Skeleton width={50} height={22} radius={999} />
      </View>
      <View style={[styles.rowCenter, { marginTop: space.md2, gap: space.lg }]}>
        <Skeleton width={44} height={11} />
        <Skeleton width={44} height={11} />
        <Skeleton width={44} height={11} />
      </View>
    </View>
  )
}

function AnswerCardSkeleton() {
  const t = useTheme()
  return (
    <View
      style={[
        styles.card,
        { marginHorizontal: t.layout.screenPadding, borderColor: t.colors.border, borderRadius: t.radius.md },
      ]}
    >
      <View style={styles.rowCenter}>
        <Skeleton circle width={32} height={32} />
        <View style={{ flex: 1, gap: space.xs2, marginStart: space.sm2 }}>
          <Skeleton width="34%" height={10} />
          <Skeleton width="20%" height={9} />
        </View>
      </View>
      <Skeleton width="98%" height={11} style={{ marginTop: space.md2 }} />
      <Skeleton width="92%" height={11} style={{ marginTop: space.xs2 }} />
      <Skeleton width="55%" height={11} style={{ marginTop: space.xs2 }} />
      <View style={[styles.rowCenter, { marginTop: space.md2, gap: space.lg2 }]}>
        <Skeleton width={40} height={11} />
        <Skeleton width={40} height={11} />
      </View>
    </View>
  )
}

function HeroSkeleton() {
  const t = useTheme()
  return (
    <View style={{ padding: t.layout.screenPadding, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.separator }}>
      <View style={styles.rowCenter}>
        <Skeleton circle width={40} height={40} />
        <View style={{ flex: 1, gap: space.xs2, marginStart: space.sm2 }}>
          <Skeleton width="42%" height={12} />
          <Skeleton width="30%" height={10} />
        </View>
      </View>
      <Skeleton width="94%" height={20} style={{ marginTop: space.lg }} />
      <Skeleton width="66%" height={20} style={{ marginTop: space.sm }} />
      <Skeleton width="100%" height={11} style={{ marginTop: space.lg }} />
      <Skeleton width="97%" height={11} style={{ marginTop: space.sm }} />
      <Skeleton width="91%" height={11} style={{ marginTop: space.sm }} />
      <Skeleton width="48%" height={11} style={{ marginTop: space.sm }} />
      <View style={[styles.rowCenter, { marginTop: space.lg, gap: space.sm }]}>
        <Skeleton width={70} height={26} radius={999} />
        <Skeleton width={54} height={26} radius={999} />
        <Skeleton width={88} height={26} radius={999} />
      </View>
    </View>
  )
}

function SourceRowSkeleton() {
  const t = useTheme()
  return (
    <View
      style={[
        styles.rowCenter,
        {
          marginHorizontal: t.layout.screenPadding,
          marginTop: space.sm,
          padding: space.md2,
          borderRadius: t.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          gap: space.md,
        },
      ]}
    >
      <Skeleton width={36} height={36} radius={10} />
      <View style={{ flex: 1, gap: space.sm }}>
        <Skeleton width="58%" height={12} />
        <Skeleton width="82%" height={10} />
      </View>
    </View>
  )
}

function SearchRowSkeleton() {
  const t = useTheme()
  return (
    <View style={[styles.rowCenter, { padding: t.layout.screenPadding, gap: space.md }]}>
      <Skeleton width={32} height={32} radius={10} />
      <View style={{ flex: 1, gap: space.sm }}>
        <Skeleton width="76%" height={11} />
        <Skeleton width="40%" height={9} />
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Empty block. One shape so nine lists cannot invent nine.
   --------------------------------------------------------- */

export function QnaEmptyState({
  glyph = 'qna', title, body, actionLabel, onAction, secondaryLabel, onSecondary, compact,
}: {
  glyph?: IconName
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  compact?: boolean
}) {
  const t = useTheme()
  return (
    <View style={[styles.center, { paddingHorizontal: space.xxxl, paddingVertical: compact ? 34 : 56, gap: space.xs2 }]}>
      <View
        style={[
          styles.center,
          {
            width: compact ? 52 : 68,
            height: compact ? 52 : 68,
            borderRadius: 999,
            backgroundColor: t.colors.accentSofter,
            marginBottom: space.md,
          },
        ]}
      >
        <Icon name={glyph} size={compact ? 24 : 30} color={t.colors.accent} />
      </View>
      <Text variant={compact ? 'headline' : 'title3'} align="center">{title}</Text>
      {body ? (
        <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 300, marginTop: space.xxs }}>{body}</Text>
      ) : null}
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} variant="tinted" size="md" style={{ marginTop: space.lg }} />
      ) : null}
      {secondaryLabel ? (
        <Button label={secondaryLabel} onPress={onSecondary} variant="ghost" size="sm" style={{ marginTop: space.xxs }} />
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   Errors.
   --------------------------------------------------------- */

export function QnaErrorView({
  error, variant = 'page', onRetry, onBack, backLabel = 'Back to Q&A',
}: {
  error: any
  variant?: 'page' | 'inline' | 'banner'
  onRetry?: () => void
  onBack?: () => void
  backLabel?: string
}) {
  const t = useTheme()
  const missing = isNotFound(error)
  const blocked = isBlocked(error)
  const limited = isRateLimited(error)
  const [cooldown, setCooldown] = React.useState(() => (limited ? cooldownSecondsFrom(error) : 0))

  React.useEffect(() => {
    if (!limited) return
    setCooldown(cooldownSecondsFrom(error))
    const id = setInterval(() => setCooldown(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [error, limited])

  /* isTransient reads are worth exactly one automatic retry: the datastore
     answered 503, which is contractually a blip. More than one is a loop. */
  const autoRetried = React.useRef(false)
  React.useEffect(() => {
    if (!onRetry || !isTransient(error) || autoRetried.current) return
    autoRetried.current = true
    const id = setTimeout(onRetry, 3000)
    return () => clearTimeout(id)
  }, [error, onRetry])

  const message =
    blocked ? moderationText(error)
      : missing ? 'It may have been deleted, or you cannot view it.'
        : limited ? (cooldown > 0 ? `Try again in ${cooldown}s.` : 'Try again now.')
          : isTransient(error) ? 'Temporary problem — try again in a moment.'
            : errorText(error)

  const heading =
    blocked ? 'Not published'
      : missing ? 'No longer available'
        : isNetworkError(error) ? "You're offline"
          : limited ? 'Slow down a moment'
            : 'Something went wrong'

  /* A moderation refusal and a 404 both get NO retry: one is final, and the
     other would just 404 again. */
  const retryable = !!onRetry && !missing && !blocked

  if (variant === 'banner') {
    return (
      <Callout tone={blocked ? 'warning' : missing ? 'neutral' : 'danger'}>
        {message}
      </Callout>
    )
  }

  if (variant === 'inline') {
    return (
      <View style={[styles.rowCenter, { padding: space.md2, gap: space.sm2 }]}>
        <Icon
          name={isNetworkError(error) ? 'offline' : missing ? 'search' : 'error'}
          size={16}
          color={missing ? t.colors.textMuted : t.colors.danger}
        />
        <Text variant="footnote" tone={missing ? 'muted' : 'danger'} align="ui" style={{ flex: 1 }}>{message}</Text>
        {retryable ? (
          <Button
            label={limited && cooldown > 0 ? `Wait ${cooldown}s` : 'Retry'}
            onPress={onRetry}
            disabled={limited && cooldown > 0}
            variant="ghost"
            size="sm"
          />
        ) : null}
      </View>
    )
  }

  return (
    <View style={[styles.center, { paddingHorizontal: space.xxxl, paddingVertical: space.giant, gap: space.xs2 }]}>
      <View
        style={[
          styles.center,
          {
            width: 68,
            height: 68,
            borderRadius: 999,
            backgroundColor: missing || blocked ? t.colors.surfaceSunken : t.colors.dangerSoft,
            marginBottom: space.md,
          },
        ]}
      >
        <Icon
          name={blocked ? 'shield' : missing ? 'hourglass' : isNetworkError(error) ? 'offline' : limited ? 'hourglass' : 'error'}
          size={29}
          color={missing || blocked ? t.colors.textFaint : t.colors.danger}
        />
      </View>
      <Text variant="title3" align="center">{heading}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{message}</Text>
      {retryable ? (
        <Button
          label={limited && cooldown > 0 ? `Retry in ${cooldown}s` : 'Try again'}
          onPress={onRetry}
          disabled={limited && cooldown > 0}
          variant="tinted"
          icon="refresh"
          style={{ marginTop: space.lg }}
        />
      ) : null}
      {onBack ? (
        <Button label={backLabel} onPress={onBack} variant={retryable ? 'ghost' : 'tinted'} size="md" style={{ marginTop: retryable ? 4 : 16 }} />
      ) : null}
    </View>
  )
}

/** The 403 wall. An ownership or role refusal is FINAL — it gets no retry and
 *  should not be reachable a second time. */
export function QnaRefusal({ title, body, onBack }: { title: string; body?: string; onBack?: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.center, { paddingHorizontal: space.xxxl, paddingVertical: space.giant, gap: space.xs2 }]}>
      <View style={[styles.center, { width: 68, height: 68, borderRadius: 999, backgroundColor: t.colors.surfaceSunken, marginBottom: space.md }]}>
        <Icon name="lock" size={28} color={t.colors.textFaint} />
      </View>
      <Text variant="title3" align="center">{title}</Text>
      {body ? <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{body}</Text> : null}
      {onBack ? <Button label="Back" onPress={onBack} variant="tinted" style={{ marginTop: space.lg2 }} /> : null}
    </View>
  )
}

/* ---------------------------------------------------------
   GateBanner — why the composer is off.
   --------------------------------------------------------- */

export function GateBanner({ reason, copy, maxAnswers }: { reason: GateReason; copy?: string; maxAnswers?: number | null }) {
  const t = useTheme()
  const glyph: IconName = reason === 'LOCKED' ? 'lock' : reason === 'CAPPED' ? 'hourglass' : reason === 'ROLE' ? 'scholar' : 'info'
  const text = copy ?? (reason === 'CAPPED' ? `This question reached its limit of ${maxAnswers ?? 0} answers.` : '')
  return (
    <View
      style={[
        styles.rowCenter,
        {
          minHeight: 44,
          paddingHorizontal: t.layout.screenPadding,
          paddingVertical: space.sm2,
          gap: space.sm2,
          backgroundColor: t.colors.warningSoft,
        },
      ]}
    >
      <Icon name={glyph} size={16} color={t.colors.warningText} />
      <Text variant="subhead" color={t.colors.warningText} align="ui" style={{ flex: 1 }}>{text}</Text>
    </View>
  )
}

/* ---------------------------------------------------------
   ConnectionDot — decorative by contract. An SSE failure has
   no envelope to read and must never become a toast.
   --------------------------------------------------------- */

export type ConnectionState = 'connected' | 'reconnecting' | 'offline' | 'mock'

export function ConnectionDot({ state }: { state: ConnectionState }) {
  const t = useTheme()
  const color =
    state === 'connected' ? t.colors.online
      : state === 'reconnecting' ? t.colors.away
        : state === 'mock' ? t.colors.textFaint
          : t.colors.offline
  return (
    <View
      accessible
      accessibilityLabel={
        state === 'connected' ? 'Live updates on'
          : state === 'reconnecting' ? 'Reconnecting'
            : state === 'mock' ? 'Offline sample data'
              : 'Live updates off'
      }
      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginEnd: space.xs }}
    />
  )
}

/* ---------------------------------------------------------
   The hairline that says "still working" without stealing the
   list. A refresh over existing data must not blank it.
   --------------------------------------------------------- */

export function IndeterminateBar({ active, height = 3 }: { active: boolean; height?: number }) {
  const t = useTheme()
  const x = useSharedValue(0)
  /* Measured rather than a percentage transform: percentage translations are
     not portable across every reanimated/RN pairing, and a bar that throws is
     worse than one that waits a frame for its layout. */
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    if (!active || !width) { cancelAnimation(x); x.value = -width; return }
    if (t.prefs.reducedMotion) { x.value = 0; return }
    x.value = -width
    x.value = withRepeat(withTiming(width, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false)
    return () => cancelAnimation(x)
  }, [active, width, t.prefs.reducedMotion, x])

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))

  if (!active) return <View style={{ height }} />
  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{ height, overflow: 'hidden', backgroundColor: t.colors.accentSofter }}
    >
      <Animated.View style={[{ width: '45%', height: '100%', backgroundColor: t.colors.accent }, anim]} />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  card: { padding: space.lg, borderWidth: StyleSheet.hairlineWidth, marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tile: { width: '32%' },
})
