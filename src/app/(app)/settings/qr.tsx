/* =========================================================
   Your QR code.

   The code encodes the WEB link, deliberately. Whoever scans
   it is usually a stranger who does not have Hikmah Web installed,
   and a bare `ikamobileapp://` code is inert on their phone —
   they get "cannot open" and no idea why. `qrWebLink` returns
   null when no web origin is configured, and in that case this
   screen says so instead of drawing a code that scans to
   nothing.

   The token is rotatable and the old one dies immediately, so
   the rotate action is a real safety valve — it belongs here,
   next to the thing it invalidates.

   The code plate stays pure white in both schemes — scanners
   need the quiet zone, and any tint would cost contrast. It is
   the same sanctioned exception as the media letterbox, set off
   from the ground by a drawn 1px stone rule.
   ========================================================= */
import React from 'react'
import { Share, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import { api, errorText } from '@/api'
import { qrAppLink, qrWebLink } from '@/lib/qrToken.js'
import { useAuth } from '@/context/AuthContext'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, ErrorState, Header, Screen, ScreenScroll,
  Skeleton, Text, useSheetState, toast,
} from '@/ui'

export default function QrScreen() {
  const t = useTheme()
  const c = t.colors
  const { user } = useAuth()
  const rotateSheet = useSheetState()

  const qr = useAsync<any>(() => api.settings.discovery.qr(), { deps: [] })

  const rotate = useAction(async () => {
    await api.settings.discovery.rotateQr()
    await qr.reload()
    toast.ok('Replaced — the old code no longer works')
  }, { onError: e => toast.error(errorText(e, 'Could not replace your code.')) })

  const token = qr.data?.opaqueToken
  const web = token ? qrWebLink(token) : null
  const app = token ? qrAppLink(token) : null
  const link = web || app

  return (
    <Screen background="sunken">
      <Header back closeButton title="Your code" />
      <ScreenScroll contentContainerStyle={{ padding: space.xl, alignItems: 'center' }}>
        {qr.loading ? (
          <View style={{ alignItems: 'center', gap: space.lg, paddingTop: space.xxl }}>
            <Skeleton width={240} height={240} radius={t.radius.xl} />
            <Skeleton width={160} height={14} />
          </View>
        ) : qr.error ? (
          <ErrorState error={qr.error} onRetry={qr.reload} />
        ) : (
          <>
            <View
              style={{
                backgroundColor: c.qrPlate,
                padding: 22,
                ...setback(t.shape.card),
                borderCurve: 'continuous',
                borderWidth: t.rule.course,
                borderColor: c.border,
                alignItems: 'center',
                marginTop: space.md,
              }}
            >
              {web ? (
                <QRCode
                  value={web}
                  size={228}
                  color={c.qrInk}
                  backgroundColor={c.qrPlate}
                  ecl="M"
                />
              ) : (
                <View style={{ width: 228, height: 228, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="callout" align="center" tone="muted">
                    No shareable code yet
                  </Text>
                </View>
              )}
            </View>

            <View style={{ alignItems: 'center', marginTop: -26 }}>
              <View style={{ borderWidth: 4, borderColor: c.bgSunken, borderRadius: 999 }}>
                <Avatar uri={user?.profileImage} name={user?.displayName || user?.full} seed={user?.id} size={54} />
              </View>
            </View>

            <Text variant="title3" align="center" style={{ marginTop: space.md }}>
              {user?.displayName || user?.handle}
            </Text>
            <Text variant="footnote" tone="muted" align="center">
              @{user?.handle || user?.handle}
            </Text>

            {!web ? (
              <Callout tone="warning" style={{ marginTop: 22 }} title="No web address configured">
                A QR code that only works inside Hikmah Web is useless to someone who
                doesn't have it installed, so none is shown. Set
                EXPO_PUBLIC_WEB_ORIGIN to enable this.
              </Callout>
            ) : (
              <Text variant="footnote" tone="muted" align="center" style={{ marginTop: 20, maxWidth: 300 }}>
                Anyone can scan this to open your profile — they don't need the app.
              </Text>
            )}

            {link ? (
              <View style={{ gap: space.sm2, alignSelf: 'stretch', marginTop: space.xxl }}>
                <Button
                  label="Share"
                  icon="share"
                  variant="primary"
                  size="lg"
                  block
                  onPress={() => { void Share.share({ message: link }) }}
                />
                <Button
                  label="Copy link"
                  icon="copy"
                  variant="secondary"
                  size="lg"
                  block
                  onPress={async () => { await Clipboard.setStringAsync(link); toast.ok('Link copied') }}
                />
                <Button
                  label="Replace this code"
                  icon="refresh"
                  variant="ghost"
                  size="md"
                  block
                  onPress={rotateSheet.open}
                />
              </View>
            ) : null}

            {qr.data?.rotatedAt ? (
              <Text variant="caption" tone="faint" align="center" style={{ marginTop: space.md2 }}>
                Last replaced {new Date(qr.data.rotatedAt).toLocaleDateString()}
              </Text>
            ) : null}
          </>
        )}
      </ScreenScroll>

      <ConfirmSheet
        visible={rotateSheet.visible}
        onClose={rotateSheet.close}
        title="Replace your code?"
        message="Anyone holding the old code or link will no longer be able to reach you with it. This cannot be undone."
        confirmLabel="Replace"
        destructive
        loading={rotate.pending}
        icon="refresh"
        onConfirm={async () => { await rotate.run(); rotateSheet.close() }}
      />
    </Screen>
  )
}
