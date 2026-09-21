/* =========================================================
   Reports you filed.

   The reporter is told a COARSE outcome and nothing else:
   UNDER_REVIEW / ACTION_TAKEN / NO_ACTION /
   APPEAL_UNDER_REVIEW. What actually happened to the other
   account is that account's private moderation record — the
   info bar above the list says so once, plainly, so nobody
   reads "Action taken" as a description of a punishment.

   There is no GET /safety/reports/{id}. The row therefore
   travels to the detail screen through navigation params; the
   detail screen's fallback is a bounded scan of this same
   first page, which is why nothing here re-shapes a row before
   handing it over.

   Scroll shape: keyExtractor and getItemType are module-scope
   (the list is heterogeneous — month bands and report rows —
   and FlashList's recycle pools are keyed by item type), the
   row is memoized, and renderItem is useCallback-stable because
   the ViewHolder memo compares it BY IDENTITY.
   ========================================================= */
import React from 'react'
import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, adapters } from '@/api'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { OutcomePill, outcomeTone, reasonLabel, targetNoun } from '@/components/moderation'
import {
  EmptyState, ErrorState, Header, Icon, ListFooter, Screen, Skeleton, Text, Touchable,
} from '@/ui'

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'row'; key: string; report: any }

const keyExtractor = (item: Row) => item.key
const getItemType = (item: Row) => item.kind

const MonthBand = React.memo(function MonthBand({ label }: { label: string }) {
  const c = useTheme().colors
  return (
    <View style={[styles.band, { backgroundColor: c.bgSunken, borderBottomColor: c.separator }]}>
      <Text variant="caption" tone="muted" align="ui">{label}</Text>
    </View>
  )
})

export default function MyReportsScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const {
    items, error, loading, refreshing, loadingMore, done, loadMore, refresh, reload,
  } = usePaged<any>(
    ({ page, pageSize, signal }) => api.settings.safety.myReports({ page, size: pageSize, signal }),
    { mode: 'page', pageSize: 20, keyOf: r => String(r?.id ?? '') },
  )

  /* Month bands, computed once per items change. `createdAt` is the only
     ordering signal the DTO publishes, and the Page comes back newest-first. */
  const { data, stickyIndices } = React.useMemo(() => {
    const out: Row[] = []
    const sticky: number[] = []
    let band = ''
    for (const r of items) {
      const label = monthOf(r?.createdAt)
      if (label && label !== band) {
        band = label
        sticky.push(out.length)
        out.push({ kind: 'header', key: `h:${label}`, label })
      }
      out.push({ kind: 'row', key: String(r?.id ?? out.length), report: r })
    }
    return { data: out, stickyIndices: sticky }
  }, [items])

  /* Item-first and identity-stable, so one function serves every row instead
     of a closure minted per cell. */
  const openRow = useEvent((report: any) => router.push({
    pathname: '/settings/safety/reports/[id]',
    params: { id: String(report?.id ?? ''), row: JSON.stringify(report) },
  }))

  const renderItem = React.useCallback(({ item }: { item: Row }) => (
    item.kind === 'header'
      ? <MonthBand label={item.label} />
      : <ReportRow report={item.report} onPress={openRow} />
  ), [openRow])

  const contentStyle = React.useMemo(
    () => ({ paddingBottom: insets.bottom + 32 }),
    [insets.bottom],
  )

  if (loading) {
    return (
      <Screen background="sunken">
        <Header back title="Reports you filed" />
        <InfoBar />
        <View>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={[styles.skeleton, { borderBottomColor: c.separator }]}>
              <Skeleton width="58%" height={13} />
              <Skeleton width="40%" height={11} />
              <Skeleton width="26%" height={10} />
            </View>
          ))}
        </View>
      </Screen>
    )
  }

  /* This list IS the screen, so its failure is full-screen rather than a strip
     over an empty body. */
  if (error && !items.length) {
    return (
      <Screen background="sunken">
        <Header back title="Reports you filed" />
        <ErrorState error={error} onRetry={reload} title="Couldn't load your reports" />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Reports you filed" />
      <InfoBar />
      <FlashList
        data={data}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        stickyHeaderIndices={stickyIndices}
        renderItem={renderItem}
        contentContainerStyle={contentStyle}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={c.textMuted}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="flag"
            title="You haven't reported anything"
            message="Reports you file appear here with their outcome."
            secondaryLabel="Back to Safety"
            onSecondary={() => router.back()}
          />
        }
        ListFooterComponent={
          items.length ? (
            <ListFooter
              loading={loadingMore}
              error={items.length ? error : null}
              onRetry={loadMore}
              done={done}
              doneLabel="That's everything."
            />
          ) : null
        }
      />
    </Screen>
  )
}

function InfoBar() {
  const t = useTheme()
  return (
    <View style={[styles.info, { backgroundColor: t.colors.surfaceSunken, borderBottomColor: t.colors.separator }]}>
      <Icon name="info" size={14} color={t.colors.textMuted} />
      <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>
        We show you the outcome, not what happened to the other account.
      </Text>
    </View>
  )
}

/* Memoized and fed an item-first `onPress`, so one handler serves the list and
   a screen re-render does not repaint every visible row. */
const ReportRow = React.memo(function ReportRow(
  { report, onPress }: { report: any; onPress: (report: any) => void },
) {
  const t = useTheme()
  const c = t.colors
  const tone = outcomeTone(report?.outcome)
  const rule = tone === 'success' ? c.success
    : tone === 'warning' ? c.warning
      : tone === 'info' ? c.accent
        : c.borderStrong

  return (
    <Touchable onPress={() => onPress(report)} feedback="tint" noAutoHitSlop style={{ backgroundColor: c.bg }}>
      <View style={[styles.row, { borderBottomColor: c.separator }]}>
        <View style={[styles.rule, { backgroundColor: rule }]} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" align="ui" numberOfLines={1}>
            {targetNoun(report?.targetType)} · {reasonLabel(report?.reason)}
          </Text>
          <Text variant="footnote" tone="muted" align="auto" numberOfLines={1} style={{ marginTop: space.xxs }}>
            {report?.details ? String(report.details) : 'No details added'}
          </Text>
          <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xs }}>
            {adapters.timeAgo(report?.createdAt)}
          </Text>
        </View>
        <OutcomePill outcome={report?.outcome} size="sm" />
        <Icon name="forward" size={15} color={c.textFaint} />
      </View>
    </Touchable>
  )
})

/* Built once. `toLocaleDateString` with an options bag constructs a fresh
   Intl.DateTimeFormat internally, and this runs once per report on every
   banding pass. */
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

function monthOf(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return MONTH_FMT.format(d)
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  band: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    minHeight: 84,
    paddingEnd: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rule: { width: 4, alignSelf: 'stretch', borderTopEndRadius: 2, borderBottomEndRadius: 2 },
  skeleton: {
    gap: space.sm,
    height: 84,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
