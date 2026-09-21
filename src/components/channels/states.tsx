/* =========================================================
   The three terminal surfaces, kept distinct.

   The error guide is explicit that a 403 is not an error: the
   server answered, the answer is "no", and a Retry button turns
   a settled question into a loop. So a refusal gets its own
   component — server message verbatim, one way out, no retry —
   while `ErrorState` keeps the retry for the transient family
   and `EmptyState` keeps the cheerful arm for a genuine zero.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { errorText, isNetworkError } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, Text, type IconName } from '@/ui'

/** A 403. The server's sentence is the whole message; we only frame it. */
export function RefusalCard({
  error, title, icon = 'lock', actionLabel = 'Back', onAction,
}: {
  error?: any
  title?: string
  icon?: IconName
  actionLabel?: string | null
  onAction?: () => void
}) {
  const t = useTheme()
  const router = useRouter()
  const back = onAction ?? (() => { if (router.canGoBack()) router.back() })
  return (
    <View style={[styles.center, { padding: space.xxxl, gap: space.sm }]}>
      <View style={[styles.glyph, { backgroundColor: t.colors.surfaceSunken }]}>
        <Icon name={icon} size={28} color={t.colors.textFaint} />
      </View>
      <Text variant="title3" align="center">{title ?? 'Not allowed'}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320 }}>
        {errorText(error, 'You do not have permission to do that.')}
      </Text>
      {actionLabel ? (
        <Button label={actionLabel} onPress={back} variant="tinted" style={{ marginTop: space.lg }} />
      ) : null}
    </View>
  )
}

/** A 404 anywhere in the domain: quiet, never an error toast. */
export function GoneCard({
  title = 'This channel is no longer available',
  message = 'It may have been deleted, or the link is stale.',
  onBrowse,
}: { title?: string; message?: string; onBrowse?: () => void }) {
  const t = useTheme()
  return (
    <View style={[styles.center, { padding: space.xxxl, gap: space.sm }]}>
      <View style={[styles.glyph, { backgroundColor: t.colors.surfaceSunken }]}>
        <Icon name="channels" size={28} color={t.colors.textFaint} />
      </View>
      <Text variant="title3" align="center">{title}</Text>
      <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320 }}>{message}</Text>
      {onBrowse ? <Button label="Browse channels" onPress={onBrowse} variant="tinted" style={{ marginTop: space.lg }} /> : null}
    </View>
  )
}

/** The thin strip a screen wears while it is degraded but still useful. */
export function TopStrip({ tone = 'warning', children }: { tone?: 'warning' | 'danger' | 'neutral'; children: string }) {
  const t = useTheme()
  const c = t.colors
  const bg = tone === 'danger' ? c.dangerSoft : tone === 'neutral' ? c.surfaceSunken : c.warningSoft
  const fg = tone === 'danger' ? c.dangerText : tone === 'neutral' ? c.textSecondary : c.warningText
  return (
    <View style={[styles.strip, { backgroundColor: bg }]}>
      <Icon name={tone === 'neutral' ? 'info' : 'warning'} size={14} color={fg} />
      <Text variant="caption" color={fg} align="ui" numberOfLines={2} style={styles.flex}>{children}</Text>
    </View>
  )
}

/** The offline copy the error module already owns, as a strip. */
export function OfflineStrip({ error }: { error: any }) {
  if (!isNetworkError(error)) return null
  return <TopStrip tone="neutral">{errorText(error)}</TopStrip>
}

/* One delayed auto-retry for a transient read (503) — re-exported so the
   existing `from '@/components/channels/states'` import sites keep working.
   The body moved to src/hooks/useTransientRetry.ts because this copy guarded
   on the error's object IDENTITY, and http.js mints a fresh error per
   request: the guard never matched, so it never guarded. */
export { useTransientRetry } from '@/hooks/useTransientRetry'

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  glyph: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs2 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md2, paddingVertical: space.sm },
  flex: { flex: 1 },
})
