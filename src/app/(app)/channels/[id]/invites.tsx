/* =========================================================
   Invite links.

   The plaintext token comes back EXACTLY ONCE, on create — the
   server stores only a hash, and `invites.list` is metadata.
   So a freshly created link is rendered from the create
   response and held in local state; re-fetching the list to
   show it would show a row with no link in it.

   A link dies three different ways — revoked, expired,
   exhausted — and the adapter derives all three. The card says
   which one happened rather than a single grey "inactive".
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import QRCode from 'react-native-qrcode-svg'
import { api, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { ramp, space } from '@/theme/tokens'
import {
  Button, Chip, ConfirmSheet, EmptyState, ErrorState, Field, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, Sheet, Skeleton, Text, toast, useSheetState,
} from '@/ui'
import { RefusalCard } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { args } from '@/components/channels/apiArgs'

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never', hours: undefined as number | undefined },
  { value: '1h', label: '1 hour', hours: 1 },
  { value: '1d', label: '1 day', hours: 24 },
  { value: '1w', label: '1 week', hours: 168 },
]
const USES_OPTIONS = [
  { value: 'any', label: 'No limit', max: undefined as number | undefined },
  { value: '1', label: '1', max: 1 },
  { value: '10', label: '10', max: 10 },
  { value: '100', label: '100', max: 100 },
]

export default function InvitesScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const list = useAsync<any[]>(() => api.channels.invites.list(id), { enabled: !!id, deps: [id] })

  /* The one link whose token we still hold. It is deliberately NOT merged
     into `list` — a refresh would silently drop the token half of it. */
  const [fresh, setFresh] = React.useState<any>(null)

  const createSheet = useSheetState()
  const qrSheet = useSheetState<any>()
  const confirmRevoke = useSheetState<any>()

  useFocusEffect(React.useCallback(() => { void list.refresh() }, [id]))   // eslint-disable-line react-hooks/exhaustive-deps

  const canInvite = rights.can('canInviteUsers')

  const revoke = async (invite: any) => {
    const before = list.data
    list.setData(prev => (prev || []).map(x => (x.id === invite.id ? { ...x, revoked: true } : x)))
    if (fresh?.id === invite.id) setFresh(null)
    try { await api.channels.invites.revoke(id, invite.id) }
    catch (e: any) { list.setData(before ?? null); toast.error(errorText(e)) }
  }

  const sorted = React.useMemo(() => {
    const rows = [...(list.data || [])]
    const rank = (r: any) => (r.revoked ? 2 : r.expired || r.exhausted ? 1 : 0)
    return rows.sort((a, b) => rank(a) - rank(b) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }, [list.data])

  if (!rights.loading && rights.channel && !canInvite) {
    return (
      <Screen background="sunken">
        <Header back title="Invite links" />
        <RefusalCard title="You can’t manage invite links here" onAction={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Invite links"
        subtitle={rights.channel?.title}
        actions={[{ icon: 'add', onPress: () => createSheet.open(), label: 'Create a link' }]}
      />

      {list.loading ? (
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={140} radius={14} />)}
        </View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !sorted.length && !fresh ? (
        <EmptyState
          icon="key"
          title="No invite links yet"
          message={
            rights.channel?.publicChannel === false
              ? 'An invite link is the only way in.'
              : 'People can already subscribe from search — links are for tracking and for approval-gated invites.'
          }
          actionLabel="Create a link"
          onAction={() => createSheet.open()}
        />
      ) : (
        <ScreenScroll
          refreshing={list.refreshing}
          onRefresh={() => void list.refresh()}
          contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.sm2 }}
        >
          {fresh ? (
            <InviteCard
              invite={fresh}
              highlighted
              onCopy={async () => { await Clipboard.setStringAsync(fresh.shareUrl); toast.ok('Link copied') }}
              onShare={() => void Share.share({ message: fresh.shareUrl, url: fresh.shareUrl }).catch(() => {})}
              onQr={() => qrSheet.open(fresh)}
              onRevoke={() => confirmRevoke.open(fresh)}
            />
          ) : null}

          {sorted.filter(r => r.id !== fresh?.id).map(invite => (
            <InviteCard key={invite.id} invite={invite} onRevoke={() => confirmRevoke.open(invite)} />
          ))}
        </ScreenScroll>
      )}

      <CreateSheet
        visible={createSheet.visible}
        onClose={createSheet.close}
        channelId={id}
        onCreated={row => { setFresh(row); createSheet.close(); void list.refresh() }}
      />

      <Sheet visible={qrSheet.visible} onClose={qrSheet.close} title="Invite QR" maxHeightRatio={0.8}>
        <View style={{ alignItems: 'center', padding: space.xxl, gap: space.md2 }}>
          {qrSheet.payload?.shareUrl ? (
            /* A QR needs a light quiet zone to scan in either scheme, so this
               one surface is a fixed ramp step rather than a theme role. */
            <View style={{ backgroundColor: ramp.slate[0], padding: space.lg, borderRadius: t.radius.md }}>
              <QRCode value={qrSheet.payload.shareUrl} size={220} />
            </View>
          ) : null}
          <Text variant="footnote" tone="muted" align="center">
            Anyone who scans this joins {rights.channel?.title}.
          </Text>
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmRevoke.visible}
        onClose={confirmRevoke.close}
        title="Revoke this link?"
        message="Anyone holding it will no longer be able to join."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => { const inv = confirmRevoke.payload; confirmRevoke.close(); void revoke(inv) }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   One link
   --------------------------------------------------------- */

function InviteCard({
  invite, highlighted, onCopy, onShare, onQr, onRevoke,
}: {
  invite: any
  highlighted?: boolean
  onCopy?: () => void
  onShare?: () => void
  onQr?: () => void
  onRevoke: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const state = invite.revoked ? { label: 'Revoked', tone: 'neutral' as const }
    : invite.expired ? { label: 'Expired', tone: 'warning' as const }
      : invite.exhausted ? { label: 'Limit reached', tone: 'warning' as const }
        : invite.requiresApproval ? { label: 'Needs approval', tone: 'accent' as const }
          : { label: 'Active', tone: 'success' as const }

  const meta = [
    `${invite.useCount} uses${invite.maxUses != null ? ` / ${invite.maxUses}` : ''}`,
    invite.permanent ? 'never expires' : invite.expiresAt ? `expires ${new Date(invite.expiresAt).toLocaleDateString()}` : null,
    invite.createdBy ? `by ${invite.createdBy}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderRadius: t.radius.md,
          borderColor: highlighted ? c.accent : c.borderFaint,
          borderWidth: highlighted ? 1.5 : StyleSheet.hairlineWidth,
          opacity: invite.revoked ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>
          {shortUrl(invite.shareUrl) || `…/join/${String(invite.id).slice(0, 6)}`}
        </Text>
        <Chip label={state.label} tone={state.tone} size="sm" />
      </View>

      <Text variant="caption" tone="faint" align="ui">{meta}</Text>

      {invite.maxUses != null ? (
        <View style={[styles.track, { backgroundColor: c.surfaceSunken }]}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: c.accent,
              width: `${Math.min(100, Math.round((invite.useCount / invite.maxUses) * 100))}%`,
            }}
          />
        </View>
      ) : null}

      {highlighted && invite.shareUrl ? (
        <View style={{ gap: space.xs }}>
          <Text variant="footnote" selectable align="ui">{invite.shareUrl}</Text>
          <Text variant="caption" tone="warning" weight="700" align="ui">
            Copy this now — the link is shown only once.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {onCopy ? <Button label="Copy" variant="ghost" size="sm" icon="copy" onPress={onCopy} /> : null}
        {onShare ? <Button label="Share" variant="ghost" size="sm" icon="share" onPress={onShare} /> : null}
        {onQr ? <Button label="QR" variant="ghost" size="sm" icon="qr" onPress={onQr} /> : null}
        {!onCopy ? (
          <Text variant="caption" tone="faint" align="ui" style={styles.flex}>
            The link itself is only shown once, when it is created.
          </Text>
        ) : <View style={styles.flex} />}
        {/* The create response carries no `id` (only the metadata list rows
            do), so a just-created link is revoked from its list row below —
            offering it here would DELETE …/invite-links/null. */}
        {!invite.revoked && invite.id ? <Button label="Revoke" variant="ghost" size="sm" onPress={onRevoke} /> : null}
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   Create
   --------------------------------------------------------- */

function CreateSheet({
  visible, onClose, channelId, onCreated,
}: { visible: boolean; onClose: () => void; channelId: string; onCreated: (row: any) => void }) {
  const t = useTheme()
  const [expiry, setExpiry] = React.useState('never')
  const [uses, setUses] = React.useState('any')
  const [customHours, setCustomHours] = React.useState('')
  const [customUses, setCustomUses] = React.useState('')
  const [approval, setApproval] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  React.useEffect(() => {
    if (!visible) { setExpiry('never'); setUses('any'); setCustomHours(''); setCustomUses(''); setApproval(false); setError(null) }
  }, [visible])

  const create = async () => {
    setBusy(true)
    setError(null)
    const hours = customHours ? Number(customHours) : EXPIRY_OPTIONS.find(o => o.value === expiry)?.hours
    const maxUses = customUses ? Number(customUses) : USES_OPTIONS.find(o => o.value === uses)?.max
    try {
      const row = await api.channels.invites.create(channelId, args({
        expiresInHours: hours,
        maxUses,
        requiresApproval: approval,
      }))
      onCreated(row)
    } catch (e: any) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New invite link"
      maxHeightRatio={0.72}
      footer={<Button label="Create link" onPress={create} loading={busy} size="lg" block />}
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.lg2 }}>
        {error ? <Text variant="footnote" tone="danger" align="ui">{errorText(error)}</Text> : null}

        <View style={{ gap: space.sm }}>
          <Text variant="subhead" tone="secondary" align="ui">Expires</Text>
          <SegmentedControl
            options={EXPIRY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            value={expiry}
            onChange={v => { setExpiry(v); setCustomHours('') }}
          />
          <Field
            value={customHours}
            onChangeText={setCustomHours}
            placeholder="Or a number of hours"
            keyboardType="number-pad"
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="subhead" tone="secondary" align="ui">Usage limit</Text>
          <SegmentedControl
            options={USES_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            value={uses}
            onChange={v => { setUses(v); setCustomUses('') }}
          />
          <Field
            value={customUses}
            onChangeText={setCustomUses}
            placeholder="Or a number of uses"
            keyboardType="number-pad"
          />
        </View>

        <RowGroup inset={0}>
          <ListRow
            title="Require approval"
            subtitle="Redeeming files a join request instead of joining"
            accessory={{ kind: 'switch', value: approval, onValueChange: setApproval }}
          />
        </RowGroup>
      </View>
    </Sheet>
  )
}

function shortUrl(url?: string | null): string {
  if (!url) return ''
  const tail = String(url).split('/').filter(Boolean).slice(-2).join('/')
  return `…/${tail}`
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
  flex: { flex: 1 },
})
