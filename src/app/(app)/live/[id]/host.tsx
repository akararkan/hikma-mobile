/* =========================================================
   Host console.

   Two ways to publish, and the pane shows whichever is real.

   · This phone's camera — a WHIP publish through
     `publishCamera`. The preview is the LOCAL capture, so it
     is instant and it is the truth: what is on this pane is
     what the encoder is being fed.
   · An external encoder — OBS/Larix pushing RTMP. Then the
     pane opens on a WAITING panel, not an error, because the
     stream IS live and the ingest URL IS valid; the picture
     appears the moment the encoder starts. That path also
     gets a self-monitor: the same stream the viewers get,
     always muted (an unmuted self-monitor feeds straight back
     into the microphone the encoder is capturing).

   `hasWebRTC` still gates the camera path. A build stripped of
   the media engine falls back to the encoder-only console it
   has always been, rather than offering a button that lies.

   Publish health is surfaced, never swallowed: 'stalled' means
   the picture froze and the camera is being reopened, 'lost'
   means the host has to act. Silence there is how a host finds
   out afterwards that half the recording is a still frame.
   ========================================================= */
import React from 'react'
import { Linking, Share, StyleSheet, View, useWindowDimensions } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import * as Clipboard from 'expo-clipboard'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated'
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { RTCView } from 'react-native-webrtc'
import type { VideoPlayerStatus } from 'expo-video'
import { api, codeOf, errorText } from '@/api'
import { isBlocked, moderationText } from '@/lib/moderation'
import { hasWebRTC, type LiveHealth } from '@/lib/liveWebrtc'
import { useCooldown } from '@/hooks/useCooldown'
import { useDockInset } from '@/hooks/useDockInset'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { announce } from '@/theme/announce'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, Field, Icon, NumericText, Sheet, Text, Touchable, formatCount,
  fireHaptic, useSheetState, toast, type IconName,
} from '@/ui'
import { LivePill } from '@/components/live/LiveCard'
import { LiveChatRail, LiveComposer } from '@/components/live/LiveChat'
import { LivePlayer, type LiveTransport } from '@/components/live/LivePlayer'
import { ReactionLayer, useReactions } from '@/components/live/ReactionLayer'
import { GiftOverlay } from '@/components/live/Gifts'
import { PulseDot } from '@/components/live/RecordingStatusChip'
import { useLiveRoom } from '@/components/live/useLiveRoom'
import { usePublisher, type PublishStatus } from '@/components/live/usePublisher'
import { useStagePublishers } from '@/components/live/useStagePublishers'
import { BROADCAST_PLATE, FILL, ROOM, SCRIM_UP } from '@/components/live/skin'
import { clock, type LiveStream, type StageMember } from '@/components/live/types'

const HOLD_MS = 800

export default function HostConsoleScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  /* The composer's own edge. The KeyboardAvoidingView below already pads by
     the full keyboard overlap, so paying insets.bottom on top of it floats the
     row over a strip of wallpaper — DESIGN.md §8 and useDockInset's header. */
  const dock = useDockInset()
  const { height } = useWindowDimensions()
  /* The console pushes the stage, supporters and manage routes on top of
     itself. The self-monitor keeps decoding under all three unless told. */
  const focused = useIsFocused()
  const { user } = useAuth()
  const { id, publish, facing } = useLocalSearchParams<{ id: string; publish?: string; facing?: string }>()
  const streamId = id ? String(id) : ''
  const meId = user?.id ? String(user.id) : null

  const room = useLiveRoom(streamId)
  const { stream, stage } = room

  /* /live/go hands the chosen method through the route, so a host who picked
     the camera never sees "waiting for your encoder" flash first. */
  const [cameraMode, setCameraMode] = React.useState(publish === 'camera' && hasWebRTC)
  const pub = usePublisher(cameraMode ? stream?.whipUrl : null, {
    enabled: cameraMode,
    facing: facing === 'back' ? 'back' : 'front',
  })
  const publishing = !!pub.stream
  const canPublish = hasWebRTC && !!stream?.whipUrl

  const [monitor, setMonitor] = React.useState<VideoPlayerStatus>('idle')
  const [transport, setTransport] = React.useState<LiveTransport>('none')
  const [elapsed, setElapsed] = React.useState(0)
  const [chatCooldown, startChatCooldown] = useCooldown()
  const [recBusy, setRecBusy] = React.useState(false)
  const edit = useSheetState()
  const leaveMenu = useSheetState()
  const guestMenu = useSheetState<StageMember>()
  const [draftTitle, setDraftTitle] = React.useState('')
  const [draftDesc, setDraftDesc] = React.useState('')
  const [saveErr, setSaveErr] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const { floaters, react: fireReaction, spawn } = useReactions(room.react)
  React.useEffect(() => {
    room.bindReactionSink(spawn)
    return () => room.bindReactionSink(null)
  }, [room.bindReactionSink, spawn])

  /* Hold the composer heart to stream hearts — same wiring as the viewer
     room; the prop existed unwired since LiveComposer shipped. */
  const heartHold = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const onHeartHold = React.useCallback((down: boolean) => {
    if (down && !heartHold.current) {
      heartHold.current = setInterval(() => fireReaction('LIKE'), 160)
    } else if (!down && heartHold.current) {
      clearInterval(heartHold.current)
      heartHold.current = null
    }
  }, [fireReaction])
  React.useEffect(() => () => { if (heartHold.current) clearInterval(heartHold.current) }, [])

  React.useEffect(() => {
    if (!stream?.startedAt) return
    const at = Date.parse(stream.startedAt)
    const tickOnce = () => setElapsed(Math.max(0, Math.floor((Date.now() - at) / 1000)))
    tickOnce()
    const timer = setInterval(tickOnce, 1000)
    return () => clearInterval(timer)
  }, [stream?.startedAt])

  /* `stream.ended` (or an admin force-stop) lands the host on the manage
     screen, which is where an ended stream's recording lives. */
  React.useEffect(() => {
    if (room.ended && streamId) router.replace(`/live/${streamId}/manage`)
  }, [room.ended, streamId, router])

  React.useEffect(() => {
    if (!stream) return
    setDraftTitle(prev => prev || stream.title)
    setDraftDesc(prev => prev || stream.description)
  }, [stream])

  /* A guest is not mixed into the host's stream — each publishes to their own
     path — so hearing them at all means one subscription per guest. */
  const guestStreams = useStagePublishers(stage?.members ?? [], meId)

  const recording = stream?.recordingStatus === 'RECORDING'

  const toggleRecording = async () => {
    if (!streamId || recBusy) return
    setRecBusy(true)
    /* Stopping mid-broadcast PAUSES the recording (the stream is still live;
       takes are joined when it ends) — that is what the server echoes back. */
    const optimistic = recording ? 'PAUSED' : 'RECORDING'
    room.setStream(s => (s ? { ...s, recordingStatus: optimistic as LiveStream['recordingStatus'] } : s))
    try {
      const next = (recording
        ? await api.chat.streams.stopRecording(streamId)
        : await api.chat.streams.startRecording(streamId)) as LiveStream
      room.setStream(s => (s ? { ...s, recordingStatus: next.recordingStatus } : s))
      fireHaptic('success')
    } catch (e: any) {
      room.setStream(s => (s ? { ...s, recordingStatus: stream?.recordingStatus ?? null } : s))
      if (codeOf(e) === 'STREAM_NOT_LIVE') { router.replace(`/live/${streamId}/manage`); return }
      toast.error(errorText(e))
    } finally {
      setRecBusy(false)
    }
  }

  const save = async () => {
    if (!streamId) return
    setSaving(true)
    setSaveErr(null)
    try {
      const next = (await api.chat.streams.update(streamId, {
        title: draftTitle.trim(),
        description: draftDesc.trim(),
      })) as LiveStream
      room.setStream(s => (s ? { ...s, title: next.title, description: next.description } : s))
      fireHaptic('success')
      edit.close()
    } catch (e: any) {
      /* Moderation keeps the draft and offers no retry — the text is the
         problem, so re-sending it unchanged cannot succeed. */
      setSaveErr(isBlocked(e) ? moderationText(e) : errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const endStream = async () => {
    if (!streamId) return
    fireHaptic('heavy')
    /* Release the camera BEFORE the end call: the server tears the session
       down either way, and a host watching their own light stay on for the
       round trip has every reason to think the stream is still running. */
    pub.stop()
    try {
      await api.chat.streams.end(streamId)
      router.replace(`/live/${streamId}/manage`)
    } catch (e: any) {
      if (codeOf(e) === 'STREAM_NOT_LIVE') { router.replace(`/live/${streamId}/manage`); return }
      toast.error(errorText(e))
    }
  }

  const stopCamera = () => {
    pub.stop()
    setCameraMode(false)
    toast.info('Camera stopped. The stream is still live.')
  }

  const approve = async (m: StageMember) => {
    if (!streamId || !m.userId) return
    room.setRequests(prev => prev.filter(r => String(r.userId) !== String(m.userId)))
    try { await api.chat.streams.stage.approve(streamId, m.userId) }
    catch (e: any) { toast.warn(errorText(e)); room.setRequests(prev => [...prev, m]) }
  }

  const deny = async (m: StageMember) => {
    if (!streamId || !m.userId) return
    room.setRequests(prev => prev.filter(r => String(r.userId) !== String(m.userId)))
    try { await api.chat.streams.stage.deny(streamId, m.userId) } catch { /* already gone */ }
  }

  const copyIngest = async () => {
    if (!stream?.ingestUrl) { toast.warn('No ingest URL — reopen this console.'); return }
    await Clipboard.setStringAsync(stream.ingestUrl)
    fireHaptic('light')
    toast.warn("Copied. Don't paste this anywhere public.")
  }

  const paneH = Math.round(height * 0.45)
  const members = stage?.members ?? []
  const pending = room.requests.length
  const showMonitor = transport === 'whep' || monitor === 'readyToPlay'
  const starting = pub.status === 'starting'

  return (
    /* Padding-shove, like the chat thread: the pane keeps its fixed height,
       the flex chat rail absorbs the squeeze, and the composer lands above
       the keyboard instead of behind it. The bottom-anchored absolutes
       (request card, hearts) ride up with it — absolute insets measure from
       the padding box. */
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <Stack.Screen options={{ animation: 'fade', gestureEnabled: false, headerShown: false }} />
      <StatusBar style="light" />

      {/* Video pane */}
      <View style={[styles.pane, { height: paneH }]}>
        {publishing ? (
          /* The LOCAL capture, not a round trip through the server: this is
             what the encoder is being fed, with no latency to misread. */
          <RTCView
            streamURL={pub.stream.toURL()}
            objectFit="cover"
            mirror={pub.facing === 'front'}
            style={FILL}
          />
        ) : (
          <LivePlayer
            playbackUrl={stream?.playbackUrl ?? null}
            whepUrl={stream?.whepUrl ?? null}
            poster={stream?.hostAvatarUrl ?? null}
            /* Always muted: an unmuted self-monitor is a feedback loop through
               the encoder's own microphone. */
            muted
            quiet
            active={focused}
            onStatus={setMonitor}
            onTransport={setTransport}
            style={FILL}
          />
        )}

        {publishing ? (
          <View style={[styles.monitorChip, { backgroundColor: ROOM.glassStrong }]}>
            <Text variant="micro" color={ROOM.fgMuted}>Your camera · publishing</Text>
          </View>
        ) : showMonitor ? (
          /* Sky is the on-dark accent: it marks the STATE worth noticing —
             a real-time monitor — and stays muted for the ~10s HLS one. */
          <View style={[styles.monitorChip, { backgroundColor: transport === 'whep' ? ROOM.accentGhost : ROOM.glassStrong }]}>
            <Text variant="micro" color={transport === 'whep' ? ROOM.accent : ROOM.fgMuted}>
              {transport === 'whep' ? 'Monitor · live' : 'Monitor · ~10s behind'}
            </Text>
          </View>
        ) : (
          <Animated.View
            exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(320))}
            style={[FILL, styles.waiting, { backgroundColor: ROOM.pane }]}
          >
            {/* The navy broadcast plate under the waiting copy — the web
                stage's ground, not a flat black pane. */}
            <LinearGradient colors={BROADCAST_PLATE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />
            <PulseDot size={40} />
            <Text variant="headline" color={ROOM.fg} align="center" style={styles.waitTitle}>
              {starting ? 'Starting your camera…' : canPublish ? 'Nothing is publishing yet' : 'Waiting for your encoder…'}
            </Text>
            <Text variant="footnote" color={ROOM.fgMuted} align="center" style={styles.waitCopy}>
              {starting
                ? 'Framing up and shaking hands with the server.'
                : canPublish
                  ? 'Go live from this phone, or start your encoder and the picture appears here.'
                  : 'Publish to your RTMP URL and the picture appears here.'}
            </Text>
            {canPublish ? (
              <Button
                label="Go live from this camera"
                icon="video"
                onPress={() => { setCameraMode(true); pub.start() }}
                /* Dark ROOM surface: navy 'primary' is invisible here and
                   paper 'secondary' is a light-scheme plate — onDark is the
                   sanctioned dark-surface CTA (DESIGN.md §2). */
                variant="onDark"
                size="sm"
                loading={starting}
                style={styles.waitBtn}
              />
            ) : null}
            <Button
              label="Copy RTMP URL"
              icon="copy"
              onPress={copyIngest}
              variant="onDark"
              size="sm"
              style={canPublish ? styles.waitBtnTight : styles.waitBtn}
            />
            <Touchable
              onPress={() => router.push('/call/media-support')}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel="Setup help"
              style={styles.waitHelp}
            >
              <Text variant="footnote" color={ROOM.fgMuted} underline>Setup help</Text>
            </Touchable>
          </Animated.View>
        )}

        {/* On the web topbar's own gradient wash — under the banner and the
            chips, over the picture. */}
        <LinearGradient colors={SCRIM_UP} style={[styles.topScrim, { height: insets.top + 72 }]} pointerEvents="none" />

        <PublishBanner
          status={pub.status}
          health={pub.health}
          detail={pub.healthDetail}
          error={pub.error}
          denied={pub.denied}
          onRestart={pub.restart}
          top={insets.top + 46}
        />

        {publishing || pub.status === 'paused' ? (
          <View style={styles.publishRail}>
            <PaneToggle
              icon={pub.micOn ? 'mic' : 'micOff'}
              label={pub.micOn ? 'Mute yourself' : 'Unmute yourself'}
              off={!pub.micOn}
              onPress={pub.toggleMic}
            />
            <PaneToggle
              icon={pub.camOn ? 'video' : 'videoOff'}
              label={pub.camOn ? 'Turn the camera off' : 'Turn the camera on'}
              off={!pub.camOn}
              onPress={pub.toggleCam}
            />
            <PaneToggle icon="camera" label="Flip the camera" onPress={pub.flip} />
          </View>
        ) : null}

        {/* Top overlay */}
        <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
          <Touchable
            onPress={() => leaveMenu.open()}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="Leave the console"
            style={[styles.roundBtn, { backgroundColor: ROOM.glass }]}
          >
            <Icon name="down" size={20} color={ROOM.fg} />
          </Touchable>

          {/* The shared LIVE badge + the web's `.lv-elapsed` mono glass clock. */}
          <LivePill />
          <View style={[styles.glassPill, { backgroundColor: ROOM.glass }]}>
            <NumericText variant="micro" color={ROOM.fg}>{clock(elapsed)}</NumericText>
          </View>

          <View style={styles.spacer} />

          <View style={[styles.glassPill, { backgroundColor: ROOM.glass }]}>
            <Icon name="eye" size={12} color={ROOM.fg} />
            <Text variant="micro" color={ROOM.fg}>{formatCount(stream?.viewerCount ?? 0)}</Text>
          </View>

          {recording ? (
            /* Live-red ink on the glass — the web rec chip's colour, so REC
               never reads as just another counter. */
            <View style={[styles.glassPill, { backgroundColor: ROOM.glass }]}>
              <PulseDot size={7} />
              <Text variant="micro" color={ROOM.live} weight="700">REC</Text>
            </View>
          ) : null}
        </View>

      </View>

      {/* Stage strip */}
      <View style={styles.stageStrip}>
        {members.map(m => {
          const cell = m.isHost ? (publishing ? pub.stream : null) : guestStreams[String(m.userId)]
          return (
          <Touchable
            key={String(m.userId)}
            onLongPress={() => { if (!m.isHost) guestMenu.open(m) }}
            onPress={() => router.push(`/live/${streamId}/stage`)}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel={`${m.displayName || m.handle}${m.isHost ? ', host' : ''}`}
            style={styles.stageCell}
          >
            {/* Sky ring, not green: green is success-only; "on the stage" is
                the same you/active accent the grid's me-ring wears. */}
            <View style={m.status === 'ACTIVE' && !m.isHost ? [styles.activeRing, { borderColor: ROOM.accent }] : undefined}>
              {cell ? (
                <View style={styles.stageVideo}>
                  <RTCView
                    streamURL={cell.toURL()}
                    objectFit="cover"
                    mirror={m.isHost && pub.facing === 'front'}
                    style={FILL}
                  />
                </View>
              ) : (
                <Avatar uri={m.avatarUrl} name={m.displayName || m.handle} seed={m.userId} size={56} />
              )}
            </View>
            {m.muted ? (
              <View style={[styles.muteBadge, { backgroundColor: ROOM.live }]}>
                <Icon name="micOff" size={10} color={ROOM.fg} />
              </View>
            ) : null}
            {m.isHost ? (
              <View style={[styles.hostChip, { backgroundColor: ROOM.glassStrong }]}>
                <Text variant="micro" color={ROOM.fg} weight="700">HOST</Text>
              </View>
            ) : null}
          </Touchable>
          )
        })}

        <Touchable
          onPress={() => router.push(`/live/${streamId}/stage`)}
          feedback="scale"
          noAutoHitSlop
          accessibilityLabel="Invite someone on stage"
          style={[styles.inviteCell, { borderColor: ROOM.fgGhost }]}
        >
          <Icon name="personAdd" size={18} color={ROOM.fgMuted} />
        </Touchable>

        <View style={styles.stageCount}>
          <Text
            variant="micro"
            color={stage?.isFull ? ROOM.warning : ROOM.fgFaint}
            align="ui"
          >
            Stage {stage?.guestCount ?? 0}/{stage?.maxGuests ?? 6}
          </Text>
        </View>
      </View>

      {/* Chat */}
      <View style={styles.chatWrap}>
        <LiveChatRail rows={room.chat} hostId={room.stream?.hostId ? String(room.stream.hostId) : null} />
      </View>

      {/* Action rail — anchored to the SCREEN, not the pane. The pane is 45%
          of the window with overflow hidden, and a 6-slot column can never fit
          inside it: even icon-only it is 6×40 + 5×6 = 270pt against a 288pt
          pane on a 640pt window, so anchoring it in there clipped the top
          buttons — Stage, the only slot carrying the pending-request badge,
          first. Out here it hangs over the stage strip and chat, which give up
          their end-edge width for it (paddingEnd below), the way index.tsx's
          chat gives up width for its rail. Icon-only: the labels live on as
          each slot's accessibilityLabel.

          The maths on a 640pt window, insets 0: pane = round(640×0.45) = 288,
          so the publish toggles (bottom: 52, 40pt tall) end 288 − 52 = 236
          from the top; rail top = 640 − 122 − 270 = 248 — clear of them by
          12pt (and they are centred anyway, so no touch conflict on any
          width). Below, the composer block is 10 + 40 + 2 + 10 + 48 = 110pt +
          inset tall, so the rail's bottom edge at inset + 122 stays 12pt above
          the Hold-to-end button. */}
      <View style={[styles.actionRail, { bottom: insets.bottom + 122 }]}>
        <RailBtn icon="people" label="Stage" badge={pending} onPress={() => router.push(`/live/${streamId}/stage`)} />
        <RailBtn icon="crown" label="Top supporters" onPress={() => router.push(`/live/${streamId}/supporters`)} />
        <RailBtn
          icon="reels"
          label={recording ? 'Stop recording' : 'Record'}
          tint={recording ? ROOM.live : undefined}
          filled={recording}
          disabled={recBusy}
          onPress={toggleRecording}
        />
        <RailBtn icon="edit" label="Edit stream info" onPress={() => edit.open()} />
        <RailBtn
          icon="chat"
          label="Send in a message"
          onPress={() => {
            const url = stream?.shareUrl
            if (!url) { toast.warn('No share link yet.'); return }
            /* Only ever `shareUrl`. `ingestUrl`/`whipUrl` carry the key. */
            router.push({ pathname: '/chat/share', params: { url, kind: 'live', label: stream?.title || 'Live' } })
          }}
        />
        <RailBtn
          icon="share"
          label="Share"
          onPress={() => {
            const url = stream?.shareUrl
            if (!url) { toast.warn('No share link yet.'); return }
            /* Only ever `shareUrl`. `ingestUrl`/`whipUrl` carry the key. */
            void Share.share({ message: url, url })
          }}
        />
        <RailBtn icon="settings" label="Settings" onPress={() => router.push(`/live/${streamId}/manage`)} />
      </View>

      <ReactionLayer floaters={floaters} origin={{ bottom: insets.bottom + 140, end: 20 }} />
      <GiftOverlay queue={room.gifts} keyOf={room.giftKey} />

      {/* Pending stage requests — inline, because a toast that vanishes takes
          the "Bring up" button with it. */}
      {room.requests.length ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(200))}
          /* Same Sky start-spine as the viewer's invite card — one accent-edge
             grammar for "the stage is asking you something". */
          style={[styles.requestCard, { backgroundColor: ROOM.card, borderStartColor: ROOM.accent, bottom: insets.bottom + 120 }]}
        >
          <Avatar
            uri={room.requests[0].avatarUrl}
            name={room.requests[0].displayName || room.requests[0].handle}
            seed={room.requests[0].userId}
            size={36}
          />
          <View style={styles.flex}>
            <Text variant="subhead" weight="600" color={ROOM.fg} numberOfLines={1}>
              {room.requests[0].displayName || `@${room.requests[0].handle}`}
            </Text>
            <Text variant="micro" color={ROOM.fgMuted}>
              asked to come up{room.requests.length > 1 ? ` · +${room.requests.length - 1} more` : ''}
            </Text>
          </View>
          <Button
            label={stage?.isFull ? 'Stage full' : 'Bring up'}
            onPress={() => void approve(room.requests[0])}
            variant="onDark"
            size="sm"
            disabled={!!stage?.isFull}
          />
          <Button label="Dismiss" onPress={() => void deny(room.requests[0])} variant="onDark" size="sm" />
        </Animated.View>
      ) : null}

      {/* Composer + end */}
      <View style={[styles.bottom, { paddingBottom: dock + 10 }]}>
        <HoldToEnd onComplete={endStream} />
        <LiveComposer
          joined
          cooldown={chatCooldown}
          error={room.chatError}
          onSend={async text => { try { await room.send(text) } catch (e: any) { startChatCooldown(e) } }}
          onHeart={() => fireReaction('LIKE')}
          onHeartHold={onHeartHold}
          style={styles.composer}
        />
      </View>

      {/* Edit info */}
      <Sheet
        visible={edit.visible}
        onClose={edit.close}
        title="Edit stream info"
        subtitle="Viewers see changes instantly."
        footer={<Button label="Save" onPress={save} variant="primary" size="lg" block loading={saving} />}
      >
        <View style={styles.editBody}>
          <Field label="Title" value={draftTitle} onChangeText={setDraftTitle} maxLength={80} />
          <Field
            label="Description"
            value={draftDesc}
            onChangeText={setDraftDesc}
            maxLength={280}
            multiline
            minHeight={96}
          />
          {saveErr ? <Text variant="footnote" tone="danger" align="ui">{saveErr}</Text> : null}
        </View>
      </Sheet>

      <ActionSheet
        visible={leaveMenu.visible}
        onClose={leaveMenu.close}
        title="Keep streaming?"
        subtitle={publishing
          ? 'Leaving this screen releases the camera — the stream stays live for an encoder.'
          : 'Leaving the console does not end the broadcast.'}
        actions={[
          {
            label: 'Keep streaming and leave',
            icon: 'down',
            onPress: () => { if (router.canGoBack()) router.back() },
          },
          {
            label: 'Stop the camera, keep the stream',
            icon: 'videoOff',
            hidden: !publishing,
            onPress: stopCamera,
          },
          { label: 'End the stream', icon: 'callEnd', destructive: true, onPress: endStream },
        ]}
      />

      <ActionSheet
        visible={guestMenu.visible}
        onClose={guestMenu.close}
        title={guestMenu.payload?.displayName || (guestMenu.payload ? `@${guestMenu.payload.handle}` : undefined)}
        actions={[
          {
            label: guestMenu.payload?.muted ? 'Unmute' : 'Mute',
            icon: guestMenu.payload?.muted ? 'mic' : 'micOff',
            onPress: () => {
              const m = guestMenu.payload
              if (!m?.userId || !streamId) return
              const wasMuted = m.muted
              /* Optimistic: the authoritative flag returns on the next roster
                 frame, which every client applies locally. */
              room.setStage(s => s && ({
                ...s,
                members: s.members.map(x => (String(x.userId) === String(m.userId) ? { ...x, muted: !wasMuted } : x)),
              }))
              void (wasMuted
                ? api.chat.streams.stage.unmute(streamId, m.userId)
                : api.chat.streams.stage.mute(streamId, m.userId)
              ).catch((e: any) => toast.warn(errorText(e)))
            },
          },
          {
            label: 'Take down',
            icon: 'personRemove',
            destructive: true,
            onPress: () => {
              const m = guestMenu.payload
              if (!m?.userId || !streamId) return
              void api.chat.streams.stage.remove(streamId, m.userId).catch((e: any) => toast.warn(errorText(e)))
            },
          },
          {
            label: 'Open profile',
            icon: 'person',
            hidden: !guestMenu.payload?.handle,
            onPress: () => router.push(`/u/${guestMenu.payload?.handle}`),
          },
        ]}
      />
    </KeyboardAvoidingView>
  )
}

/* ---------------------------------------------------------
   The publish banner.

   `onHealth` is the only warning a host gets that their picture
   has stopped while their audio sails on, and a broadcast is
   exactly the situation where nobody is going to notice a
   toast. So it sits over the pane, in the host's eyeline, and
   'lost' stays there until it is acted on.
   --------------------------------------------------------- */

function PublishBanner({
  status, health, detail, error, denied, onRestart, top,
}: {
  status: PublishStatus
  health: LiveHealth | null
  detail: string | null
  error: any
  denied: boolean
  onRestart: () => void
  top: number
}) {
  const t = useTheme()
  const [dismissed, setDismissed] = React.useState(false)

  /* 'recovered' and 'ok' are good news, and good news does not need a banner
     for longer than it takes to read. */
  React.useEffect(() => {
    setDismissed(false)
    if (health !== 'recovered' && health !== 'ok') return
    const id = setTimeout(() => setDismissed(true), 2600)
    return () => clearTimeout(id)
  }, [health, detail, status])

  let tone = ROOM.warning
  let title = ''
  let body = ''
  let action: { label: string; onPress: () => void } | null = null

  if (status === 'error') {
    tone = ROOM.danger
    /* `stage` (liveWebrtc) separates the device from the network: a WHIP
       handshake that never reached the server must not blame the camera —
       that headline sends the host to Settings when the fix is the server.
       The body stays `errorText(e)`: the message is never re-worded. */
    title = error?.stage === 'signal'
      ? 'Could not reach the streaming server'
      : 'The camera could not start'
    body = denied
      ? 'Hikmah Web needs the camera and the microphone to broadcast. Turn them on in Settings.'
      : errorText(error)
    action = denied
      ? { label: 'Open Settings', onPress: () => void Linking.openSettings() }
      : { label: 'Try again', onPress: onRestart }
  } else if (health === 'lost') {
    tone = ROOM.danger
    title = 'Your picture has stopped'
    body = `${detail || 'the camera could not be reopened'}. Restart it, or switch to an external encoder.`
    action = { label: 'Restart camera', onPress: onRestart }
  } else if (status === 'paused') {
    title = 'Camera paused'
    body = 'The phone stops capturing while Hikmah Web is in the background. It restarts when you come back.'
  } else if (health === 'stalled') {
    title = 'Your picture froze'
    body = `${detail || 'the camera stopped producing frames'} — reopening it now.`
  } else if (health === 'recovered') {
    tone = ROOM.success
    title = 'Picture restored'
    body = 'Viewers are seeing you again.'
  }

  if (!title || dismissed) return null

  return (
    <Animated.View
      entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(180))}
      style={[styles.banner, { top, backgroundColor: ROOM.glassStrong, borderStartColor: tone }]}
    >
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" color={tone} align="ui">{title}</Text>
        <Text variant="micro" color={ROOM.fgMuted} align="ui" style={styles.bannerBody}>{body}</Text>
      </View>
      {action ? (
        <Button label={action.label} onPress={action.onPress} variant="onDark" size="sm" />
      ) : null}
    </Animated.View>
  )
}

function PaneToggle({
  icon, label, off, onPress,
}: { icon: IconName; label: string; off?: boolean; onPress: () => void }) {
  return (
    <Touchable
      onPress={onPress}
      haptic="light"
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.paneToggle, { backgroundColor: off ? ROOM.fg : ROOM.glassStrong }]}
    >
      {/* OFF inverts to the light plate — the web castbar's is-off pattern
          (white fill, navy ink); red on this console means REC and nothing
          else. Sky marks the ACTIVE state. */}
      <Icon name={icon} size={18} color={off ? ROOM.bg : ROOM.accent} />
    </Touchable>
  )
}

/* ---------------------------------------------------------
   Hold to end.

   A tap is too cheap for the one irreversible action on this
   screen, and a confirm dialog mid-broadcast is a modal in
   front of a live audience. An 800ms hold is both deliberate
   and fast.
   --------------------------------------------------------- */

function HoldToEnd({ onComplete }: { onComplete: () => void }) {
  const t = useTheme()
  const p = useSharedValue(0)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    p.value = withTiming(0, { duration: t.ms(160) })
  }

  const begin = () => {
    p.value = withTiming(1, { duration: t.ms(HOLD_MS) || 1, easing: Easing.linear })
    timer.current = setTimeout(() => { timer.current = null; onComplete() }, HOLD_MS)
  }

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /* A screen reader's double-tap is a SYNTHESIZED press — pressIn/pressOut
     fire back-to-back and the hold can never accumulate, which locked a blind
     host out of ending their own broadcast (accessibility activations route
     only through onPress). Under a reader the press becomes a deliberate
     two-step confirm; the sighted hold flow is untouched. */
  const [srArmed, setSrArmed] = React.useState(false)
  const disarm = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const srPress = () => {
    if (!t.a11y.screenReader) return
    if (srArmed) {
      if (disarm.current) { clearTimeout(disarm.current); disarm.current = null }
      setSrArmed(false)
      onComplete()
      return
    }
    setSrArmed(true)
    announce('Double-tap again to end the live stream')
    disarm.current = setTimeout(() => { disarm.current = null; setSrArmed(false) }, 6000)
  }
  React.useEffect(() => () => { if (disarm.current) clearTimeout(disarm.current) }, [])

  /* scaleX, not width: this sweep runs while the encoder has the device by the
     throat, and an animated width relayouts the button's subtree on every
     frame of the hold. The fill carries NO radius of its own — the pill it
     lives in clips it — so scaling it on X cannot warp a corner; that is the
     only condition under which scaleX is allowed instead of the heavier
     clip-translate. The origin is PHYSICAL and has to be flipped for RTL. */
  const origin = t.isRTL ? 'right' : 'left'
  const fill = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(1, Math.max(0, p.value)) }],
  }))

  return (
    <Touchable
      onPress={srPress}
      onPressIn={begin}
      onPressOut={cancel}
      feedback="none"
      noAutoHitSlop
      accessibilityLabel={srArmed ? 'Double-tap again to end the live stream' : 'End the live stream'}
      style={[styles.endBtn, { backgroundColor: ROOM.danger }]}
    >
      <Animated.View
        style={[styles.endFill, { backgroundColor: ROOM.fg, opacity: 0.22, transformOrigin: origin }, fill]}
      />
      <Text variant="headline" color={ROOM.fg} align="center">Hold to end</Text>
    </Touchable>
  )
}

/* Icon-only: `label` is SPOKEN, not drawn — a drawn 13pt micro label costs
   16pt per slot, and the rail's fit on a 640pt window (see the arithmetic at
   the call site) has no 16pt to give. */
function RailBtn({
  icon, label, onPress, badge, tint, filled, disabled,
}: {
  icon: IconName
  label: string
  onPress: () => void
  badge?: number
  tint?: string
  filled?: boolean
  disabled?: boolean
}) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.railCircle, { backgroundColor: ROOM.glass, opacity: disabled ? 0.5 : 1 }]}
    >
      <Icon name={icon} size={20} color={tint ?? ROOM.fg} filled={filled} />
      {badge ? (
        <View style={[styles.railBadge, { backgroundColor: ROOM.live }]}>
          <Text variant="micro" color={ROOM.fg}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ROOM.bg },
  pane: { width: '100%', overflow: 'hidden', backgroundColor: ROOM.pane },
  waiting: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  waitTitle: { marginTop: space.lg2 },
  waitCopy: { marginTop: space.xs, maxWidth: 280 },
  waitBtn: { marginTop: space.lg },
  waitBtnTight: { marginTop: space.sm },
  waitHelp: { marginTop: space.sm2, paddingVertical: space.xs },
  /* Text-bearing plates wear setback corners (DESIGN.md §8.9) — uniform radii
     are for the round icon-only controls below, which are sanctioned. */
  monitorChip: { position: 'absolute', start: 10, bottom: 10, paddingHorizontal: space.sm, paddingVertical: space.xs, ...setback(shape.chip), borderCurve: 'continuous' },
  banner: {
    position: 'absolute',
    start: 12,
    end: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingVertical: space.sm2,
    paddingHorizontal: space.md,
    ...setback(shape.card),
    borderCurve: 'continuous',
    borderStartWidth: 3,
  },
  bannerBody: { marginTop: space.xxs },
  publishRail: {
    position: 'absolute',
    /* Above the corner chip, not across it. */
    bottom: 52,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
  },
  paneToggle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stageVideo: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', backgroundColor: ROOM.tile },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  roundBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  glassPill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 24, paddingHorizontal: space.sm, ...setback(shape.chip), borderCurve: 'continuous' },
  spacer: { flex: 1 },
  /* `bottom` is inline — it carries the safe-area inset. The circle size and
     gap are load-bearing: 6×40 + 5×6 = 270pt is what the 640pt-window
     arithmetic at the call site is computed from. */
  actionRail: { position: 'absolute', end: 8, alignItems: 'center', gap: space.xs2 },
  railCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  railBadge: {
    position: 'absolute',
    top: -2,
    end: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageStrip: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    paddingStart: space.md,
    /* The action rail owns the end-edge column (end 8, 40pt wide): the strip
       gives up the width so its count — and a fourth cell — never sit under
       the rail's circles. */
    paddingEnd: space.giant,
  },
  stageCell: { width: 56, height: 56 },
  activeRing: { borderWidth: 2, borderRadius: 999 },
  muteBadge: {
    position: 'absolute',
    end: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostChip: { position: 'absolute', bottom: -4, alignSelf: 'center', paddingHorizontal: space.xs2, ...setback(shape.chip), borderCurve: 'continuous' },
  inviteCell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageCount: { marginStart: 'auto' },
  /* Same end-edge concession as the strip: chat lines wrap short of the rail
     instead of running under it. */
  chatWrap: { flex: 1, paddingEnd: 52 },
  requestCard: {
    position: 'absolute',
    start: 12,
    /* end 60, not 12: the card floats at the exact height of the action
       rail's bottom circle, and a card drawn over it would eat the tap. */
    end: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    padding: space.sm2,
    ...setback(shape.card),
    borderCurve: 'continuous',
    borderStartWidth: 3,
  },
  bottom: { paddingHorizontal: space.md, gap: space.sm2 },
  endBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /* Full-bleed once, then scaled: `end: 0` is what turns the old animated
     width into a one-time layout. Logical edges, so RTL mirrors the box and
     `transformOrigin` mirrors the growth. */
  endFill: { position: 'absolute', start: 0, end: 0, top: 0, bottom: 0 },
  composer: { marginTop: space.xxs },
  editBody: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.lg },
  flex: { flex: 1 },
})
