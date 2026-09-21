/* =========================================================
   Invite link.

   The token is shown ONCE — only a SHA-256 of it is stored, so
   there is no endpoint that can hand it back — and minting a
   new one revokes the old. That makes the empty state the
   normal state on every entry, which is unusual enough that the
   card says so instead of looking broken.

   The QR is the point of this screen more often than the link
   is: two people in the same room scan, they do not paste. It
   encodes the same `shareUrl` the buttons carry, so there is
   one secret on the screen and three ways to move it.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, GroupLabel, Header, Icon, RowGroup, Screen,
  ScreenScroll, SegmentedControl, Text, Touchable, fireHaptic, toast, useSheetState,
} from '@/ui'

type Expiry = 'never' | '1h' | '1d' | '1w'
type Uses = 'unlimited' | '1' | '10' | '50' | '100'

const EXPIRY: { value: Expiry; label: string; hours?: number }[] = [
  { value: 'never', label: 'Never' },
  { value: '1h', label: '1 hour', hours: 1 },
  { value: '1d', label: '1 day', hours: 24 },
  { value: '1w', label: '1 week', hours: 24 * 7 },
]

const USES: { value: Uses; label: string; max?: number }[] = [
  { value: 'unlimited', label: 'Unlimited' },
  { value: '1', label: '1', max: 1 },
  { value: '10', label: '10', max: 10 },
  { value: '50', label: '50', max: 50 },
  { value: '100', label: '100', max: 100 },
]

export default function InviteScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const [expiry, setExpiry] = React.useState<Expiry>('never')
  const [uses, setUses] = React.useState<Uses>('unlimited')
  const [link, setLink] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)
  const [denied, setDenied] = React.useState<string | null>(null)

  const confirmRotate = useSheetState()
  const confirmRevoke = useSheetState()

  const mint = async () => {
    setBusy(true)
    try {
      const res: any = await api.chat.members.createInvite(convId, {
        expiresInHours: EXPIRY.find(e => e.value === expiry)?.hours,
        maxUses: USES.find(u => u.value === uses)?.max,
      })
      setLink(res)
      fireHaptic('success')
    } catch (e: any) {
      if (codeOf(e) === 'ADMINS_ONLY') setDenied(errorText(e, 'You cannot manage invite links here.'))
      else toast.error(chatError(e, 'Could not create an invite link'))
    } finally { setBusy(false) }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      await api.chat.members.revokeInvite(convId)
      setLink(null)
      toast.ok('Invite link revoked')
    } catch (e) {
      toast.error(chatError(e, 'Could not revoke the invite link'))
    } finally { setBusy(false) }
  }

  const shareUrl: string = link?.shareUrl || (link?.token ? `join/${link.token}` : '')

  return (
    <Screen background="sunken">
      <Header back title="Invite link" />
      <ScreenScroll>
        {denied ? <View style={styles.pad}><Callout tone="danger">{denied}</Callout></View> : null}

        {link ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint }]}>
            {/* Always on white, never on the theme surface: a QR read fails on
                a dark background, and a code that cannot be scanned is worse
                than no code at all. */}
            <View style={[styles.qrWrap, { backgroundColor: c.qrPlate }]}>
              <QRCode value={shareUrl} size={188} color={c.qrInk} backgroundColor={c.qrPlate} ecl="M" />
            </View>
            <Text variant="caption" tone="muted" align="center" style={{ marginBottom: space.md }}>
              Have them scan this from Settings → Scan a code
            </Text>
            <View style={[styles.linkBox, { backgroundColor: c.surfaceSunken }]}>
              <Text variant="footnote" align="center" selectable style={styles.mono}>{shareUrl}</Text>
            </View>
            <View style={styles.actions}>
              <Button
                label="Copy"
                icon="copy"
                variant="tinted"
                onPress={async () => {
                  await Clipboard.setStringAsync(shareUrl)
                  fireHaptic('success')
                  toast.ok('Link copied')
                }}
                style={styles.flex}
              />
              <Button
                label="Message"
                icon="chat"
                variant="tinted"
                /* Into the chat share sheet — the recipient's bubble unfurls
                   an invitation card that opens the /join screen. Only when
                   the link is URL-shaped: a token-only fallback would paste
                   as dead text. */
                disabled={!/^https?:\/\//.test(shareUrl)}
                onPress={() => router.push({
                  pathname: '/chat/share',
                  params: { url: shareUrl, kind: 'invite', label: 'Group invitation' },
                })}
                style={styles.flex}
              />
              <Button
                label="Share"
                icon="share"
                variant="tinted"
                onPress={() => { void Share.share({ message: shareUrl }) }}
                style={styles.flex}
              />
            </View>
            <Text variant="caption" tone="muted" align="center">
              {link.maxUses ? `${link.useCount ?? 0}/${link.maxUses} uses` : 'Unlimited uses'}
              {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleString()}` : ' · never expires'}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, styles.placeholder, { borderColor: c.borderStrong }]}>
            <Icon name="link" size={28} color={c.textFaint} />
            <Text variant="callout" tone="muted" align="center">No link in this session</Text>
            <Button
              label="Create invite link"
              onPress={mint}
              loading={busy}
              disabled={busy || !!denied}
              size="lg"
              style={{ marginTop: space.xs2 }}
            />
          </View>
        )}

        {!link ? (
          <>
            <GroupLabel>Expires after</GroupLabel>
            <View style={styles.pad}>
              <SegmentedControl options={EXPIRY.map(e => ({ value: e.value, label: e.label }))} value={expiry} onChange={setExpiry} />
            </View>

            <GroupLabel>Maximum uses</GroupLabel>
            <View style={styles.pad}>
              <SegmentedControl
                options={USES.map(u => ({ value: u.value, label: u.label }))}
                value={uses}
                onChange={setUses}
                scrollable
              />
            </View>
          </>
        ) : null}

        <View style={styles.pad}>
          <Callout tone="warning" icon="key">
            The link is shown once. It cannot be recovered later — copy or share it now.
            Creating a new link revokes the previous one.
          </Callout>
        </View>

        {!denied ? (
          <RowGroup>
            {link ? (
              <Touchable onPress={confirmRotate.open} feedback="tint" noAutoHitSlop style={styles.destructive}>
                <Icon name="refresh" size={18} color={c.text} />
                <Text variant="body" align="ui">Create a new link</Text>
              </Touchable>
            ) : null}
            <Touchable onPress={confirmRevoke.open} feedback="tint" noAutoHitSlop style={styles.destructive}>
              <Icon name="trash" size={18} color={c.danger} />
              <Text variant="body" tone="danger" align="ui">Revoke link</Text>
            </Touchable>
          </RowGroup>
        ) : null}
      </ScreenScroll>

      <ConfirmSheet
        visible={confirmRotate.visible}
        onClose={confirmRotate.close}
        title="Create a new link?"
        message="The current link will stop working."
        confirmLabel="Create"
        onConfirm={() => { confirmRotate.close(); void mint() }}
      />

      <ConfirmSheet
        visible={confirmRevoke.visible}
        onClose={confirmRevoke.close}
        title="Revoke this invite link?"
        message="Anyone holding it will no longer be able to join."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => { confirmRevoke.close(); void revoke() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  card: {
    margin: space.lg, padding: space.lg, gap: space.md,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'stretch',
    ...setback(shape.card), borderCurve: 'continuous',
  },
  placeholder: { alignItems: 'center', borderStyle: 'dashed', borderWidth: 1.5, gap: space.sm, paddingVertical: 28 },
  qrWrap: {
    alignSelf: 'center',
    padding: space.lg,
    borderRadius: 20,
    marginBottom: space.md,
  },
  /* A text-bearing well — field setback, flat at the baseline. */
  linkBox: { padding: space.md2, ...setback(shape.field), borderCurve: 'continuous' },
  mono: { letterSpacing: 0.4 },
  actions: { flexDirection: 'row', gap: space.sm2 },
  flex: { flex: 1 },
  destructive: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 52 },
})
