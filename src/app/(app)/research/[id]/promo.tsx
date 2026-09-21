/* =========================================================
   Promo video.

   No recordView here: the view is recorded per PAPER, not per
   asset, and the detail screen already did it.

   videoPromoDuration is legitimately null on some containers,
   so the duration is read off the player once it loads and
   nothing is drawn until then — a placeholder "0:00" is a
   claim, and a wrong one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEvent } from 'expo'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { withAlpha } from '@/theme/colors'
import { Avatar, Button, Icon, IconButton, Screen, Spinner, Text, Touchable } from '@/ui'
import { ErrorPanel } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { formatDuration } from '@/components/research/format'
import { to } from '@/components/research/nav'

export default function PromoScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, error, loading, reload } = useResearchDetail(id, { subscribe: false, recordView: false })

  const [chrome, setChrome] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const source = detail?.videoPromoUrl ? { uri: detail.videoPromoUrl } : null
  const player = useVideoPlayer(source, p => { p.loop = false; p.play() })
  const { status } = useEvent(player, 'statusChange', { status: player.status })
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing })

  /* A paper with no promo must not flash an empty player. */
  React.useEffect(() => {
    if (!loading && detail && !detail.videoPromoUrl) router.back()
  }, [loading, detail, router])

  /* Pause on blur — navigating away or backgrounding the app should not leave
     audio playing behind another screen. */
  useFocusEffect(React.useCallback(() => {
    player.play()
    return () => player.pause()
  }, [player]))

  const touchChrome = () => {
    setChrome(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), 3000)
  }
  React.useEffect(() => {
    touchChrome()
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <Screen>
        <ErrorPanel error={error} onRetry={reload} />
      </Screen>
    )
  }

  const duration = player.duration || detail?.videoPromoDuration || 0

  return (
    <View style={[styles.fill, { backgroundColor: c.overlayBg }]}>
      <Touchable onPress={touchChrome} feedback="none" noAutoHitSlop style={styles.fill}>
        <View style={styles.fill}>
          {detail?.videoPromoThumb && status !== 'readyToPlay' ? (
            <Image source={{ uri: detail.videoPromoThumb }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : null}
          {source ? (
            <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls={false} />
          ) : null}
          {status === 'loading' ? (
            <View style={styles.center}><Spinner size="large" /></View>
          ) : null}
          {status === 'error' || failed ? (
            <View style={styles.center}>
              <Icon name="error" size={30} color={c.overlayText} />
              <Text variant="callout" color={c.overlayText} align="center" style={{ marginTop: space.sm2 }}>
                This video could not be played
              </Text>
              <View style={styles.errorButtons}>
                <Button label="Retry" variant="tinted" onPress={() => { setFailed(false); player.replay() }} />
                <Button
                  label="Read the paper instead"
                  variant="secondary"
                  onPress={() => router.replace(to(`/research/${id}/read`))}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Touchable>

      {chrome ? (
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <IconButton name="back" onPress={() => router.back()} accessibilityLabel="Close" color={c.overlayText} size={24} />
          <Text variant="subhead" color={c.overlayText} align="center" numberOfLines={2} style={styles.flex}>
            {detail?.title || ''}
          </Text>
          <View style={{ width: 40 }} />
        </View>
      ) : null}

      {chrome ? (
        <View style={styles.controls} pointerEvents="box-none">
          <Touchable
            onPress={() => (isPlaying ? player.pause() : player.play())}
            feedback="scale"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            style={styles.transport}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={22} color={c.overlayText} filled />
          </Touchable>
          <View style={styles.timeline}>
            <View style={[styles.track, { backgroundColor: withAlpha(c.overlayText, 0.25) }]}>
              <View
                style={{
                  width: duration ? `${Math.min(100, (player.currentTime / duration) * 100)}%` : '0%',
                  height: 3,
                  backgroundColor: c.accent,
                }}
              />
            </View>
            {duration ? (
              <View style={styles.timeRow}>
                <Text variant="caption" color={c.overlayTextMuted}>{formatDuration(player.currentTime)}</Text>
                <Text variant="caption" color={c.overlayTextMuted}>-{formatDuration(duration - player.currentTime)}</Text>
              </View>
            ) : null}
          </View>
          <Touchable
            onPress={() => { player.muted = !player.muted }}
            feedback="scale"
            accessibilityLabel="Mute"
            style={styles.transport}
          >
            <Icon name={player.muted ? 'mute' : 'volume'} size={20} color={c.overlayText} />
          </Touchable>
        </View>
      ) : null}

      {!isPlaying && detail ? (
        <View style={[styles.card, { backgroundColor: c.bgElevated, paddingBottom: Math.max(insets.bottom, 14) + 20 }]}>
          <View style={styles.cardHead}>
            <Avatar uri={detail._author.profileImage} name={detail._author.full} seed={detail._author.id} size={44} />
            <View style={styles.flex}>
              <Text variant="title3" serif align="auto" numberOfLines={2}>{detail.title}</Text>
              <Text variant="caption" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xxs }}>
                {detail._author.full}
              </Text>
            </View>
          </View>
          <Button
            label="Read paper"
            block
            size="lg"
            onPress={() => router.replace(to(`/research/${id}/read`))}
            style={{ marginTop: space.md2 }}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  controls: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  transport: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  timeline: { flex: 1, gap: space.xs2 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  card: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: space.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  cardHead: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  errorButtons: { flexDirection: 'row', gap: space.sm2, marginTop: space.lg },
  flex: { flex: 1 },
})
