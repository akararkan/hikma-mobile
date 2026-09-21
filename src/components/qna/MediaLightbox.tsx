/* =========================================================
   Full-screen viewer for an answer's image or video, plus the
   one place this domain opens an external document.

   Deliberately not a pan/zoom implementation: the app already
   owns horizontal gestures in the story viewer and the reel
   pager, and a third gesture responder here would have to be
   reconciled with both. Tap-anywhere to dismiss is the
   behaviour a reader of a citation actually wants.
   ========================================================= */
import React from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { RemoteImage } from '@/components/media/RemoteImage'
import { useVideoPlayer, VideoView } from 'expo-video'
import * as WebBrowser from 'expo-web-browser'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { IconButton, Text, Touchable, toast } from '@/ui'

export interface LightboxItem {
  url: string
  kind: 'IMAGE' | 'VIDEO'
  caption?: string | null
}

export function MediaLightbox({ item, onClose }: { item: LightboxItem | null; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  if (!item) return null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.fill, { backgroundColor: t.colors.overlayBg }]}>
        <Touchable onPress={onClose} feedback="none" noAutoHitSlop style={styles.fill} accessibilityLabel="Close">
          <View style={styles.center}>
            {item.kind === 'VIDEO'
              /* Keyed: an item swap without a null pass-through would release
                 the player under the mounted view otherwise. */
              ? <LightboxVideo key={item.url} url={item.url} />
              : (
                /* A dead URL (moderation deleted the asset) must not leave an
                   empty overlay with only a close button. */
                <RemoteImage
                  source={item.url}
                  fallback="overlay"
                  fallbackIcon="image"
                  fallbackIconSize={32}
                  fallbackLabel="Image unavailable"
                  style={styles.media}
                  contentFit="contain"
                  transition={160}
                  cachePolicy="memory-disk"
                />
              )}
          </View>
        </Touchable>

        <View style={[styles.close, { top: insets.top + 8 }]}>
          <IconButton name="close" onPress={onClose} size={22} surface="overlay" color={t.colors.overlayText} accessibilityLabel="Close" />
        </View>

        {item.caption ? (
          <View style={[styles.caption, { bottom: insets.bottom + 20 }]}>
            <Text variant="footnote" color={t.colors.overlayText} align="center">{item.caption}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function LightboxVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, p => { p.loop = false; p.play() })
  return <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />
}

/** Documents, link chips and URL sources. Never a WebView we own — the system
 *  browser carries the user's own reader settings and their cookie jar. */
export async function openExternal(url: string) {
  if (!url) return
  try {
    await WebBrowser.openBrowserAsync(url)
  } catch (e: any) {
    toast.error(errorText(e))
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '78%' },
  close: { position: 'absolute', end: 8 },
  caption: { position: 'absolute', left: 24, right: 24 },
})
