/* =========================================================
   Account strikes.

   `GET /safety/strikes` is a BARE ARRAY of active (non-expired)
   strikes — no envelope, no paging — so usePaged has nothing to
   do here and wiring it would invent a second page that never
   arrives.

   The rows are deliberately inert. There is no endpoint this
   client can call to appeal a strike, and offering a button
   that 404s would be worse than offering none; the reason text
   is long-press-copyable instead, so the user can quote the
   moderator's own words to support.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { fmtDate } from '@/components/moderation'
import {
  EmptyState, ErrorState, Header, ListRow, RowGroup, Screen, ScreenScroll,
  Skeleton, Text, Touchable, toast,
} from '@/ui'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export default function StrikesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()

  const { data, error, loading, refreshing, refresh, reload } =
    useAsync<any[]>(async () => (await api.settings.safety.strikes()) || [], { deps: [] })

  const rows = data || []

  if (loading) {
    return (
      <Screen background="sunken">
        <Header back title="Account strikes" />
        <View style={{ padding: space.lg, gap: space.lg }}>
          <Skeleton height={72} radius={t.radius.md} />
          {Array.from({ length: 3 }, (_, i) => (
            <View key={i} style={{ gap: space.sm }}>
              <Skeleton width="76%" height={13} />
              <Skeleton width="48%" height={11} />
            </View>
          ))}
        </View>
      </Screen>
    )
  }

  if (error) {
    return (
      <Screen background="sunken">
        <Header back title="Account strikes" />
        <ErrorState error={error} onRetry={reload} title="Couldn't load your strikes" />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Account strikes" />
      <ScreenScroll refreshing={refreshing} onRefresh={refresh}>
        {!rows.length ? (
          <EmptyState
            icon="checkCircle"
            title="No strikes on your account"
            message="Nothing here is good news."
            secondaryLabel="Back to Safety"
            onSecondary={() => router.back()}
          />
        ) : (
          <>
            <View style={[styles.band, { backgroundColor: c.dangerSoft, borderRadius: t.radius.md }]}>
              <Text variant="display" color={c.dangerText} align="ui">{rows.length}</Text>
              <Text variant="callout" color={c.dangerText} align="ui">
                active {rows.length === 1 ? 'strike' : 'strikes'}
              </Text>
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs2 }}>
                Strikes expire automatically 90 days after they are issued.
              </Text>
            </View>

            <View style={{ marginTop: space.sm }}>
              {rows.map((s: any, i: number) => (
                <StrikeRow key={String(s?.id ?? i)} strike={s} />
              ))}
            </View>
          </>
        )}

        <View style={[styles.footerCard, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.md }]}>
          <Text variant="headline" align="ui">What strikes do</Text>
          <Text variant="callout" tone="secondary" align="ui" style={{ marginTop: space.xs }}>
            Active strikes can limit what you can do on the platform. They disappear on their own.
          </Text>
        </View>
        <RowGroup style={{ marginTop: space.md }}>
          <ListRow
            title="Community Guidelines"
            icon="book"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push({ pathname: '/policies/[key]', params: { key: 'guidelines' } })}
          />
        </RowGroup>
      </ScreenScroll>
    </Screen>
  )
}

function StrikeRow({ strike }: { strike: any }) {
  const t = useTheme()
  const c = t.colors

  /* Elapsed fraction of the decay window. `issuedAt` is the anchor; when the
     server sent an expiry that is not exactly 90 days out, trust the pair it
     sent rather than the constant. */
  const issued = Date.parse(strike?.issuedAt ?? '')
  const expires = Date.parse(strike?.expiresAt ?? '')
  const total = Number.isFinite(issued) && Number.isFinite(expires) && expires > issued
    ? expires - issued
    : NINETY_DAYS_MS
  const elapsed = Number.isFinite(issued) ? Math.max(0, Math.min(total, Date.now() - issued)) : 0
  const pct = total > 0 ? elapsed / total : 0

  return (
    <Touchable
      onLongPress={async () => {
        if (!strike?.reason) return
        await Clipboard.setStringAsync(String(strike.reason))
        toast.ok('Reason copied')
      }}
      feedback="none"
      noAutoHitSlop
      accessibilityLabel="Strike. Long press to copy the reason."
      style={[styles.row, { backgroundColor: c.surface, borderStartColor: c.danger }]}
    >
      {/* The moderator's own text: rendered in full, wrapping rather than
          truncating, because it is the only account of what happened. */}
      <Text variant="callout" align="auto" numberOfLines={3}>{strike?.reason}</Text>
      <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs }}>
        Issued {fmtDate(strike?.issuedAt)} · Expires {fmtDate(strike?.expiresAt)}
      </Text>
      <View style={[styles.track, { backgroundColor: c.surfaceSunken }]}>
        <View style={{ width: `${Math.round(pct * 100)}%`, height: '100%', backgroundColor: c.danger, borderRadius: 2 }} />
      </View>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  band: {
    marginHorizontal: space.lg,
    marginTop: space.md2,
    padding: space.lg,
    minHeight: 72,
    justifyContent: 'center',
  },
  row: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.md2,
    minHeight: 72,
    borderStartWidth: 4,
    borderRadius: 10,
  },
  track: { height: 4, borderRadius: 2, marginTop: space.sm2, overflow: 'hidden' },
  footerCard: {
    marginHorizontal: space.lg,
    marginTop: space.xl,
    padding: space.md2,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
