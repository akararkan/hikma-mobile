/* =========================================================
   Stage — the multi-guest control plane.

   Control plane only, and deliberately so: raise a hand,
   approve, deny, invite, accept, decline, mute, unmute, take
   down, step down, "stage full". The MEDIA lives on the watch
   screen underneath — a guest's publish must not have the
   lifetime of a sheet that can be swiped away, or dismissing
   the controls would take them off the air.

   The host's mute is authoritative: it rides every roster
   frame and every client applies it locally, which with real
   audio arriving is now a mute the whole room hears. A guest's
   own mic toggle lives beside their picture, on the watch
   screen, where the tally light is.

   The "Watching" tab is SESSION-LOCAL: there is no viewer
   roster endpoint, so it is built from `stream.viewer` frames
   collected since the sheet's parent screen opened. The
   caption pinned above the list says exactly that.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { hasWebRTC } from '@/lib/liveWebrtc'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useChatEvents } from '@/context/RealtimeContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Avatar, Button, ConfirmSheet, Header, Icon, Screen, ScreenScroll,
  SegmentedControl, SkeletonList, Text, Touchable, fireHaptic, useSheetState, toast,
} from '@/ui'
import type { StageMember, StageState, Watcher } from '@/components/live/types'

type Tab = 'requests' | 'stage' | 'watching'

export default function StageScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const streamId = id ? String(id) : ''
  const meId = user?.id ? String(user.id) : null

  const [tab, setTab] = React.useState<Tab>('stage')
  const [requests, setRequests] = React.useState<StageMember[]>([])
  const [watchers, setWatchers] = React.useState<Watcher[]>([])
  const [invited, setInvited] = React.useState<Record<string, number>>({})
  const [full, setFull] = React.useState(false)
  const guestMenu = useSheetState<StageMember>()
  const takeDown = useSheetState<StageMember>()
  const [busy, setBusy] = React.useState(false)

  const stage = useAsync<StageState>(
    async () => (await api.chat.streams.stage.get(streamId)) as StageState,
    { enabled: !!streamId, deps: [streamId] },
  )

  const isHost = !!meId && !!stage.data?.hostId && String(stage.data.hostId) === meId
  const myMember = stage.data?.members.find(m => meId && String(m.userId) === meId) ?? null
  const onStage = !!myMember && !myMember.isHost && myMember.status === 'ACTIVE'

  /* Host only — the queue 403s for anyone else, and the tab is not offered. */
  const queue = useAsync<StageMember[]>(
    () => api.chat.streams.stage.requests(streamId),
    { enabled: !!streamId && isHost, deps: [streamId, isHost] },
  )
  React.useEffect(() => { if (queue.data) setRequests(queue.data) }, [queue.data])
  React.useEffect(() => { if (isHost) setTab('requests') }, [isHost])
  React.useEffect(() => { setFull(!!stage.data?.isFull) }, [stage.data?.isFull])

  useChatEvents(evt => {
    const type = String(evt?.type || '')
    if (!type.startsWith('stream.stage')) return
    if (String(evt.streamId ?? evt.stage?.streamId ?? evt.stageMember?.streamId ?? '') !== streamId) return

    if (type === 'stream.stage') {
      /* Replace wholesale — the frame is the whole panel. */
      const next: StageState = evt.stage
      stage.setData(next)
      setFull(!!next?.isFull)
      const active = new Set((next?.members || []).map(m => String(m.userId)))
      setRequests(prev => prev.filter(r => !active.has(String(r.userId))))
      return
    }
    if (type === 'stream.stage.request') {
      const m: StageMember = evt.stageMember
      if (!m?.userId) return
      setRequests(prev => [...prev.filter(r => String(r.userId) !== String(m.userId)), m])
      fireHaptic('light')
      return
    }
    if (type === 'stream.stage.grant') {
      const m: StageMember = evt.stageMember
      if (m?.status === 'ACTIVE') fireHaptic('success')
      else if (m?.status === 'REMOVED') toast.info('You were taken off the stage')
      void stage.reload()
    }
  })

  /* The screen that owns the socket collects viewers; this sheet mirrors the
     ones that arrive while it is open. */
  useChatEvents(evt => {
    if (String(evt?.type || '') !== 'stream.viewer') return
    if (String(evt.streamId ?? evt.stream?.id ?? '') !== streamId) return
    const uid = evt.userId ? String(evt.userId) : null
    if (!uid || uid === meId) return
    setWatchers(prev => {
      if (evt.memberChange === 'LEFT') return prev.filter(w => w.userId !== uid)
      if (prev.some(w => w.userId === uid)) return prev
      return [...prev, { userId: uid, handle: '', displayName: '', avatarUrl: null, at: Date.now() }]
    })
  })

  const mutate = async (fn: () => Promise<any>, revert?: () => void) => {
    setBusy(true)
    fireHaptic('light')
    try { await fn() }
    catch (e: any) {
      revert?.()
      /* "The stage is full" has to change the whole surface, not just this
         row — every Bring up / Invite up control is now a lie. */
      if (/stage is full/i.test(String(e?.message || ''))) setFull(true)
      else if (/no pending request/i.test(String(e?.message || ''))) void queue.reload()
      else if (/not on stage/i.test(String(e?.message || ''))) void stage.reload()
      else toast.warn(errorText(e))
    } finally { setBusy(false) }
  }

  const approve = (m: StageMember) => {
    if (!m.userId) return
    setRequests(prev => prev.filter(r => String(r.userId) !== String(m.userId)))
    void mutate(
      () => api.chat.streams.stage.approve(streamId, m.userId!),
      () => setRequests(prev => [...prev, m]),
    )
  }

  const deny = (m: StageMember) => {
    if (!m.userId) return
    setRequests(prev => prev.filter(r => String(r.userId) !== String(m.userId)))
    void mutate(() => api.chat.streams.stage.deny(streamId, m.userId!))
  }

  const invite = (w: Watcher) => {
    /* There is no server-side pending-invite list, so "Invited" is a local
       label with a one-minute life. */
    setInvited(prev => ({ ...prev, [w.userId]: Date.now() }))
    void mutate(() => api.chat.streams.stage.invite(streamId, w.userId))
  }

  const toggleMute = (m: StageMember) => {
    if (!m.userId) return
    const wasMuted = m.muted
    stage.setData(s => s && ({
      ...s,
      members: s.members.map(x => (String(x.userId) === String(m.userId) ? { ...x, muted: !wasMuted } : x)),
    }))
    void mutate(
      () => (wasMuted
        ? api.chat.streams.stage.unmute(streamId, m.userId!)
        : api.chat.streams.stage.mute(streamId, m.userId!)),
      () => stage.setData(s => s && ({
        ...s,
        members: s.members.map(x => (String(x.userId) === String(m.userId) ? { ...x, muted: wasMuted } : x)),
      })),
    )
  }

  const stepDown = () => {
    void mutate(async () => {
      await api.chat.streams.stage.leave(streamId)
      await stage.reload()
    })
  }

  const members = stage.data?.members ?? []
  const host = members.find(m => m.isHost) ?? null
  const guests = members.filter(m => !m.isHost)
  const offline = isNetworkError(stage.error)

  const tabs = (isHost
    ? [
      { value: 'requests' as Tab, label: `Requests (${requests.length})` },
      { value: 'stage' as Tab, label: `On stage (${stage.data?.guestCount ?? 0})` },
      { value: 'watching' as Tab, label: 'Watching' },
    ]
    : [
      { value: 'stage' as Tab, label: `On stage (${stage.data?.guestCount ?? 0})` },
      { value: 'watching' as Tab, label: 'Watching' },
    ])

  return (
    <Screen background="sunken">
      <Stack.Screen
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.55, 0.95],
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Header
        closeButton
        title="Stage"
        border={false}
        actions={[]}
        below={
          <View style={styles.head}>
            <Text
              variant="footnote"
              tone={full ? 'warning' : 'muted'}
              align="ui"
              style={styles.counter}
            >
              {stage.data?.guestCount ?? 0}/{stage.data?.maxGuests ?? 6}
            </Text>
            <SegmentedControl<Tab> options={tabs} value={tab} onChange={setTab} />
          </View>
        }
      />

      {offline ? (
        <View style={[styles.strip, { backgroundColor: c.surfaceSunken }]}>
          <Icon name="offline" size={13} color={c.textMuted} />
          <Text variant="footnote" tone="muted" align="ui">Offline</Text>
        </View>
      ) : null}

      <ScreenScroll refreshing={stage.refreshing} onRefresh={stage.refresh}>
        {onStage && myMember ? (
          <View style={[styles.selfCard, { backgroundColor: c.surface, borderRadius: t.radius.md }]}>
            <Text variant="bodyStrong" align="ui">You&apos;re on stage</Text>
            <Text variant="footnote" tone="muted" align="ui" style={styles.selfLine}>
              {myMember.muted ? 'Muted by the host' : 'Live beside the host'}
            </Text>
            <Button
              label="Step down"
              onPress={stepDown}
              variant="ghost"
              size="sm"
              disabled={busy}
              style={styles.selfBtn}
            />
            <Text variant="caption" tone="muted" align="ui">
              {hasWebRTC
                ? 'Your camera and microphone publish from the watch screen. This sheet is only the controls — closing it keeps you on air.'
                : "Your microphone needs the media engine — you're on stage but not audible on this build."}
            </Text>
          </View>
        ) : null}

        {stage.loading ? (
          <SkeletonList count={4} />
        ) : tab === 'requests' ? (
          !requests.length ? (
            <Empty
              icon="personAdd"
              title="No hand-raises yet"
              body="Viewers who ask to come up appear here."
            />
          ) : (
            requests.map(m => (
              <View key={String(m.userId)} style={styles.row}>
                <Avatar uri={m.avatarUrl} name={m.displayName || m.handle} seed={m.userId} size={44} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" align="ui" numberOfLines={1}>
                    {m.displayName || `@${m.handle}`}
                  </Text>
                  <Text variant="footnote" tone="muted" align="ui" numberOfLines={1}>
                    @{m.handle} · asked to come up
                  </Text>
                </View>
                <Button
                  label={full ? 'Stage full' : 'Bring up'}
                  onPress={() => approve(m)}
                  variant="primary"
                  size="sm"
                  disabled={full || busy}
                />
                <Button label="Dismiss" onPress={() => deny(m)} variant="ghost" size="sm" disabled={busy} />
              </View>
            ))
          )
        ) : tab === 'stage' ? (
          <>
            {host ? (
              <View style={styles.row}>
                <Avatar uri={host.avatarUrl} name={host.displayName || host.handle} seed={host.userId} size={44} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong" align="ui" numberOfLines={1}>
                    {host.displayName || `@${host.handle}`}
                  </Text>
                  <Text variant="footnote" tone="muted" align="ui">@{host.handle}</Text>
                </View>
                <View style={[styles.hostChip, { backgroundColor: c.accentSoft }]}>
                  <Text variant="micro" tone="accent" weight="700">HOST</Text>
                </View>
              </View>
            ) : null}

            {!guests.length ? (
              <Empty
                icon="people"
                title="Nobody is up yet"
                body={isHost
                  ? 'Invite a viewer from the Watching tab.'
                  : 'The host has not brought anyone up.'}
              />
            ) : guests.map(m => (
              <View key={String(m.userId)} style={styles.row}>
                {/* Accent ring, not green — green is success-only; "on the
                    stage" wears the same accent as the room's active rings. */}
                <View style={[styles.ring, { borderColor: c.accent }]}>
                  <Avatar uri={m.avatarUrl} name={m.displayName || m.handle} seed={m.userId} size={44} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong" align="ui" numberOfLines={1}>
                    {m.displayName || `@${m.handle}`}
                  </Text>
                  <Text variant="footnote" tone="muted" align="ui">@{m.handle}</Text>
                </View>
                {isHost ? (
                  <>
                    <Touchable
                      onPress={() => toggleMute(m)}
                      feedback="scale"
                      noAutoHitSlop
                      disabled={busy}
                      accessibilityLabel={m.muted ? `Unmute @${m.handle}` : `Mute @${m.handle}`}
                      style={[styles.iconBtn, { backgroundColor: m.muted ? c.dangerSoft : c.surfaceSunken }]}
                    >
                      <Icon name={m.muted ? 'micOff' : 'mic'} size={17} color={m.muted ? c.danger : c.textSecondary} />
                    </Touchable>
                    <Touchable
                      onPress={() => guestMenu.open(m)}
                      feedback="scale"
                      noAutoHitSlop
                      accessibilityLabel={`More options for @${m.handle}`}
                      style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}
                    >
                      <Icon name="more" size={17} color={c.textSecondary} />
                    </Touchable>
                  </>
                ) : m.muted ? (
                  <Icon name="micOff" size={17} color={c.danger} />
                ) : null}
              </View>
            ))}

            {isHost && guests.length ? (
              <Text variant="footnote" tone="muted" align="ui" style={styles.footer}>
                A muted guest is silent for everyone, not just you.
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text variant="footnote" tone="muted" align="ui" style={styles.caption}>
              People who joined since you opened this stream.
            </Text>
            {!watchers.length ? (
              <Empty
                icon="eye"
                title="Nobody has joined yet"
                body="Viewers arriving while this screen is open are listed here."
              />
            ) : watchers.map(w => {
              const already = members.some(m => String(m.userId) === w.userId)
              const justInvited = !!invited[w.userId] && Date.now() - invited[w.userId] < 60_000
              return (
                <View key={w.userId} style={styles.rowSm}>
                  <Avatar uri={w.avatarUrl} name={w.displayName || w.handle || w.userId} seed={w.userId} size={40} />
                  <View style={styles.flex}>
                    <Text variant="body" align="ui" numberOfLines={1}>
                      {w.displayName || (w.handle ? `@${w.handle}` : 'Viewer')}
                    </Text>
                  </View>
                  {isHost ? (
                    <Button
                      label={already ? 'On stage' : full ? 'Stage full' : justInvited ? 'Invited' : 'Invite up'}
                      onPress={() => invite(w)}
                      variant="secondary"
                      size="sm"
                      disabled={already || full || justInvited || busy}
                    />
                  ) : null}
                </View>
              )
            })}
          </>
        )}

        {stage.error && !offline ? (
          <View style={styles.errorBlock}>
            <Text variant="callout" tone="muted" align="ui">{errorText(stage.error)}</Text>
          </View>
        ) : null}
      </ScreenScroll>

      <ActionSheet
        visible={guestMenu.visible}
        onClose={guestMenu.close}
        title={guestMenu.payload?.displayName || (guestMenu.payload ? `@${guestMenu.payload.handle}` : undefined)}
        actions={[
          {
            label: 'Take down',
            icon: 'personRemove',
            destructive: true,
            onPress: () => guestMenu.payload && takeDown.open(guestMenu.payload),
          },
          {
            label: 'Open profile',
            icon: 'person',
            hidden: !guestMenu.payload?.handle,
            onPress: () => router.push(`/u/${guestMenu.payload?.handle}`),
          },
        ]}
      />

      <ConfirmSheet
        visible={takeDown.visible}
        onClose={takeDown.close}
        title="Take them off the stage?"
        message="Their publishing credentials are revoked immediately."
        confirmLabel="Take down"
        destructive
        onConfirm={() => {
          const m = takeDown.payload
          takeDown.close()
          if (m?.userId) void mutate(() => api.chat.streams.stage.remove(streamId, m.userId!))
        }}
      />
    </Screen>
  )
}

function Empty({ icon, title, body }: { icon: 'personAdd' | 'people' | 'eye'; title: string; body: string }) {
  const t = useTheme()
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={32} color={t.colors.textFaint} />
      <Text variant="headline" align="center" style={styles.emptyTitle}>{title}</Text>
      <Text variant="footnote" tone="muted" align="center">{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingBottom: space.sm2, gap: space.sm },
  counter: { alignSelf: 'flex-end' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, height: 28 },
  selfCard: { margin: space.lg, padding: space.md2 },
  selfLine: { marginTop: space.xxs },
  selfBtn: { marginVertical: space.xs2, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2, minHeight: 64 },
  rowSm: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56 },
  ring: { borderWidth: 2, borderRadius: 999, padding: space.xxs },
  hostChip: { paddingHorizontal: space.xs2, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  caption: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm2 },
  empty: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: space.xxxl, gap: space.xs },
  emptyTitle: { marginTop: space.md },
  errorBlock: { padding: space.lg },
  flex: { flex: 1 },
})
