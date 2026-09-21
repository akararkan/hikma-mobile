/* =========================================================
   Why a call will not connect — the single honest explainer.

   Every locked media control in the calls/live domain links
   here. The point of one screen rather than a sentence per
   button is that the sentence would drift: four buttons, four
   half-truths, and a tester who cannot tell whether the build
   is broken or unfinished.

   The media engine is installed now, so the screen has a
   second job and keeps the first. A call can still fail for
   reasons the app cannot fix — no TURN server on a network
   that needs one, a permission the user denied — and those are
   invisible from the call room, which can only say "no media
   connection". This is where they are named.

   Nothing here makes a request. The capability facts are read
   synchronously from the runtime — whether RTCPeerConnection
   exists at all, what ICE servers were configured — and the
   diagnostics block is copyable so a bug report carries the
   build state instead of a description of it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { API_BASE } from '@/api'
import { CLIENT_BUILD, CLIENT_VERSION } from '@/lib/version.js'
import { iceServers } from '@/lib/liveWebrtc'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Button, Divider, Header, Icon, Screen, ScreenScroll, Text, Touchable, toast,
  type IconName,
} from '@/ui'
import { hasWebRTC } from '@/components/call/types'
import { bufferedSignalCount } from '@/components/call/callStore'

const WORKS = hasWebRTC ? [
  'Hearing and being heard',
  'Sending your camera, and flipping it',
  'Mute, camera off, earpiece and speaker',
  'Group calls — one connection per person',
  'Ring, accept, decline, hang up, missed calls',
  'Live streams, including sub-second (WHEP) playback',
] : [
  'Ring an entire conversation',
  'Accept, decline and hang up',
  'Missed-call notifications',
  'Group participant state',
  'Live chat, reactions, gifts and the stage',
  'Watching a live stream (standard latency)',
]

/* The engine being present moves the failure modes from "not built" to "not
   reachable", and the two lists are deliberately different in kind: one names
   features, the other names the network. */
const BLOCKED = [
  'Hearing and being heard',
  'Sending video',
  'Speaker and earpiece routing',
  'Going live from the phone camera',
  'Sub-second (WHEP) live playback',
  'Guest camera tiles on the multi-guest stage',
]

const FAILS = [
  'No TURN server — two phones on mobile data often cannot find a direct path to each other, and STUN alone will not fix it',
  'A denied microphone or camera: the dock locks and the call stays silent',
  'A network that blocks UDP outright, such as some corporate Wi-Fi',
  'Large groups — this is a mesh, so every extra person is another connection on every phone',
]

export default function MediaSupportScreen() {
  const t = useTheme()
  const router = useRouter()
  const [details, setDetails] = React.useState(false)

  const facts = React.useMemo(() => {
    /* The single most useful line in a "they cannot hear me" report: a STUN-only
       configuration is fine on one Wi-Fi and hopeless between two carriers. */
    const ice = hasWebRTC ? iceServers() : []
    const urls = ice.flatMap((s: any) => (Array.isArray(s?.urls) ? s.urls : [s?.urls])).map(String)
    const turn = urls.some(u => /^turns?:/i.test(u))
    return [
      ['Media package', hasWebRTC ? 'react-native-webrtc — installed' : 'react-native-webrtc — not installed'],
      ['ICE servers', hasWebRTC
        ? `${urls.length} configured · ${turn ? 'TURN present' : 'STUN only — no relay'}`
        : '—'],
      ['Live playback', hasWebRTC ? 'HLS via expo-video · WHEP available' : 'HLS via expo-video — active'],
      ['Live publish', hasWebRTC ? 'WHIP available · RTMP encoder' : 'RTMP (external encoder) — active'],
      ['Signalling relay', `active · ${bufferedSignalCount()} frame(s) buffered`],
      ['API base', String(API_BASE || '—')],
      ['App version', CLIENT_BUILD ? `${CLIENT_VERSION} (${CLIENT_BUILD})` : CLIENT_VERSION],
    ] as const
  }, [])

  const copy = async () => {
    await Clipboard.setStringAsync(facts.map(([k, v]) => `${k}: ${v}`).join('\n'))
    toast.ok('Diagnostics copied')
  }

  return (
    <Screen background="sunken">
      <Stack.Screen
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Header closeButton title={hasWebRTC ? 'Call audio and video' : 'About call audio'} border={false} />

      <ScreenScroll contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View
            style={[
              styles.heroGlyph,
              { backgroundColor: hasWebRTC ? t.colors.accentSoft : t.colors.warningSoft },
            ]}
          >
            <Icon
              name={hasWebRTC ? 'call' : 'micOff'}
              size={26}
              color={hasWebRTC ? t.colors.accentText : t.colors.warning}
            />
          </View>
          <Text variant="title2" align="ui" style={styles.heroTitle}>
            {hasWebRTC ? 'Calls carry audio and video' : 'Calls are signalling only on this build'}
          </Text>
          <Text variant="body" tone="muted" align="ui" style={styles.heroCopy}>
            {hasWebRTC
              ? 'The sound and picture travel directly between phones — the server only relays the handshake and never sees them. That is why a call can ring perfectly and still connect to nothing: the two phones have to find a path to each other.'
              : 'Ringing, answering, declining and hanging up all work. The audio and video themselves travel directly between phones and need a native media engine that isn’t in this build yet.'}
          </Text>
        </View>

        <FactList title="Works now" icon="checkCircle" tone={t.colors.success} rows={WORKS} />
        {hasWebRTC ? (
          <FactList title="Why a call might not connect" icon="warning" tone={t.colors.warning} rows={FAILS} />
        ) : (
          <FactList title="Needs the media engine" icon="lock" tone={t.colors.textFaint} rows={BLOCKED} />
        )}

        <Touchable
          onPress={() => setDetails(d => !d)}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel={details ? 'Hide technical details' : 'Show technical details'}
          style={styles.disclosure}
        >
          <Text variant="subhead" tone="accent" align="ui" style={styles.flex}>Details</Text>
          <Icon name={details ? 'up' : 'down'} size={14} color={t.colors.accentText} />
        </Touchable>

        {details ? (
          <View style={[styles.factCard, { backgroundColor: t.colors.surface }]}>
            {facts.map(([k, v], i) => (
              <View key={k}>
                {i ? <Divider /> : null}
                <View style={styles.factRow}>
                  <Text variant="footnote" tone="muted" align="ui" style={styles.factKey}>{k}</Text>
                  <Text variant="footnote" align="ui" style={styles.flex} selectable>{v}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button label="Copy diagnostics" onPress={copy} variant="secondary" size="md" block icon="copy" />
          <Button label="Close" onPress={() => router.back()} variant="primary" size="md" block />
        </View>
      </ScreenScroll>
    </Screen>
  )
}

function FactList({
  title, icon, tone, rows,
}: { title: string; icon: IconName; tone: string; rows: string[] }) {
  return (
    <View style={styles.list}>
      <Text variant="headline" align="ui" style={styles.listTitle}>{title}</Text>
      {rows.map(r => (
        <View key={r} style={styles.listRow}>
          <Icon name={icon} size={18} color={tone} />
          <Text variant="callout" align="ui" style={styles.flex}>{r}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },
  hero: { paddingTop: space.xs, paddingBottom: space.md },
  /* Icon-only round button — sanctioned circle, not a pill (DESIGN.md §3). */
  heroGlyph: { width: 56, height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { marginTop: space.lg },
  heroCopy: { marginTop: space.sm },
  list: { paddingTop: 22, gap: space.md },
  listTitle: { marginBottom: space.xxs },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2 },
  disclosure: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.lg2 },
  factCard: { paddingHorizontal: space.md, ...setback(shape.card), borderCurve: 'continuous' },
  factRow: { flexDirection: 'row', gap: space.sm2, paddingVertical: space.sm2 },
  factKey: { width: 120 },
  footer: { gap: space.sm2, paddingTop: 26 },
  flex: { flex: 1 },
})
