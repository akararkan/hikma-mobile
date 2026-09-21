/* =========================================================
   LiveChatRail + LiveComposer.

   Live chat is EPHEMERAL: broadcast only, never persisted,
   never replayed. A late joiner legitimately sees nothing and
   a reconnect legitimately loses the backlog — so the empty
   rail says "no messages yet", never "couldn't load", and the
   room never re-seeds chat after a drop.

   The room keeps its array newest-first (that is what the
   3-second echo dedupe and the 120-line cap both need), while
   the rail reads bottom-up. FlashList v2 dropped `inverted` in
   favour of `maintainVisibleContentPosition`, so the rail
   reverses once for rendering rather than the room storing the
   list backwards for the sake of a view.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { isRedactedText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'
import { night, ROOM, withAlpha } from './skin'
import type { LiveChatLine, PresenceLine } from './types'

export type RailRow =
  | ({ kind: 'chat' } & LiveChatLine)
  | ({ kind: 'ghost' } & PresenceLine)

/* Module scope, so the rail hands FlashList the SAME functions on every
   render. `getItemType` matters here: a ghost line ("@x joined") and a chat
   bubble are different shapes, and without it they share one recycle pool —
   a ghost's React key gets handed to a bubble and the avatar remounts. */
const keyExtractor = (r: RailRow) => rowKey(r)
const getItemType = (r: RailRow) => r.kind

export function LiveChatRail({
  rows, hostId, style, contentStyle,
}: { rows: RailRow[]; hostId?: string | null; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const oldestFirst = React.useMemo(() => [...rows].reverse(), [rows])

  /* Stable identity or FlashList's ViewHolder memo (which compares renderItem
     by reference) re-renders every mounted line on every incoming message. */
  const reducedMotion = t.prefs.reducedMotion
  const renderItem = React.useCallback(
    ({ item }: { item: RailRow }) => (
      <ChatRow
        row={item}
        reducedMotion={reducedMotion}
        isHost={!!hostId && item.kind === 'chat' && String(item.userId) === String(hostId)}
      />
    ),
    [reducedMotion, hostId],
  )

  if (!rows.length) {
    return (
      <View style={[styles.empty, style]}>
        {/* Audience-neutral: this rail renders on the viewer room too, where
            the reader has no viewers to greet. */}
        <Text variant="footnote" color={ROOM.fgFaint} align="ui">
          No messages yet — be the first to say something.
        </Text>
      </View>
    )
  }

  return (
    <View style={[styles.railWrap, style]}>
      <FlashList
        data={oldestFirst}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentStyle as any}
        keyboardShouldPersistTaps="handled"
        /* A real alpha fade at the top edge (Android): rows dissolve without
           painting a dark band over the video — the old SCRIM_UP overlay
           dimmed the picture itself, not just the text. */
        fadingEdgeLength={46}
        maintainVisibleContentPosition={{
          startRenderingFromBottom: true,
          autoscrollToBottomThreshold: 0.2,
        }}
      />
    </View>
  )
}

/* Keyless rows are keyed by OBJECT, not by content — two identical lines from
   one user in the same tick collided on a content-derived key, and a duplicate
   key is a hard FlashList crash. */
const fallbackKeys = new WeakMap<object, string>()
let fallbackSeq = 0
function rowKey(r: RailRow): string {
  if (r.kind === 'ghost') return r.key
  if (r.key) return r.key
  let k = fallbackKeys.get(r)
  if (!k) { k = `row-${++fallbackSeq}`; fallbackKeys.set(r, k) }
  return k
}

const ChatRow = React.memo(function ChatRow({ row, reducedMotion, isHost }: { row: RailRow; reducedMotion: boolean; isHost?: boolean }) {
  const t = useTheme()

  if (row.kind === 'ghost') {
    return (
      <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(t.ms(180))} style={styles.ghost}>
        {/* On a glass plate like every other line: bare 45%-white italic over
            a bright scene was unreadable, and text shadows are banned. */}
        <View style={[styles.ghostPlate, { backgroundColor: ROOM.glass }]}>
          <Text variant="caption" caps={false} italic color={ROOM.fgMuted} align="ui">
            @{row.handle} {row.joined ? 'joined' : 'left'}
          </Text>
        </View>
      </Animated.View>
    )
  }

  /* A line the moderator pulled comes back as the redaction sentinel. It has
     to occupy its place — a silently vanishing message reads as a bug and
     hides the fact that moderation acted. */
  const redacted = isRedactedText(row.text)

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(t.ms(180))}
      style={styles.rowWrap}
    >
      <Avatar uri={null} name={row.username || row.handle} seed={row.userId} size={24} />
      {/* The web's overlay line (`.lv-ovl-line`): a real glass plate under the
          words — the old 28% wash washed out over a bright picture — with the
          name in Sky, the on-dark accent the web bolds its names in. */}
      <View style={[styles.bubble, { backgroundColor: ROOM.glass, opacity: row.pending ? 0.6 : 1 }]}>
        <Text variant="footnote" numberOfLines={3}>
          {/* The host's own lines carry a mark — identity-based, which is the
              honest cousin of "pin": the wire has no message ids to pin BY
              (LiveChatMessage carries none), so the one durable anchor the
              room owns is who is speaking. */}
          {isHost ? <Text variant="caption" weight="700" color={ROOM.like}>Host · </Text> : null}
          <Text variant="caption" weight="700" color={ROOM.accent}>@{row.handle} </Text>
          {redacted
            ? <Text variant="footnote" italic color={ROOM.fgFaint}>Message removed</Text>
            : <Text variant="footnote" color={ROOM.fg}>{row.text}</Text>}
        </Text>
      </View>
    </Animated.View>
  )
})

/* ---------------------------------------------------------
   The composer.

   It owns only the draft, the per-control cooldown and the
   inline server sentence. The optimistic append, the SSE-echo
   dedupe and the NOT_A_MEMBER → re-join → resend recovery all
   live in useLiveRoom, because they are state the room owns
   and a composer that reached into it would be a second
   source of truth.
   --------------------------------------------------------- */

export interface LiveComposerProps {
  joined: boolean
  cooldown: number
  error?: string | null
  onSend: (text: string) => void | Promise<void>
  onHeart?: () => void
  onHeartHold?: (down: boolean) => void
  /** Extra bar circles (go up · gift · share) rendered between the input and
   *  the heart — the TikTok bottom-bar grammar; the screen owns what they do. */
  actions?: React.ReactNode
  style?: StyleProp<ViewStyle>
}

export function LiveComposer({
  joined, cooldown, error, onSend, onHeart, onHeartHold, actions, style,
}: LiveComposerProps) {
  const t = useTheme()
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const canSend = joined && !!draft.trim() && !busy && cooldown === 0

  const submit = async () => {
    if (!canSend) return
    const text = draft.trim()
    setBusy(true)
    /* Clear on submit, not on resolve: the line is already on screen
       optimistically, and a draft that lingers invites a double send. */
    setDraft('')
    try { await onSend(text) } finally { setBusy(false) }
  }

  return (
    <View style={style}>
      {error ? (
        <Text variant="caption" color={ROOM.danger} align="ui" style={styles.composerError}>{error}</Text>
      ) : null}
      <View style={styles.composerRow}>
        {/* The TikTok input capsule: rounded-full glass well; the faint
            outline draws its edge over any picture the fill alone melts
            into. Capsule chrome on the live surfaces is the owner's TikTok
            directive. */}
        <View
          style={[
            styles.input,
            { backgroundColor: ROOM.fillStrong, borderWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(ROOM.fg, 0.25) },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            editable={joined && cooldown === 0}
            placeholder={
              !joined ? 'Joining…'
                : cooldown > 0 ? `Wait ${cooldown}s`
                  : 'Say something…'
            }
            placeholderTextColor={ROOM.fgFaint}
            maxLength={300}
            returnKeyType="send"
            onSubmitEditing={submit}
            blurOnSubmit={false}
            allowFontScaling={false}
            style={[styles.inputText, { color: ROOM.fg, fontSize: t.type.callout.fontSize }]}
          />
        </View>

        {/* The send coin exists only while there is something to send — the
            TikTok bar keeps its circles for actions and lets the keyboard's
            return key be the everyday submit. Cerulean + navy ink is THE
            dark-plate CTA pair (DESIGN.md §2). */}
        {draft.trim() ? (
          <Touchable
            onPress={submit}
            disabled={!canSend}
            haptic="light"
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="Send message"
            style={[styles.circle, { backgroundColor: canSend ? night.cta : ROOM.fillStrong }]}
          >
            <Icon name="send" size={17} color={canSend ? night.textOnCta : ROOM.fgFaint} />
          </Touchable>
        ) : null}

        {actions}

        {onHeart ? (
          <Touchable
            onPress={onHeart}
            onPressIn={() => onHeartHold?.(true)}
            onPressOut={() => onHeartHold?.(false)}
            haptic="light"
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel="Send a reaction"
            style={[styles.circle, { backgroundColor: ROOM.fillStrong }]}
          >
              <Icon name="heart" size={19} color={ROOM.like} filled />
          </Touchable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  railWrap: { flex: 1 },
  /* flex: 1 is load-bearing: without it the placeholder sizes to content at
     the TOP of the chat window and reads as a lost line mid-screen. */
  empty: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.md, paddingBottom: space.sm },
  rowWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs2, paddingVertical: 2.5, paddingHorizontal: space.sm2 },
  bubble: { flexShrink: 1, borderRadius: 12, paddingHorizontal: space.sm2, paddingVertical: space.xs2 },
  ghost: { paddingHorizontal: 38, paddingVertical: space.xxs, flexDirection: 'row' },
  ghostPlate: { borderRadius: 10, paddingHorizontal: space.sm, paddingVertical: space.xs },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* The TikTok capsule well. */
  input: { flex: 1, height: 40, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: 10 },
  inputText: { padding: 0, flex: 1 },
  composerError: { marginBottom: space.xs2, paddingHorizontal: space.xs },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
