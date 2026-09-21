/* =========================================================
   The domain's four failure surfaces.

   A 404 in this module means one of three things — deleted,
   invisible under its visibility level, or a block edge in
   either direction — and the API gives no signal which. So
   GoneState's copy stays deliberately neutral: naming any one
   of them would either be wrong or would leak a block.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { errorText, isNetworkError, isTransient, traceRef } from '@/api'
import { MODERATION_COPY } from '@/lib/moderation'
import { Button, Callout, Icon, Text } from '@/ui'
import { to } from './nav'

/* ---------------------------------------------------------
   GoneState — the quiet 404.
   --------------------------------------------------------- */

export function GoneState({
  title = 'This paper is no longer available.',
  body = 'It may have been removed, or you and the researcher cannot see each other.',
  actionLabel = 'Back to research',
  onAction,
}: {
  title?: string
  body?: string
  actionLabel?: string | null
  onAction?: () => void
}) {
  const t = useTheme()
  const router = useRouter()
  return (
    <View style={[styles.center, { padding: space.xxxl, gap: space.xs2 }]}>
      <View style={[styles.plate, { backgroundColor: t.colors.surfaceSunken }]}>
        <Icon name="research" size={26} color={t.colors.textFaint} />
      </View>
      <Text variant="title3" align="center">{title}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{body}</Text>
      {actionLabel ? (
        <Button
          label={actionLabel}
          onPress={onAction ?? (() => router.replace(to('/research')))}
          variant="tinted"
          style={{ marginTop: space.lg }}
        />
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   ErrorPanel — everything that is not a 404.

   Retry is offered only where retrying can plausibly work: a
   400 will answer 400 again, and a button that never helps is
   worse than no button.
   --------------------------------------------------------- */

export function ErrorPanel({
  error, onRetry, compact = false, style,
}: { error: any; onRetry?: () => void; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const offline = isNetworkError(error)
  const retryable = !!onRetry && (offline || isTransient(error) || (error?.status ?? 500) >= 500)
  const ref = traceRef(error)

  if (compact) {
    return (
      <View style={[styles.compact, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radius.md }, style]}>
        <Icon name={offline ? 'offline' : 'error'} size={16} color={t.colors.dangerText} />
        <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>
          {offline ? 'You are offline — check your connection.' : errorText(error)}
        </Text>
        {retryable ? <Button label="Retry" onPress={onRetry} variant="ghost" size="sm" /> : null}
      </View>
    )
  }

  return (
    <View style={[styles.center, { padding: space.xxxl, paddingVertical: 44, gap: space.xs2 }, style]}>
      <View style={[styles.plate, { backgroundColor: offline ? t.colors.surfaceSunken : t.colors.dangerSoft }]}>
        <Icon name={offline ? 'offline' : 'error'} size={26} color={offline ? t.colors.textFaint : t.colors.danger} />
      </View>
      <Text variant="title3" align="center">{offline ? "You're offline" : 'Something went wrong'}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>
        {offline ? 'The last loaded papers are still here. Reconnect to see the rest.' : errorText(error)}
      </Text>
      {retryable ? <Button label="Try again" onPress={onRetry} icon="refresh" variant="tinted" style={{ marginTop: space.md2 }} /> : null}
      {ref ? (
        <Text variant="caption" tone="faint" align="center" selectable style={{ marginTop: space.sm2 }}>
          Reference {String(ref).slice(0, 8)}
        </Text>
      ) : null}
    </View>
  )
}

/** One delayed automatic retry for a 503-class read, then hand over to the
 *  panel. Anything more is a retry loop wearing a hoodie. Re-exported so the
 *  existing `from './states'` import sites keep working; the body moved to
 *  src/hooks/useTransientRetry.ts because this copy reset its guard whenever
 *  `error` went falsy — and useAsync clears the error before it re-awaits, so
 *  a persistent 503 re-armed it on every attempt. */
export { useTransientRetry } from '@/hooks/useTransientRetry'

/* ---------------------------------------------------------
   ModerationNotice — held content.

   Every word comes from MODERATION_COPY. Hand-writing this
   copy is how a client ends up hinting at what tripped the
   classifier, which turns the UI into a probing oracle.
   --------------------------------------------------------- */

export function ModerationNotice({
  state, onRecheck, style,
}: { state: 'checking' | 'review' | 'removed'; onRecheck?: () => void; style?: StyleProp<ViewStyle> }) {
  const copy = MODERATION_COPY[state]
  return (
    <Callout
      tone={state === 'removed' ? 'danger' : 'warning'}
      icon={state === 'checking' ? 'hourglass' : 'shield'}
      title={copy.title}
      actionLabel={onRecheck && state !== 'removed' ? 'Check again' : undefined}
      onAction={onRecheck}
      style={style}
    >
      {copy.note}
    </Callout>
  )
}

/* ---------------------------------------------------------
   RefusalState — a rights refusal, which is not a wrong
   address: no retry, because trying again cannot change it.
   --------------------------------------------------------- */

export function RefusalState({
  title = 'Research authoring is for scholars and researchers.',
  body = 'Ask an administrator if your account should be able to publish.',
}: { title?: string; body?: string }) {
  const t = useTheme()
  return (
    <View style={[styles.center, { padding: space.xxxl, paddingVertical: 52, gap: space.xs2 }]}>
      <View style={[styles.plate, { backgroundColor: t.colors.scholarSoft }]}>
        <Icon name="scholar" size={26} color={t.colors.scholar} />
      </View>
      <Text variant="title3" align="center">{title}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>{body}</Text>
    </View>
  )
}

/** The signed-out arm of every social control in the domain. */
export function SignInPrompt({ message = 'Sign in to take part in the discussion.' }: { message?: string }) {
  const router = useRouter()
  const t = useTheme()
  return (
    <View style={[styles.center, { padding: space.xxxl, paddingVertical: 44, gap: space.xs2 }]}>
      <View style={[styles.plate, { backgroundColor: t.colors.accentSoft }]}>
        <Icon name="person" size={26} color={t.colors.accent} />
      </View>
      <Text variant="title3" align="center">Sign in first</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 300, marginTop: space.xxs }}>{message}</Text>
      <Button label="Sign in" onPress={() => router.push(to('/(auth)/sign-in'))} variant="primary" style={{ marginTop: space.lg }} />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  plate: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm2 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, padding: space.md },
  flex: { flex: 1 },
})
