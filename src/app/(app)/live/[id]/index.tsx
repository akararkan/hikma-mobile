/* =========================================================
   Watch live — the viewer room.

   Playback tries WHEP first (sub-second) and keeps HLS as the
   fallback, which is the order the docs prescribe: WebRTC for
   latency, HLS for reach. The latency chip reports which one
   actually won rather than claiming either, because "Low
   latency" over a ten-second HLS feed is the kind of lie that
   makes a host talk over their own chat.

   The multi-guest stage is real media now: every guest
   publishes to their own path and the roster carries a public
   `whepUrl` for each, so the grid opens one subscription per
   publisher. There is still no HLS URL for a guest — a build
   without the media engine keeps the avatar tile it had, and
   rewriting a WHEP URL into an HLS one would be inventing an
   endpoint.

   And when YOU are brought up, this screen is what publishes
   your camera: the credential arrives once, on your own
   `stream.stage.grant`, and lives only in the room's memory.
   The stage sheet is a control plane on top of this screen,
   which is why closing it does not take you off the air.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useKeepAwake } from 'expo-keep-awake'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { reportHref } from '@/components/system/Moderation'
import { applySocialStatus, useSocialStatus } from '@/components/profile/useSocialStatus'
import { hasWebRTC } from '@/lib/liveWebrtc'
import { useCooldown } from '@/hooks/useCooldown'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, Icon, NumericText, Text, Touchable, formatCount, fireHaptic,
  useSheetState, toast, type IconName,
} from '@/ui'
import { LivePill } from '@/components/live/LiveCard'
import { LiveChatRail, LiveComposer } from '@/components/live/LiveChat'
import { LivePlayer, type LiveTransport } from '@/components/live/LivePlayer'
import { ReactionLayer, useReactions } from '@/components/live/ReactionLayer'
import { GiftOverlay, GiftPickerSheet } from '@/components/live/Gifts'
import { StageGrid } from '@/components/live/StageGrid'
import { useLiveRoom } from '@/components/live/useLiveRoom'
import { usePublisher } from '@/components/live/usePublisher'
import { useStagePublishers } from '@/components/live/useStagePublishers'
import { FILL, ROOM, SCRIM_DOWN, SCRIM_UP, night } from '@/components/live/skin'
import { clock, type GiftEntry } from '@/components/live/types'

/** The catalog never changes within a session; one fetch serves every room. */
let catalogCache: GiftEntry[] | null = null

export default function WatchLiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <WatchLiveRoom streamId={id ? String(id) : ''} />
}

/** The whole room, parameterized: the classic /live/[id] screen renders one,
 *  and /live/watch (the vertical pager) mounts exactly ONE for its settled
 *  page — mounting is what joins, unmounting is what leaves, so the pager's
 *  settle debounce doubles as the join debounce. `active` ANDs into focus:
 *  false parks the decode without tearing the transport down. */
export function WatchLiveRoom({ streamId, active = true }: { streamId: string; active?: boolean }) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { user } = useAuth()
  /* This room pushes four routes on top of itself (profile, stage, supporters,
     report) and stays mounted under every one of them. Focus gates the DECODE
     only — the transport, the socket and your own publish all keep running. */
  const screenFocused = useIsFocused()
  const focused = screenFocused && active

  const room = useLiveRoom(streamId)
  const { stream, stage, ended } = room
  const meId = user?.id ? String(user.id) : null

  /* One WHEP subscription per guest on stage — your own is excluded, because
     your tile is the local capture below. */
  const guestStreams = useStagePublishers(stage?.members ?? [], meId)
  /* The grant is the only copy of your publish credential; the moment it lands
     this phone starts publishing to the stage. */
  /* hostMuted comes straight off the roster: when the host mutes you, every
     other client silences your audio — honouring it here is what actually
     stops your microphone (live-multiguest-frontend.md §5). */
  const pub = usePublisher(room.publish?.whipUrl, {
    enabled: !!room.publish,
    hostMuted: !!room.myMember?.muted,
  })

  const [transport, setTransport] = React.useState<LiveTransport>('none')
  const [expanded, setExpanded] = React.useState(false)
  const [followBusy, setFollowBusy] = React.useState(false)
  const [chatCooldown, startChatCooldown] = useCooldown()
  const [handCooldown, startHandCooldown] = useCooldown()
  const gifts = useSheetState()
  const overflow = useSheetState()
  const [catalog, setCatalog] = React.useState<GiftEntry[]>(catalogCache ?? [])
  const [catalogBusy, setCatalogBusy] = React.useState(false)

  const { floaters, react: fireReaction, spawn } = useReactions(room.react)

  /* A sleeping display suspends playback mid-stream — the publish path holds
     a wake lock (liveWebrtc), but a VIEWER had nothing and the screen slept
     on them. Released automatically on unmount. */
  useKeepAwake()

  /* Hold the composer heart to stream hearts — the LiveComposer has wired
     onHeartHold since it shipped; no caller ever passed it. */
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
    room.bindReactionSink(spawn)
    return () => room.bindReactionSink(null)
  }, [room.bindReactionSink, spawn])

  /* Follow state is not on LiveStreamResponse — and it is not on the host's
     UserResponse either: `userFrom` hardcodes isFollowing:false, so the
     profile read used to seed this button `false` for everyone. Only
     /users/{id}/social-status knows, and going through the shared cache is
     what keeps this room agreeing with the profile pushed on top of it. */
  const hostId = stream?.hostId ? String(stream.hostId) : null
  const rel = useSocialStatus(hostId)
  const following = rel.status?.isFollowing ?? null

  const leaveAndBack = () => {
    /* useLiveRoom's unmount cleanup fires `leave` (and `stage.leave` when up),
       so the only job here is to pop. */
    if (router.canGoBack()) router.back()
    else router.replace('/live')
  }

  /* The write adopts `updatedStatus` rather than re-reading: the response
     carries the authoritative flags and both counts. A tap before the status
     has landed is refused outright — flipping an unknown is how you unfollow
     someone by accident. */
  const toggleFollow = async () => {
    if (!hostId || following === null || followBusy) return
    const next = !following
    setFollowBusy(true)
    applySocialStatus(hostId, { isFollowing: next })
    fireHaptic('light')
    try {
      const res: any = await (next ? api.users.follow(hostId) : api.users.unfollow(hostId))
      applySocialStatus(hostId, res?.updatedStatus ?? { isFollowing: next })
    } catch (e: any) {
      applySocialStatus(hostId, { isFollowing: !next })
      toast.error(errorText(e))
    } finally {
      setFollowBusy(false)
    }
  }

  const openGifts = async () => {
    gifts.open()
    if (catalogCache) return
    setCatalogBusy(true)
    try {
      const rows = (await api.chat.streams.gifts.catalog()) as GiftEntry[]
      catalogCache = rows
      setCatalog(rows)
    } catch { /* the sheet shows its own empty line */ }
    finally { setCatalogBusy(false) }
  }

  const raise = async () => {
    try {
      await room.raiseHand()
      fireHaptic('success')
    } catch (e: any) {
      if (startHandCooldown(e)) return
      toast.warn(errorText(e))
    }
  }

  const send = async (text: string) => {
    try { await room.send(text) }
    catch (e: any) { startChatCooldown(e) }
  }

  const share = () => {
    const url = stream?.shareUrl
    if (!url) { toast.warn('No share link for this stream.'); return }
    void Share.share({ message: url, url })
  }

  const [answeringInvite, setAnsweringInvite] = React.useState(false)
  const acceptStageInvite = async () => {
    if (answeringInvite) return
    setAnsweringInvite(true)
    try {
      /* The accept response carries the publish credential; the room stores it
         and this screen's publisher picks it up. */
      await room.acceptInvite()
      fireHaptic('success')
    } catch (e: any) {
      /* The invite banner stays — a full stage or a dropped request is
         retryable, and Decline remains the explicit way out. */
      toast.warn(errorText(e))
    } finally {
      setAnsweringInvite(false)
    }
  }

  /* ---------- ended ---------- */
  if (ended || (room.error && !stream)) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false }} />
        <StatusBar style="light" />
        <View style={[styles.endedWrap, { paddingTop: insets.top }]}>
          <Avatar
            uri={stream?.hostAvatarUrl ?? null}
            name={stream?.hostDisplayName ?? stream?.hostHandle}
            seed={stream?.hostId ?? streamId}
            size={88}
          />
          {/* Serif — the web's ended plate leads with the display face. */}
          <Text variant="title3" serif color={ROOM.fg} align="center" style={styles.endedTitle}>
            {stream?.hostHandle ? `@${stream.hostHandle}'s live has ended` : "This stream isn't live any more"}
          </Text>
          {stream ? (
            <Text variant="footnote" color={ROOM.fgMuted} align="center">
              {formatCount(stream.viewerCount)} watched{durationOf(stream) ? ` · ${durationOf(stream)}` : ''}
            </Text>
          ) : null}
          {room.error ? (
            <Text variant="footnote" color={ROOM.fgFaint} align="center" style={styles.endedTitle}>
              {errorText(room.error)}
            </Text>
          ) : null}
          <View style={styles.endedActions}>
            {/* Dark ROOM surface — onDark is the sanctioned CTA (DESIGN.md §2);
                navy 'primary' vanishes here and paper 'secondary' glares. */}
            <Button label="Back to Live" onPress={() => router.replace('/live')} variant="onDark" size="md" block />
            {/* No button until the relationship is known — "Follow @host" on
                someone you already follow is a lie you only discover by
                tapping it. */}
            {stream?.hostHandle && following !== null ? (
              <Button
                label={following ? `Following @${stream.hostHandle}` : `Follow @${stream.hostHandle}`}
                onPress={toggleFollow}
                variant="onDark"
                size="md"
                loading={followBusy}
                block
              />
            ) : null}
          </View>
        </View>
      </View>
    )
  }

  /* ---------- layout ---------- */
  const members = stage?.members ?? []
  const multi = members.length > 1
  const onStage = room.hand === 'onstage'
  /* The gate stays. A build stripped of the media engine still gets a seat on
     the stage — it just cannot send, and the pill says NOT SENDING rather than
     offering a mute button attached to nothing. */
  const onAir = !!room.publish && hasWebRTC
  /* The self controls sit between the chat and the composer; the rail gives up
     the height rather than overlapping them. */
  const chatBottom = insets.bottom + 58 + (onStage ? 46 : 0)
  const chatH = Math.min(height * 0.38, 300)

  const hostPlayer = (
    <LivePlayer
      playbackUrl={stream?.playbackUrl ?? null}
      whepUrl={stream?.whepUrl ?? null}
      poster={stream?.hostAvatarUrl ?? null}
      active={focused}
      onTransport={setTransport}
      style={FILL}
    />
  )

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'fade', headerShown: false }} />
      <StatusBar style="light" />

      {/* Player / stage. The TikTok grammar: a tap anywhere on the picture IS
          a like — hearts float, chrome never hides. */}
      <Touchable
        onPress={(e?: any) => {
          /* Spawn under the finger, the reels-burst grammar: the floater
             column is a 60pt strip anchored 26pt off the END edge, so the
             offset is measured from its centre — physical maths, mirrored
             for RTL (the sanctioned exception). */
          const px = e?.nativeEvent?.pageX
          const centerX = t.isRTL ? 26 + 30 : width - 26 - 30
          fireReaction('LIKE', typeof px === 'number' ? px - centerX : 0)
          fireHaptic('light')
        }}
        onLongPress={(e?: any) => {
          const px = e?.nativeEvent?.pageX
          const centerX = t.isRTL ? 26 + 30 : width - 26 - 30
          const x = typeof px === 'number' ? px - centerX : 0
          fireHaptic('medium')
          for (let i = 0; i < 5; i++) setTimeout(() => fireReaction('LIKE', x), i * 160)
        }}
        feedback="none"
        noAutoHitSlop
        accessibilityLabel="Send a heart"
        style={FILL}
      >
        {multi ? (
          <StageGrid
            members={members}
            meId={meId}
            width={width}
            height={height}
            streams={guestStreams}
            localStream={pub.stream}
            localMirror={pub.facing === 'front'}
            hostPlayer={hostPlayer}
          />
        ) : hostPlayer}
      </Touchable>

      {/* The player-gradient band under the chat and composer — the web's
          `.lv-stage::after`. Legibility comes from this wash, never from
          per-glyph shadows. pointerEvents none: taps still reach the video. */}
      <LinearGradient
        colors={SCRIM_DOWN}
        style={[styles.bottomScrim, { height: chatH + insets.bottom + 96 }]}
        pointerEvents="none"
      />

      {/* Top chrome — ALWAYS visible, the TikTok grammar: the room's identity
          never hides behind a tap the viewer has to discover. Capsule chrome
          is deliberate here (owner's TikTok directive for the live surfaces) —
          the one place the app wears full capsules outside the two sanctioned
          pills. */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {/* The chips float on a wash, not raw over the picture; extends past
            the content so it fades out instead of cutting. */}
        <LinearGradient colors={SCRIM_UP} style={styles.topScrim} pointerEvents="none" />

        {/* Row 1 — host capsule (avatar · name · Follow) + audience + leave. */}
        <View style={styles.topRow}>
          <View style={[styles.hostChip, { backgroundColor: ROOM.glassStrong }]}>
            <Touchable
              onPress={() => stream?.hostHandle && router.push(`/u/${stream.hostHandle}`)}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel={`Open @${stream?.hostHandle ?? 'host'}`}
              style={styles.hostTap}
            >
              <Avatar
                uri={stream?.hostAvatarUrl ?? null}
                name={stream?.hostDisplayName ?? stream?.hostHandle}
                seed={stream?.hostId ?? streamId}
                size={32}
              />
              <View style={styles.hostNames}>
                <Text variant="footnote" weight="700" color={ROOM.fg} numberOfLines={1}>
                  {stream?.hostDisplayName || stream?.hostHandle || 'Live'}
                </Text>
                {stream?.hostHandle ? (
                  <Text variant="micro" caps={false} color={ROOM.fgMuted} numberOfLines={1}>@{stream.hostHandle}</Text>
                ) : null}
              </View>
            </Touchable>
            {/* Nothing until social-status lands: the capsule holds its shape
                by simply not carrying a pill for a beat, which is quieter here
                than a skeleton on the host chip. */}
            {hostId && hostId !== String(user?.id ?? '') && following !== null ? (
              <Touchable
                onPress={toggleFollow}
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel={following ? 'Unfollow the host' : 'Follow the host'}
                style={[
                  styles.followPill,
                  following
                    /* Sky outline — the settled state wears the on-dark
                       accent, not a grey that reads disabled. */
                    ? { borderColor: ROOM.accent, borderWidth: StyleSheet.hairlineWidth * 2 }
                    /* The dark-plate CTA pair: cerulean + navy ink. */
                    : { backgroundColor: night.cta },
                ]}
              >
                <Text variant="micro" caps={false} weight="700" color={following ? ROOM.accent : night.textOnCta}>
                  {following ? 'Following' : 'Follow'}
                </Text>
              </Touchable>
            ) : null}
          </View>

          <View style={styles.topRight}>
            {/* The audience capsule: the top supporters' faces + the count —
                tapping it opens the supporters list, the TikTok viewer-chip
                behaviour. */}
            <Touchable
              onPress={() => router.push(`/live/${streamId}/supporters`)}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel={`${formatCount(stream?.viewerCount ?? 0)} watching — open supporters`}
              style={[styles.audienceChip, { backgroundColor: ROOM.glass }]}
            >
              {room.supporters.slice(0, 3).map((s: any, i: number) => (
                <View key={String(s.userId ?? i)} style={[styles.face, i > 0 && styles.faceOverlap]}>
                  <Avatar uri={s.avatarUrl ?? null} name={s.displayName ?? s.handle} seed={s.userId} size={20} />
                </View>
              ))}
              <Icon name="eye" size={12} color={ROOM.fg} />
              <NumericText variant="micro" caps={false} color={ROOM.fg}>{formatCount(stream?.viewerCount ?? 0)}</NumericText>
            </Touchable>

            <Touchable
              onPress={leaveAndBack}
              feedback="scale"
              noAutoHitSlop
              /* 32pt of plate is under the 44pt fold, and the auto-measured
                 slop is off here — so the slop is stated. */
              hitSlop={6}
              accessibilityLabel="Leave the stream"
              style={[styles.closeBtn, { backgroundColor: ROOM.glass }]}
            >
              <Icon name="close" size={18} color={ROOM.fg} />
            </Touchable>
          </View>
        </View>

        {/* Row 2 — LIVE · clock · low-latency (only when WebRTC actually won:
            "standard latency" is not a badge worth shouting) · the crown
            (top gifts) · the overflow. */}
        <View style={styles.statusRow}>
          <LivePill small />
          <ElapsedChip startedAt={stream?.startedAt ?? null} />
          {transport === 'whep' ? (
            <View style={[styles.pill, { backgroundColor: ROOM.accentGhost }]}>
              <Text variant="micro" caps={false} color={ROOM.accent}>Low latency</Text>
            </View>
          ) : null}
          <View style={styles.flexSpacer} />
          {room.supporters.length ? (
            <Touchable
              onPress={() => router.push(`/live/${streamId}/supporters`)}
              feedback="dim"
              noAutoHitSlop
              accessibilityLabel="Top supporters"
              style={[styles.pill, { backgroundColor: ROOM.glass }]}
            >
              <Icon name="crown" size={12} color={ROOM.accent} />
              <NumericText variant="micro" caps={false} color={ROOM.fg}>
                {formatCount(room.supporters[0]?.coins ?? 0)}
              </NumericText>
            </Touchable>
          ) : null}
          <Touchable
            onPress={() => overflow.open()}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="More options"
            style={[styles.moreBtn, { backgroundColor: ROOM.glass }]}
          >
            <Icon name="more" size={15} color={ROOM.fg} />
          </Touchable>
        </View>

        <Touchable
          onPress={() => setExpanded(v => !v)}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel="Show the stream description"
          style={styles.titleRow}
        >
          <Text variant="footnote" color={ROOM.fgMuted} align="ui" numberOfLines={expanded ? 3 : 1}>
            {stream?.title ?? ''}
          </Text>
          {expanded && stream?.description ? (
            <Text variant="footnote" color={ROOM.fgMuted} align="ui" numberOfLines={3} style={styles.desc}>
              {stream.description}
            </Text>
          ) : null}
        </Touchable>
      </View>

      {/* Stage invite — outside the auto-hiding chrome: an open question from
          the host must not vanish with the controls. Decline is an ANSWER, not
          a dismissal — it is what resolves the host's INVITED row, so there is
          no silent close on this card. */}
      {room.invite && !onStage ? (
        <Animated.View
          entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(180))}
          /* The Sky start-spine is the web invite banner's accent edge
             (`.lv-invite`) — the same tone-strip grammar the host console's
             publish banner already wears. */
          style={[styles.inviteCard, { top: insets.top + 104, backgroundColor: ROOM.card, borderStartColor: ROOM.accent }]}
        >
          <Avatar
            uri={room.invite.avatarUrl}
            name={room.invite.displayName || room.invite.handle}
            seed={room.invite.userId ?? streamId}
            size={36}
          />
          <View style={styles.inviteBody}>
            <Text variant="subhead" weight="600" color={ROOM.fg} numberOfLines={1}>
              {`${room.invite.displayName || (room.invite.handle ? `@${room.invite.handle}` : 'The host')} invited you on stage`}
            </Text>
            <Text variant="micro" color={ROOM.fgMuted} numberOfLines={1}>
              Accepting shares your camera and microphone live.
            </Text>
          </View>
          <View style={styles.inviteActions}>
            <Touchable
              onPress={() => { void acceptStageInvite() }}
              disabled={answeringInvite}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel="Accept the stage invite"
              style={[styles.invitePill, { backgroundColor: ROOM.fg, opacity: answeringInvite ? 0.6 : 1 }]}
            >
              <Text variant="micro" weight="700" color={ROOM.bg}>Accept</Text>
            </Touchable>
            <Touchable
              onPress={room.declineInvite}
              disabled={answeringInvite}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel="Decline the stage invite"
              style={[styles.invitePill, { borderColor: ROOM.fgFaint, borderWidth: StyleSheet.hairlineWidth * 2 }]}
            >
              <Text variant="micro" weight="700" color={ROOM.fg}>Decline</Text>
            </Touchable>
          </View>
        </Animated.View>
      ) : null}

      {/* Hearts rise from above the bottom bar's heart — TikTok's corner. */}
      <ReactionLayer floaters={floaters} origin={{ bottom: insets.bottom + 66, end: 20 }} />
      <GiftOverlay queue={room.gifts} keyOf={room.giftKey} />

      {/* Chat — sticky: the video stays full-bleed while the rail rides the
          keyboard with the composer, so the room stays readable mid-typing.
          `opened: insets.bottom` gives back the safe-area the anchor already
          carries — the keyboard covers that band now. */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom }}
        style={[styles.chat, { height: chatH, bottom: chatBottom }]}
        pointerEvents="box-none"
      >
        <LiveChatRail rows={room.chat} hostId={hostId} />
      </KeyboardStickyView>

      {/* On stage — never behind the auto-hiding chrome: someone who is live
          has to be able to see, and reach, their own mute. box-none, like the
          chat above: the strip spans the full width and its band crosses the
          rail's bottom button, so the container must pass those touches
          through — its own pills and toggles still take theirs. */}
      {onStage ? (
        <View style={[styles.onAir, { bottom: insets.bottom + 58 }]} pointerEvents="box-none">
          <View style={[styles.onAirPill, { backgroundColor: ROOM.glassStrong }]}>
            <View style={[
              styles.onAirDot,
              { backgroundColor: onAir && pub.status === 'live' ? ROOM.live : ROOM.warning },
            ]} />
            <Text variant="micro" color={ROOM.fg} weight="700">
              {!onAir || pub.status === 'error' ? 'NOT SENDING'
                : pub.status === 'live' ? 'ON STAGE' : 'CONNECTING'}
            </Text>
          </View>

          {onAir ? (
            <>
              {/* A host mute outranks your own switch, so the control says so
                  rather than offering an unmute that cannot work. Copy matches
                  the stage sheet's line. */}
              <SelfToggle
                icon={pub.hostMuted || !pub.micOn ? 'micOff' : 'mic'}
                label={pub.hostMuted
                  ? 'Muted by the host'
                  : pub.micOn ? 'Mute yourself' : 'Unmute yourself'}
                off={pub.hostMuted || !pub.micOn}
                disabled={pub.hostMuted}
                onPress={pub.toggleMic}
              />
              <SelfToggle
                icon={pub.camOn ? 'video' : 'videoOff'}
                label={pub.camOn ? 'Turn your camera off' : 'Turn your camera on'}
                off={!pub.camOn}
                onPress={pub.toggleCam}
              />
              <SelfToggle icon="camera" label="Flip your camera" onPress={pub.flip} />
              {pub.status === 'error' || pub.health === 'lost' ? (
                <SelfToggle icon="refresh" label="Restart your camera" onPress={pub.restart} />
              ) : null}
            </>
          ) : (
            /* The roster says you are up but this screen has no credential —
               it arrives once, on your own grant, and reopening the room from
               scratch cannot ask for it again. Stepping down and coming back
               up is the only way to get a new one. */
            <Button
              label="Step down"
              onPress={() => void room.stepDown()}
              variant="onDark"
              size="sm"
            />
          )}
        </View>
      ) : null}

      {/* The bottom bar — the TikTok row: [Say something…] then frameless
          circles (go up · gift · share · heart), no labels. Sticky: an
          absolutely-anchored bar sits BEHIND an open keyboard otherwise —
          typing with an invisible input. The opened offset returns the
          safe-area inset baked into the padding, leaving the 10pt breath
          above the keyboard instead of inset+10. */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom }}
        style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]}
      >
        <LiveComposer
          joined={room.joined}
          cooldown={chatCooldown}
          error={room.chatError}
          onSend={send}
          onHeart={() => fireReaction('LIKE')}
          onHeartHold={onHeartHold}
          actions={
            <>
              <BarButton
                icon={room.hand === 'onstage' ? 'mic' : 'personAdd'}
                label={
                  room.hand === 'onstage' ? 'Manage your stage seat'
                    : room.hand === 'requested' ? 'Requested — waiting for the host'
                      : stage?.isFull ? 'Stage is full' : 'Ask to join the stage'
                }
                tint={room.hand === 'onstage' ? ROOM.accent : ROOM.fg}
                dim={(!!stage?.isFull && room.hand === 'idle') || room.hand === 'requested' || handCooldown > 0}
                onPress={() => {
                  if (room.hand === 'onstage') { router.push(`/live/${streamId}/stage`); return }
                  if (room.hand === 'requested' || handCooldown > 0) return
                  void raise()
                }}
                onLongPress={() => { if (room.hand === 'onstage') void room.stepDown() }}
              />
              <BarButton icon="gift" label="Send a gift" tint={ROOM.accent} bg={ROOM.accentGhost} onPress={openGifts} />
              <BarButton icon="share" label="Share this stream" onPress={share} />
            </>
          }
        />
      </KeyboardStickyView>

      <GiftPickerSheet
        visible={gifts.visible}
        onClose={gifts.close}
        catalog={catalog}
        loading={catalogBusy}
        onSend={g => {
          if (!g.id) return
          /* Fire and forget: the `stream.gift` broadcast echoes back to the
             sender and is what animates. Animating the POST too double-fires. */
          void room.sendGift(String(g.id)).catch((e: any) => toast.warn(errorText(e)))
        }}
      />

      <ActionSheet
        visible={overflow.visible}
        onClose={overflow.close}
        actions={[
          { label: 'Copy link', icon: 'link', hidden: !stream?.shareUrl, onPress: share },
          {
            label: 'Send in a message',
            icon: 'chat',
            hidden: !stream?.shareUrl,
            onPress: () => router.push({
              pathname: '/chat/share',
              params: { url: stream!.shareUrl!, kind: 'live', label: stream?.title || 'Live' },
            }),
          },
          { label: 'Top supporters', icon: 'crown', onPress: () => router.push(`/live/${streamId}/supporters`) },
          { label: 'Stage', icon: 'people', onPress: () => router.push(`/live/${streamId}/stage`) },
          {
            /* ReportTargetType has no livestream value — the backend's only
               handle on a bad stream is its host, so the report targets the
               HOST as a USER and the label says so. */
            label: 'Report host',
            icon: 'flag',
            destructive: true,
            hidden: !stream?.hostId,
            onPress: () => {
              if (stream?.hostId) {
                router.push(reportHref({
                  targetType: 'USER',
                  targetId: String(stream.hostId),
                  name: stream.hostDisplayName || (stream.hostHandle ? `@${stream.hostHandle}` : undefined),
                  avatar: stream.hostAvatarUrl ?? undefined,
                }))
              }
            },
          },
        ]}
      />
    </View>
  )
}

/* The stage clock — the web's `.lv-elapsed` mono glass chip, ticking once a
   second. Its own component so the tick re-renders THIS chip, not the room;
   each tick recomputes from the timestamp, so a backgrounded app never
   drifts — it snaps right on the next tick. */
function ElapsedChip({ startedAt }: { startedAt: string | null }) {
  const [, force] = React.useReducer((v: number) => v + 1, 0)
  React.useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(force, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return null
  const secs = Math.floor((Date.now() - Date.parse(startedAt)) / 1000)
  if (!Number.isFinite(secs) || secs < 0) return null
  return (
    <View style={[styles.pill, { backgroundColor: ROOM.glass }]}>
      <NumericText variant="micro" color={ROOM.fg}>{clock(secs)}</NumericText>
    </View>
  )
}

/* A bottom-bar circle: icon only, no caption — the label is for the screen
   reader. `dim` keeps the control visible-but-quiet while a request is
   pending or the stage is full. */
function BarButton({
  icon, label, onPress, onLongPress, dim, tint, bg,
}: {
  icon: IconName
  label: string
  onPress: () => void
  onLongPress?: () => void
  dim?: boolean
  tint?: string
  /** A tinted circle for the one slot the web singles out (gift). */
  bg?: string
}) {
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="light"
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.barCircle, { backgroundColor: bg ?? ROOM.fillStrong, opacity: dim ? 0.45 : 1 }]}
    >
      <Icon name={icon} size={19} color={tint ?? ROOM.fg} />
    </Touchable>
  )
}

function SelfToggle({
  icon, label, off, disabled, onPress,
}: { icon: IconName; label: string; off?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      feedback="scale"
      noAutoHitSlop
      /* Your own mic and camera, 32pt across, mid-broadcast: the last control
         on this screen that may be hard to hit. */
      hitSlop={6}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.selfToggle, { backgroundColor: off ? ROOM.fg : ROOM.glassStrong }]}
    >
      {/* OFF inverts to the light plate — the web castbar's is-off pattern
          (`aria-pressed` → white fill, navy ink): unmistakable on the dark
          stage without crying alarm-red. Red stays reserved for REC and mute
          badges. Sky marks the ACTIVE state. */}
      <Icon name={icon} size={16} color={off ? ROOM.bg : ROOM.accent} />
    </Touchable>
  )
}

function durationOf(s: { startedAt: string | null; endedAt: string | null }): string {
  if (!s.startedAt || !s.endedAt) return ''
  const secs = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)
  return Number.isFinite(secs) && secs > 0 ? clock(secs) : ''
}

/* Every text-bearing plate here is a SETBACK, not a capsule — DESIGN.md §3
   sanctions exactly two pills app-wide (unread counters and LIVE badges) and
   none of these is either. `closeBtn`, `railCircle`, `selfToggle` and
   `onAirDot` stay round: icon-only controls and dots are sanctioned. */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ROOM.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, gap: space.sm },
  /* Anchored to the border box (padding ignored), running past the content so
     the wash fades rather than cuts. */
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: -48 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.xs },
  flexSpacer: { flex: 1 },
  /* The TikTok host capsule: one rounded-full plate carrying face, name and
     the Follow action together. */
  hostChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.xs, paddingEnd: space.xs2, borderRadius: 14, flexShrink: 1 },
  hostTap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  hostNames: { flexShrink: 1, maxWidth: 128 },
  followPill: { height: 28, paddingHorizontal: space.md, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginStart: 'auto' },
  audienceChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 28, paddingHorizontal: space.sm, borderRadius: 8 },
  face: { borderRadius: 10, overflow: 'hidden' },
  faceOverlap: { marginStart: -space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 24, paddingHorizontal: space.sm, borderRadius: 8 },
  moreBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  titleRow: { paddingHorizontal: space.xs },
  desc: { marginTop: space.xs },
  inviteCard: {
    position: 'absolute',
    start: 12,
    end: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm2,
    padding: space.sm2,
    ...setback(shape.card),
    borderCurve: 'continuous',
    borderStartWidth: 3,
  },
  inviteBody: { flex: 1 },
  inviteActions: { gap: space.xs2, alignItems: 'stretch' },
  invitePill: { height: 26, paddingHorizontal: space.md, ...setback(shape.buttonSm), borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  barCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chat: { position: 'absolute', start: 0, width: '72%' },
  onAir: {
    position: 'absolute',
    start: 12,
    end: 12,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  onAirPill: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 26, paddingHorizontal: space.sm2, ...setback(shape.chip), borderCurve: 'continuous' },
  onAirDot: { width: 7, height: 7, borderRadius: 3.5 },
  selfToggle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  endedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxxl },
  endedTitle: { marginTop: space.lg, marginBottom: space.xs },
  endedActions: { alignSelf: 'stretch', gap: space.sm2, marginTop: 28 },
})
