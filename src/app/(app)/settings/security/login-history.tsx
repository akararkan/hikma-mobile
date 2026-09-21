/* =========================================================
   Login history.

   An append-only audit of every sign-in attempt, successes and
   failures alike — the failures are written in their own
   transaction precisely so they survive the exception that
   produced them. So FAILED rows are NORMAL here: they get a red
   glyph and nothing more. Styling them as errors would bury the
   one row that actually matters.

   That row is PASSWORD+RECOVERY. It means someone signed in
   without the authenticator, using a code from the recovery
   set — exactly what an attacker who phished a code would do,
   and exactly what a user who lost their phone would do. The
   client cannot tell which, so it surfaces the fact loudly and
   offers the two actions that fix the bad case.

   The three label maps live in api/security.js and are NOT
   re-exported by the barrel — importing them from '@/api'
   silently yields undefined and every row renders its raw enum.

   Scroll shape: two row kinds, so `getItemType` is mandatory —
   FlashList's recycle pools are keyed by item type, and without
   one a day header hands its React key to an event row and the
   whole subtree is torn down instead of swapping props. Both
   kinds are memoized components fed scalars, and renderItem is
   useCallback-stable because the ViewHolder memo compares it BY
   IDENTITY.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api } from '@/api'
import {
  LOGIN_METHOD_LABELS, LOGIN_OUTCOME_LABELS, NOTEWORTHY_LOGIN_METHODS,
} from '@/api/security.js'
import { useEvent } from '@/hooks/useAsync'
import { usePaged } from '@/hooks/usePaged'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Callout, EmptyState, ErrorState, Header, Icon, ListFooter, Screen, SkeletonRow,
  Text, Touchable, toast, type IconName,
} from '@/ui'

interface LoginRow {
  ip?: string | null
  userAgent?: string | null
  method?: string | null
  outcome?: string | null
  ts?: string | null
}

type Item = { kind: 'header'; key: string; label: string } | { kind: 'row'; key: string; row: LoginRow }

const keyExtractor = (i: Item) => i.key
const getItemType = (i: Item) => i.kind

/* ---------------------------------------------------------
   Row components. Both read the theme themselves rather than
   closing over the screen's `c`, so their memo survives a
   screen render.
   --------------------------------------------------------- */

const DayHeader = React.memo(function DayHeader({ label }: { label: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        paddingHorizontal: t.layout.screenPadding,
        paddingTop: space.lg2,
        paddingBottom: space.xs2,
        backgroundColor: t.colors.bg,
      }}
    >
      {/* `caption` uppercases LATIN ONLY inside the Text primitive — a manual
         transform here would also hit Arabic and Kurdish day labels. */}
      <Text variant="caption" tone="muted" align="ui">{label}</Text>
    </View>
  )
})

const LoginEventRow = React.memo(function LoginEventRow(
  { row, onCopy }: { row: LoginRow; onCopy: (row: LoginRow) => void },
) {
  const t = useTheme()
  const c = t.colors
  const outcome = String(row.outcome || '')
  const method = String(row.method || '')
  const noteworthy = NOTEWORTHY_LOGIN_METHODS.has(method)
  const skin = outcomeSkin(outcome, c)

  return (
    <Touchable
      onLongPress={() => onCopy(row)}
      feedback="tint"
      noAutoHitSlop
      accessibilityLabel={`${(LOGIN_OUTCOME_LABELS as any)[outcome] ?? outcome}. Long press to copy details.`}
      style={{
        flexDirection: 'row',
        gap: space.md,
        paddingHorizontal: t.layout.screenPadding,
        paddingVertical: space.md,
        /* A 3px bar rather than a tint: the row still has to read as
           one of a list, not as a separate card. */
        borderStartWidth: noteworthy ? 3 : 0,
        borderStartColor: c.warning,
      }}
    >
      <View style={{ paddingTop: space.xxs }}>
        <Icon name={skin.icon} size={19} color={skin.color} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="bodyStrong" align="ui" style={{ flexShrink: 1 }} numberOfLines={1}>
            {(LOGIN_OUTCOME_LABELS as any)[outcome] ?? outcome ?? 'Sign-in'}
          </Text>
          {noteworthy ? (
            /* A text-bearing plate is a setback chip, never a pill — the only
               pills in the app are unread counters and LIVE badges. */
            <View
              style={{
                backgroundColor: c.warningSoft,
                ...setback(t.shape.chip),
                borderCurve: 'continuous',
                paddingHorizontal: space.sm,
                paddingVertical: space.xxs,
              }}
            >
              <Text variant="micro" color={c.warningText}>Recovery code</Text>
            </View>
          ) : null}
        </View>
        <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
          {[(LOGIN_METHOD_LABELS as any)[method] ?? method, row.ip || 'unknown IP'].filter(Boolean).join(' · ')}
        </Text>
        {row.userAgent ? (
          <Text variant="caption" tone="faint" align="ui" numberOfLines={1}>
            {shortAgent(row.userAgent)}
          </Text>
        ) : null}
      </View>

      <Text variant="caption" tone="faint" style={{ paddingTop: space.xs }}>
        {clock(row.ts)}
      </Text>
    </Touchable>
  )
})

export default function LoginHistoryScreen() {
  const t = useTheme()
  const router = useRouter()
  const [dismissed, setDismissed] = React.useState(false)

  const list = usePaged<LoginRow>(
    ({ page, pageSize, signal }) => api.security.loginHistory({ page, size: pageSize, signal }),
    {
      mode: 'page',
      pageSize: 30,
      /* Rows carry no id — the audit is a stream of events, not entities — so
         the key is the tuple that makes one attempt unique. */
      keyOf: r => `${r.ts ?? ''}|${r.method ?? ''}|${r.outcome ?? ''}|${r.ip ?? ''}`,
    },
  )

  const items = React.useMemo(() => group(list.items), [list.items])
  const recovered = React.useMemo(
    () => list.items.some(r => NOTEWORTHY_LOGIN_METHODS.has(String(r.method))),
    [list.items],
  )

  /* Item-first and identity-stable, so one function serves every row. */
  const copyRow = useEvent(async (row: LoginRow) => {
    await Clipboard.setStringAsync(
      [row.ts, row.ip || 'no IP recorded', row.method, row.outcome].filter(Boolean).join(' · '),
    )
    toast.ok('Copied — paste it into your support message')
  })

  const renderItem = React.useCallback(({ item }: { item: Item }) => (
    item.kind === 'header'
      ? <DayHeader label={item.label} />
      : <LoginEventRow row={item.row} onCopy={copyRow} />
  ), [copyRow])

  return (
    <Screen>
      <Header back title="Login history" />

      {list.loading ? (
        <View>{Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} avatarSize={26} lines={2} />)}</View>
      ) : list.error && !list.items.length ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.5}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          ListHeaderComponent={
            recovered && !dismissed ? (
              <View style={{ padding: t.layout.screenPadding, paddingBottom: space.xs2 }}>
                <Callout
                  tone="warning"
                  icon="key"
                  title="A recovery code was used to sign in"
                  onDismiss={() => setDismissed(true)}
                  actionLabel="Change password"
                  onAction={() => router.push('/settings/account/change-password')}
                >
                  If that wasn't you, change your password and generate a new set of
                  recovery codes — the used one is spent, the rest are not.
                </Callout>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="history"
              title="No sign-ins recorded yet"
              message="Every attempt on this account will show up here, including the ones that fail."
            />
          }
          ListFooterComponent={
            list.items.length ? (
              <ListFooter
                loading={list.loadingMore}
                error={list.error}
                onRetry={list.loadMore}
                done={list.done}
                doneLabel="That's the whole history"
              />
            ) : null
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}

function outcomeSkin(outcome: string, c: any): { icon: IconName; color: string } {
  if (outcome === 'SUCCESS') return { icon: 'checkCircle', color: c.success }
  if (outcome === 'MFA_REQUIRED') return { icon: 'clock', color: c.warning }
  /* FAILED is expected and common — a red glyph, not a red row. */
  if (outcome === 'FAILED') return { icon: 'close', color: c.danger }
  return { icon: 'info', color: c.textMuted }
}

/** Rows arrive ts DESC, so a single pass is enough to insert day headers. */
function group(rows: LoginRow[]): Item[] {
  const out: Item[] = []
  let lastLabel: string | null = null
  rows.forEach((row, i) => {
    const label = dayLabel(row.ts)
    if (label !== lastLabel) {
      out.push({ kind: 'header', key: `h-${label}-${i}`, label })
      lastLabel = label
    }
    out.push({
      kind: 'row',
      key: `${row.ts ?? ''}|${row.method ?? ''}|${row.outcome ?? ''}|${row.ip ?? ''}|${i}`,
      row,
    })
  })
  return out
}

/* Every `toLocale*` call with an options bag builds a fresh Intl.DateTimeFormat
   internally — on Hermes that is full ICU pattern resolution. These two are
   built once and reused; `clock` runs once per visible row. */
const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const CLOCK_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function dayLabel(iso?: string | null) {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  const today = new Date()
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (same(d, yesterday)) return 'Yesterday'
  return DATE_FMT.format(d)
}

function clock(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : CLOCK_FMT.format(d)
}

/** A raw user-agent is 180 characters of build metadata. The two facts a
 *  person can act on are the browser or app, and the operating system. */
function shortAgent(ua: string) {
  const s = String(ua)
  /* The WIRE still says IKA — the app was renamed, its technical identity was
     not (bundle id com.ika.mobile). Match either so a session opened before
     the rename and one opened after both read as this app. */
  const app = /\b(IKA|Hikmah)\b[\s/]?([\d.]+)?/i.exec(s) ? 'Hikmah Web app'
    : /Edg\//.test(s) ? 'Edge'
      : /OPR\//.test(s) ? 'Opera'
        : /Chrome\//.test(s) ? 'Chrome'
          : /Firefox\//.test(s) ? 'Firefox'
            : /Safari\//.test(s) ? 'Safari'
              : ''
  const os = /iPhone|iPad|iOS/i.test(s) ? 'iOS'
    : /Android/i.test(s) ? 'Android'
      : /Mac OS X|Macintosh/i.test(s) ? 'macOS'
        : /Windows/i.test(s) ? 'Windows'
          : /Linux/i.test(s) ? 'Linux'
            : ''
  const joined = [app, os].filter(Boolean).join(' · ')
  return joined || s.slice(0, 48)
}
