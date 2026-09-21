/* =========================================================
   Safety.

   This screen is a destination before it is a hub. Three
   different things point at it and all three arrive expecting
   the moderation card to be the first thing they see:

     · CONTENT_REJECTED's server copy — "you can appeal from
       your account settings"
     · MODERATION_COPY.removed — "Settings → Safety"
     · all three moderation notifications, whose `linkOf`
       returns the literal '/settings/safety#moderation'

   expo-router cannot route a fragment, so the notification row
   strips it and passes `section=moderation`; this screen reads
   that param, scrolls the card into view and flashes its
   outline once. Without that the deep link lands on a screen
   with four cards and no indication which one it meant.

   Every card loads independently. One failing summary call
   costs its own card and nothing else — a safety centre that
   will not open because the score endpoint 500'd is a worse
   failure than a missing ring.
   ========================================================= */
import React from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, {
  useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated'
import { api, codeOf, errorText } from '@/api'
import { adapters } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { ModerationBadge } from '@/components/system/Moderation'
import { OutcomePill, fmtDate, reasonLabel, targetNoun } from '@/components/moderation'
import {
  Button, Divider, Header, Icon, ListRow, RowGroup, Screen, Skeleton, Text, Touchable,
} from '@/ui'

/* Score-checklist keys the backend actually ships, mapped to the screen that
   fixes them. An unknown key stays inert rather than guessing a route — a
   checklist row that navigates nowhere is better than one that navigates
   somewhere wrong. */
const SCORE_ROUTES: Record<string, string> = {
  two_factor: '/settings/security/two-factor',
  /* `recovery` and `email_verified` read the SAME flag (isEmailVerified) —
     email IS the recovery channel — so both route to the verify-email card
     and clear together the moment it flips. Recovery CODES are a different
     thing entirely and cannot move this item. */
  recovery: '/settings/security/verify-email',
  email_verified: '/settings/security/verify-email',
  recent_review: '/settings/security/sessions',
}

export default function SafetyScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { section } = useLocalSearchParams<{ section?: string }>()

  /* The signed-in gate lives in (app)/_layout.tsx — it redirects before this
     tree mounts, so a second check here would be dead code. */
  const score = useAsync<any>(() => api.settings.safety.score(), { deps: [] })
  const strikes = useAsync<any[]>(async () => (await api.settings.safety.strikes()) || [], { deps: [] })
  const reports = useAsync<any>(() => api.settings.safety.myReports({ page: 0, size: 5 }), { deps: [] })

  const scrollRef = React.useRef<ScrollView>(null)
  const cardY = React.useRef(0)
  const flash = useSharedValue(0)
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }))

  React.useEffect(() => {
    if (section !== 'moderation') return
    /* One frame of slack so the card has been laid out and `cardY` is real;
       scrolling to 0 would look like the deep link did nothing. */
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, cardY.current - 12), animated: !t.prefs.reducedMotion })
      flash.value = withSequence(
        withTiming(1, { duration: t.ms(180) }),
        withTiming(1, { duration: t.ms(840) }),
        withTiming(0, { duration: t.ms(200) }),
      )
    }, 260)
    return () => clearTimeout(id)
  }, [section, flash, t])

  const refreshing = score.refreshing || strikes.refreshing || reports.refreshing
  const refreshAll = React.useCallback(() => {
    void Promise.all([score.refresh(), strikes.refresh(), reports.refresh()])
  }, [score, strikes, reports])

  const strikeRows: any[] = strikes.data || []
  const reportRows: any[] = reports.data?.items || []
  const firstLoad = score.loading && strikes.loading && reports.loading

  /* A 404 USER_NOT_FOUND from /safety/score is documented and means "no score
     row yet", not "something broke" — collapse the card rather than showing a
     zero the user cannot act on. */
  const scoreGone = codeOf(score.error) === 'USER_NOT_FOUND'
  const showScore = !scoreGone && (score.loading || !!score.data || !!score.error)

  return (
    <Screen background="sunken">
      <Header back title="Safety" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space.huge }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
      >
        {/* ---- 1. Automatic content checks — the deep-link target ---- */}
        <View
          onLayout={e => { cardY.current = e.nativeEvent.layout.y }}
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.card, marginTop: space.md2 },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: t.radius.card, borderWidth: 2, borderColor: c.accent },
              flashStyle,
            ]}
          />
          <View style={styles.cardHead}>
            <Icon name="shield" size={24} color={c.accent} />
            <Text variant="headline" align="ui" style={styles.flex}>Automatic content checks</Text>
          </View>
          <Text variant="callout" tone="secondary" align="ui" style={{ marginTop: space.xs2 }}>
            Everything you post is checked automatically before anyone else can see it.
            Most of the time you&apos;ll never notice.
          </Text>

          <View style={{ marginTop: space.md, gap: space.xxs }}>
            <LegendRow state="checking" note="Saved, visible only to you while it's checked" />
            <LegendRow state="review" note="A moderator is taking a look" />
            <LegendRow state="removed" note="Blocked for violating the guidelines" />
          </View>

          <Divider style={{ marginTop: space.md, marginBottom: space.xs }} />
          <Button
            label="How this works and how to appeal"
            onPress={() => router.push('/settings/safety/moderation')}
            variant="ghost"
            size="md"
            block
          />
        </View>

        {/* ---- 2. Security score ---- */}
        {showScore ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.card }]}>
            {score.loading ? (
              <View style={{ flexDirection: 'row', gap: space.md2, alignItems: 'center' }}>
                <Skeleton circle width={64} height={64} />
                <View style={{ flex: 1, gap: space.sm }}>
                  <Skeleton width="70%" height={12} />
                  <Skeleton width="52%" height={12} />
                  <Skeleton width="61%" height={12} />
                </View>
              </View>
            ) : score.error ? (
              <CardError error={score.error} onRetry={score.reload} />
            ) : (
              <>
                <View style={styles.scoreHead}>
                  <ScoreRing value={Number(score.data?.score ?? 0)} level={String(score.data?.level ?? '')} />
                  <View style={styles.flex}>
                    <Text variant="headline" align="ui">Account security</Text>
                    <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
                      The stronger this is, the harder your account is to take.
                    </Text>
                  </View>
                </View>
                <View style={{ marginTop: space.sm2 }}>
                  {(score.data?.items || []).map((item: any, i: number) => (
                    <ChecklistRow
                      key={item?.key ?? i}
                      item={item}
                      onPress={
                        SCORE_ROUTES[String(item?.key)]
                          ? () => router.push(SCORE_ROUTES[String(item.key)] as any)
                          : undefined
                      }
                    />
                  ))}
                </View>
              </>
            )}
          </View>
        ) : null}

        {/* ---- 3. Strikes ---- */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.card }]}>
          <View style={styles.cardHead}>
            <Text variant="headline" align="ui" style={styles.flex}>Account strikes</Text>
            {!strikes.loading && !strikes.error ? (
              <View style={[styles.countPill, { backgroundColor: strikeRows.length ? c.dangerSoft : c.successSoft }]}>
                <Text variant="caption" color={strikeRows.length ? c.dangerText : c.successText}>
                  {strikeRows.length}
                </Text>
              </View>
            ) : null}
          </View>

          {strikes.loading ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Skeleton width="80%" height={12} />
              <Skeleton width="55%" height={12} />
            </View>
          ) : strikes.error ? (
            <CardError error={strikes.error} onRetry={strikes.reload} />
          ) : !strikeRows.length ? (
            <View style={styles.emptyRow}>
              <Icon name="checkCircle" size={28} color={c.success} />
              <Text variant="callout" tone="secondary" align="ui" style={styles.flex}>
                No strikes on your account.
              </Text>
            </View>
          ) : (
            <>
              {strikeRows.slice(0, 3).map((s: any, i: number) => (
                <View key={s?.id ?? i} style={[styles.ruleRow, { borderStartColor: c.danger }]}>
                  {/* The moderator's own words — never truncated or re-worded. */}
                  <Text variant="callout" align="auto">{s?.reason}</Text>
                  <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xs }}>
                    Issued {fmtDate(s?.issuedAt)} · expires {fmtDate(s?.expiresAt)}
                  </Text>
                </View>
              ))}
              <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.sm2 }}>
                Strikes expire automatically after 90 days.
              </Text>
              {strikeRows.length > 3 ? (
                <Button
                  label={`See all ${strikeRows.length}`}
                  onPress={() => router.push('/settings/safety/strikes')}
                  variant="ghost"
                  size="sm"
                  style={{ marginTop: space.xs2, marginStart: -space.md }}
                />
              ) : null}
            </>
          )}
        </View>

        {/* ---- 4. Reports you filed ---- */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint, borderRadius: t.radius.card }]}>
          <View style={styles.cardHead}>
            <Text variant="headline" align="ui" style={styles.flex}>Reports you filed</Text>
          </View>

          {reports.loading ? (
            <View style={{ gap: space.sm2, marginTop: space.sm }}>
              <Skeleton width="72%" height={12} />
              <Skeleton width="58%" height={12} />
              <Skeleton width="64%" height={12} />
            </View>
          ) : reports.error ? (
            <CardError error={reports.error} onRetry={reports.reload} />
          ) : !reportRows.length ? (
            <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xs }}>
              You haven&apos;t reported anything.
            </Text>
          ) : (
            <>
              {reportRows.slice(0, 5).map((r: any, i: number) => (
                <Touchable
                  key={String(r?.id ?? i)}
                  onPress={() => router.push({
                    pathname: '/settings/safety/reports/[id]',
                    /* There is no GET /safety/reports/{id}: the row travels in
                       the params or the detail screen has nothing to show. */
                    params: { id: String(r?.id ?? ''), row: JSON.stringify(r) },
                  })}
                  feedback="tint"
                  noAutoHitSlop
                  style={styles.reportRow}
                >
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" align="ui" numberOfLines={1}>
                      {targetNoun(r?.targetType)} · {reasonLabel(r?.reason)}
                    </Text>
                    <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
                      {adapters.timeAgo(r?.createdAt) || fmtDate(r?.createdAt)}
                    </Text>
                  </View>
                  <OutcomePill outcome={r?.outcome} size="sm" />
                </Touchable>
              ))}
              <Button
                label="See all reports"
                onPress={() => router.push('/settings/safety/reports')}
                variant="ghost"
                size="sm"
                style={{ marginTop: space.xs, marginStart: -space.md }}
              />
            </>
          )}
        </View>

        {/* ---- 5. Policy ---- */}
        <RowGroup style={{ marginTop: space.lg }}>
          <ListRow
            title="Community Guidelines"
            icon="book"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push({ pathname: '/policies/[key]', params: { key: 'guidelines' } })}
          />
        </RowGroup>

        {firstLoad ? null : (
          <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.lg2, paddingHorizontal: space.xxxl }}>
            We show you the outcome of a report, never what happened to the other account.
          </Text>
        )}
      </ScrollView>
    </Screen>
  )
}

/* ---------------------------------------------------------
   Pieces.
   --------------------------------------------------------- */

function LegendRow({ state, note }: { state: 'checking' | 'review' | 'removed'; note: string }) {
  return (
    <View style={styles.legendRow}>
      <ModerationBadge state={state} />
      <Text variant="footnote" tone="muted" align="ui" style={styles.flex} numberOfLines={2}>{note}</Text>
    </View>
  )
}

function ChecklistRow({ item, onPress }: { item: any; onPress?: () => void }) {
  const t = useTheme()
  const c = t.colors
  const passed = !!item?.passed
  const body = (
    <View style={styles.checkRow}>
      {passed
        ? <Icon name="checkCircle" size={20} color={c.success} filled />
        : <View style={[styles.hollow, { borderColor: c.borderStrong }]} />}
      <View style={styles.flex}>
        <Text variant="callout" align="ui">{item?.label}</Text>
        {/* Server copy. Rendered verbatim: it names the exact next action. */}
        {!passed && item?.recommendation ? (
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
            {item.recommendation}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="forward" size={15} color={c.textFaint} /> : null}
    </View>
  )
  if (!onPress) return body
  return <Touchable onPress={onPress} feedback="tint" noAutoHitSlop>{body}</Touchable>
}

/* A segmented ring rather than an arc: 36 ticks give the same read at 64pt,
   need no SVG dependency, and mirror correctly under RTL because nothing here
   is drawn from a left edge. */
function ScoreRing({ value, level }: { value: number; level: string }) {
  const t = useTheme()
  const c = t.colors
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const lit = Math.round((pct / 100) * 36)
  const tone = pct >= 80 ? c.success : pct >= 50 ? c.warning : c.danger
  const word = level ? level.charAt(0) + level.slice(1).toLowerCase() : ''

  return (
    <View style={styles.ring}>
      {Array.from({ length: 36 }, (_, i) => (
        <View
          key={i}
          style={[
            styles.ringSeg,
            {
              backgroundColor: i < lit ? tone : c.surfaceSunken,
              transform: [{ rotate: `${i * 10}deg` }, { translateY: -28 }],
            },
          ]}
        />
      ))}
      <View style={styles.ringLabel}>
        <Text variant="title3" align="center" color={tone}>{pct}</Text>
        <Text variant="micro" tone="muted" align="center" numberOfLines={1}>{word}</Text>
      </View>
    </View>
  )
}

function CardError({ error, onRetry }: { error: any; onRetry: () => void }) {
  const t = useTheme()
  return (
    <View
      style={[
        styles.cardError,
        { backgroundColor: t.colors.dangerSoft, borderStartColor: t.colors.danger, borderRadius: t.radius.xs },
      ]}
    >
      <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>{errorText(error)}</Text>
      <Button label="Retry" onPress={onRetry} variant="ghost" size="sm" />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, minHeight: 32 },
  scoreHead: { flexDirection: 'row', alignItems: 'center', gap: space.md2 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2, paddingVertical: space.sm },
  hollow: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, marginTop: space.xxs },
  countPill: { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, marginTop: space.sm },
  ruleRow: { borderStartWidth: 4, paddingStart: space.sm2, paddingVertical: space.xs2, marginTop: space.sm2 },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm2 },
  cardError: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm2, borderStartWidth: 3, marginTop: space.sm },
  ring: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  ringSeg: { position: 'absolute', width: 2.5, height: 7, borderRadius: 2 },
  ringLabel: { alignItems: 'center', justifyContent: 'center' },
})
