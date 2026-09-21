/* =========================================================
   Scan a code.

   `extractQrToken` accepts every shape a code can arrive in —
   a web link, a deep link, or the bare opaque token — so the
   scanner never has to guess which client produced it. That
   matters more than it sounds: the web app, this app and a
   printed card all encode the same identity differently.

   The camera is stopped the instant a code resolves. A scanner
   that keeps firing while a sheet animates in resolves the
   same token four times and pushes four profiles.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { extractQrToken } from '@/lib/qrToken.js'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, EmptyState, Header, Screen, Sheet, Text, fireHaptic, toast,
} from '@/ui'

export default function ScanScreen() {
  const t = useTheme()
  const router = useRouter()
  const [permission, requestPermission] = useCameraPermissions()

  const [scanning, setScanning] = React.useState(true)
  const [resolving, setResolving] = React.useState(false)
  const [found, setFound] = React.useState<any>(null)
  const busy = React.useRef(false)

  const onScan = React.useCallback(async ({ data }: { data: string }) => {
    /* A ref, not the state: the camera fires several frames before a state
       update lands, and each one would resolve the same token again. */
    if (busy.current) return
    const token = extractQrToken(data)
    if (!token) return

    busy.current = true
    setScanning(false)
    setResolving(true)
    fireHaptic('success')
    try {
      const user = await api.settings.discovery.resolveQr(token)
      if (!user) {
        toast.warn('That code doesn’t point to anyone.')
        resume()
        return
      }
      setFound(user)
    } catch (e) {
      /* 404 is the deliberate answer for BOTH an unknown token and a user with
         byQr off (identical on purpose, so the setting can't be probed) — a
         quiet miss, not an error. */
      if (isNotFound(e)) toast.warn('That code doesn’t point to anyone.')
      else toast.error(errorText(e, 'That code could not be read.'))
      resume()
    } finally {
      setResolving(false)
    }
  }, [])

  const resume = () => {
    busy.current = false
    setFound(null)
    setScanning(true)
  }

  if (!permission) {
    return <Screen><Header back closeButton title="Scan" /></Screen>
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Header back closeButton title="Scan" />
        <EmptyState
          icon="camera"
          title="Camera access needed"
          message="Hikmah Web needs your camera to read a QR code. Nothing is recorded or uploaded."
          actionLabel={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          onAction={() => { void requestPermission() }}
        />
      </Screen>
    )
  }

  return (
    <Screen background="transparent">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanning ? onScan : undefined}
      />

      {/* A dimmed frame with a clear window, so the user knows where to aim. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.dim, { flex: 1 }]} />
        <View style={{ flexDirection: 'row', height: 260 }}>
          <View style={[styles.dim, { flex: 1 }]} />
          <View style={styles.window}>
            <Corner style={{ top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 }} />
            <Corner style={{ top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 }} />
            <Corner style={{ bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 }} />
            <Corner style={{ bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 }} />
          </View>
          <View style={[styles.dim, { flex: 1 }]} />
        </View>
        <View style={[styles.dim, { flex: 1, alignItems: 'center', paddingTop: 26 }]}>
          <Text variant="callout" color="#FFFFFF" align="center">
            {resolving ? 'Looking them up…' : 'Point the camera at a Hikmah Web code'}
          </Text>
        </View>
      </View>

      <Header back closeButton title="" overlay border={false} floating />

      <Sheet visible={!!found} onClose={resume} bare scrollable={false} maxHeightRatio={0.55}>
        <View style={{ padding: 26, alignItems: 'center', gap: space.xs2 }}>
          <Avatar uri={found?.avatarUrl} name={found?.displayName} seed={found?.id} size="xl" />
          <Text variant="title2" align="center" style={{ marginTop: space.md }}>
            {found?.displayName || found?.username}
          </Text>
          <Text variant="callout" tone="muted" align="center">@{found?.handle || found?.username}</Text>
          {found?.bio ? (
            <Text variant="footnote" tone="muted" align="center" numberOfLines={3} style={{ marginTop: space.xs2 }}>
              {found.bio}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm2, alignSelf: 'stretch', marginTop: 22 }}>
            <Button label="Scan another" onPress={resume} variant="secondary" size="lg" style={{ flex: 1 }} />
            <Button
              label="View profile"
              onPress={() => { const id = found?.id; setFound(null); router.replace(`/user/${id}`) }}
              variant="primary"
              size="lg"
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}

function Corner({ style }: { style: any }) {
  return <View style={[styles.corner, style]} />
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.62)' },
  window: { width: 260, height: 260 },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#FFFFFF',
    borderRadius: 6,
  },
})
