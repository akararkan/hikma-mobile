/* =========================================================
   Go live — pre-flight.

   Two ways to publish, and the phone is now one of them: the
   host console does a WHIP publish through `publishCamera`, so
   the choice made here rides the route into it. This screen
   still only ever calls `streams.start` — the stream is live
   the moment that resolves, and the camera opens a beat later
   in the console, which is the one screen that can also stop
   it.

   The camera pane is a PREVIEW, always. It proves framing and
   lighting before anyone is watching; nothing is published
   from this screen under either method, and the chip says so.

   `hasWebRTC` still gates the camera row. A build without the
   media engine falls back to exactly the encoder-only flow it
   had, rather than offering a method that cannot run.

   Either way `ingestUrl` is a secret — it contains the stream
   key — so it is never in a share sheet, never in a log, and
   the sheet says why in red.
   ========================================================= */
import React from 'react'
import { Linking, Share, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { isBlocked, isUnderReview, moderationText } from '@/lib/moderation'
import { hasWebRTC } from '@/lib/liveWebrtc'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import {
  Button, Field, Header, Icon, ListRow, Screen, Sheet, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import { MediaEngineNotice } from '@/components/call/MediaEngineNotice'
import { LivePill } from '@/components/live/LiveCard'
import { ROOM } from '@/components/live/skin'
import type { LiveStream } from '@/components/live/types'

type Method = 'camera' | 'rtmp'

export default function GoLiveScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [record, setRecord] = React.useState<boolean | null>(null)
  const [method, setMethod] = React.useState<Method>(hasWebRTC ? 'camera' : 'rtmp')
  const [facing, setFacing] = React.useState<'front' | 'back'>('front')
  const [busy, setBusy] = React.useState(false)
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<any>(null)
  const [moderation, setModeration] = React.useState<{ text: string; review: boolean } | null>(null)
  const [live, setLive] = React.useState<LiveStream | null>(null)
  const [cooldown, startCooldown] = useCooldown()
  const [camPerm, requestCam] = useCameraPermissions()
  /* The mic is pre-flighted HERE, with the camera: `publishCamera` asks for
     audio+video in one getUserMedia, so a mic denial the host never saw kills
     the whole publish mid-"Go live" — this screen is where it must surface. */
  const [micPerm, requestMic] = useMicrophonePermissions()
  const titleRef = React.useRef<any>(null)

  const canGo = !!title.trim() && !busy && cooldown === 0

  const go = async () => {
    if (!canGo) return
    setBusy(true)
    setTitleError(null); setFormError(null); setModeration(null)
    try {
      const s = (await api.chat.streams.start({
        title: title.trim(),
        description: description.trim(),
        /* Only put `record` on the wire when the switch was actually touched —
           an untouched switch must inherit the server's default, not overwrite
           it with our idea of one. */
        ...(record === null ? {} : { record }),
      })) as LiveStream
      fireHaptic('success')
      setLive(s)
    } catch (e: any) {
      /* Moderation keeps the draft and offers NO retry: the text is the
         problem, so a retry button would just re-submit the same sentence. */
      if (isBlocked(e)) setModeration({ text: moderationText(e), review: false })
      else if (isUnderReview(e)) setModeration({ text: moderationText(e), review: true })
      else if (codeOf(e) === 'BAD_REQUEST' || e?.status === 400) {
        setTitleError(errorText(e))
        titleRef.current?.focus()
      } else if (startCooldown(e)) {
        /* 429 — the button counts down; never auto-retry. */
      } else setFormError(e)
    } finally {
      setBusy(false)
    }
  }

  /* The stream IS live the moment `start` resolves. Backing out of the sheet
     without opening the console would strand it with no visible End button, so
     every exit lands on the console. */
  const toConsole = React.useCallback(() => {
    if (!live) return
    /* The console opens the camera itself — it owns the publish for the whole
       broadcast, and it is the only screen that can stop it. The chosen method
       and the framing the host just set ride the route so neither is guessed. */
    router.replace(
      method === 'camera'
        ? `/live/${live.id}/host?publish=camera&facing=${facing}`
        : `/live/${live.id}/host`,
    )
  }, [live, router, method, facing])

  return (
    <Screen>
      <Header back title="Go live" />

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Preview */}
        <View style={[styles.preview, { ...setback(t.shape.card), borderCurve: 'continuous', backgroundColor: ROOM.pane }]}>
          {camPerm?.granted ? (
            <>
              <CameraView facing={facing} style={StyleSheet.absoluteFill} />
              <View style={[styles.previewChip, { backgroundColor: ROOM.glassStrong }]}>
                <Text variant="micro" color={ROOM.fg}>
                  {method === 'camera'
                    ? "Preview — this is the camera you'll broadcast from"
                    : 'Preview only — nothing is being sent yet'}
                </Text>
              </View>
              {/* The camera can be granted while the mic is not, and a silent
                  mic denial resurfaces later as a failed publish. */}
              {micPerm && !micPerm.granted ? (
                <Touchable
                  onPress={() => {
                    if (!micPerm.canAskAgain) { void Linking.openSettings(); return }
                    void requestMic()
                  }}
                  feedback="dim"
                  noAutoHitSlop
                  accessibilityLabel="Allow microphone access"
                  style={[styles.micChip, { backgroundColor: ROOM.glassStrong }]}
                >
                  <Icon name="micOff" size={12} color={ROOM.warning} />
                  <Text variant="micro" color={ROOM.fg}>
                    {micPerm.canAskAgain ? 'The microphone is off — tap to allow' : 'Microphone off — allow it in Settings'}
                  </Text>
                </Touchable>
              ) : null}
              <Touchable
                onPress={() => setFacing(f => (f === 'front' ? 'back' : 'front'))}
                feedback="scale"
                noAutoHitSlop
                accessibilityLabel="Switch camera"
                style={[styles.flip, { backgroundColor: ROOM.glassStrong }]}
              >
                <Icon name="camera" size={18} color={ROOM.fg} />
              </Touchable>
            </>
          ) : (
            <View style={styles.previewOff}>
              <Icon name="camera" size={32} color={ROOM.fgGhost} />
              <Text variant="callout" color={ROOM.fgMuted} align="center" style={styles.previewOffCopy}>
                Allow camera and microphone access to see your preview
              </Text>
              <Button
                label={camPerm && !camPerm.canAskAgain ? 'Open Settings' : 'Allow'}
                onPress={() => {
                  if (camPerm && !camPerm.canAskAgain) { void Linking.openSettings(); return }
                  /* Both prompts, back to back — broadcasting needs both, and
                     the second one arriving mid-"Go live" is the failure this
                     screen exists to prevent. SEQUENCED, not concurrent:
                     Android rejects a permission request made while another is
                     in flight, and a rejected requestMic means the mic prompt
                     simply never shows. A denial is not an error here — the
                     mic chip carries the residual state. */
                  void (async () => {
                    await requestCam().catch(() => {})
                    await requestMic().catch(() => {})
                  })()
                }}
                /* The pane is a ROOM surface even on this paper screen — a
                   paper-white "secondary" plate on it is the exact clash the
                   onDark variant exists to prevent. */
                variant="onDark"
                size="sm"
              />
            </View>
          )}
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Field
            ref={titleRef}
            label="Title"
            required
            value={title}
            onChangeText={v => { setTitle(v); setTitleError(null) }}
            onBlur={() => setTitle(v => v.trim())}
            error={titleError}
            placeholder="What's your stream about?"
            maxLength={80}
            returnKeyType="next"
            editable={!busy}
          />

          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            onBlur={() => setDescription(v => v.trim())}
            placeholder="Add a description (optional)"
            maxLength={280}
            multiline
            minHeight={96}
            editable={!busy}
          />

          {moderation ? (
            <Text
              variant="footnote"
              tone={moderation.review ? 'warning' : 'danger'}
              align="ui"
              style={styles.moderation}
            >
              {moderation.text}
            </Text>
          ) : null}
          {formError ? (
            <Text variant="footnote" tone="danger" align="ui" style={styles.moderation}>{errorText(formError)}</Text>
          ) : null}

          <View style={[styles.card, { backgroundColor: c.surfaceSunken, ...setback(t.shape.card), borderCurve: 'continuous' }]}>
            <ListRow
              title="Record this broadcast"
              icon="reels"
              iconTone="danger"
              accessory={{
                kind: 'switch',
                value: record === true,
                onValueChange: v => { fireHaptic('light'); setRecord(v) },
                disabled: busy,
              }}
            />
            <Text variant="footnote" tone="muted" align="ui" style={styles.cardNote}>
              Saves a downloadable copy. Only you can download it, and you can
              delete it any time.
            </Text>
          </View>

          <Text variant="caption" tone="muted" align="ui" style={styles.groupLabel}>Publish method</Text>
          <View style={[styles.card, { backgroundColor: c.surfaceSunken, ...setback(t.shape.card), borderCurve: 'continuous' }]}>
            {hasWebRTC ? (
              <MethodRow
                title="This phone's camera"
                caption="Publishes straight from here. Nothing else to install."
                selected={method === 'camera'}
                onPress={() => setMethod('camera')}
                disabled={busy}
              />
            ) : (
              <Touchable
                onPress={() => router.push('/call/media-support')}
                feedback="dim"
                accessibilityLabel="Camera publishing is unavailable in this build"
                style={styles.methodRow}
              >
                <View style={styles.methodGlyph}><Icon name="lock" size={17} color={c.textMuted} /></View>
                <View style={styles.flex}>
                  <Text variant="body" align="ui">Camera (in-app)</Text>
                  <Text variant="footnote" tone="muted" align="ui" style={styles.methodCaption}>
                    Needs the media engine (react-native-webrtc). Tap to learn more.
                  </Text>
                </View>
              </Touchable>
            )}

            <MethodRow
              title="External encoder (RTMP)"
              caption="OBS, Streamlabs, or Larix on this phone. You'll get the URL next."
              selected={method === 'rtmp'}
              onPress={() => setMethod('rtmp')}
              disabled={busy}
            />
          </View>

          <Text variant="footnote" tone="muted" align="ui" style={styles.footnote}>
            {method === 'camera'
              ? 'Your camera and microphone open once the console does. Titles and descriptions are checked automatically before you go live.'
              : 'Titles and descriptions are checked automatically before you go live.'}
          </Text>
        </View>
      </KeyboardAwareScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, backgroundColor: c.bg, borderTopColor: c.separator }]}>
        <Button
          label={cooldown > 0 ? `Wait ${cooldown}s` : 'Go live'}
          onPress={go}
          variant="primary"
          size="lg"
          block
          loading={busy}
          disabled={!canGo}
        />
      </View>

      <SuccessSheet stream={live} method={method} onConsole={toConsole} />
    </Screen>
  )
}

function MethodRow({
  title, caption, selected, onPress, disabled,
}: {
  title: string
  caption: string
  selected: boolean
  onPress: () => void
  disabled?: boolean
}) {
  const c = useTheme().colors
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="dim"
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={title}
      style={styles.methodRow}
    >
      <View style={[styles.radio, { borderColor: selected ? c.accent : c.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: c.accent }]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text variant="body" align="ui">{title}</Text>
        <Text variant="footnote" tone="muted" align="ui" style={styles.methodCaption}>{caption}</Text>
      </View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   The credentials handover.
   --------------------------------------------------------- */

function SuccessSheet({
  stream, method, onConsole,
}: { stream: LiveStream | null; method: Method; onConsole: () => void }) {
  const t = useTheme()
  const c = t.colors
  if (!stream) return null

  const ingest = stream.ingestUrl || ''
  const split = splitIngest(ingest)
  const camera = method === 'camera'

  const copy = async (value: string, label: string) => {
    await Clipboard.setStringAsync(value)
    fireHaptic('light')
    toast.ok(`${label} copied`)
  }

  return (
    <Sheet
      visible
      onClose={onConsole}
      title="You're live"
      maxHeightRatio={0.85}
      footer={
        <View style={styles.sheetFooter}>
          <Button
            label={camera ? 'Open the console and start your camera' : 'Open host console'}
            onPress={onConsole}
            variant="primary"
            size="lg"
            block
          />
          <Button
            label="Share watch link"
            onPress={() => {
              const url = stream.shareUrl
              if (!url) { toast.warn('No share link yet.'); return }
              void Share.share({ message: url, url })
            }}
            variant="secondary"
            size="lg"
            block
          />
        </View>
      }
    >
      <View style={styles.sheetBody}>
        {/* The one LIVE badge everywhere — solid live red, breathing white
            dot (the web's `.lv-badge`), not a bespoke wash pill. */}
        <View style={styles.livePillRow}>
          <LivePill />
        </View>

        {camera ? (
          <Text variant="footnote" tone="muted" align="ui" style={styles.sheetLead}>
            Your stream is up. The picture starts when the console opens the
            camera — everything below is only for an external encoder.
          </Text>
        ) : null}

        <Text variant="subhead" tone="secondary" align="ui" style={styles.sheetLabel}>
          Stream URL (keep this private)
        </Text>
        <View style={[styles.mono, { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm }]}>
          {/* Wrapped, never truncated: a stream key you cannot select in full
              is a stream key you cannot use. */}
          <Text variant="footnote" mono align="ui" selectable>
            {ingest || 'Not provided by the server'}
          </Text>
        </View>
        <Button
          label="Copy stream URL"
          icon="copy"
          onPress={() => copy(ingest, 'Stream URL')}
          variant="tinted"
          size="sm"
          disabled={!ingest}
          style={styles.copyBtn}
        />

        {split ? (
          <View style={styles.splitBlock}>
            <SplitRow label="Server" value={split.server} onCopy={() => copy(split.server, 'Server')} />
            <SplitRow label="Stream key" value={split.key} onCopy={() => copy(split.key, 'Stream key')} />
            <Text variant="footnote" tone="muted" align="ui" style={styles.sheetNote}>
              Some encoders want these separately — if in doubt, paste the whole URL.
            </Text>
          </View>
        ) : null}

        <Text variant="footnote" tone="danger" align="ui" style={styles.warn}>
          Never share this link — it contains your stream key.
        </Text>

        {hasWebRTC ? null : <MediaEngineNotice variant="golive" compact />}
      </View>
    </Sheet>
  )
}

function SplitRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  const t = useTheme()
  return (
    <View style={styles.splitRow}>
      <Text variant="footnote" tone="muted" align="ui" style={styles.splitLabel}>{label}</Text>
      <Text variant="footnote" align="ui" selectable style={styles.flex} numberOfLines={2}>{value}</Text>
      <Touchable onPress={onCopy} feedback="dim" accessibilityLabel={`Copy ${label}`}>
        <Icon name="copy" size={16} color={t.colors.accent} />
      </Touchable>
    </View>
  )
}

/** `rtmp://host:1935/{id}?user=publisher&pass=…` → server + key, the two
 *  fields every encoder asks for. Returns null when the shape is unfamiliar
 *  rather than guessing — a wrong split is worse than no split. */
function splitIngest(url: string): { server: string; key: string } | null {
  if (!url) return null
  const m = /^(rtmps?:\/\/[^/]+(?:\/[^/?]+)*)\/([^/?]+(?:\?.*)?)$/.exec(url)
  if (!m) return null
  return { server: m[1], key: m[2] }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    aspectRatio: 3 / 4,
    overflow: 'hidden',
  },
  previewOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm2, padding: space.xl },
  previewOffCopy: { maxWidth: 240 },
  /* Text-bearing plates wear the chip setback; `flip` stays round — an
     icon-only control is sanctioned. */
  previewChip: { position: 'absolute', start: 10, bottom: 10, paddingHorizontal: space.sm, paddingVertical: space.xs, ...setback(shape.chip), borderCurve: 'continuous' },
  micChip: { position: 'absolute', start: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingHorizontal: space.sm, paddingVertical: space.xs, ...setback(shape.chip), borderCurve: 'continuous' },
  flip: { position: 'absolute', end: 10, top: 10, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: space.xl, paddingTop: 22, gap: space.xl },
  moderation: { marginTop: -space.sm },
  card: { paddingBottom: space.md },
  cardNote: { paddingHorizontal: space.lg },
  /* No textTransform: `caption` uppercases LATIN ONLY inside the Text
     primitive, which is what protects an Arabic or Kurdish label. */
  groupLabel: { marginBottom: -space.md },
  methodRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg },
  methodGlyph: { width: 22, alignItems: 'center', opacity: 0.45 },
  methodCaption: { marginTop: space.xs },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: space.xxs },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  footnote: { marginTop: -space.xs2 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: { paddingHorizontal: space.xl, paddingTop: space.md },
  livePillRow: { alignSelf: 'flex-start' },
  sheetLead: { marginTop: space.md2 },
  sheetLabel: { marginTop: space.lg2, marginBottom: space.xs2 },
  mono: { padding: space.md },
  copyBtn: { marginTop: space.sm2 },
  splitBlock: { marginTop: space.lg2, gap: space.sm2 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  splitLabel: { width: 84 },
  sheetNote: { marginTop: space.xxs },
  warn: { marginTop: space.lg, marginBottom: space.md2 },
  sheetFooter: { gap: space.sm2 },
})
