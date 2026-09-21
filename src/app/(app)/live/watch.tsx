/* =========================================================
   /live/watch — the vertical live pager (TikTok grammar).

   One census (`GET /streams/live`, most-watched-first, no
   paging params — it returns the platform's whole live list),
   one full room mounted at a time. The discipline copied from
   ReelPager: the index SETTLES (round at momentum end), and
   nothing expensive keys off a mid-gesture value.

   Costs this shape was designed around (live-streaming.md +
   liveWebrtc.ts):
   · a WHEP attach is an ICE gather (≤1.5s) + a blocking SDP
     POST, and MediaMTX 404s until the publisher's first packet
     — so NEIGHBOURS get posters, never players;
   · every room mount joins and every unmount leaves, and RN's
     fetch ignores keepalive — so the room mounts only after
     the index has SETTLED ~350ms, or a fast flick-through
     inflates viewer counts on every stream passed;
   · a viewer's screen must not sleep (the room holds its own
     keep-awake; the pager holds one for the poster gaps).

   A `start` id that is not in the census (private/direct link)
   falls back to the classic /live/[id] room.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useKeepAwake } from 'expo-keep-awake'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import Animated, { FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, errorText } from '@/api'
import { useChatEvents } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, NumericText, Spinner, Text, Touchable, formatCount, toast } from '@/ui'
import { WatchLiveRoom } from './[id]/index'
import { LivePill } from '@/components/live/LiveCard'
import { applyStreamEvent } from '@/lib/liveRows'
import { FILL, ROOM } from '@/components/live/skin'
import type { LiveStream } from '@/components/live/types'

const foldRows = applyStreamEvent as (
  rows: LiveStream[],
  evt: any,
  opts?: { skipHostId?: string | null },
) => LiveStream[]

/* The join debounce — long enough that a flick-through never joins, short
   enough that a deliberate swipe feels immediate. */
const SETTLE_MS = 350

const keyExtractor = (s: LiveStream) => String(s.id)

export default function LiveWatchPagerScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { start } = useLocalSearchParams<{ start?: string }>()
  const startId = start ? String(start) : ''

  useKeepAwake()

  const [rows, setRows] = React.useState<LiveStream[] | null>(null)
  const [index, setIndex] = React.useState(0)
  /* The id whose room is MOUNTED — trails the settled index by SETTLE_MS. */
  const [armedId, setArmedId] = React.useState<string | null>(null)
  const armTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  /* One census read; stream.* frames keep it honest (ended streams drop,
     viewer counts drift only as far as the contract says they may). */
  React.useEffect(() => {
    let alive = true
    api.chat.streams.live()
      .then((list: any) => {
        if (!alive) return
        const all: LiveStream[] = list || []
        const at = all.findIndex(s => String(s.id) === startId)
        if (at < 0) {
          /* Not in the census — a direct/private link. The classic room
             handles it; the pager has nothing to page over. */
          router.replace(`/live/${startId}`)
          return
        }
        setRows(all)
        setIndex(at)
        setArmedId(startId)
      })
      .catch((e: any) => {
        if (!alive) return
        toast.error(errorText(e))
        router.replace(`/live/${startId}`)
      })
    return () => { alive = false }
  }, [startId, router])

  useChatEvents(evt => {
    if (!String(evt?.type || '').startsWith('stream.')) return
    setRows(prev => (prev ? foldRows(prev, evt) : prev))
  })

  const settle = React.useCallback((next: number) => {
    setIndex(next)
    if (armTimer.current) clearTimeout(armTimer.current)
    armTimer.current = setTimeout(() => {
      armTimer.current = null
      setRows(prev => {
        const row = prev?.[next]
        if (row) setArmedId(String(row.id))
        return prev
      })
    }, SETTLE_MS)
  }, [])
  React.useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current) }, [])

  const renderItem = React.useCallback(({ item, index: i }: { item: LiveStream; index: number }) => (
    <View style={{ height }}>
      {String(item.id) === armedId ? (
        <WatchLiveRoom streamId={String(item.id)} active={i === index} />
      ) : (
        <PagerPoster stream={item} />
      )}
    </View>
  ), [height, armedId, index])

  if (!rows) {
    return (
      <View style={[styles.root, { backgroundColor: ROOM.bg }]}>
        <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false }} />
        <StatusBar style="light" />
        <View style={styles.center}><Spinner color={ROOM.fg} size="large" /></View>
        <Touchable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/live'))}
          feedback="scale"
          accessibilityLabel="Close"
          style={[styles.close, { top: insets.top + 8, backgroundColor: ROOM.fillStrong }]}
        >
          <Icon name="close" size={22} color={ROOM.fg} />
        </Touchable>
      </View>
    )
  }

  return (
    <View style={[styles.root, { backgroundColor: ROOM.bg }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false }} />
      <StatusBar style="light" />
      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={`${armedId}:${index}`}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={index}
        /* Settled-only, the ReelPager rule: nothing derived from the index
           may move mid-gesture. */
        onMomentumScrollEnd={e => {
          const next = Math.max(0, Math.min((rows?.length ?? 1) - 1, Math.round(e.nativeEvent.contentOffset.y / Math.max(1, height))))
          if (next !== index) settle(next)
        }}
      />
      {rows.length > 1 && index === 0 && t.a11y.screenReader !== true ? (
        /* One quiet hint on the first page only; it exits with the first
           swipe (the row under it changes). Reduced motion keeps it static. */
        <Animated.View exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(t.motion.fast))} pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 90 }]}>
          <Text variant="caption" color={ROOM.fgMuted} align="center">Swipe up for the next stream</Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

/* The neighbour card: census data only — no join, no socket, no player.
   Identity, LIVE pill, title, the approximate viewer count the contract
   allows a rail to show. */
const PagerPoster = React.memo(function PagerPoster({ stream }: { stream: LiveStream }) {
  const name = stream.hostDisplayName || `@${stream.hostHandle}`
  return (
    <View style={[FILL, styles.poster, { backgroundColor: ROOM.pane }]}>
      <Avatar uri={stream.hostAvatarUrl} name={name} seed={stream.hostId || stream.id} size={96} ring="live" />
      <View style={styles.posterMeta}>
        <LivePill />
        <Text variant="title3" color={ROOM.fg} align="center" numberOfLines={1}>{name}</Text>
      </View>
      {stream.title ? (
        <Text variant="callout" color={ROOM.fgMuted} align="center" numberOfLines={2} style={styles.posterTitle}>
          {stream.title}
        </Text>
      ) : null}
      <View style={styles.posterViewers}>
        <Icon name="eye" size={13} color={ROOM.fgFaint} />
        <NumericText variant="footnote" color={ROOM.fgFaint}>{formatCount(stream.viewerCount)}</NumericText>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute', end: 12, width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { position: 'absolute', left: 0, right: 0 },
  poster: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xxxl },
  posterMeta: { alignItems: 'center', gap: space.sm },
  posterTitle: { maxWidth: 300 },
  posterViewers: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
})
