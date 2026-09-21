/* =========================================================
   Staff-console primitives.

   Eight admin screens share one visual language: mono for
   machine identifiers, a pill for every enum, a tile for every
   count, and one inline error strip. Keeping them here is what
   stops the queue, the case and the ops board from each
   inventing their own idea of what a "status" looks like.

   Nothing in this file is user-facing — the moderator IS
   allowed to see the label, the score and the raw exception
   message, so none of the anti-probing rules in
   src/lib/moderation.js apply here.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { errorText, traceRef } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Button, Icon, Text, Touchable, toast, type TextProps } from '@/ui'

/* A case id, a version string and a dotted setting key are all things a
   moderator copies into a ticket. Proportional digits make them unreadable at
   a glance and unverifiable when compared side by side. The primitive's own
   `mono` voice (IBM Plex Mono, §4) does this — reaching past it for
   Menlo/monospace both left the ledger face and dropped Arabic shaping on
   any non-Latin keyword. */
export function Mono(props: TextProps) {
  return <Text mono {...props} />
}

/** A mono value in a faint capsule — field names, case ids, keywords. */
export function MonoChip({
  label, tone = 'neutral', onPress, style,
}: {
  label: string
  tone?: 'neutral' | 'accent' | 'danger' | 'warning'
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors
  const skin = tone === 'danger' ? { bg: c.dangerSoft, fg: c.dangerText }
    : tone === 'warning' ? { bg: c.warningSoft, fg: c.warningText }
      : tone === 'accent' ? { bg: c.accentSoft, fg: c.accentText }
        : { bg: c.surfaceSunken, fg: c.textSecondary }

  const box = (
    <View style={[styles.monoChip, { backgroundColor: skin.bg, borderRadius: t.radius.xs }, style]}>
      <Mono variant="caption" color={skin.fg} numberOfLines={1}>{label}</Mono>
    </View>
  )
  if (!onPress) return box
  return <Touchable onPress={onPress} feedback="dim" noAutoHitSlop>{box}</Touchable>
}

/* ---------------------------------------------------------
   Pills for the four staff enums. Each one is a closed set,
   so an unknown value falls through to neutral with the raw
   string rather than blank — an enum the backend added after
   this file was written must still be readable.
   --------------------------------------------------------- */

type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'

function Pill({ label, tone, size = 'md' }: { label: string; tone: PillTone; size?: 'sm' | 'md' }) {
  const t = useTheme()
  const c = t.colors
  const skin = tone === 'success' ? { bg: c.successSoft, fg: c.successText }
    : tone === 'warning' ? { bg: c.warningSoft, fg: c.warningText }
      : tone === 'danger' ? { bg: c.dangerSoft, fg: c.dangerText }
        : tone === 'info' ? { bg: c.infoSoft, fg: c.infoText }
          : tone === 'violet' ? { bg: c.scholarSoft, fg: c.scholarText }
            : { bg: c.surfaceSunken, fg: c.textSecondary }
  return (
    <View
      style={[
        styles.pill,
        setback(t.shape.chip),
        {
          backgroundColor: skin.bg,
          borderCurve: 'continuous',
          height: size === 'sm' ? 20 : 24,
          paddingHorizontal: size === 'sm' ? 8 : 10,
        },
      ]}
    >
      <Text variant={size === 'sm' ? 'micro' : 'caption'} color={skin.fg} numberOfLines={1}>{label}</Text>
    </View>
  )
}

const STATUS_TONE: Record<string, PillTone> = {
  IN_REVIEW: 'warning', PENDING: 'info', APPROVED: 'success', REJECTED: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  IN_REVIEW: 'In review', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected',
}

export function StatusPill({ status, size }: { status?: string | null; size?: 'sm' | 'md' }) {
  const key = String(status || '').toUpperCase()
  if (!key) return null
  return <Pill label={STATUS_LABEL[key] ?? key} tone={STATUS_TONE[key] ?? 'neutral'} size={size} />
}

const VERDICT_TONE: Record<string, PillTone> = { APPROVE: 'success', REVIEW: 'warning', REJECT: 'danger' }

export function VerdictPill({ verdict, size }: { verdict?: string | null; size?: 'sm' | 'md' }) {
  const key = String(verdict || '').toUpperCase()
  if (!key) return null
  return <Pill label={key} tone={VERDICT_TONE[key] ?? 'neutral'} size={size} />
}

const VERSION_TONE: Record<string, PillTone> = {
  TRAINING: 'info', EVALUATING: 'info', READY: 'success', SHADOW: 'violet',
  ACTIVE: 'success', RETIRED: 'neutral', FAILED: 'danger',
}

export function VersionStatusPill({ status }: { status?: string | null }) {
  const key = String(status || '').toUpperCase()
  if (!key) return null
  return <Pill label={key} tone={VERSION_TONE[key] ?? 'neutral'} />
}

export { Pill }

/* ---------------------------------------------------------
   Tile — one number with its word. The count row on the queue
   and every grid on the ops board.
   --------------------------------------------------------- */

export function Tile({
  label, value, tone = 'neutral', caption, onPress, style,
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'warning' | 'danger' | 'success'
  caption?: string
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors
  const fg = tone === 'danger' ? c.dangerText : tone === 'warning' ? c.warningText : tone === 'success' ? c.successText : c.text

  const box = (
    <View
      style={[
        styles.tile,
        { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm, borderColor: c.borderFaint },
        style,
      ]}
    >
      <Text variant="title2" color={fg} align="ui" numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>{label}</Text>
      {caption ? <Text variant="micro" tone="faint" align="ui" numberOfLines={1}>{caption}</Text> : null}
    </View>
  )
  if (!onPress) return box
  return <Touchable onPress={onPress} feedback="scale" noAutoHitSlop style={styles.flex}>{box}</Touchable>
}

/** A key/value line for the case and model meta grids. */
export function MetaRow({
  label, value, mono, onPress, tone,
}: {
  label: string
  value?: React.ReactNode
  mono?: boolean
  onPress?: () => void
  tone?: 'default' | 'danger'
}) {
  const body = (
    <View style={styles.metaRow}>
      <Text variant="caption" tone="muted" align="ui" style={styles.metaLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        mono
          ? <Mono variant="footnote" tone={onPress ? 'accent' : 'default'} align="ui" style={styles.flex} numberOfLines={1}>{String(value)}</Mono>
          : (
            <Text
              variant="footnote"
              tone={tone === 'danger' ? 'danger' : onPress ? 'accent' : 'default'}
              align="ui"
              style={styles.flex}
              numberOfLines={2}
            >
              {String(value)}
            </Text>
          )
      ) : <View style={styles.flex}>{value}</View>}
    </View>
  )
  if (!onPress) return body
  return <Touchable onPress={onPress} feedback="dim" noAutoHitSlop>{body}</Touchable>
}

/* ---------------------------------------------------------
   ErrorStrip — the inline failure attached to a control.

   Admin writes never toast: the decision IS the screen, and a
   toast that auto-dismisses takes the only record of what went
   wrong with it. `hint` carries the client-side follow-up
   (which page to open, which field to fill) so the server's own
   sentence stays untouched above it.
   --------------------------------------------------------- */

export function ErrorStrip({
  error, hint, onRetry, retryLabel = 'Try again', action, style,
}: {
  error: any
  hint?: string
  onRetry?: () => void
  retryLabel?: string
  action?: { label: string; onPress: () => void }
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors
  if (!error) return null
  const ref = traceRef(error)

  return (
    <View
      style={[
        styles.strip,
        { backgroundColor: c.dangerSoft, borderStartColor: c.danger, borderRadius: t.radius.xs },
        style,
      ]}
    >
      <Text variant="footnote" tone="danger" align="ui">{errorText(error)}</Text>
      {hint ? <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }}>{hint}</Text> : null}
      {onRetry || action || ref ? (
        <View style={styles.stripActions}>
          {onRetry ? <Button label={retryLabel} onPress={onRetry} variant="ghost" size="sm" /> : null}
          {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" size="sm" /> : null}
          {ref ? (
            <Button
              label="Copy reference"
              variant="ghost"
              size="sm"
              onPress={async () => {
                await Clipboard.setStringAsync(String(ref))
                toast.ok('Reference copied')
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** A 2xx caveat the server wrote itself. Rendered verbatim: dropping it turns
 *  an honest partial answer into a lie. */
export function WarningBanner({ text, style }: { text?: string | null; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const c = t.colors
  if (!text) return null
  return (
    <View
      style={[
        styles.strip,
        { backgroundColor: c.warningSoft, borderStartColor: c.warning, borderRadius: t.radius.xs },
        style,
      ]}
    >
      <View style={styles.warnHead}>
        <Icon name="warning" size={15} color={c.warningText} />
        <Text variant="footnote" tone="warning" align="ui" style={styles.flex}>{text}</Text>
      </View>
    </View>
  )
}

/** A card with a title and optional trailing affordance — the unit every
 *  admin screen is built out of. */
export function Panel({
  title, subtitle, actionLabel, onAction, children, style, padded = true,
}: {
  title?: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  padded?: boolean
}) {
  const t = useTheme()
  const c = t.colors
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: t.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.borderFaint,
          marginHorizontal: t.layout.screenPadding,
          marginTop: space.md,
          padding: padded ? 14 : 0,
        },
        style,
      ]}
    >
      {title ? (
        <View style={[styles.panelHead, padded ? null : { paddingHorizontal: space.md2, paddingTop: space.md2 }]}>
          <View style={styles.flex}>
            <Text variant="headline" align="ui">{title}</Text>
            {subtitle ? (
              <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{subtitle}</Text>
            ) : null}
          </View>
          {actionLabel ? (
            <Touchable onPress={onAction} feedback="dim">
              <Text variant="subhead" tone="accent" align="ui">{actionLabel}</Text>
            </Touchable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/** A dot + word health indicator: inference up/down, registry in sync. */
export function HealthDot({ up, label, onPress }: { up: boolean; label: string; onPress?: () => void }) {
  const t = useTheme()
  const c = t.colors
  const body = (
    <View style={styles.health}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: up ? c.success : c.danger }} />
      <Text variant="caption" tone={up ? 'success' : 'danger'} align="ui">{label}</Text>
    </View>
  )
  if (!onPress) return body
  return <Touchable onPress={onPress} feedback="dim" noAutoHitSlop>{body}</Touchable>
}

/* ---------------------------------------------------------
   Formatting.

   Every timestamp on this surface is
   `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` — a literal Z bolted onto a
   zoneless LocalDateTime, so it is "server local time claiming
   to be UTC". Nothing the client can do about that; these
   helpers at least keep every screen wrong in the same way
   instead of three different ways.

   The two Intl formatters are built ONCE. `toLocaleDateString`
   with an options bag constructs a fresh Intl.DateTimeFormat
   internally — full ICU pattern resolution on Hermes — and
   these run once per meta row on every case, audit and version
   list.
   --------------------------------------------------------- */

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return DATE_FMT.format(d)
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${DATE_FMT.format(d)}, ${TIME_FMT.format(d)}`
}

/** Hold ceilings and inline budgets are milliseconds on the wire and seconds
 *  in every sentence a human writes about them. */
export function fmtMs(ms?: number | null): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1000) return `${Math.round(n)}ms`
  const s = n / 1000
  return `${s % 1 === 0 ? s : s.toFixed(1)}s`
}

/** Signed relative distance to a deadline: 'in 12s' / 'overdue by 4m'. */
export function fmtDeadline(iso?: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return '—'
  const diff = at - now
  const abs = Math.abs(diff)
  const unit = abs < 60_000 ? `${Math.round(abs / 1000)}s`
    : abs < 3_600_000 ? `${Math.round(abs / 60_000)}m`
      : `${Math.round(abs / 3_600_000)}h`
  return diff >= 0 ? `in ${unit}` : `overdue by ${unit}`
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  monoChip: { paddingHorizontal: space.xs2, paddingVertical: space.xxs, alignSelf: 'flex-start', maxWidth: 220 },
  pill: { alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  tile: {
    flex: 1,
    minHeight: 62,
    paddingHorizontal: space.sm2,
    paddingVertical: space.sm,
    justifyContent: 'center',
    gap: space.xxs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingVertical: space.xs2 },
  metaLabel: { width: 112 },
  strip: { padding: space.sm2, borderStartWidth: 3 },
  stripActions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, marginTop: space.xs, marginStart: -space.sm, flexWrap: 'wrap' },
  warnHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm2 },
  health: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
})
